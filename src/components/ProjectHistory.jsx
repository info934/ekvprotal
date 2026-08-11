import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  FileClock,
  History,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { getActivityStatusConfig } from '@/components/engineering/engineeringConfig';
import { formatMoney } from '@/lib/financePresentation';

const labels = {
  back: 'Zp\u011bt na detail projektu',
  title: 'Historie zm\u011bn',
  loadingProject: 'Na\u010d\u00edt\u00e1n\u00ed projektu',
  adminOnly: 'Jen administr\u00e1tor',
  total: 'Zm\u011bn celkem',
  statuses: 'Stavy a aktivity',
  financial: 'Finan\u010dn\u00ed p\u0159epo\u010dty',
  users: 'Aktivn\u00ed u\u017eivatel\u00e9',
  loadingHistory: 'Na\u010d\u00edt\u00e1n\u00ed historie...',
  emptyTitle: 'Zat\u00edm bez historie',
  emptyText: 'Pro tento projekt zat\u00edm nen\u00ed ulo\u017een\u00e1 \u017e\u00e1dn\u00e1 auditn\u00ed zm\u011bna.',
  unchangedRewards: 'Odm\u011bny \u010dlen\u016f z\u016fstaly beze zm\u011bny.',
  assignedCosts: 'P\u0159i\u0159azen\u00e9 n\u00e1klady',
  system: 'Syst\u00e9m',
  unnamed: 'Bez n\u00e1zvu',
};

const statusLabels = {
  nabidka: 'Nab\u00eddka',
  active: 'Aktivn\u00ed',
  ready_for_delivery: 'P\u0159ipraveno k dod\u00e1n\u00ed',
  delivered: 'Dod\u00e1no',
  closed: 'Uzav\u0159eno',
};

const sourceTableLabels = {
  project_members: 't\u00fdmu',
  project_subcontractors: 'subdodavatel\u016f',
  project_costs: 'ostatn\u00edch n\u00e1klad\u016f',
};

const actionLabels = {
  create: 'vytvo\u0159il',
  update: 'upravil',
  delete: 'smazal',
};

const actionMeta = {
  update_project_status: {
    label: 'Stav projektu',
    icon: Activity,
    dot: 'bg-blue-500',
    badge: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  update_task_status: {
    label: '\u00dakol',
    icon: FileClock,
    dot: 'bg-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  update_activity_status: {
    label: 'In\u017een\u00fdring',
    icon: Clock3,
    dot: 'bg-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  project_reward_snapshot: {
    label: 'Finance t\u00fdmu',
    icon: CircleDollarSign,
    dot: 'bg-violet-500',
    badge: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  project_reward_auto_rebalance: {
    label: 'P\u0159epo\u010det pod\u00edl\u016f',
    icon: CircleDollarSign,
    dot: 'bg-indigo-500',
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  default: {
    label: 'Zm\u011bna',
    icon: History,
    dot: 'bg-slate-500',
    badge: 'border-slate-200 bg-slate-50 text-slate-700',
  },
};

const formatCurrency = (value) => formatMoney(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDateTime = (value) => new Date(value).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });

const getRewardChangeRows = (details = {}) => {
  const before = Array.isArray(details.before) ? details.before : [];
  const after = Array.isArray(details.after) ? details.after : [];
  const ids = new Set([...before.map((row) => row.member_id), ...after.map((row) => row.member_id)].filter(Boolean));

  return Array.from(ids).map((id) => {
    const beforeRow = before.find((row) => row.member_id === id) || {};
    const afterRow = after.find((row) => row.member_id === id) || {};
    return {
      id,
      name: afterRow.member_name || beforeRow.member_name || id,
      before: Number(beforeRow.total_reward || 0),
      after: Number(afterRow.total_reward || 0),
      assignedCosts: Number(afterRow.assigned_costs || 0),
    };
  }).filter((row) => Math.abs(row.before - row.after) > 0.01 || row.assignedCosts > 0);
};

const getActionMeta = (action) => actionMeta[action] || actionMeta.default;

const getHistorySummary = (logs) => {
  const users = new Set(logs.map((log) => log.user_email).filter(Boolean));
  return {
    total: logs.length,
    financial: logs.filter((log) => ['project_reward_snapshot', 'project_reward_auto_rebalance'].includes(log.action)).length,
    status: logs.filter((log) => ['update_project_status', 'update_task_status', 'update_activity_status'].includes(log.action)).length,
    users: users.size,
  };
};

const SummaryCard = ({ label, value, icon: Icon, tone = 'slate' }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`grid h-11 w-11 place-items-center rounded-xl border ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-slate-950">{value}</p>
          <p className="text-sm text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
};

const ProjectHistory = () => {
  const { projectId } = useParams();
  const { toast } = useToast();
  const [projectHistory, setProjectHistory] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  const summary = useMemo(() => getHistorySummary(projectHistory), [projectHistory]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('name, code')
      .eq('id', projectId)
      .single();

    if (projectError) {
      toast({ title: 'Chyba p\u0159i na\u010d\u00edt\u00e1n\u00ed projektu', variant: 'destructive', description: projectError.message });
      setLoading(false);
      return;
    }
    setProject(projectData);

    const { data: historyData, error: historyError } = await supabase
      .from('audit_logs')
      .select('*')
      .filter('details->>project_id', 'eq', projectId)
      .order('created_at', { ascending: false });

    if (historyError) {
      toast({ title: 'Chyba p\u0159i na\u010d\u00edt\u00e1n\u00ed historie', description: historyError.message, variant: 'destructive' });
      setProjectHistory([]);
    } else {
      setProjectHistory(historyData || []);
    }
    setLoading(false);
  }, [projectId, toast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const renderLogDetails = (log) => {
    const details = log.details || {};

    switch (log.action) {
      case 'update_project_status':
        return `zm\u011bnil stav projektu z "${statusLabels[details.old_status] || details.old_status}" na "${statusLabels[details.new_status] || details.new_status}"`;
      case 'update_task_status':
        return `zm\u011bnil stav \u00fakolu "${details.task_name || labels.unnamed}" z "${details.old_status || '-'}" na "${details.new_status || '-'}"`;
      case 'update_activity_status': {
        const oldStatus = getActivityStatusConfig(details.old_status)?.label || details.old_status || '-';
        const newStatus = getActivityStatusConfig(details.new_status)?.label || details.new_status || '-';
        return `zm\u011bnil stav \u010dinnosti "${details.activity_subject || labels.unnamed}" z "${oldStatus}" na "${newStatus}"`;
      }
      case 'project_reward_snapshot':
        return `${actionLabels[details.source_action] || 'zm\u011bnil'} polo\u017eku ${sourceTableLabels[details.source_table] || 'projektov\u00fdch financ\u00ed'} a p\u0159epo\u010d\u00edtal odm\u011bny t\u00fdmu`;
      case 'project_reward_auto_rebalance':
        return `p\u0159idal pevnou odm\u011bnu ${formatCurrency(details.fixed_reward_amount)} a pom\u011brn\u011b upravil procentn\u00ed pod\u00edly t\u00fdmu`;
      default:
        return 'provedl zm\u011bnu v projektu';
    }
  };

  const renderRewardRows = (details) => {
    const rows = getRewardChangeRows(details);

    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="grid min-w-0 gap-3 rounded-lg border border-slate-100 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900" title={row.name}>{row.name}</p>
                  {row.assignedCosts > 0 && (
                    <p className="mt-1 text-xs text-slate-500">{labels.assignedCosts}: {formatCurrency(row.assignedCosts)}</p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                  <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 font-mono text-xs tabular-nums text-slate-700">{formatCurrency(row.before)}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="whitespace-nowrap rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-emerald-700">{formatCurrency(row.after)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{labels.unchangedRewards}</p>
        )}
      </div>
    );
  };

  const renderRebalanceRows = (details = {}) => {
    const before = Array.isArray(details.before) ? details.before : [];
    const after = Array.isArray(details.after) ? details.after : [];

    return (
      <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-indigo-800">
          <span>Fond odměn: <strong>{formatCurrency(details.reward_pool)}</strong></span>
          <span>
            Součet podílů: <strong>{Number(details.percentage_total_before || 0).toFixed(2)} % → {Number(details.percentage_total_after || 0).toFixed(2)} %</strong>
          </span>
        </div>
        <div className="space-y-2">
          {after.map((row) => {
            const previous = before.find((item) => item.assignment_id === row.assignment_id);
            return (
              <div key={row.assignment_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">{row.member_name || row.member_id}</span>
                <span className="font-mono text-slate-700">
                  {Number(previous?.reward_percentage || 0).toFixed(2)} % → {Number(row.reward_percentage || 0).toFixed(2)} %
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="app-page space-y-6 pb-10">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link to={`/projects/${projectId}`} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-primary">
              <ChevronLeft className="h-4 w-4" />
              {labels.back}
            </Link>
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                <History className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">{labels.title}</h1>
                <p className="mt-1 truncate text-slate-500">{project?.name || labels.loadingProject} {project?.code ? <span className="font-mono">{project.code}</span> : null}</p>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
            <ShieldCheck className="mr-2 h-4 w-4" />
            {labels.adminOnly}
          </Badge>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={labels.total} value={summary.total} icon={History} tone="blue" />
        <SummaryCard label={labels.statuses} value={summary.status} icon={Activity} tone="emerald" />
        <SummaryCard label={labels.financial} value={summary.financial} icon={CircleDollarSign} tone="violet" />
        <SummaryCard label={labels.users} value={summary.users} icon={Users} />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">{labels.loadingHistory}</div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {projectHistory.length > 0 ? (
            <div className="relative">
              <div className="absolute bottom-2 left-4 top-2 hidden w-px bg-slate-200 sm:block" />
              <div className="space-y-4">
                {projectHistory.map((log) => {
                  const meta = getActionMeta(log.action);
                  const Icon = meta.icon;

                  return (
                    <article key={log.id} className="relative min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:ml-10 sm:bg-white">
                      <div className={`absolute -left-[3.25rem] top-4 hidden h-8 w-8 items-center justify-center rounded-full border-4 border-white text-white shadow-sm sm:flex ${meta.dot}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`${meta.badge} px-2.5 py-1`}>
                            <Icon className="mr-1.5 h-3.5 w-3.5" />
                            {meta.label}
                          </Badge>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDateTime(log.created_at)}
                          </span>
                        </div>
                        <p className="break-words text-base font-medium leading-7 text-slate-900">
                          <span className="font-semibold text-primary break-all">{log.user_email || labels.system}</span>{' '}
                          {renderLogDetails(log)}
                        </p>
                        {log.action === 'project_reward_snapshot' && renderRewardRows(log.details)}
                        {log.action === 'project_reward_auto_rebalance' && renderRebalanceRows(log.details)}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <History className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 font-semibold text-slate-800">{labels.emptyTitle}</p>
              <p className="mt-1 text-sm text-slate-500">{labels.emptyText}</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default ProjectHistory;
