import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, startOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { AlertCircle, CalendarDays, Clock, FileWarning, RefreshCw, Send, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { FinanceAmount } from '@/components/finance/FinanceWorkspace';
import InvoiceUpload from './InvoiceUpload';
import InvoicePreview from './InvoicePreview';
import MonthSelector from './MonthSelector';
import HoursTable from './HoursTable';
import { sendHourlyPayoutRequestEmail, sendPayoutRequestEmail } from '@/lib/email';
import { createHourlyPayoutRequest } from '@/lib/hourlyPayoutWorkflowService';
import { EmptyPayoutState, formatHours, PayoutPanel, PayoutStatusBadge } from '@/components/payouts/PayoutShared';
import { getHourlyPayoutDisplay } from '@/lib/hourlyPayoutDisplay';
import { cancelOwnHourlyRequest, hourlyMonthRequestState, loadHourlyMonth, loadPayoutRows, summarizePayouts } from '@/lib/payoutWorkspaceData';
import { getFinanceErrorMessage } from '@/lib/financePresentation';

export default function HourlyPayoutRequest({ onPayoutRequested }) {
  const { memberId, user, isPrivateMode } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const requestedMonth = params.get('month');
  const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(requestedMonth || '') && Number(requestedMonth.slice(0,4)) > 0 ? `${requestedMonth.slice(0,7)}-01` : format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const setSelectedMonth = month => setParams(current => { const next = new URLSearchParams(current); next.set('tab', 'hourly'); next.set('month', month); return next; }, { replace: true });
  const key = `${user?.id}|${memberId}`;
  const liveKey = useRef(key); liveKey.current = key;
  const monthKey = `${key}|${selectedMonth}`;
  const [base, setBase] = useState({ key: null });
  const [monthState, setMonthState] = useState({ key: null });
  const [reload, setReload] = useState(0);
  const [monthData, setMonthData] = useState({ breakdown: {} });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelRequest, setCancelRequest] = useState(null);
  const [cancelError, setCancelError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const mutationLock = useRef(false);
  useEffect(() => { setCancelRequest(null); setCancelError(null); setHistoryPage(1); }, [key]);
  const refresh = () => { setReload(current => current + 1); onPayoutRequested?.(); };

  useEffect(() => {
    const controller = new AbortController();
    setBase({ key, loading: true });
    if (!memberId) { setBase({ key, loading: false, error: 'Účet není propojený se zaměstnancem.' }); return () => controller.abort(); }
    const fetch = async () => {
      const [requests, member] = await Promise.allSettled([
        loadPayoutRows(supabase, { kind: 'hourly', memberId, signal: controller.signal }),
        supabase.from('members').select('id,name,email').eq('id', memberId).maybeSingle().abortSignal(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setBase({ key, loading: false, requests: requests.status === 'fulfilled' ? requests.value.map(row => ({ ...row, display: getHourlyPayoutDisplay(row) })) : null,
        error: requests.status === 'rejected' ? getFinanceErrorMessage(requests.reason) : null,
        member: member.status === 'fulfilled' && !member.value.error ? member.value.data : null });
    };
    fetch();
    return () => controller.abort();
  }, [key, memberId, reload]);

  useEffect(() => {
    const controller = new AbortController();
    setMonthState({ key: monthKey, loading: true });
    setMonthData({ breakdown: {} });
    loadHourlyMonth(supabase, { memberId, monthDate: selectedMonth, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setMonthState({ key: monthKey, loading: false, data }); })
      .catch(error => { if (!controller.signal.aborted) setMonthState({ key: monthKey, loading: false, error: getFinanceErrorMessage(error) }); });
    return () => controller.abort();
  }, [memberId, monthKey, selectedMonth, reload]);

  const requests = base.key === key ? base.requests : null;
  const month = monthState.key === monthKey ? monthState.data : null;
  const loading = base.key !== key || base.loading;
  const monthLoading = monthState.key !== monthKey || monthState.loading;
  const monthError = monthState.key === monthKey ? monthState.error : null;
  const stats = useMemo(() => summarizePayouts(requests, 'total_amount'), [requests]);
  const readiness = hourlyMonthRequestState(month, requests, selectedMonth);
  const canSubmit = readiness.canSubmit && !loading && !base.error && !monthLoading && !monthError;
  const count = value => value == null ? '—' : value;

  const handleRequestPayout = async () => {
    if (!canSubmit || mutationLock.current || liveKey.current !== key) return;
    mutationLock.current = true;
    setIsSubmitting(true);
    try {
      const [year, monthNumber] = selectedMonth.split('-').map(Number);
      const request = await createHourlyPayoutRequest({ memberId, payoutMonth: monthNumber, payoutYear: year, requestType: 'regular' });
      if (!request?.id) throw new Error('Server nepotvrdil vytvoření žádosti. Před opakováním obnovte přehled.');
      if (liveKey.current !== key) return;
      refresh();
      const results = await Promise.allSettled([
        sendHourlyPayoutRequestEmail({ requestId: request.id, memberName: base.member?.name || 'Pracovník', hours: request.total_hours ?? request.hours ?? month.hours,
          projects: Object.keys(request.breakdown || monthData.breakdown || {}).join(', ') || 'Měsíční docházka', totalAmount: request.total_amount ?? month.amount, createdAt: request.created_at || new Date().toISOString() }),
        sendPayoutRequestEmail({ payoutId: request.id, payoutType: 'hourly', memberId, amount: request.total_amount ?? month.amount }),
      ]);
      const notified = results.every(result => result.status === 'fulfilled' && result.value?.success);
      toast({ title: 'Žádost byla vytvořena', description: notified ? 'Čeká na schválení administrátorem.' : 'Stav je uložený, ale e-mailové oznámení se nepodařilo potvrdit.', variant: notified ? 'default' : 'warning' });
    } catch (error) { toast({ title: 'Žádost se nepodařilo potvrdit', description: getFinanceErrorMessage(error), variant: 'destructive' }); setReload(current => current + 1); }
    finally { mutationLock.current = false; setIsSubmitting(false); }
  };
  const handleCancel = async () => {
    if (!cancelRequest || cancelRequest.member_id !== memberId || mutationLock.current || liveKey.current !== key) return;
    mutationLock.current = true;
    setIsCancelling(true);
    try { await cancelOwnHourlyRequest(supabase, cancelRequest.id); if (liveKey.current !== key) return; setCancelRequest(null); refresh(); toast({ title: 'Žádost byla stornována', description: 'Zůstává dohledatelná v historii.' }); }
    catch (error) { setCancelError(getFinanceErrorMessage(error)); }
    finally { mutationLock.current = false; setIsCancelling(false); }
  };

  return <div className="space-y-5">
    <PayoutPanel title="Hodinová odměna za měsíc" description="Schválená docházka → žádost o odměnu → doklad → vyplacení."
      actions={<Button variant="outline" onClick={refresh} disabled={loading || monthLoading}><RefreshCw className="mr-2 h-4 w-4" />Aktualizovat</Button>}>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 p-5"><MonthSelector value={selectedMonth} onChange={setSelectedMonth} /><Button asChild variant="outline"><Link to={`/attendance?month=${selectedMonth}`}><CalendarDays className="mr-2 h-4 w-4" />Otevřít docházku</Link></Button></div>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5"><p className="text-xs text-slate-500">Schválené hodiny k žádosti</p><p className="mt-2 text-2xl font-semibold">{monthLoading ? '…' : month ? formatHours(month.hours) : 'Nedostupné'}</p></div>
        <div className="p-5"><p className="text-xs text-slate-500">Částka k žádosti za měsíc</p><p className="mt-2 text-2xl font-semibold"><FinanceAmount value={month?.amount} exact /></p><p className="mt-1 text-xs text-slate-500">Ze sazeb evidovaných u jednotlivých hodin</p></div>
        <div className="p-5"><p className="text-xs text-slate-500">Moje vyplacené hodinové odměny</p><p className="mt-2 text-2xl font-semibold"><FinanceAmount value={stats.paidAmount} exact /></p><p className="mt-1 text-xs text-slate-500">Celá historie · {count(stats.activeCount)} otevřených žádostí</p></div>
      </div>
      <div className="space-y-4 p-5 pt-0">
        {monthError || base.error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><strong>Podklady nejsou úplné</strong><p>{monthError || base.error}</p><p>Odeslání je do obnovení údajů nedostupné.</p></div>
          : <div role="status" className={`flex gap-3 rounded-lg border p-4 text-sm ${readiness.canSubmit ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>{monthLoading ? 'Načítám podklady' : readiness.title}</strong><p className="mt-1">{readiness.description}</p></div></div>}
        <div className="flex justify-end"><Button onClick={handleRequestPayout} disabled={!canSubmit || isSubmitting}><Send className="mr-2 h-4 w-4" />{isSubmitting ? 'Odesílám…' : 'Odeslat žádost o odměnu'}</Button></div>
        <details className="rounded-lg border border-slate-200"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Zobrazit odpracované hodiny za {format(new Date(`${selectedMonth}T12:00:00`), 'LLLL yyyy', { locale: cs })}</summary><div className="border-t p-4"><HoursTable selectedMonth={selectedMonth} memberId={memberId} onDataFetched={setMonthData} /></div></details>
      </div>
    </PayoutPanel>
    <PayoutPanel title="Historie mých hodinových žádostí" description="Včetně vyplacených, zamítnutých a stornovaných žádostí.">
      {loading ? <p role="status" className="flex gap-2 p-6 text-sm text-slate-500"><Clock className="h-4 w-4 animate-spin" />Načítám historii…</p> : base.error ? <p role="alert" className="p-6 text-sm text-red-700">{base.error}</p> : !requests?.length ? <div className="p-5"><EmptyPayoutState title="Zatím nemáte žádné hodinové žádosti" description="Po odeslání se zde objeví stav, doklady a další postup." /></div> : <div className="divide-y divide-slate-100">{requests.slice(0, historyPage * 20).map(request => <article key={request.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
        <div className="min-w-0"><div className="mb-3 flex flex-wrap gap-2"><PayoutStatusBadge status={request.status} approvedWithoutInvoice={request.approved_without_invoice} />{request.approved_without_invoice && <Badge variant="outline"><FileWarning className="mr-1 h-3 w-3" />Bez faktury</Badge>}</div>
          <h3 className="font-semibold text-slate-900">{request.payout_month ? `Odměna za ${request.payout_month}/${request.payout_year}` : request.display?.assignmentLabel || 'Hodinová žádost'}</h3>
          <p className="mt-1 break-words text-sm text-slate-500">{request.display?.assignmentLabel || 'Měsíční docházka'} · {request.created_at ? new Date(request.created_at).toLocaleDateString('cs-CZ') : 'Datum neuvedeno'}</p>
          <p className="mt-3 flex flex-wrap gap-5 text-sm"><span>{formatHours(request.total_hours ?? request.hours)}</span><strong><FinanceAmount value={request.total_amount} exact /></strong></p>
          {request.rejection_reason && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">Důvod zamítnutí: {isPrivateMode ? 'Skryto' : request.rejection_reason}</p>}
          {request.status === 'pending' && <Button variant="ghost" className="mt-3" onClick={() => { setCancelRequest(request); setCancelError(null); }}>Stornovat žádost</Button>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">{request.invoice_url ? <InvoicePreview invoicePath={request.invoice_url} invoiceName={request.invoice_storage_metadata?.originalFileName} uploadedAt={request.invoice_uploaded_at} status={request.status} requestId={request.id} storageProvider={request.invoice_storage_provider} storageConnectionId={request.invoice_storage_connection_id} externalFileId={request.invoice_external_file_id} storageMetadata={request.invoice_storage_metadata} onDelete={refresh} />
          : request.status === 'approved' && !request.approved_without_invoice ? <InvoiceUpload requestId={request.id} memberId={memberId} projectReference={request.display?.projectReference || request.project_id} onUploadSuccess={refresh} />
          : <p className="text-sm text-slate-500">{request.status === 'pending' ? 'Nyní je na řadě schválení administrátorem.' : request.status === 'approved' ? 'Faktura se nevyžaduje. Čeká na evidenci úhrady.' : request.status === 'paid' ? 'Odměna je evidovaná jako vyplacená.' : 'Žádost je uzavřená; zůstává v historii.'}</p>}</div>
      </article>)}{requests.length > historyPage * 20 && <div className="p-4"><Button variant="outline" onClick={() => setHistoryPage(page => page + 1)}>Zobrazit další žádosti</Button></div>}</div>}
    </PayoutPanel>
    <Dialog open={Boolean(cancelRequest)} onOpenChange={open => { if (!open && !isCancelling) setCancelRequest(null); }}><FormDialogContent size="sm"><FormDialogHeader title="Stornovat hodinovou žádost?" description="Žádost se přestane vyřizovat, ale zůstane v historii. Později lze vytvořit novou žádost z dostupných schválených hodin." /><FormDialogBody><p className="text-sm"><Wallet className="mr-2 inline h-4 w-4" /><FinanceAmount value={cancelRequest?.total_amount} exact /></p>{cancelError && <p role="alert" className="mt-3 text-sm text-red-700">{cancelError}</p>}</FormDialogBody><FormDialogFooter><Button variant="outline" disabled={isCancelling} onClick={() => setCancelRequest(null)}>Ponechat žádost</Button><Button disabled={isCancelling} onClick={handleCancel}>{isCancelling ? 'Ukládám…' : 'Stornovat žádost'}</Button></FormDialogFooter></FormDialogContent></Dialog>
  </div>;
}
