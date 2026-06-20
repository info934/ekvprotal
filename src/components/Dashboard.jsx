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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PortalStatusChart from '@/components/PortalStatusChart';
import ProjectStatusChart from '@/components/ProjectStatusChart';
import ProjectGanttChart from '@/components/ProjectGanttChart';
import RealizationGanttChart from '@/components/RealizationGanttChart';
import { PendingApprovalsWidget } from '@/components/DashboardWidgets';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { crmOpportunityPath } from '@/lib/crmRoutes';
import { cn, formatCurrency } from '@/lib/utils';
import { DataVizMetricCard } from '@/components/ui/data-viz';

const today = new Date();
today.setHours(0, 0, 0, 0);

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
  const content = <DataVizMetricCard icon={Icon} label={label} value={value} detail={detail} tone={tone} />;
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

const DashboardTable = ({ opportunities }) => (
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
              <th className="px-4 py-3 text-right font-semibold">Konečná cena</th>
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
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">{formatCurrency(opportunity.value || 0)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(opportunity.expected_close_date)}</td>
                  <td className="px-4 py-3 text-right text-slate-400"><MoreHorizontal className="h-4 w-4" /></td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Zatím nejsou dostupné obchodní případy.</td>
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

const FinancialModuleSection = ({ title, description, metrics }) => (
  <Card className="crm-panel">
    <CardHeader className="crm-panel-header">
      <SectionHeader icon={CircleDollarSign} title={title} description={description} />
    </CardHeader>
    <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <DashboardMetric key={metric.label} {...metric} />
      ))}
    </CardContent>
  </Card>
);

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
    companyFinance: {
      realizedProfit: 0,
      potentialProfit: 0,
      totalProjectValue: 0,
      unallocatedBudget: 0,
      overheadAllocated: 0,
      overheadAccounted: 0,
    },
  });

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
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
        companyFinance: data.companyFinance,
      };

      const commonQueries = [
        supabase.from('payouts').select('id, amount, status, request_date, member:members!payouts_member_id_fkey(name)').eq('status', 'pending').order('request_date', { ascending: true }).limit(20),
        supabase.from('attendance_submissions').select('id, total_hours, status, month_date, member:members!attendance_submissions_member_id_fkey(name)').eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(20),
        supabase.from('crm_opportunities').select('id, number, title, value, probability, stage, expected_close_date, created_at, subject:subject_id(name)').order('created_at', { ascending: false }).limit(100),
        supabase.from('crm_commercial_documents').select('id, type, status, title, number, total, valid_until, created_at').order('created_at', { ascending: false }).limit(100),
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
          supabase.rpc('get_user_projects', { p_member_id: memberId }),
          supabase.from('project_tasks').select('id, name, status, start_date, end_date, project:projects(name)').eq('member_id', memberId).order('end_date', { ascending: true }).limit(100),
          supabase.rpc('get_user_activities', { p_member_id: memberId }),
          supabase.from('realizations').select('id, name, status, start_date, planned_end_date, actual_end_date, created_at, team_members').contains('team_members', [memberId]).order('created_at', { ascending: false }).limit(100),
        ]);
        next.userProjects = safeArray(userProjectsRes);
        next.tasks = safeArray(userTasksRes);
        next.engineering = safeArray(userActivitiesRes);
        next.realizations = safeArray(userRealizationsRes);
      }

      if (isSuperUser) {
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
  }, [isSuperUser, memberId]);

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
        subtitle: `Čeká na schválení: ${formatCurrency(payout.amount)}`,
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

  const moduleTiles = [
    {
      title: 'CRM',
      description: `${summary.openOpportunities.length} otevřených OP, váženě ${formatCurrency(summary.weightedPipeline)}`,
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
      description: `${summary.offers.length} záznamů v CRM`,
      icon: FileText,
      to: '/crm/offers',
      tone: 'blue',
    },
    {
      title: 'Objednávky',
      description: `${summary.orders.length} záznamů v CRM`,
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

  const financialSections = [
    {
      title: 'CRM finance',
      description: 'Obchodní pipeline, nabídky a objednávky.',
      metrics: [
        { icon: Target, label: 'Pipeline otevřených OP', value: formatCurrency(summary.pipelineValue), detail: `${summary.openOpportunities.length} otevřených obchodních případů`, tone: 'blue', to: '/crm' },
        { icon: BarChart3, label: 'Vážená pipeline', value: formatCurrency(summary.weightedPipeline), detail: 'hodnota podle pravděpodobnosti', tone: 'emerald', to: '/crm' },
        { icon: FileText, label: 'Nabídky celkem', value: formatCurrency(summary.offersValue), detail: `${summary.offers.length} nabídek`, tone: 'slate', to: '/crm/offers' },
        { icon: ShoppingCart, label: 'Objednávky celkem', value: formatCurrency(summary.ordersValue), detail: `${summary.orders.length} objednávek`, tone: 'amber', to: '/crm/orders' },
      ],
    },
    {
      title: 'Projekce finance',
      description: 'Hodnota projekčních zakázek a aktivní rozpracovanost.',
      metrics: [
        { icon: Briefcase, label: 'Hodnota projektů', value: formatCurrency(data.companyFinance.totalProjectValue || summary.activeProjectsValue), detail: `${summary.visibleProjects.length} projektů celkem`, tone: 'slate', to: '/projects' },
        { icon: Activity, label: 'Aktivní projekce', value: formatCurrency(summary.activeProjectsValue), detail: `${summary.activeProjects.length} aktivních projektů`, tone: 'blue', to: '/projects' },
        { icon: CircleDollarSign, label: 'Potenciální zisk', value: formatCurrency(data.companyFinance.potentialProfit), detail: 'výhled podle projektů', tone: 'emerald', to: '/reports' },
        { icon: AlertTriangle, label: 'Úkoly po termínu', value: summary.overdueTasks.length, detail: `${summary.openTasks.length} otevřených úkolů`, tone: summary.overdueTasks.length ? 'rose' : 'emerald', to: '/tasks' },
      ],
    },
    {
      title: 'Realizace finance',
      description: 'Smluvní objem realizací, skutečný zisk a provozní bilance.',
      metrics: [
        { icon: Wrench, label: 'Aktivní realizace', value: formatCurrency(summary.activeRealizationsValue), detail: `${summary.activeRealizations.length} aktivních realizací`, tone: 'amber', to: '/realizace' },
        { icon: CircleDollarSign, label: 'Realizovaný zisk', value: formatCurrency(data.companyFinance.realizedProfit), detail: 'výsledek z realizací', tone: 'emerald', to: '/reports' },
        { icon: Banknote, label: 'Objem realizací', value: formatCurrency(summary.allRealizationsValue), detail: `${data.realizations.length} realizací celkem`, tone: 'slate', to: '/realizace' },
        { icon: PiggyBank, label: 'Režie bilance', value: formatCurrency(data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted), detail: 'alokováno minus zaúčtováno', tone: (data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted) < 0 ? 'rose' : 'amber', to: '/overhead-costs' },
      ],
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <DashboardMetric icon={Target} label="CRM pipeline" value={formatCurrency(summary.pipelineValue)} detail={`${summary.openOpportunities.length} otevřených OP`} tone="blue" to="/crm" />
          <DashboardMetric icon={Briefcase} label="Aktivní projekce" value={summary.activeProjects.length} detail={`${summary.visibleProjects.length} projektů celkem`} tone="slate" to="/projects" />
          <DashboardMetric icon={Wrench} label="Aktivní realizace" value={summary.activeRealizations.length} detail="stav realizací a harmonogram" tone="amber" to="/realizace" />
          <DashboardMetric icon={AlertTriangle} label="Vyžaduje pozornost" value={attentionItems.length} detail={`${summary.pendingApprovals} schválení, ${summary.overdueTasks.length} úkolů po termínu`} tone={attentionItems.length ? 'rose' : 'emerald'} />
          {!isPrivateMode && isSuperUser && (
            <DashboardMetric icon={CircleDollarSign} label="Realizovaný zisk" value={formatCurrency(data.companyFinance.realizedProfit)} tone="emerald" to="/reports" />
          )}
          {!isPrivateMode && isSuperUser && (
            <DashboardMetric icon={FileText} label="Režie bilance" value={formatCurrency(data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted)} tone={(data.companyFinance.overheadAllocated - data.companyFinance.overheadAccounted) < 0 ? 'rose' : 'amber'} to="/overhead-costs" />
          )}
        </div>

        {!isPrivateMode && !isSuperUser && (
          <div className="space-y-3">
            <UserFinancials memberId={memberId} />
          </div>
        )}

        {!isPrivateMode && isSuperUser && (
          <div className="grid gap-5">
            {financialSections.map((section) => (
              <FinancialModuleSection key={section.title} {...section} />
            ))}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(340px,0.75fr)]">
          <Card className="crm-panel">
            <CardHeader className="crm-panel-header">
              <SectionHeader
                icon={BarChart3}
                title="Pipeline podle stavu"
                description="Hodnota otevřených obchodních případů."
              />
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              {stageSummary.length > 0 ? (
                stageSummary.map((item) => {
                  const maxValue = Math.max(...stageSummary.map((stage) => stage.value), 1);
                  const width = Math.max(8, Math.round((item.value / maxValue) * 100));
                  return (
                    <div key={item.stage} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-slate-700">{stageLabels[item.stage] || item.stage}</span>
                        <span className="whitespace-nowrap font-semibold text-slate-950">{formatCurrency(item.value)}</span>
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
                icon={Timer}
                title="Co řešit teď"
                description="Termíny, schválení a obchodní případy, které mohou blokovat další práci."
                action={<Button asChild variant="outline" size="sm"><Link to="/tasks">Všechny úkoly</Link></Button>}
              />
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {attentionItems.length > 0 ? (
                attentionItems.map((item, index) => <WorkItem key={`${item.title}-${index}`} {...item} />)
              ) : (
                <EmptyBlock text="Aktuálně není nic kritického k řešení." />
              )}
            </CardContent>
          </Card>
        </div>

        <DashboardTable opportunities={topOpportunities} />

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
                        meta={activity.status || 'aktivní'}
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
