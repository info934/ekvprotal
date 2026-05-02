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

export const calculateProjectMemberReward = (assignment = {}, teamBudget = 0) => {
  if (!assignment?.reward_type) return 0;
  if (assignment.reward_type === 'fixed') return toAmount(assignment.reward_amount);
  if (assignment.reward_type === 'percentage') return toAmount(teamBudget) * (toAmount(assignment.reward_percentage) / 100);
  return 0;
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
  const teamRewards = sumByAmount(members, (member) => calculateProjectMemberReward(member, budget.teamBudget));
  const totalCosts = sumByAmount(costs, (cost) => cost?.amount);
  const projectProfit = budget.price - budget.totalBudget - totalCosts;
  const totalAllocatedOverhead = sumByAmount(overheadCosts, (cost) => cost?.amount);
  const remainingOverheadBudget = budget.overheadBudget - totalAllocatedOverhead;

  return {
    ...budget,
    totalSubcontractorPrice: budget.subcontractorCosts,
    teamRewards,
    remainingTeamBudget: budget.teamBudget - teamRewards,
    totalCosts,
    projectProfit,
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
  if (share.share_type === 'fixed') return toAmount(share.share_value);
  if (share.share_type === 'percent') return Math.max(0, toAmount(teamBudget) * (toAmount(share.share_value) / 100));
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
