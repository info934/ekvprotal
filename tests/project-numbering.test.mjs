import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSchema } from '../src/lib/validationSchemas.js';
import { formatProjectCode, normalizeProjectPrefix, suggestProjectPrefix, saveProjectType } from '../src/lib/projectNumbering.js';
import { supabase, resetPreviewData } from '../src/preview/supabasePreviewClient.js';
import { setPreviewRole } from '../src/preview/previewState.js';

test('new project accepts an unknown client, zero price and an automatic number', () => {
  const result = createProjectSchema().safeParse({ name: ' Nová zakázka ', status: 'nabidka', price: '', budget_percentage: 30, overhead_percentage: 10, investor_id: null, client_id: '', estimated_work_days: '' });
  assert.equal(result.success, true);
  assert.equal(result.data.name, 'Nová zakázka');
  assert.equal(result.data.price, 0);
  assert.equal(result.data.estimated_work_days, 10);
  assert.equal(result.data.client_id, null);
});

test('optional fields retain meaningful validation and existing project codes remain required', () => {
  const base = { name: 'Projekt', status: 'nabidka', price: 0, budget_percentage: 30, overhead_percentage: 10, estimated_work_days: 10 };
  assert.equal(createProjectSchema().safeParse({ ...base, name: ' ' }).success, false);
  assert.equal(createProjectSchema().safeParse({ ...base, price: -1 }).success, false);
  assert.equal(createProjectSchema().safeParse({ ...base, estimated_work_days: 0 }).success, false);
  assert.equal(createProjectSchema().safeParse({ ...base, investor_id: 'invalid' }).success, false);
  assert.equal(createProjectSchema({ requireCode: true }).safeParse({ ...base, code: '' }).success, false);
  assert.equal(createProjectSchema().safeParse({ ...base, start_date: '2026-10-14', completion_date: '2026-10-01' }).success, false);
});

test('prefix normalization and long sequence formatting do not truncate numbers', () => {
  assert.equal(normalizeProjectPrefix(' fve '), 'FVE');
  assert.equal(suggestProjectPrefix('Řízení stavby'), 'RIZENI-STAVBY');
  assert.equal(formatProjectCode('FVE', 1, 2026), 'FVE-26-001');
  assert.equal(formatProjectCode('FVE', 1000, 2026), 'FVE-26-1000');
  assert.equal(formatProjectCode('OP-FVE', 1, 2027), 'OP-FVE-27-001');
});

test('invalid prefix is rejected before calling the server', async () => {
  const client = { rpc() { assert.fail('Invalid data reached server'); } };
  await assert.rejects(saveProjectType(client, { name: 'FVE', prefix: 'FVE / RD' }), /Prefix/);
});

test('preview workflow shares types between OP and projects and saves successive automatic numbers', async () => {
  resetPreviewData(); setPreviewRole('admin');
  const { data: type, error } = await supabase.rpc('save_project_type', { p_name: 'Baterie', p_code_prefix: 'BESS' });
  assert.equal(error, null);
  assert.equal(type.code_prefix, 'BESS');
  const year = String(new Date().getFullYear()).slice(-2);
  const preview = await supabase.rpc('preview_project_code', { p_project_type: type.name });
  assert.equal(preview.data, `BESS-${year}-001`);
  const op = await supabase.rpc('create_crm_opportunity_simple', { p_payload: { title: 'Baterie klient doplní', project_type: type.name } });
  assert.equal(op.error, null);
  assert.equal(op.data.number, `OP-BESS-${year}-001`);
  assert.equal(op.data.subject_id, null);
  const first = await supabase.rpc('save_project_safe', { p_payload: { name: 'Projekt', type: op.data.project_type, code: null } });
  const second = await supabase.rpc('save_project_safe', { p_payload: { name: 'Projekt 2', type: type.name, code: null } });
  assert.equal(first.data.code, `BESS-${year}-001`);
  assert.equal(second.data.code, `BESS-${year}-002`);
  const duplicate = await supabase.rpc('save_project_safe', { p_payload: { name: 'Ruční duplicita', code: first.data.code } });
  assert.equal(duplicate.error.code, '23505');
  const edited = await supabase.rpc('save_project_safe', { p_project_id: first.data.id, p_payload: { name: 'Přejmenovaný projekt', code: first.data.code, type: 'FVE' } });
  assert.equal(edited.data.code, first.data.code);
  setPreviewRole('member');
  assert.equal((await supabase.rpc('save_project_type', { p_name: 'Zakázaný', p_code_prefix: 'NO' })).error.code, '42501');
  resetPreviewData(); setPreviewRole('admin');
});
