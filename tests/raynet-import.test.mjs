import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRaynetBusinessType,
  raynetActivityStatusToCrm,
  raynetAddressToText,
  raynetStatusToCrm,
  summarizeRaynetBatch,
} from '../src/lib/raynetImport.js';

test('Raynet opportunity statuses map to open and closed EKV stages', () => {
  assert.deepEqual(raynetStatusToCrm('E_WIN'), { stage: 'won', status: 'closed' });
  assert.deepEqual(raynetStatusToCrm('D_LOST'), { stage: 'lost', status: 'closed' });
  assert.deepEqual(raynetStatusToCrm('B_ACTIVE'), { stage: 'lead', status: 'open' });
});

test('FVE business type is detected from type, category, classification or tags', () => {
  assert.equal(detectRaynetBusinessType({ category: { value: 'Fotovoltaika' } }), 'fve');
  assert.equal(detectRaynetBusinessType({ tags: ['FVE', 'B2B'] }), 'fve');
  assert.equal(detectRaynetBusinessType({ category: { value: 'Servis klimatizace' } }), 'general');
});

test('Raynet activity and address normalization is stable', () => {
  assert.equal(raynetActivityStatusToCrm({ completed: '2026-09-01 10:00' }), 'completed');
  assert.equal(raynetActivityStatusToCrm({ status: 'CANCELLED' }), 'cancelled');
  assert.equal(raynetAddressToText({ primaryAddress: { address: { street: 'Hlavní 1', zipCode: '100 00', city: 'Praha', country: 'CZ' } } }), 'Hlavní 1, 100 00 Praha, CZ');
});

test('Raynet preview summary separates entities and proposed actions', () => {
  assert.deepEqual(summarizeRaynetBatch([
    { entity_type: 'company', proposed_action: 'create' },
    { entity_type: 'business_case', proposed_action: 'update' },
    { entity_type: 'activity', proposed_action: 'create' },
  ]), { total: 3, entities: { company: 1, business_case: 1, activity: 1 }, actions: { create: 2, update: 1 } });
});
