import { loadPayoutRows, OPEN_PAYOUT_STATUSES } from './payoutWorkspaceData.js';
import { fetchAllFinancialRows } from './financePresentation.js';
import { getHourlyPayoutDisplay } from './hourlyPayoutDisplay.js';

export async function loadHourlyAdminWorkspace(client, { actorId, memberId, canAdmin, signal }) {
  if (!actorId || !canAdmin) throw new Error('Správa hodinových výplat je dostupná přihlášenému administrátorovi výplat.');
  const [requests, discrepancies] = await Promise.allSettled([
    loadPayoutRows(client, { kind: 'hourly', memberId, canAdmin, signal }),
    fetchAllFinancialRows(() => client.rpc('get_hourly_payout_discrepancies').order('request_id'), signal),
  ]);
  if (signal?.aborted) throw new DOMException('Načítání bylo přerušeno.', 'AbortError');
  if (requests.status === 'rejected') throw requests.reason;
  const discrepancyRows = discrepancies.status === 'fulfilled' ? discrepancies.value : null;
  const byId = new Map((discrepancyRows || []).map(row => [row.request_id, row]));
  return {
    rows: requests.value.map(row => ({ ...row, display: getHourlyPayoutDisplay(row), discrepancy: byId.get(row.id) || null })),
    discrepancyError: discrepancyRows === null ? 'Kontrolu souladu žádostí s docházkou se nepodařilo načíst. Zobrazený seznam není potvrzením, že údaje souhlasí.' : null,
  };
}

export function hourlyAdminMutation(request, action, { note = '', withoutInvoice = false } = {}) {
  if (!request?.id) throw new Error('Žádost není dostupná. Obnovte přehled.');
  const reason = String(note || '').trim();
  if (reason.length > 500) throw new Error('Odůvodnění může mít nejvýše 500 znaků.');
  if (['reject', 'cancel'].includes(action) && !reason) throw new Error('Vyplňte důvod, aby bylo rozhodnutí dohledatelné.');
  if (action === 'approve' && withoutInvoice && !reason) throw new Error('Uveďte důvod výjimky ze standardního dokladu.');
  if (action === 'approve' && request.status === 'pending') return { rpc: 'approve_hourly_payout_request', args: { p_request_id: request.id, p_admin_note: reason || null, p_approved_without_invoice: Boolean(withoutInvoice) }, status: 'approved' };
  if (action === 'reject' && request.status === 'pending') return { rpc: 'reject_hourly_payout_request', args: { p_request_id: request.id, p_rejection_reason: reason }, status: 'rejected' };
  if (action === 'cancel' && OPEN_PAYOUT_STATUSES.includes(request.status)) return { rpc: 'cancel_hourly_payout_request', args: { p_request_id: request.id, p_reason: reason }, status: 'cancelled' };
  if (action === 'paid' && ['approved', 'invoice_uploaded'].includes(request.status) && (request.invoice_url || request.approved_without_invoice)) return { rpc: 'mark_hourly_payout_paid', args: { p_request_id: request.id }, status: 'paid' };
  throw new Error('Tuto změnu stav žádosti neumožňuje. Obnovte přehled.');
}

export async function saveHourlyAdminAction(client, request, action, options, { actorId, canAdmin }) {
  if (!actorId || !canAdmin) throw new Error('Pro tuto operaci nemáte oprávnění.');
  const mutation = hourlyAdminMutation(request, action, options);
  const { data, error } = await client.rpc(mutation.rpc, mutation.args);
  if (error) throw error;
  if (data?.id !== request.id || data.status !== mutation.status) throw new Error('Server nepotvrdil požadovaný stav. Před opakováním obnovte přehled.');
  return data;
}
