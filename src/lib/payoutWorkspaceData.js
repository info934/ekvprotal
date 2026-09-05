import { fetchAllListRows } from './listWorkspaceState.js';

export const PAYOUT_STATUSES = ['pending', 'approved', 'invoice_uploaded', 'paid', 'rejected', 'cancelled'];
export const OPEN_PAYOUT_STATUSES = ['pending', 'approved', 'invoice_uploaded'];
export const finitePayoutAmount = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function sumPayoutAmounts(rows, field) {
  if (!Array.isArray(rows)) return null;
  const amounts = rows.map(row => finitePayoutAmount(row[field]));
  return amounts.some(value => value === null) ? null : finitePayoutAmount(amounts.reduce((sum, value) => sum + value, 0));
}

export async function loadPayoutRows(client, { kind = 'fixed', memberId, canAdmin = false, signal }) {
  if (!canAdmin && !memberId) throw new Error('Účet není propojený se zaměstnancem. Výplaty nelze načíst.');
  const table = kind === 'hourly' ? 'hourly_payout_requests' : 'payouts';
  const select = kind === 'hourly'
    ? '*,projects(name,code),members:members!hourly_payout_requests_member_id_fkey(name,email,auth_user_id)'
    : '*,members:members!payouts_member_id_fkey(name,email,auth_user_id),approved_member:members!payouts_approved_by_fkey(name,email),payout_items(*,projects(name,code),realizations:realizations!payout_items_realization_id_fkey(name))';
  return fetchAllListRows((from, to) => {
    let query = client.from(table).select(select).order(kind === 'hourly' ? 'created_at' : 'request_date', { ascending: false }).order('id').range(from, to);
    if (!canAdmin) query = query.eq('member_id', memberId);
    return signal ? query.abortSignal(signal) : query;
  });
}

export async function loadPayoutWorkspace(client, options) {
  const kinds = ['fixed', 'hourly'];
  const results = await Promise.allSettled(kinds.map(kind => loadPayoutRows(client, { ...options, kind })));
  if (options.signal?.aborted) throw new DOMException('Načítání přerušeno.', 'AbortError');
  return Object.fromEntries(kinds.map((kind, index) => [kind, results[index].status === 'fulfilled'
    ? { rows: results[index].value, error: null }
    : { rows: null, error: results[index].reason?.message || 'Výplaty se nepodařilo načíst.' }]));
}

export function summarizePayouts(rows, amountField = 'amount') {
  if (!Array.isArray(rows)) return Object.fromEntries(['totalCount','activeCount','paidCount','pendingCount','invoiceReadyCount','activeAmount','paidAmount','awaitingInvoiceCount','readyToPayCount'].map(key => [key, null]));
  const active = rows.filter(row => OPEN_PAYOUT_STATUSES.includes(row.status));
  const paid = rows.filter(row => row.status === 'paid');
  return {
    totalCount: rows.length, activeCount: active.length, paidCount: paid.length,
    pendingCount: rows.filter(row => row.status === 'pending').length,
    invoiceReadyCount: rows.filter(row => row.status === 'invoice_uploaded').length,
    awaitingInvoiceCount: rows.filter(row => row.status === 'approved' && !row.approved_without_invoice).length,
    readyToPayCount: rows.filter(row => row.status === 'invoice_uploaded' || (row.status === 'approved' && row.approved_without_invoice)).length,
    activeAmount: sumPayoutAmounts(active, amountField), paidAmount: sumPayoutAmounts(paid, amountField),
  };
}
export const addKnownPayoutTotals = (left, right) => left == null || right == null ? null : left + right;

export function payoutNextStep(row, canAdmin = false) {
  if (row.status === 'pending') return canAdmin ? 'Zkontrolovat a rozhodnout o žádosti' : 'Čeká na rozhodnutí administrátora';
  if (row.status === 'approved') return row.approved_without_invoice ? 'Po úhradě zaznamenat vyplacení' : 'Doplnit fakturu k žádosti';
  if (row.status === 'invoice_uploaded') return canAdmin ? 'Zkontrolovat doklad a po úhradě uzavřít' : 'Doklad čeká na kontrolu administrátorem';
  if (row.status === 'paid') return 'Vyplacení je zaznamenáno';
  return 'Uzavřeno · zůstává v historii';
}

export function filterPayoutRows(rows, { search = '', status = 'all', view = 'pending', invoice = 'all' } = {}) {
  const needle = search.trim().toLocaleLowerCase('cs-CZ');
  return (rows || []).filter(row => {
    if (status !== 'all' && row.status !== status) return false;
    if (view === 'pending' && !OPEN_PAYOUT_STATUSES.includes(row.status)) return false;
    if (invoice === 'yes' && row.approved_without_invoice !== true) return false;
    if (invoice === 'no' && row.approved_without_invoice === true) return false;
    const text = [row.members?.name, row.variable_symbol, row.description,
      ...(row.payout_items || []).flatMap(item => [item.projects?.name, item.projects?.code, item.realizations?.name])]
      .filter(value => value != null).join(' ').toLocaleLowerCase('cs-CZ');
    return !needle || text.includes(needle);
  });
}

export async function cancelOwnHourlyRequest(client, requestId) {
  if (!requestId) throw new Error('Nelze určit vlastní žádost.');
  const { data, error } = await client.rpc('cancel_hourly_payout_request', { p_request_id: requestId, p_reason: null });
  if (error) throw error;
  if (data?.id !== requestId || data.status !== 'cancelled') throw new Error('Server nepotvrdil zrušení žádosti. Obnovte přehled.');
  return data;
}

export async function loadHourlyMonth(client, { memberId, monthDate, signal }) {
  if (!memberId || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(monthDate) || Number(monthDate.slice(0, 4)) < 1) throw new Error('Vyberte platný měsíc a vlastní zaměstnanecký účet.');
  let submissionQuery = client.from('attendance_submissions').select('id,status,total_hours,month_date').eq('member_id', memberId).eq('month_date', monthDate).maybeSingle();
  if (signal) submissionQuery = submissionQuery.abortSignal(signal);
  const [submission, rows] = await Promise.all([
    submissionQuery,
    fetchAllListRows((from, to) => {
      let query = client.from('labor_cost_ledger').select('id,hours,pay_amount').eq('member_id', memberId).eq('posting_month', monthDate).eq('status', 'accrued').order('id').range(from, to);
      return signal ? query.abortSignal(signal) : query;
    }),
  ]);
  if (submission.error) throw submission.error;
  const hours = sumPayoutAmounts(rows, 'hours');
  const amount = sumPayoutAmounts(rows, 'pay_amount');
  if (hours === null || amount === null) throw new Error('Podklady obsahují neplatný počet hodin nebo částku. Žádost nelze bezpečně sestavit.');
  return { submission: submission.data, hours, amount, weightedRate: hours > 0 ? amount / hours : null };
}

export function hourlyMonthRequestState(month, requests, monthDate) {
  const [year, number] = monthDate.split('-').map(Number);
  if (!Array.isArray(requests) || !month) return { canSubmit: false, tone: 'info', title: 'Načítám podklady', description: 'Ověřujeme docházku i historii žádostí pro vybraný měsíc.' };
  const paid = requests.find(row => Number(row.payout_year) === year && Number(row.payout_month) === number && row.status === 'paid' && (!row.request_type || row.request_type === 'regular'));
  if (paid) return { canSubmit: false, tone: 'info', title: 'Odměna za tento měsíc je vyplacená', description: 'Případný doplatek řešte s administrátorem. Další běžnou žádost za stejný měsíc nelze odeslat.' };
  const active = (requests || []).find(row => Number(row.payout_year) === year && Number(row.payout_month) === number && OPEN_PAYOUT_STATUSES.includes(row.status));
  if (active) return { canSubmit: false, tone: 'info', title: 'Žádost za tento měsíc se již vyřizuje', description: 'Její stav a doklady najdete v historii níže.', active };
  if (!month) return { canSubmit: false, tone: 'info', title: 'Načítám podklady', description: 'Částku a stav docházky ověřujeme pro vybraný měsíc.' };
  if (month.submission?.status !== 'approved') return { canSubmit: false, tone: 'warning', title: month.submission?.status === 'submitted' ? 'Docházka čeká na schválení' : 'Docházka zatím není schválená', description: 'Nejprve doplňte a odešlete docházku za tento měsíc. Po jejím schválení můžete požádat o odměnu.' };
  if (finitePayoutAmount(month.hours) === null || finitePayoutAmount(month.amount) === null || month.hours < 0 || month.amount < 0) return { canSubmit: false, tone: 'warning', title: 'Podklady je potřeba zkontrolovat', description: 'Počet hodin nebo částka nejsou platné. Obnovte přehled nebo kontaktujte administrátora.' };
  if (month.hours <= 0 || month.amount <= 0) return { canSubmit: false, tone: 'info', title: 'Žádné nové hodiny k vyplacení', description: 'Za tento měsíc nejsou další nezařazené podklady pro žádost. Zkontrolujte historii vyplacení.' };
  return { canSubmit: true, tone: 'success', title: 'Připraveno k odeslání', description: 'Docházka je schválená. Částka vychází ze sazeb uložených u odpracovaných hodin.' };
}
