import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, ListTodo, Wrench } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { DataVizCard, DATAVIZ_COLORS, StatusDonutChart } from '@/components/ui/data-viz';

const projectStatusConfig = {
  nabidka: { label: 'Nabídka', color: DATAVIZ_COLORS.amber },
  active: { label: 'Aktivní', color: DATAVIZ_COLORS.emerald },
  ready_for_delivery: { label: 'K dodání', color: DATAVIZ_COLORS.primary },
  delivered: { label: 'Dodáno', color: DATAVIZ_COLORS.violet },
  closed: { label: 'Uzavřeno', color: DATAVIZ_COLORS.slate },
};

const engineeringStatusConfig = {
  new: { label: 'Nové', color: DATAVIZ_COLORS.primary },
  in_progress: { label: 'V řešení', color: DATAVIZ_COLORS.amber },
  waiting_for_input: { label: 'Čeká na podklady', color: DATAVIZ_COLORS.lime },
  waiting_for_approval: { label: 'Čeká na schválení', color: DATAVIZ_COLORS.violet },
  done: { label: 'Hotovo', color: DATAVIZ_COLORS.emerald },
  rejected: { label: 'Zamítnuto', color: DATAVIZ_COLORS.rose },
};

const taskStatusConfig = {
  Nové: { color: DATAVIZ_COLORS.primary, label: 'Nové' },
  'V řešení': { color: DATAVIZ_COLORS.amber, label: 'V řešení' },
  Hotovo: { color: DATAVIZ_COLORS.emerald, label: 'Hotovo' },
};

const processData = (rawData = [], config = {}) => {
  const counts = rawData.reduce((acc, item) => {
    const status = item.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const total = rawData.length;

  return {
    total,
    data: Object.entries(counts)
      .map(([status, count]) => ({
        label: config[status]?.label || status,
        count,
        color: config[status]?.color,
      }))
      .sort((a, b) => b.count - a.count),
  };
};

const PortalStatusChart = ({ projects, engineering, tasks }) => {
  const hasProvidedData = Array.isArray(projects) && Array.isArray(engineering) && Array.isArray(tasks);
  const [rawData, setRawData] = useState(() => ({
    projects: projects || [],
    engineering: engineering || [],
    tasks: tasks || [],
  }));
  const [loading, setLoading] = useState(!hasProvidedData);

  useEffect(() => {
    if (hasProvidedData) {
      setRawData({ projects, engineering, tasks });
      setLoading(false);
      return undefined;
    }

    const fetchData = async () => {
      setLoading(true);

      const [projectsRes, engineeringRes, tasksRes] = await Promise.all([
        supabase.from('projects').select('status'),
        supabase.from('engineering_activities').select('status'),
        supabase.from('project_tasks').select('status'),
      ]);

      setRawData({
        projects: projectsRes.error ? [] : projectsRes.data || [],
        engineering: engineeringRes.error ? [] : engineeringRes.data || [],
        tasks: tasksRes.error ? [] : tasksRes.data || [],
      });
      setLoading(false);
    };

    fetchData();
  }, [engineering, hasProvidedData, projects, tasks]);

  const chartData = useMemo(
    () => ({
      projects: processData(rawData.projects, projectStatusConfig),
      engineering: processData(rawData.engineering, engineeringStatusConfig),
      tasks: processData(rawData.tasks, taskStatusConfig),
    }),
    [rawData]
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
        Načítám stavové grafy...
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
      <DataVizCard className="min-w-0" contentClassName="p-4" title="Projekty" description="Rozložení podle aktuálního stavu." icon={Briefcase}>
        <StatusDonutChart layout="stacked" data={chartData.projects.data} total={chartData.projects.total} emptyLabel="Žádné projekty k zobrazení." />
      </DataVizCard>
      <DataVizCard className="min-w-0" contentClassName="p-4" title="Inženýring" description="Aktivity podle stavu zpracování." icon={Wrench}>
        <StatusDonutChart layout="stacked" data={chartData.engineering.data} total={chartData.engineering.total} emptyLabel="Žádné inženýrské aktivity k zobrazení." />
      </DataVizCard>
      <DataVizCard className="min-w-0" contentClassName="p-4" title="Úkoly" description="Přehled otevřených a hotových úkolů." icon={ListTodo}>
        <StatusDonutChart layout="stacked" data={chartData.tasks.data} total={chartData.tasks.total} emptyLabel="Žádné úkoly k zobrazení." />
      </DataVizCard>
    </motion.div>
  );
};

export default PortalStatusChart;
