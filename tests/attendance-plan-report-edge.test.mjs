import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as report from '../supabase/functions/_shared/attendancePlanReport.js';

function handler() {
  let serve, sends = 0, captured;
  const dependencies = {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) },
    '../_shared/emailDelivery.ts': { sendTrackedEmail: async input => { sends++; captured = input; return { success: true, emailId: 'fake' }; } },
    '../_shared/attendancePlanReport.js': { ...report, nextReportMonth: () => '2026-10', scheduledReportMonth: () => null },
  };
  const source = fs.readFileSync(new URL('../supabase/functions/send-attendance-plan-report/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const environment = { ATTENDANCE_PLAN_REPORT_SECRET: 'test-secret', RESEND_API_KEY: 'fake-key' };
  new Function('require', 'exports', 'Deno', compiled)(id => dependencies[id], {}, { env: { get: key => environment[key] }, serve: value => { serve = value; } });
  return { call: serve, sends: () => sends, captured: () => captured };
}
test('report endpoint rejects anonymous calls and invalid modes without sending', async () => {
  const edge = handler();
  assert.equal((await edge.call(new Request('https://test.invalid', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await edge.call(new Request('https://test.invalid', { method: 'GET' }))).status, 405);
  assert.equal((await edge.call(new Request('https://test.invalid', { method: 'POST', headers: { 'x-cron-secret': 'test-secret' }, body: '{"mode":"other"}' }))).status, 400);
  assert.equal(edge.sends(), 0);
});
test('scheduled check outside window skips, demo sends only to authorized fixed address with CSV', async () => {
  const edge = handler();
  const invoke = body => edge.call(new Request('https://test.invalid', { method: 'POST', headers: { 'x-cron-secret': 'test-secret' }, body: JSON.stringify(body) }));
  assert.equal((await (await invoke({ mode: 'scheduled' })).json()).skipped, true);
  assert.equal(edge.sends(), 0);
  assert.equal((await invoke({ mode: 'demo' })).status, 400);
  assert.equal((await invoke({ mode: 'demo', demoId: 'demo-20260905', to: 'ignored@example.invalid' })).status, 200);
  assert.deepEqual(edge.captured().to, ['info@ekvproject.cz']);
  assert.match(edge.captured().subject, /^\[DEMO\]/);
  assert.match(Buffer.from(edge.captured().attachments[0].content, 'base64').toString('utf8'), /Ukázkový zaměstnanec C/);
  assert.equal(edge.sends(), 1);
});
