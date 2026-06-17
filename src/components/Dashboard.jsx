import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  Briefcase,
  CalendarClock,
  CheckCircle,
  CircleDollarSign,
  ClipboardList,
  FileText,
  GanttChartSquare,
  Home,
  MoreHorizontal,
  Package,
  PiggyBank,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShoppingCart,
  Target,
  Timer,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PortalStatusChart from '@/components/PortalStatusChart';
import ProjectStatusChart from '@/components/ProjectStatusChart';
import ProjectGanttChart from '@/components/ProjectGanttChart';
import RealizationGanttChart from '@/components/RealizationGanttChart';
import { PendingApprovalsWidget } from '@/components/DashboardWidgets';
import { getActivityStatusConfig } from '@/components/engineering/engineeringConfig';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { crmOpportunityPath } from '@/lib/crmRoutes';
import { cn, formatCurrency } from '@/lib/utils';

const today = new Date();
today.setHours(0, 0, 0, 0);

const emptyCompanyFinance = {
  realizedProfit: 0,
  potentialProfit: 0,
  totalProjectValue: 0,
  unallocatedBudget: 0,
  overheadAllocated: 0,
  overheadAccounted: 0,
};

const isOpenStatus = (status) => {
  const value = String(status || '').toLowerCase();
  return !['done', 'completed', 'complete', 'finished', 'closed', 'archived', 'cancelled', 'canceled', 'paid'].includes(value);
};

const isOverdue = (date) => {
  if (!date) return false;
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value < today;
};

const formatDate = (date) => {
  if (!date) return 'Bez termínu';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date));
};

const pluralizeCs = (count, one, few, many) => {
  const value = Math.abs(Number(count || 0));
  if (value === 1) return one;
  if (value >= 2 && value <= 4) return few;
  return many;
};

const safeArray = (result) => (result?.error ? [] : (result?.data || []));

const stageLabels = {
  lead: 'Přijetí poptávky',
  contacted: 'Proběhlo jednání',
  proposal: 'Šla nabídka',
  negotiation: 'Před uzavřením',
  won: 'Podepsáno',
  lost: 'Prohra',
};

const stageClasses = {
  lead: 'bg-amber-50 text-amber-700 border-amber-200',
  contacted: 'bg-sky-50 text-sky-700 border-sky-200',
  proposal: 'bg-orange-50 text-orange-700 border-orange-200',
  negotiation: 'bg-lime-50 text-lime-700 border-lime-200',
  won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost: 'bg-rose-50 text-rose-700 border-rose-200',
};

const DashboardMetric = ({ icon: Icon, label, value, detail, tone = 'blue', to }) => {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700 shadow-blue-100/60',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700 shadow-emerald-100/60',
    amber: 'border-amber-100 bg-amber-50 text-amber-700 shadow-amber-100/60',
    rose: 'border-rose-100 bg-rose-50 text-rose-700 shadow-rose-100/60',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 shadow-slate-100/60',
  };

  const content = (
    <Card className="h-full min-h-[112px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] text-slate-500">{label}</p>
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md border shadow-sm', tones[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="min-w-0">
          <p className="break-words text-[1.35rem] font-semibold leading-7 tracking-tight text-slate-950 2xl:text-[1.5rem]">{value}</p>
          {detail && <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">{detail}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to} className="block h-full">{content}</Link> : content;
};

const SectionHeader = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      </div>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
    {action}
  </div>
);

const WorkItem = ({ title, subtitle, meta, to, tone = 'slate' }) => {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    blue: 'bg-blue-100 text-blue-700',
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-primary/30 hover:bg-blue-50/30">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {meta && <Badge className={cn('border-0 text-xs', tones[tone])}>{meta}</Badge>}
        {to && (
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to={to} aria-label={`Otevřít ${title}`}>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
};

const EmptyBlock = ({ text }) => (
  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
    {text}
  </div>
);

const chartPalette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#8b5cf6'];

const ChartTooltip = ({ active, payload, label, valueFormatter = (value) => value }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
      {label && <div className="mb-1 font-semibold text-slate-950">{label}</div>}
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={item.dataKey || item.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color || item.payload?.fill }} />
              {item.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-950">{valueFormatter(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const MoneyAxisTick = ({ x, y, payload }) => (
  <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11}>
    {Math.round(Number(payload.value || 0) / 1000)}k
  </text>
);

const MiniAreaChart = ({ data }) => (
  <div className="h-48">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="dashboardPipelineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="dashboardWeightedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis tickLine={false} axisLine={false} tick={<MoneyAxisTick />} width={42} />
        <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} />} />
        <Area type="monotone" dataKey="pipeline" name="Pipeline" stroke="#2563eb" strokeWidth={2.5} fill="url(#dashboardPipelineFill)" />
        <Area type="monotone" dataKey="weighted" name="Váženě" stroke="#10b981" strokeWidth={2.5} fill="url(#dashboardWeightedFill)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

const WorkloadBarChart = ({ data }) => (
  <div className="h-48">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="count" name="Počet" radius={[8, 8, 0, 0]}>
          {data.map((entry, index) => <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

const HealthRadial = ({ score }) => {
  const color = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative h-44">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="95%" data={[{ name: 'Zdraví', value: score, fill: color }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} background={{ fill: '#e2e8f0' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold tracking-tight text-slate-950">{score}%</div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">zdraví portálu</div>
      </div>
    </div>
  );
};

const StatusLine = ({ icon: Icon, label, value, tone = 'slate' }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', tones[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">{value}</span>
    </div>
  );
};

const ExecutiveDashboard = ({ canViewCompanyFinance, chartData, summary, data, attentionItems }) => (
  <div className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)_360px]">
    <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <SectionHeader icon={ShieldAlert} title="Zdraví portálu" description="Aktuální provozní tlak a rizika." />
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <HealthRadial score={chartData.healthScore} />
        <div className="space-y-2">
          <StatusLine icon={Briefcase} label="Aktivní projekce" value={summary.activeProjects.length} tone="blue" />
          <StatusLine icon={Wrench} label="Aktivní realizace" value={summary.activeRealizations.length} tone="amber" />
          <StatusLine icon={ClipboardList} label="Úkoly po termínu" value={summary.overdueTasks.length} tone={summary.overdueTasks.length ? 'rose' : 'emerald'} />
          <StatusLine icon={CheckCircle} label="Ke schválení" value={summary.pendingApprovals} tone={summary.pendingApprovals ? 'amber' : 'emerald'} />
        </div>
      </CardContent>
    </Card>

    <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200 bg-white px-4 py-3">
        <SectionHeader
          icon={BarChart3}
          title={canViewCompanyFinance ? 'Výkon a cashflow práce' : 'Výkon a workload'}
          description={canViewCompanyFinance ? 'CRM, projekce a realizace v jedné provozní křivce.' : 'Počty práce bez finančních částek.'}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-md bg-blue-50 px-2.5 py-1 text-blue-700">{summary.openOpportunities.length} otevřených OP</Badge>
              {canViewCompanyFinance && <Badge variant="outline" className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700">Zisk {formatCurrency(data.companyFinance.realizedProfit)}</Badge>}
            </div>
          }
        />
      </CardHeader>
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
          {canViewCompanyFinance ? (
            <MiniAreaChart data={chartData.pipelineTrend} />
          ) : (
            <WorkloadBarChart data={chartData.workload} />
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.04em] text-slate-500">Dnešní stav</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <div className="font-bold text-slate-950">{summary.activeProjects.length}</div>
                <div className="text-[11px] text-slate-500">projekty</div>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <div className="font-bold text-slate-950">{summary.openTasks.length}</div>
                <div className="text-[11px] text-slate-500">úkoly</div>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2">
                <div className="font-bold text-slate-950">{summary.activeEngineering.length}</div>
                <div className="text-[11px] text-slate-500">inž.</div>
              </div>
            </div>
          </div>
          <WorkloadBarChart data={chartData.workload} />
        </div>
      </CardContent>
    </Card>

    <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-200 bg-white px-4 py-3">
        <SectionHeader
          icon={Timer}
          title="Co řešit teď"
          description="Blokery, schválení a termíny."
          action={<Button asChild variant="outline" size="sm"><Link to="/tasks">Úkoly</Link></Button>}
        />
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        {attentionItems.length > 0 ? (
          attentionItems.slice(0, 6).map((item, index) => <WorkItem key={`${item.title}-${index}`} {...item} />)
        ) : (
          <EmptyBlock text="Aktuálně není nic kritického k řešení." />
        )}
      </CardContent>
    </Card>
  </div>
);

const DashboardTable = ({ canViewCompanyFinance, opportunities }) => (
  <Card className="crm-panel">
    <CardHeader className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
      <SectionHeader
        icon={Target}
        title="Obchodní nástěnka"
        description="Aktuální pipeline v tabulkovém přehledu podle obchodního dashboardu."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/crm">Otevřít CRM</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/crm/new">
                <Plus className="h-4 w-4" />
                Nový záznam
              </Link>
            </Button>
          </div>
        }
      />
    </CardHeader>
    <CardContent className="p-0">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <div className="h-9 rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm leading-9 text-slate-400">
              Hledat...
            </div>
          </div>
          <Badge variant="outline" className="h-9 rounded-md px-3 text-slate-600">Moje filtry</Badge>
          <Badge variant="outline" className="h-9 rounded-md px-3 text-slate-600">Aktivní</Badge>
          <Badge variant="outline" className="h-9 rounded-md px-3 text-slate-600">Typ obchodu</Badge>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-[980px] items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950">
          <span>Obchodní nástěnka</span>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{opportunities.length}</span>
        </div>
        <table className="w-full min-w-[980px] border-collapse bg-white text-sm">
          <thead className="border-y border-slate-200 bg-slate-50/90 text-[11px] uppercase tracking-[0.02em] text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Kód</th>
              <th className="px-4 py-3 text-left font-semibold">Předmět</th>
              <th className="px-4 py-3 text-left font-semibold">Klient</th>
              <th className="px-4 py-3 text-left font-semibold">Stav</th>
              {canViewCompanyFinance && <th className="px-4 py-3 text-right font-semibold">Konečná cena</th>}
              <th className="px-4 py-3 text-left font-semibold">Odhad uzavření</th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {opportunities.length > 0 ? opportunities.map((opportunity) => {
              const stage = String(opportunity.stage || 'lead').toLowerCase();
              return (
                <tr key={opportunity.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/35">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{opportunity.number || 'OP'}</td>
                  <td className="px-4 py-3">
                    <Link to={crmOpportunityPath(opportunity)} className="font-medium text-slate-700 hover:text-primary">
                      {opportunity.title || 'Bez názvu'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{opportunity.subject?.name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5', stageClasses[stage] || 'border-slate-200 bg-slate-50 text-slate-600')}>
                      {stageLabels[stage] || opportunity.stage || 'Aktivní'}
                    </span>
                  </td>
                  {canViewCompanyFinance && (
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">{formatCurrency(opportunity.value || 0)}</td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(opportunity.expected_close_date)}</td>
                  <td className="px-4 py-3 text-right text-slate-400"><MoreHorizontal className="h-4 w-4" /></td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={canViewCompanyFinance ? 7 : 6} className="px-4 py-8 text-center text-sm text-slate-500">Zatím nejsou dostupné obchodní případy.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

const UserFinancials = ({ memberId }) => {
  const { toast } = useToast();
  const { isPrivateMode } = useAuth();
  const [stats, setStats] = useState({ totalReward: 0, toPayOut: 0, available: 0, paid: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!memberId || isPrivateMode) {
      setLoading(false);
      return undefined;
    }

    const fetchUserFinancials = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_user_financials', { p_member_id: memberId });
        if (error) throw error;
        const result = data?.[0] || {};
        if (mounted) {
          setStats({
            totalReward: Math.round(result.total_reward || 0),
            toPayOut: Math.round((result.total_reward || 0) - (result.total_paid || 0)),
            available: Math.round(result.available_to_payout || 0),
            paid: Math.round(result.total_paid || 0),
          });
        }
      } catch (error) {
        if (mounted) toast({ title: 'Finance se nepodařilo načíst', description: error.message, variant: 'destructive' });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchUserFinancials();
    return () => { mounted = false; };
  }, [memberId, isPrivateMode, toast]);

  if (isPrivateMode) return null;
  if (loading) return <div className="h-28 rounded-md bg-slate-100 animate-pulse" />;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <DashboardMetric icon={Banknote} label="Dostupné k vyplacení" value={formatCurrency(stats.available)} tone="emerald" to="/payouts" />
      <DashboardMetric icon={CircleDollarSign} label="Zbývá k vyplacení" value={formatCurrency(stats.toPayOut)} tone="blue" to="/payouts" />
      <DashboardMetric icon={PiggyBank} label="Celkem vyplaceno" value={formatCurrency(stats.paid)} tone="slate" to="/payouts" />
    </div>
  );
};

const AdminFinancials = ({ companyFinance, approvals }) => {
  const { isPrivateMode } = useAuth();
  if (isPrivateMode) return null;

  const overheadDifference = companyFinance.overheadAllocated - companyFinance.overheadAccounted;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <DashboardMetric icon={CircleDollarSign} label="Realizovaný zisk" value={formatCurrency(companyFinance.realizedProfit)} tone="emerald" to="/reports" />
      <DashboardMetric icon={TrendingIcon} label="Potenciální zisk" value={formatCurrency(companyFinance.potentialProfit)} tone="blue" to="/reports" />
      <DashboardMetric icon={Briefcase} label="Hodnota projektů" value={formatCurrency(companyFinance.totalProjectValue)} tone="slate" to="/projects" />
      <DashboardMetric icon={FileText} label="Režie bilance" value={formatCurrency(overheadDifference)} tone={overheadDifference < 0 ? 'rose' : 'amber'} to="/overhead-costs" />
      <DashboardMetric icon={AlertTriangle} label="Ke schválení" value={approvals} detail="výplaty a docházka" tone={approvals > 0 ? 'rose' : 'emerald'} to="/payouts" />
    </div>
  );
};

const TrendingIcon = (props) => <BarChart3 {...props} />;

const Dashboard = () => {
  const { isSuperUser, memberId, isPrivateMode } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState('month');
  const [data, setData] = useState({
    userProjects: [],
    projects: [],
    realizations: [],
    tasks: [],
    engineering: [],
    payouts: [],
    attendanceSubmissions: [],
    opportunities: [],
    commercialDocuments: [],
    products: [],
    documents: [],
    companyFinance: emptyCompanyFinance,
  });

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const canViewCompanyFinance = isSuperUser && !isPrivateMode;
      const next = {
        userProjects: [],
        projects: [],
        realizations: [],
        tasks: [],
        engineering: [],
        payouts: [],
        attendanceSubmissions: [],
        opportunities: [],
        commercialDocuments: [],
        products: [],
        documents: [],
        companyFinance: canViewCompanyFinance ? data.companyFinance : emptyCompanyFinance,
      };

      const commonQueries = [
        supabase.from('payouts')
          .select(canViewCompanyFinance
            ? 'id, amount, status, request_date, member:members!payouts_member_id_fkey(name)'
            : 'id, status, request_date, member:members!payouts_member_id_fkey(name)'
          )
          .eq('status', 'pending')
          .order('request_date', { ascending: true })
          .limit(20),
        supabase.from('attendance_submissions').select('id, total_hours, status, month_date, member:members!attendance_submissions_member_id_fkey(name)').eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(20),
        supabase.from('crm_opportunities')
          .select(canViewCompanyFinance
            ? 'id, number, title, value, probability, stage, expected_close_date, created_at, subject:subject_id(name)'
            : 'id, number, title, stage, expected_close_date, created_at, subject:subject_id(name)'
          )
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('crm_commercial_documents')
          .select(canViewCompanyFinance
            ? 'id, type, status, title, number, total, valid_until, created_at'
            : 'id, type, status, title, number, valid_until, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('commercial_item_catalog').select('id, code, name, category, is_active').limit(500),
        supabase.from('documents').select('id, name, created_at').order('created_at', { ascending: false }).limit(50),
      ];

      const [
        payoutsRes,
        attendanceRes,
        opportunitiesRes,
        commercialDocumentsRes,
        productsRes,
        documentsRes,
      ] = await Promise.all(commonQueries);

      next.payouts = safeArray(payoutsRes);
      next.attendanceSubmissions = safeArray(attendanceRes);
      next.opportunities = safeArray(opportunitiesRes);
      next.commercialDocuments = safeArray(commercialDocumentsRes);
      next.products = safeArray(productsRes);
      next.documents = safeArray(documentsRes);

      if (memberId) {
        const [userProjectsRes, userTasksRes, userActivitiesRes, userRealizationsRes] = await Promise.all([
          supabase
            .from('projects')
            .select('id, name, code, status, start_date, completion_date, created_at')
            .order('created_at', { ascending: false })
            .limit(500),
          supabase.from('project_tasks').select('id, name, status, start_date, end_date, project:projects(name)').eq('member_id', memberId).order('end_date', { ascending: true }).limit(100),
          supabase.rpc('get_user_activities', { p_member_id: memberId }),
          supabase.from('realizations').select('id, name, status, start_date, planned_end_date, actual_end_date, created_at, team_members').contains('team_members', [memberId]).order('created_at', { ascending: false }).limit(100),
        ]);
        next.userProjects = safeArray(userProjectsRes);
        next.tasks = safeArray(userTasksRes);
        next.engineering = safeArray(userActivitiesRes);
        next.realizations = safeArray(userRealizationsRes);
      }

      if (canViewCompanyFinance) {
        const [
          projectsRes,
          realizationsRes,
          tasksRes,
          engineeringRes,
          companyFinanceRes,
          overheadRes,
        ] = await Promise.all([
          supabase.from('projects').select('id, name, code, status, start_date, completion_date, created_at, price').order('created_at', { ascending: false }).limit(500),
          supabase.from('realizations').select('id, name, status, start_date, planned_end_date, actual_end_date, created_at, contract_amount').order('created_at', { ascending: false }).limit(500),
          supabase.from('project_tasks').select('id, name, status, start_date, end_date, project:projects(name)').order('end_date', { ascending: true }).limit(200),
          supabase.from('engineering_activities').select('id, subject, status, project_id, end_date, projects(name)').neq('status', 'done').order('end_date', { ascending: true }).limit(12),
          supabase.rpc('get_company_financials'),
          supabase.rpc('get_overhead_summary'),
        ]);

        next.projects = safeArray(projectsRes);
        next.realizations = safeArray(realizationsRes);
        next.tasks = safeArray(tasksRes);
        next.engineering = safeArray(engineeringRes);

        const finance = safeArray(companyFinanceRes)[0] || {};
        const overhead = safeArray(overheadRes)[0] || {};
        next.companyFinance = {
          realizedProfit: Math.round(finance.realized_profit || 0),
          potentialProfit: Math.round(finance.potential_profit || 0),
          totalProjectValue: Math.round(finance.total_project_value || 0),
          unallocatedBudget: Math.round(finance.unallocated_budget || 0),
          overheadAllocated: Math.round(overhead.total_allocated_overhead || 0),
          overheadAccounted: Math.round(overhead.total_accounted_overhead || 0),
        };
      }

      setData(next);
    } catch (error) {
      toast({ title: 'Dashboard se nepodařilo načíst', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperUser, memberId, isPrivateMode]);

  const summary = useMemo(() => {
    const visibleProjects = isSuperUser ? data.projects : data.userProjects;
    const activeProjects = visibleProjects.filter((project) => isOpenStatus(project.status));
    const activeRealizations = data.realizations.filter((realization) => isOpenStatus(realization.status));
    const openTasks = data.tasks.filter((task) => isOpenStatus(task.status));
    const overdueTasks = openTasks.filter((task) => isOverdue(task.end_date));
    const activeEngineering = data.engineering.filter((item) => isOpenStatus(item.status));
    const overdueEngineering = activeEngineering.filter((item) => isOverdue(item.end_date));
    const openOpportunities = data.opportunities.filter((opportunity) => !['won', 'lost'].includes(String(opportunity.stage || '').toLowerCase()));
    const pipelineValue = openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const weightedPipeline = openOpportunities.reduce((sum, opportunity) => {
      const probability = Number(opportunity.probability ?? 0) / 100;
      return sum + Number(opportunity.value || 0) * probability;
    }, 0);
    const offers = data.commercialDocuments.filter((document) => document.type === 'offer');
    const orders = data.commercialDocuments.filter((document) => document.type === 'order');
    const offersValue = offers.reduce((sum, document) => sum + Number(document.total || 0), 0);
    const ordersValue = orders.reduce((sum, document) => sum + Number(document.total || 0), 0);
    const activeProjectsValue = activeProjects.reduce((sum, project) => sum + Number(project.price || 0), 0);
    const activeRealizationsValue = activeRealizations.reduce((sum, realization) => sum + Number(realization.contract_amount || 0), 0);
    const allRealizationsValue = data.realizations.reduce((sum, realization) => sum + Number(realization.contract_amount || 0), 0);
    const closedOpportunities = data.opportunities.filter((opportunity) => ['won', 'lost'].includes(String(opportunity.stage || '').toLowerCase()));
    const wonOpportunities = data.opportunities.filter((opportunity) => String(opportunity.stage || '').toLowerCase() === 'won');
    const wonValue = wonOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const pendingApprovals = data.payouts.length + data.attendanceSubmissions.length;
    const activeProducts = data.products.filter((product) => product.is_active !== false);

    return {
      visibleProjects,
      activeProjects,
      activeRealizations,
      openTasks,
      overdueTasks,
      activeEngineering,
      overdueEngineering,
      openOpportunities,
      pipelineValue,
      weightedPipeline,
      offers,
      orders,
      offersValue,
      ordersValue,
      activeProjectsValue,
      activeRealizationsValue,
      allRealizationsValue,
      closedOpportunities,
      wonOpportunities,
      wonValue,
      pendingApprovals,
      activeProducts,
    };
  }, [data, isSuperUser]);

  const attentionItems = useMemo(() => {
    const items = [];

    summary.overdueTasks.slice(0, 3).forEach((task) => {
      items.push({
        title: task.name,
        subtitle: task.project?.name || 'Úkol bez projektu',
        meta: formatDate(task.end_date),
        tone: 'rose',
        to: '/tasks',
      });
    });

    summary.overdueEngineering.slice(0, 3).forEach((activity) => {
      items.push({
        title: activity.subject,
        subtitle: activity.projects?.name || 'Inženýring',
        meta: formatDate(activity.end_date),
        tone: 'amber',
        to: '/engineering',
      });
    });

    data.payouts.slice(0, 2).forEach((payout) => {
      items.push({
        title: payout.member?.name || 'Žádost o výplatu',
        subtitle: isSuperUser && !isPrivateMode ? `Čeká na schválení: ${formatCurrency(payout.amount)}` : 'Čeká na schválení',
        meta: 'Výplata',
        tone: 'rose',
        to: '/payouts',
      });
    });

    data.attendanceSubmissions.slice(0, 2).forEach((attendance) => {
      items.push({
        title: attendance.member?.name || 'Docházka',
        subtitle: `${Number(attendance.total_hours || 0).toFixed(1)} h za ${formatDate(attendance.month_date)}`,
        meta: 'Docházka',
        tone: 'amber',
        to: '/attendance',
      });
    });

    summary.openOpportunities
      .filter((opportunity) => opportunity.expected_close_date)
      .sort((a, b) => new Date(a.expected_close_date) - new Date(b.expected_close_date))
      .slice(0, 2)
      .forEach((opportunity) => {
        items.push({
          title: opportunity.title || opportunity.number || 'Obchodní případ',
          subtitle: opportunity.subject?.name || 'CRM příležitost',
          meta: formatDate(opportunity.expected_close_date),
          tone: isOverdue(opportunity.expected_close_date) ? 'rose' : 'blue',
          to: '/crm',
        });
      });

    return items.slice(0, 8);
  }, [data.attendanceSubmissions, data.payouts, summary.openOpportunities, summary.overdueEngineering, summary.overdueTasks]);

  const stageSummary = useMemo(() => {
    const counts = summary.openOpportunities.reduce((acc, opportunity) => {
      const stage = String(opportunity.stage || 'lead').toLowerCase();
      acc[stage] = {
        stage,
        count: (acc[stage]?.count || 0) + 1,
        value: (acc[stage]?.value || 0) + Number(opportunity.value || 0),
      };
      return acc;
    }, {});

    return Object.values(counts).sort((a, b) => b.value - a.value);
  }, [summary.openOpportunities]);

  const topOpportunities = useMemo(
    () => [...summary.openOpportunities]
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      .slice(0, 10),
    [summary.openOpportunities],
  );

  const chartData = useMemo(() => {
    const canViewCompanyFinance = isSuperUser && !isPrivateMode;
    const pipelineTrend = [
      { name: 'CRM', pipeline: summary.pipelineValue, weighted: summary.weightedPipeline },
      { name: 'Nabídky', pipeline: summary.offersValue, weighted: summary.ordersValue },
      { name: 'Projekce', pipeline: summary.activeProjectsValue, weighted: data.companyFinance.potentialProfit },
      { name: 'Realizace', pipeline: summary.activeRealizationsValue, weighted: data.companyFinance.realizedProfit },
    ];

    const workload = [
      { name: 'Projekty', count: summary.activeProjects.length },
      { name: 'Realizace', count: summary.activeRealizations.length },
      { name: 'Úkoly', count: summary.openTasks.length },
      { name: 'Inženýring', count: summary.activeEngineering.length },
      { name: 'Schválení', count: summary.pendingApprovals },
    ];

    const stageCounts = stageSummary.map((item) => ({
      name: stageLabels[item.stage] || item.stage,
      count: item.count,
    }));

    const riskPenalty =
      Math.min(35, summary.overdueTasks.length * 5)
      + Math.min(20, summary.overdueEngineering.length * 5)
      + Math.min(20, summary.pendingApprovals * 3);
    const healthScore = Math.max(0, Math.min(100, 100 - riskPenalty));

    return { healthScore, pipelineTrend: canViewCompanyFinance ? pipelineTrend : [], stageCounts, workload };
  }, [data.companyFinance.potentialProfit, data.companyFinance.realizedProfit, isPrivateMode, isSuperUser, stageSummary, summary]);

  const canViewCompanyFinance = isSuperUser && !isPrivateMode;
  const moduleTiles = [
    {
      title: 'CRM',
      description: canViewCompanyFinance
        ? `${summary.openOpportunities.length} otevřených OP, váženě ${formatCurrency(summary.weightedPipeline)}`
        : `${summary.openOpportunities.length} otevřených OP`,
      icon: Target,
      to: '/crm',
      tone: 'blue',
    },
    {
      title: 'Projekce',
      description: `${summary.activeProjects.length} aktivních projektů`,
      icon: Briefcase,
      to: '/projects',
      tone: 'slate',
    },
    {
      title: 'Realizace',
      description: `${summary.activeRealizations.length} aktivních realizací`,
      icon: Wrench,
      to: '/realizace',
      tone: 'amber',
    },
    {
      title: 'Úkoly',
      description: `${summary.openTasks.length} otevřených, ${summary.overdueTasks.length} po termínu`,
      icon: ClipboardList,
      to: '/tasks',
      tone: summary.overdueTasks.length ? 'rose' : 'emerald',
    },
    {
      title: 'Nabídky',
      description: `${summary.offers.length} ${pluralizeCs(summary.offers.length, 'záznam', 'záznamy', 'záznamů')} v CRM`,
      icon: FileText,
      to: '/crm/offers',
      tone: 'blue',
    },
    {
      title: 'Objednávky',
      description: `${summary.orders.length} ${pluralizeCs(summary.orders.length, 'záznam', 'záznamy', 'záznamů')} v CRM`,
      icon: ShoppingCart,
      to: '/crm/orders',
      tone: 'emerald',
    },
    {
      title: 'Produkty',
      description: `${summary.activeProducts.length} aktivních položek`,
      icon: Package,
      to: '/products',
      tone: 'slate',
    },
    {
      title: 'Dokumenty',
      description: `${data.documents.length} posledních dokumentů v přehledu`,
      icon: FileText,
      to: '/documents',
      tone: 'slate',
    },
  ];

  if (loading) {
    return (
      <div className="app-page-wide space-y-5">
        <div className="h-20 rounded-md bg-slate-100 animate-pulse" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="h-28 rounded-md bg-slate-100 animate-pulse" />
          <div className="h-28 rounded-md bg-slate-100 animate-pulse" />
          <div className="h-28 rounded-md bg-slate-100 animate-pulse" />
          <div className="h-28 rounded-md bg-slate-100 animate-pulse" />
        </div>
        <div className="h-96 rounded-md bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="app-page-wide animate-in fade-in duration-500">
      <div className="space-y-5">
        <PageHeader
          icon={Home}
          title="Přehled portálu"
          description="Jedno místo pro obchod, projekci, realizace, finance, úkoly a provozní upozornění."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="px-3 py-1 text-sm font-normal">
                {new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
              </Badge>
              <Button variant="outline" onClick={fetchDashboardData} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Obnovit
              </Button>
            </div>
          }
        />

        {isPrivateMode && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Privátní mód je aktivní</p>
                <p className="mt-1 text-xs">Finanční data jsou skryta. Pro zobrazení financí vypněte privátní mód v uživatelském menu.</p>
              </div>
            </div>
          </div>
        )}

        <ExecutiveDashboard
          canViewCompanyFinance={canViewCompanyFinance}
          attentionItems={attentionItems}
          chartData={chartData}
          data={data}
          summary={summary}
        />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <DashboardMetric
            icon={Target}
            label={canViewCompanyFinance ? 'CRM pipeline' : 'CRM případy'}
            value={canViewCompanyFinance ? formatCurrency(summary.pipelineValue) : summary.openOpportunities.length}
            detail={canViewCompanyFinance ? `${summary.openOpportunities.length} otevřených OP` : 'otevřené obchodní případy'}
            tone="blue"
            to="/crm"
          />
          <DashboardMetric icon={Briefcase} label="Aktivní projekce" value={summary.activeProjects.length} detail={`${summary.visibleProjects.length} projektů celkem`} tone="slate" to="/projects" />
          <DashboardMetric icon={Wrench} label="Aktivní realizace" value={summary.activeRealizations.length} detail="stav realizací a harmonogram" tone="amber" to="/realizace" />
          <DashboardMetric icon={AlertTriangle} label="Vyžaduje pozornost" value={attentionItems.length} detail={`${summary.pendingApprovals} schválení, ${summary.overdueTasks.length} úkolů po termínu`} tone={attentionItems.length ? 'rose' : 'emerald'} />
          {canViewCompanyFinance && (
            <DashboardMetric icon={CircleDollarSign} label="Realizovaný zisk" value={formatCurrency(data.companyFinance.realizedProfit)} tone="emerald" to="/reports" />
          )}
          {canViewCompanyFinance && (
            <DashboardMetric icon={FileText} label="Režie bilance" value={formatCurrency(data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted)} tone={(data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted) < 0 ? 'rose' : 'amber'} to="/overhead-costs" />
          )}
        </div>

        {!isPrivateMode && !isSuperUser && (
          <div className="space-y-3">
            <UserFinancials memberId={memberId} />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(340px,0.8fr)]">
          <Card className="crm-panel">
            <CardHeader className="crm-panel-header">
              <SectionHeader
                icon={BarChart3}
                title={canViewCompanyFinance ? 'Pipeline podle stavu' : 'Obchodní případy podle stavu'}
                description={canViewCompanyFinance ? 'Hodnota otevřených obchodních případů.' : 'Počet otevřených obchodních případů bez částek.'}
              />
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {stageSummary.length > 0 ? (
                stageSummary.map((item) => {
                  const visibleValue = canViewCompanyFinance ? item.value : item.count;
                  const maxValue = Math.max(...stageSummary.map((stage) => (canViewCompanyFinance ? stage.value : stage.count)), 1);
                  const width = Math.max(8, Math.round((visibleValue / maxValue) * 100));
                  return (
                    <div key={item.stage} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-slate-700">{stageLabels[item.stage] || item.stage}</span>
                        <span className="whitespace-nowrap font-semibold text-slate-950">
                          {canViewCompanyFinance ? formatCurrency(item.value) : item.count}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100">
                        <div className="h-2.5 rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyBlock text="Pipeline zatím nemá aktivní obchodní případy." />
              )}
            </CardContent>
          </Card>

          <Card className="crm-panel">
            <CardHeader className="crm-panel-header">
              <SectionHeader
                icon={Activity}
                title="Rychlé přehledy"
                description="Vstupy do hlavních modulů portálu."
              />
            </CardHeader>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
              {moduleTiles.slice(0, 6).map((tile) => (
                <Link
                  key={tile.title}
                  to={tile.to}
                  className="group flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-primary/30 hover:bg-blue-50/30"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                      tile.tone === 'rose' && 'border-rose-100 bg-rose-50 text-rose-700',
                      tile.tone === 'amber' && 'border-amber-100 bg-amber-50 text-amber-700',
                      tile.tone === 'emerald' && 'border-emerald-100 bg-emerald-50 text-emerald-700',
                      tile.tone === 'blue' && 'border-blue-100 bg-blue-50 text-blue-700',
                      tile.tone === 'slate' && 'border-slate-200 bg-slate-50 text-slate-700',
                    )}>
                      <tile.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-950">{tile.title}</h3>
                      <p className="truncate text-xs text-slate-500">{tile.description}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="crm-panel">
            <CardHeader className="crm-panel-header">
              <SectionHeader
                icon={ClipboardList}
                title="Provozní přehled"
                description="Nejbližší práce a schvalování."
                action={<Button asChild variant="outline" size="sm"><Link to="/attendance">Docházka</Link></Button>}
              />
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <StatusLine icon={ClipboardList} label="Otevřené úkoly" value={summary.openTasks.length} tone={summary.overdueTasks.length ? 'amber' : 'blue'} />
              <StatusLine icon={AlertTriangle} label="Po termínu" value={summary.overdueTasks.length + summary.overdueEngineering.length} tone={(summary.overdueTasks.length + summary.overdueEngineering.length) ? 'rose' : 'emerald'} />
              <StatusLine icon={CheckCircle} label="Schválení" value={summary.pendingApprovals} tone={summary.pendingApprovals ? 'amber' : 'emerald'} />
              <StatusLine icon={FileText} label="Dokumenty" value={data.documents.length} tone="slate" />
              <Button asChild className="w-full justify-between" variant={summary.pendingApprovals ? 'default' : 'outline'}>
                <Link to="/payouts">
                  Otevřít schvalování
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <DashboardTable canViewCompanyFinance={canViewCompanyFinance} opportunities={topOpportunities} />

        <Tabs defaultValue="operations" className="space-y-5">
          <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="operations">Operativa</TabsTrigger>
            {!isPrivateMode && <TabsTrigger value="finance">Finance</TabsTrigger>}
            <TabsTrigger value="schedules">Harmonogramy</TabsTrigger>
          </TabsList>

          <TabsContent value="operations" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <SectionHeader
                    icon={Activity}
                    title="Stav projektů a úkolů"
                    description="Souhrnný stav práce v portálu."
                  />
                </CardHeader>
                <CardContent className="p-4">
                  <ProjectStatusChart projects={summary.visibleProjects} tasks={data.tasks} />
                </CardContent>
              </Card>

              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <SectionHeader
                    icon={Wrench}
                    title="Inženýring a provoz"
                    description="Aktivní činnosti a poslední blokery."
                    action={<Button asChild variant="outline" size="sm"><Link to="/engineering">Otevřít</Link></Button>}
                  />
                </CardHeader>
                <CardContent className="space-y-2 p-4">
                  {summary.activeEngineering.length > 0 ? (
                    summary.activeEngineering.slice(0, 6).map((activity) => (
                      <WorkItem
                        key={activity.id}
                        title={activity.subject}
                        subtitle={activity.projects?.name || 'Bez projektu'}
                        meta={getActivityStatusConfig(activity.status).label}
                        tone={isOverdue(activity.end_date) ? 'rose' : 'blue'}
                        to="/engineering"
                      />
                    ))
                  ) : (
                    <EmptyBlock text="Žádné aktivní inženýrské činnosti." />
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.65fr)]">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <SectionHeader
                    icon={Users}
                    title="Portálový stav"
                    description="Rozložení projektů a úkolů podle stavů."
                  />
                </CardHeader>
                <CardContent className="p-4">
                  <PortalStatusChart />
                </CardContent>
              </Card>

              <PendingApprovalsWidget />
            </div>
          </TabsContent>

          {!isPrivateMode && (
            <TabsContent value="finance" className="space-y-5">
              {isSuperUser ? (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.65fr)]">
                  <Card className="crm-panel">
                    <CardHeader className="crm-panel-header">
                      <SectionHeader
                        icon={CircleDollarSign}
                        title="Finanční souhrn firmy"
                        description="Zisk, režie a obchodní pipeline na jednom místě."
                      />
                    </CardHeader>
                    <CardContent className="space-y-4 p-4">
                      <AdminFinancials companyFinance={data.companyFinance} approvals={summary.pendingApprovals} />
                      <div className="grid gap-3 md:grid-cols-3">
                        <DashboardMetric icon={Target} label="Pipeline celkem" value={formatCurrency(summary.pipelineValue)} detail="otevřené obchodní případy" tone="blue" to="/crm" />
                        <DashboardMetric icon={BarChart3} label="Vážená pipeline" value={formatCurrency(summary.weightedPipeline)} detail="hodnota dle pravděpodobnosti" tone="emerald" to="/crm" />
                        <DashboardMetric icon={ShoppingCart} label="Nabídky / objednávky" value={`${summary.offers.length} / ${summary.orders.length}`} detail="CRM dokumenty" tone="slate" to="/crm/offers" />
                      </div>
                    </CardContent>
                  </Card>
                  <PendingApprovalsWidget />
                </div>
              ) : (
                <Card className="crm-panel">
                  <CardHeader className="crm-panel-header">
                    <SectionHeader icon={Banknote} title="Moje finance" description="Osobní přehled výplat." />
                  </CardHeader>
                  <CardContent className="p-4">
                    <UserFinancials memberId={memberId} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          <TabsContent value="schedules" className="space-y-5">
            <div className="grid gap-5">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <SectionHeader
                    icon={GanttChartSquare}
                    title="Harmonogram projektů"
                    description="Časová osa projekční práce."
                  />
                </CardHeader>
                <CardContent className="p-4">
                  <ProjectGanttChart projects={summary.visibleProjects} zoom={zoom} onZoomChange={setZoom} />
                </CardContent>
              </Card>

              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <SectionHeader
                    icon={CalendarClock}
                    title="Harmonogram realizací"
                    description="Aktivní realizace a jejich plánované termíny."
                  />
                </CardHeader>
                <CardContent className="p-4">
                  <RealizationGanttChart realizations={data.realizations} zoom={zoom} onZoomChange={setZoom} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
