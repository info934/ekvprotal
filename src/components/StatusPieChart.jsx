import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { motion } from 'framer-motion';

const COLORS = {
  'Nové': '#3b82f6',
  'V řešení': '#f97316',
  'Hotovo': '#22c55e',
  'new': '#3b82f6',
  'in_progress': '#f97316',
  'done': '#22c55e',
};

const LABELS = {
  'Nové': 'Nové',
  'V řešení': 'V řešení',
  'Hotovo': 'Hotovo',
  'new': 'Nové',
  'in_progress': 'V řešení',
  'done': 'Hotovo',
};

const CustomLegend = (props) => {
  const { payload } = props;
  return (
    <ul className="flex flex-col space-y-2 text-sm">
      {payload.map((entry, index) => (
        <li key={`item-${index}`} className="flex items-center">
          <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.value}:</span>
          <span className="font-semibold ml-1">{entry.payload.value}</span>
        </li>
      ))}
    </ul>
  );
};

const StatusPieChart = ({ data, type }) => {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const statusCounts = data.reduce((acc, item) => {
      const status = item.status;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(statusCounts).map(([status, count]) => ({
      name: LABELS[status] || status,
      value: count,
    }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Žádná data k zobrazení
      </div>
    );
  }

  const total = chartData.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="flex w-full h-full items-center justify-between">
      <div className="w-1/2 h-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              innerRadius={40}
              outerRadius={60}
              fill="#8884d8"
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.name] || COLORS[Object.keys(COLORS).find(k => LABELS[k] === entry.name)] || '#8884d8'} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [value, name]}
              contentStyle={{
                background: 'rgba(255, 255, 255, 0.8)',
                border: '1px solid #ccc',
                borderRadius: '0.5rem',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground">Celkem</p>
          </div>
        </div>
      </div>
      <div className="w-1/2 pl-4">
        <CustomLegend payload={chartData.map((entry, index) => ({
          value: entry.name,
          color: COLORS[entry.name] || COLORS[Object.keys(COLORS).find(k => LABELS[k] === entry.name)] || '#8884d8',
          payload: { value: entry.value }
        }))} />
      </div>
    </div>
  );
};

export default StatusPieChart;