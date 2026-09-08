import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addWorkingDays, estimateMismatch, templateWorkDays } from '../src/lib/planningEstimates.js';

test('working-day estimate skips weekends and counts start as first day', () => {
  assert.equal(addWorkingDays('2026-09-11', 1), '2026-09-11');
  assert.equal(addWorkingDays('2026-09-11', 2), '2026-09-14');
  assert.equal(addWorkingDays('2026-09-12', 1), '2026-09-14');
  assert.equal(addWorkingDays('2026-09-07', 5), '2026-09-11');
  assert.equal(addWorkingDays('invalid', 5), '');
});

test('template duration and assignment mismatch are deterministic', () => {
  assert.equal(templateWorkDays([{ start_day_offset: 0, duration_days: 2 }, { start_day_offset: 3, duration_days: 4 }]), 7);
  assert.deepEqual(estimateMismatch(8, [{ planned_hours: 3 }, { planned_hours: 4 }]), { estimate: 8, assigned: 7, difference: -1 });
  assert.equal(estimateMismatch(8, [{ planned_hours: 8 }]), null);
});

test('work report function uses scoped operational fields and tracked delivery', async () => {
  const source = await readFile(new URL('../supabase/functions/send-work-reports/index.ts', import.meta.url), 'utf8');
  assert.match(source, /sendTrackedEmail/);
  assert.match(source, /taskBelongsTo/);
  assert.match(source, /work_reminders/);
  assert.match(source, /work_friday_digest/);
  assert.match(source, /verify_work_reports_secret/);
  assert.doesNotMatch(source, /from\(['"](?:payouts|project_finances|realization_costs|subjects|crm_contacts)['"]\)/);
});

test('migration keeps task properties synchronized and schedules Prague windows', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260908120000_simplified_planning_work_reports.sql', import.meta.url), 'utf8');
  assert.match(sql, /priority=excluded\.priority,estimated_hours=excluded\.estimated_hours/);
  assert.match(sql, /quick_update_planning_item/);
  assert.match(sql, /0,15,30,45 5,6 \* \* 1,3/);
  assert.match(sql, /0,15,30,45 12,13 \* \* 5/);
  assert.match(sql, /work_report_jobs/);
});
