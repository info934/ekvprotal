import { toAmount } from '@/domain/financials';

export const REALIZATION_CLOSED_STATUSES = ['Dokončeno', 'Předáno'];

export const getEmptyRealizationProjectionStats = () => ({
  total: 0,
  running: 0,
  preparing: 0,
  paused: 0,
  waiting: 0,
  active: 0,
  closed: 0,
  pendingOrPreparing: 0,
  value: 0,
});

export const calculateRealizationProjectionStats = (
  realizations = [],
  { closedStatuses = REALIZATION_CLOSED_STATUSES } = {}
) => {
  const closedStatusSet = new Set(closedStatuses);

  return (realizations || []).reduce((acc, realization) => {
    const status = realization?.status;
    const isClosed = closedStatusSet.has(status);
    const preparing = status === 'Připravuje se' ? acc.preparing + 1 : acc.preparing;
    const waiting = status === 'waiting_for_approval' ? acc.waiting + 1 : acc.waiting;

    return {
      total: acc.total + 1,
      running: status === 'Probíhá' ? acc.running + 1 : acc.running,
      preparing,
      paused: status === 'Pozastaveno' ? acc.paused + 1 : acc.paused,
      waiting,
      active: isClosed ? acc.active : acc.active + 1,
      closed: isClosed ? acc.closed + 1 : acc.closed,
      pendingOrPreparing: preparing + waiting,
      value: acc.value + toAmount(realization?.contract_amount),
    };
  }, getEmptyRealizationProjectionStats());
};

export const calculateRealizationHealthScore = (stats = getEmptyRealizationProjectionStats()) => {
  const riskPenalty = Math.min(35, toAmount(stats.paused) * 12) + Math.min(25, toAmount(stats.waiting) * 7);
  return Math.max(0, Math.min(100, 100 - riskPenalty));
};

export const buildRealizationProjectionChartData = ({
  realizations = [],
  stats,
  statusConfig = {},
  statusOrder = Object.keys(statusConfig),
  palette = [],
  canViewAmounts = false,
} = {}) => {
  const projectionStats = stats || calculateRealizationProjectionStats(realizations);

  const statusCounts = statusOrder.map((statusKey, index) => {
    const items = realizations.filter((item) => item?.status === statusKey);
    return {
      status: statusKey,
      label: statusConfig[statusKey]?.label || statusKey,
      count: items.length,
      fill: palette[index % palette.length],
    };
  }).filter((item) => item.count > 0);

  const statusValue = statusOrder.map((statusKey, index) => {
    const items = realizations.filter((item) => item?.status === statusKey);
    return {
      status: statusKey,
      label: statusConfig[statusKey]?.label || statusKey,
      value: canViewAmounts ? items.reduce((sum, item) => sum + toAmount(item?.contract_amount), 0) : items.length,
      fill: palette[index % palette.length],
    };
  }).filter((item) => item.value > 0 || statusCounts.some((count) => count.status === item.status));

  return {
    healthScore: calculateRealizationHealthScore(projectionStats),
    statusCounts,
    statusValue,
  };
};
