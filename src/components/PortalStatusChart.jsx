import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Briefcase, Wrench, ListTodo, BarChart } from 'lucide-react';

const projectStatusConfig = {
  nabidka: { label: 'Nabídka', color: '#f59e0b' },
  active: { label: 'Aktivní', color: '#10b981' },
  ready_for_delivery: { label: 'K dodání', color: '#3b82f6' },
  delivered: { label: 'Dodáno', color: '#8b5cf6' },
  closed: { label: 'Uzavřeno', color: '#64748b' }
};

const engineeringStatusConfig = {
  new: { label: 'Nové', color: '#3b82f6' },
  in_progress: { label: 'V řešení', color: '#f97316' },
  waiting_for_input: { label: 'Čeká na podklady', color: '#facc15' }, // Added color for consistency
  waiting_for_approval: { label: 'Čeká na schválení', color: '#a855f7' }, // Added with purple color
  done: { label: 'Hotovo', color: '#22c55e' },
  rejected: { label: 'Zamítnuto', color: '#ef4444' }, // Added color for consistency
};

const taskStatusConfig = {
  'Nové': { color: '#3b82f6', label: 'Nové' },
  'V řešení': { color: '#f97316', label: 'V řešení' },
  'Hotovo': { color: '#22c55e', label: 'Hotovo' },
};

const DonutChart = ({ data, total }) => {
  let accumulatedPercentage = 0;
  return (
    <div className="relative w-36 h-36">
      <svg viewBox="0 0 36 36" className="w-full h-full">
        <motion.circle
          cx="18" cy="18" r="15.915"
          fill="transparent" stroke="#e5e7eb" strokeWidth="3"
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
        <span className="text-3xl font-bold text-slate-800">{total}</span>
        <span className="text-xs text-muted-foreground">Celkem</span>
      </div>
    </div>
  );
};


const ChartSection = ({ title, icon: Icon, data, total }) => {
    if (total === 0) return null;

    return (
        <div className="flex flex-col items-center gap-4 bg-white/60 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><Icon className="w-5 h-5"/>{title}</h3>
            <DonutChart data={data} total={total} />
            <div className="w-full space-y-2 text-sm">
                {data.map((item, index) => (
                    <div key={index} className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}/>
                            <span>{item.label}</span>
                        </div>
                        <span className="font-bold">{item.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

const PortalStatusChart = () => {
  const [chartData, setChartData] = useState({ projects: [], engineering: [], tasks: [] });
  const [totals, setTotals] = useState({ projects: 0, engineering: 0, tasks: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
        setLoading(true);

        const [
            { data: projectsData, error: projectsError },
            { data: engineeringData, error: engineeringError },
            { data: tasksData, error: tasksError }
        ] = await Promise.all([
            supabase.from('projects').select('status', { count: 'exact' }),
            supabase.from('engineering_activities').select('status', { count: 'exact' }),
            supabase.from('project_tasks').select('status', { count: 'exact' })
        ]);

        const processData = (rawData, config) => {
            const counts = rawData.reduce((acc, item) => {
                acc[item.status] = (acc[item.status] || 0) + 1;
                return acc;
            }, {});
            const total = rawData.length;
            if (total === 0) return { data: [], total: 0 };
            const chartData = Object.entries(counts).map(([status, count]) => ({
                label: config[status]?.label || status,
                count,
                percentage: (count / total) * 100,
                color: config[status]?.color || '#94a3b8',
            }));
            return { data: chartData.sort((a, b) => b.count - a.count), total };
        };
        
        if (!projectsError) {
            const { data, total } = processData(projectsData, projectStatusConfig);
            setChartData(prev => ({...prev, projects: data}));
            setTotals(prev => ({...prev, projects: total}));
        }
        if (!engineeringError) {
            const { data, total } = processData(engineeringData, engineeringStatusConfig);
            setChartData(prev => ({...prev, engineering: data}));
            setTotals(prev => ({...prev, engineering: total}));
        }
        if (!tasksError) {
            const { data, total } = processData(tasksData, taskStatusConfig);
            setChartData(prev => ({...prev, tasks: data}));
            setTotals(prev => ({...prev, tasks: total}));
        }

        setLoading(false);
    };

    fetchData();
  }, []);

  if (loading) {
    return <div className="text-center py-8">Načítání stavových grafů...</div>;
  }

  return (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-effect rounded-xl p-6"
    >
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800">
            <BarChart className="w-5 h-5 text-purple-600" />
            Aktuální stav portálu
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           <ChartSection title="Projekty" icon={Briefcase} data={chartData.projects} total={totals.projects} />
           <ChartSection title="Inženýring" icon={Wrench} data={chartData.engineering} total={totals.engineering} />
           <ChartSection title="Úkoly" icon={ListTodo} data={chartData.tasks} total={totals.tasks} />
        </div>
    </motion.div>
  );
};

export default PortalStatusChart;