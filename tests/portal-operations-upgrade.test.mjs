import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('offline service mutations are idempotent and removed only after success', async () => {
  const source = await read('src/lib/serviceOfflineQueue.js');
  assert.match(source, /client_mutation_id/);
  assert.match(source, /onConflict: 'client_mutation_id'/);
  assert.match(source, /await deleteMutation\(row\.id\)/);
  assert.match(source, /catch \(error\)[\s\S]*updateMutation/);
  assert.match(source, /resolvedVisitIds\.get\(row\.visitMutationId\)/);
});

test('SharePoint and calendar operations retry throttling and transient server errors', async () => {
  const storage = await read('supabase/functions/document-storage/index.ts');
  const calendar = await read('supabase/functions/crm-activity-calendar/index.ts');
  for (const source of [storage, calendar]) {
    assert.match(source, /response\.status === 429/);
    assert.match(source, /response\.status >= 500/);
    assert.match(source, /retry-after/i);
  }
  assert.match(storage, /repairFolder/);
  assert.match(storage, /getStatus/);
});

test('migration keeps public service data separate and enforces offer approval', async () => {
  const migration = await read('supabase/migrations/20260906213000_portal_operations_upgrade.sql');
  assert.match(migration, /create table if not exists public\.service_public_links/i);
  assert.match(migration, /create table if not exists public\.service_work_entries/i);
  assert.match(migration, /create table if not exists public\.portal_saved_views/i);
  assert.match(migration, /submit_crm_offer_for_approval/i);
  assert.match(migration, /discount_threshold_percent[\s\S]*default 15/i);
  assert.match(migration, /margin_floor_percent[\s\S]*default 20/i);
});

test('commercial document sender blocks an offer until approval', async () => {
  const source = await read('supabase/functions/send-crm-commercial-document/index.ts');
  assert.match(source, /requiresApproval/);
  assert.match(source, /approval_status !== 'approved'/);
  assert.match(source, /return json\([^)]*error:[\s\S]*409\)/);
});
