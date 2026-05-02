import React from 'react';
import { motion } from 'framer-motion';

const taskStatusConfig = {
  'Nové': { color: '#3b82f6', label: 'Nové' },
  'V řešení': { color: '#f97316', label: 'V řešení' },
  'Hotovo': { color: '#22c55e', label: 'Hotovo' },
};

const engineeringStatusConfig = {
  new: { label: 'Nové', color: '#3b82f6' },
  in_progress: { label: 'V řešení', color: '#f97316' },
  done: { label: 'Hotovo', color: '#22c55e' },
};

const projectStatusConfig = {
  nabidka: { label: 'Nabídka', color: '#64748b' },
  active: { label: 'Aktivní', color: '#22c55e' },
  ready_for_delivery: { label: 'K dodání', color: '#3b82f6' },
  delivered: { label: 'Dodáno', color: '#8b5cf6' },
  closed: { label: 'Uzavřeno', color: '#1e293b' },
};


const DonutChart = ({ data, total, title }) => {
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-muted-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">Žádná data k zobrazení.</p>
      </div>
    );
  }

  let accumulatedPercentage = 0;
  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg viewBox="0 0 36 36" className="w-full h-full">
        <motion.circle
          cx="18" cy="18" r="15.915"
          fill="transparent" stroke="hsl(var(--border))" strokeWidth="3"
        />
        {data.map((item, index) => {
          const strokeDasharray = `${item.percentage} ${100 - item.percentage}`;
          const strokeDashoffset = 25 - accumulatedPercentage;
          accumulatedPercentage += item.percentage;
          return (
            <motion.circle
              key={index}
              cx="18" cy="18" r="15.915"
              fill="transparent"
              stroke={item.color}
              strokeWidth="3.5"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              initial={{ strokeDasharray: `0 100` }}
              animate={{ strokeDasharray: `${item.percentage} ${100 - item.percentage}` }}
              transition={{ duration: 0.8, delay: index * 0.1, ease: "easeOut" }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-bold">{total}</span>
        <span className="text-xs text-muted-foreground">Celkem</span>
      </div>
    </div>
  );
};

const ProjectStatusChart = ({ tasks, activities, projects }) => {
  const processData = (rawData, config, title) => {
    if (!rawData || rawData.length === 0) return { data: [], total: 0, title };
    const counts = rawData.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    const total = rawData.length;
    const chartData = Object.entries(counts).map(([status, count]) => ({
      label: config[status]?.label || status,
      count,
      percentage: (count / total) * 100,
      color: config[status]?.color || '#94a3b8',
    }));
    return { data: chartData.sort((a, b) => b.count - a.count), total, title };
  };

  let chartInfo;
  if (tasks) {
    chartInfo = processData(tasks, taskStatusConfig, "Stav úkolů");
  } else if (activities) {
    chartInfo = processData(activities, engineeringStatusConfig, "Stav inženýringu");
  } else {
    chartInfo = processData(projects, projectStatusConfig, "Stav projektů");
  }

  const { data: chartData, total, title } = chartInfo;

  return (
    <div className="flex flex-col items-center gap-4">
      <DonutChart data={chartData} total={total} title={title} />
      <div className="w-full space-y-2 text-sm">
        {chartData.map((item, index) => (
          <div key={index} className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </div>
            <span className="font-bold">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectStatusChart;