import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { previewReplacement } from '../../vite.preview.config.mjs';
import { supabase, resetPreviewData } from './supabasePreviewClient.js';
import { ADMIN_ID, MEMBER_ID, uuid } from './fixtures.js';
import { setPreviewRole, previewDate } from './previewState.js';
import { assessFinancialHealth, calculateRealizationRewardAllocation, getProjectFinancialHealthInputs } from '../domain/financials.js';
import { fetchWorkOverview } from '../lib/workOverviewData.js';
import { fetchPortalSearch } from '../lib/portalSearchData.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('preview redirects aliased, relative and resolved production backend imports', () => {
  for (const source of ['@/lib/customSupabaseClient', './customSupabaseClient', '../lib/customSupabaseClient.js', 'C:\\app\\src\\lib\\customSupabaseClient.js']) {
    assert.match(previewReplacement(source).replaceAll('\\', '/'), /src\/preview\/supabasePreviewClient\.js$/);
  }
  for (const source of ['@/contexts/SupabaseAuthContext', '../contexts/SupabaseAuthContext.jsx']) {
    assert.match(previewReplacement(source).replaceAll('\\', '/'), /src\/preview\/PreviewAuth\.jsx$/);
  }
  assert.equal(previewReplacement('@/contexts/AuthContext'), null);
});

test('real production entry cannot reach preview modules in its static/dynamic import graph', () => {
  const visited = new Set();
  function visit(filename) {
    if (visited.has(filename)) return;
    visited.add(filename);
    assert.ok(!filename.replaceAll('\\', '/').includes('/src/preview/'), filename);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, filename.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
    const imports = [];
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const name of imports) {
      if (!name.startsWith('.') && !name.startsWith('@/')) continue;
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.js')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved && /\.[jt]sx?$/.test(resolved)) visit(resolved);
    }
  }
  visit(path.join(root, 'src/main.jsx'));
  assert.ok(visited.size > 20);
  assert.ok(!fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('preview'));
});

test('available production assets do not contain the preview runtime marker', context => {
  const directory = path.join(root, 'dist');
  if (!fs.existsSync(directory)) { context.skip('Production dist is not present; source-graph isolation is verified separately.'); return; }
  const visit = current => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name);
      if (item.isDirectory()) visit(filename);
      else if (/\.(js|html)$/.test(item.name)) assert.ok(!fs.readFileSync(filename, 'utf8').includes('__EKV_PREVIEW__'), filename);
    }
  };
  visit(directory);
});

test('fixtures support actual home queries, searchable project data, joins and pagination', async () => {
  const count = await supabase.from('project_tasks').select('id', { count: 'exact', head: true }).not('status', 'in', '("Hotovo","Zrušeno")');
  assert.equal(count.count, 6);
  assert.equal(count.data, null);
  const search = await supabase.from('projects').select('id,name,code').ilike('code', '%26-024%').limit(6);
  assert.equal(search.data[0].id, uuid(301));
  const tasks = await supabase.from('project_tasks').select('*,project:projects(name,code)').eq('member_id', MEMBER_ID).order('end_date').range(0, 1);
  assert.equal(tasks.data.length, 2);
  assert.ok(tasks.data[0].project.name);
  const project = await supabase.rpc('get_project_safe', { p_project_id: uuid(301) });
  assert.equal(project.data.name, 'Rodinný dům · projektová dokumentace');
});

test('current production overview and global search run against the preview adapter', async () => {
  const overview = await fetchWorkOverview(supabase, { hasPermission: () => true, memberId: MEMBER_ID, isAdmin: true, userRole: 'admin' });
  assert.equal(overview.error, '');
  assert.equal(overview.openCount, 6);
  assert.equal(overview.approvalCount, 5);
  assert.ok(overview.approvals.some(item => item.href === '/employee?tab=requests&scope=all' || item.path === '/employee?tab=requests&scope=all'));
  assert.equal(overview.jobs.length, 5);
  assert.equal(overview.jobs.some(job => job.status === 'delivered'), false);
  const worker = await fetchWorkOverview(supabase, { hasPermission: (_module, level) => level === 'can_read', memberId: MEMBER_ID, isAdmin: false });
  assert.equal(worker.openCount, 3);
  assert.equal(worker.approvals.length, 0);
  for (const [term, expectedPath] of [
    ['PR-26-024', `/projects/${uuid(301)}`],
    ['RE-26-012', `/realizace/${uuid(401)}`],
    ['Koordinační zápis', '/documents?search='],
  ]) {
    const search = await fetchPortalSearch(supabase, term, () => true);
    assert.equal(search.error, '');
    assert.ok(search.results.some(result => result.path.startsWith(expectedPath)), term);
  }
});

test('preview writes are in-memory and resettable, while external integrations explicitly fail', async () => {
  const saved = await supabase.rpc('save_attendance_record', { p_member_id: MEMBER_ID, p_date: '2026-09-05', p_hours: 2, p_project_id: uuid(301) });
  assert.equal(saved.data.hours, 2);
  assert.equal((await supabase.from('attendance').select('*').eq('id', saved.data.id).single()).data.hours, 2);
  resetPreviewData();
  assert.equal((await supabase.from('attendance').select('*').eq('id', saved.data.id).maybeSingle()).data, null);
  for (const result of [await supabase.functions.invoke('send-email'), await supabase.storage.from('documents').upload('x', 'x'), await supabase.rpc('unknown_external_operation', {})]) {
    assert.equal(result.error.code, 'PREVIEW_UNAVAILABLE');
    assert.equal(result.data, null);
  }
});

test('employee preview scopes own records and only explicit active profiles enable worker access', async () => {
  resetPreviewData();
  setPreviewRole('member');
  for (const table of ['employee_profiles', 'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events']) {
    const result = await supabase.from(table).select('*');
    assert.ok(result.data.length > 0, table);
    assert.ok(result.data.every(row => row.member_id === MEMBER_ID), table);
    assert.equal((await supabase.from(table).update({ note: 'unauthorized' }).eq('member_id', MEMBER_ID)).error.code, '42501');
  }
  assert.equal((await supabase.rpc('set_employee_profile', { p_member_id: MEMBER_ID, p_employment_status: 'inactive' })).error.code, '42501');
  setPreviewRole('admin');
  assert.ok((await supabase.from('employee_requests').select('*')).data.some(row => row.member_id !== MEMBER_ID));
  await supabase.rpc('set_employee_profile', { p_member_id: MEMBER_ID, p_employment_status: 'inactive' });
  setPreviewRole('member');
  assert.deepEqual((await supabase.from('employee_records').select('*')).data, []);
  assert.equal((await supabase.rpc('create_employee_request', { p_request: { request_type: 'training', title: 'Kurz' } })).error.code, '42501');
  setPreviewRole('admin');
  assert.equal((await supabase.from('employee_profiles').select('*').eq('member_id', MEMBER_ID).single()).data.employment_status, 'inactive');
  resetPreviewData();
});

test('request create, approve and fulfill update state and append an immutable actor history', async () => {
  resetPreviewData();
  setPreviewRole('member');
  const payload = { id: uuid(90001), request_type: 'license', title: 'CAD licence', description: 'Roční licence', estimated_cost: 4800, requested_for: previewDate(10), member_id: ADMIN_ID, status: 'approved' };
  const created = await supabase.rpc('create_employee_request', { p_request: payload });
  assert.equal(created.error, null);
  assert.equal(created.data.member_id, MEMBER_ID);
  assert.equal(created.data.status, 'pending');
  assert.equal((await supabase.rpc('create_employee_request', { p_request: payload })).data.id, created.data.id);
  assert.ok((await supabase.rpc('create_employee_request', { p_request: { ...payload, title: 'Different request' } })).error);
  assert.ok((await supabase.rpc('transition_employee_request', { p_request_id: created.data.id, p_status: 'approved' })).error);
  setPreviewRole('admin');
  const approved = await supabase.rpc('transition_employee_request', { p_request_id: created.data.id, p_status: 'approved', p_note: 'Schváleno' });
  assert.equal(approved.data.decided_by, ADMIN_ID);
  assert.equal(approved.data.decision_note, 'Schváleno');
  const fulfilled = await supabase.rpc('transition_employee_request', { p_request_id: created.data.id, p_status: 'fulfilled', p_note: 'Licence předána' });
  assert.equal(fulfilled.data.fulfilled_by, ADMIN_ID);
  const history = await supabase.from('employee_request_events').select('*').eq('request_id', created.data.id).order('created_at');
  assert.deepEqual(history.data.map(row => row.to_status), ['pending', 'approved', 'fulfilled']);
  assert.equal(history.data[0].actor_member_id, MEMBER_ID);
  assert.equal(history.data[2].actor_name, 'Jan Novák');
  assert.equal(history.data[2].from_status, 'approved');
  assert.equal(history.data[2].note, 'Licence předána');
  assert.equal((await supabase.from('employee_request_events').delete().eq('request_id', created.data.id)).error.code, '42501');
  assert.ok((await supabase.rpc('transition_employee_request', { p_request_id: created.data.id, p_status: 'rejected', p_note: 'Zpět' })).error);
  assert.equal((await supabase.from('employee_request_events').select('*').eq('request_id', created.data.id)).data.length, 3);
  resetPreviewData();
  assert.equal((await supabase.from('employee_requests').select('*').eq('id', created.data.id).maybeSingle()).data, null);
});

test('request cancellation is own pending only and rejection requires a reason without partial writes', async () => {
  resetPreviewData();
  setPreviewRole('member');
  assert.ok((await supabase.rpc('transition_employee_request', { p_request_id: uuid(2703), p_status: 'cancelled' })).error);
  assert.ok((await supabase.rpc('transition_employee_request', { p_request_id: uuid(2702), p_status: 'cancelled' })).error);
  const cancelled = await supabase.rpc('transition_employee_request', { p_request_id: uuid(2701), p_status: 'cancelled', p_note: 'Jiný termín' });
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal(cancelled.data.decided_by, MEMBER_ID);
  setPreviewRole('admin');
  const before = await supabase.from('employee_request_events').select('*').eq('request_id', uuid(2703));
  assert.ok((await supabase.rpc('transition_employee_request', { p_request_id: uuid(2703), p_status: 'rejected', p_note: '  ' })).error);
  assert.equal((await supabase.from('employee_request_events').select('*').eq('request_id', uuid(2703))).data.length, before.data.length);
  const rejected = await supabase.rpc('transition_employee_request', { p_request_id: uuid(2703), p_status: 'rejected', p_note: 'Použijeme současnou licenci.' });
  assert.equal(rejected.data.status, 'rejected');
  assert.equal(rejected.data.decision_note, 'Použijeme současnou licenci.');
  resetPreviewData();
});

test('asset and record RPCs persist verified and returned states, validate dates and protect worker writes', async () => {
  resetPreviewData();
  setPreviewRole('member');
  assert.equal((await supabase.rpc('return_employee_asset', { p_asset_id: uuid(2501) })).error.code, '42501');
  setPreviewRole('admin');
  const asset = await supabase.rpc('save_employee_asset', { p_member_id: MEMBER_ID, p_asset: { asset_type: 'key', label: 'Klíč skladu', assigned_on: previewDate(), due_on: previewDate(10), status: 'returned' } });
  assert.equal(asset.data.status, 'issued');
  assert.ok((await supabase.rpc('return_employee_asset', { p_asset_id: asset.data.id, p_returned_on: previewDate(-1) })).error);
  const returned = await supabase.rpc('return_employee_asset', { p_asset_id: asset.data.id, p_returned_on: previewDate(1), p_note: 'Vráceno v pořádku' });
  assert.equal(returned.data.status, 'returned');
  assert.equal(returned.data.returned_on, previewDate(1));
  assert.equal((await supabase.from('employee_asset_assignments').select('*').eq('id', asset.data.id).single()).data.status, 'returned');
  const record = await supabase.rpc('save_employee_record', { p_member_id: MEMBER_ID, p_record_id: uuid(2603), p_record: { title: 'Školení bezpečnosti práce', kind: 'training', status: 'verified', valid_from: previewDate(), valid_until: previewDate(365) } });
  assert.equal(record.data.verified_by, ADMIN_ID);
  assert.ok(record.data.verified_at);
  assert.ok((await supabase.rpc('save_employee_record', { p_member_id: MEMBER_ID, p_record: { title: 'Chybné datum', kind: 'training', status: 'pending', valid_from: '2026-02-30' } })).error);
  assert.ok((await supabase.rpc('save_employee_record', { p_member_id: MEMBER_ID, p_record: { title: 'Odkaz', kind: 'contract', reference_url: 'javascript:alert(1)' } })).error);
  resetPreviewData();
});

test('canonical project and realization preview finances have real reserves rather than false exhausted budgets', async () => {
  resetPreviewData();
  for (const project of (await supabase.from('projects').select('*')).data) {
    assert.ok(!project.brief.includes('<p>'));
    assert.notEqual(project.status, 'offer');
    const { data, error } = await supabase.rpc('project_financial_summary', { p_project_id: project.id });
    assert.equal(error, null);
    assert.equal(data.financial_model_version, 2);
    const rewards = data.member_rewards.reduce((sum, row) => sum + row.total_reward, 0);
    const health = assessFinancialHealth(getProjectFinancialHealthInputs({ teamBudget: data.team_budget, rewardBaseBudget: data.cost_adjusted_team_budget, teamRewards: rewards }));
    assert.equal(health.status, 'healthy');
    assert.equal(data.price, project.price);
    assert.equal(data.cost_adjusted_team_budget, data.team_budget - data.unassigned_direct_costs - data.allocated_overhead_costs);
  }
  const result = await supabase.rpc('realization_financial_preview', { p_realization_id: uuid(401), p_overrides: {} });
  const summary = result.data;
  const allocation = calculateRealizationRewardAllocation(summary.member_shares, summary.team_budget);
  assert.ok(allocation.unallocatedBudget > 0);
  assert.equal(summary.total_revenue, summary.profit_amount + summary.overhead_amount + summary.operational_costs + summary.team_budget);
  const changed = await supabase.rpc('realization_financial_preview', { p_realization_id: uuid(401), p_overrides: { contract_amount: 2000000 } });
  assert.equal(changed.data.base_contract_amount, 2000000);
  const plan = await supabase.rpc('get_realization_reward_plan', { p_realization_id: uuid(401) });
  assert.equal(plan.error, null);
  assert.equal(plan.data.activation_state, 'planned');
  assert.equal(plan.data.shares.length, 2);
  assert.equal(plan.data.shares[0].share_value, 25);
});

test('asset create retries reuse their stable id without duplicating rows or overwriting a later return', async () => {
  resetPreviewData();
  setPreviewRole('admin');
  const input = { id: uuid(91001), asset_type: 'device', label: '  Projektový tablet  ', identifier: ' T-01 ', assigned_on: previewDate(), due_on: previewDate(30), note: ' Předáno ' };
  const args = { p_member_id: MEMBER_ID, p_asset_id: null, p_asset: input };
  const created = await supabase.rpc('save_employee_asset', args);
  assert.equal(created.error, null);
  assert.equal(created.data.id, input.id);
  const retried = await supabase.rpc('save_employee_asset', { ...args, p_asset: { ...input, label: 'Projektový tablet', identifier: 'T-01', note: 'Předáno' } });
  assert.deepEqual(retried.data, created.data);
  assert.equal((await supabase.from('employee_asset_assignments').select('*').eq('id', input.id)).data.length, 1);
  for (const changed of [{ ...args, p_member_id: ADMIN_ID }, { ...args, p_asset: { ...input, label: 'Jiný tablet' } }]) assert.ok((await supabase.rpc('save_employee_asset', changed)).error);
  assert.deepEqual((await supabase.from('employee_asset_assignments').select('*').eq('id', input.id).single()).data.label, 'Projektový tablet');
  const returned = await supabase.rpc('return_employee_asset', { p_asset_id: input.id, p_returned_on: previewDate(1) });
  const lateRetry = await supabase.rpc('save_employee_asset', args);
  assert.deepEqual(lateRetry.data, returned.data);
  assert.equal(lateRetry.data.status, 'returned');
  resetPreviewData();
});

test('record create retries preserve verification and reject identifier reuse with changed content or member', async () => {
  resetPreviewData();
  setPreviewRole('admin');
  const input = { id: uuid(91002), title: ' Školení CAD ', kind: 'training', status: 'verified', valid_from: previewDate(), valid_until: previewDate(365), reference_url: ' https://example.invalid/cad ', note: ' Ověřeno ' };
  const args = { p_member_id: MEMBER_ID, p_record_id: null, p_record: input };
  const created = await supabase.rpc('save_employee_record', args);
  assert.equal(created.error, null);
  assert.equal(created.data.id, input.id);
  const retried = await supabase.rpc('save_employee_record', { ...args, p_record: { ...input, title: 'Školení CAD', reference_url: 'https://example.invalid/cad', note: 'Ověřeno' } });
  assert.deepEqual(retried.data, created.data);
  assert.equal((await supabase.from('employee_records').select('*').eq('id', input.id)).data.length, 1);
  for (const changed of [{ ...args, p_member_id: ADMIN_ID }, { ...args, p_record: { ...input, status: 'pending' } }]) assert.ok((await supabase.rpc('save_employee_record', changed)).error);
  const edited = await supabase.rpc('save_employee_record', { ...args, p_record_id: input.id, p_record: { ...input, id: uuid(91999), status: 'expired' } });
  assert.equal(edited.data.id, input.id);
  assert.equal(edited.data.status, 'expired');
  assert.equal(edited.data.verified_at, created.data.verified_at);
  assert.ok((await supabase.rpc('save_employee_record', args)).error);
  assert.equal((await supabase.from('employee_records').select('*').eq('id', uuid(91999)).maybeSingle()).data, null);
  resetPreviewData();
});

test('member reward RPC applies order and range so complete financial traversal terminates', async () => {
  resetPreviewData();
  setPreviewRole('member');
  const ids = [];
  let reachedEnd = false;
  for (let offset = 0; offset < 8; offset += 2) {
    const page = await supabase.rpc('get_member_project_rewards', { p_member_id: MEMBER_ID }).order('project_id').range(offset, offset + 1);
    assert.equal(page.error, null);
    if (!page.data.length) { reachedEnd = true; break; }
    ids.push(...page.data.map(row => row.project_id));
  }
  assert.equal(reachedEnd, true);
  assert.deepEqual(ids, [uuid(301), uuid(302), uuid(303), uuid(304)]);
  assert.equal(new Set(ids).size, ids.length);
  const denied = await supabase.rpc('get_member_project_rewards', { p_member_id: ADMIN_ID }).range(0, 1);
  assert.equal(denied.error.code, '42501');
  setPreviewRole('admin');
});

test('the production employee finance loader completes against the actual preview client', async () => {
  // Isolate the loader so a future paging regression cannot starve the main
  // test runner's timeout with an endless chain of resolved query promises.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    Promise.all([import(workerData.client), import(workerData.domain), import(workerData.state)]).then(async ([client, domain, state]) => {
      state.setPreviewRole('member');
      const finance = await domain.loadEmployeeFinance(client.supabase, {
        actorMemberId: workerData.memberId, targetMemberId: workerData.memberId,
        isAdmin: false, signal: AbortSignal.timeout(1000),
      });
      parentPort.postMessage({ finance, view: domain.employeeFinanceView(finance) });
    }).catch(error => parentPort.postMessage({ error: error.message }));
  `, { eval: true, workerData: {
    client: new URL('./supabasePreviewClient.js', import.meta.url).href,
    domain: new URL('../lib/employeeWorkspaceData.js', import.meta.url).href,
    state: new URL('./previewState.js', import.meta.url).href,
    memberId: MEMBER_ID,
  } });
  let watchdog;
  try {
    const result = await new Promise((resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('Employee finance paging did not finish within 3 seconds.')), 3000);
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    assert.equal(result.error, undefined);
    for (const section of Object.values(result.finance)) assert.equal(section.error, null);
    assert.equal(result.finance.compensation.data.currency, 'CZK');
    assert.equal(result.finance.rewards.data.length, 4);
    assert.equal(result.view.entitlements.length, 6);
    assert.ok(Math.abs(result.view.available - 159000) < 0.01);
    assert.equal(result.view.paid, 24000);
    assert.equal(result.view.pending, 39300);
    assert.equal(result.view.payouts.length, 3);
  } finally {
    clearTimeout(watchdog);
    await worker.terminate();
  }
});

test('billing summary and employee financial RPCs return coherent existing UI contracts', async () => {
  resetPreviewData();
  setPreviewRole('member');
  const billing = await supabase.rpc('get_entity_billing_summary', { p_entity_type: 'project', p_entity_id: uuid(301) });
  assert.equal(billing.error, null);
  assert.equal(billing.data.contract_amount_excl_vat, 185000);
  assert.equal(billing.data.invoiced_amount_excl_vat, 111000);
  assert.equal(billing.data.milestones.filter(row => row.status === 'planned')[0].planned_issue_date, previewDate(7));
  assert.equal(billing.data.entries.length, 2);
  assert.equal(billing.data.entries.reduce((sum, row) => sum + row.amount_excl_vat, 0), billing.data.invoiced_amount_excl_vat);
  assert.ok(Math.abs(billing.data.entries.reduce((sum, row) => sum + row.paid_amount / 1.21, 0) - billing.data.paid_amount_excl_vat_equivalent) < 0.01);
  const availability = await supabase.rpc('get_payout_availability', { p_member_id: MEMBER_ID, p_edit_payout_id: null });
  assert.ok(availability.data.projects.length > 0);
  assert.ok(availability.data.realizations.length > 0);
  assert.equal(availability.data.projects.find(row => row.project_id === uuid(302)).paid_payouts, 24000);
  assert.ok(availability.data.projects.every(row => row.available_balance >= 0 && row.project_name));
  const compensation = await supabase.rpc('get_member_compensation', { p_member_id: MEMBER_ID });
  assert.equal(compensation.data.hourly_rate, 450);
  assert.equal(compensation.data.currency, 'CZK');
  for (const name of ['get_member_compensation', 'get_member_project_rewards', 'get_payout_availability', 'get_projects_with_balance', 'get_realizations_with_balance']) {
    assert.equal((await supabase.rpc(name, { p_member_id: ADMIN_ID })).error.code, '42501');
  }
  setPreviewRole('admin');
});

test('record detail preview has real team joins, a linked project, and an assigned task without a deadline', async () => {
  resetPreviewData();
  setPreviewRole('admin');
  const realization = await supabase.rpc('get_realization_safe', { p_realization_id: uuid(401) });
  assert.equal(realization.data.linked_project_id, uuid(302));
  const team = await supabase.from('realizace_team_members').select('*, member:members(name)').eq('realizace_id', uuid(401));
  assert.deepEqual(team.data.map(row => row.member.id), [ADMIN_ID, MEMBER_ID]);
  assert.ok(team.data.every(row => row.member.name && row.responsibility && row.valid_from));
  const tasks = await supabase.from('project_tasks').select('*, member:members(name)').eq('project_id', uuid(301));
  const undated = tasks.data.find(row => row.end_date === null);
  assert.equal(undated.member.id, MEMBER_ID);
  assert.equal(undated.start_date, null);
});

test('self realization reward preview is scoped to signed-in member and agrees with the payout workspace', async () => {
  resetPreviewData();
  setPreviewRole('member');
  const own = await supabase.rpc('get_my_realization_reward', { p_realization_id: uuid(401), p_member_id: ADMIN_ID });
  const availability = await supabase.rpc('get_realizations_with_balance', { p_member_id: MEMBER_ID });
  assert.equal(own.data.member_id, MEMBER_ID);
  assert.equal(own.data.has_reward, true);
  assert.equal(own.data.net_reward, availability.data.find(row => row.id === uuid(401)).total_share);
  assert.equal('team_budget' in own.data, false);
  assert.equal('member_shares' in own.data, false);
  const missing = await supabase.rpc('get_my_realization_reward', { p_realization_id: uuid(499) });
  assert.equal(missing.data.has_reward, false);
  setPreviewRole('admin');
});
