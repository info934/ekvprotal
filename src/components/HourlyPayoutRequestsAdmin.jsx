import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Download, Eye, FileWarning, Loader2, RefreshCw, Search, Upload, Wallet, XCircle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { sendHourlyPayoutPaidEmail, sendPayoutApprovalEmail, sendPayoutRejectionEmail } from '@/lib/email';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { uploadInvoiceDocument } from '@/lib/documentStorageService';
import { uploadHourlyPayoutInvoice } from '@/lib/hourlyPayoutWorkflowService';
import { loadHourlyAdminWorkspace, saveHourlyAdminAction } from '@/lib/hourlyAdminWorkspace';
import { OPEN_PAYOUT_STATUSES, PAYOUT_STATUSES } from '@/lib/payoutWorkspaceData';
import { getFinanceErrorMessage } from '@/lib/financePresentation';
import { toFiniteAmount } from '@/domain/financials';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatCurrency, PayoutPanel, PayoutStatusBadge } from '@/components/payouts/PayoutShared';
import PayoutRequestsTable from '@/components/payouts/PayoutRequestsTable';
import ForwardInvoiceDialog from '@/components/payouts/ForwardInvoiceDialog';
import ConfirmActionDialog from '@/components/ui/confirm-action-dialog';
import HourlyPayoutRequestDialog from './HourlyPayoutRequestDialog';
import AdminHourlyPayoutApprovalDialog from './AdminHourlyPayoutApprovalDialog';
import HourlyPayoutApprovalAuditLog from './HourlyPayoutApprovalAuditLog';

const typeLabels = { regular: 'Běžná', supplement: 'Doplatek', correction: 'Oprava' };
const statusLabels = { pending: 'Čeká na schválení', approved: 'Schváleno', invoice_uploaded: 'Faktura nahrána', paid: 'Vyplaceno', rejected: 'Zamítnuto', cancelled: 'Stornováno' };
const EMPTY_ROWS = [];
const hours = value => toFiniteAmount(value) === null ? 'Nedostupné' : `${Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} h`;

export default function HourlyPayoutRequestsAdmin() {
  const { user, memberId, hasPermission, isPrivateMode, permissionsReady, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAdmin = hasPermission('payouts', 'can_admin');
  const actorKey = `${user?.id || ''}:${memberId || ''}:${canAdmin}`;
  const liveActor = useRef(actorKey); liveActor.current = actorKey;
  const [state, setState] = useState({ key: null, rows: [], loading: true, error: null, discrepancyError: null });
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [approval, setApproval] = useState(null);
  const [decision, setDecision] = useState(null);
  const [payment, setPayment] = useState(null);
  const [paymentError, setPaymentError] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [forward, setForward] = useState(null);
  const requestRef = useRef({ id: 0, controller: null });
  const inFlight = useRef(false);
  const statusFilter = searchParams.get('tab') === 'hourly_admin' && PAYOUT_STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'all';
  const setStatusFilter = value => { const next = new URLSearchParams(searchParams); next.set('tab', 'hourly_admin'); if (value === 'all') next.delete('status'); else next.set('status', value); setSearchParams(next); };
  const money = value => isPrivateMode ? 'Skryto' : formatCurrency(value);
  const rows = state.key === actorKey ? state.rows : EMPTY_ROWS;
  const loading = authLoading || !permissionsReady || state.key !== actorKey || state.loading;
  useEffect(() => {
    setProcessingId(null); setDownloading(null); setApproval(null); setDecision(null); setPayment(null); setForward(null); setPaymentError(null);
  }, [actorKey]);

  const fetchRequests = useCallback(async () => {
    requestRef.current.controller?.abort();
    if (!user?.id || !canAdmin) return;
    const controller = new AbortController();
    const id = requestRef.current.id + 1; requestRef.current = { controller, id };
    setState({ key: actorKey, rows: [], loading: true, error: null, discrepancyError: null });
    try {
      const result = await loadHourlyAdminWorkspace(supabase, { actorId: user.id, memberId, canAdmin, signal: controller.signal });
      if (requestRef.current.id === id && !controller.signal.aborted) setState({ key: actorKey, ...result, loading: false, error: null });
    } catch (error) {
      if (requestRef.current.id === id && !controller.signal.aborted) setState({ key: actorKey, rows: [], loading: false, discrepancyError: null, error: getFinanceErrorMessage(error, 'Hodinové žádosti nejsou dostupné. Obnovte přehled.') });
    }
  }, [actorKey, user?.id, memberId, canAdmin]);

  useEffect(() => {
    if (!permissionsReady || authLoading || !canAdmin || !user?.id) return undefined;
    void fetchRequests();
    const channel = supabase.channel(`hourly_admin_${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, fetchRequests).subscribe();
    return () => { requestRef.current.controller?.abort(); void supabase.removeChannel(channel); };
  }, [fetchRequests, permissionsReady, authLoading, canAdmin, user?.id]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLocaleLowerCase('cs-CZ');
    return rows.filter(row => (statusFilter === 'all' || row.status === statusFilter) && (!needle || [row.members?.name, row.members?.email, row.display?.searchText, row.projects?.code].filter(Boolean).join(' ').toLocaleLowerCase('cs-CZ').includes(needle)));
  }, [rows, searchTerm, statusFilter]);

  const sendNotifications = async (action, request, saved, options) => {
    const notifications = [];
    if (action === 'approve') {
      notifications.push(sendPayoutApprovalEmail({ payoutId: request.id, payoutType: 'hourly', memberId: request.member_id, amount: saved.total_amount, approved_without_invoice: options.withoutInvoice }));
      notifications.push(sendAdminPayoutNotification({ memberName: request.members?.name || 'Pracovník', amount: saved.total_amount, action: 'Schválení hodinové žádosti', entityId: request.id, entityType: 'hourly_payout_requests', eventType: 'approved' }));
    } else if (action === 'reject') notifications.push(sendPayoutRejectionEmail({ payoutId: request.id, payoutType: 'hourly', memberId: request.member_id, amount: saved.total_amount, reason: options.note }));
    else if (action === 'paid') notifications.push(sendHourlyPayoutPaidEmail({ requestId: request.id, memberId: request.member_id, amount: saved.total_amount }));
    const results = await Promise.allSettled(notifications);
    return results.every(result => result.status === 'fulfilled' && result.value?.success === true);
  };

  const runAction = async (request, action, options = {}) => {
    if (inFlight.current || !user?.id || !canAdmin || liveActor.current !== actorKey || request?._scope !== actorKey) throw new Error('Operaci nyní nelze provést. Obnovte přehled.');
    inFlight.current = true; setProcessingId(request.id);
    try {
      const saved = await saveHourlyAdminAction(supabase, request, action, options, { actorId: user.id, canAdmin });
      if (liveActor.current !== actorKey) return saved;
      // Once the RPC has committed, notification trouble must not turn a saved
      // decision into a failed form that invites an unsafe repeated submission.
      let notified = false;
      try { notified = await sendNotifications(action, request, saved, options); } catch { notified = false; }
      if (liveActor.current !== actorKey) return saved;
      toast({ title: action === 'paid' ? 'Úhrada byla zaznamenána' : action === 'cancel' ? 'Žádost byla stornována' : action === 'approve' ? 'Žádost byla schválena' : 'Žádost byla zamítnuta', description: notified ? 'Změna je uložena.' : 'Změna je uložena, ale odeslání e-mailu se nepodařilo potvrdit.', variant: notified ? 'default' : 'warning' });
      if (action === 'paid' && request.invoice_url) setForward({ ...request, ...saved, members: request.members, _scope: actorKey });
      await fetchRequests();
      return saved;
    } finally { inFlight.current = false; if (liveActor.current === actorKey) setProcessingId(null); }
  };

  const download = async request => {
    if (!request.invoice_url || !canAdmin || liveActor.current !== actorKey) return;
    setDownloading(request.id);
    try {
      const result = await downloadInvoiceFromStorage({ provider: request.invoice_storage_provider, connectionId: request.invoice_storage_connection_id, bucket: request.invoice_storage_metadata?.bucket || 'invoices', filePath: request.invoice_url, fileId: request.invoice_external_file_id, fileName: request.invoice_storage_metadata?.originalFileName || 'faktura', entityType: 'invoice', entityId: request.id, accessEntityType: 'hourly_payout', accessEntityId: request.id });
      if (!result.success) throw new Error(result.error || 'Soubor se nepodařilo stáhnout.');
    } catch (error) { toast({ title: 'Stažení faktury se nezdařilo', description: getFinanceErrorMessage(error), variant: 'destructive' }); }
    finally { if (liveActor.current === actorKey) setDownloading(null); }
  };

  const upload = async (request, file) => {
    if (!file || inFlight.current || !canAdmin || !user?.id || liveActor.current !== actorKey) return;
    if (request.status !== 'approved' || request.invoice_url || request.approved_without_invoice) return;
    if (file.size > 10 * 1024 * 1024 || !/\.(pdf|jpe?g|png)$/i.test(file.name)) { toast({ title: 'Použijte PDF, JPG nebo PNG do 10 MB.', variant: 'destructive' }); return; }
    inFlight.current = true; setProcessingId(request.id);
    try {
      const stored = await uploadInvoiceDocument({ file, recordId: request.id, projectReference: request.display?.projectReference || request.projects?.code || request.project_id, category: 'hodinove-vyplaty', accessEntityType: 'hourly_payout', accessEntityId: request.id });
      try {
        if (liveActor.current !== actorKey) throw new Error('Přihlášení se během nahrávání změnilo.');
        await uploadHourlyPayoutInvoice(request.id, stored);
      }
      catch (error) { if (stored.cleanup) await stored.cleanup().catch(() => {}); throw error; }
      if (liveActor.current !== actorKey) return;
      toast({ title: 'Faktura byla přiložena', description: 'Žádost je připravená ke kontrole a zaevidování úhrady.' });
      await fetchRequests();
    } catch (error) { if (liveActor.current === actorKey) toast({ title: 'Fakturu se nepodařilo přiložit', description: getFinanceErrorMessage(error), variant: 'destructive' }); }
    finally { inFlight.current = false; if (liveActor.current === actorKey) setProcessingId(null); }
  };

  const withScope = row => ({ ...row, _scope: actorKey });
  const columns = [
    { key: 'worker', header: 'Pracovník', render: row => <div className="min-w-0 break-words lg:min-w-[150px]"><p className="font-semibold text-slate-900">{row.members?.name || 'Pracovník'}</p><p className="mt-1 text-xs text-slate-500">{row.members?.email}</p></div> },
    { key: 'context', header: 'Období a práce', render: row => <div className="min-w-0 max-w-[300px] lg:min-w-[180px]"><p className="font-medium text-slate-900">{row.display?.periodLabel}</p><p className="mt-1 break-words text-xs text-slate-500">{row.display?.assignmentLabel}</p><span className="text-xs text-slate-400">{typeLabels[row.request_type] || 'Běžná žádost'}</span></div> },
    { key: 'hours', header: 'Hodiny a sazba', cellClassName: 'text-right', render: row => <><p className="whitespace-nowrap font-medium tabular-nums">{hours(row.total_hours ?? row.hours)}</p><p className="whitespace-nowrap text-xs text-slate-500">{money(row.hourly_rate)} / hod</p></> },
    { key: 'amount', header: 'Celkem', cellClassName: 'text-right font-semibold tabular-nums whitespace-nowrap', render: row => money(row.total_amount) },
    { key: 'status', header: 'Stav', render: row => <div className="min-w-[150px] space-y-2"><PayoutStatusBadge status={row.status} approvedWithoutInvoice={row.approved_without_invoice} />{row.status === 'approved' && row.approved_without_invoice && <p className="text-xs text-amber-800">Schváleno bez faktury</p>}{row.discrepancy?.has_discrepancy && <p className="flex items-center gap-1 text-xs text-red-800"><AlertTriangle className="h-3.5 w-3.5" />Nesoulad s docházkou</p>}{(row.cancellation_reason || row.rejection_reason || row.admin_note) && <Popover><PopoverTrigger asChild><Button variant="link" size="sm" className="h-auto p-0 text-xs">{['rejected', 'cancelled'].includes(row.status) ? 'Důvod rozhodnutí' : 'Poznámka'}</Button></PopoverTrigger><PopoverContent className="max-w-[calc(100vw-2rem)] whitespace-pre-wrap break-words text-sm">{row.cancellation_reason || row.rejection_reason || row.admin_note}</PopoverContent></Popover>}</div> },
    { key: 'invoice', header: 'Doklad', render: row => row.invoice_url ? <Button size="sm" variant="outline" disabled={downloading === row.id} onClick={() => download(row)} aria-label={`Stáhnout fakturu: ${row.members?.name || 'pracovník'}`}>{downloading === row.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Faktura</Button> : row.approved_without_invoice ? <span className="flex items-center gap-1 text-xs text-amber-800"><FileWarning className="h-4 w-4" />Výjimka z dokladu</span> : <span className="text-xs text-slate-400">Nepřiložen</span> },
    { key: 'actions', header: 'Akce', cellClassName: 'text-right', render: row => <div className="flex min-w-[180px] flex-wrap items-center justify-end gap-2">
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label={`Historie schválení: ${row.members?.name || 'pracovník'}`}><Eye className="h-4 w-4" /></Button></PopoverTrigger><PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-4" align="end"><div className="max-h-[320px] overflow-y-auto"><HourlyPayoutApprovalAuditLog requestId={row.id} /></div></PopoverContent></Popover>
      {row.status === 'pending' && <><Button size="sm" variant="outline" disabled={Boolean(processingId)} onClick={() => setApproval(withScope(row))}><CheckCircle className="mr-1 h-4 w-4" />Schválit</Button><Button size="icon" variant="ghost" disabled={Boolean(processingId)} aria-label={`Zamítnout žádost: ${row.members?.name || 'pracovník'}`} onClick={() => setDecision({ request: withScope(row), action: 'reject' })}><XCircle className="h-4 w-4 text-red-700" /></Button></>}
      {row.status === 'approved' && !row.invoice_url && !row.approved_without_invoice && <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-md border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 focus-within:ring-2 focus-within:ring-blue-600"><Upload className="h-4 w-4" />Přiložit fakturu<input type="file" aria-label={`Přiložit fakturu: ${row.members?.name || 'pracovník'}`} accept=".pdf,.jpg,.jpeg,.png" className="absolute inset-0 w-full cursor-pointer opacity-0" disabled={Boolean(processingId)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(row, file); }} /></label>}
      {['approved', 'invoice_uploaded'].includes(row.status) && <Button size="sm" disabled={Boolean(processingId) || (!row.invoice_url && !row.approved_without_invoice)} onClick={() => { setPayment(withScope(row)); setPaymentError(null); }}><Wallet className="mr-1 h-4 w-4" />Zaznamenat úhradu</Button>}
      {OPEN_PAYOUT_STATUSES.includes(row.status) && <Button size="sm" variant="ghost" disabled={Boolean(processingId)} onClick={() => setDecision({ request: withScope(row), action: 'cancel' })}>Stornovat</Button>}
    </div> },
  ];
  if (!authLoading && permissionsReady && (!user?.id || !canAdmin)) return <p role="alert" className="rounded-xl border bg-white p-6 text-sm text-slate-600">Správa hodinových výplat je dostupná přihlášenému administrátorovi výplat.</p>;
  return <div className="space-y-5"><PayoutPanel title="Schvalování hodinových výplat" description="Ověřte žádost, zkontrolujte doklad a zaznamenejte už provedenou úhradu." actions={<><Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading || Boolean(processingId)}><RefreshCw className="mr-1 h-4 w-4" />Obnovit</Button><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Filtrovat hodinové výplaty podle stavu" className="w-full sm:w-[210px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Všechny stavy</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></>}>
    <div className="border-b p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Hledat hodinové žádosti" className="pl-9" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Pracovník, projekt nebo období…" /></div></div>
    {state.key === actorKey && state.discrepancyError && <p role="alert" className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{state.discrepancyError}</p>}
    <PayoutRequestsTable columns={columns} items={filtered} getRowKey={row => row.id} loading={loading} error={state.key === actorKey ? state.error : null} loadingLabel="Načítám hodinové žádosti…" emptyTitle="Žádné hodinové žádosti" emptyDescription="Tomuto filtru neodpovídá žádná načtená žádost." />
  </PayoutPanel>
    {approval?._scope === actorKey && <AdminHourlyPayoutApprovalDialog isOpen request={approval} onClose={() => { if (!inFlight.current) setApproval(null); }} onConfirm={(_id, note, withoutInvoice) => runAction(approval, 'approve', { note, withoutInvoice })} />}
    {decision?.request?._scope === actorKey && <HourlyPayoutRequestDialog key={`${decision.request.id}-${decision.action}`} isOpen mode={decision.action} requestId={decision.request.id} onClose={() => { if (!inFlight.current) setDecision(null); }} onConfirm={note => runAction(decision.request, decision.action, { note })} isSubmitting={Boolean(processingId)} />}
    <ConfirmActionDialog open={payment?._scope === actorKey} onOpenChange={open => { if (!open) { setPayment(null); setPaymentError(null); } }} title="Zaznamenat provedenou úhradu?" description={<>{payment?.members?.name || 'Pracovník'} · {money(payment?.total_amount)}. Potvrďte, že platba již proběhla mimo portál. Tato akce uzavře žádost jako vyplacenou a žádné peníze neposílá.{paymentError && <span role="alert" className="mt-3 block text-red-800">{paymentError}</span>}</>} confirmLabel="Úhrada proběhla – zaznamenat" loading={Boolean(processingId)} onConfirm={async () => { try { await runAction(payment, 'paid'); setPayment(null); } catch (error) { setPaymentError(getFinanceErrorMessage(error)); } }} />
    <ForwardInvoiceDialog open={forward?._scope === actorKey} onOpenChange={open => { if (!open) setForward(null); }} payout={forward?._scope === actorKey ? forward : null} type="hourly" />
  </div>;
}
