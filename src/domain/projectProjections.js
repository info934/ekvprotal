import { toAmount } from '@/domain/financials';

export const PROJECT_CLOSED_STATUSES = ['delivered', 'closed'];

export const getEmptyProjectProjectionStats = () => ({
  total: 0,
  active: 0,
  offers: 0,
  ready: 0,
  delivered: 0,
  closed: 0,
  open: 0,
  value: 0,
});

export const calculateProjectProjectionStats = (
  projects = [],
  { closedStatuses = PROJECT_CLOSED_STATUSES } = {}
) => {
  const closedStatusSet = new Set(closedStatuses);

  return (projects || []).reduce((acc, project) => {
    const isClosed = closedStatusSet.has(project?.status);

    return {
      total: acc.total + 1,
      active: project?.status === 'active' ? acc.active + 1 : acc.active,
      offers: project?.status === 'nabidka' ? acc.offers + 1 : acc.offers,
      ready: project?.status === 'ready_for_delivery' ? acc.ready + 1 : acc.ready,
      delivered: project?.status === 'delivered' ? acc.delivered + 1 : acc.delivered,
      closed: isClosed ? acc.closed + 1 : acc.closed,
      open: isClosed ? acc.open : acc.open + 1,
      value: acc.value + toAmount(project?.price),
    };
  }, getEmptyProjectProjectionStats());
};

export const calculateProjectCompletionScore = (stats = getEmptyProjectProjectionStats()) => {
  if (!stats.total) return 0;
  return Math.round((toAmount(stats.closed) / toAmount(stats.total)) * 100);
};

export const buildProjectProjectionChartData = ({
  projects = [],
  projectStats,
  projectStatusConfig = {},
  statusOrder = Object.keys(projectStatusConfig),
  palette = [],
  showFinance = false,
} = {}) => {
  const stats = projectStats || calculateProjectProjectionStats(projects);

  const statusCounts = statusOrder.map((statusKey, index) => {
    const items = projects.filter((project) => project?.status === statusKey);
    return {
      status: statusKey,
      label: projectStatusConfig[statusKey]?.label || statusKey,
      count: items.length,
      fill: palette[index % palette.length],
    };
  }).filter((item) => item.count > 0);

  const statusValue = statusOrder.map((statusKey, index) => {
    const items = projects.filter((project) => project?.status === statusKey);
    return {
      status: statusKey,
      label: projectStatusConfig[statusKey]?.label || statusKey,
      value: showFinance ? items.reduce((sum, project) => sum + toAmount(project?.price), 0) : items.length,
      fill: palette[index % palette.length],
    };
  }).filter((item) => item.value > 0 || statusCounts.some((count) => count.status === item.status));

  return {
    completionScore: calculateProjectCompletionScore(stats),
    statusCounts,
    statusValue,
  };
};
