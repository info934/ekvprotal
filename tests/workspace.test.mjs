import test from 'node:test';
import assert from 'node:assert/strict';
import { isClosedTask, localDateKey, taskDateLabel, sumKnownCounts } from '../src/domain/workOverview.js';
import { fetchWorkOverview } from '../src/lib/workOverviewData.js';
import { fetchPortalSearch, normalizeSearchTerm } from '../src/lib/portalSearchData.js';

function clientFor(resolver) {
  const calls = [];
  const client = { from(table) {
    const call = { table, steps: [] }; calls.push(call);
    const query = { then(resolve, reject) { return Promise.resolve(resolver(call)).then(resolve, reject); } };
    for (const method of ['select', 'eq', 'not', 'lt', 'ilike', 'order', 'limit', 'abortSignal']) query[method] = (...args) => { call.steps.push([method, ...args]); return query; };
    return query;
  } };
  return { client, calls };
}
test('closed and cancelled tasks never count as open work', () => {
  for (const status of ['Hotovo', 'Zrušeno', 'CANCELLED', 'completed']) assert.equal(isClosedTask({ status }), true);
  assert.equal(isClosedTask({ status: 'V řešení' }), false);
});
test('calendar labels cross month/year boundaries using local dates', () => {
  const now = new Date(2026, 11, 31, 23, 45);
  assert.equal(localDateKey(now), '2026-12-31');
  assert.equal(taskDateLabel('2027-01-01', now), 'Zítra');
  assert.equal(taskDateLabel('2026-12-31', now), 'Dnes');
  assert.equal(taskDateLabel('2026-12-30', now), 'Po termínu');
});
test('missing count remains unknown rather than a misleading zero', () => {
  assert.equal(sumKnownCounts([2, null, 5]), null);
  assert.equal(sumKnownCounts([2, 0, 5]), 7);
});
test('member workspace scopes all task requests and does not request approval data', async () => {
  const { client, calls } = clientFor(() => ({ data: [], count: 7, error: null }));
  const result = await fetchWorkOverview(client, { memberId: 'member-1', isAdmin: false, hasPermission: (module, level) => module === 'tasks' && level === 'can_read' });
  assert.equal(result.openCount, 7);
  assert.equal(result.tasks.length, 0);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.table, 'project_tasks');
    assert.ok(call.steps.some(([method, field, value]) => method === 'eq' && field === 'member_id' && value === 'member-1'));
    assert.ok(call.steps.some(([method, , , value]) => method === 'not' && value.includes('Zrušeno')));
  }
  assert.equal(calls.filter(call => call.steps.some(([method,, options]) => method === 'select' && options?.head && options.count === 'exact')).length, 2);
});
test('unlinked member does not fall back to all company tasks', async () => {
  const { client, calls } = clientFor(() => ({ data: [], count: 0 }));
  await fetchWorkOverview(client, { memberId: null, isAdmin: false, hasPermission: module => module === 'tasks' });
  assert.equal(calls.length, 0);
});
test('approval links require the role and read access of their destination', async () => {
  const adminOnly = clientFor(() => ({ data: [], count: 3 }));
  const hidden = await fetchWorkOverview(adminOnly.client, { userRole: 'manager', isAdmin: false, hasPermission: (_module, level) => level === 'can_admin' });
  assert.equal(hidden.approvals.length, 0);
  const manager = clientFor(() => ({ data: [], count: 3 }));
  const visible = await fetchWorkOverview(manager.client, { userRole: 'super_manager', isAdmin: false, hasPermission: module => module === 'attendance' });
  assert.equal(visible.approvals.length, 1);
  assert.equal(visible.approvals[0].path, '/attendance?tab=approvals');
});
test('failed approval query shows unknown total and names incomplete data', async () => {
  const { client } = clientFor(call => call.table === 'payouts' ? { error: { message: 'network' } } : { data: [], count: 2 });
  const result = await fetchWorkOverview(client, { isAdmin: true, hasPermission: () => true });
  assert.equal(result.approvalCount, null);
  assert.match(result.error, /Výplaty ke schválení/);
});
test('global search only queries permitted records and deduplicates name/code results', async () => {
  const { client, calls } = clientFor(() => ({ data: [{ id: 'p1', name: 'Dům', code: 'PR-26-024' }] }));
  const result = await fetchPortalSearch(client, 'PR-26', module => module === 'projects');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, '/projects/p1');
  assert.ok(calls.every(call => call.table === 'projects'));
  assert.equal(calls.length, 2);
});
test('search short wildcard-only input does not query the backend', async () => {
  const { client, calls } = clientFor(() => ({ data: [] }));
  await fetchPortalSearch(client, '%_*', () => true);
  assert.equal(calls.length, 0);
  assert.equal(normalizeSearchTerm('  PR-26-024  '), 'PR-26-024');
});
