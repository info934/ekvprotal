import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeMutation, employeeFinanceView, employeeFiniteAmount, employeeLocalDate,
  employeeRecordValidity, fetchAllEmployeeRows, formatEmployeeMoney, loadEmployeeFinance,
  loadEmployeeWorkspace, saveEmployeeMutation, sumEmployeeAmounts,
} from '../src/lib/employeeWorkspaceData.js';

const self = { actorMemberId: 'self', targetMemberId: 'self', activeEmployee: true, isAdmin: false };
const admin = { ...self, isAdmin: true };
const request = { id: 'stable-id', title: 'Školení', request_type: 'training', description: 'Pro projekty FVE', estimated_cost: '', requested_for: '' };

function fakeClient(tables = {}, rpcs = {}, cap = 2) {
  const calls = [];
  const query = (name, data, args) => {
    let filters = [], start = 0, end = Infinity, single = false;
    const chain = {
      select() { return chain; }, order() { return chain; }, abortSignal() { return chain; },
      eq(field, value) { filters.push(row => row[field] === value); return chain; },
      in(field, values) { filters.push(row => values.includes(row[field])); return chain; },
      range(from, to) { start = from; end = to + 1; return chain; },
      maybeSingle() { single = true; return chain; },
      then(resolve, reject) {
        calls.push({ name, args, start });
        const source = typeof data === 'function' ? data({ args, start }) : data;
        if (source?.error) return Promise.resolve(source).then(resolve, reject);
        const rows = Array.isArray(source) ? source.filter(row => filters.every(filter => filter(row))) : null;
        const selected = rows ? (single ? rows[0] || null : rows.slice(start, Math.min(end, start + cap))) : source;
        return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { calls, from: name => query(name, tables[name] || []), rpc: (name, args) => query(name, rpcs[name] ?? [], args) };
}

test('pagination continues after short capped pages and checks the final empty page', async () => {
  const client = fakeClient({ rows: [1, 2, 3, 4, 5].map(id => ({ id })) });
  assert.deepEqual((await fetchAllEmployeeRows(() => client.from('rows'))).map(row => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(client.calls.map(call => call.start), [0, 2, 4, 5]);
});

test('pagination rejects incomplete data rather than returning a partial total', async () => {
  const client = fakeClient({ rows: ({ start }) => start ? { error: { message: 'Second page failed' } } : [{ id: 1 }] });
  await assert.rejects(fetchAllEmployeeRows(() => client.from('rows')), { message: 'Second page failed' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchAllEmployeeRows(() => client.from('rows'), controller.signal), { name: 'AbortError' });
});

test('foreign worker, queue worker and unlinked user make no reads', async () => {
  const client = fakeClient();
  assert.equal((await loadEmployeeWorkspace(client, { ...self, targetMemberId: 'someone-else' })).access, 'forbidden');
  assert.equal((await loadEmployeeWorkspace(client, { ...self, scopeAll: true })).access, 'forbidden');
  assert.equal((await loadEmployeeWorkspace(client, { actorMemberId: null })).access, 'missing-member');
  assert.equal(client.calls.length, 0);
});

test('explicit employee enrollment keeps member readable even with no profile', async () => {
  const client = fakeClient({ members: [{ id: 'self', name: 'A' }], employee_profiles: [] });
  const result = await loadEmployeeWorkspace(client, admin);
  assert.equal(result.access, 'needs-profile');
  assert.equal(result.member.name, 'A');
  assert.equal(result.profile, null);
  assert.deepEqual(client.calls.map(call => call.name).sort(), ['employee_profiles', 'members']);
});

test('inactive worker receives no assets, records, request history, or identifying payload', async () => {
  const client = fakeClient({ members: [{ id: 'self', name: 'A' }], employee_profiles: [{ member_id: 'self', employment_status: 'inactive' }] });
  const result = await loadEmployeeWorkspace(client, self);
  assert.deepEqual(result, { access: 'inactive' });
  assert.equal(client.calls.length, 2);
});

test('active own card completely loads scoped assets, records, requests and their events', async () => {
  const client = fakeClient({ members: [{ id: 'self', name: 'A' }], employee_profiles: [{ member_id: 'self', employment_status: 'active' }],
    employee_asset_assignments: [1, 2, 3].map(id => ({ id, member_id: 'self' })).concat({ id: 4, member_id: 'other' }),
    employee_records: [{ id: 'record', member_id: 'self' }], employee_requests: [{ id: 'r1', member_id: 'self' }],
    employee_request_events: [{ id: 'e1', request_id: 'r1' }, { id: 'foreign-event', request_id: 'foreign-request' }],
  });
  const result = await loadEmployeeWorkspace(client, self);
  assert.equal(result.access, 'ready'); assert.equal(result.assets.length, 3);
  assert.deepEqual(result.events.map(event => event.id), ['e1']);
});

test('admin queue loads requests independent of own HR profile', async () => {
  const client = fakeClient({ employee_requests: [{ id: 'r1', member_id: 'other' }], employee_request_events: [{ id: 'e1', request_id: 'r1' }] });
  const result = await loadEmployeeWorkspace(client, { ...admin, scopeAll: true });
  assert.equal(result.access, 'queue'); assert.equal(result.requests.length, 1);
  assert.ok(client.calls.every(call => !['members', 'employee_profiles'].includes(call.name)));
});

test('own request keeps stable id, normalizes optional fields, never sends caller member_id', () => {
  const result = buildEmployeeMutation('request', { ...request, member_id: 'other', estimated_cost: '123,50' }, self);
  assert.equal(result.rpc, 'create_employee_request');
  assert.equal(result.args.p_request.id, 'stable-id');
  assert.equal(result.args.p_request.estimated_cost, 123.5);
  assert.equal(result.args.p_request.requested_for, null);
  assert.equal('member_id' in result.args.p_request, false);
  assert.deepEqual(buildEmployeeMutation('request', request, self), buildEmployeeMutation('request', request, self));
  assert.throws(() => buildEmployeeMutation('request', request, { ...admin, targetMemberId: 'other' }), /vlastní aktivní/);
  assert.throws(() => buildEmployeeMutation('request', request, { ...self, activeEmployee: false }), /vlastní aktivní/);
});

test('worker cannot manage HR metadata; NaN costs and unsafe references are rejected before RPC', () => {
  for (const kind of ['profile', 'asset', 'return', 'record']) assert.throws(() => buildEmployeeMutation(kind, {}, self), /administrátor/);
  assert.throws(() => buildEmployeeMutation('request', { ...request, estimated_cost: 'NaN' }, self), /konečné číslo/);
  assert.throws(() => buildEmployeeMutation('record', { title: 'A', kind: 'contract', status: 'verified', reference_url: 'javascript:alert(1)' }, admin), /HTTPS/);
  assert.throws(() => buildEmployeeMutation('return', { id: 'a', assigned_on: '2026-09-05', returned_on: '2026-09-04' }, admin), /před předáním/);
});

test('asset and record creation use stable retry ids while edit keeps its explicit row id', () => {
  const asset = { create_id: 'stable-asset', asset_type: 'device', label: 'Notebook', assigned_on: '2026-09-05' };
  const record = { create_id: 'stable-record', title: 'Smlouva', kind: 'contract', status: 'pending' };
  assert.equal(buildEmployeeMutation('asset', asset, admin).args.p_asset.id, 'stable-asset');
  assert.equal(buildEmployeeMutation('asset', asset, admin).args.p_asset_id, null);
  assert.equal(buildEmployeeMutation('record', record, admin).args.p_record.id, 'stable-record');
  assert.equal(buildEmployeeMutation('record', record, admin).args.p_record_id, null);
  const editedAsset = buildEmployeeMutation('asset', { ...asset, id: 'existing' }, admin);
  assert.equal(editedAsset.args.p_asset_id, 'existing'); assert.equal('id' in editedAsset.args.p_asset, false);
  const editedRecord = buildEmployeeMutation('record', { ...record, id: 'existing' }, admin);
  assert.equal(editedRecord.args.p_record_id, 'existing'); assert.equal('id' in editedRecord.args.p_record, false);
});

test('request transitions enforce ownership, state machine and required rejection reason', () => {
  const pending = { id: 'r', member_id: 'self', status: 'pending' };
  assert.equal(buildEmployeeMutation('transition', { status: 'cancelled' }, { ...self, request: pending }).args.p_request_id, 'r');
  assert.throws(() => buildEmployeeMutation('transition', { status: 'approved' }, { ...self, request: pending }), /nelze provést/);
  assert.throws(() => buildEmployeeMutation('transition', { status: 'cancelled' }, { ...admin, request: { ...pending, member_id: 'other' } }), /nelze provést/);
  assert.throws(() => buildEmployeeMutation('transition', { status: 'rejected', note: ' ' }, { ...admin, request: pending }), /důvod zamítnutí/);
  assert.equal(buildEmployeeMutation('transition', { status: 'rejected', note: ' Zvolte levnější termín ' }, { ...admin, request: pending }).args.p_note, 'Zvolte levnější termín');
  assert.equal(buildEmployeeMutation('transition', { status: 'fulfilled' }, { ...admin, activeEmployee: false, request: { ...pending, status: 'approved', member_id: 'other' } }).args.p_status, 'fulfilled');
});

test('save rejects errors or unconfirmed writes and leaves caller draft intact', async () => {
  const draft = { ...request };
  const client = fakeClient({}, { create_employee_request: { error: { message: 'offline' } } });
  await assert.rejects(saveEmployeeMutation(client, 'request', draft, self), { message: 'offline' });
  assert.deepEqual(draft, request);
  await assert.rejects(saveEmployeeMutation(fakeClient({}, { create_employee_request: {} }), 'request', draft, self), /Server nepotvrdil/);
});

test('date validity preserves the last valid day and gives real expiration warnings', () => {
  assert.equal(employeeLocalDate(new Date(2026, 8, 5)), '2026-09-05');
  assert.equal(employeeRecordValidity({ status: 'verified', valid_until: '2026-09-05' }, '2026-09-05').label, 'Platí do dneška');
  assert.equal(employeeRecordValidity({ status: 'verified', valid_until: '2026-09-04' }, '2026-09-05').tone, 'danger');
  assert.equal(employeeRecordValidity({ status: 'verified', valid_until: '2026-10-05' }, '2026-09-05').tone, 'warning');
  assert.equal(employeeRecordValidity({ status: 'verified', valid_until: '2026-10-06' }, '2026-09-05').tone, 'success');
  assert.equal(employeeRecordValidity({ status: 'verified', valid_from: '2027-01-01' }, '2026-09-05').tone, 'neutral');
});

test('finance can load own account without HR profile but never queries a foreign worker account', async () => {
  const client = fakeClient({}, { get_member_compensation: { hourly_rate: null }, get_payout_availability: { projects: [], realizations: [] }, get_member_project_rewards: [] });
  const result = await loadEmployeeFinance(client, self);
  assert.equal(result.compensation.data.hourly_rate, null);
  assert.ok(client.calls.every(call => !call.name.startsWith('employee_')));
  client.calls.length = 0;
  await assert.rejects(loadEmployeeFinance(client, { ...self, targetMemberId: 'foreign' }), /nemáte přístup/);
  assert.equal(client.calls.length, 0);
});

test('finance independently reports RPC errors and never manufactures zero from unavailable sources', async () => {
  const client = fakeClient({}, { get_member_compensation: { error: { message: 'Rate unavailable' } }, get_payout_availability: { projects: null, realizations: [] } });
  const result = await loadEmployeeFinance(client, self);
  assert.equal(result.compensation.data, null); assert.match(result.compensation.error, /unavailable/);
  assert.equal(result.availability.data, null); assert.match(result.availability.error, /není úplný/);
  assert.equal(employeeFinanceView(result).available, null);
  assert.equal(employeeFiniteAmount(null), null); assert.equal(employeeFiniteAmount(''), null); assert.equal(employeeFiniteAmount('NaN'), null);
  assert.equal(sumEmployeeAmounts([{ x: 1 }, { x: null }], 'x'), null);
});

test('finance uses canonical availability once and payout headers once across both payout types', () => {
  const finance = { availability: { data: { projects: [{ project_id: 'p', total_reward: 1000, available_balance: 700, paid_payouts: 200, reserved_payouts: 100 }], realizations: [{ id: 'r', total_share: 400, available_share: 300, paid_amount: 100, reserved_payouts: 0 }] } },
    rewards: { data: [{ project_id: 'p', total_reward: 1000, available_balance: 700 }] },
    payouts: { data: [{ id: '1', amount: 200, status: 'paid' }, { id: '2', amount: 100, status: 'approved' }, { id: '3', amount: 5000, status: 'rejected' }] },
    hourly: { data: [{ id: '4', total_amount: 50, status: 'paid' }, { id: '5', total_amount: 30, status: 'invoice_uploaded' }, { id: '6', total_amount: 9000, status: 'cancelled' }] } };
  const result = employeeFinanceView(finance);
  assert.equal(result.available, 1000); assert.equal(result.paid, 250); assert.equal(result.pending, 130);
  assert.equal(result.entitlements.length, 2); assert.equal(result.payouts.length, 6);
  const partial = employeeFinanceView({ ...finance, hourly: { data: null, error: 'failed' } });
  assert.equal(partial.paid, null); assert.equal(partial.pending, null); assert.equal(partial.payouts.length, 3); assert.equal(partial.payoutsComplete, false);
  const hourlyOnly = employeeFinanceView({ ...finance, payouts: { data: null, error: 'failed' } });
  assert.equal(hourlyOnly.paid, null); assert.equal(hourlyOnly.payouts.length, 3);
});

test('compensation currency is preserved and an absent currency never turns into CZK', () => {
  assert.match(formatEmployeeMoney(25, 'EUR'), /€/);
  assert.doesNotMatch(formatEmployeeMoney(25, 'EUR'), /Kč/);
  assert.match(formatEmployeeMoney(450, 'CZK'), /Kč/);
  assert.equal(formatEmployeeMoney(25, null), 'Měna není uvedena');
  assert.equal(formatEmployeeMoney(null, 'EUR'), 'Nedostupné');
});
