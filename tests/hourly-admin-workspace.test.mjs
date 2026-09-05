import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyAdminMutation, loadHourlyAdminWorkspace, saveHourlyAdminAction } from '../src/lib/hourlyAdminWorkspace.js';

const actor = { actorId: 'admin', memberId: 'member', canAdmin: true };
const request = { id: 'request', status: 'pending' };
function clientFixture({ failAudit = false, failRows = false } = {}) {
  const calls = [];
  const rows = [1, 2, 3].map(id => ({ id: String(id), member_id: 'worker', status: 'pending', total_amount: 100 }));
  const build = (name, source) => {
    let from = 0;
    const query = { select() { return query; }, order() { return query; }, eq() { return query; }, abortSignal() { return query; }, range(start) { from = start; return query; },
      then(resolve, reject) { calls.push({ name, from }); return Promise.resolve(source(from)).then(resolve, reject); } };
    return query;
  };
  return { calls, from: name => build(name, from => failRows ? { error: new Error('Read denied') } : { data: rows.slice(from, from + 2) }), rpc: name => build(name, from => failAudit ? { error: new Error('Audit unavailable') } : { data: from === 0 ? [{ request_id: '1', has_discrepancy: true }] : [] }) };
}

test('admin list checks identity and permission before any reads', async () => {
  const client = clientFixture();
  await assert.rejects(loadHourlyAdminWorkspace(client, { ...actor, canAdmin: false }), /administrátorovi/);
  await assert.rejects(loadHourlyAdminWorkspace(client, { ...actor, actorId: null }), /administrátorovi/);
  assert.equal(client.calls.length, 0);
});

test('admin list loads all short pages and joins discrepancies by request id', async () => {
  const client = clientFixture();
  const data = await loadHourlyAdminWorkspace(client, actor);
  assert.equal(data.rows.length, 3);
  assert.equal(data.rows[0].discrepancy.has_discrepancy, true);
  assert.equal(data.discrepancyError, null);
  assert.deepEqual(client.calls.filter(call => call.name === 'hourly_payout_requests').map(call => call.from), [0, 2, 3]);
});

test('audit errors remain explicit while valid list data survives; request errors never look empty', async () => {
  const data = await loadHourlyAdminWorkspace(clientFixture({ failAudit: true }), actor);
  assert.equal(data.rows.length, 3); assert.match(data.discrepancyError, /nepodařilo/);
  await assert.rejects(loadHourlyAdminWorkspace(clientFixture({ failRows: true }), actor), /Read denied/);
});

test('cancel and rejection require a retained trimmed reason and enforce distinct allowed states', () => {
  assert.throws(() => hourlyAdminMutation(request, 'reject', { note: ' ' }), /důvod/);
  assert.throws(() => hourlyAdminMutation(request, 'cancel', { note: '' }), /důvod/);
  for (const status of ['pending', 'approved', 'invoice_uploaded']) assert.deepEqual(hourlyAdminMutation({ ...request, status }, 'cancel', { note: ' Oprava ' }).args, { p_request_id: 'request', p_reason: 'Oprava' });
  for (const status of ['paid', 'rejected', 'cancelled']) assert.throws(() => hourlyAdminMutation({ ...request, status }, 'cancel', { note: 'A' }), /stav žádosti/);
  assert.throws(() => hourlyAdminMutation({ ...request, status: 'approved' }, 'reject', { note: 'A' }), /stav žádosti/);
});

test('approval without document requires a reason; payment only follows approval and document or exception', () => {
  assert.throws(() => hourlyAdminMutation(request, 'approve', { withoutInvoice: true }), /důvod výjimky/);
  assert.equal(hourlyAdminMutation(request, 'approve', { withoutInvoice: true, note: ' Interní výjimka ' }).args.p_admin_note, 'Interní výjimka');
  assert.throws(() => hourlyAdminMutation({ ...request, invoice_url: 'invoice.pdf' }, 'paid'), /stav žádosti/);
  assert.throws(() => hourlyAdminMutation({ ...request, status: 'approved' }, 'paid'), /stav žádosti/);
  assert.equal(hourlyAdminMutation({ ...request, status: 'approved', approved_without_invoice: true }, 'paid').status, 'paid');
  assert.equal(hourlyAdminMutation({ ...request, status: 'invoice_uploaded', invoice_url: 'invoice.pdf' }, 'paid').status, 'paid');
});

test('failed and unconfirmed RPCs throw so dialog callers keep their draft', async () => {
  const options = { note: 'Rozpracované odůvodnění' };
  await assert.rejects(saveHourlyAdminAction({ rpc: async () => ({ error: new Error('Connection failed') }) }, request, 'reject', options, actor), /Connection failed/);
  assert.equal(options.note, 'Rozpracované odůvodnění');
  await assert.rejects(saveHourlyAdminAction({ rpc: async () => ({ data: { id: 'request', status: 'pending' } }) }, request, 'reject', options, actor), /nepotvrdil/);
  const saved = await saveHourlyAdminAction({ rpc: async () => ({ data: { id: 'request', status: 'rejected' } }) }, request, 'reject', options, actor);
  assert.equal(saved.status, 'rejected');
});
