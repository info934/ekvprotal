import { calculateProjectBudget, calculateRealizationFinancials, calculateProjectMemberReward } from '../domain/financials.js';
import { previewDate } from './previewState.js';

const total = (rows, key = 'amount') => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
const missing = () => ({ data: null, error: { code: 'P0002', message: 'Ukázková zakázka nebyla nalezena.' } });

export function projectFinancialPreview(tables, id) {
  const project = tables.projects.find(row => row.id === id);
  if (!project) return missing();
  const budget = calculateProjectBudget(project);
  const costs = (tables.project_costs || []).filter(row => row.project_id === id);
  const directCosts = total(costs);
  const unassignedCosts = total(costs.filter(row => !row.member_id));
  const allocatedOverhead = total((tables.overhead_costs || []).filter(row => row.project_id === id));
  const adjusted = budget.teamBudget - unassignedCosts - allocatedOverhead;
  const items = tables.payout_items.filter(row => row.project_id === id).map(row => ({ ...row, status: tables.payouts.find(payout => payout.id === row.payout_id)?.status }));
  const paid = total(items.filter(row => row.status === 'paid'));
  const reserved = total(items.filter(row => ['pending', 'approved'].includes(row.status)));
  const rewards = tables.project_members.filter(row => row.project_id === id).map(row => {
    const reward = calculateProjectMemberReward(row, adjusted);
    const memberItems = items.filter(item => item.member_id === row.member_id);
    const paidAmount = total(memberItems.filter(item => item.status === 'paid'));
    const reservedAmount = total(memberItems.filter(item => ['pending', 'approved'].includes(item.status)));
    return { ...row, total_reward: reward, net_reward: reward, paid_amount: paidAmount, reserved_amount: reservedAmount, available_balance: Math.max(0, reward - paidAmount - reservedAmount) };
  });
  return {
    financial_model_version: 2, project_id: id, price: budget.price, contract_amount: budget.price,
    total_price: budget.price, budget_percentage: budget.budgetPercentage, overhead_percentage: budget.overheadPercentage,
    gross_project_budget: budget.totalBudget, total_budget: budget.totalBudget, planned_overhead_amount: budget.overheadBudget,
    subcontractor_costs: 0, team_budget: budget.teamBudget, direct_costs: directCosts, unassigned_direct_costs: unassignedCosts,
    assigned_member_costs: directCosts - unassignedCosts, allocated_overhead_costs: allocatedOverhead,
    cost_adjusted_team_budget: adjusted, remaining_after_costs: adjusted, team_budget_after_paid_payouts: adjusted - paid,
    costs_before_paid_payouts: directCosts + allocatedOverhead, costs_after_paid_payouts: directCosts + allocatedOverhead + paid,
    paid_payouts: paid, paid_task_payouts: paid, paid_hourly_payouts: 0, paid_payout_costs: paid,
    reserved_payouts: reserved, reserved_or_paid_payouts: paid + reserved, available_for_payout: adjusted - paid - reserved,
    member_rewards: rewards, total_member_rewards: total(rewards, 'total_reward'), total_paid: paid,
    total_costs: directCosts + allocatedOverhead + paid, profit: budget.price - budget.totalBudget,
    remaining_budget: adjusted - total(rewards, 'total_reward'),
  };
}

export function realizationFinancialPreview(tables, id, overrides = {}) {
  const original = id ? tables.realizations.find(row => row.id === id) : {};
  if (!original) return missing();
  const realization = { ...original, ...overrides };
  const costs = (tables.realizace_costs || []).filter(row => row.realizace_id === id);
  const extras = (tables.realizace_extra_costs || []).filter(row => row.realizace_id === id);
  const manual = total(costs);
  const extraCosts = total(extras, 'cost_price');
  const extraRevenue = total(extras, 'sale_price');
  const base = Number(realization.contract_amount || 0);
  const financials = calculateRealizationFinancials({ ...realization, contract_amount: base + extraRevenue }, manual + extraCosts);
  const shares = (realization.team_members || []).map(memberId => ({ member_id: memberId, share_type: 'percent', share_value: 25, members: tables.members.find(row => row.id === memberId) }));
  return {
    financial_model_version: 2, realization_id: id, base_contract_amount: base, contract_amount: base,
    total_revenue: base + extraRevenue, manual_costs: manual, extra_costs: extraCosts, extra_revenue: extraRevenue,
    operational_costs: manual + extraCosts, costs_before_paid_payouts: manual + extraCosts, costs_after_paid_payouts: manual + extraCosts,
    total_costs: manual + extraCosts, profit_amount: financials.profitAmount, overhead_amount: financials.overheadAmount,
    gross_project_budget: financials.grossProjectBudget, team_budget: financials.teamBudget,
    reserved_payouts: 0, paid_task_payouts: 0, paid_hourly_payouts: 0, paid_payout_costs: 0,
    available_for_payout: financials.teamBudget, member_shares: shares,
  };
}

export function billingFinancialPreview(tables, type, id) {
  const row = (type === 'project' ? tables.projects : tables.realizations).find(item => item.id === id);
  if (!row) return missing();
  const amount = Number(row.price ?? row.contract_amount);
  const milestones = [
    { name: 'Zahájení a podklady', status: 'completed', fraction: .4, date: -20 },
    { name: 'Rozpracovanost', status: 'invoiced', fraction: .2, date: -3 },
    { name: 'Dokončení a předání', status: 'planned', fraction: .4, date: 7 },
  ].map((item, index) => ({ id: `${id}-billing-${index}`, name: item.name, status: item.status, installment_number: index + 1,
    amount_excl_vat: amount * item.fraction, amount_incl_vat: amount * item.fraction * 1.21, planned_issue_date: previewDate(item.date), due_date: previewDate(item.date + 14) }));
  const entries = milestones.slice(0, 2).map((milestone, index) => ({
    id: `${id}-invoice-${index}`, entity_type: type, entity_id: id, milestone_id: milestone.id,
    invoice_number: `DEMO-${row.code}-${index + 1}`, invoice_kind: 'partial', status: index ? 'issued' : 'paid',
    amount_excl_vat: milestone.amount_excl_vat, vat_rate: 21, amount_incl_vat: milestone.amount_incl_vat,
    paid_amount: index ? 0 : milestone.amount_incl_vat, issue_date: milestone.planned_issue_date,
    performance_date: milestone.planned_issue_date, due_date: milestone.due_date,
    paid_date: index ? null : previewDate(-10), document_required: false, document_url: null,
    note: 'Ukázková faktura bez skutečného dokladu.',
  }));
  return { status: 'partially_paid', plan_count: milestones.length, warning: false, warning_message: null, milestones, entries,
    contract_amount: amount, contract_amount_excl_vat: amount, planned_amount: amount, planned_amount_excl_vat: amount,
    invoiced_amount: amount * .6, invoiced_amount_excl_vat: amount * .6, paid_amount_excl_vat_equivalent: amount * .4,
    invoice_coverage_percent: 60, payment_coverage_percent: 40, overdue_milestone_count: 0 };
}

export function memberFinancialPreview(tables, memberId) {
  const projects = tables.projects.flatMap(project => {
    const summary = projectFinancialPreview(tables, project.id);
    const reward = summary.member_rewards.find(row => row.member_id === memberId);
    if (!reward) return [];
    return [{ ...reward, project_name: project.name, project_code: project.code, project_status: project.status,
      reserved_payouts: reward.reserved_amount, paid_payouts: reward.paid_amount,
      recommended_available_balance: Math.min(reward.available_balance, Math.max(0, summary.available_for_payout)),
      project: { id: project.id, name: project.name, code: project.code, status: project.status } }];
  });
  const realizations = tables.realizations.filter(row => row.team_members?.includes(memberId)).map(row => {
    const summary = realizationFinancialPreview(tables, row.id);
    const share = summary.member_shares.find(item => item.member_id === memberId);
    const amount = Math.max(0, summary.team_budget) * Number(share?.share_value || 0) / 100;
    return { ...row, realization_id: row.id, total_share: amount, reserved_payouts: 0, paid_amount: 0,
      available_share: amount, recommended_available_share: amount, share_type: 'percent', share_value: share?.share_value || 0 };
  });
  return { projects, realizations };
}
