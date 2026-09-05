import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSafeEmployeeReferenceUrl, isValidEmployeeDate, validateEmployeeAsset,
  validateEmployeeRecord, validateEmployeeRequest, employeeRequestTransitions,
} from '../src/lib/employeeWorkspace.js';

test('employee record references only accept HTTPS without credentials or script/HTML injection', () => {
  for (const value of ['', null, 'https://example.invalid/contracts/42?view=staff#detail', 'HTTPS://example.invalid/record']) assert.equal(isSafeEmployeeReferenceUrl(value), true);
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://example.invalid', '//example.invalid', 'https:example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/a\nb', 'https://example.invalid/"onload', 'https:\\example.invalid', '<a href="https://example.invalid">']) {
    assert.equal(isSafeEmployeeReferenceUrl(value), false, value);
  }
});

test('employee dates reject impossible dates and permit leap days', () => {
  assert.equal(isValidEmployeeDate('2024-02-29'), true);
  for (const value of ['2025-02-29', '2026-13-01', '2026-00-00', 'tomorrow', 'infinity', '', null]) assert.equal(isValidEmployeeDate(value), false);
});

test('asset and evidence metadata validate required fields and date ordering', () => {
  const asset = { asset_type: 'vehicle', label: 'Škoda Octavia', assigned_on: '2026-09-05', due_on: '2026-10-05' };
  assert.equal(validateEmployeeAsset(asset), null);
  assert.ok(validateEmployeeAsset({ ...asset, due_on: '2026-09-04' }));
  assert.ok(validateEmployeeAsset({ ...asset, asset_type: 'credential' }));
  assert.ok(validateEmployeeAsset({ ...asset, label: ' ' }));
  const record = { title: 'Odborné školení', kind: 'training', status: 'verified', valid_from: '2026-09-05', valid_until: '2027-09-05', reference_url: 'https://example.invalid/record' };
  assert.equal(validateEmployeeRecord(record), null);
  assert.ok(validateEmployeeRecord({ ...record, valid_until: '2026-09-04' }));
  assert.ok(validateEmployeeRecord({ ...record, reference_url: 'javascript:alert(1)' }));
});

test('request validation rejects nonfinite/negative amounts and missing explanation', () => {
  const request = { request_type: 'license', title: 'CAD licence', description: 'Licence pro zpracování projektů.', estimated_cost: '4500', requested_for: '2026-10-01' };
  assert.equal(validateEmployeeRequest(request), null);
  assert.equal(validateEmployeeRequest({ ...request, estimated_cost: '' }), null);
  for (const value of ['NaN', Infinity, '-1', 'cost', 10000000000]) assert.ok(validateEmployeeRequest({ ...request, estimated_cost: value }));
  assert.ok(validateEmployeeRequest({ ...request, description: ' ' }));
  assert.ok(validateEmployeeRequest({ ...request, request_type: 'admin' }));
});

test('only administrators decide requests and only an owner can cancel a pending request', () => {
  assert.deepEqual(employeeRequestTransitions('pending', { isOwner: true }), ['cancelled']);
  assert.deepEqual(employeeRequestTransitions('pending', { isAdmin: true }), ['approved', 'rejected']);
  assert.deepEqual(employeeRequestTransitions('approved', { isAdmin: true }), ['fulfilled']);
  assert.deepEqual(employeeRequestTransitions('approved', { isOwner: true }), []);
  for (const status of ['rejected', 'fulfilled', 'cancelled']) assert.deepEqual(employeeRequestTransitions(status, { isAdmin: true, isOwner: true }), []);
});
