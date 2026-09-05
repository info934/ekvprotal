import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProjectDate, projectTaskIsOverdue, projectTaskOverview, projectTaskStatuses, resolveProjectTaskDrop, loadProjectTasks } from '../src/lib/projectDetailWorkspace.js';

test('project and task dates render missing and malformed legacy dates without crashing', () => {
  for (const value of [null, undefined, '', 'bad-date', '2026-02-30', '2026-13-01', 123]) {
    assert.equal(formatProjectDate(value), 'Bez termínu');
    assert.equal(projectTaskIsOverdue({ end_date: value, status: 'Nové' }), false);
  }
  assert.equal(formatProjectDate('2026-09-05'), '5. 9. 2026');
  assert.equal(formatProjectDate(null, 'Není stanoven'), 'Není stanoven');
});

test('task deadline remains valid throughout its local day and closed tasks do not raise warnings', () => {
  const task = { end_date: '2026-09-05', status: 'V řešení' };
  assert.equal(projectTaskIsOverdue(task, new Date(2026, 8, 5, 23, 59, 59)), false);
  assert.equal(projectTaskIsOverdue(task, new Date(2026, 8, 6)), true);
  for (const status of ['Hotovo', 'Zrušeno', 'completed', 'cancelled']) assert.equal(projectTaskIsOverdue({ ...task, status }, new Date(2026, 8, 6)), false);
});

test('overview orders real deadlines first and keeps malformed deadlines visible for correction', () => {
  const rows = [
    { id: 'empty', status: 'Nové', end_date: null },
    { id: 'later', status: 'V řešení', end_date: '2026-10-01' },
    { id: 'bad', status: 'Kontrola', end_date: 'not-a-date' },
    { id: 'past', status: 'Nové', end_date: '2026-09-01' },
    { id: 'done', status: 'Hotovo', end_date: '2026-01-01' },
  ];
  const result = projectTaskOverview(rows, new Date(2026, 8, 5));
  assert.deepEqual(result.overdue.map(row => row.id), ['past']);
  assert.deepEqual(result.missingDates.map(row => row.id), ['empty', 'bad']);
  assert.deepEqual(result.upcoming.map(row => row.id), ['past', 'later', 'empty', 'bad']);
});

test('custom and absent task statuses remain represented in the board', () => {
  assert.deepEqual(projectTaskStatuses([{ status: 'Kontrola' }, { status: 'Kontrola' }, { status: null }, { status: 'Hotovo' }]), ['Nové', 'V řešení', 'Blokováno', 'Hotovo', 'Zrušeno', 'Kontrola', 'Bez stavu']);
});

test('drag events cannot mutate an unknown task, another project, or a read-only board', () => {
  const rows = [{ id: 'one', project_id: 'project-a' }, { id: 'two', project_id: 'project-b' }];
  assert.equal(resolveProjectTaskDrop('{bad', rows, 'project-a', true), null);
  assert.equal(resolveProjectTaskDrop('{"id":"missing"}', rows, 'project-a', true), null);
  assert.equal(resolveProjectTaskDrop('{"id":"two"}', rows, 'project-a', true), null);
  assert.equal(resolveProjectTaskDrop('{"id":"one"}', rows, 'project-a', false), null);
  assert.equal(resolveProjectTaskDrop('{"id":"one","project_id":"forged"}', rows, 'project-a', true), rows[0]);
});

function pagedClient(rows, failFrom) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, order: [] }; calls.push(call);
    const query = {
      select(fields) { call.fields = fields; return query; },
      eq(field, value) { call.filter = [field, value]; return query; },
      order(field) { call.order.push(field); return query; },
      range(from, to) { call.range = [from, to]; return query; },
      abortSignal(signal) { call.signal = signal; return query; },
      then(resolve, reject) {
        const from = call.range[0];
        return Promise.resolve(from === failFrom ? { data: null, error: new Error('Page failed') } : { data: rows.slice(from, from + 2), error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

test('task reader loads every capped page, related member and deterministic project-scoped order', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const client = pagedClient(rows); const controller = new AbortController();
  assert.deepEqual(await loadProjectTasks(client, 'project-a', controller.signal), rows);
  assert.deepEqual(client.calls.map(call => call.range[0]), [0, 2, 4, 5]);
  for (const call of client.calls) {
    assert.deepEqual(call.filter, ['project_id', 'project-a']);
    assert.deepEqual(call.order, ['end_date', 'id']);
    assert.match(call.fields, /member:members\(name\)/);
    assert.equal(call.signal, controller.signal);
  }
});

test('a failed later task page is never returned as a complete list', async () => {
  await assert.rejects(loadProjectTasks(pagedClient([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2), 'project-a'), /Page failed/);
  const client = pagedClient([]);
  await assert.rejects(loadProjectTasks(client, null), /Chybí projekt/);
  assert.equal(client.calls.length, 0);
});
