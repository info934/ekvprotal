import React, { useMemo } from 'react';
import { DATAVIZ_COLORS, StatusDonutChart } from '@/components/ui/data-viz';

const taskStatusConfig = {
  Nové: { color: DATAVIZ_COLORS.primary, label: 'Nové' },
  'V řešení': { color: DATAVIZ_COLORS.amber, label: 'V řešení' },
  Hotovo: { color: DATAVIZ_COLORS.emerald, label: 'Hotovo' },
};

const engineeringStatusConfig = {
  new: { label: 'Nové', color: DATAVIZ_COLORS.primary },
  in_progress: { label: 'V řešení', color: DATAVIZ_COLORS.amber },
  done: { label: 'Hotovo', color: DATAVIZ_COLORS.emerald },
};

const projectStatusConfig = {
  nabidka: { label: 'Nabídka', color: DATAVIZ_COLORS.slate },
  active: { label: 'Aktivní', color: DATAVIZ_COLORS.emerald },
  ready_for_delivery: { label: 'K dodání', color: DATAVIZ_COLORS.primary },
  delivered: { label: 'Dodáno', color: DATAVIZ_COLORS.violet },
  closed: { label: 'Uzavřeno', color: DATAVIZ_COLORS.slate },
};

const processData = (rawData = [], config = {}) => {
  const counts = rawData.reduce((acc, item) => {
    const status = item.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    total: rawData.length,
    data: Object.entries(counts)
      .map(([status, count]) => ({
        label: config[status]?.label || status,
        count,
        color: config[status]?.color,
      }))
      .sort((a, b) => b.count - a.count),
  };
};

const ProjectStatusChart = ({ tasks, activities, projects, statusCounts }) => {
  const chartInfo = useMemo(() => {
    if (statusCounts) return {
      total: statusCounts.reduce((sum, row) => sum + Number(row.count), 0),
      data: statusCounts.map(row => ({ label: taskStatusConfig[row.status]?.label || row.status || 'Neznámý', count: Number(row.count), color: taskStatusConfig[row.status]?.color })),
      emptyLabel: 'Žádné úkoly k zobrazení.',
    };
    if (tasks) {
      return { ...processData(tasks, taskStatusConfig), emptyLabel: 'Žádné úkoly k zobrazení.' };
    }
    if (activities) {
      return { ...processData(activities, engineeringStatusConfig), emptyLabel: 'Žádné aktivity k zobrazení.' };
    }
    return { ...processData(projects, projectStatusConfig), emptyLabel: 'Žádné projekty k zobrazení.' };
  }, [activities, projects, tasks, statusCounts]);

  return <StatusDonutChart data={chartInfo.data} total={chartInfo.total} emptyLabel={chartInfo.emptyLabel} />;
};

export default ProjectStatusChart;
