import assert from 'node:assert/strict';
import {
  calculateCrmLineTotal,
  calculateCrmTotals,
} from '../src/lib/crmItemPayloads.js';
import {
  calculateCostAdjustedTeamBudget,
  calculateProjectMemberReward,
} from '../src/domain/financials.js';

const round = (value) => Math.round(value * 100) / 100;

const assertMoney = (actual, expected, label) => {
  assert.equal(round(actual), expected, label);
};

const crmCases = [
  {
    name: 'bez slevy',
    items: [{ quantity: 2, unit_price: 1000, discount_percent: 0, vat_rate: 21 }],
    expectedLineTotals: [2000],
    expected: { subtotal: 2000, discount_total: 0, total: 2000, tax_total: 420 },
  },
  {
    name: 'sleva 10 %',
    items: [{ quantity: 2, unit_price: 1000, discount_percent: 10, vat_rate: 21 }],
    expectedLineTotals: [1800],
    expected: { subtotal: 2000, discount_total: 200, total: 1800, tax_total: 378 },
  },
  {
    name: 'sleva 100 %',
    items: [{ quantity: 3, unit_price: 500, discount_percent: 100, vat_rate: 21 }],
    expectedLineTotals: [0],
    expected: { subtotal: 1500, discount_total: 1500, total: 0, tax_total: 0 },
  },
  {
    name: 'různé sazby DPH',
    items: [
      { quantity: 1, unit_price: 1000, discount_percent: 0, vat_rate: 21 },
      { quantity: 1, unit_price: 500, discount_percent: 10, vat_rate: 12 },
    ],
    expectedLineTotals: [1000, 450],
    expected: { subtotal: 1500, discount_total: 50, total: 1450, tax_total: 264 },
  },
];

for (const testCase of crmCases) {
  const totals = calculateCrmTotals(testCase.items);
  testCase.items.forEach((item, index) => {
    assertMoney(calculateCrmLineTotal(item), testCase.expectedLineTotals[index], `${testCase.name}: line total ${index + 1}`);
  });
  assertMoney(totals.subtotal, testCase.expected.subtotal, `${testCase.name}: subtotal`);
  assertMoney(totals.discount_total, testCase.expected.discount_total, `${testCase.name}: discount_total`);
  assertMoney(totals.total, testCase.expected.total, `${testCase.name}: total`);
  assertMoney(totals.tax_total, testCase.expected.tax_total, `${testCase.name}: tax_total`);
}

const project = { price: 100000, budget_percentage: 60, overhead_percentage: 10 };
const subcontractors = [{ price: 10000 }];
const adjusted = calculateCostAdjustedTeamBudget({
  project,
  subcontractors,
  directCosts: 15000,
  allocatedOverheadCosts: 5000,
});
assertMoney(adjusted.teamBudget, 44000, 'planned team budget');
assertMoney(adjusted.costAdjustedTeamBudget, 24000, 'cost adjusted team budget');
assertMoney(calculateProjectMemberReward({ reward_type: 'percentage', reward_percentage: 50 }, adjusted.costAdjustedTeamBudget), 12000, 'percentage reward after costs');

const exhausted = calculateCostAdjustedTeamBudget({
  project,
  subcontractors,
  directCosts: 50000,
  allocatedOverheadCosts: 5000,
});
assert.equal(Math.max(0, calculateProjectMemberReward({ reward_type: 'percentage', reward_percentage: 50 }, exhausted.costAdjustedTeamBudget)), 0, 'exhausted percentage payout');

console.log('Financial calculation checks passed');
