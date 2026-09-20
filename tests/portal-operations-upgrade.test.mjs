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

test('SharePoint realization folders use the business code instead of an internal UUID fragment', async () => {
  const storage = await read('supabase/functions/document-storage/index.ts');
  const form = await read('src/components/RealizaceForm.jsx');
  assert.match(storage, /entityType === 'realizace'\s*\? 'id, code, name, status, start_date, created_at'/);
  assert.match(storage, /const code = normalizeEntityFolderCode\(data\.code\);/);
  assert.doesNotMatch(storage, /`R-\$\{String\(data\.id\)\.slice\(0, 8\)\}`/);
  assert.match(form, /if \(targetId\) \{[\s\S]*ensureEntityFolder\(\{[\s\S]*entityType: 'realizace'/);
  assert.match(form, /code: savedRealization\?\.code \|\| dataToSave\.code/);
});

test('realization business code is exposed by safe reads and enforced by atomic writes', async () => {
  const migration = await read('supabase/migrations/20260920100000_realization_business_code_workflow.sql');
  assert.match(migration, /code = 'R-' \|\| upper\(left\(replace\(id::text, '-', ''\), 8\)\)/);
  assert.match(migration, /where nullif\(btrim\(code\), ''\) is null/);
  assert.match(migration, /returns table \([\s\S]*code text,[\s\S]*r\.code/);
  assert.match(migration, /'code', r\.code/);
  assert.match(migration, /v_code text := nullif\(btrim\(coalesce\(p_payload->>'code', ''\)\), ''\)/);
  assert.match(migration, /where lower\(btrim\(r\.code\)\) = lower\(v_code\)/);
  assert.match(migration, /set[\s\S]*code = v_code/);
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
