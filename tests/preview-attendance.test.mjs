import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRpcs, runAttendanceRpc } from '../src/preview/attendancePreview.js';

const batch = '10000000-0000-4000-8000-000000000001';
const secondBatch = '10000000-0000-4000-8000-000000000002';
function setup() {
  let changes = 0, sequence = 0;
  const tables = { members: [{ id: 'worker', hourly_rate: 450 }, { id: 'admin', hourly_rate: 500 }, { id: 'other', hourly_rate: 350 }], projects: [{ id: 'project' }, { id: 'second' }], realizations: [{ id: 'realization' }], attendance: [], attendance_submissions: [], labor_cost_ledger: [], hourly_payout_requests: [], member_hourly_rate_history: [], project_members: [], realizace_team_members: [] };
  const context = { tables, memberId: 'worker', isAdmin: false, newId: () => `new-${++sequence}`, changed: () => changes++ };
  const run = (name, args, admin = false) => runAttendanceRpc(name, args, admin ? { ...context, memberId: 'admin', isAdmin: true } : context);
  const save = (records, id = batch) => run('save_attendance_records', { p_records: records, p_batch_id: id });
  const record = (overrides = {}) => ({ member_id: 'worker', date: '2026-09-03', hours: 4, project_id: 'project', description: 'Dokumentace', ...overrides });
  const submit = () => run('submit_attendance_month', { p_member_id: 'worker', p_month_date: '2026-09-01' });
  const approve = id => run('approve_attendance_submission', { p_submission_id: id }, true);
  return { tables, context, run, save, record, submit, approve, changes: () => changes };
}
test('advertised RPCs cover existing lifecycle plus atomic batches', () => {
  for (const name of ['save_attendance_records', 'save_attendance_record', 'delete_attendance_record', 'submit_attendance_month', 'approve_attendance_submission', 'reject_attendance_submission', 'return_attendance_submission_for_edit', 'withdraw_attendance_submission', 'delete_attendance_submission', 'revert_attendance_submission']) assert.equal(attendanceRpcs.has(name), true);
});
test('multi-day batch commits exactly once and canonical retry returns original saved rows', () => {
  const state = setup();
  const input = [state.record({ hours: '4', description: ' Dokumentace ' }), state.record({ date: '2026-09-04', project_id: null, realization_id: 'realization' })];
  const saved = state.save(input);
  assert.equal(saved.length, 2);
  assert.equal(state.tables.attendance.length, 2);
  const replay = state.save([state.record(), state.record({ date: '2026-09-04', project_id: null, realizace_id: 'realization' })]);
  assert.deepEqual(replay, saved);
  assert.equal(state.changes(), 1);
  assert.equal(Object.keys(state.tables).includes('__attendanceReceipts'), false);
  replay[0].hours = 99;
  assert.equal(state.tables.attendance[0].hours, 4);
});
test('same receipt cannot write different content or cross actors, including admins', () => {
  const state = setup(); state.save([state.record()]);
  assert.ok(state.save([state.record({ hours: 8 })]).error);
  assert.ok(state.run('save_attendance_records', { p_batch_id: batch, p_records: [state.record()] }, true).error);
  assert.equal(state.tables.attendance.length, 1);
  assert.equal(state.changes(), 1);
});
test('a failed batch leaves no records or receipt, allowing corrected retry with the same UUID', () => {
  const state = setup();
  assert.ok(state.save([state.record({ hours: 20 }), state.record({ hours: 5 })]).error);
  assert.equal(state.tables.attendance.length, 0);
  assert.equal(state.changes(), 0);
  assert.equal(state.save([state.record({ hours: 20 }), state.record({ hours: 4 })]).length, 2);
});
test('batch validates all references, dates, finite hours, exclusivity and one-member scope', () => {
  const state = setup();
  for (const invalid of [state.record({ date: '2026-02-30' }), state.record({ hours: Infinity }), state.record({ hours: 0 }), state.record({ realization_id: 'realization' }), state.record({ project_id: 'missing' }), state.record({ id: 'editing' }), state.record({ project_id: null, realization_id: 'realization', realizace_id: 'different' })]) assert.ok(state.save([state.record(), invalid]).error);
  assert.ok(state.save([state.record(), state.record({ member_id: 'other' })]).error);
  assert.ok(state.save([state.record()], null).error);
  assert.equal(state.tables.attendance.length, 0);
});
test('worker cannot create, edit, delete or submit another member records', () => {
  const state = setup();
  assert.equal(state.save([state.record({ member_id: 'other' })]).error.code, '42501');
  state.tables.attendance.push({ id: 'other-record', ...state.record({ member_id: 'other' }) });
  assert.equal(state.run('delete_attendance_record', { p_record_id: 'other-record' }).error.code, '42501');
  assert.equal(state.run('save_attendance_record', { p_record_id: 'other-record', p_member_id: 'worker', p_date: '2026-09-04', p_hours: 4, p_project_id: 'project' }).error.code, '42501');
  assert.equal(state.run('submit_attendance_month', { p_member_id: 'other', p_month_date: '2026-09-01' }).error.code, '42501');
});
test('editing can reallocate a day without double-counting itself and removes cached old labels', () => {
  const state = setup(); const saved = state.save([state.record({ hours: 20 })]);
  Object.assign(state.tables.attendance[0], { projects: { name: 'Old label' } });
  const edited = state.run('save_attendance_record', { p_record_id: saved[0].id, p_date: '2026-09-03', p_hours: 24, p_project_id: null, p_realizace_id: 'realization' });
  assert.equal(edited.id, saved[0].id);
  assert.equal(edited.hours, 24);
  assert.equal(edited.realizace_id, 'realization');
  assert.equal(edited.projects, undefined);
});
test('submit freezes writes for worker and admin, but receipt replay remains safe', () => {
  const state = setup(); const saved = state.save([state.record()]); const submission = state.submit();
  assert.equal(submission.status, 'submitted'); assert.equal(submission.total_hours, 4);
  assert.ok(state.save([state.record({ date: '2026-09-04' })], secondBatch).error);
  assert.ok(state.run('delete_attendance_record', { p_record_id: saved[0].id }, true).error);
  assert.deepEqual(state.save([state.record()]), saved);
  assert.equal(state.tables.attendance.length, 1);
  assert.ok(state.run('approve_attendance_submission', { p_submission_id: submission.id }).error);
});
test('return, resubmit and approve materializes date-effective rates, burden and sponsorship', () => {
  const state = setup(); state.save([state.record()]); const submission = state.submit();
  const returned = state.run('return_attendance_submission_for_edit', { p_submission_id: submission.id, p_notes: ' Opravte popis ' }, true);
  assert.equal(returned.status, 'returned'); assert.equal(returned.notes, 'Opravte popis');
  state.submit();
  state.tables.member_hourly_rate_history.push({ member_id: 'worker', valid_from: '2026-09-01', valid_to: null, hourly_rate: 500, employer_burden_percent: 20, currency: 'CZK' });
  state.tables.project_members.push({ member_id: 'worker', project_id: 'project', is_hourly: true, valid_from: '2026-08-01', hourly_funding_mode: 'member_reward', hourly_sponsor_member_id: 'admin', hourly_sponsor_percent: 25 });
  assert.equal(state.approve(submission.id).status, 'approved');
  const ledger = state.tables.labor_cost_ledger[0];
  assert.deepEqual([ledger.hours, ledger.hourly_rate, ledger.pay_amount, ledger.employer_cost, ledger.sponsor_reward_deduction, ledger.project_cost_impact], [4, 500, 2000, 2400, 600, 1800]);
  assert.equal(ledger.status, 'accrued'); assert.equal(ledger.attendance_submission_id, submission.id);
  assert.equal(state.tables.attendance[0].hourly_rate_snapshot, 500);
});
test('failed approval is atomic and keeps the submitted state without financial snapshots', () => {
  const state = setup(); state.tables.members[0].hourly_rate = 0;
  state.save([state.record()]); const submission = state.submit();
  assert.ok(state.approve(submission.id).error);
  assert.equal(state.tables.attendance_submissions[0].status, 'submitted');
  assert.equal(state.tables.labor_cost_ledger.length, 0);
  assert.equal(state.tables.attendance[0].financial_snapshot_at, undefined);
});
test('reopen reverses accrued ledger and reapproval refreshes the same entry after reassignment', () => {
  const state = setup(); const saved = state.save([state.record()]); const submission = state.submit(); state.approve(submission.id);
  const ledgerId = state.tables.labor_cost_ledger[0].id;
  assert.equal(state.run('revert_attendance_submission', { p_submission_id: submission.id }, true).status, 'submitted');
  assert.equal(state.tables.labor_cost_ledger[0].status, 'reversed');
  state.run('return_attendance_submission_for_edit', { p_submission_id: submission.id, p_notes: 'Změna zakázky' }, true);
  state.run('save_attendance_record', { p_record_id: saved[0].id, p_date: '2026-09-04', p_hours: 3, p_realizace_id: 'realization' });
  state.submit(); state.approve(submission.id);
  assert.equal(state.tables.labor_cost_ledger.length, 1);
  assert.equal(state.tables.labor_cost_ledger[0].id, ledgerId);
  assert.equal(state.tables.labor_cost_ledger[0].project_id, null);
  assert.equal(state.tables.labor_cost_ledger[0].realization_id, 'realization');
  assert.equal(state.tables.labor_cost_ledger[0].work_date, '2026-09-04');
  assert.equal(state.tables.labor_cost_ledger[0].pay_amount, 1350);
});
test('active or paid hourly payout blocks reopening and stale draft editing; cancelled allows it', () => {
  for (const status of ['pending', 'approved', 'invoice_uploaded', 'paid']) {
    const state = setup(); state.save([state.record()]); const submission = state.submit(); state.approve(submission.id);
    state.tables.hourly_payout_requests.push({ id: 'hourly', member_id: 'worker', payout_year: 2026, payout_month: 9, status });
    assert.ok(state.run('revert_attendance_submission', { p_submission_id: submission.id }, true).error);
    state.tables.attendance_submissions[0].status = 'returned';
    assert.ok(state.save([state.record({ date: '2026-09-04' })], secondBatch).error);
    state.tables.hourly_payout_requests[0].status = 'cancelled';
    assert.equal(state.save([state.record({ date: '2026-09-04' })], secondBatch).length, 1);
  }
});
test('paid ledger blocks reopening even without a current request', () => {
  const state = setup(); state.save([state.record()]); const submission = state.submit(); state.approve(submission.id);
  state.tables.labor_cost_ledger[0].status = 'paid';
  assert.ok(state.run('revert_attendance_submission', { p_submission_id: submission.id }, true).error);
  assert.equal(state.tables.attendance_submissions[0].status, 'approved');
});
test('withdraw clears decision metadata and delete keeps original attendance records', () => {
  const state = setup(); state.save([state.record()]); const submission = state.submit();
  assert.equal(state.run('reject_attendance_submission', { p_submission_id: submission.id, p_notes: 'Oprava' }, true).status, 'rejected');
  const withdrawn = state.run('withdraw_attendance_submission', { p_submission_id: submission.id });
  assert.equal(withdrawn.status, 'draft'); assert.equal(withdrawn.submitted_at, null); assert.equal(withdrawn.notes, null);
  state.run('delete_attendance_submission', { p_submission_id: submission.id });
  assert.equal(state.tables.attendance_submissions.length, 0);
  assert.equal(state.tables.attendance.length, 1);
  state.run('delete_attendance_record', { p_record_id: state.tables.attendance[0].id });
  assert.equal(state.tables.attendance.length, 0);
  assert.ok(state.submit().error);
});
