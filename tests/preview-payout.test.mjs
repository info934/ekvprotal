import test from 'node:test';
import assert from 'node:assert/strict';
import { supabase, resetPreviewData } from '../src/preview/supabasePreviewClient.js';
import { MEMBER_ID, ADMIN_ID, uuid } from '../src/preview/fixtures.js';
import { setPreviewRole } from '../src/preview/previewState.js';
import { loadPayoutRows, loadHourlyMonth, cancelOwnHourlyRequest } from '../src/lib/payoutWorkspaceData.js';

test('actual preview adapter finishes all financial pages and month ledger queries', async () => {
  resetPreviewData(); setPreviewRole('member');
  assert.equal((await loadPayoutRows(supabase, { memberId: MEMBER_ID })).length, 2);
  const month = await loadHourlyMonth(supabase, { memberId: MEMBER_ID, monthDate: '2026-08-01' });
  assert.equal(month.amount, 7200); assert.equal(month.hours, 16);
});
test('preview own creation, duplicate guard and audited cancellation preserve history', async () => {
  resetPreviewData(); setPreviewRole('member');
  const args = { p_member_id: MEMBER_ID, p_payout_month: 8, p_payout_year: 2026 };
  const result = await supabase.rpc('create_hourly_payout_request', args);
  assert.equal(result.error, null); assert.equal(result.data.total_amount, 7200);
  assert.ok((await supabase.rpc('create_hourly_payout_request', args)).error);
  assert.ok((await supabase.rpc('create_hourly_payout_request', { ...args, p_member_id: ADMIN_ID })).error);
  const saved = await cancelOwnHourlyRequest(supabase, result.data.id);
  assert.equal(saved.status, 'cancelled');
  assert.equal((await supabase.from('hourly_payout_requests').select().eq('id', saved.id).single()).data.status, 'cancelled');
  assert.equal((await cancelOwnHourlyRequest(supabase, saved.id)).id, saved.id);
  assert.equal((await supabase.rpc('create_hourly_payout_request', args)).data.status, 'pending');
});
test('preview hourly approval and payment require admin and respect the document step', async () => {
  resetPreviewData(); setPreviewRole('member');
  assert.ok((await supabase.rpc('approve_hourly_payout_request', { p_request_id: uuid(2001) })).error);
  setPreviewRole('admin');
  assert.ok((await supabase.rpc('mark_hourly_payout_paid', { p_request_id: uuid(2001) })).error);
  assert.equal((await supabase.rpc('approve_hourly_payout_request', { p_request_id: uuid(2001), p_approved_without_invoice: true })).data.status, 'approved');
  assert.equal((await supabase.rpc('mark_hourly_payout_paid', { p_request_id: uuid(2001) })).data.status, 'paid');
  assert.ok((await supabase.rpc('cancel_hourly_payout_request', { p_request_id: uuid(2001), p_reason: 'test' })).error);
  const ledger = (await supabase.from('labor_cost_ledger').select().eq('hourly_payout_request_id', uuid(2001))).data;
  assert.ok(ledger.every(row => row.status === 'paid'));
});
test('preview fixed rejection requires a reason and payment updates only the eligible request', async () => {
  resetPreviewData(); setPreviewRole('admin');
  assert.ok((await supabase.rpc('reject_payout', { p_payout_id: uuid(1001) })).error);
  assert.equal((await supabase.rpc('reject_payout', { p_payout_id: uuid(1001), p_admin_note: 'Doplnit předání' })).data.status, 'rejected');
  assert.equal((await supabase.rpc('mark_payout_paid', { p_payout_id: uuid(1002) })).data.status, 'paid');
  assert.equal((await supabase.from('audit_logs').select()).data.length, 2);
});
