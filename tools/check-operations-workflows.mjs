import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attendanceEntryDate, payoutViewForStatus, clampPage, parseEngineeringDate,
  planningAvailabilityKey, planningDeletionItems, toSafeCsv,
} from '../src/lib/operationsHelpers.js';

test('attendance uses today only inside the month being viewed', () => {
  const today = new Date(2026, 8, 5, 23, 30);
  assert.deepEqual(attendanceEntryDate(new Date(2026, 8, 1), today), new Date(2026, 8, 5));
  assert.deepEqual(attendanceEntryDate(new Date(2026, 7, 31), today), new Date(2026, 7, 1));
  assert.deepEqual(attendanceEntryDate(new Date(2025, 8, 20), today), new Date(2025, 8, 1));
});

test('paid, rejected and cancelled filters open all requests instead of an impossible active view', () => {
  for (const status of ['paid', 'rejected', 'cancelled']) assert.equal(payoutViewForStatus(status, 'pending'), 'all');
  assert.equal(payoutViewForStatus('pending', 'pending'), 'pending');
  assert.equal(payoutViewForStatus('invoice_uploaded', 'all'), 'all');
  assert.equal(payoutViewForStatus('all', 'pending'), 'pending');
});

test('paging stays valid after filtering, last-row deletion and an empty result', () => {
  assert.equal(clampPage(4, 61, 15), 4);
  assert.equal(clampPage(5, 60, 15), 4);
  assert.equal(clampPage(5, 2, 15), 1);
  assert.equal(clampPage(5, 0, 15), 1);
});

test('Czech and ISO engineering export dates round-trip without locale guessing', () => {
  assert.equal(parseEngineeringDate('5.9.2026'), '2026-09-05');
  assert.equal(parseEngineeringDate('29. 2. 2024'), '2024-02-29');
  assert.equal(parseEngineeringDate('2026-09-05'), '2026-09-05');
  assert.equal(parseEngineeringDate(new Date(2026, 8, 5)), '2026-09-05');
  assert.equal(parseEngineeringDate(''), null);
  assert.equal(parseEngineeringDate(null), null);
});

test('Excel date systems, fractional serials and its fictitious leap day are handled explicitly', () => {
  assert.equal(parseEngineeringDate(45292), '2024-01-01');
  assert.equal(parseEngineeringDate(45292.75), '2024-01-01');
  assert.equal(parseEngineeringDate(0, { date1904: true }), '1904-01-01');
  assert.equal(parseEngineeringDate(43830, { date1904: true }), '2024-01-01');
  assert.equal(parseEngineeringDate(59), '1900-02-28');
  assert.equal(parseEngineeringDate(61), '1900-03-01');
  assert.throws(() => parseEngineeringDate(60));
});

test('invalid nonempty dates cannot silently turn into missing deadlines', () => {
  for (const value of ['29.2.2025', '31.4.2026', '2026-13-01', '05/09/2026', 'tomorrow', -1, Infinity]) {
    assert.throws(() => parseEngineeringDate(value), String(value));
  }
});

test('availability is invalidated by changed worker, time or item kind but not description', () => {
  const saved = { id: 'task-1', member_id: 'alice', item_type: 'task', start_at: '2026-09-05T08:00', end_at: '2026-09-05T12:00' };
  for (const changed of [{ member_id: 'bob' }, { start_at: '2026-09-06T08:00' }, { end_at: '2026-09-05T14:00' }, { item_type: 'milestone' }]) {
    assert.notEqual(planningAvailabilityKey(saved), planningAvailabilityKey({ ...saved, ...changed }));
  }
  assert.equal(planningAvailabilityKey(saved), planningAvailabilityKey({ ...saved, description: 'Updated brief' }));
});

test('phase delete scope includes every descendant without touching another branch', () => {
  const items = [{ id: 'root' }, { id: 'child', parent_id: 'root' }, { id: 'grandchild', parent_id: 'child' }, { id: 'other' }, { id: 'other-child', parent_id: 'other' }];
  assert.deepEqual(planningDeletionItems(items, 'root').map(item => item.id), ['root', 'child', 'grandchild']);
  assert.deepEqual(planningDeletionItems(items, 'child').map(item => item.id), ['child', 'grandchild']);
});

test('CSV export preserves Czech text and separators while neutralizing spreadsheet formulas', () => {
  const csv = toSafeCsv([['Číslo', 'Název'], ['1;2', 'Dům "A"'], ['=HYPERLINK("https://example.invalid")', ' @SUM(1)']]);
  assert.ok(csv.startsWith('\uFEFF"Číslo";"Název"\r\n'));
  assert.ok(csv.includes('"1;2";"Dům ""A"""'));
  assert.ok(csv.includes('"\'=HYPERLINK('));
  assert.ok(csv.includes('"\' @SUM(1)"'));
});
