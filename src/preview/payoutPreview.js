// Local demonstration of payout transitions; no bank, email or production backend calls.
export const payoutRpcs = new Set(['create_hourly_payout_request', 'approve_hourly_payout_request', 'reject_hourly_payout_request', 'mark_hourly_payout_paid', 'cancel_hourly_payout_request', 'approve_payout', 'reject_payout', 'mark_payout_paid', 'cancel_payout_request']);
const active = ['pending', 'approved', 'invoice_uploaded'];
const invalid = message => ({ data: null, error: { code: 'PREVIEW_VALIDATION', message } });
export function runPayoutRpc(name, args, { tables, memberId, isAdmin, newId, changed }) {
  const hourly = name.includes('hourly');
  const table = hourly ? 'hourly_payout_requests' : 'payouts';
  const now = new Date().toISOString();
  if (name === 'create_hourly_payout_request') {
    const owner = args.p_member_id;
    if (owner !== memberId) return invalid('Žádost lze vytvořit pouze pro vlastní účet.');
    if (!Number.isInteger(args.p_payout_month) || args.p_payout_month < 1 || args.p_payout_month > 12 || !Number.isInteger(args.p_payout_year)) return invalid('Neplatný měsíc.');
    const month = `${args.p_payout_year}-${String(args.p_payout_month).padStart(2, '0')}-01`;
    if (tables[table].some(row => row.member_id === owner && row.payout_month === args.p_payout_month && row.payout_year === args.p_payout_year && [...active, 'paid'].includes(row.status))) return invalid('Za tento měsíc se již vyřizuje žádost.');
    const submission = tables.attendance_submissions.find(row => row.member_id === owner && row.month_date === month && row.status === 'approved');
    if (!submission) return invalid('Docházka není schválená.');
    const rows = (tables.labor_cost_ledger || []).filter(row => row.member_id === owner && row.posting_month === month && row.status === 'accrued');
    const total_hours = rows.reduce((sum, row) => sum + Number(row.hours), 0);
    const total_amount = rows.reduce((sum, row) => sum + Number(row.pay_amount), 0);
    if (!rows.length || !Number.isFinite(total_amount) || total_amount <= 0 || total_hours <= 0) return invalid('Nejsou podklady k vyplacení.');
    const saved = { id: newId(), member_id: owner, payout_month: args.p_payout_month, payout_year: args.p_payout_year, month_date: month,
      total_hours, total_amount, hourly_rate: total_amount / total_hours, status: 'pending', created_at: now, request_date: now,
      request_type: args.p_request_type || 'regular', attendance_snapshot: rows.map(row => ({ ledger_id: row.id, attendance_id: row.attendance_id, date: row.work_date, hours: row.hours, hourly_rate: row.hourly_rate, pay_amount: row.pay_amount, currency: row.currency, project_id: row.project_id, realization_id: row.realization_id, funding_mode: row.funding_mode })), invoice_url: null };
    tables[table].push(saved);
    rows.forEach(row => Object.assign(row, { hourly_payout_request_id: saved.id }));
    changed(); return saved;
  }
  const id = hourly ? args.p_request_id : args.p_payout_id;
  const row = tables[table].find(item => item.id === id);
  if (!row || (!isAdmin && row.member_id !== memberId)) return invalid('Žádost není dostupná.');
  const action = name.split('_')[0];
  if (action !== 'cancel' && !isAdmin) return invalid('Rozhoduje administrátor.');
  if (action === 'cancel') {
    if (row.status === 'cancelled') return structuredClone(row);
    if (!(isAdmin ? active.includes(row.status) : row.status === 'pending')) return invalid('Tuto žádost nelze stornovat.');
    if (hourly && isAdmin && row.member_id !== memberId && !String(args.p_reason || '').trim()) return invalid('Vyplňte důvod storna.');
  }
  if (['approve', 'reject'].includes(action) && row.status !== 'pending') return invalid('Žádost již byla zpracována.');
  const reason = String(args.p_rejection_reason || args.p_admin_note || args.p_reason || '').trim();
  if (action === 'reject' && !reason) return invalid('Vyplňte důvod zamítnutí.');
  if (action === 'mark' && !(row.status === 'invoice_uploaded' || row.status === 'approved' && row.approved_without_invoice)) return invalid('Před evidencí úhrady chybí schválení nebo faktura.');
  const status = { approve: 'approved', reject: 'rejected', mark: 'paid', cancel: 'cancelled' }[action];
  if (!status) return invalid('Nepodporovaná operace.');
  Object.assign(row, { status, updated_at: now });
  if (action === 'approve') Object.assign(row, { approved_without_invoice: !!args.p_approved_without_invoice, approved_by: memberId, approved_at: now, admin_note: reason || null });
  if (action === 'approve' && hourly) (tables.labor_cost_ledger || []).filter(item => item.hourly_payout_request_id === id).forEach(item => { item.status = 'payable'; });
  if (action === 'cancel') row.cancellation_reason = reason || null;
  if (action === 'reject') Object.assign(row, { rejection_reason: reason, admin_note: reason });
  if (action === 'mark') row.paid_at = now;
  if (hourly && ['cancel', 'reject', 'mark'].includes(action)) (tables.labor_cost_ledger || []).filter(item => item.hourly_payout_request_id === id).forEach(item => {
    item.status = action === 'mark' ? 'paid' : 'accrued';
    if (action !== 'mark') item.hourly_payout_request_id = null;
  });
  tables.audit_logs ||= [];
  tables.audit_logs.push({ id: newId(), action: name, table_name: table, record_id: id, created_at: now, details: { [hourly ? 'request_id' : 'payout_id']: id, reason, status } });
  changed(); return structuredClone(row);
}
