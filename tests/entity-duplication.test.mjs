import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDuplicateDefaults, realizationDuplicateDefaults } from '../src/lib/entityDuplication.js';

test('project copy keeps reusable setup and clears identity, dates and finance', () => {
  const copy = projectDuplicateDefaults({
    name: 'FVE hala', code: 'P-42', status: 'active', price: 900000,
    type: 'FVE', stage_id: 'stage', start_date: '2026-01-01', completion_date: '2026-02-01',
    complexity_level: 'complex', estimated_work_days: 24, location: 'Plzeň', brief: 'Stejné řešení',
    investor_id: 'investor', client_id: 'client', client_internal_ref: 'OLD', is_priority: true,
  }, 'member');
  assert.equal(copy.name, 'FVE hala – kopie');
  assert.equal(copy.code, '');
  assert.equal(copy.status, 'nabidka');
  assert.equal(copy.price, 0);
  assert.equal(copy.start_date, '');
  assert.equal(copy.completion_date, '');
  assert.equal(copy.client_internal_ref, '');
  assert.equal(copy.type, 'FVE');
  assert.equal(copy.estimated_work_days, 24);
  assert.equal(copy.created_by_member_id, 'member');
});

test('realization copy resets delivery state and finance but keeps reusable staffing setup', () => {
  const copy = realizationDuplicateDefaults({
    name: 'Montáž FVE', code: 'OP-26-119', status: 'Předáno', contract_amount: 500000,
    type: 'FVE', investor_id: 'investor', lead_person_id: 'lead',
    start_date: '2026-01-01', planned_end_date: '2026-02-01', actual_end_date: '2026-02-03',
    complexity_level: 'standard', estimated_work_days: 12, location_address: 'Brno',
  });
  assert.equal(copy.name, 'Montáž FVE – kopie');
  assert.equal(copy.code, '');
  assert.equal(copy.status, 'Připravuje se');
  assert.equal(copy.contract_amount, 0);
  assert.equal(copy.start_date, '');
  assert.equal(copy.planned_end_date, '');
  assert.equal(copy.actual_end_date, '');
  assert.equal(copy.lead_person_id, 'lead');
  assert.equal(copy.location_address, 'Brno');
});
