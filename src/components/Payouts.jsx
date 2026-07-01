import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  CheckCircle2,
  FileText,
  Target,
  RefreshCw,
  Timer,
  Search,
  Wallet,
  PiggyBank,
  Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import PayoutDialog from '@/components/PayoutDialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import HourlyPayoutRequest from '@/components/HourlyPayoutRequest';
import PayoutTableHistory from '@/components/PayoutTable'; 
import HourlyPayoutRequestsAdmin from '@/components/HourlyPayoutRequestsAdmin';
import AdminPayoutApprovalDialog from '@/components/AdminPayoutApprovalDialog';
import { approvePayout } from '@/lib/PayoutApprovalService';
import { sendPayoutRejectionEmail } from '@/lib/email';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import { uploadInvoice, confirmInvoice, approveWithoutInvoice } from '@/lib/payoutWorkflowService';
import { sendInvoiceUploadedNotification, sendPayoutPaidEmail as sendWorkflowPayoutPaidEmail } from '@/lib/payoutWorkflowEmailService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { savePayoutRequest } from '@/lib/payoutRequestService';
import PageHeader from '@/components/ui/page-header';
import { formatCurrency, PayoutMetricCard, PayoutPanel } from '@/components/payouts/PayoutShared';
import ForwardInvoiceDialog from '@/components/payouts/ForwardInvoiceDialog';

const Payouts = () => {
  const { toast } = useToast();
  const { memberId, hasPermission, user } = useAuth();
  const navigate = useNavigate();
  
  const [payouts, setPayouts] = useState([]);
  const [hourlyRequests, setHourlyRequests] = useState([]);
  const [memberInfo, setMemberInfo] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalPayout, setApprovalPayout] = useState(null);
  const [invoiceForwardDialog, setInvoiceForwardDialog] = useState({ open: false, payout: null });

  const [view, setView] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [withoutInvoiceFilter, setWithoutInvoiceFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  const canAdmin = hasPermission('payouts', 'can_admin');
  const canEditOwn = hasPermission('payouts', 'can_edit');
  const canCreateOwnPayout = canAdmin || Boolean(memberId);

  useEffect(() => { if(memberId) supabase.from('members').select('*').eq('id', memberId).single().then(({data}) => setMemberInfo(data)); }, [memberId]);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      if (!canAdmin && !memberId) {
        setPayouts([]);
        setHourlyRequests([]);
        return;
      }

      // FIXED: Explicit foreign key relationships for payouts table
      let fixedQuery = supabase
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

      if (!canAdmin) {
        fixedQuery = fixedQuery.eq('member_id', memberId);
      }

      const { data: fixedData, error: fixedError } = await fixedQuery;
      if (fixedError) throw fixedError;
      
      setPayouts(fixedData || []);
      
      // FIXED: Explicit foreign key for hourly requests
      let hourlyQuery = supabase
        .from('hourly_payout_requests')
        .select(`
          *,
          projects(name),
          members:members!hourly_payout_requests_member_id_fkey(name, auth_user_id)
        `)
        .order('created_at', { ascending: false });

      if (!canAdmin) {
        hourlyQuery = hourlyQuery.eq('member_id', memberId);
      }

      const { data: hourlyData, error: hourlyError } = await hourlyQuery;
      if (hourlyError) throw hourlyError;
      
      setHourlyRequests(hourlyData || []);
    } catch (error) { 
      toast({ title: "Chyba při načítání dat.", description: error.message, variant: "destructive" }); 
    } finally { 
      setLoading(false); 
    }
  }, [canAdmin, memberId, toast]);

  useEffect(() => {
    fetchPayouts();
    const channel = supabase.channel('payouts-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, fetchPayouts).on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, fetchPayouts).subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchPayouts]);

  const stats = useMemo(() => {
    const activeFixed = payouts.filter(p => ['pending', 'approved', 'invoice_uploaded'].includes(p.status));
    const paidFixed = payouts.filter(p => p.status === 'paid');
    const activeHourly = hourlyRequests.filter(p => ['pending', 'approved', 'invoice_uploaded'].includes(p.status));
    const paidHourly = hourlyRequests.filter(p => p.status === 'paid');

    return {
      fixed: {
        totalCount: payouts.length,
        activeCount: activeFixed.length,
        paidCount: paidFixed.length,
        pendingCount: payouts.filter(p => p.status === 'pending').length,
        invoiceReadyCount: payouts.filter(p => p.status === 'invoice_uploaded').length,
        activeAmount: activeFixed.reduce((s, p) => s + Number(p.amount || 0), 0),
        paidAmount: paidFixed.reduce((s, p) => s + Number(p.amount || 0), 0)
      },
      hourly: {
        totalCount: hourlyRequests.length,
        activeCount: activeHourly.length,
        paidCount: paidHourly.length,
        pendingCount: hourlyRequests.filter(p => p.status === 'pending').length,
        invoiceReadyCount: hourlyRequests.filter(p => p.status === 'invoice_uploaded').length,
        activeAmount: activeHourly.reduce((s, p) => s + Number(p.total_amount || 0), 0),
        paidAmount: paidHourly.reduce((s, p) => s + Number(p.total_amount || 0), 0)
      }
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
    try {
      const savedPayout = await savePayoutRequest(payoutData, isEditMode, payoutId);
      await fetchPayouts();
      return savedPayout;
    } catch (error) {
      console.error('Error in handleSavePayout:', error);
      throw error;
    }
  };

  const handleUpdateStatus = async (id, status, payout) => {
    try {
      if (status === 'rejected') {
        const { error } = await supabase.rpc('reject_payout', {
          p_payout_id: id,
          p_admin_note: null
        });
        if (error) throw error;

        toast({ title: "Žádost zamítnuta" });
        fetchPayouts();

        const memberResult = await sendPayoutRejectionEmail({ memberId: payout.member_id, amount: payout.amount });
        const adminResult = await sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Zamítnutí žádosti' });
        if (!memberResult?.success || !adminResult?.success) {
          toast({ title: "Notifikace se nepodařilo odeslat", description: memberResult?.error || adminResult?.error, variant: "warning" });
        }
        return;
      }

      if (status === 'paid') {
        if (payout.status === 'invoice_uploaded') {
          const result = await confirmInvoice(id, user?.id);
          if (!result.success) throw new Error(result.error);
        } else if (payout.status === 'approved' && payout.approved_without_invoice) {
          const result = await approveWithoutInvoice(id, user?.id);
          if (!result.success) throw new Error(result.error);
        } else {
          toast({ title: "Chybí faktura", description: "Výplatu lze uzavřít až po nahrání faktury.", variant: "warning" });
          return;
        }

        const paidPayout = { ...payout, status: 'paid', paid_at: new Date().toISOString() };
        toast({ title: "Výplata uzavřena", description: "Žádost byla označena jako vyplacená." });
        fetchPayouts();
        if (payout.invoice_url) {
          setInvoiceForwardDialog({ open: true, payout: paidPayout });
        }

        const memberResult = await sendWorkflowPayoutPaidEmail(paidPayout);
        const adminResult = await sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Vyplaceno a uzavřeno' });
        if (!memberResult?.success || !adminResult?.success) {
          toast({ title: "Notifikace se nepodařilo odeslat", description: memberResult?.error || adminResult?.error, variant: "warning" });
        }
        return;
      }
    } catch (error) {
      console.error('Error updating payout status:', error);
      toast({ title: "Chyba změny stavu", description: error.message, variant: "destructive" });
    }
  };

  const handleApproveWithDialog = (payout) => { setApprovalPayout(payout); setApprovalDialogOpen(true); };
  const handleConfirmApproval = async (payoutId, adminNote, approvedWithoutInvoice) => {
    const result = await approvePayout(payoutId, adminNote, approvedWithoutInvoice);
    if (result.success) {
      fetchPayouts();
      return result.data;
    }
    throw new Error(result.error);
  };
  const handleUploadInvoice = async (payout, file) => {
    if (!payout || !file) return;
    if (payout.status !== 'approved') {
      toast({ title: "Fakturu lze nahrát až po schválení žádosti.", variant: "warning" });
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Soubor je příliš velký", description: "Maximální velikost faktury je 10 MB.", variant: "destructive" });
      return;
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const allowedExt = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
    if (!allowedExt.includes(fileExt)) {
      toast({ title: "Nepodporovaný typ souboru", description: "Použijte PDF, DOC, DOCX, JPG nebo PNG.", variant: "destructive" });
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bucketName = 'invoices';
    const filePath = `${year}/${month}/payout_${payout.member_id}_${payout.id}_${Date.now()}_${safeName}`;
    const dbUrlPath = `${bucketName}/${filePath}`;

    try {
      const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;

      const result = await uploadInvoice(payout.id, dbUrlPath, file.name);
      if (!result.success) {
        await supabase.storage.from(bucketName).remove([filePath]).catch(console.error);
        throw new Error(result.error);
      }

      const updatedPayout = { ...payout, invoice_url: dbUrlPath, invoice_name: file.name, invoice_uploaded_at: new Date().toISOString(), status: 'invoice_uploaded' };
      toast({ title: "Faktura nahrána", description: "Administrátor byl upozorněn a může výplatu uzavřít." });
      fetchPayouts();

      const notifyResult = await sendInvoiceUploadedNotification(updatedPayout);
      if (!notifyResult?.success) {
        toast({ title: "Notifikace administrátorovi se nepodařila", description: notifyResult?.error, variant: "warning" });
      }
    } catch (error) {
      console.error('Invoice upload error:', error);
      toast({ title: "Chyba nahrávání faktury", description: error.message, variant: "destructive" });
      throw error;
    }
  };
  const handleDownloadInvoice = async (invoiceUrl) => {
    const { success, error } = await downloadInvoiceFromStorage(invoiceUrl);
    if (!success) {
      toast({ title: "Fakturu se nepodařilo stáhnout", description: error, variant: "destructive" });
    }
  };
  const handleDelete = async (id) => { 
    try {
      const { error: payoutError } = await supabase.rpc('delete_payout_request', {
        p_payout_id: id
      });
      if (payoutError) throw payoutError;
      
      toast({ title: "Žádost smazána" }); 
      fetchPayouts(); 
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: "Chyba při mazání", description: error.message, variant: "destructive" });
    }
  };

  const isHourlyWorker = memberInfo?.hourly_rate > 0;
  const overviewScopeLabel = canAdmin ? 'Celkový přehled' : 'Můj přehled';
  const overviewCountLabel = canAdmin ? 'žádostí v evidenci' : 'mých žádostí';
  const defaultTab = canAdmin ? 'hourly_admin' : (isHourlyWorker ? 'hourly' : 'fixed');
  const payoutAgendaTabs = [
    { value: 'fixed', label: 'Úkolová mzda', icon: Target, show: true },
    { value: 'hourly_admin', label: 'Schvalování hodinové mzdy', icon: Settings, show: canAdmin }
  ].filter(tab => tab.show);
  const personalPayoutTabs = [
    { value: 'hourly', label: 'Moje hodinová mzda', icon: Timer, show: true }
  ].filter(tab => tab.show);

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
                {canCreateOwnPayout && (
                  <Button onClick={() => navigate('/payouts/new')} className="shadow-sm w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />Nová žádost (úkol)
                  </Button>
                )}
              </>
            }
          />
        </div>
      </div>

      <div className="app-page pt-0">
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{overviewScopeLabel} úkolové mzdy</h2>
                <p className="mt-1 text-sm text-slate-600">{stats.fixed.totalCount} {overviewCountLabel}</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-blue-700">
                <Target className="h-5 w-5" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PayoutMetricCard icon={Target} label="Aktivní úkolové" value={stats.fixed.activeCount.toString()} detail={formatCurrency(stats.fixed.activeAmount)} tone="blue" />
              <PayoutMetricCard icon={Timer} label="Ke schválení" value={stats.fixed.pendingCount.toString()} detail={canAdmin ? 'Nové úkolové žádosti' : 'Moje nové žádosti'} tone="amber" />
              <PayoutMetricCard icon={FileText} label="Faktury ke kontrole" value={stats.fixed.invoiceReadyCount.toString()} detail="Úkolové faktury" tone="slate" />
              <PayoutMetricCard icon={PiggyBank} label="Vyplaceno úkolově" value={formatCurrency(stats.fixed.paidAmount)} detail={`${stats.fixed.paidCount} uzavřených`} tone="emerald" />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{overviewScopeLabel} hodinové mzdy</h2>
                <p className="mt-1 text-sm text-slate-600">{stats.hourly.totalCount} {overviewCountLabel}</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-emerald-700">
                <Timer className="h-5 w-5" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PayoutMetricCard icon={Timer} label="Aktivní hodinové" value={stats.hourly.activeCount.toString()} detail={formatCurrency(stats.hourly.activeAmount)} tone="blue" />
              <PayoutMetricCard icon={CheckCircle2} label="Ke schválení" value={stats.hourly.pendingCount.toString()} detail={canAdmin ? 'Nové hodinové žádosti' : 'Moje nové žádosti'} tone="amber" />
              <PayoutMetricCard icon={FileText} label="Faktury ke kontrole" value={stats.hourly.invoiceReadyCount.toString()} detail="Hodinové faktury" tone="slate" />
              <PayoutMetricCard icon={Wallet} label="Vyplaceno hodinově" value={formatCurrency(stats.hourly.paidAmount)} detail={`${stats.hourly.paidCount} uzavřených`} tone="emerald" />
            </div>
          </section>
        </div>

        <PayoutPanel className="mt-6">
          <div className="grid divide-y divide-slate-100 md:grid-cols-4 md:divide-x md:divide-y-0">
            {[
              ['1', 'Žádost', 'Zaměstnanec vytvoří úkolovou nebo hodinovou žádost.'],
              ['2', 'Schválení', 'Administrátor žádost schválí nebo zamítne.'],
              ['3', 'Faktura', 'Po schválení se nahraje faktura, pokud není výjimka.'],
              ['4', 'Vyplaceno', 'Po kontrole faktury se žádost uzavře.']
            ].map(([step, title, description]) => (
              <div key={step} className="flex gap-3 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">{step}</div>
                <div>
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                  <div className="mt-1 text-sm leading-5 text-slate-500">{description}</div>
                </div>
              </div>
            ))}
          </div>
        </PayoutPanel>

        <Tabs defaultValue={defaultTab} className="w-full">
          <div className="mb-8 flex h-auto w-full flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Agenda výplat
              </div>
              <TabsList className="flex h-auto justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0">
                {payoutAgendaTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-10 rounded-lg border-0 px-4 text-sm font-semibold text-slate-600 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <Icon className="mr-2 h-3.5 w-3.5" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-1.5 shadow-sm">
              <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                Osobní mzda
              </div>
              <TabsList className="flex h-auto justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0">
                {personalPayoutTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-10 rounded-lg border-0 px-4 text-sm font-semibold text-emerald-800 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <Icon className="mr-2 h-3.5 w-3.5" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>

          <TabsContent value="fixed" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <PayoutPanel
              title="Úkolová mzda"
              description="Stejný workflow jako u hodinových výplat: žádost, schválení, faktura a vyplacení."
              actions={
                <>
                  <Select value={withoutInvoiceFilter} onValueChange={setWithoutInvoiceFilter}>
                    <SelectTrigger className="w-full bg-white sm:w-[180px]">
                      <SelectValue placeholder="Typ fakturace" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny fakturace</SelectItem>
                      <SelectItem value="no">S fakturou</SelectItem>
                      <SelectItem value="yes">Bez faktury</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full bg-white sm:w-[220px]">
                      <SelectValue placeholder="Filtr stavu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny stavy</SelectItem>
                      <SelectItem value="pending">Čeká na schválení</SelectItem>
                      <SelectItem value="approved">Čeká na fakturu</SelectItem>
                      <SelectItem value="invoice_uploaded">Faktura nahrána</SelectItem>
                      <SelectItem value="paid">Vyplaceno</SelectItem>
                      <SelectItem value="rejected">Zamítnuto</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              }
            >
              <div className="border-b border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative w-full lg:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder={canAdmin ? 'Hledat projekt, VS nebo zaměstnance...' : 'Hledat projekt nebo VS...'}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex shrink-0 rounded-lg bg-slate-100 p-1">
                    <Button variant={view === 'pending' ? 'secondary' : 'ghost'} onClick={() => setView('pending')} size="sm" className="h-8">
                      Aktivní
                    </Button>
                    <Button variant={view === 'all' ? 'secondary' : 'ghost'} onClick={() => setView('all')} size="sm" className="h-8">
                      Všechny
                    </Button>
                  </div>
                </div>
              </div>
              <PayoutTableHistory
                data={filteredPayouts}
                loading={loading}
                canAdmin={canAdmin}
                canEditOwn={canEditOwn}
                onApproveWithDialog={handleApproveWithDialog}
                onDelete={handleDelete}
                onDownloadInvoice={handleDownloadInvoice}
                onEdit={(p) => {
                  setEditingPayout(p);
                  setIsDialogOpen(true);
                }}
                onUpdateStatus={handleUpdateStatus}
                onUploadInvoice={handleUploadInvoice}
              />
            </PayoutPanel>
          </TabsContent>

          <TabsContent value="hourly" className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm leading-6 text-blue-900 shadow-sm">
               <div className="mb-1 font-semibold">Moje hodinová mzda</div>
               Tato záložka slouží pro vytvoření vlastní měsíční žádosti z docházky a nahrání faktury po schválení. Administrátorské schvalování je v záložce „Schvalování hodinové mzdy“.
             </div>
             <HourlyPayoutRequest onPayoutRequested={fetchPayouts} />
          </TabsContent>
          {canAdmin && <TabsContent value="hourly_admin" className="space-y-8 animate-in fade-in-slide-in-from-bottom-4 duration-500"><HourlyPayoutRequestsAdmin /></TabsContent>}
        </Tabs>
      </div>
      <PayoutDialog isOpen={isDialogOpen} onClose={() => { setIsDialogOpen(false); setEditingPayout(null); }} onSave={handleSavePayout} onDelete={handleDelete} payout={editingPayout} />
      <AdminPayoutApprovalDialog isOpen={approvalDialogOpen} onClose={() => { setApprovalDialogOpen(false); setApprovalPayout(null); }} payout={approvalPayout} onConfirm={handleConfirmApproval} />
      <ForwardInvoiceDialog
        open={invoiceForwardDialog.open}
        onOpenChange={(open) => setInvoiceForwardDialog((current) => ({ open, payout: open ? current.payout : null }))}
        payout={invoiceForwardDialog.payout}
        type="task"
      />
    </div>
  );
};
export default Payouts;
