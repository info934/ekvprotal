import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverviewCache, overviewScope } from '../src/lib/overviewCache.js';
import { fetchMyWorkOverview, fetchOverviewRpc } from '../src/lib/overviewRpc.js';
import { supabase, resetPreviewData } from '../src/preview/supabasePreviewClient.js';
import { setPreviewRole } from '../src/preview/previewState.js';

test('overview needs one RPC and never a second auth or task request', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const payload = { tasks: [], openCount: 0, overdueCount: 0, approvals: [], jobs: [], notificationCount: 2 };
  const client = { rpc(name, params) { calls.push({ name, params }); return { abortSignal(actual) { assert.equal(actual, signal); return Promise.resolve({ data: payload }); } }; } };
  assert.equal(await fetchMyWorkOverview(client, { signal, memberId: 'cannot-impersonate' }), payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'get_my_work_overview_v2');
  assert.deepEqual(Object.keys(calls[0].params), ['p_today']);
});

test('RPC errors and invalid responses are not rendered as a zero dashboard', async () => {
  const client = result => ({ rpc: () => ({ abortSignal: () => Promise.resolve(result) }) });
  await assert.rejects(fetchOverviewRpc(client({ error: new Error('denied') }), 'test', {}), /denied/);
  for (const data of [null, [], 'bad']) await assert.rejects(fetchOverviewRpc(client({ data }), 'test', {}), /formát/);
});

test('cache expiry, manual refresh and failures preserve freshness', async () => {
  let time = 0, count = 0;
  const cache = createOverviewCache({ now: () => time });
  const loader = async () => ++count;
  assert.equal(await cache.load('a', loader), 1);
  time = 29_999;
  assert.equal(await cache.load('a', loader), 1);
  time = 30_000;
  assert.equal(await cache.load('a', loader), 2);
  assert.equal(await cache.load('a', loader, { force: true }), 3);
  await assert.rejects(cache.load('a', async () => { throw Error('offline'); }, { force: true }), /offline/);
  assert.equal(await cache.load('a', loader), 4);
});

test('identity, permissions and privacy create distinct cache scopes', () => {
  const base = { userId: 'alice', memberId: 'member-a', userRole: 'user', permissions: { projects: { can_read: true } } };
  const scope = overviewScope(base);
  for (const change of [{ userId: 'bob' }, { memberId: 'member-b' }, { userRole: 'admin' }, { isPrivateMode: true }, { permissions: { projects: { can_read: false } } }]) {
    assert.notEqual(overviewScope({ ...base, ...change }), scope);
  }
});

test('logout invalidates in-flight results and aborted results are never cached', async () => {
  const cache = createOverviewCache();
  let resolve;
  const inflight = cache.load('a', () => new Promise(done => { resolve = done; }));
  cache.clear(); resolve('old identity'); await inflight;
  assert.equal(await cache.load('a', async () => 'new identity'), 'new identity');
  const controller = new AbortController();
  await assert.rejects(cache.load('b', async () => { controller.abort(); return 'stale'; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await cache.load('b', async () => 'fresh'), 'fresh');
});

test('new overview RPC contracts work against the isolated preview adapter', async () => {
  resetPreviewData();
  setPreviewRole('admin');
  const work = await fetchMyWorkOverview(supabase);
  assert.ok(Array.isArray(work.tasks));
  assert.ok(work.tasks.length <= 6);
  assert.ok(work.openCount >= work.tasks.length);
  const company = await fetchOverviewRpc(supabase, 'get_company_dashboard_v2', { p_today: '2026-09-30', p_private: false });
  assert.ok(company.summary.projectCount > 0);
  assert.ok(company.topOpportunities.length <= 10);
  const privateView = await fetchOverviewRpc(supabase, 'get_company_dashboard_v2', { p_today: '2026-09-30', p_private: true });
  assert.equal(privateView.summary.activeProjectsValue, 0);
  assert.ok(privateView.topOpportunities.every(row => row.value === null));
  setPreviewRole('member');
  try {
    const mine = await fetchMyWorkOverview(supabase);
    assert.equal(mine.approvals.length, 0);
    await assert.rejects(fetchOverviewRpc(supabase, 'get_company_dashboard_finance_v2', {}), { message: 'Admin role required', code: '42501' });
  } finally { setPreviewRole('admin'); resetPreviewData(); }
});
