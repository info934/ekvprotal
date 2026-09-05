import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPayoutRows, loadPayoutWorkspace, loadHourlyMonth, summarizePayouts, sumPayoutAmounts, addKnownPayoutTotals, filterPayoutRows, hourlyMonthRequestState, cancelOwnHourlyRequest } from '../src/lib/payoutWorkspaceData.js';

function database(tables, { cap = 2, fail } = {}) {
  const reads = [];
  return { reads, from(table) {
    let start = 0, end = Infinity, single = false; const filters = [];
    const query = { select() { return this; }, order() { return this; }, abortSignal() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      range(from, to) { start = from; end = to + 1; return this; }, maybeSingle() { single = true; return this; },
      then(resolve, reject) {
        reads.push({ table, start, end, filters });
        if (reads.length > 30) return Promise.reject(new Error('Pagination never advanced')).then(resolve, reject);
        const error = fail?.(table, start);
        const rows = (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
        return Promise.resolve(error ? { error, data: null } : { error: null, data: single ? rows[0] || null : rows.slice(start, Math.min(end, start + cap)) }).then(resolve, reject);
      },
    }; return query;
  } };
}
test('payout paging advances through server-capped pages and applies ownership to every page', async () => {
  const rows = Array.from({ length: 7 }, (_, id) => ({ id, member_id: id % 2 ? 'other' : 'own' }));
  const db = database({ payouts: rows });
  assert.deepEqual((await loadPayoutRows(db, { memberId: 'own' })).map(row => row.id), [0, 2, 4, 6]);
  assert.deepEqual(db.reads.map(row => row.start), [0, 2, 4]);
  assert.ok(db.reads.every(row => row.filters.some(([key, value]) => key === 'member_id' && value === 'own')));
});
test('missing member fails closed before any unscoped query', async () => {
  const db = database({});
  await assert.rejects(loadPayoutRows(db, {}), /propojený/);
  assert.equal(db.reads.length, 0);
});
test('later page error cannot turn partial history into a valid total', async () => {
  const db = database({ payouts: [{ id: 1 }, { id: 2 }, { id: 3 }], hourly_payout_requests: [{ id: 4, total_amount: 450, status: 'paid' }] }, {
    fail: (table, start) => table === 'payouts' && start === 2 ? new Error('network unavailable') : null,
  });
  const result = await loadPayoutWorkspace(db, { canAdmin: true });
  assert.equal(result.fixed.rows, null); assert.match(result.fixed.error, /network/);
  assert.equal(result.hourly.rows.length, 1);
  assert.equal(addKnownPayoutTotals(summarizePayouts(result.fixed.rows).paidAmount, summarizePayouts(result.hourly.rows, 'total_amount').paidAmount), null);
});
test('unknown or invalid money never renders as an actual zero or finite total', () => {
  for (const amount of [null, undefined, '', NaN, Infinity]) assert.equal(sumPayoutAmounts([{ amount }], 'amount'), null);
  assert.equal(sumPayoutAmounts([{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }], 'amount'), null);
  assert.equal(sumPayoutAmounts([], 'amount'), 0);
  assert.equal(sumPayoutAmounts([{ amount: '0' }], 'amount'), 0);
});
test('approved exceptions are ready to record payment and not waiting for an invoice', () => {
  const result = summarizePayouts([{ amount: 100, status: 'approved', approved_without_invoice: true }, { amount: 200, status: 'approved' }, { amount: 300, status: 'invoice_uploaded' }, { amount: 99, status: 'cancelled' }]);
  assert.equal(result.readyToPayCount, 2); assert.equal(result.awaitingInvoiceCount, 1); assert.equal(result.activeAmount, 600);
});
test('search covers realizations, project codes and numeric payment symbols with closed-state filters', () => {
  const row = { status: 'paid', variable_symbol: 12345, payout_items: [{ realizations: { name: 'Javorová elektro' }, projects: { code: 'PR-26-001' } }] };
  for (const search of ['javorová', 'PR-26', '12345']) assert.deepEqual(filterPayoutRows([row], { view: 'all', status: 'paid', search }), [row]);
  assert.equal(filterPayoutRows([row]).length, 0);
});
test('month amount sums every accrued ledger row using historic amounts, not current rate', async () => {
  const db = database({ attendance_submissions: [{ member_id: 'm', month_date: '2026-08-01', status: 'approved' }], labor_cost_ledger: [1, 2, 3].map(id => ({ id, member_id: 'm', posting_month: '2026-08-01', status: 'accrued', hours: 1, pay_amount: id * 100 })) });
  const month = await loadHourlyMonth(db, { memberId: 'm', monthDate: '2026-08-01' });
  assert.equal(month.hours, 3); assert.equal(month.amount, 600); assert.equal(month.weightedRate, 200);
  assert.equal(hourlyMonthRequestState(month, [], '2026-08-01').canSubmit, true);
  assert.equal(hourlyMonthRequestState(month, [{ status: 'pending', payout_year: 2026, payout_month: 8 }], '2026-08-01').canSubmit, false);
});
test('invalid month, unavailable ledger or unapproved attendance cannot create a payout', async () => {
  await assert.rejects(loadHourlyMonth(database({}), { memberId: 'm', monthDate: '2026-13-01' }), /platný/);
  await assert.rejects(loadHourlyMonth(database({}, { fail: table => table === 'labor_cost_ledger' ? new Error('ledger unavailable') : null }), { memberId: 'm', monthDate: '2026-08-01' }), /ledger unavailable/);
  assert.equal(hourlyMonthRequestState(null, [], '2026-08-01').canSubmit, false);
  assert.equal(hourlyMonthRequestState({ submission: { status: 'submitted' }, amount: 1000, hours: 10 }, [], '2026-08-01').canSubmit, false);
});
test('cancellation requires server confirmation, never direct deletion or a success on denied RPC', async () => {
  const calls = []; const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'r', status: 'cancelled' } }; } };
  assert.equal((await cancelOwnHourlyRequest(client, 'r')).status, 'cancelled');
  assert.equal(calls[0][0], 'cancel_hourly_payout_request');
  await assert.rejects(cancelOwnHourlyRequest({ rpc: async () => ({ error: new Error('denied') }) }, 'r'), /denied/);
  await assert.rejects(cancelOwnHourlyRequest({ rpc: async () => ({ data: null }) }, 'r'), /nepotvrdil/);
});
test('paid regular months and incomplete historic request data block a second regular payout', () => {
  const month = { submission: { status: 'approved' }, hours: 8, amount: 4000 };
  assert.equal(hourlyMonthRequestState(month, null, '2026-08-01').canSubmit, false);
  assert.equal(hourlyMonthRequestState(month, [{ payout_year: 2026, payout_month: 8, status: 'paid', request_type: 'regular' }], '2026-08-01').canSubmit, false);
  for (const value of [NaN, undefined, null, -5]) assert.equal(hourlyMonthRequestState({ ...month, amount: value }, [], '2026-08-01').canSubmit, false);
  assert.equal(hourlyMonthRequestState(month, [{ payout_year: 2026, payout_month: 8, status: 'cancelled' }], '2026-08-01').canSubmit, true);
});
