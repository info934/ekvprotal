import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, DollarSign, Send, CheckCircle, AlertCircle, FileText, Trash2, CalendarDays, FileWarning, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { sendHourlyPayoutRequestEmail } from '@/lib/email';
import { sendPayoutRequestEmail } from '@/lib/email';
import { format, startOfMonth, getMonth, getYear } from 'date-fns';
import { cs } from 'date-fns/locale';
import InvoiceUpload from './InvoiceUpload';
import InvoicePreview from './InvoicePreview';
import DeletePayoutRequestDialog from './DeletePayoutRequestDialog';
import MonthSelector from './MonthSelector';
import HoursTable from './HoursTable';
import { auditInvoiceUrls } from '@/lib/invoiceAudit';

const getStatusBadge = (status) => {
  switch (status) {
    case 'pending': return <Badge variant="warning" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-none">Čeká na schválení</Badge>;
    case 'approved': return <Badge variant="success" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">Schváleno</Badge>;
    case 'paid': return <Badge variant="info" className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none">Vyplaceno</Badge>;
    case 'rejected': return <Badge variant="destructive">Zamítnuto</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
};

const HourlyPayoutRequest = ({ onPayoutRequested }) => {
  const { memberId } = useAuth();
  const { toast } = useToast();
  
  const [myRequests, setMyRequests] = useState([]);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()).toISOString());
  const [monthData, setMonthData] = useState({ records: [], totalHours: 0, breakdown: {} });
  const [deleteRequestId, setDeleteRequestId] = useState(null);
  const [isDeletingRequest, setIsDeletingRequest] = useState(false);

  const fetchBaseData = async () => {
    if (!memberId) return;
    setLoading(true);
    try {
      const { data: memberData } = await supabase.from('members').select('*').eq('id', memberId).single();
      setMember(memberData);
      
      // FIXED: Explicit FK reference for hourly_payout_requests
      const { data: requestsData } = await supabase
        .from('hourly_payout_requests')
        .select('*, projects(name)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
        
      setMyRequests(requestsData || []);
    } catch (error) {
      toast({ title: "Chyba načítání dat", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBaseData(); }, [memberId]);

  const grandTotalHours = monthData.totalHours;
  const grandTotalAmount = grandTotalHours * (member?.hourly_rate || 0);

  const handleRequestPayout = async () => {
    if (grandTotalHours <= 0) return;
    setIsSubmitting(true);
    try {
      const targetDate = new Date(selectedMonth);
      const payload = {
        member_id: memberId,
        project_id: null,
        hours: grandTotalHours,
        hourly_rate: member?.hourly_rate || 0,
        total_amount: grandTotalAmount,
        status: 'pending',
        notes: `Vygenerováno z docházky za ${format(targetDate, 'LLLL yyyy', { locale: cs })}`,
        payout_month: getMonth(targetDate) + 1,
        payout_year: getYear(targetDate),
        total_hours: grandTotalHours,
        breakdown: monthData.breakdown
      };

      const { error, data } = await supabase.from('hourly_payout_requests').insert([payload]).select().single();
      if (error) throw error;

      await sendHourlyPayoutRequestEmail({
        memberName: member?.name || 'Neznámý', hours: grandTotalHours, projects: Object.keys(monthData.breakdown).join(', ') || 'Všechny projekty',
        totalAmount: grandTotalAmount, createdAt: new Date().toISOString()
      });
      
      // Also send member notification
      await sendPayoutRequestEmail({ memberId, amount: grandTotalAmount });

      toast({ title: "Žádost odeslána", description: `Emaily odeslány.` });
      fetchBaseData();
      if (onPayoutRequested) onPayoutRequested();
    } catch (error) {
      toast({ title: "Chyba", description: "Nepodařilo se odeslat žádost.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = async (id) => {
      setIsDeletingRequest(true);
      try {
          await supabase.from('hourly_payout_requests').delete().eq('id', id);
          toast({ title: "Žádost byla smazána" });
          fetchBaseData();
          if (onPayoutRequested) onPayoutRequested();
      } catch (error) { toast({ title: "Chyba", variant: "destructive" }); } finally { setIsDeletingRequest(false); setDeleteRequestId(null); }
  };
  
  const handleRunAudit = async () => {
      const result = await auditInvoiceUrls();
      if (result.success) toast({ title: "Audit dokončen", variant: result.warnings > 0 ? "warning" : "default" });
  };

  if (loading) return <div className="p-8 text-center"><Clock className="w-8 h-8 mx-auto mb-4 text-muted-foreground animate-spin" /> Načítání...</div>;
  if (!member?.hourly_rate || member.hourly_rate <= 0) return <Card className="max-w-2xl mx-auto mt-8"><CardContent className="p-12 text-center"><AlertCircle className="w-12 h-12 text-yellow-500 mb-4 mx-auto" /><h3 className="text-xl font-bold mb-2">Nemáte nastavenou hodinovou sazbu</h3></CardContent></Card>;

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">Nová žádost za měsíc</h2>
            {member?.user_role === 'admin' && <Button variant="outline" size="sm" onClick={handleRunAudit} className="gap-2 text-xs"><Search className="w-3.5 h-3.5" /> Audit URL</Button>}
        </div>
        <Card className="shadow-md border-slate-200">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4"><MonthSelector value={selectedMonth} onChange={setSelectedMonth} /></CardHeader>
            <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><div className="bg-primary/5 border border-primary/20 rounded-xl p-4 h-full"><h3 className="text-sm font-medium text-primary flex items-center gap-2 mb-2"><Clock className="w-4 h-4" /> Hodiny</h3><div className="text-3xl font-bold text-gray-900">{grandTotalHours.toFixed(1)} h</div></div></motion.div>
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}><div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 h-full"><h3 className="text-sm font-medium text-emerald-700 flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4" /> K proplacení</h3><div className="text-3xl font-bold text-emerald-700">{grandTotalAmount.toLocaleString('cs-CZ')} Kč</div></div></motion.div>
                </div>
                <div className="space-y-4">
                    <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-slate-500" /> Detail hodin</h3>
                    <HoursTable selectedMonth={selectedMonth} memberId={memberId} onDataFetched={setMonthData} />
                </div>
            </CardContent>
            <CardFooter className="bg-slate-50 border-t border-slate-100 p-4 flex justify-end">
                <Button onClick={handleRequestPayout} disabled={grandTotalHours <= 0 || isSubmitting} className="shadow-sm hover:shadow-md transition-all gap-2">{isSubmitting ? <Clock className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Odeslat žádost</Button>
            </CardFooter>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mt-8"><FileText className="w-5 h-5 text-primary" /> Moje žádosti</h2>
        {myRequests.length === 0 ? (
            <Card className="bg-slate-50 border-dashed border-2"><CardContent className="p-8 text-center text-slate-500">Zatím nemáte žádné žádosti.</CardContent></Card>
        ) : (
            <div className="grid gap-4">
                {myRequests.map(req => (
                    <Card key={req.id} className="overflow-hidden shadow-sm hover:shadow transition-shadow">
                        <div className="p-5 flex flex-col md:flex-row gap-6 md:items-center justify-between">
                            <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-3 flex-wrap"><span className="text-sm text-slate-500">{format(new Date(req.created_at), 'dd. MM. yyyy', { locale: cs })}</span>{getStatusBadge(req.status)}{req.approved_without_invoice && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><FileWarning className="w-3 h-3 mr-1" />Bez faktury</Badge>}</div>
                                <h3 className="font-semibold text-lg text-slate-800">{req.payout_month ? `Žádost za ${req.payout_month}/${req.payout_year}` : req.projects?.name}</h3>
                                <div className="flex items-center gap-4 text-sm text-slate-600"><span className="flex items-center gap-1"><Clock className="w-4 h-4"/> {(req.total_hours || req.hours)} h</span><span className="flex items-center gap-1 font-medium text-slate-900"><DollarSign className="w-4 h-4 text-primary"/> {req.total_amount.toLocaleString('cs-CZ')} Kč</span></div>
                                {req.status === 'rejected' && <div className="mt-2 space-y-2"><Button variant="outline" size="sm" onClick={() => setDeleteRequestId(req.id)}><Trash2 className="w-4 h-4 mr-2" /> Smazat</Button></div>}
                            </div>
                            <div className="w-full md:w-1/2 max-w-sm shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                                {req.status === 'approved' && !req.invoice_url && !req.approved_without_invoice && <InvoiceUpload requestId={req.id} memberId={memberId} onUploadSuccess={() => fetchBaseData()} />}
                                {req.invoice_url && <InvoicePreview invoicePath={req.invoice_url} uploadedAt={req.invoice_uploaded_at} status={req.status} requestId={req.id} onDelete={() => fetchBaseData()} />}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        )}
      </div>
      <DeletePayoutRequestDialog isOpen={!!deleteRequestId} onClose={() => setDeleteRequestId(null)} onConfirm={handleDeleteRequest} requestId={deleteRequestId} isLoading={isDeletingRequest} />
    </div>
  );
};
export default HourlyPayoutRequest;