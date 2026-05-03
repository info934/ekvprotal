import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, User, Mail, Phone, DollarSign, Folder, FileText, Activity, AlertTriangle, CheckCircle2, XCircle, Upload, ClipboardList, Copy, CircleDot, BadgeCheck as CircleCheck, CalendarX, Briefcase, Award, Plus, Edit2, Trash2, Download, MessageSquare, ListTodo, Clock, Layers } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { format, differenceInDays, parseISO, isPast } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDropzone } from 'react-dropzone';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter } from "@/components/ui/alert-dialog";
import MemberDialog from '@/components/MemberDialog';
import SendMessageDialog from '@/components/SendMessageDialog';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, projectStatusConfig } from '@/lib/utils';
import { sendEmail } from '@/lib/email';
import { calculateProjectMemberRewardFromProject } from '@/domain/financials';

const DetailSection = ({ title, icon: Icon, children, contentClassName = "" }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="mt-6"
  >
    <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
      <Icon className="w-5 h-5 gradient-text" />
      {title}
    </h3>
    <div className={`space-y-3 ${contentClassName}`}>{children}</div>
  </motion.div>
);

const InfoItem = ({ label, value, children }) => (
  <div>
    <p className="text-sm text-muted-foreground">{label}</p>
    {children || <p className="font-semibold">{value || '-'}</p>}
  </div>
);

const PayoutProjectsPopover = ({ items }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs">
        <Layers className="w-3 h-3 mr-1" />
        {items.length} {items.length === 1 ? 'projekt' : items.length < 5 ? 'projekty' : 'projektů'}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-80">
      <div className="space-y-4">
        <h4 className="font-medium leading-none">Zahrnuté projekty</h4>
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.project_id || item.realization_id || item.realizace_id} className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground truncate pr-2">
                {item.projects?.name || item.realizations?.name || item.realization?.name || 'N/A'}
              </span>
              <span className="font-semibold whitespace-nowrap">{parseFloat(item.amount).toLocaleString('cs-CZ')} Kč</span>
            </div>
          ))}
        </div>
      </div>
    </PopoverContent>
  </Popover>
);


const payoutStatusConfig = {
  pending: { label: 'Čeká na schválení', icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-100' },
  approved: { label: 'Čeká na fakturu', icon: Upload, color: 'text-blue-500', bg: 'bg-blue-100' },
  invoice_uploaded: { label: 'Faktura nahrána', icon: FileText, color: 'text-purple-500', bg: 'bg-purple-100' },
  paid: { label: 'Vyplaceno', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100' },
  rejected: { label: 'Zamítnuto', icon: XCircle, color: 'text-red-500', bg: 'bg-red-100' }
};

const taskStatusConfig = {
  'Nové': { color: 'bg-blue-100 text-blue-800' },
  'V řešení': { color: 'bg-yellow-100 text-yellow-800' },
  'Hotovo': { color: 'bg-green-100 text-green-800' },
};

const orderStatusConfig = {
  pending: { label: 'Čeká na potvrzení', icon: CircleDot, color: 'text-orange-500' },
  confirmed: { label: 'Potvrzeno', icon: CircleCheck, color: 'text-green-500' },
  expired: { label: 'Vypršelo', icon: CalendarX, color: 'text-red-500' },
};

const CertificationDialog = ({ isOpen, onClose, onSave, certification, memberId }) => {
  const [formData, setFormData] = useState({
    name: '', issuer: '', certificate_number: '', issue_date: '', expiry_date: ''
  });
  const [file, setFile] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (certification) {
      setFormData({
        name: certification.name || '',
        issuer: certification.issuer || '',
        certificate_number: certification.certificate_number || '',
        issue_date: certification.issue_date || '',
        expiry_date: certification.expiry_date || ''
      });
      setFile(null);
    } else {
      setFormData({ name: '', issuer: '', certificate_number: '', issue_date: '', expiry_date: '' });
      setFile(null);
    }
  }, [certification, isOpen]);

  const onDrop = useCallback(acceptedFiles => {
    setFile(acceptedFiles[0]);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': [], 'image/*': [] } });

  const handleSubmit = async (e) => {
    e.preventDefault();
    let filePath = certification?.file_path;

    if (file) {
      const fileName = `${memberId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('member-certifications')
        .upload(fileName, file);

      if (uploadError) {
        toast({ title: 'Chyba při nahrávání souboru', variant: 'destructive', description: uploadError.message });
        return;
      }
      filePath = fileName;
    }

    const dataToSave = { ...formData, member_id: memberId, file_path: filePath };
    if (dataToSave.issue_date === '') dataToSave.issue_date = null;
    if (dataToSave.expiry_date === '') dataToSave.expiry_date = null;

    onSave(dataToSave);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{certification ? 'Upravit' : 'Přidat'} certifikaci</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Název certifikace *" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
          <Input placeholder="Vydavatel" value={formData.issuer} onChange={e => setFormData({ ...formData, issuer: e.target.value })} />
          <Input placeholder="Číslo certifikátu" value={formData.certificate_number} onChange={e => setFormData({ ...formData, certificate_number: e.target.value })} />
          <div><Label>Datum vydání</Label><Input type="date" value={formData.issue_date} onChange={e => setFormData({ ...formData, issue_date: e.target.value })} /></div>
          <div><Label>Datum expirace</Label><Input type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} /></div>

          <div {...getRootProps()} className={`p-6 border-2 border-dashed rounded-lg text-center cursor-pointer ${isDragActive ? 'border-purple-500 bg-purple-50' : ''}`}>
            <input {...getInputProps()} />
            {file ? <p>{file.name}</p> : <p>Přetáhněte soubor nebo klikněte pro výběr</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
            <Button type="submit">Uložit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};


const MemberDetail = () => {
  const { memberId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const [member, setMember] = useState(null);
  const [projects, setProjects] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [orders, setOrders] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [isCertDialogOpen, setIsCertDialogOpen] = useState(false);
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
  const [isMessageDialogOpen, setIsMessageDialogOpen] = useState(false);
  const [editingCert, setEditingCert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [certToDelete, setCertToDelete] = useState(null);
  const [isDeleteMemberAlertOpen, setIsDeleteMemberAlertOpen] = useState(false);


  const canEdit = useMemo(() => hasPermission('members', 'can_edit'), [hasPermission]);
  const canAdmin = useMemo(() => hasPermission('members', 'can_admin'), [hasPermission]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .select('*, member_roles(name)')
      .eq('id', memberId)
      .single();

    if (memberError || !memberData) {
      toast({ title: 'Chyba při načítání projektanta', variant: 'destructive' });
      setLoading(false);
      return;
    }
    setMember(memberData);

    const { data: projectAssignments, error: projectError } = await supabase
      .from('project_members')
      .select('*, project:projects(*, project_subcontractors(price))')
      .eq('member_id', memberId);

    if (!projectError) setProjects(projectAssignments.filter(Boolean));

    const { data: payoutsData, error: payoutsError } = await supabase
      .from('payouts')
      .select('*, payout_items(*, projects(name), realizations:realizations!payout_items_realizace_id_fkey(name), realization:realizations!payout_items_realization_id_fkey(name))')
      .eq('member_id', memberId)
      .order('request_date', { ascending: false });
    if (payoutsError) {
      toast({ title: 'Chyba při načítání výplat', variant: 'destructive', description: payoutsError.message });
    } else {
      setPayouts(payoutsData);
    }

    const { data: tasksData, error: tasksError } = await supabase.from('project_tasks').select('*, projects(name)').eq('member_id', memberId).order('end_date', { ascending: true });
    if (!tasksError) setTasks(tasksData);

    const { data: ordersData, error: ordersError } = await supabase.from('project_orders').select('*, projects(*)').eq('member_id', memberId).order('created_at', { ascending: false });
    if (!ordersError) setOrders(ordersData);

    const { data: certsData, error: certsError } = await supabase.from('member_certifications').select('*').eq('member_id', memberId).order('expiry_date');
    if (!certsError) setCertifications(certsData);

    setLoading(false);
  }, [memberId, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getProjectReward = (projectAssignment) => {
    if (!projectAssignment || !projectAssignment.project || projectAssignment.reward_type === null) return 0;
    return calculateProjectMemberRewardFromProject(projectAssignment);
  };

  const getOrderPrice = (order) => {
    const projectAssignment = projects.find(p => p.project_id === order.project_id);
    return getProjectReward(projectAssignment);
  };

  const getPaidAmount = (projectId) => {
    let totalPaid = 0;
    payouts.forEach(payout => {
      if (payout.status === 'paid') {
        payout.payout_items.forEach(item => {
          if (item.project_id === projectId) {
            totalPaid += parseFloat(item.amount) || 0;
          }
        });
      }
    });
    return totalPaid;
  };

  const getRemainingReward = (projectAssignment) => {
    if (!projectAssignment || !projectAssignment.project) return 0;
    const totalReward = getProjectReward(projectAssignment);
    const paidAmount = getPaidAmount(projectAssignment.project_id);
    return totalReward - paidAmount;
  };

  const getTotalRewards = () => {
    return projects.reduce((sum, pa) => sum + getProjectReward(pa), 0);
  };

  const getTotalPaid = () => {
    return payouts
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  };

  const getTotalRemaining = () => {
    return getTotalRewards() - getTotalPaid();
  };

  const payoutItemsSummary = useMemo(() => {
    const rows = [];
    payouts.forEach((payout) => {
      const payoutDate = payout.request_date ? format(new Date(payout.request_date), 'MM.yyyy') : '-';
      payout.payout_items.forEach((item) => {
        const name = item.projects?.name || item.realizations?.name || item.realization?.name || 'N/A';
        rows.push({
          key: `${payout.id}-${item.project_id || item.realization_id || item.realizace_id}`,
          name,
          type: item.project_id ? 'Projekt' : 'Realizace',
          period: payoutDate,
          amount: parseFloat(item.amount) || 0,
          status: payout.status,
        });
      });
    });
    return rows;
  }, [payouts]);

  const handleSaveCertification = async (certData) => {
    const dataToUpsert = { ...certData };
    if (editingCert) {
      dataToUpsert.id = editingCert.id;
    }

    const { error } = await supabase.from('member_certifications').upsert(dataToUpsert);
    if (error) {
      toast({ title: 'Chyba při ukládání certifikace', variant: 'destructive', description: error.message });
    } else {
      toast({ title: '✅ Certifikace uložena' });
      setIsCertDialogOpen(false);
      setEditingCert(null);
      fetchData();
    }
  };

  const handleDeleteCertification = async (certId) => {
    const { error } = await supabase.from('member_certifications').delete().eq('id', certId);
    if (error) {
      toast({ title: 'Chyba při mazání certifikace', variant: 'destructive' });
    } else {
      toast({ title: '🗑️ Certifikace smazána' });
      fetchData();
    }
    setCertToDelete(null);
  };

  const handleSaveMember = async (memberData) => {
    const { error } = await supabase.from('members').update(memberData).eq('id', memberId);
    if (error) {
      toast({ title: "Chyba při úpravě projektanta", variant: "destructive", description: error.message });
    } else {
      toast({ title: "✅ Projektant upraven!" });
      fetchData();
    }
    setIsMemberDialogOpen(false);
  };

  const handleDeleteMember = async () => {
    if (!canAdmin) return;
    const { error } = await supabase.from('members').delete().eq('id', memberId);
    if (error) {
      toast({ title: "Chyba při mazání projektanta", variant: "destructive" });
    } else {
      toast({ title: "🗑️ Projektant smazán." });
      navigate('/members');
    }
  };

  const handleSendMessage = async ({ subject, message }) => {
    if (!member?.email) {
      toast({ title: 'Projektant nemá zadaný email.', variant: 'destructive' });
      return;
    }

    try {
      await sendEmail({
        to: member.email,
        subject,
        greeting: `Dobrý den, ${member.name},`,
        content: `<p>Obdrželi jste novou zprávu od ${user.user_metadata.full_name || user.email}:</p>
                       <p style="margin: 20px 0; padding: 15px; background-color: #f2f5f7; border-left: 4px solid #3b82f6; color: #333;">
                         ${message.replace(/\n/g, '<br>')}
                       </p>`,
        salutation: `S pozdravem,<br>${user.user_metadata.full_name || user.email}`
      });

      toast({ title: '✅ Zpráva odeslána!' });
      setIsMessageDialogOpen(false);
    } catch (error) {
      toast({ title: 'Chyba při odesílání zprávy', description: error.message, variant: 'destructive' });
    }
  };

  const copyOrderLink = (token) => {
    const orderUrl = `${window.location.origin}/order/${token}`;
    navigator.clipboard.writeText(orderUrl);
    toast({ title: '✅ Odkaz na objednávku zkopírován!' });
  };

  const handleDownloadCertificate = async (filePath) => {
    const { data, error } = await supabase.storage.from('member-certifications').download(filePath);
    if (error) {
      toast({ title: 'Chyba stahování', description: error.message, variant: 'destructive' });
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="text-center py-12">Načítání...</div>;
  if (!member) return <div className="text-center py-12">Projektant nenalezen.</div>;

  const getCertRowClass = (expiryDate) => {
    if (!expiryDate) return '';
    const days = differenceInDays(parseISO(expiryDate), new Date());
    if (days < 0) return 'bg-red-100 text-red-800';
    if (days <= 30) return 'bg-yellow-100 text-yellow-800';
    return '';
  };

  return (
    <div className="app-page">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <Link to="/members" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary mb-4">
            <ChevronLeft className="w-4 h-4" /> Zpět na projektanty
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
            <User className="w-8 h-8" />
            {member.name}
          </h1>
          <p className="text-muted-foreground">Detailní přehled projektanta, jeho projektů, financí a certifikací.</p>
        </div>
        <div className="flex-shrink-0 flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {canEdit && <Button variant="outline" onClick={() => setIsMessageDialogOpen(true)} className="w-full sm:w-auto"><MessageSquare className="w-4 h-4 mr-2" />Poslat zprávu</Button>}
          {canEdit && <Button onClick={() => setIsMemberDialogOpen(true)} className="w-full sm:w-auto"><Edit2 className="w-4 h-4 mr-2" />Upravit</Button>}
          {canAdmin && (
            <Button variant="destructive" onClick={() => setIsDeleteMemberAlertOpen(true)} className="w-full sm:w-auto"><Trash2 className="w-4 h-4 mr-2" />Smazat</Button>
          )}
        </div>
      </motion.div>

      <Tabs defaultValue="overview" className="w-full">
        <div className="glass-effect rounded-xl p-2 mb-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
            <TabsTrigger value="overview">Základní info</TabsTrigger>
            <TabsTrigger value="tasks">Úkoly</TabsTrigger>
            <TabsTrigger value="orders">Objednávky</TabsTrigger>
            <TabsTrigger value="certifications">Certifikace</TabsTrigger>
            <TabsTrigger value="projects">Finance</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="glass-effect rounded-xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <InfoItem label="Pracovní role / pozice" value={member.member_roles ? member.member_roles.name : 'Není nastaveno'} />
            <InfoItem label="Email" value={member.email} />
            <InfoItem label="Telefon" value={member.phone} />
            <InfoItem label="Hodinová sazba">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-600" />
                <p className="font-semibold text-lg">
                  {member.hourly_rate ? `${member.hourly_rate.toLocaleString('cs-CZ')} Kč/h` : 'Není nastavena'}
                </p>
              </div>
            </InfoItem>
            <InfoItem label="Docházka">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <p className="font-semibold">
                  {member.attendance_enabled ? 'Aktivní' : 'Neaktivní'}
                </p>
              </div>
            </InfoItem>
            <InfoItem label="Jazyky">
              <p className="font-semibold">{(member.languages || []).join(', ') || '-'}</p>
            </InfoItem>
            <div className="lg:col-span-3">
              <InfoItem label="Interní poznámka / Dostupnost" value={member.internal_note} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="glass-effect rounded-xl p-6">
          <DetailSection title="Přiřazené úkoly" icon={ListTodo} contentClassName="max-h-96 overflow-y-auto pr-2">
            {tasks.length > 0 ? (
              <Table>
                <TableHeader><TableRow><TableHead>Úkol</TableHead><TableHead>Projekt</TableHead><TableHead>Termín</TableHead><TableHead>Stav</TableHead></TableRow></TableHeader>
                <TableBody>
                  {tasks.map(task => {
                    const isTaskPast = isPast(new Date(task.end_date)) && task.status !== 'Hotovo';
                    return (
                      <TableRow key={task.id}>
                        <TableCell className="font-bold">{task.name}</TableCell>
                        <TableCell><Link to={`/projects/${task.project_id}`} className="hover:text-purple-600">{task.projects?.name || 'N/A'}</Link></TableCell>
                        <TableCell>
                          {format(new Date(task.end_date), 'd.M.yyyy')}
                          {isTaskPast && <span className="text-xs font-semibold text-red-500 ml-2">(Po termínu)</span>}
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 inline-block rounded-full text-xs font-medium border ${taskStatusConfig[task.status]?.color}`}>
                            {task.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : <p className="text-muted-foreground text-center py-4">Žádné přiřazené úkoly.</p>}
          </DetailSection>
        </TabsContent>

        <TabsContent value="orders" className="glass-effect rounded-xl p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4"><ClipboardList className="w-5 h-5 gradient-text" />Historie objednávek</h3>
          {orders.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Projekt</TableHead><TableHead>Cena</TableHead><TableHead>Vytvořeno</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.map(order => {
                  const config = orderStatusConfig[order.status] || {};
                  const Icon = config.icon || AlertTriangle;
                  return (
                    <TableRow key={order.id}>
                      <TableCell><Link to={`/projects/${order.project_id}`} className="font-medium hover:text-purple-600">{order.projects?.name || 'N/A'}</Link></TableCell>
                      <TableCell>{getOrderPrice(order).toLocaleString('cs-CZ')} Kč</TableCell>
                      <TableCell>{format(parseISO(order.created_at), 'd.M.yyyy')}</TableCell>
                      <TableCell><div className={`inline-flex items-center gap-2 text-sm font-medium ${config.color}`}><Icon className="w-4 h-4" />{config.label}</div></TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => copyOrderLink(order.unique_token)}><Copy className="w-4 h-4" /></Button></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : <p className="text-muted-foreground text-center py-4">Žádné objednávky.</p>}
        </TabsContent>

        <TabsContent value="certifications" className="glass-effect rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2"><Award className="w-5 h-5 gradient-text" /> Certifikace a oprávnění</h3>
            {canEdit && <Button onClick={() => { setEditingCert(null); setIsCertDialogOpen(true); }}><Plus className="w-4 h-4 mr-2" />Přidat</Button>}
          </div>
          {certifications.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Název</TableHead><TableHead>Expirace</TableHead><TableHead>Akce</TableHead></TableRow></TableHeader>
              <TableBody>
                {certifications.map(cert => (
                  <TableRow key={cert.id} className={getCertRowClass(cert.expiry_date)}>
                    <TableCell>
                      <p className="font-bold">{cert.name}</p>
                      <p className="text-xs">{cert.issuer} ({cert.certificate_number})</p>
                    </TableCell>
                    <TableCell>{cert.expiry_date ? format(parseISO(cert.expiry_date), 'd.M.yyyy') : '-'}</TableCell>
                    <TableCell className="flex gap-1">
                      {cert.file_path && <Button variant="ghost" size="icon" onClick={() => handleDownloadCertificate(cert.file_path)}><Download className="w-4 h-4" /></Button>}
                      {canEdit && <Button variant="ghost" size="icon" onClick={() => { setEditingCert(cert); setIsCertDialogOpen(true); }}><Edit2 className="w-4 h-4" /></Button>}
                      {canEdit && <Button variant="ghost" size="icon" onClick={() => setCertToDelete(cert.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-muted-foreground text-center py-4">Žádné certifikace nebyly přidány.</p>}
        </TabsContent>

        <TabsContent value="projects" className="space-y-6">
          {/* Finanční přehled */}
          <div className="glass-effect rounded-xl p-6">
            <DetailSection title="Finanční přehled" icon={DollarSign}>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-5 h-5 text-purple-600" />
                    <span className="text-sm font-medium text-purple-800">Hodinová sazba</span>
                  </div>
                  <p className="text-2xl font-bold text-purple-900">
                    {member.hourly_rate ? `${member.hourly_rate.toLocaleString('cs-CZ')} Kč/h` : 'Není nastavena'}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Briefcase className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">Celkové odměny (fix)</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-900">{getTotalRewards().toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium text-green-800">Vyplaceno</span>
                  </div>
                  <p className="text-2xl font-bold text-green-900">{getTotalPaid().toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-5 h-5 text-orange-600" />
                    <span className="text-sm font-medium text-orange-800">Zbývající odměna</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-900">{getTotalRemaining().toLocaleString('cs-CZ')} Kč</p>
                </div>
              </div>
            </DetailSection>
          </div>

          {/* Projekty s detailními informacemi */}
          <div className="glass-effect rounded-xl p-6">
            <DetailSection title="Přiřazené projekty" icon={Briefcase} contentClassName="max-h-96 overflow-y-auto pr-2">
              {projects.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Projekt</TableHead>
                      <TableHead>Stav</TableHead>
                      <TableHead className="text-right">Celková odměna</TableHead>
                      <TableHead className="text-right">Vyplaceno</TableHead>
                      <TableHead className="text-right">Zbývající odměna</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map(pa => {
                      if (!pa.project) return null;
                      const totalReward = getProjectReward(pa);
                      const paidAmount = getPaidAmount(pa.project_id);
                      const remainingReward = getRemainingReward(pa);
                      return (
                        <TableRow key={pa.project.id}>
                          <TableCell>
                            <Link to={`/projects/${pa.project.id}`} className="font-medium hover:text-purple-600">
                              {pa.project.name}
                            </Link>
                            <div className="text-xs text-muted-foreground">{pa.project.code}</div>
                          </TableCell>
                          <TableCell>
                            <div className={`px-2 py-1 inline-block rounded-full text-xs font-medium border ${projectStatusConfig[pa.project.status]?.color}`}>
                              {projectStatusConfig[pa.project.status]?.label}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {totalReward > 0 ? totalReward.toLocaleString('cs-CZ') + ' Kč' : 'N/A'}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={paidAmount > 0 ? "text-green-600 font-semibold" : "text-muted-foreground"}>
                              {paidAmount.toLocaleString('cs-CZ')} Kč
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={remainingReward > 0 ? "text-orange-600 font-semibold" : remainingReward < 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                              {remainingReward.toLocaleString('cs-CZ')} Kč
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : <p className="text-muted-foreground text-center py-4">Žádné přiřazené projekty.</p>}
            </DetailSection>
          </div>

          {/* Historie výplat */}
          <div className="glass-effect rounded-xl p-6">
            <DetailSection title="Historie výplat" icon={DollarSign} contentClassName="max-h-96 overflow-y-auto pr-2">
              {payouts.length > 0 ? (
                <div className="space-y-3">
                  {payouts.map(payout => {
                    const config = payoutStatusConfig[payout.status] || {};
                    const Icon = config.icon || AlertTriangle;
                    return (
                      <div key={payout.id} className="bg-white/50 dark:bg-slate-800/50 border p-4 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="font-semibold">Výplata</div>
                              <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${config.bg} ${config.color}`}>
                                <Icon className="w-3 h-3" />
                                {config.label}
                              </div>
                            </div>
                            {payout.payout_items.length > 0 && (
                              <PayoutProjectsPopover items={payout.payout_items} />
                            )}
                            <p className="text-xs text-muted-foreground">
                              Požadavek: {format(new Date(payout.request_date), 'd.M.yyyy')}
                            </p>
                            {payout.reason && (
                              <p className="text-xs text-muted-foreground mt-1 italic">
                                Poznámka: {payout.reason}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-lg gradient-text">
                              {(payout.amount || 0).toLocaleString('cs-CZ')} Kč
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-muted-foreground text-center py-4">Žádné výplaty.</p>}
            </DetailSection>
          </div>

          {/* Výplaty po projektech */}
          <div className="glass-effect rounded-xl p-6">
            <DetailSection title="Výplaty po projektech" icon={Layers} contentClassName="max-h-96 overflow-y-auto pr-2">
              {payoutItemsSummary.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Projekt / realizace</TableHead>
                      <TableHead>Období</TableHead>
                      <TableHead className="text-right">Částka</TableHead>
                      <TableHead>Stav</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payoutItemsSummary.map((row) => {
                      const config = payoutStatusConfig[row.status] || {};
                      const Icon = config.icon || AlertTriangle;
                      return (
                        <TableRow key={row.key}>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">{row.type}</div>
                          </TableCell>
                          <TableCell>{row.period}</TableCell>
                          <TableCell className="text-right">{row.amount.toLocaleString('cs-CZ')} Kč</TableCell>
                          <TableCell>
                            <div className={`inline-flex items-center gap-2 text-xs font-medium ${config.color}`}>
                              <Icon className="w-3 h-3" />
                              {config.label || row.status}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">Žádné položky výplat.</p>
              )}
            </DetailSection>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={isDeleteMemberAlertOpen} onOpenChange={setIsDeleteMemberAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Opravdu smazat projektanta?</AlertDialogTitle>
            <AlertDialogDescription>Tato akce je nevratná a trvale smaže veškerá data spojená s tímto projektantem.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMember} className="bg-red-600 hover:bg-red-700">Smazat</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!certToDelete} onOpenChange={() => setCertToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Opravdu smazat certifikaci?</AlertDialogTitle>
            <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDeleteCertification(certToDelete)}>Smazat</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <CertificationDialog isOpen={isCertDialogOpen} onClose={() => setIsCertDialogOpen(false)} onSave={handleSaveCertification} certification={editingCert} memberId={memberId} />
      <MemberDialog isOpen={isMemberDialogOpen} onClose={() => setIsMemberDialogOpen(false)} onSave={handleSaveMember} member={member} />
      <SendMessageDialog isOpen={isMessageDialogOpen} onClose={() => setIsMessageDialogOpen(false)} onSend={handleSendMessage} memberName={member.name} />
    </div>
  );
};

export default MemberDetail;
