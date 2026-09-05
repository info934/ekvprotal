import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIST_DEFAULTS, normalizeListState, resolveListState, listStateSearch,
  safeListReturnPath, compareListRecords, isRecordActivation,
  taskIsDone, taskIsCancelled, taskIsOpen, taskProgress, fetchAllListRows,
} from '../src/lib/listWorkspaceState.js';

const statuses = ['active', 'closed'];
const sorts = ['created_at', 'name', 'code', 'price'];
const saved = { q: 'Rodinný dům', status: 'closed', view: 'grid', sort: 'name', dir: 'asc' };

test('explicit URL filters replace saved filters instead of unexpectedly hiding linked records', () => {
  assert.deepEqual(resolveListState('?q=Javorov%C3%A1', saved, statuses, sorts), { ...LIST_DEFAULTS, q: 'Javorová' });
  assert.deepEqual(resolveListState('?status=active', saved, statuses, sorts), { ...LIST_DEFAULTS, status: 'active' });
  assert.deepEqual(resolveListState('', saved, statuses, sorts), saved);
  assert.deepEqual(resolveListState('?unrelated=1', saved, statuses, sorts), saved);
  assert.deepEqual(resolveListState('', undefined, statuses, sorts), LIST_DEFAULTS);
});

test('explicit reset marker overrides a previously saved grid/filter and URLs round trip Unicode', () => {
  assert.equal(listStateSearch(LIST_DEFAULTS), '?view=table');
  assert.deepEqual(resolveListState(listStateSearch(LIST_DEFAULTS), saved, statuses, sorts), LIST_DEFAULTS);
  assert.deepEqual(resolveListState(listStateSearch(saved), undefined, statuses, sorts), saved);
});

test('state normalization limits query length and rejects stale status/sort/view/direction', () => {
  assert.deepEqual(normalizeListState({ q: 'x'.repeat(300), status: 'deleted', view: 'unknown', sort: 'secret', dir: 'up' }, statuses, sorts), { ...LIST_DEFAULTS, q: 'x'.repeat(250) });
  assert.deepEqual(normalizeListState({ q: 123 }, statuses, sorts), LIST_DEFAULTS);
  assert.equal(normalizeListState({ status: 'active', view: 'kanban', sort: 'price', dir: 'asc' }, statuses, sorts).status, 'active');
});

test('return path only admits the exact list route and its query string', () => {
  assert.equal(safeListReturnPath('/projects?status=active&q=d%C5%AFm', '/projects'), '/projects?status=active&q=d%C5%AFm');
  for (const value of ['https://evil.invalid/projects', '//evil.invalid/projects', 'javascript:alert(1)', '/realizace', '/projects/new', '/projects-other', '/projects#detail', null, {}]) {
    assert.equal(safeListReturnPath(value, '/projects'), '/projects');
  }
});

test('sorting handles Czech text, natural numeric codes and numeric values; missing values stay last', () => {
  const sort = (values, key, direction) => values.map(value => ({ [key]: value })).sort((a, b) => compareListRecords(a, b, key, direction)).map(row => row[key]);
  assert.deepEqual(sort(['Žaneta', 'Chalupa', 'Čeněk', 'Adam', 'Hana'], 'name', 'asc'), ['Adam', 'Čeněk', 'Hana', 'Chalupa', 'Žaneta']);
  assert.deepEqual(sort(['PR-10', 'PR-2', 'PR-1'], 'code', 'asc'), ['PR-1', 'PR-2', 'PR-10']);
  assert.deepEqual(sort([null, 20, '', 0, 2], 'price', 'asc'), [0, 2, 20, null, '']);
  assert.deepEqual(sort([null, 20, '', 0, 2], 'price', 'desc'), [20, 2, 0, null, '']);
});

test('row activation respects nested controls and only Enter/Space on the row itself', () => {
  const row = {};
  assert.equal(isRecordActivation({ type: 'click', target: { closest: () => null }, currentTarget: row }), true);
  for (const tag of ['button', 'a', 'input', 'select']) {
    const nested = { tag, closest: () => nested };
    assert.equal(isRecordActivation({ type: 'click', target: nested, currentTarget: row }), false);
    assert.equal(isRecordActivation({ type: 'keydown', key: 'Enter', target: nested, currentTarget: row }), false);
  }
  for (const key of ['Enter', ' ']) assert.equal(isRecordActivation({ type: 'keydown', key, target: row, currentTarget: row }), true);
  for (const key of ['Escape', 'ArrowDown', 'a']) assert.equal(isRecordActivation({ type: 'keydown', key, target: row, currentTarget: row }), false);
  assert.equal(isRecordActivation({ type: 'keydown', key: 'Enter', target: row, currentTarget: row, defaultPrevented: true }), false);
});

test('cancelled tasks are excluded from progress and open-task counts', () => {
  for (const status of ['Zrušeno', 'zruseno', 'cancelled', 'canceled']) {
    assert.equal(taskIsCancelled({ status }), true);
    assert.equal(taskIsOpen({ status }), false);
  }
  for (const status of ['Hotovo', 'done', 'completed', 'Dokončeno']) assert.equal(taskIsDone({ status }), true);
  assert.equal(taskProgress([{ status: 'Hotovo' }, { status: 'V řešení' }, { status: 'Zrušeno' }]), 50);
  assert.equal(taskProgress([{ status: 'Zrušeno' }]), 0);
  assert.equal(taskProgress([]), 0);
});

test('fetchAllListRows follows actual returned counts until an empty page despite a lower server cap', async () => {
  const all = ['a', 'b', 'c', 'd', 'e'];
  for (const pageSize of [3, 500]) {
    const calls = [];
    const result = await fetchAllListRows(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, from + 2), error: null };
    }, pageSize);
    assert.deepEqual(result, all);
    assert.deepEqual(calls.map(([from]) => from), [0, 2, 4, 5]);
    assert.ok(calls.every(([from, to]) => to === from + pageSize - 1));
  }
});

test('fetchAllListRows rejects invalid sizes before invoking the backend', async () => {
  for (const size of [0, -1, 1.5, NaN, Infinity]) {
    let called = false;
    await assert.rejects(fetchAllListRows(async () => { called = true; return { data: [] }; }, size));
    assert.equal(called, false);
  }
});

test('fetchAllListRows never returns a partial list after a failed or malformed later page', async () => {
  const failure = new Error('Connection interrupted');
  let calls = 0;
  await assert.rejects(fetchAllListRows(async () => ++calls === 1 ? { data: ['a', 'b'] } : { data: null, error: failure }, 2), error => error === failure);
  assert.equal(calls, 2);
  await assert.rejects(fetchAllListRows(async () => ({ data: { id: 1 } }), 2), /formát/);
  await assert.rejects(fetchAllListRows(async () => { throw failure; }, 2), error => error === failure);
});
import {recordReturnPath} from '../src/lib/listWorkspaceState.js';
test('record returns preserve task filters but reject other or external targets',()=>{
 assert.equal(recordReturnPath('/tasks?scope=mine&q=Test','/projects'),'/tasks?scope=mine&q=Test');
 for(const candidate of ['https://example.com','//example.com','/tasks-other','/members'])assert.equal(recordReturnPath(candidate,'/projects'),'/projects');
 assert.equal(recordReturnPath('/realizace?q=Test','/realizace'),'/realizace?q=Test');
});
