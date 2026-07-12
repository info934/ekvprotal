export const toAmount = (value) => {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

export const sumByAmount = (items = [], selector = (item) => item?.amount) => {
  return (items || []).reduce((sum, item) => sum + toAmount(selector(item)), 0);
};

export const calculateProjectBudget = (project = {}, subcontractors = []) => {
  const price = toAmount(project?.price);
  const budgetPercentage = toAmount(project?.budget_percentage);
  const overheadPercentage = toAmount(project?.overhead_percentage);

  const totalBudget = price * (budgetPercentage / 100);
  const overheadBudget = totalBudget * (overheadPercentage / 100);
  const subcontractorCosts = sumByAmount(subcontractors, (subcontractor) => subcontractor?.price);
  const teamBudget = totalBudget - overheadBudget - subcontractorCosts;

  return {
    price,
    budgetPercentage,
    overheadPercentage,
    totalBudget,
    overheadBudget,
    subcontractorCosts,
    teamBudget,
  };
};

export const calculateCostAdjustedTeamBudget = ({
  project = {},
  subcontractors = [],
  directCosts = 0,
  allocatedOverheadCosts = 0,
} = {}) => {
  const budget = calculateProjectBudget(project, subcontractors);
  return {
    ...budget,
    directCosts: toAmount(directCosts),
    allocatedOverheadCosts: toAmount(allocatedOverheadCosts),
    costAdjustedTeamBudget: budget.teamBudget - toAmount(directCosts) - toAmount(allocatedOverheadCosts),
  };
};

export const calculateProjectMemberReward = (assignment = {}, teamBudget = 0) => {
  if (!assignment?.reward_type) return 0;
  const availableBudget = Math.max(0, toAmount(teamBudget));
  if (assignment.reward_type === 'fixed') return Math.min(toAmount(assignment.reward_amount), availableBudget);
  if (assignment.reward_type === 'percentage') return availableBudget * (toAmount(assignment.reward_percentage) / 100);
  return 0;
};

export const getProjectCostMemberId = (cost = {}) => cost?.member_id || cost?.member?.id || null;

export const sumUnassignedProjectCosts = (costs = []) => (
  sumByAmount(costs.filter((cost) => !getProjectCostMemberId(cost)), (cost) => cost?.amount)
);

export const sumProjectCostsForMember = (costs = [], memberId = null) => {
  if (!memberId) return 0;
  return sumByAmount(
    costs.filter((cost) => String(getProjectCostMemberId(cost) || '') === String(memberId)),
    (cost) => cost?.amount
  );
};

export const calculateProjectMemberNetReward = (assignment = {}, teamBudget = 0, costs = []) => {
  const grossReward = calculateProjectMemberReward(assignment, teamBudget);
  const assignedCosts = sumProjectCostsForMember(costs, assignment?.member_id);
  return Math.max(0, grossReward - assignedCosts);
};

export const calculateProjectMemberRewardFromProject = (assignment = {}) => {
  if (!assignment?.project) return 0;
  const { teamBudget } = calculateProjectBudget(assignment.project, assignment.project.project_subcontractors || []);
  return calculateProjectMemberReward(assignment, teamBudget);
};

export const calculateProjectFinancials = ({
  project,
  members = [],
  subcontractors = [],
  costs = [],
  overheadCosts = [],
  paidOutAmount = 0,
} = {}) => {
  const budget = calculateProjectBudget(project, subcontractors);
  const totalCosts = sumByAmount(costs, (cost) => cost?.amount);
  const unassignedCosts = sumUnassignedProjectCosts(costs);
  const assignedMemberCosts = totalCosts - unassignedCosts;
  const totalAllocatedOverhead = sumByAmount(overheadCosts, (cost) => cost?.amount);
  const rewardBaseBudget = budget.teamBudget - unassignedCosts - totalAllocatedOverhead;
  const teamRewards = sumByAmount(members, (member) => calculateProjectMemberNetReward(member, rewardBaseBudget, costs));
  const plannedMargin = budget.price - budget.totalBudget;
  const remainingAfterCosts = budget.teamBudget - unassignedCosts - totalAllocatedOverhead;
  const remainingOverheadBudget = budget.overheadBudget - totalAllocatedOverhead;

  return {
    ...budget,
    totalSubcontractorPrice: budget.subcontractorCosts,
    teamRewards,
    remainingTeamBudget: budget.teamBudget - teamRewards,
    totalCosts,
    unassignedCosts,
    assignedMemberCosts,
    plannedMargin,
    projectProfit: plannedMargin,
    remainingAfterCosts,
    totalAllocatedOverhead,
    remainingOverheadBudget,
    paidOutAmount: toAmount(paidOutAmount),
  };
};

export const calculateRealizationFinancials = (realization = {}, totalCosts = 0) => {
  const contractAmount = toAmount(realization?.contract_amount ?? realization?.contractAmount);
  const profitMarginPercent = toAmount(realization?.profit_margin_percent ?? realization?.profitMarginPercent);
  const overheadPercent = toAmount(realization?.overhead_percent ?? realization?.overheadPercent);
  const costs = toAmount(totalCosts);

  const profitAmount = contractAmount * (profitMarginPercent / 100);
  const overheadAmount = contractAmount * (overheadPercent / 100);
  const grossProjectBudget = contractAmount - profitAmount - overheadAmount;
  const teamBudget = grossProjectBudget - costs;

  return {
    contractAmount,
    profitMarginPercent,
    overheadPercent,
    profitAmount,
    overheadAmount,
    grossProjectBudget,
    teamBudget,
    totalCosts: costs,
  };
};

export const areRealizationPercentagesValid = (profitMarginPercent, overheadPercent) => {
  return toAmount(profitMarginPercent) + toAmount(overheadPercent) <= 100;
};

export const calculateRealizationMemberShare = (share = {}, teamBudget = 0) => {
  if (!share?.share_type) return 0;
  const availableBudget = Math.max(0, toAmount(teamBudget));
  if (share.share_type === 'fixed') return Math.min(toAmount(share.share_value), availableBudget);
  if (share.share_type === 'percent') return availableBudget * (toAmount(share.share_value) / 100);
  return 0;
};

export const calculateRealizationMemberAvailableShare = ({
  realization,
  share,
  totalCosts = 0,
  paidAmount = 0,
} = {}) => {
  const financials = calculateRealizationFinancials(realization, totalCosts);
  const totalShare = calculateRealizationMemberShare(share, financials.teamBudget);

  return {
    ...financials,
    totalShare,
    paidAmount: toAmount(paidAmount),
    availableShare: Math.max(0, totalShare - toAmount(paidAmount)),
  };
};

export const assessFinancialHealth = ({
  baseAmount = 0,
  remainingAmount = 0,
  availableAmount = remainingAmount,
  committedAmount = 0,
  minimumReservePercent = 10,
} = {}) => {
  const base = Math.max(0, toAmount(baseAmount));
  const remaining = toAmount(remainingAmount);
  const available = toAmount(availableAmount);
  const committed = Math.max(0, toAmount(committedAmount));
  const reservePercent = base > 0 ? (available / base) * 100 : 0;
  const overallocation = Math.max(0, committed - Math.max(0, remaining));

  if (remaining < 0) return { status: 'loss', base, remaining, available, committed, reservePercent, overallocation };
  if (overallocation > 0) return { status: 'overallocated', base, remaining, available, committed, reservePercent, overallocation };
  if (available <= 0) return { status: 'critical', base, remaining, available, committed, reservePercent, overallocation };
  if (reservePercent < minimumReservePercent) return { status: 'warning', base, remaining, available, committed, reservePercent, overallocation };
  return { status: 'healthy', base, remaining, available, committed, reservePercent, overallocation };
};
