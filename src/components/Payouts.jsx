import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  FileText,
  Target,
  RefreshCw,
  Timer,
  Search,
  Wallet,
  PiggyBank,
  Settings,
  AlertCircle
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
import {
  approveWithoutInvoice,
  cancelPayoutRequest,
  clearPayoutInvoice,
  confirmInvoice,
  reopenPayoutForReview,
  uploadInvoice,
} from '@/lib/payoutWorkflowService';
import { sendInvoiceUploadedNotification, sendPayoutPaidEmail as sendWorkflowPayoutPaidEmail } from '@/lib/payoutWorkflowEmailService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { deleteStoredFile, uploadInvoiceDocument } from '@/lib/documentStorageService';
import { savePayoutRequest } from '@/lib/payoutRequestService';
import PageHeader from '@/components/ui/page-header';
import { PayoutPanel } from '@/components/payouts/PayoutShared';
import ForwardInvoiceDialog from '@/components/payouts/ForwardInvoiceDialog';
import { FinanceAmount, FinanceMetricStrip } from '@/components/finance/FinanceWorkspace';
import { getFinanceErrorMessage } from '@/lib/financePresentation';
import { ACTIVE_PAYOUT_STATUSES } from '@/lib/operationsHelpers';
import { usePayoutWorkspace } from '@/hooks/usePayoutWorkspace';
import { addKnownPayoutTotals, filterPayoutRows, summarizePayouts } from '@/lib/payoutWorkspaceData';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent, FormDialogHeader, FormDialogBody, FormDialogFooter } from '@/components/ui/form-dialog';
import { Textarea } from '@/components/ui/textarea';

const Payouts = () => {
  const { toast } = useToast();
  const { memberId, hasPermission, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedStatus = searchParams.get('status') || 'all';
  const validLinkedStatus = ['all', 'pending', 'approved', 'invoice_uploaded', 'paid', 'rejected', 'cancelled'].includes(linkedStatus) ? linkedStatus : 'all';
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPayout, setEditingPayout] = useState(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalPayout, setApprovalPayout] = useState(null);
  const [invoiceForwardDialog, setInvoiceForwardDialog] = useState({ open: false, payout: null });

  const [decision, setDecision] = useState(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionError, setDecisionError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const decisionLock = useRef(false);
  const canAdmin = hasPermission('payouts', 'can_admin');
  const canEditOwn = hasPermission('payouts', 'can_edit');
  useEffect(() => {
    setDecision(null); setApprovalDialogOpen(false); setApprovalPayout(null); setEditingPayout(null); setIsDialogOpen(false);
    setInvoiceForwardDialog({ open: false, payout: null });
  }, [user?.id, memberId, canAdmin]);
  const canCreateOwnPayout = Boolean(memberId && (canAdmin || canEditOwn));
  const workspace = usePayoutWorkspace({ memberId, canAdmin, actorId: user?.id });
  const fetchPayouts = workspace.reload;
  const loading = workspace.loading;
  const payouts = workspace.fixed?.rows;
  const hourlyRequests = workspace.hourly?.rows;
  const statusFilter = validLinkedStatus;
  const searchTerm = searchParams.get('q') || '';
  const withoutInvoiceFilter = ['yes', 'no'].includes(searchParams.get('invoice')) ? searchParams.get('invoice') : 'all';
  const view = searchParams.get('view') === 'all' || (statusFilter !== 'all' && !ACTIVE_PAYOUT_STATUSES.includes(statusFilter)) ? 'all' : 'pending';
  const changeFilters = patch => setSearchParams(current => {
    const next = new URLSearchParams(current);
    Object.entries(patch).forEach(([key, value]) => value == null || value === '' || value === 'all' && key !== 'view' ? next.delete(key) : next.set(key, value));
    return next;
  }, { replace: true });
  const changeStatusFilter = status => changeFilters({ status, view: status !== 'all' && !ACTIVE_PAYOUT_STATUSES.includes(status) ? 'all' : view });
  const changeView = nextView => changeFilters({ view: nextView, ...(nextView === 'pending' && !ACTIVE_PAYOUT_STATUSES.includes(statusFilter) ? { status: null } : {}) });
  const stats = useMemo(() => ({ fixed: summarizePayouts(payouts), hourly: summarizePayouts(hourlyRequests, 'total_amount') }), [payouts, hourlyRequests]);
  const total = key => addKnownPayoutTotals(stats.fixed[key], stats.hourly[key]);
  const count = value => value == null ? '—' : value;
  const filteredPayouts = useMemo(() => filterPayoutRows(payouts, { search: searchTerm, status: statusFilter, view, invoice: withoutInvoiceFilter }), [payouts, searchTerm, statusFilter, view, withoutInvoiceFilter]);

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

  const handleUpdateStatus = async (id, status, payout, note = null) => {
    try {
      if (status === 'rejected') {
        const { error } = await supabase.rpc('reject_payout', {
          p_payout_id: id,
          p_admin_note: note
        });
        if (error) throw error;

        toast({ title: "Žádost zamítnuta" });
        fetchPayouts();

        const notifications = await Promise.allSettled([
          sendPayoutRejectionEmail({ payoutId: payout.id, payoutType: 'task', memberId: payout.member_id, amount: payout.amount }),
          sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Zamítnutí žádosti', entityId: payout.id, entityType: 'payouts', eventType: 'rejected' }),
        ]);
        if (notifications.some(result => result.status === 'rejected' || !result.value?.success)) {
          toast({ title: "Notifikace se nepodařilo odeslat", description: 'Stav je uložený. E-mail se nepodařilo potvrdit; změnu stavu neopakujte.', variant: "warning" });
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

        const notifications = await Promise.allSettled([
          sendWorkflowPayoutPaidEmail(paidPayout),
          sendAdminPayoutNotification({ memberName: payout.members?.name, amount: payout.amount, action: 'Vyplaceno a uzavřeno', entityId: payout.id, entityType: 'payouts', eventType: 'paid' }),
        ]);
        if (notifications.some(result => result.status === 'rejected' || !result.value?.success)) {
          toast({ title: "Notifikace se nepodařilo odeslat", description: 'Stav je uložený. E-mail se nepodařilo potvrdit; změnu stavu neopakujte.', variant: "warning" });
        }
        return;
      }
    } catch (error) {
      console.error('Error updating payout status:', error);
      toast({ title: "Stav výplaty se nepodařilo změnit", description: getFinanceErrorMessage(error), variant: "destructive" });
      throw error;
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
    const allowedExt = ['pdf', 'jpg', 'jpeg', 'png'];
    if (!allowedExt.includes(fileExt)) {
      toast({ title: "Nepodporovaný typ souboru", description: "Použijte PDF, JPG nebo PNG.", variant: "destructive" });
      return;
    }

    try {
      const storedInvoice = await uploadInvoiceDocument({
        file,
        recordId: payout.id,
        projectReference: payout.payout_items?.find((item) => item.projects?.code)?.projects?.code
          || payout.payout_items?.find((item) => item.project_id)?.project_id,
        category: 'ukolove-vyplaty',
        accessEntityType: 'payout',
        accessEntityId: payout.id,
      });
      const dbUrlPath = storedInvoice.dbUrl;

      const result = await uploadInvoice(payout.id, storedInvoice, file.name);
      if (!result.success) {
        if (storedInvoice.cleanup) await storedInvoice.cleanup().catch(console.error);
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
      toast({ title: "Fakturu se nepodařilo nahrát", description: getFinanceErrorMessage(error), variant: "destructive" });
      throw error;
    }
  };
  const handleDownloadInvoice = async (payout) => {
    const { success, error } = await downloadInvoiceFromStorage({
      provider: payout.invoice_storage_provider,
      connectionId: payout.invoice_storage_connection_id,
      bucket: payout.invoice_storage_metadata?.bucket || 'invoices',
      filePath: payout.invoice_url,
      fileId: payout.invoice_external_file_id,
      fileName: payout.invoice_name,
      entityType: 'invoice',
      entityId: payout.id,
      accessEntityType: 'payout',
      accessEntityId: payout.id,
    });
    if (!success) {
      toast({ title: "Fakturu se nepodařilo stáhnout", description: error, variant: "destructive" });
    }
  };
  const handleRemoveInvoice = async (payout) => {
    try {
      const result = await clearPayoutInvoice(payout.id);
      if (!result.success) throw new Error(result.error);

      // The financial state changes first. A storage failure must never leave a
      // payout pointing at a file that was already deleted.
      try {
        await deleteStoredFile({
          provider: payout.invoice_storage_provider,
          connectionId: payout.invoice_storage_connection_id,
          bucket: payout.invoice_storage_metadata?.bucket || 'invoices',
          filePath: payout.invoice_url,
          fileId: payout.invoice_external_file_id,
          fileName: payout.invoice_name,
          entityType: 'invoice',
          entityId: payout.id,
          accessEntityType: 'payout',
          accessEntityId: payout.id,
        });
      } catch (storageError) {
        console.warn('Invoice file cleanup failed after payout state update:', storageError);
        toast({
          title: 'Výplata vrácena k faktuře',
          description: 'Záznam faktury byl odebrán. Soubor se nepodařilo smazat z úložiště, správce jej může odstranit později.',
          variant: 'warning',
        });
        await fetchPayouts();
        return;
      }

      toast({ title: 'Faktura odstraněna', description: 'Výplata je znovu připravena k nahrání správné faktury.' });
      await fetchPayouts();
    } catch (error) {
      console.error('Invoice removal error:', error);
      toast({ title: 'Fakturu se nepodařilo odstranit', description: getFinanceErrorMessage(error), variant: 'destructive' });
    }
  };
  const handleReopenForReview = async (payout) => {
    try {
      const result = await reopenPayoutForReview(payout.id);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Výplata vrácena ke schválení', description: 'Žádost lze znovu upravit a schválit.' });
      await fetchPayouts();
    } catch (error) {
      toast({ title: 'Výplatu se nepodařilo vrátit ke schválení', description: getFinanceErrorMessage(error), variant: 'destructive' });
    }
  };
  const handleCancelPayout = async (payout) => {
    try {
      const result = await cancelPayoutRequest(payout.id);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Žádost o výplatu byla stornována', description: 'Záznam zůstává dohledatelný v historii a auditu.' });
      await fetchPayouts();
    } catch (error) {
      toast({ title: 'Žádost se nepodařilo stornovat', description: getFinanceErrorMessage(error), variant: 'destructive' });
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
      toast({ title: "Žádost se nepodařilo odstranit", description: getFinanceErrorMessage(error), variant: "destructive" });
    }
  };

  const requestedTab = searchParams.get('tab');
  const activeTab = ['fixed', 'hourly', ...(canAdmin ? ['hourly_admin'] : [])].includes(requestedTab) ? requestedTab : 'fixed';
  const tabs = [
    { value: 'fixed', label: canAdmin ? 'Úkolové odměny' : 'Moje úkolové odměny', icon: Target },
    ...(canAdmin ? [{ value: 'hourly_admin', label: 'Hodinové žádosti', icon: Settings }] : []),
    { value: 'hourly', label: 'Moje hodinová odměna', icon: Timer },
  ];
  const openDecision = (id, status, payout) => { setDecision({ id, status, payout }); setDecisionNote(''); setDecisionError(null); };
  const confirmDecision = async event => {
    event.preventDefault();
    if (decisionLock.current) return;
    if (decision.status === 'rejected' && !decisionNote.trim()) { setDecisionError('Uveďte důvod zamítnutí.'); return; }
    decisionLock.current = true;
    setProcessing(true);
    try { await handleUpdateStatus(decision.id, decision.status, decision.payout, decisionNote.trim() || null); setDecision(null); }
    catch (error) { setDecisionError(getFinanceErrorMessage(error)); }
    finally { decisionLock.current = false; setProcessing(false); }
  };

  return (
    <div className="pb-12 compact-workspace">
      <div className="">
        <div className="app-page !pb-3">
          <PageHeader
            icon={Wallet}
            title={canAdmin ? 'Výplaty a odměny' : 'Moje výplaty'}
            description={canAdmin ? 'Od podané žádosti přes kontrolu dokladů až k evidenci úhrady.' : 'Vaše odměny, stav žádostí a historie vyplacení.'}
            actions={
              <>
                <Button variant="outline" aria-label="Aktualizovat výplaty" onClick={fetchPayouts} className="bg-white border-slate-200">
                  <RefreshCw className={cn("w-4 h-4 sm:mr-2", loading && "animate-spin")} /><span className="hidden sm:inline">Aktualizovat</span>
                </Button>
                {canCreateOwnPayout && (
                  <Button onClick={() => navigate('/payouts/new')} className="shadow-sm flex-1 sm:flex-none">
                    <Plus className="w-4 h-4 mr-2" />Nová úkolová žádost
                  </Button>
                )}
              </>
            }
          />
        </div>
      </div>

      <div className="app-page !pt-0">
        <p className="mb-3 text-xs text-slate-500">{canAdmin ? 'Všechny dostupné výplaty firmy' : 'Pouze vaše výplaty'} · celá historie · částky podle evidence odměn</p>
        <FinanceMetricStrip className="grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4 [&>div]:py-2" metrics={[
          { label: 'Otevřené žádosti', value: count(total('activeCount')), detail: <FinanceAmount value={total('activeAmount')} exact />, tone: 'neutral', icon: Target },
          { label: 'Ke schválení', value: count(total('pendingCount')), detail: canAdmin ? <div className="flex flex-wrap gap-x-3 gap-y-1"><Link className="inline-flex min-h-8 items-center underline underline-offset-2" to="/payouts?tab=fixed&status=pending">Úkolové ({count(stats.fixed.pendingCount)})</Link><Link className="inline-flex min-h-8 items-center underline underline-offset-2" to="/payouts?tab=hourly_admin&status=pending">Hodinové ({count(stats.hourly.pendingCount)})</Link></div> : 'Čekají na rozhodnutí', tone: 'warning', icon: Timer },
          { label: 'K evidenci úhrady', value: count(total('readyToPayCount')), detail: `Čekají na fakturu: ${count(total('awaitingInvoiceCount'))}`, tone: 'plan', icon: FileText },
          { label: 'Vyplaceno celkem', value: <FinanceAmount value={total('paidAmount')} exact />, detail: `Uzavřené žádosti: ${count(total('paidCount'))}`, tone: 'positive', icon: PiggyBank },
        ]} />
        {(workspace.fixed?.error || workspace.hourly?.error) && <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Přehled není úplný</strong>{workspace.fixed?.error && <p>Úkolové odměny: {workspace.fixed.error}</p>}{workspace.hourly?.error && <p>Hodinové odměny: {workspace.hourly.error}</p>}<p className="mt-1">Neúplné souhrny se nezobrazují jako nula. Zkuste přehled aktualizovat.</p></div></div>}




        <Tabs value={activeTab} onValueChange={tab => setSearchParams(current => { const next = new URLSearchParams(current); next.set('tab', tab); return next; })} className="w-full">
          <div className="mt-3 overflow-x-auto border-b border-slate-200"><TabsList aria-label="Agendy výplat" className="h-12 min-w-full justify-start border-0 sm:justify-start">{tabs.map(tab => { const Icon = tab.icon; return <TabsTrigger key={tab.value} value={tab.value} className="h-12 gap-2 px-4"><Icon className="h-4 w-4" />{tab.label}</TabsTrigger>; })}</TabsList></div>

          <TabsContent value="fixed" className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <PayoutPanel
              title="Úkolové odměny"
              description="Odměny z projekcí a realizací, jejich doklady a stav vyplacení."
              actions={
                <>
                  <Select value={withoutInvoiceFilter} onValueChange={invoice => changeFilters({ invoice })}>
                    <SelectTrigger aria-label="Filtr fakturace" className="w-full bg-white sm:w-[180px]">
                      <SelectValue placeholder="Typ fakturace" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny fakturace</SelectItem>
                      <SelectItem value="no">S fakturou</SelectItem>
                      <SelectItem value="yes">Bez faktury</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={changeStatusFilter}>
                    <SelectTrigger aria-label="Stav úkolové žádosti" className="w-full bg-white sm:w-[220px]">
                      <SelectValue placeholder="Filtr stavu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny stavy</SelectItem>
                      <SelectItem value="pending">Čeká na schválení</SelectItem>
                      <SelectItem value="approved">Schváleno</SelectItem>
                      <SelectItem value="invoice_uploaded">Faktura nahrána</SelectItem>
                      <SelectItem value="paid">Vyplaceno</SelectItem>
                      <SelectItem value="rejected">Zamítnuto</SelectItem>
                      <SelectItem value="cancelled">Stornováno</SelectItem>
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
                      aria-label="Hledat ve výplatách"
                      placeholder={canAdmin ? 'Zakázka, VS nebo zaměstnanec…' : 'Zakázka nebo variabilní symbol…'}
                      value={searchTerm}
                      onChange={(e) => changeFilters({ q: e.target.value })}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex shrink-0 rounded-lg bg-slate-100 p-1">
                    <Button aria-pressed={view === 'pending'} variant={view === 'pending' ? 'secondary' : 'ghost'} onClick={() => changeView('pending')} size="sm" className="h-10">
                      Aktivní ({count(stats.fixed.activeCount)})
                    </Button>
                    <Button aria-pressed={view === 'all'} variant={view === 'all' ? 'secondary' : 'ghost'} onClick={() => changeView('all')} size="sm" className="h-10">
                      Všechny žádosti ({count(stats.fixed.totalCount)})
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
                <span>{filteredPayouts.length} žádostí ve výběru · {view === 'pending' ? 'Žádosti, které ještě čekají na dokončení' : 'Včetně vyplacených, zamítnutých a stornovaných'}</span>
                {(searchTerm || statusFilter !== 'all' || withoutInvoiceFilter !== 'all') && <Button variant="ghost" size="sm" onClick={() => changeFilters({ q: null, status: null, invoice: null })}>Zrušit filtry</Button>}
              </div>
              <PayoutTableHistory
                error={workspace.fixed?.error}
                data={filteredPayouts}
                loading={loading}
                canAdmin={canAdmin}
                canEditOwn={canEditOwn}
                onApproveWithDialog={handleApproveWithDialog}
                onDelete={handleDelete}
                onDownloadInvoice={handleDownloadInvoice}
                onCancel={handleCancelPayout}
                onRemoveInvoice={handleRemoveInvoice}
                onReopen={handleReopenForReview}
                onEdit={(p) => {
                  setEditingPayout(p);
                  setIsDialogOpen(true);
                }}
                onUpdateStatus={openDecision}
                onUploadInvoice={handleUploadInvoice}
              />
            </PayoutPanel>
          </TabsContent>

          <TabsContent value="hourly" className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <HourlyPayoutRequest onPayoutRequested={fetchPayouts} />
          </TabsContent>
          {canAdmin && <TabsContent value="hourly_admin" className="space-y-8 animate-in fade-in-slide-in-from-bottom-4 duration-500"><HourlyPayoutRequestsAdmin /></TabsContent>}
        </Tabs>
        <details className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-700">Jak probíhá výplata</summary>
          <div className="grid divide-y divide-slate-100 border-t md:grid-cols-4 md:divide-x md:divide-y-0">
            {[
              ['1', 'Žádost', 'Zaměstnanec vytvoří úkolovou nebo hodinovou žádost.'],
              ['2', 'Schválení', 'Administrátor žádost schválí nebo zamítne.'],
              ['3', 'Faktura', 'Po schválení se nahraje faktura, pokud není výjimka.'],
              ['4', 'Vyplaceno', 'Po skutečné úhradě administrátor zaznamená vyplacení.']
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
        </details>
      </div>
      <Dialog open={Boolean(decision)} onOpenChange={open => { if (!open && !processing) setDecision(null); }}><FormDialogContent size="md"><form onSubmit={confirmDecision}><FormDialogHeader title={decision?.status === 'paid' ? 'Zaznamenat vyplacení' : 'Zamítnout žádost'} description={decision?.status === 'paid' ? 'Potvrďte, že peníze již byly skutečně uhrazeny. Tato akce neodesílá bankovní platbu.' : 'Žadatel uvidí důvod rozhodnutí.'} /><FormDialogBody><p className="text-sm">{decision?.payout?.members?.name} · <FinanceAmount value={decision?.payout?.amount} exact /></p>{decision?.status === 'rejected' && <div className="mt-4 space-y-2"><label htmlFor="payout-decision-reason" className="text-sm font-medium">Důvod zamítnutí</label><Textarea id="payout-decision-reason" value={decisionNote} onChange={event => setDecisionNote(event.target.value)} required maxLength={500} disabled={processing} /></div>}{decisionError && <p role="alert" className="mt-3 text-sm text-red-700">{decisionError}</p>}</FormDialogBody><FormDialogFooter><Button type="button" variant="outline" disabled={processing} onClick={() => setDecision(null)}>Zpět</Button><Button type="submit" disabled={processing}>{processing ? 'Ukládám…' : decision?.status === 'paid' ? 'Potvrdit vyplacení' : 'Zamítnout s odůvodněním'}</Button></FormDialogFooter></form></FormDialogContent></Dialog>
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
