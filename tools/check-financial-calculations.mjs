import assert from 'node:assert/strict';
import {
  calculateCrmItem,
  calculateCrmLineTotal,
  calculateCrmTotals,
  calculateUnitPriceForMargin,
} from '../src/lib/crmItemPayloads.js';
import {
  assessFinancialHealth,
  getProjectFinancialHealthInputs,
  calculateLaborFunding,
  calculateMemberRewardAfterLabor,
  calculateRewardAvailability,
  calculateCostAdjustedTeamBudget,
  calculateProjectFinancials,
  calculateProjectMemberReward,
  calculateProjectRewardPool,
  calculateProjectRewardRebalance,
  normalizeProjectMemberRewardSummary,
  calculateRealizationRewardAllocation,
  calculateRealizationMemberShare,
} from '../src/domain/financials.js';
import { getBillingNetAmounts, splitNetAmount } from '../src/domain/billingFinancials.js';

const round = (value) => Math.round(value * 100) / 100;

const assertMoney = (actual, expected, label) => {
  assert.equal(round(actual), expected, label);
};

const netParts = splitNetAmount(100000, 3);
assert.deepEqual(netParts, [33333.33, 33333.33, 33333.34], 'net billing plan preserves the exact contract value');
assertMoney(netParts.reduce((sum, value) => sum + value, 0), 100000, 'net billing plan has no VAT rounding drift');

const explicitBillingAmounts = getBillingNetAmounts({
  contract_amount: 121000,
  contract_amount_excl_vat: 100000,
  planned_amount_excl_vat: 60000,
  invoiced_amount_excl_vat: 40000,
  paid_amount_excl_vat_equivalent: 20000,
  outstanding_amount_incl_vat: 24200,
});
assertMoney(explicitBillingAmounts.contractNet, 100000, 'explicit net contract value wins over a legacy value');
assertMoney(explicitBillingAmounts.paidNetEquivalent, 20000, 'paid coverage uses the net equivalent');
assertMoney(explicitBillingAmounts.outstandingGross, 24200, 'receivable remains gross');

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

const commissionedItem = calculateCrmItem({
  quantity: 2,
  unit_price: 1250,
  unit_cost: 800,
  discount_percent: 10,
  vat_rate: 21,
  commission_percent: 5,
});
assertMoney(commissionedItem.grossSubtotal, 2500, 'commission case: gross subtotal');
assertMoney(commissionedItem.discountAmount, 250, 'commission case: discount');
assertMoney(commissionedItem.subtotal, 2250, 'commission case: net subtotal');
assertMoney(commissionedItem.taxTotal, 472.5, 'commission case: tax');
assertMoney(commissionedItem.costTotal, 1600, 'commission case: cost');
assertMoney(commissionedItem.marginAmount, 650, 'commission case: margin');
assertMoney(commissionedItem.commissionAmount, 112.5, 'commission case: commission');
assertMoney(commissionedItem.profitAfterCommission, 537.5, 'commission case: profit after commission');

const clampedItem = calculateCrmItem({
  quantity: 1,
  unit_price: 1000,
  unit_cost: 100,
  discount_percent: 120,
  vat_rate: 19,
  commission_percent: -5,
});
assertMoney(clampedItem.discountPercent, 100, 'discount is clamped to 100 percent');
assertMoney(clampedItem.vatRate, 21, 'unsupported VAT falls back to the default rate');
assertMoney(clampedItem.commissionPercent, 0, 'negative commission is clamped to zero');
assertMoney(clampedItem.total, 0, 'full discount produces zero net total');

assertMoney(
  calculateUnitPriceForMargin({ quantity: 1, unit_cost: 80, discount_percent: 0 }, 20),
  100,
  'sale price for 20 percent margin'
);
assertMoney(
  calculateUnitPriceForMargin({ quantity: 1, unit_cost: 80, discount_percent: 10 }, 20),
  111.11,
  'sale price accounts for discount while preserving margin'
);

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
assertMoney(calculateProjectMemberReward({ reward_type: 'fixed', reward_amount: 30000 }, adjusted.costAdjustedTeamBudget), 24000, 'fixed reward is capped by adjusted budget');

const projectAllocation = calculateProjectFinancials({
  project,
  subcontractors,
  costs: [{ amount: 15000 }],
  overheadCosts: [{ amount: 5000 }],
  members: [{ reward_type: 'percentage', reward_percentage: 50 }],
});
assertMoney(projectAllocation.rewardBaseBudget, 24000, 'project reward base follows costs and allocated overhead');
assertMoney(projectAllocation.teamRewards, 12000, 'project planned rewards use the shared reward base');
assertMoney(projectAllocation.unallocatedBudget, 12000, 'project unallocated budget excludes planned rewards');

const fixedRewardRebalance = calculateProjectRewardRebalance({
  teamBudget: 33840,
  assignments: [
    { member_id: 'member-a', reward_type: 'percentage', reward_percentage: 50 },
    { member_id: 'member-b', reward_type: 'percentage', reward_percentage: 50 },
  ],
  rewardType: 'fixed',
  rewardAmount: 3500,
});
assert.equal(fixedRewardRebalance.canAutoRebalance, false, 'fixed-first model does not rewrite stored percentages');
assertMoney(fixedRewardRebalance.percentageTotalAfter, 100, 'percentage assignments remain whole shares of the residual pool');
assertMoney(fixedRewardRebalance.percentageRewardPool, 30340, 'fixed reward is reserved before the percentage pool');
assertMoney(fixedRewardRebalance.budgetAfter, 0, '100 percent of the residual pool allocates the complete reward pool');

const residualRewardPool = calculateProjectRewardPool([
  { reward_type: 'percentage', reward_percentage: 50 },
  { reward_type: 'percentage', reward_percentage: 50 },
  { reward_type: 'fixed', reward_amount: 3500 },
], 33840);
assertMoney(residualRewardPool.percentageRewardPool, 30340, 'residual pool excludes fixed commitments');
assertMoney(calculateProjectMemberReward(
  { reward_type: 'percentage', reward_percentage: 50 },
  33840,
  { percentageRewardPool: residualRewardPool.percentageRewardPool }
), 15170, '50 percent member receives half of the residual pool');

const legacyRewardSummary = normalizeProjectMemberRewardSummary({
  assigned_costs: 6500,
  sponsored_labor_costs: 2500,
});
assertMoney(legacyRewardSummary.direct_assigned_costs, 4000, 'legacy combined assignment costs are normalized');
assertMoney(legacyRewardSummary.total_deductions, 6500, 'legacy deductions remain backward compatible');

const explicitRewardSummary = normalizeProjectMemberRewardSummary({
  assigned_costs: 6500,
  direct_assigned_costs: 4000,
  sponsored_labor_costs: 2500,
  total_deductions: 6500,
});
assertMoney(explicitRewardSummary.direct_assigned_costs, 4000, 'explicit direct assignment costs are authoritative');
assertMoney(explicitRewardSummary.total_deductions, 6500, 'explicit total deductions are authoritative');

const impossibleFixedReward = calculateProjectRewardRebalance({
  teamBudget: 5000,
  assignments: [{ member_id: 'member-a', reward_type: 'fixed', reward_amount: 4000 }],
  rewardType: 'fixed',
  rewardAmount: 2000,
});
assert.equal(impossibleFixedReward.canAutoRebalance, false, 'fixed rewards cannot be reduced by percentage rebalance');
assertMoney(impossibleFixedReward.budgetExceededBy, 1000, 'fixed reward over-allocation remains blocked');

const exhausted = calculateCostAdjustedTeamBudget({
  project,
  subcontractors,
  directCosts: 50000,
  allocatedOverheadCosts: 5000,
});
assert.equal(calculateProjectMemberReward({ reward_type: 'percentage', reward_percentage: 50 }, exhausted.costAdjustedTeamBudget), 0, 'exhausted percentage payout');
assert.equal(calculateProjectMemberReward({ reward_type: 'fixed', reward_amount: 30000 }, exhausted.costAdjustedTeamBudget), 0, 'exhausted fixed payout');

const percentageGrossReward = calculateProjectMemberReward(
  { reward_type: 'percentage', reward_percentage: 50 },
  adjusted.costAdjustedTeamBudget
);
const rewardAvailability = calculateRewardAvailability({
  grossReward: percentageGrossReward,
  reservedAmount: 2000,
  paidAmount: 7000,
});
assertMoney(percentageGrossReward, 12000, 'paid draws do not shrink the shared entitlement base');
assertMoney(rewardAvailability.availableReward, 3000, 'paid and reserved reward draws are deducted exactly once');

const approvedHourlyCost = 6400;
assertMoney(adjusted.costAdjustedTeamBudget - approvedHourlyCost, 17600, 'approved labor ledger cost reduces the project reward base');

const realizationRevenue = 230000;
const realizationProfit = realizationRevenue * 0.15;
const realizationOverhead = realizationRevenue * 0.05;
const realizationOperationalCosts = 30000;
const realizationApprovedLaborCost = 11200;
const realizationTeamBudget = realizationRevenue - realizationProfit - realizationOverhead
  - realizationOperationalCosts - realizationApprovedLaborCost;
assertMoney(realizationTeamBudget, 142800, 'approved realization labor reduces the canonical reward base');
assertMoney(calculateRealizationMemberShare({ share_type: 'percent', share_value: 25 }, realizationTeamBudget), 35700, 'realization percent share uses the ledger-adjusted team budget');
assertMoney(calculateRealizationMemberShare({ share_type: 'fixed', share_value: 200000 }, realizationTeamBudget), 142800, 'fixed realization share is capped by the canonical team budget');

assertMoney(calculateRealizationMemberShare({ share_type: 'fixed', share_value: 50000 }, 12000), 12000, 'fixed realization share is capped by team budget');
assertMoney(calculateRealizationMemberShare({ share_type: 'percent', share_value: 25 }, 12000), 3000, 'percentage realization share uses non-negative team budget');
assertMoney(calculateRealizationMemberShare({ share_type: 'fixed', share_value: 50000 }, -1000), 0, 'fixed realization share is zero when team budget is exhausted');
assertMoney(calculateRealizationMemberShare({ share_type: 'percent', share_value: 100 }, 12000), 12000, '100 percent realization share equals available budget');

const realizationAllocation = calculateRealizationRewardAllocation([
  { share_type: 'percent', share_value: 25 },
  { share_type: 'fixed', share_value: 5000 },
], 40000);
assertMoney(realizationAllocation.distributedBudget, 15000, 'realization allocation combines percent and fixed shares');
assertMoney(realizationAllocation.unallocatedBudget, 25000, 'realization unallocated budget uses the same shared calculation');

assert.equal(assessFinancialHealth({ baseAmount: 100000, remainingAmount: -1000, availableAmount: 0 }).status, 'loss');
assert.equal(assessFinancialHealth({ baseAmount: 100000, remainingAmount: 20000, availableAmount: 10000, committedAmount: 25000 }).status, 'overallocated');
assert.equal(assessFinancialHealth({ baseAmount: 100000, remainingAmount: 10000, availableAmount: 0 }).status, 'critical');
assert.equal(assessFinancialHealth({ baseAmount: 100000, remainingAmount: 9000, availableAmount: 9000 }).status, 'warning');
assert.equal(assessFinancialHealth({ baseAmount: 100000, remainingAmount: 30000, availableAmount: 30000 }).status, 'healthy');

const paidProjectRewardHealthInputs = getProjectFinancialHealthInputs({
  teamBudget: 710951,
  rewardBaseBudget: 659151,
  teamRewards: 643126.47,
  unallocatedBudget: 16024.53,
  teamBudgetAfterPaidPayouts: 609151,
  paidPayouts: 50000,
});
const paidProjectRewardHealth = assessFinancialHealth(paidProjectRewardHealthInputs);
assertMoney(paidProjectRewardHealth.overallocation, 0, 'paid project rewards are not counted twice in health checks');
assertMoney(paidProjectRewardHealth.available, 16024.53, 'project health reports the true unallocated reward reserve');
assert.equal(paidProjectRewardHealth.status, 'warning', 'low reserve is reported instead of false reward overallocation');

const sponsoredLabor = calculateLaborFunding({ hours: 40, hourlyRate: 500, fundingMode: 'member_reward', sponsorPercent: 100 });
assertMoney(sponsoredLabor.payAmount, 20000, 'sponsored worker payout');
assertMoney(sponsoredLabor.sponsorRewardDeduction, 20000, 'sponsored worker reward deduction');
assertMoney(sponsoredLabor.projectCostImpact, 0, 'sponsored worker does not reduce common pool twice');

const splitLabor = calculateLaborFunding({ hours: 40, hourlyRate: 500, fundingMode: 'member_reward', sponsorPercent: 60 });
assertMoney(splitLabor.sponsorRewardDeduction, 12000, 'partial sponsor deduction');
assertMoney(splitLabor.projectCostImpact, 8000, 'unfunded labor remainder belongs to project');

const memberReward = calculateMemberRewardAfterLabor({ grossReward: 50000, sponsoredLaborCosts: 20000 });
assertMoney(memberReward.netReward, 30000, 'member reward after sponsored labor');
assertMoney(memberReward.deficit, 0, 'member reward has no deficit');

const overdrawnReward = calculateMemberRewardAfterLabor({ grossReward: 15000, sponsoredLaborCosts: 20000 });
assertMoney(overdrawnReward.netReward, 0, 'overdrawn member reward is capped at zero');
assertMoney(overdrawnReward.deficit, 5000, 'overdrawn member reward reports deficit');

console.log('Financial calculation checks passed');
