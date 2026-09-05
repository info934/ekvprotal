import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingSummaryCache } from '../src/lib/billingSummaryCacheCore.js';

const session = (id, token = id) => ({ user: { id }, access_token: token });
function fixture(fetchSummary) {
  let active = session('alice'); let onAuth; let calls = 0;
  const cache = createBillingSummaryCache({ readSession: async () => active, fetchSummary: async (...args) => { calls += 1; return fetchSummary ? fetchSummary(...args) : { owner: active.user.id, call: calls }; }, subscribeAuth: listener => { onAuth = listener; return () => {}; } });
  return { cache, get calls() { return calls; }, switch(next, event = 'SIGNED_IN') { active = next; onAuth(event, next); }, setQuietly(next) { active = next; } };
}

test('cached billing data is reused only inside the same authenticated session', async () => {
  const app = fixture();
  const first = await app.cache.get('project', 'one');
  assert.deepEqual(await app.cache.get('project', 'one'), first); assert.equal(app.calls, 1);
  app.switch(session('bob'));
  const second = await app.cache.get('project', 'one'); assert.equal(second.owner, 'bob'); assert.equal(app.calls, 2);
  app.switch(null, 'SIGNED_OUT'); await assert.rejects(app.cache.get('project', 'one'), /přihlaste/);
});

test('session mismatch without auth callback still clears previous actor cache', async () => {
  const app = fixture(); await app.cache.get('project', 'one');
  app.setQuietly(session('bob'));
  assert.equal((await app.cache.get('project', 'one')).owner, 'bob'); assert.equal(app.calls, 2);
});

test('old in-flight response is aborted and cannot be returned or cached for the next account', async () => {
  let release; let oldSignal;
  const app = fixture(async (_type, _id, signal) => { oldSignal = signal; return new Promise(resolve => { release = resolve; }); });
  const pending = app.cache.get('project', 'one');
  await new Promise(resolve => setImmediate(resolve));
  app.switch(session('bob')); assert.equal(oldSignal.aborted, true);
  release({ owner: 'alice' }); await assert.rejects(pending, { name: 'AbortError' });
});

test('token refresh and explicit entity invalidation force authorization through a fresh read', async () => {
  const app = fixture(); await app.cache.get('project', 'one');
  app.switch(session('alice', 'new-token'), 'TOKEN_REFRESHED'); await app.cache.get('project', 'one'); assert.equal(app.calls, 2);
  app.cache.invalidate('project', 'one'); await app.cache.get('project', 'one'); assert.equal(app.calls, 3);
  app.switch(session('alice', 'new-token'), 'INITIAL_SESSION'); await app.cache.get('project', 'one'); assert.equal(app.calls, 3);
});

test('delayed getSession cannot restore a prior actor after auth changed', async () => {
  let releaseSession; let onAuth; let reads = 0;
  const cache = createBillingSummaryCache({ readSession: () => new Promise(resolve => { releaseSession = resolve; }), fetchSummary: async () => { reads += 1; return {}; }, subscribeAuth: listener => { onAuth = listener; } });
  const pending = cache.get('project', 'one'); onAuth('SIGNED_IN', session('bob')); releaseSession(session('alice'));
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(reads, 0);
});
