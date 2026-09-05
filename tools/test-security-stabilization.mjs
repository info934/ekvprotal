import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getAuthPermissionRefresh } from '../src/lib/authPermissionRefresh.js';

// Execute the actual Edge helpers with isolated fake provider/DB adapters, without
// Deno, credentials, network calls or a dependency on a running Supabase instance.
function loadEdge(relativePath, dependencies = {}, environment = {}, runtime = {}) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  const module = { exports: {} };
  const requireDependency = (id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  };
  // Expected denial/timeout scenarios should not flood test output with Edge logs.
  new Function('require', 'module', 'exports', 'Deno', 'console', outputText)(
    requireDependency, module, module.exports, { ...runtime, env: { get: (key) => environment[key] } },
    { ...console, error: () => {} },
  );
  return module.exports;
}

const { assertActiveAccount } = loadEdge('supabase/functions/_shared/accountStatus.ts');
const { assertInvoiceFileDetached } = loadEdge('supabase/functions/_shared/invoiceDeletionGuard.ts');
const statusClient = (result) => ({ from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => result }) });

test('external invoice deletion rejects references in either payout table and fails closed on lookup error', async () => {
  const file = { connectionId: 'connection', fileId: 'file', fileUrl: 'https://example.invalid/invoice.pdf' };
  const database = (tables = {}, error = null) => ({ from(table) {
    const filters = [];
    return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      async limit() { return { error, data: (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, 1) }; },
    };
  } });
  for (const table of ['payouts', 'hourly_payout_requests']) {
    for (const status of ['invoice_uploaded', 'paid', 'cancelled', 'rejected']) {
      await assert.rejects(assertInvoiceFileDetached(database({ [table]: [{
        id: 'payout', status, invoice_storage_connection_id: 'connection', invoice_external_file_id: 'file',
      }] }), file), { status: 409 });
      await assert.rejects(assertInvoiceFileDetached(database({ [table]: [{ id: 'legacy', status, invoice_url: file.fileUrl }] }), file), { status: 409 });
    }
  }
  await assert.rejects(assertInvoiceFileDetached(database({}, { message: 'DB unavailable' }), file), { status: 503 });
  await assertInvoiceFileDetached(database({ payouts: [{
    id: 'detached', invoice_storage_connection_id: null, invoice_external_file_id: null, invoice_url: null,
  }, { id: 'different-drive', invoice_storage_connection_id: 'another', invoice_external_file_id: 'file' }] }), file);
});

test('account status accepts legacy/active and rejects disabled/error states', async () => {
  await assertActiveAccount(statusClient({ data: null }), 'user');
  await assertActiveAccount(statusClient({ data: { status: 'active' } }), 'user');
  for (const status of ['disabled', 'unexpected']) {
    await assert.rejects(assertActiveAccount(statusClient({ data: { status } }), 'user'), { status: 403 });
  }
  await assert.rejects(assertActiveAccount(statusClient({ error: { code: '42P01' } }), 'user'), { status: 503 });
});

test('Edge authorization rejects a disabled admin before the admin bypass', async () => {
  let memberRead = false;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'disabled-admin' } } }) },
    from(table) {
      if (table === 'user_account_status') return statusClient({ data: { status: 'disabled' } }).from();
      memberRead = true;
      throw new Error('Must not query role for a disabled account');
    },
  };
  const { authorizeFunctionRequest } = loadEdge('supabase/functions/_shared/authorize.ts', {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => admin },
    './accountStatus.ts': { assertActiveAccount },
  }, { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' });
  await assert.rejects(authorizeFunctionRequest(new Request('https://example.invalid', {
    headers: { Authorization: 'Bearer user-token' },
  }), { adminOnly: true }), { status: 403 });
  assert.equal(memberRead, false);
  assert.equal((await authorizeFunctionRequest(new Request('https://example.invalid', {
    headers: { Authorization: 'Bearer server-only' },
  }))).isServiceRole, true);
});

test('standalone Edge endpoints reject disabled users before service-role work or provider calls', async () => {
  for (const functionName of ['analyze-contract', 'planning-calendar', 'document-storage', 'google-drive-esign', 'manage-users']) {
    let handler;
    const admin = {
      auth: { getUser: async () => ({ data: { user: { id: 'disabled-admin' } } }) },
      from(table) {
        assert.equal(table, 'user_account_status', `${functionName} performed privileged work before the status check`);
        return statusClient({ data: { status: 'disabled' } }).from();
      },
    };
    const dependencies = {
      'https://esm.sh/@supabase/supabase-js@2.30.0': { createClient: () => admin },
      'https://esm.sh/@supabase/supabase-js@2.45.4': { createClient: () => admin },
      '../_shared/cors.ts': { corsHeaders: {} },
      './cors.ts': { corsHeaders: {} },
      '../_shared/accountStatus.ts': { assertActiveAccount },
      '../_shared/invoiceDeletionGuard.ts': { assertInvoiceFileDetached },
      '../_shared/fetch.ts': { fetchWithTimeout: () => { throw new Error('Unexpected provider call'); } },
      'https://deno.land/std@0.177.0/http/server.ts': { serve: (next) => { handler = next; } },
    };
    loadEdge(`supabase/functions/${functionName}/index.ts`, dependencies, {
      SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      SUPABASE_ANON_KEY: 'test-only', OPENAI_API_KEY: 'test-only',
    }, { serve: (next) => { handler = next; } });
    assert.equal(typeof handler, 'function');
    const response = await handler(new Request(`https://example.invalid/${functionName}`, {
      method: 'POST', headers: { Authorization: 'Bearer disabled-user-token' },
      body: JSON.stringify({ action: 'testConnection' }),
    }));
    assert.equal(response.status, 403, functionName);
    assert.equal((await response.json()).error, 'Account is disabled.', functionName);
  }
});

test('token refresh revalidates the active user without a foreground remount', () => {
  const base = { userId: 'a', previousUserId: 'a', loadedUserId: 'a', loadingUserId: null };
  assert.deepEqual(getAuthPermissionRefresh({ ...base, event: 'TOKEN_REFRESHED' }), {
    foreground: false, invalidateCache: true,
  });
  assert.deepEqual(getAuthPermissionRefresh({ ...base, event: 'USER_UPDATED' }), {
    foreground: false, invalidateCache: true,
  });
  assert.equal(getAuthPermissionRefresh({ ...base, event: 'SIGNED_IN' }), null);
  assert.equal(getAuthPermissionRefresh({ ...base, event: 'SIGNED_OUT' }), null);
  assert.deepEqual(getAuthPermissionRefresh({ ...base, previousUserId: 'b', event: 'SIGNED_IN' }), {
    foreground: true, invalidateCache: true,
  });
  assert.equal(getAuthPermissionRefresh({ ...base, loadedUserId: null, loadingUserId: 'a', event: 'INITIAL_SESSION' }), null);
  assert.deepEqual(getAuthPermissionRefresh({ ...base, loadedUserId: null, loadingUserId: 'a', event: 'TOKEN_REFRESHED' }), {
    foreground: true, invalidateCache: true,
  });
});

function deliveryDatabase({ existing = null, failLookup = false, failClaim = false, failOutcome = false } = {}) {
  let row = existing && { id: 'delivery-id', attempts: 1, ...existing };
  const client = { from(table) {
    assert.equal(table, 'workflow_email_deliveries');
    let operation = 'read'; let values; const filters = [];
    const query = {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      update(value) { operation = 'update'; values = value; return this; },
      insert(value) { operation = 'insert'; values = value; return this; },
      maybeSingle() { return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    const execute = async () => {
      if (operation === 'read') return failLookup ? { error: { code: 'DB_OFFLINE' } } : { data: row && { ...row } };
      if (operation === 'insert') {
        if (failClaim) return { error: { code: 'DB_OFFLINE' } };
        if (row) return { error: { code: '23505' } };
        row = { id: 'delivery-id', attempts: 1, ...values };
        return { data: null };
      }
      if (values.status === 'pending' && failClaim) return { error: { code: 'DB_OFFLINE' } };
      if (values.status === 'sent' && failOutcome) return { error: { code: 'DB_OFFLINE' } };
      if (!row || filters.some(([key, value]) => row[key] !== value)) return { data: null };
      row = { ...row, ...values };
      return { data: { id: row.id } };
    };
    return query;
  } };
  return { client, row: () => row };
}

function deliveryHarness(databaseOptions = {}, provider = async () => Response.json({ id: 'email-id' })) {
  const db = deliveryDatabase(databaseOptions);
  let sends = 0;
  const { sendTrackedEmail } = loadEdge('supabase/functions/_shared/emailDelivery.ts', {
    './fetch.ts': { fetchWithTimeout: async (_url, init) => {
      sends += 1;
      assert.equal(init.headers['Idempotency-Key'], 'test-event:person@example.invalid');
      return provider(init);
    } },
  });
  return {
    send: (extra = {}) => sendTrackedEmail({ admin: db.client, resendApiKey: 'test-only', from: 'sender@example.invalid',
      to: ['person@example.invalid'], subject: 'Test', html: '<p>Test</p>', idempotencyKey: 'test-event',
      workflowType: 'test', entityType: 'test', eventType: 'test', ...extra }),
    sends: () => sends, row: db.row,
  };
}

test('email does not contact provider when delivery history or claim cannot be persisted', async () => {
  for (const settings of [{ failLookup: true }, { failClaim: true }]) {
    const harness = deliveryHarness(settings);
    await assert.rejects(harness.send(), { status: 503 });
    assert.equal(harness.sends(), 0);
  }
});

test('successful email records evidence and subsequent invocation deduplicates', async () => {
  const harness = deliveryHarness();
  assert.equal((await harness.send()).recorded, true);
  assert.equal((await harness.send()).duplicate, true);
  assert.equal(harness.sends(), 1);
  assert.equal(harness.row().status, 'sent');
});

test('simultaneous first attempts and retries send exactly once', async () => {
  for (const existing of [null, { status: 'failed', idempotency_key: 'test-event:person@example.invalid' }]) {
    const harness = deliveryHarness({ existing });
    const results = await Promise.allSettled([harness.send(), harness.send()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(harness.sends(), 1);
  }
});

test('network ambiguity, invalid JSON and upstream server errors stay pending without resend', async () => {
  for (const provider of [
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
    async () => new Response('not json'),
    async () => Response.json({ message: 'Upstream unavailable' }, { status: 500 }),
    async () => Response.json({ message: 'Concurrent request' }, { status: 409 }),
    async () => Response.json({}),
  ]) {
    const harness = deliveryHarness({}, provider);
    await assert.rejects(harness.send(), { status: 409 });
    await assert.rejects(harness.send(), { status: 409 });
    assert.equal(harness.sends(), 1);
    assert.equal(harness.row().status, 'pending');
    assert.ok(harness.row().error_message);
  }
});

test('provider success plus evidence failure reports success with warning and blocks duplicate', async () => {
  const harness = deliveryHarness({ failOutcome: true });
  const result = await harness.send();
  assert.equal(result.success, true);
  assert.equal(result.recorded, false);
  assert.ok(result.warning);
  await assert.rejects(harness.send(), { status: 409 });
  assert.equal(harness.sends(), 1);
});

test('definite provider rejection is failed and can retry with the same idempotency key', async () => {
  let calls = 0;
  const harness = deliveryHarness({}, async () => ++calls === 1
    ? Response.json({ message: 'Invalid recipient' }, { status: 422 })
    : Response.json({ id: 'email-id' }));
  await assert.rejects(harness.send(), { status: 502 });
  assert.equal(harness.row().status, 'failed');
  assert.equal((await harness.send()).success, true);
  assert.equal(harness.row().attempts, 2);
});

test('tracked email forwards report attachment without changing recipients', async () => {
  const attachments = [{ filename: 'report.csv', content: 'dGVzdA==' }];
  const harness = deliveryHarness({}, async init => {
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.attachments, attachments);
    assert.deepEqual(payload.to, ['person@example.invalid']);
    return Response.json({ id: 'attachment-email' });
  });
  assert.equal((await harness.send({ attachments })).success, true);
});
