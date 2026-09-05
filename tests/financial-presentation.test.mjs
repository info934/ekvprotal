import test from 'node:test';
import assert from 'node:assert/strict';
import { toFiniteAmount, areRealizationPercentagesValid, assessFinancialHealth, getProjectFinancialHealthInputs } from '../src/domain/financials.js';
import { getBillingNetAmounts, splitNetAmount } from '../src/domain/billingFinancials.js';
import { aggregateFinancialPeriods, fetchAllFinancialRows, formatMoney, formatPercent } from '../src/lib/financePresentation.js';
import { getHourlyPayoutDisplay } from '../src/lib/hourlyPayoutDisplay.js';

test('financial presentation distinguishes zero from unavailable or non-finite values', () => {
  for (const missing of [null, undefined, '', ' ', NaN, Infinity, -Infinity, 'NaN', 'Infinity', '100 Kč', false, {}]) {
    assert.equal(toFiniteAmount(missing), null);
    assert.equal(formatMoney(missing), 'Nedostupné');
    assert.equal(formatPercent(missing), 'Nedostupné');
  }
  assert.equal(toFiniteAmount('0'), 0); assert.equal(toFiniteAmount('-123.45'), -123.45);
  assert.match(formatMoney(0), /0.*Kč/); assert.equal(formatPercent(0), '0 %');
  assert.match(formatMoney(25, { currency: 'EUR' }), /€/);
});

test('equal installments conserve every cent without negative last installments', () => {
  assert.deepEqual(splitNetAmount(100000, 3), [33333.33, 33333.33, 33333.34]);
  assert.deepEqual(splitNetAmount(0.02, 4), [0, 0, 0.01, 0.01]);
  for (let cents = 1; cents <= 150; cents += 1) {
    for (let count = 1; count <= 24; count += 1) {
      const parts = splitNetAmount(cents / 100, count);
      assert.equal(parts.length, count);
      assert.ok(parts.every(part => part >= 0 && Number.isFinite(part)));
      assert.equal(parts.reduce((sum, part) => sum + Math.round(part * 100), 0), cents);
      assert.ok(Math.max(...parts) - Math.min(...parts) < 0.01000001);
    }
  }
});

test('installment helper rejects non-finite totals or invalid installment counts', () => {
  for (const total of [NaN, Infinity, -1, null, 'garbage']) assert.deepEqual(splitNetAmount(total, 3), []);
  for (const count of [NaN, Infinity, -1, 0, 1.5, null, Number.MAX_SAFE_INTEGER + 1]) assert.deepEqual(splitNetAmount(100, count), []);
});

test('VAT presentation keeps explicit net values and gross receivables without inventing missing zero', () => {
  assert.deepEqual(getBillingNetAmounts({ contract_amount: 121, contract_amount_excl_vat: 100, planned_amount_excl_vat: 0, invoiced_amount_excl_vat: 80, paid_amount_excl_vat_equivalent: 40, outstanding_amount_incl_vat: 48.4 }),
    { contractNet: 100, plannedNet: 0, invoicedNet: 80, paidNetEquivalent: 40, outstandingGross: 48.4 });
  assert.ok(Object.values(getBillingNetAmounts(null)).every(amount => amount === null));
  assert.equal(getBillingNetAmounts({ paid_amount_excl_vat_equivalent: 'NaN' }).paidNetEquivalent, null);
});

test('margin and overhead validation rejects invalid individual percentages before sum validation', () => {
  assert.equal(areRealizationPercentagesValid(0, 0), true);
  assert.equal(areRealizationPercentagesValid('20', '80'), true);
  for (const pair of [[-10, 20], [10, -1], [101, 0], [20, 81], [NaN, 0], [Infinity, 0], [null, 0], ['', 0], ['20percent', 0]]) assert.equal(areRealizationPercentagesValid(...pair), false);
});

test('financial health treats missing data as unavailable and does not deduct paid rewards twice', () => {
  assert.equal(assessFinancialHealth().status, 'unavailable');
  assert.equal(assessFinancialHealth({ baseAmount: 100, remainingAmount: null }).status, 'unavailable');
  assert.equal(assessFinancialHealth(getProjectFinancialHealthInputs({})).status, 'unavailable');
  const inputs = getProjectFinancialHealthInputs({ teamBudget: 1000, rewardBaseBudget: 800, teamRewards: 700, unallocatedBudget: 100, paidPayouts: 700 });
  assert.equal(assessFinancialHealth(inputs).available, 100);
  assert.equal(assessFinancialHealth(inputs).overallocation, 0);
  assert.equal(assessFinancialHealth({ baseAmount: 0, remainingAmount: 0 }).status, 'critical');
});

test('monthly periods preserve signed reported profit and reject incomplete amounts or invalid dates', () => {
  const rows = [{ period: '2026-09-01', actual_revenue: '100', actual_costs: '40', actual_profit: '60' }, { period: '2026-09-15', actual_revenue: 0, actual_costs: 80, actual_profit: -80 }];
  assert.deepEqual(aggregateFinancialPeriods(rows), [{ month: '2026-09', revenue: 100, costs: 120, profit: -20 }]);
  assert.throws(() => aggregateFinancialPeriods([{ ...rows[0], actual_profit: null }]), /neúplnou/);
  assert.throws(() => aggregateFinancialPeriods([{ ...rows[0], actual_costs: 'NaN' }]), /neúplnou/);
  assert.throws(() => aggregateFinancialPeriods([{ ...rows[0], period: '2026-02-30' }]), /období/);
  assert.throws(() => aggregateFinancialPeriods([{ ...rows[0], period: null }]), /období/);
});

test('financial pagination traverses short server caps and rejects a failing later page', async () => {
  const calls = [];
  const rows = [1, 2, 3, 4, 5].map(id => ({ id }));
  const factory = () => ({ range(start) { calls.push(start); return Promise.resolve({ data: rows.slice(start, start + 2), error: null }); } });
  assert.deepEqual(await fetchAllFinancialRows(factory), rows);
  assert.deepEqual(calls, [0, 2, 4, 5]);
  await assert.rejects(fetchAllFinancialRows(() => ({ range(start) { return Promise.resolve(start ? { error: { message: 'second page unavailable' } } : { data: [{ id: 1 }] }); } })), { message: 'second page unavailable' });
});

test('hourly breakdown never renders Infinity hours or impossible payment months', () => {
  const display = getHourlyPayoutDisplay({ payout_month: 13, payout_year: 2026, breakdown: { Projekt: Infinity } });
  assert.equal(display.periodLabel, 'Měsíční žádost');
  assert.doesNotMatch(display.assignmentLabel, /Infinity|NaN/);
  assert.match(display.assignmentLabel, /hodiny neuvedeny/);
  const valid = getHourlyPayoutDisplay({ payout_month: 9, payout_year: 2026, breakdown: { Projekt: 12.5 } });
  assert.match(valid.assignmentLabel, /12,5 h/);
  assert.equal(valid.periodLabel, 'Žádost za 9/2026');
});
