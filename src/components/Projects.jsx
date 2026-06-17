// Updating to include safer deletion logic
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderPlus, Search, SlidersHorizontal, ArrowUpDown, ChevronDown,
  ChevronUp, LayoutGrid, List as ListIcon, Loader2, X, Building as BuildingIcon, DollarSign, Activity, Columns, CopyPlus,
  AlertTriangle, BarChart3, CheckCircle, CircleDollarSign, PieChart as PieChartIcon, Target
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ManagedTableSection, ManagedTableToolbar, useManagedColumns } from '@/components/ui/managed-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { formatCurrency, cn, projectStatusConfig } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { parseApiError } from '@/lib/apiValidation';
import BatchProjectDialog from '@/components/BatchProjectDialog';
import {
  buildProjectProjectionChartData,
  calculateProjectProjectionStats,
  getEmptyProjectProjectionStats,
} from '@/domain/projectProjections';

const chartPalette = ['#64748b', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6'];

const formatChartAxisValue = (value, money) => {
  if (!money) return value;
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `${Number((amount / 1000000).toFixed(1))} mil.`;
  if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)} tis.`;
  return amount;
};

const formatStatusAxisLabel = (label) => {
  if (label === 'Připraveno k dodání') return 'K dodání';
  return label;
};

const ProjectMetric = ({ icon: Icon, label, value, detail, tone = 'slate' }) => {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    violet: 'border-violet-100 bg-violet-50 text-violet-700',
  };

  return (
    <Card className="h-full rounded-xl border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex h-full flex-col justify-between gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <div className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-950">{value}</div>
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', tones[tone] || tones.slate)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {detail && <p className="text-sm text-slate-500">{detail}</p>}
      </CardContent>
    </Card>
  );
};

const ChartTooltip = ({ active, payload, label, money = false }) => {
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
            <span className="font-semibold tabular-nums text-slate-950">{money ? formatCurrency(item.value) : item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatusDonut = ({ data }) => (
  <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie data={data} dataKey="count" nameKey="label" innerRadius={48} outerRadius={76} paddingAngle={3}>
            {data.map((item) => <Cell key={item.status} fill={item.fill} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
    <div className="space-y-2 self-center">
      {data.map((item) => (
        <div key={item.status} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
            <span className="truncate font-medium text-slate-700">{item.label}</span>
          </span>
          <span className="font-semibold tabular-nums text-slate-950">{item.count}</span>
        </div>
      ))}
    </div>
  </div>
);

const ValueByStatusChart = ({ data, showFinance }) => (
  <div className="h-56">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          interval={0}
          tickFormatter={formatStatusAxisLabel}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: '#64748b' }}
        />
        <YAxis
          hide={!showFinance}
          width={showFinance ? 62 : 0}
          tickFormatter={(value) => formatChartAxisValue(value, showFinance)}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip content={<ChartTooltip money={showFinance} />} />
        <Bar dataKey="value" name={showFinance ? 'Hodnota' : 'Počet'} radius={[8, 8, 0, 0]}>
          {data.map((item) => <Cell key={item.status} fill={item.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

const ProjectionCompletion = ({ score }) => {
  const fill = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative h-48">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="96%" data={[{ value: score, fill }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={12} background={{ fill: '#e2e8f0' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold tracking-tight text-slate-950">{score}%</div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">uzavřenost</div>
      </div>
    </div>
  );
};

const ProjectionExecutiveDashboard = ({ chartData, showFinance, showReward, stats, totalReward }) => (
  <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ProjectMetric icon={FolderPlus} label="Celkem projektů" value={stats.total} detail={`${stats.open} otevřených projektů`} tone="slate" />
      <ProjectMetric icon={Activity} label="Aktivní" value={stats.active} detail={`${stats.ready} připraveno k dodání`} tone="blue" />
      <ProjectMetric icon={Target} label="Nabídky" value={stats.offers} detail="rozpracované nabídky a poptávky" tone="amber" />
      {showFinance ? (
        <ProjectMetric icon={CircleDollarSign} label="Hodnota projekce" value={formatCurrency(stats.value)} detail="součet cen projektů" tone="emerald" />
      ) : showReward ? (
        <ProjectMetric icon={DollarSign} label="Moje odměna" value={formatCurrency(totalReward)} detail="odměny z přiřazených projektů" tone="emerald" />
      ) : (
        <ProjectMetric icon={CircleDollarSign} label="Finance" value="Skryto" detail="soukromý režim nebo bez oprávnění" tone="slate" />
      )}
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-primary" />
                {showFinance ? 'Hodnota podle stavu' : 'Počet podle stavu'}
              </CardTitle>
              <p className="mt-1 text-sm text-slate-500">{showFinance ? 'Finanční objem projektů rozdělený podle workflow.' : 'Rozložení projektů podle workflow bez finančních částek.'}</p>
            </div>
            {!showFinance && <Badge variant="outline">Bez částek</Badge>}
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <ValueByStatusChart data={chartData.statusValue} showFinance={showFinance} />
        </CardContent>
      </Card>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChartIcon className="h-4 w-4 text-primary" />
            Rozložení stavů
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">Kolik projektů je v jednotlivých fázích projekce.</p>
        </CardHeader>
        <CardContent className="p-5">
          <StatusDonut data={chartData.statusCounts} />
        </CardContent>
      </Card>

      <Card className="rounded-xl border-slate-200 bg-white shadow-sm xl:col-span-2">
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <ProjectionCompletion score={chartData.completionScore} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Připraveno k dodání
              </div>
              <div className="mt-2 text-3xl font-bold text-amber-950">{stats.ready}</div>
              <p className="mt-1 text-sm text-amber-700">projekty čekají na expedici</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                <Activity className="h-4 w-4" />
                Aktivní práce
              </div>
              <div className="mt-2 text-3xl font-bold text-blue-950">{stats.active}</div>
              <p className="mt-1 text-sm text-blue-700">projekty jsou v řešení</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle className="h-4 w-4" />
                Dokončeno
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-950">{stats.closed}</div>
              <p className="mt-1 text-sm text-emerald-700">dodáno nebo uzavřeno</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

const Projects = () => {
  const navigate = useNavigate();
  const { user, isPrivateMode, hasPermission, memberId } = useAuth();
  const { toast } = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [projectStats, setProjectStats] = useState(getEmptyProjectProjectionStats);
  const [memberRewards, setMemberRewards] = useState({});
  const [totalReward, setTotalReward] = useState(0);
  const [updatingProjectId, setUpdatingProjectId] = useState(null);
  const [draggingProjectId, setDraggingProjectId] = useState(null);
  const [dragOverStatusKey, setDragOverStatusKey] = useState(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  
  const statusOrder = useMemo(() => Object.keys(projectStatusConfig), []);

  const canEdit = hasPermission('projects', 'can_edit');
  const canViewFinance = hasPermission('finance', 'can_read');
  const showFinance = canViewFinance && !isPrivateMode;
  const showReward = !isPrivateMode && !canViewFinance;
  const projectTableColumns = useMemo(() => [
    { id: 'code', label: 'Kód', hideable: false },
    { id: 'name', label: 'Název' },
    { id: 'investor', label: 'Investor' },
    { id: 'status', label: 'Stav' },
    showFinance && { id: 'price', label: 'Cena' },
    showReward && { id: 'reward', label: 'Odměna' },
    { id: 'actions', label: 'Akce', hideable: false },
  ].filter(Boolean), [showFinance, showReward]);
  const projectManagedTable = useManagedColumns('ekv-table-projects', projectTableColumns);
  const projectVisibleColumns = projectManagedTable.visibleColumns;
  const projectHeadClasses = {
    code: 'w-24',
    name: 'min-w-[260px]',
    investor: 'min-w-[220px]',
    status: 'min-w-[160px]',
    price: 'min-w-[140px] text-right',
    reward: 'min-w-[140px] text-right',
    actions: 'w-12 text-right',
  };
  const projectCellClasses = {
    code: 'font-mono text-xs text-muted-foreground',
    name: 'max-w-[280px] truncate font-medium',
    investor: 'text-muted-foreground',
    price: 'text-right font-mono',
    reward: 'text-right font-mono',
    actions: 'text-right text-muted-foreground',
  };
  const renderProjectTableCell = (project, columnId) => {
    switch (columnId) {
      case 'code':
        return project.code;
      case 'name':
        return project.name;
      case 'investor':
        return project.investor?.name || '-';
      case 'status':
        return renderStatusMenu(project);
      case 'price':
        return formatCurrency(project.price);
      case 'reward':
        return getRewardDisplay(project.id) || '-';
      case 'actions':
        return <ChevronDown className="ml-auto h-4 w-4 -rotate-90 opacity-0 group-hover:opacity-100" />;
      default:
        return null;
    }
  };

  const fetchMemberRewards = useCallback(async () => {
    if (!memberId || !showReward) {
      setMemberRewards({});
      setTotalReward(0);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_member_project_rewards', {
        p_member_id: memberId,
      });

      if (error) throw error;

      const rewardsByProject = {};
      let rewardTotal = 0;

      (data || []).forEach((assignment) => {
        const hasReward = assignment.reward_type === 'fixed' || assignment.reward_type === 'percentage';
        const isHourly = !!assignment.is_hourly && !hasReward;
        const rewardAmount = hasReward ? Number(assignment.total_reward || 0) : 0;

        if (hasReward || isHourly) {
          rewardsByProject[assignment.project_id] = {
            amount: rewardAmount,
            hasReward,
            isHourly,
          };
        }

        if (hasReward && rewardAmount > 0) {
          rewardTotal += rewardAmount;
        }
      });

      setMemberRewards(rewardsByProject);
      setTotalReward(rewardTotal);
    } catch (error) {
      console.error('Error fetching member rewards:', error);
      toast({ title: 'Chyba načítání odměn', description: error.message, variant: 'destructive' });
      setMemberRewards({});
      setTotalReward(0);
    }
  }, [memberId, showReward, toast]);

  const getRewardDisplay = useCallback((projectId) => {
    const reward = memberRewards[projectId];
    if (!reward) return null;
    if (reward.isHourly && !reward.hasReward) return 'Hodinová';
    if (reward.hasReward) return formatCurrency(reward.amount);
    return null;
  }, [memberRewards]);

  const updateProjectStatus = useCallback(async (projectId, nextStatus) => {
    if (updatingProjectId) return;
    setUpdatingProjectId(projectId);
    try {
      // Updated: Ensure we use 'id'
      const { error } = await supabase
        .from('projects')
        .update({ status: nextStatus })
        .eq('id', projectId);

      if (error) throw error;

      setProjects((prev) => {
        const nextProjects = prev.map((project) =>
          project.id === projectId ? { ...project, status: nextStatus } : project
        );
        setProjectStats(calculateProjectProjectionStats(nextProjects));
        return nextProjects;
      });

      toast({
        title: 'Stav projektu aktualizován',
        description: projectStatusConfig[nextStatus]?.label || nextStatus,
      });
    } catch (error) {
      const msg = parseApiError(error);
      toast({ title: 'Chyba změny stavu', description: msg, variant: 'destructive' });
    } finally {
      setUpdatingProjectId(null);
    }
  }, [toast, updatingProjectId]);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*, investor:investor_id(name), client:client_id(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setProjects(data || []);
      setProjectStats(calculateProjectProjectionStats(data || []));
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast({ title: 'Chyba načítání projektů', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchMemberRewards();
  }, [fetchMemberRewards]);

  const filteredProjects = useMemo(() => {
    let result = [...projects];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        (p.investor?.name || '').toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter(p => p.status === statusFilter);
    }

    result.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (aVal === null) aVal = '';
      if (bVal === null) bVal = '';

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [projects, searchQuery, statusFilter, sortConfig]);

  const chartData = useMemo(() => buildProjectProjectionChartData({
    projects,
    projectStats,
    projectStatusConfig,
    statusOrder,
    palette: chartPalette,
    showFinance,
  }), [projects, projectStats, showFinance, statusOrder]);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const renderStatusMenu = (project, triggerClassName) => {
    const label = projectStatusConfig[project.status]?.label || project.status;
    if (!canEdit) {
      return (
        <Badge
          className={cn("font-normal max-w-[160px] truncate text-xs", projectStatusConfig[project.status]?.color)}
          title={label}
        >
          {label}
        </Badge>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 px-2 gap-1", triggerClassName)}
            onClick={(event) => event.stopPropagation()}
            title={label}
          >
            <Badge
              className={cn("font-normal max-w-[160px] truncate text-xs", projectStatusConfig[project.status]?.color)}
              title={label}
            >
              {label}
            </Badge>
            {updatingProjectId === project.id ? (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {Object.entries(projectStatusConfig).map(([key, conf]) => (
            <DropdownMenuItem
              key={key}
              disabled={updatingProjectId === project.id || project.status === key}
              onClick={(event) => {
                event.stopPropagation();
                updateProjectStatus(project.id, key);
              }}
              title={conf.label}
            >
              <span className={cn("w-2 h-2 rounded-full mr-2", conf.color.split(' ')[0])} />
              {conf.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const handleDragStart = (event, projectId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', projectId);
    setDraggingProjectId(projectId);
  };

  const handleDragEnd = () => {
    setDraggingProjectId(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Načítání projektů...</p>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        icon={FolderPlus}
        title="Projekty"
        description="Správa projektové dokumentace a zakázek"
        actions={canEdit && (
          <>
            <Button onClick={() => setBatchDialogOpen(true)} variant="outline">
              <CopyPlus className="w-4 h-4 mr-2" />
              Dávka projektů
            </Button>
            <Button onClick={() => navigate('/projects/new')}>
              <FolderPlus className="w-4 h-4 mr-2" />
              Nový projekt
            </Button>
          </>
        )}
      />
      
      <BatchProjectDialog 
        open={batchDialogOpen} 
        onOpenChange={setBatchDialogOpen} 
        onProjectsCreated={fetchProjects} 
      />

      {!isPrivateMode && (
        <ProjectionExecutiveDashboard
          chartData={chartData}
          showFinance={showFinance}
          showReward={showReward}
          stats={projectStats}
          totalReward={totalReward}
        />
      )}

      {/* Filters & Controls */}
      <div className="app-surface sticky top-0 z-10 flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 flex-1 w-full md:w-auto">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Hledat projekt, investora..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className={statusFilter !== 'all' ? 'border-primary text-primary' : ''} aria-label="Filtrovat projekty podle stavu">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filtrovat stav</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={statusFilter === 'all'} onCheckedChange={() => setStatusFilter('all')}>
                Všechny
              </DropdownMenuCheckboxItem>
              {Object.entries(projectStatusConfig).map(([key, conf]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={statusFilter === key}
                  onCheckedChange={() => setStatusFilter(key)}
                >
                  <span className={cn("w-2 h-2 rounded-full mr-2", conf.color.split(' ')[0].replace('bg-', 'bg-'))} />
                  {conf.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {(searchQuery || statusFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
              <X className="w-4 h-4 mr-1" /> Reset
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <Select value={sortConfig.key} onValueChange={handleSort}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Řazení" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Nejnovejší</SelectItem>
              <SelectItem value="name">Název A-Z</SelectItem>
              <SelectItem value="code">Kód projektu</SelectItem>
              {showFinance && <SelectItem value="price">Cena</SelectItem>}
            </SelectContent>
          </Select>

          <div className="border rounded-lg p-1 flex items-center bg-slate-50">
            <Button
              variant={viewMode === 'grid' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'grid' && "bg-white")}
              onClick={() => setViewMode('grid')}
              aria-label="Zobrazit projekty jako karty"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'list' && "bg-white")}
              onClick={() => setViewMode('list')}
              aria-label="Zobrazit projekty jako seznam"
            >
              <ListIcon className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'kanban' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'kanban' && "bg-white")}
              onClick={() => setViewMode('kanban')}
              aria-label="Zobrazit projekty jako kanban"
            >
              <Columns className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-lg border border-dashed">
          <p className="text-muted-foreground">Nebyly nalezeny žádné projekty odpovídající filtrům.</p>
          <Button variant="link" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
            Vymazat filtry
          </Button>
        </div>
      ) : (
        <AnimatePresence mode='wait'>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => {
                const rewardDisplay = getRewardDisplay(project.id);
                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ProjectCard
                      project={project}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      showFinance={showFinance}
                      showReward={showReward}
                      rewardDisplay={rewardDisplay}
                    />
                  </motion.div>
                );
              })}
            </div>
          ) : viewMode === 'list' ? (
            <ManagedTableSection
              title="Projekce"
              count={filteredProjects.length}
              toolbar={(
                <ManagedTableToolbar
                  className="text-slate-700"
                  columns={projectManagedTable.columns}
                  visibility={projectManagedTable.visibility}
                  onMoveColumn={projectManagedTable.moveColumn}
                  onToggleColumn={projectManagedTable.toggleColumn}
                  onReset={projectManagedTable.resetColumns}
                />
              )}
            >
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    {projectVisibleColumns.map((column) => (
                      <TableHead key={column.id} className={projectHeadClasses[column.id]}>{column.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow
                      key={project.id}
                      className="group cursor-pointer bg-white hover:bg-blue-50/35"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      {projectVisibleColumns.map((column) => (
                        <TableCell key={column.id} className={projectCellClasses[column.id]} title={column.id === 'name' ? project.name : undefined}>
                          {renderProjectTableCell(project, column.id)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ManagedTableSection>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {statusOrder.map((statusKey) => {
                const columnProjects = filteredProjects.filter((project) => project.status === statusKey);
                const statusConfig = projectStatusConfig[statusKey];
                return (
                  <Card
                    key={statusKey}
                    className={cn(
                      "bg-slate-50 border-dashed transition-colors",
                      dragOverStatusKey === statusKey && "border-primary bg-primary/5"
                    )}
                    onDragOver={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      if (dragOverStatusKey !== statusKey) {
                        setDragOverStatusKey(statusKey);
                      }
                    }}
                    onDrop={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      setDragOverStatusKey(null);
                      const projectId = event.dataTransfer.getData('text/plain');
                      if (!projectId) return;
                      const targetProject = projects.find((project) => project.id === projectId);
                      if (!targetProject || targetProject.status === statusKey) return;
                      updateProjectStatus(projectId, statusKey);
                    }}
                    onDragLeave={() => {
                      if (!canEdit) return;
                      setDragOverStatusKey((current) => (current === statusKey ? null : current));
                    }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <Badge
                          className={cn("font-normal max-w-[160px] truncate text-xs", statusConfig?.color)}
                          title={statusConfig?.label || statusKey}
                        >
                          {statusConfig?.label || statusKey}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{columnProjects.length}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {columnProjects.length > 0 ? (
                        columnProjects.map((project) => {
                          const rewardDisplay = getRewardDisplay(project.id);
                          return (
                            <div
                              key={project.id}
                              className={cn(
                                "bg-white border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer min-w-0",
                                draggingProjectId === project.id && "opacity-60"
                              )}
                              onClick={() => navigate(`/projects/${project.id}`)}
                              draggable={canEdit}
                              onDragStart={(event) => {
                                if (!canEdit) return;
                                handleDragStart(event, project.id);
                              }}
                              onDragEnd={handleDragEnd}
                            >
                              <div className="flex items-start justify-between gap-2 min-w-0">
                                <div className="min-w-0">
                                  <div className="text-xs font-mono text-muted-foreground">{project.code}</div>
                                  <div className="font-medium line-clamp-2" title={project.name}>{project.name}</div>
                                </div>
                                <div className="shrink-0">
                                  {renderStatusMenu(project, "h-6 px-1")}
                                </div>
                              </div>
                              {project.investor?.name && (
                                <div className="text-xs text-muted-foreground truncate mt-1" title={project.investor.name}>
                                  {project.investor.name}
                                </div>
                              )}
                              {showFinance && project.price > 0 && (
                                <div className="text-xs font-semibold text-slate-700 mt-2">
                                  {formatCurrency(project.price)}
                                </div>
                              )}
                              {showReward && rewardDisplay && (
                                <div className="text-xs font-semibold text-slate-700 mt-2">
                                  {rewardDisplay}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-xs text-muted-foreground">Žádné projekty</div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

const ProjectCard = ({ project, onClick, showFinance, showReward, rewardDisplay }) => {
  return (
    <Card className="cursor-pointer hover:shadow-md transition-all duration-200 group border-l-4" style={{ borderLeftColor: project.status === 'active' ? '#3b82f6' : 'transparent' }} onClick={onClick}>
      <CardHeader className="p-4 pb-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1">{project.code}</p>
            <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors" title={project.name}>
              {project.name}
            </CardTitle>
          </div>
          <Badge
            className={cn("shrink-0 max-w-full truncate text-xs", projectStatusConfig[project.status]?.color)}
            title={projectStatusConfig[project.status]?.label || project.status}
          >
            {projectStatusConfig[project.status]?.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="space-y-2 text-sm text-slate-600">
          {project.investor?.name && (
            <div className="flex items-center gap-2">
              <BuildingIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate">{project.investor.name}</span>
            </div>
          )}
          {showFinance && project.price > 0 && (
            <div className="flex items-center gap-2 font-medium text-slate-900 mt-3 pt-3 border-t">
              <DollarSign className="w-3.5 h-3.5 text-green-600" />
              <span>{formatCurrency(project.price)}</span>
            </div>
          )}
          {showReward && rewardDisplay && (
            <div className="flex items-center gap-2 font-medium text-slate-900 mt-3 pt-3 border-t">
              <DollarSign className="w-3.5 h-3.5 text-green-600" />
              <span>{rewardDisplay}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default Projects;
