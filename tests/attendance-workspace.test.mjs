import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceDateOnly, attendanceMonthRange, normalizeAttendanceRow, filterAttendanceRows, groupAttendanceWork, sumAttendanceHours, attendanceMonthEditable, fetchAllAttendanceRows, loadAttendanceMonth, buildAttendanceReportData } from '../src/lib/attendanceWorkspace.js';
import { saveAttendanceBatch, saveAttendanceEdit } from '../src/lib/attendanceMutations.js';

function pages(rows, cap = 2, error = null) {
  const calls = [];
  const factory = () => {
    let start = 0, end = 0;
    const query = { range(a, b) { start = a; end = b; calls.push([a, b]); return query; }, abortSignal() { return query; }, then(resolve) { return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + cap)), error }).then(resolve); } };
    return query;
  };
  return { factory, calls };
}
test('local midnight stays date-only and month boundaries include leap days', () => {
  assert.equal(attendanceDateOnly(new Date(2026, 8, 1)), '2026-09-01');
  assert.deepEqual(attendanceMonthRange(new Date(2026, 8, 1)), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(attendanceMonthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(attendanceMonthRange('2026-12-01'), { start: '2026-12-01', end: '2026-12-31' });
});
test('both realization aliases and array relations support filtering, labels and totals', () => {
  const rows = [normalizeAttendanceRow({ id: '1', realization_id: 'same', hours: '3.5', realizations: [{ name: 'Montáž' }] }), normalizeAttendanceRow({ id: '2', realizace_id: 'same', hours: 2, realizations: { name: 'Montáž' } }), normalizeAttendanceRow({ id: '3', project_id: 'same', hours: 4, projects: { name: 'Dokumentace' } })];
  assert.equal(filterAttendanceRows(rows, { type: 'realization' }).length, 2);
  assert.equal(filterAttendanceRows(rows, { search: 'MONTÁŽ' }).length, 2);
  assert.equal(sumAttendanceHours(rows), 9.5);
  assert.deepEqual(groupAttendanceWork(rows).map(row => [row.id, row.hours]), [['realization:same', 5.5], ['project:same', 4]]);
});
test('unloaded, unknown, submitted and approved months never expose edits', () => {
  assert.equal(attendanceMonthEditable(null, false), false);
  for (const status of ['unknown', 'submitted', 'approved']) assert.equal(attendanceMonthEditable({ status }), false);
  for (const status of ['draft', 'returned', 'rejected']) assert.equal(attendanceMonthEditable({ status }), true);
});
test('pagination traverses a server cap smaller than requested range without losing rows', async () => {
  const source = pages(Array.from({ length: 7 }, (_, index) => ({ id: String(index) })));
  assert.equal((await fetchAllAttendanceRows(source.factory)).length, 7);
  assert.deepEqual(source.calls.map(row => row[0]), [0, 2, 4, 6, 7]);
});
test('duplicate pages cannot loop forever or inflate compensation totals', async () => {
  const query = { range() { return this; }, then(resolve) { return Promise.resolve({ data: [{ member_id: 'm', hourly_rate: 500 }] }).then(resolve); } };
  await assert.rejects(fetchAllAttendanceRows(() => query), /opakované/);
});
test('pagination rejects partial failures and aborts before another request', async () => {
  const controller = new AbortController(); controller.abort();
  const source = pages([{ id: '1' }]);
  await assert.rejects(fetchAllAttendanceRows(source.factory, controller.signal), { name: 'AbortError' });
  assert.equal(source.calls.length, 0);
  const error = new Error('network');
  await assert.rejects(fetchAllAttendanceRows(pages([], 2, error).factory), error);
});
test('month loader rejects the whole result if the approval state is unavailable', async () => {
  const statusError = new Error('status unavailable');
  const client = { from(table) {
    const query = { select() { return this; }, gte() { return this; }, lte() { return this; }, order() { return this; }, eq() { return this; }, range() { return this; }, maybeSingle() { return this; }, abortSignal() { return this; }, then(resolve) { return Promise.resolve(table === 'attendance' ? { data: [] } : { data: null, error: statusError }).then(resolve); } };
    return query;
  } };
  await assert.rejects(loadAttendanceMonth(client, { memberId: 'm', month: '2026-09' }), statusError);
});
test('financial report includes historical records of now-disabled members', () => {
  const data = buildAttendanceReportData({ records: [{ member_id: 'm', hours: 8 }], submissions: [], memberRows: [{ id: 'm', name: 'Petr', attendance_enabled: false }], compensations: [{ member_id: 'm', hourly_rate: 400, currency: 'CZK' }] });
  assert.equal(data.members[0].hourly_rate, 400);
  assert.equal(data.records.length, 1);
});
test('financial report refuses missing rates, wrong currency and missing member metadata', () => {
  const base = { records: [{ member_id: 'm', hours: 8 }], submissions: [], memberRows: [{ id: 'm', name: 'Petr' }], compensations: [] };
  assert.throws(() => buildAttendanceReportData(base), /Chybí hodinová sazba/);
  assert.throws(() => buildAttendanceReportData({ ...base, compensations: [{ member_id: 'm', hourly_rate: 400, currency: 'EUR' }] }), /CZK/);
  assert.throws(() => buildAttendanceReportData({ ...base, memberRows: [] }), /pracovník/);
});
const records = [{ member_id: 'm', date: '2026-09-03', hours: 2, realization_id: 'r', description: 'Zapojení' }, { member_id: 'm', date: '2026-09-03', hours: 3, project_id: 'p' }];
test('multi-record and singleton creates each use one atomic RPC with the stable batch ID', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: args.p_records.map((row, index) => ({ ...row, id: String(index) })) }; } };
  await saveAttendanceBatch(client, records, 'batch-1');
  await saveAttendanceBatch(client, [records[0]], 'batch-2');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'save_attendance_records');
  assert.equal(calls[0].args.p_batch_id, 'batch-1');
  assert.equal(calls[0].args.p_records[0].realizace_id, 'r');
});
test('network retry keeps the same payload and receipt key without sequential fallback', async () => {
  const calls = []; const error = new Error('response lost');
  const client = { rpc: async (name, args) => { calls.push({ name, args }); if (calls.length === 1) return { error }; return { data: args.p_records.map((row, i) => ({ ...row, id: String(i) })) }; } };
  await assert.rejects(saveAttendanceBatch(client, records, 'stable'), error);
  await saveAttendanceBatch(client, records, 'stable');
  assert.deepEqual(calls[0], calls[1]);
});
test('invalid batch and incomplete server acknowledgements never report success', async () => {
  let calls = 0; const client = { rpc: async () => { calls++; return { data: [{ id: 'one' }] }; } };
  await assert.rejects(saveAttendanceBatch(client, [], 'b'));
  await assert.rejects(saveAttendanceBatch(client, records, null));
  await assert.rejects(saveAttendanceBatch(client, [records[0], { ...records[1], member_id: 'other' }], 'b'));
  assert.equal(calls, 0);
  await assert.rejects(saveAttendanceBatch(client, records, 'b'), /úplné uložení/);
});
test('editing calls the singular RPC and preserves record ID and date-only values', async () => {
  let request;
  await saveAttendanceEdit({ rpc: async (name, args) => { request = { name, args }; return { data: { id: 'record' } }; } }, { ...records[0], date: new Date(2026, 8, 1) }, 'record');
  assert.equal(request.name, 'save_attendance_record');
  assert.equal(request.args.p_record_id, 'record');
  assert.equal(request.args.p_date, '2026-09-01');
  assert.equal(request.args.p_realizace_id, 'r');
});
