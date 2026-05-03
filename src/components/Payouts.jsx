import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, Plus, CheckCircle, XCircle, Clock, Eye, Edit2, Trash2, AlertTriangle,
  CheckCircle2, XCircle as XCircleIcon, Upload, FileText, Check, FileDown, Hash,
  LayoutGrid, List, TrendingUp, Target, BarChart3, Users, Calendar, Filter,
  MoreHorizontal, RefreshCw, Zap, Award, Timer, Search, ArrowUpDown, Layers, Wallet, PiggyBank, Settings, FileWarning
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PayoutDialog from '@/components/PayoutDialog';
import { useToast } from '@/components/ui/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import HourlyPayoutRequest from '@/components/HourlyPayoutRequest';
import PayoutTableHistory from '@/components/PayoutTable'; 
import HourlyPayoutRequestsAdmin from '@/components/HourlyPayoutRequestsAdmin';
import AdminPayoutApprovalDialog from '@/components/AdminPayoutApprovalDialog';
import { approvePayout } from '@/lib/PayoutApprovalService';
import { sendPayoutRejectionEmail, sendPayoutPaidEmail } from '@/lib/email';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import PageHeader from '@/components/ui/page-header';

const Badge = ({ children, variant = "default", className, ...props }) => {
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive/10 text-destructive border border-destructive/20",
    outline: "text-foreground border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200 border",
    warning: "bg-amber-50 text-amber-700 border-amber-200 border",
    info: "bg-blue-50 text-blue-700 border-blue-200 border"
  };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors", variants[variant], className)} {...props}>{children}</span>;
};

const Card = ({ children, className, ...props }) => <div className={cn("rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200", className)} {...props}>{children}</div>;
const CardContent = ({ children, className, ...props }) => <div className={cn("p-6 pt-0", className)} {...props}>{children}</div>;

const StatCard = ({ icon: Icon, title, value, subtitle, color = "text-blue-600", bg = "bg-blue-50", className, ...props }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4, shadow: "lg" }} className={cn("bg-white border rounded-xl p-6 transition-all duration-200 shadow-sm", className)} {...props}>
    <div className="flex items-start justify-between mb-4">
      <div className="space-y-1.5"><h3 className="font-medium text-sm text-muted-foreground">{title}</h3><p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p></div>
      <div className={cn("p-3 rounded-lg", bg, color)}><Icon className="w-5 h-5" /></div>
    </div>
    {subtitle && <div className="flex items-center text-sm text-muted-foreground">{subtitle}</div>}
  </motion.div>
);

const DropdownMenu = ({ children }) => { const [isOpen, setIsOpen] = useState(false); return <div className="relative">{React.Children.map(children, child => child.type === DropdownMenuTrigger ? React.cloneElement(child, { isOpen, setIsOpen }) : child.type === DropdownMenuContent ? React.cloneElement(child, { isOpen, setIsOpen }) : child)}</div>; };
const DropdownMenuTrigger = ({ children, asChild, isOpen, setIsOpen, ...props }) => { const handleClick = (e) => { e.stopPropagation(); setIsOpen(!isOpen); }; if (asChild) return React.cloneElement(children, { onClick: handleClick, ...props }); return <button onClick={handleClick} {...props}>{children}</button>; };
const DropdownMenuContent = ({ children, align = "center", className, isOpen, setIsOpen, ...props }) => { if (!isOpen) return null; return <><div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} /><div className={cn("absolute z-50 min-w-[8rem] overflow-hidden rounded-lg border bg-white p-1.5 text-gray-900 shadow-lg animate-in fade-in zoom-in-95", align === "end" && "right-0", className)} {...props}>{React.Children.map(children, child => child.type === DropdownMenuItem ? React.cloneElement(child, { setIsOpen }) : child)}</div></>; };
const DropdownMenuItem = ({ children, className, setIsOpen, ...props }) => <div className={cn("relative flex cursor-pointer select-none items-center rounded-md px-2 py-2 text-sm outline-none transition-colors hover:bg-slate-100 focus:bg-slate-100", className)} onClick={(e) => { e.stopPropagation(); if (props.onClick) props.onClick(e); setIsOpen(false); }} {...props}>{children}</div>;

const statusConfig = {
  pending: { label: 'Čeká na schválení', icon: AlertTriangle, variant: 'warning' },
  approved: { label: 'Čeká na fakturu', icon: Upload, variant: 'info' },
  invoice_uploaded: { label: 'Faktura nahrána', icon: FileText, variant: 'secondary' },
  paid: { label: 'Vyplaceno', icon: CheckCircle2, variant: 'success' },
  rejected: { label: 'Zamítnuto', icon: XCircleIcon, variant: 'destructive' }
};

const PayoutProjectsPopover = ({ items }) => (
  <Popover>
    <PopoverTrigger asChild><Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground hover:text-primary"><Layers className="w-3.5 h-3.5 mr-1.5" />{items.length} položek</Button></PopoverTrigger>
    <PopoverContent className="w-80 p-4 shadow-xl border-slate-200 rounded-xl">
      <div className="space-y-3"><h4 className="font-semibold text-sm border-b pb-2">Zahrnuté položky</h4><div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">{items.map(item => <div key={item.id || `${item.project_id || ''}-${item.realization_id || ''}`} className="flex justify-between items-center text-sm group"><span className="text-slate-600 truncate pr-3 group-hover:text-slate-900 transition-colors">{item.projects?.name || item.realizations?.name || 'N/A'}</span><span className="font-medium whitespace-nowrap text-slate-900">{parseFloat(item.amount).toLocaleString('cs-CZ')} Kč</span></div>)}</div></div>
    </PopoverContent>
  </Popover>
);

const PayoutCard = ({ payout, onUpdateStatus, onDelete, onEdit, onApproveWithDialog, onUploadInvoice, onDownloadInvoice, canAdmin, canEditOwn }) => {
  const config = statusConfig[payout.status] || { icon: AlertTriangle, label: 'Neznámý stav', variant: 'outline' };
  const Icon = config.icon;
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const handleFileSelect = () => fileInputRef.current.click();
  const handleFileChange = (event) => { const file = event.target.files[0]; if (file) onUploadInvoice(payout.id, file); };
  const isOwner = user?.id === payout.members?.auth_user_id;

  return (
    <Card className="group hover:shadow-md hover:border-primary/30 transition-all duration-300 flex flex-col bg-white">
      <CardContent className="p-5 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-5 gap-2">
          <div className="space-y-1"><h3 className="font-semibold text-base text-slate-800 line-clamp-1" title={payout.members?.name}>{payout.members?.name || 'N/A'}</h3><div className="text-sm">{payout.payout_items?.length > 0 ? <PayoutProjectsPopover items={payout.payout_items} /> : <span className="text-muted-foreground text-xs">Žádné projekty</span>}</div></div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant={config.variant} className="shadow-sm"><Icon className="w-3 h-3 mr-1.5" />{config.label}</Badge>
            {payout.approved_without_invoice && <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 mt-1 shadow-sm text-[10px]"><FileWarning className="w-3 h-3 mr-1" />Bez faktury</Badge></TooltipTrigger><TooltipContent>Schváleno bez nutnosti doložení faktury.{payout.admin_note && <div className="mt-1 italic border-t border-amber-200 pt-1">"{payout.admin_note}"</div>}</TooltipContent></Tooltip></TooltipProvider>}
          </div>
        </div>
        <div className="mb-5 flex-1">
          <div className="text-2xl font-bold tracking-tight text-slate-900 mb-1.5">{parseFloat(payout.amount).toLocaleString('cs-CZ')} <span className="text-lg text-muted-foreground font-medium">Kč</span></div>
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Vytvořeno {new Date(payout.request_date).toLocaleDateString('cs-CZ')}</div>
        </div>
        <div className="space-y-3 mb-5">
          {payout.variable_symbol && <div className="flex items-center gap-2.5 p-2.5 bg-slate-50/80 border border-slate-100 rounded-lg text-sm"><Hash className="w-4 h-4 text-slate-400" /><span className="text-slate-600">VS: <span className="font-semibold text-slate-900 select-all">{payout.variable_symbol}</span></span></div>}
          {payout.invoice_name && <Button variant="outline" size="sm" onClick={() => onDownloadInvoice(payout.invoice_url, payout.invoice_name)} className="w-full justify-start gap-2.5 bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"><FileDown className="w-4 h-4 text-primary" /><span className="truncate">{payout.invoice_name}</span></Button>}
        </div>
        <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-auto">
          <div className="flex gap-2">
             {canAdmin && payout.status === 'pending' && (
              <><Button variant="ghost" size="icon" title="Schválit" className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => onApproveWithDialog(payout)}><CheckCircle className="w-4 h-4" /></Button><Button variant="ghost" size="icon" title="Zamítnout" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onUpdateStatus(payout.id, 'rejected', payout)}><XCircle className="w-4 h-4" /></Button></>
            )}
            {payout.status === 'approved' && (
              <>
                {isOwner && !payout.approved_without_invoice && <><input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf,.doc,.docx,.jpg,.png" /><Button onClick={handleFileSelect} size="sm" className="shadow-sm"><Upload className="w-3.5 h-3.5 mr-2" /> Nahrát</Button></>}
                {canAdmin && <Button onClick={() => onUpdateStatus(payout.id, 'paid', payout)} size="sm" variant="secondary" className="shadow-sm"><Check className="w-3.5 h-3.5 mr-2" /> Vyplaceno</Button>}
              </>
            )}
             {canAdmin && payout.status === 'invoice_uploaded' && <Button onClick={() => onUpdateStatus(payout.id, 'paid', payout)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"><Check className="w-3.5 h-3.5 mr-2" /> Vyplaceno</Button>}
          </div>
          {(canAdmin || (isOwner && payout.status === 'pending' && canEditOwn)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onEdit(payout)} className="text-slate-700"><Edit2 className="w-4 h-4 mr-2 text-slate-400" />Upravit</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(payout.id)} className="text-red-600 focus:text-red-700 focus:bg-red-50"><Trash2 className="w-4 h-4 mr-2" />Smazat</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const Payouts = () => {
  const { toast } = useToast();
  const { memberId, hasPermission, user } = useAuth();
  
  const [payouts, setPayouts] = useState([]);
  const [hourlyRequests, setHourlyRequests] = useState([]);
  const [memberInfo, setMemberInfo] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalPayout, setApprovalPayout] = useState(null);

  const [view, setView] = useState('pending');
  const [displayMode, setDisplayMode] = useState('cards');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [withoutInvoiceFilter, setWithoutInvoiceFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  const canAdmin = hasPermission('payouts', 'can_admin');
  const canEditOwn = hasPermission('payouts', 'can_edit');

  useEffect(() => { if(memberId) supabase.from('members').select('*').eq('id', memberId).single().then(({data}) => setMemberInfo(data)); }, [memberId]);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      // FIXED: Explicit foreign key relationships for payouts table
      const { data: fixedData } = await supabase
        .from('payouts')
        .select(`
          *,
          members:members!payouts_member_id_fkey(name, email, auth_user_id),
          approved_member:members!payouts_approved_by_fkey(name, email),
          payout_items(
            *,
            projects(name, code),
            realizations:realizations!payout_items_realization_id_fkey(name)
          )
        `)
        .order('request_date', { ascending: false });
      
      setPayouts(fixedData || []);
      
      // FIXED: Explicit foreign key for hourly requests
      const { data: hourlyData } = await supabase
        .from('hourly_payout_requests')
        .select(`
          *,
          projects(name),
          members:members!hourly_payout_requests_member_id_fkey(name, auth_user_id)
        `)
        .order('created_at', { ascending: false });
      
      setHourlyRequests(hourlyData || []);
    } catch (error) { 
      toast({ title: "Chyba při načítání dat.", description: error.message, variant: "destructive" }); 
    } finally { 
      setLoading(false); 
    }
  }, [toast]);

  useEffect(() => {
    fetchPayouts();
    const channel = supabase.channel('payouts-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, fetchPayouts).on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, fetchPayouts).subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchPayouts]);

  const stats = useMemo(() => {
    const activeFixed = payouts.filter(p => ['pending', 'approved', 'invoice_uploaded'].includes(p.status));
    const paidFixed = payouts.filter(p => p.status === 'paid');
    const activeHourly = hourlyRequests.filter(p => ['pending', 'approved'].includes(p.status));
    const paidHourly = hourlyRequests.filter(p => p.status === 'paid');
    return { 
      totalRequests: payouts.length + hourlyRequests.length, 
      activeCount: activeFixed.length + activeHourly.length,
      paidCount: paidFixed.length + paidHourly.length,
      totalActiveAmount: activeFixed.reduce((s, p) => s + Number(p.amount), 0) + activeHourly.reduce((s, p) => s + Number(p.total_amount), 0), 
      totalPaidAmount: paidFixed.reduce((s, p) => s + Number(p.amount), 0) + paidHourly.reduce((s, p) => s + Number(p.total_amount), 0) 
    };
  }, [payouts, hourlyRequests]);

  const filteredPayouts = useMemo(() => {
    let filtered = payouts;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(p => p.members?.name?.toLowerCase().includes(lower) || p.variable_symbol?.includes(lower) || p.payout_items?.some(i => i.projects?.name?.toLowerCase().includes(lower)));
    }
    if (statusFilter !== 'all') filtered = filtered.filter(p => p.status === statusFilter);
    if (withoutInvoiceFilter === 'yes') filtered = filtered.filter(p => p.approved_without_invoice === true);
    if (withoutInvoiceFilter === 'no') filtered = filtered.filter(p => p.approved_without_invoice === false);
    if (view === 'pending') filtered = filtered.filter(p => ['pending', 'approved', 'invoice_uploaded'].includes(p.status));
    return filtered;
  }, [payouts, searchTerm, statusFilter, view, withoutInvoiceFilter]);

  const handleSavePayout = async (payoutData, isEditMode, payoutId) => {
    console.log('handleSavePayout called with:', { payoutData, isEditMode, payoutId });
    
    try {
      let savedPayout = null;

      if (isEditMode) {
        console.log('Updating payout:', payoutId);
        
        const { error: payoutError } = await supabase
          .from('payouts')
          .update({
            member_id: payoutData.member_id,
            request_date: payoutData.request_date,
            reason: payoutData.reason,
            amount: payoutData.items.reduce((sum, item) => sum + item.amount, 0)
          })
          .eq('id', payoutId);

        if (payoutError) {
          console.error('Payout update error:', payoutError);
          throw payoutError;
        }

        const { error: deleteError } = await supabase
          .from('payout_items')
          .delete()
          .eq('payout_id', payoutId);

        if (deleteError) {
          console.error('Payout items delete error:', deleteError);
          throw deleteError;
        }

        const itemsToInsert = payoutData.items.map(item => ({
          payout_id: payoutId,
          project_id: item.project_id || null,
          realization_id: item.realization_id || null,
          amount: item.amount
        }));

        const { error: itemsError } = await supabase
          .from('payout_items')
          .insert(itemsToInsert);

        if (itemsError) {
          console.error('Payout items insert error:', itemsError);
          throw itemsError;
        }

        console.log('Payout updated successfully');
      } else {
        console.log('Creating new payout');
        
        const totalAmount = payoutData.items.reduce((sum, item) => sum + item.amount, 0);
        
        const { data: newPayout, error: payoutError } = await supabase
          .from('payouts')
          .insert({
            member_id: payoutData.member_id,
            amount: totalAmount,
            status: 'pending',
            request_date: payoutData.request_date,
            reason: payoutData.reason
          })
          .select()
          .single();

        if (payoutError) {
          console.error('Payout insert error:', payoutError);
          throw payoutError;
        }

        console.log('New payout created:', newPayout);

        const itemsToInsert = payoutData.items.map(item => ({
          payout_id: newPayout.id,
          project_id: item.project_id || null,
          realization_id: item.realization_id || null,
          amount: item.amount
        }));

        const { error: itemsError } = await supabase
          .from('payout_items')
          .insert(itemsToInsert);

        if (itemsError) {
          console.error('Payout items insert error:', itemsError);
          throw itemsError;
        }

        console.log('Payout items inserted successfully');
        savedPayout = newPayout;
      }

      await fetchPayouts();
      return savedPayout;
      
    } catch (error) {
      console.error('Error in handleSavePayout:', error);
      throw error;
    }
  };

  const handleUpdateStatus = async (id, status, payout) => {
    const dataToUpdate = { status };
    if (status === 'approved' && !payout?.variable_symbol) dataToUpdate.variable_symbol = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
    
    const { error } = await supabase.from('payouts').update(dataToUpdate).eq('id', id);
    if (!error) {
        toast({ title: "Stav aktualizován" });
        fetchPayouts();
        
        if (status === 'rejected') {
            await sendPayoutRejectionEmail({ memberId: payout.member_id, amount: payout.amount });
            await sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Zamítnutí žádosti' });
            toast({ title: "Email odeslán" });
        } else if (status === 'paid') {
            await sendPayoutPaidEmail({ memberId: payout.member_id, amount: payout.amount });
            await sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Vyplaceno' });
            toast({ title: "Email odeslán" });
        }
    }
  };

  const handleApproveWithDialog = (payout) => { setApprovalPayout(payout); setApprovalDialogOpen(true); };
  const handleConfirmApproval = async (payoutId, adminNote, approvedWithoutInvoice) => {
    const result = await approvePayout(payoutId, adminNote, approvedWithoutInvoice);
    if (result.success) fetchPayouts(); else throw new Error(result.error);
  };
  const handleDelete = async (id) => { 
    try {
      const { error: itemsError } = await supabase.from('payout_items').delete().eq('payout_id', id);
      if (itemsError) throw itemsError;
      
      const { error: payoutError } = await supabase.from('payouts').delete().eq('id', id);
      if (payoutError) throw payoutError;
      
      toast({ title: "Žádost smazána" }); 
      fetchPayouts(); 
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: "Chyba při mazání", description: error.message, variant: "destructive" });
    }
  };

  const isHourlyWorker = memberInfo?.hourly_rate > 0;
  const availableTabs = [{ value: 'fixed', label: 'Úkolová mzda (Fix)', show: true }, { value: 'hourly', label: 'Hodinová mzda', show: true }, { value: 'hourly_admin', label: 'Správa hodinové mzdy', show: canAdmin }].filter(tab => tab.show);
  const defaultTab = canAdmin ? 'hourly_admin' : (isHourlyWorker ? 'hourly' : 'fixed');

  return (
    <div className="pb-12">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-background/95 backdrop-blur">
        <div className="app-page pb-5">
          <PageHeader
            icon={Wallet}
            title="Správa výplat"
            description="Komplexní přehled o vašich odměnách a fakturaci"
            actions={
              <>
                <Button variant="outline" onClick={fetchPayouts} className="bg-white shadow-sm border-slate-200 hidden sm:flex">
                  <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />Aktualizovat
                </Button>
                <Button onClick={() => {setIsDialogOpen(true); setEditingPayout(null);}} className="shadow-sm w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />Nová žádost (Úkol)
                </Button>
              </>
            }
          />
        </div>
        <div className="hidden">
          <div className="flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl"><Wallet className="w-8 h-8 text-primary" /></div>
            <div><h1 className="text-3xl font-bold text-slate-900 tracking-tight">Správa výplat</h1><p className="text-slate-500 mt-1">Komplexní přehled o vašich odměnách a fakturaci</p></div>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <Button variant="outline" onClick={fetchPayouts} className="bg-white shadow-sm border-slate-200 hidden sm:flex"><RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />Aktualizovat</Button>
            <Button onClick={() => {setIsDialogOpen(true); setEditingPayout(null);}} className="shadow-sm w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" />Nová žádost (Úkol)</Button>
          </div>
        </div>
      </div>

      <div className="app-page pt-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard icon={Target} title="Aktivní požadavky" value={stats.activeCount.toString()} subtitle={`V hodnotě: ${stats.totalActiveAmount.toLocaleString('cs-CZ')} Kč`} color="text-amber-600" bg="bg-amber-100/50" />
          <StatCard icon={PiggyBank} title="Očekávaná platba" value={`${stats.totalActiveAmount.toLocaleString('cs-CZ')} Kč`} subtitle="Schválené a čekající částky celkem" color="text-blue-600" bg="bg-blue-100/50" />
          <StatCard icon={Award} title="Celkem vyplaceno" value={`${stats.totalPaidAmount.toLocaleString('cs-CZ')} Kč`} subtitle={`Z ${stats.paidCount} úspěšných žádostí`} color="text-emerald-600" bg="bg-emerald-100/50" />
        </div>

        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="flex w-full sm:w-auto mb-8 bg-slate-200/50 p-1 h-12 overflow-x-auto no-scrollbar justify-start">
            {availableTabs.map(tab => <TabsTrigger key={tab.value} value={tab.value} className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 whitespace-nowrap">{tab.value === 'hourly_admin' && <Settings className="w-3.5 h-3.5 mr-2 inline-block text-slate-500" />}{tab.label}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="fixed" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-slate-200 shadow-sm bg-white">
              <CardContent className="p-4 sm:p-6 flex flex-col lg:flex-row gap-4 justify-between items-center">
                <div className="relative w-full lg:w-96"><Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" /><Input placeholder="Hledat projekt, VS, projektanta..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-primary/20" /></div>
                <div className="flex flex-wrap gap-3 w-full lg:w-auto justify-end">
                  <Select value={withoutInvoiceFilter} onValueChange={setWithoutInvoiceFilter}><SelectTrigger className="w-[160px] bg-slate-50 border-slate-200"><SelectValue placeholder="Typ fakturace" /></SelectTrigger><SelectContent><SelectItem value="all">Všechny fakturace</SelectItem><SelectItem value="no">S fakturou</SelectItem><SelectItem value="yes">Bez faktury</SelectItem></SelectContent></Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[160px] bg-slate-50 border-slate-200"><SelectValue placeholder="Všechny stavy" /></SelectTrigger><SelectContent><SelectItem value="all">Všechny stavy</SelectItem><SelectItem value="pending">Čeká na schválení</SelectItem><SelectItem value="approved">Čeká na fakturu</SelectItem><SelectItem value="paid">Vyplaceno</SelectItem></SelectContent></Select>
                  <div className="flex bg-slate-100 p-1 rounded-lg"><Button variant={view === 'pending' ? 'secondary' : 'ghost'} onClick={() => setView('pending')} size="sm" className="h-8">Aktivní</Button><Button variant={view === 'all' ? 'secondary' : 'ghost'} onClick={() => setView('all')} size="sm" className="h-8">Všechny</Button></div>
                  <div className="flex bg-slate-100 p-1 rounded-lg"><Button variant={displayMode === 'cards' ? 'secondary' : 'ghost'} size="icon" onClick={() => setDisplayMode('cards')} className="h-8 w-8"><LayoutGrid className="w-4 h-4" /></Button><Button variant={displayMode === 'table' ? 'secondary' : 'ghost'} size="icon" onClick={() => setDisplayMode('table')} className="h-8 w-8"><List className="w-4 h-4" /></Button></div>
                </div>
              </CardContent>
            </Card>
            {loading ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[1,2,3].map(i => <div key={i} className="h-[250px] bg-slate-100 animate-pulse rounded-xl" />)}</div> : filteredPayouts.length === 0 ? <Card className="border-dashed border-2 border-slate-200 bg-transparent shadow-none"><CardContent className="p-12 text-center flex flex-col items-center"><div className="bg-slate-100 p-4 rounded-full mb-4"><DollarSign className="w-8 h-8 text-slate-400" /></div><h3 className="text-lg font-semibold text-slate-800 mb-1">Žádné úkolové žádosti nenalezeny</h3><p className="text-slate-500 mb-6">Zkuste změnit filtry nebo vytvořte novou žádost.</p><Button onClick={() => {setIsDialogOpen(true); setEditingPayout(null);}}><Plus className="w-4 h-4 mr-2" /> Vytvořit žádost</Button></CardContent></Card> : <AnimatePresence mode="wait">{displayMode === 'cards' ? <motion.div key="cards" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{filteredPayouts.map(payout => <PayoutCard key={payout.id} payout={payout} onUpdateStatus={handleUpdateStatus} onDelete={handleDelete} onEdit={(p) => { setEditingPayout(p); setIsDialogOpen(true); }} onApproveWithDialog={handleApproveWithDialog} onUploadInvoice={() => {}} onDownloadInvoice={() => {}} canAdmin={canAdmin} canEditOwn={canEditOwn} />)}</motion.div> : <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><PayoutTableHistory data={filteredPayouts} loading={loading} onRefresh={fetchPayouts} /></motion.div>}</AnimatePresence>}
          </TabsContent>

          <TabsContent value="hourly" className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <HourlyPayoutRequest onPayoutRequested={fetchPayouts} />
             <PayoutTableHistory data={hourlyRequests.filter(r => r.members?.auth_user_id === user?.id)} loading={loading} onRefresh={fetchPayouts} />
          </TabsContent>
          {canAdmin && <TabsContent value="hourly_admin" className="space-y-8 animate-in fade-in-slide-in-from-bottom-4 duration-500"><HourlyPayoutRequestsAdmin /></TabsContent>}
        </Tabs>
      </div>
      <PayoutDialog isOpen={isDialogOpen} onClose={() => { setIsDialogOpen(false); setEditingPayout(null); }} onSave={handleSavePayout} onDelete={handleDelete} payout={editingPayout} />
      <AdminPayoutApprovalDialog isOpen={approvalDialogOpen} onClose={() => { setApprovalDialogOpen(false); setApprovalPayout(null); }} payout={approvalPayout} onConfirm={handleConfirmApproval} />
    </div>
  );
};
export default Payouts;
