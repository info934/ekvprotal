import test from 'node:test';
import assert from 'node:assert/strict';
import { allReportRows, buildAttendanceReport, demoReportData, loadReportData, nextReportMonth, reportRange, scheduledReportMonth } from '../supabase/functions/_shared/attendancePlanReport.js';

test('monthly scheduling respects Prague time, leap years, DST and year rollover', () => {
  assert.equal(scheduledReportMonth(new Date('2026-09-30T15:59:00Z')), null);
  assert.equal(scheduledReportMonth(new Date('2026-09-30T16:00:00Z')), '2026-10');
  assert.equal(scheduledReportMonth(new Date('2026-10-01T06:00:00Z')), '2026-10');
  assert.equal(scheduledReportMonth(new Date('2026-10-01T16:00:00Z')), null);
  assert.equal(scheduledReportMonth(new Date('2026-12-31T17:00:00Z')), '2027-01');
  assert.equal(scheduledReportMonth(new Date('2028-02-28T17:00:00Z')), null);
  assert.equal(scheduledReportMonth(new Date('2028-02-29T17:00:00Z')), '2028-03');
  assert.equal(nextReportMonth(new Date('2026-12-05T12:00:00Z')), '2027-01');
  assert.deepEqual(reportRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
});
test('demo has explicit labeling, complete CSV, separated hours and missing-plan employee', () => {
  const report = buildAttendanceReport({ month: '2026-10', ...demoReportData('2026-10'), demo: true });
  assert.match(report.subject, /^\[DEMO\]/);
  assert.equal(report.employeeCount, 3); assert.equal(report.planCount, 3); assert.equal(report.missingCount, 1);
  assert.match(report.html, /16 h plánované práce/); assert.match(report.html, /8 h nepřítomnosti/);
  assert.match(report.csv, /Ukázkový zaměstnanec C.*Bez plánu/);
  assert.match(report.csv, /08:00.*16:30.*30/);
});
test('report escapes HTML and CSV spreadsheet formulas, excludes cancelled and other months', () => {
  const data = demoReportData('2026-10');
  data.employees[0].name = '=HYPERLINK("x")'; data.plans[0].note = '<img src=x onerror=alert(1)>';
  data.plans[1].cancelled = true; data.plans[2].date = '2026-11-01';
  const report = buildAttendanceReport({ month: '2026-10', ...data });
  assert.equal(report.planCount, 1); assert.match(report.html, /&lt;img/); assert.doesNotMatch(report.html, /<img/);
  assert.match(report.csv, /'=HYPERLINK/);
});
test('pagination continues through server caps and rejects errors and duplicate pages', async () => {
  let calls = 0;
  assert.equal((await allReportRows(() => ({ range: async from => { calls++; return { data: from < 3 ? [{ id: from }] : [], error: null }; } }))).length, 3);
  assert.equal(calls, 4);
  await assert.rejects(allReportRows(() => ({ range: async () => ({ data: null, error: {} }) })));
  await assert.rejects(allReportRows(() => ({ range: async () => ({ data: [{ id: 'same' }], error: null }) })));
});
test('employee scope includes active profiles and legacy attendance users without hiding existing plans', async () => {
  const fixtures = { members: [{ id: 'a', name: 'Active', attendance_enabled: false }, { id: 'b', name: 'Legacy', attendance_enabled: true }, { id: 'c', name: 'Inactive', attendance_enabled: true }, { id: 'd', name: 'Has plan', attendance_enabled: false }], employee_profiles: [{ member_id: 'a', employment_status: 'active' }, { member_id: 'c', employment_status: 'inactive' }], attendance_plans: [{ id: 'plan', member_id: 'd' }] };
  const admin = { from: table => { const query = { select: () => query, order: () => query, eq: () => query, gte: () => query, lte: () => query, range: async from => ({ data: from ? [] : fixtures[table], error: null }) }; return query; } };
  assert.deepEqual((await loadReportData(admin, '2026-10')).employees.map(row => row.id), ['a', 'b', 'd']);
});
