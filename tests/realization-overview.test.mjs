import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRealizationDate, getRealizationAttention, realizationAssignmentState, realizationDate } from '../src/lib/realizationOverview.js';

test('realization dates reject missing, malformed and impossible calendar dates', () => {
  for (const value of [null, '', 'invalid', '2026-02-30', '2026-13-01']) {
    assert.equal(realizationDate(value), null);
    assert.equal(formatRealizationDate(value, 'Bez termínu'), 'Bez termínu');
  }
  assert.equal(realizationDate('2024-02-29T23:00:00Z'), '2024-02-29');
  assert.equal(formatRealizationDate('2026-09-05'), '5. 9. 2026');
});

test('attention distinguishes overdue work from a deadline today or completed work', () => {
  const realization = { status: 'Probíhá', planned_end_date: '2026-09-05', lead_person_id: 'lead-1' };
  assert.deepEqual(getRealizationAttention(realization, '2026-09-05'), []);
  assert.deepEqual(getRealizationAttention(realization, '2026-09-06'), ['Plánovaný termín dokončení již uplynul.']);
  assert.deepEqual(getRealizationAttention({ ...realization, status: 'Dokončeno', actual_end_date: '2026-09-05' }, '2026-09-06'), []);
  assert.deepEqual(getRealizationAttention({ ...realization, status: 'Předáno' }, '2026-09-06'), ['Chybí skutečné datum dokončení.']);
});

test('attention shows missing operational information and pause without generic navigation prompts', () => {
  assert.deepEqual(getRealizationAttention({ status: 'Pozastaveno' }, '2026-09-05'), [
    'Chybí plánovaný termín dokončení.',
    'Realizace nemá přiřazeného vedoucího.',
    'Realizace je pozastavená.',
  ]);
  assert.deepEqual(getRealizationAttention({ status: 'Probíhá', planned_end_date: '2026-09-10', lead_person: { id: 'lead-1' } }, '2026-09-05'), []);
});

test('membership history includes expired assignments and preserves inclusive last day', () => {
  const today = '2026-09-05';
  assert.equal(realizationAssignmentState({ valid_from: '2026-09-01', valid_to: today }, today), 'active');
  assert.equal(realizationAssignmentState({ valid_to: '2026-09-04' }, today), 'ended');
  assert.equal(realizationAssignmentState({ valid_from: '2026-09-06' }, today), 'planned');
  assert.equal(realizationAssignmentState({ ended_at: '2026-09-05T10:00:00Z', valid_to: '2026-09-10' }, today), 'ended');
  assert.equal(realizationAssignmentState({}, today), 'active');
});
