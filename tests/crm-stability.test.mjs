import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCrmRecordByRef, findCrmRecordByRef, getCrmRecordRef } from '../src/lib/crmRoutes.js';
import { fetchAllCrmRows, fetchCrmRowsByIds, crmWorkflowErrorMessage } from '../src/lib/crmDataAccess.js';
import { compareOpportunityUpdated, getKnownOpportunityMargin, opportunityMatchesSearch } from '../src/lib/crmOpportunityPresentation.js';
import { createCrmOpportunityDraft, crmOpportunityDraftReducer, hasCrmOpportunityDraft, buildCrmOpportunityDraftPayload, submitCrmOpportunityDraft } from '../src/lib/crmOpportunityDraft.js';

test('human CRM references filter number, never a UUID column or raw OR expression', () => {
  for (const ref of ['OP-26-042', 'NAB%2F2026%2F4', 'OP%,id.neq.secret']) {
    const calls = [];
    const query = { eq: (...args) => { calls.push(args); return query; } };
    assert.equal(filterCrmRecordByRef(query, ref), query);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'number');
  }
});

test('UUID references filter id and malformed percent values do not crash routes', () => {
  const id = '01a070c7-2b1f-7e41-83fa-0838c6be64ea';
  assert.deepEqual(filterCrmRecordByRef({ eq: (...args) => args }, id), ['id', id]);
  assert.deepEqual(filterCrmRecordByRef({ eq: (...args) => args }, 'OP%broken'), ['number', 'OP%broken']);
  assert.equal(findCrmRecordByRef([{ id, number: 'OP%broken' }], 'OP%broken')?.id, id);
  assert.equal(getCrmRecordRef({ id, title: 'Mutable title' }), id);
});

test('opportunity searches match business number and company ID', () => {
  const opportunity = { number: 'OP-26-041', title: 'Střecha', subject: { name: 'Příklad', ico: '12345678' } };
  assert.equal(opportunityMatchesSearch(opportunity, 'op-26-041'), true);
  assert.equal(opportunityMatchesSearch(opportunity, '12345678'), true);
  assert.equal(opportunityMatchesSearch(opportunity, '  STŘECHA  '), true);
  assert.equal(opportunityMatchesSearch(opportunity, 'OP-99'), false);
});

test('updated sorting uses timestamps instead of random UUID order', () => {
  const old = { id: 'zzzz', updated_at: '2026-08-01T12:00:00Z' };
  const recent = { id: 'aaaa', updated_at: '2026-09-05T12:00:00Z' };
  assert.deepEqual([old, recent].sort(compareOpportunityUpdated), [recent, old]);
});

test('margin is unavailable without complete cost information, not a fixed 28 percent', () => {
  assert.equal(getKnownOpportunityMargin({ value: 1000 }), null);
  assert.equal(getKnownOpportunityMargin({ items: [{ quantity: 1, unit_price: 100 }] }), null);
  assert.equal(getKnownOpportunityMargin({ items: [{ quantity: 1, unit_price: 100, unit_cost: null }] }), null);
  assert.deepEqual(getKnownOpportunityMargin({ items: [{ quantity: 2, unit_price: 100, unit_cost: 60, discount_percent: 10 }] }), { value: 60, percent: 33.33 });
  assert.deepEqual(getKnownOpportunityMargin({ items: [{ quantity: 1, unit_price: 100, unit_cost: 0 }] }), { value: 100, percent: 100 });
});

test('paged catalog/history fetch includes records beyond 2,000 and tolerates a smaller API page cap', async () => {
  const expected = Array.from({ length: 2345 }, (_, id) => ({ id }));
  const ranges = [];
  const result = await fetchAllCrmRows(() => ({ range: async (from, to) => {
    ranges.push([from, to]);
    return { data: expected.slice(from, Math.min(to + 1, from + 200)), count: expected.length, error: null };
  } }));
  assert.deepEqual(result.data, expected);
  assert.equal(ranges[1][0], 200);
  assert.equal(result.count, 2345);
});

test('unknown total is paged to exhaustion rather than assuming a short response is complete', async () => {
  const expected = [1, 2, 3, 4, 5];
  const result = await fetchAllCrmRows(() => ({ range: async (from) => ({ data: expected.slice(from, from + 2), error: null }) }), 500);
  assert.deepEqual(result.data, expected);
});

test('a later history page failure rejects the partial result', async () => {
  const error = { message: 'Connection lost' };
  const result = await fetchAllCrmRows(() => ({ range: async (from) => from === 0
    ? { data: [1, 2], count: 6, error: null }
    : { data: null, error } }), 2);
  assert.equal(result.error, error);
  assert.equal(result.data, null);
});

test('related data requests are bounded and retain all products across batches', async () => {
  const ids = Array.from({ length: 1060 }, (_, id) => id);
  let largestBatch = 0;
  const result = await fetchCrmRowsByIds(ids, (batch) => {
    largestBatch = Math.max(largestBatch, batch.length);
    return { range: async (from, to) => ({ data: batch.slice(from, to + 1), count: batch.length, error: null }) };
  });
  assert.equal(largestBatch, 100);
  assert.deepEqual(result.data, ids);
});

test('missing atomic RPC gives an actionable migration error, with no destructive fallback', () => {
  assert.match(crmWorkflowErrorMessage({ code: 'PGRST202' }), /migrace CRM 2.0/);
  assert.equal(crmWorkflowErrorMessage({ code: '42501', message: 'Permission denied' }), 'Permission denied');
});

test('typing a detail value is local; explicit Save issues one atomic request', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: { id: 'op' }, error: null }; } };
  let draft = createCrmOpportunityDraft();
  for (const value of ['P', 'Pr', 'Projekt']) draft = crmOpportunityDraftReducer(draft, { type: 'edit', record: { category: 'Původní' }, patch: { category: value } });
  assert.equal(calls.length, 0);
  assert.equal(draft.fields.category, 'Projekt');
  assert.equal(draft.expectedFields.category, 'Původní');
  await submitCrmOpportunityDraft(client, 'op', draft);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'save_crm_opportunity_fields_atomic');
  assert.deepEqual(calls[0][1].p_fields, { category: 'Projekt' });
});

test('Cancel discards the draft without writing, and a clean draft sends no request', async () => {
  let draft = crmOpportunityDraftReducer(createCrmOpportunityDraft(), { type: 'edit', record: {}, patch: { next_step: 'Rozepsáno' } });
  draft = crmOpportunityDraftReducer(draft, { type: 'reset' });
  assert.equal(hasCrmOpportunityDraft(draft), false);
  await submitCrmOpportunityDraft({ rpc: () => { throw new Error('Unexpected write'); } }, 'op', draft);
});

test('failed save retains text, custom values and their original conflict baseline', () => {
  let draft = crmOpportunityDraftReducer(createCrmOpportunityDraft(), { type: 'edit', record: { category: 'Original' }, patch: { category: 'Draft' } });
  draft = crmOpportunityDraftReducer(draft, { type: 'custom', record: { custom_fields: { power: '10' } }, key: 'power', value: '12', fieldType: 'number' });
  draft = crmOpportunityDraftReducer(draft, { type: 'saving' });
  draft = crmOpportunityDraftReducer(draft, { type: 'error', message: 'Connection lost' });
  assert.equal(draft.fields.category, 'Draft');
  assert.equal(draft.customFields.power.value, '12');
  assert.equal(draft.customFields.power.expected_value, '10');
  assert.equal(draft.status, 'error');
  assert.equal(draft.error, 'Connection lost');
});

test('custom field payload contains only changed keys and detects a same-key concurrent edit', () => {
  const original = { custom_fields: { invoice_mode: 'monthly', untouched: 'keep' } };
  let draft = crmOpportunityDraftReducer(createCrmOpportunityDraft(), { type: 'custom', record: original, key: 'invoice_mode', value: 'weekly', fieldType: 'select' });
  draft = crmOpportunityDraftReducer(draft, { type: 'custom', record: { custom_fields: { invoice_mode: 'changed remotely' } }, key: 'invoice_mode', value: 'daily', fieldType: 'select' });
  const payload = buildCrmOpportunityDraftPayload('op', draft);
  assert.deepEqual(payload.p_fields, {});
  assert.deepEqual(payload.p_custom_fields, [{ key: 'invoice_mode', value: 'daily', expected_value: 'monthly' }]);
  assert.equal(Object.hasOwn(payload.p_fields, 'custom_fields'), false);
  assert.equal(original.custom_fields.untouched, 'keep');
});

test('numeric fields and comma-separated tags retain intermediate typing until Save', () => {
  let draft = crmOpportunityDraftReducer(createCrmOpportunityDraft(), { type: 'edit', record: { value: 100, tags: ['VIP'] }, patch: { value: '', tags: 'VIP, ' } });
  assert.equal(draft.fields.value, '');
  assert.equal(draft.fields.tags, 'VIP, ');
  assert.throws(() => buildCrmOpportunityDraftPayload('op', draft), /platné číslo/);
  draft = crmOpportunityDraftReducer(draft, { type: 'edit', record: { value: 100 }, patch: { value: '120,50', tags: 'VIP, urgentní, ' } });
  const payload = buildCrmOpportunityDraftPayload('op', draft);
  assert.equal(payload.p_fields.value, 120.5);
  assert.deepEqual(payload.p_fields.tags, ['VIP', 'urgentní']);
  for (const value of ['NaN', 'Infinity', '-1']) assert.throws(() => buildCrmOpportunityDraftPayload('op', { ...draft, fields: { value } }), /platné číslo/);
});

test('saving locks the submitted draft and successful completion clears it', () => {
  let draft = crmOpportunityDraftReducer(createCrmOpportunityDraft(), { type: 'edit', record: {}, patch: { next_step: 'Do práce' } });
  draft = crmOpportunityDraftReducer(draft, { type: 'saving' });
  const locked = crmOpportunityDraftReducer(draft, { type: 'edit', record: {}, patch: { next_step: 'Another value' } });
  assert.equal(locked, draft);
  draft = crmOpportunityDraftReducer(draft, { type: 'saved' });
  assert.equal(hasCrmOpportunityDraft(draft), false);
  assert.equal(draft.status, 'saved');
});
