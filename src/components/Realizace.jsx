import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat, Plus, Search, LayoutGrid, List, Edit2, Trash2, RefreshCw, Columns, ChevronDown, Loader2, Activity, DollarSign, AlertTriangle, BarChart3, CalendarClock, CheckCircle, CircleDollarSign, PieChart as PieChartIcon } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ManagedTableSection, ManagedTableToolbar, useManagedColumns } from '@/components/ui/managed-table';
import { MemoBadge } from '@/components/ui/memo-badge';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PageHeader from '@/components/ui/page-header';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useDebouncedValue } from '@/hooks/useDebounce';
import { cn, formatCurrency } from '@/lib/utils';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';
import {
    buildRealizationProjectionChartData,
    calculateRealizationProjectionStats,
} from '@/domain/realizationProjections';

const statusConfig = {
    'Připravuje se': { variant: 'info', label: 'Připravuje se' },
    'Probíhá': { variant: 'warning', label: 'Probíhá' },
    'Pozastaveno': { variant: 'destructive', label: 'Pozastaveno' },
    'Dokončeno': { variant: 'success', label: 'Dokončeno' },
    'Předáno': { variant: 'default', label: 'Předáno' },
    'waiting_for_approval': { variant: 'secondary', label: 'Čeká na schválení' }
};

const formatDateShort = (date) => date ? format(new Date(date), 'd.M.yyyy') : 'Neuvedeno';

const chartPalette = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#64748b', '#8b5cf6'];

const formatChartAxisValue = (value, money) => {
    if (!money) return value;
    const amount = Number(value) || 0;
    if (Math.abs(amount) >= 1000000) return `${Number((amount / 1000000).toFixed(1))} mil.`;
    if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)} tis.`;
    return amount;
};

const formatStatusAxisLabel = (label) => {
    const labels = {
        'Připravuje se': 'Příprava',
        'Čeká na schválení': 'Čeká',
        'Pozastaveno': 'Pauza',
    };
    return labels[label] || label;
};

const RealizationMetric = ({ icon: Icon, label, value, detail, tone = 'slate', guarded = false }) => {
    const tones = {
        blue: 'border-blue-100 bg-blue-50 text-blue-700',
        emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-100 bg-amber-50 text-amber-700',
        rose: 'border-rose-100 bg-rose-50 text-rose-700',
        slate: 'border-slate-200 bg-slate-50 text-slate-700',
    };

    return (
        <Card className="h-full rounded-xl border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex h-full flex-col justify-between gap-4 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                        <div className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-950">
                            {guarded ? <FinancialValueGuard value={value} /> : value}
                        </div>
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

const ChartTooltip = ({ active, payload, label, guarded = false }) => {
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
                        <span className="font-semibold tabular-nums text-slate-950">
                            {guarded ? <FinancialValueGuard value={formatCurrency(item.value)} /> : item.value}
                        </span>
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

const ValueByStatusChart = ({ data, canViewAmounts }) => (
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
                    hide={!canViewAmounts}
                    width={canViewAmounts ? 62 : 0}
                    tickFormatter={(value) => formatChartAxisValue(value, canViewAmounts)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                />
                <Tooltip content={<ChartTooltip guarded={canViewAmounts} />} />
                <Bar dataKey="value" name={canViewAmounts ? 'Hodnota' : 'Počet'} radius={[8, 8, 0, 0]}>
                    {data.map((item) => <Cell key={item.status} fill={item.fill} />)}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    </div>
);

const RealizationHealth = ({ score }) => {
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
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">zdraví</div>
            </div>
        </div>
    );
};

const RealizationExecutiveDashboard = ({ canViewAmounts, chartData, stats }) => (
    <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <RealizationMetric icon={HardHat} label="Celkem realizací" value={stats.total} detail={`${stats.active} aktivních zakázek`} tone="slate" />
            <RealizationMetric icon={Activity} label="Probíhající" value={stats.running} detail={`${stats.paused} pozastaveno`} tone="blue" />
            <RealizationMetric icon={CalendarClock} label="Čeká / připravuje se" value={stats.pendingOrPreparing} detail="zásobník práce pro tým" tone="amber" />
            <RealizationMetric icon={CircleDollarSign} label="Hodnota zakázek" value={formatCurrency(stats.value)} detail="součet smluvních částek" tone="emerald" guarded />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-200 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <BarChart3 className="h-4 w-4 text-primary" />
                                {canViewAmounts ? 'Hodnota podle stavu' : 'Počet podle stavu'}
                            </CardTitle>
                            <p className="mt-1 text-sm text-slate-500">{canViewAmounts ? 'Finanční objem realizací rozdělený podle workflow.' : 'Rozložení realizací podle workflow bez finančních částek.'}</p>
                        </div>
                        {!canViewAmounts && <MemoBadge variant="secondary">Skryto</MemoBadge>}
                    </div>
                </CardHeader>
                <CardContent className="p-5">
                    <ValueByStatusChart data={chartData.statusValue} canViewAmounts={canViewAmounts} />
                </CardContent>
            </Card>

            <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-200 px-5 py-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <PieChartIcon className="h-4 w-4 text-primary" />
                        Rozložení stavů
                    </CardTitle>
                    <p className="mt-1 text-sm text-slate-500">Kolik realizací je v jednotlivých fázích.</p>
                </CardHeader>
                <CardContent className="p-5">
                    <StatusDonut data={chartData.statusCounts} />
                </CardContent>
            </Card>

            <Card className="rounded-xl border-slate-200 bg-white shadow-sm xl:col-span-2">
                <CardContent className="grid gap-5 p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                        <RealizationHealth score={chartData.healthScore} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                                <AlertTriangle className="h-4 w-4" />
                                Pozastaveno
                            </div>
                            <div className="mt-2 text-3xl font-bold text-red-950">{stats.paused}</div>
                            <p className="mt-1 text-sm text-red-700">zakázky potřebují rozhodnutí</p>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                                <CalendarClock className="h-4 w-4" />
                                Příprava
                            </div>
                            <div className="mt-2 text-3xl font-bold text-amber-950">{stats.preparing}</div>
                            <p className="mt-1 text-sm text-amber-700">před spuštěním realizace</p>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                                <CheckCircle className="h-4 w-4" />
                                Uzavřeno
                            </div>
                            <div className="mt-2 text-3xl font-bold text-emerald-950">{stats.closed}</div>
                            <p className="mt-1 text-sm text-emerald-700">dokončeno nebo předáno</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
);

const Realizace = () => {
    const [realizations, setRealizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchValue, setSearchValue] = useState('');
    const debouncedSearchTerm = useDebouncedValue(searchValue, 300);
    const [statusFilter, setStatusFilter] = useState('all');
    const [viewMode, setViewMode] = useState('kanban');
    const [updatingRealizationId, setUpdatingRealizationId] = useState(null);
    const [draggingRealizationId, setDraggingRealizationId] = useState(null);
    const [dragOverStatusKey, setDragOverStatusKey] = useState(null);
    const { toast } = useToast();
    const navigate = useNavigate();
    const { hasPermission, userRole } = useAuth();
    const statusOrder = useMemo(() => Object.keys(statusConfig), []);
    
    const { canViewAmounts } = getFinancialVisibility(userRole);

    // Restricted access for 'user' role
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';
    const canDelete = hasPermission('realizace', 'can_admin') && userRole !== 'user';
    const realizationTableColumns = useMemo(() => [
        { id: 'name', label: 'Název', hideable: false },
        { id: 'investor', label: 'Investor' },
        { id: 'type', label: 'Typ' },
        { id: 'status', label: 'Stav' },
        { id: 'start', label: 'Start' },
        { id: 'lead', label: 'Vedoucí' },
        canViewAmounts && { id: 'contract', label: 'Smlouva' },
        { id: 'actions', label: 'Akce', hideable: false },
    ].filter(Boolean), [canViewAmounts]);
    const realizationManagedTable = useManagedColumns('ekv-table-realizace', realizationTableColumns);
    const realizationVisibleColumns = realizationManagedTable.visibleColumns;
    const realizationHeadClasses = {
        name: 'min-w-[280px]',
        investor: 'min-w-[220px]',
        type: 'min-w-[140px]',
        status: 'min-w-[160px]',
        start: 'min-w-[120px]',
        lead: 'min-w-[180px]',
        contract: 'min-w-[140px] text-right',
        actions: 'w-24 text-right',
    };
    const realizationCellClasses = {
        name: 'max-w-[280px] truncate font-medium',
        contract: 'text-right font-medium',
        actions: 'text-right',
    };

    const fetchRealizations = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('list_realizations_safe');

        if (error) {
            toast({
                title: 'Chyba při načítání realizací',
                description: error.message,
                variant: 'destructive'
            });
        } else {
            setRealizations(data || []);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchRealizations();
    }, [fetchRealizations]);

    const updateRealizationStatus = useCallback(async (realizationId, nextStatus) => {
        if (updatingRealizationId) return;
        setUpdatingRealizationId(realizationId);
        try {
            const { error } = await supabase
                .from('realizations')
                .update({ status: nextStatus })
                .eq('id', realizationId);

            if (error) throw error;

            setRealizations((prev) => prev.map((item) => (
                item.id === realizationId ? { ...item, status: nextStatus } : item
            )));

            toast({
                title: 'Stav realizace aktualizován',
                description: statusConfig[nextStatus]?.label || nextStatus,
            });
        } catch (error) {
            toast({ title: 'Chyba změny stavu', description: error.message, variant: 'destructive' });
        } finally {
            setUpdatingRealizationId(null);
        }
    }, [toast, updatingRealizationId]);

    const renderStatusMenu = (realization, triggerClassName) => {
        const status = statusConfig[realization.status] || { label: realization.status, variant: 'default' };
        if (!canEdit) {
            return (
                <MemoBadge
                    variant={status.variant}
                    className="max-w-[160px] truncate text-xs"
                    title={status.label}
                >
                    {status.label}
                </MemoBadge>
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
                        title={status.label}
                    >
                        <MemoBadge
                            variant={status.variant}
                            className="max-w-[160px] truncate text-xs"
                            title={status.label}
                        >
                            {status.label}
                        </MemoBadge>
                        {updatingRealizationId === realization.id ? (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        ) : (
                            <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {Object.entries(statusConfig).map(([key, conf]) => (
                        <DropdownMenuItem
                            key={key}
                            disabled={updatingRealizationId === realization.id || realization.status === key}
                            onClick={(event) => {
                                event.stopPropagation();
                                updateRealizationStatus(realization.id, key);
                            }}
                            title={conf.label}
                        >
                            {conf.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    const renderRealizationTableCell = (r, columnId) => {
        switch (columnId) {
            case 'name':
                return r.name;
            case 'investor':
                return r.investor?.name || '-';
            case 'type':
                return r.type || '-';
            case 'status':
                return renderStatusMenu(r);
            case 'start':
                return formatDateShort(r.start_date);
            case 'lead':
                return r.lead_person?.name || '-';
            case 'contract':
                return <FinancialValueGuard value={formatCurrency(r.contract_amount)} />;
            case 'actions':
                return (
                    <div className="flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                        {canEdit && (
                            <Button variant="ghost" size="icon" onClick={() => navigate(`/realizace/${r.id}/edit`)} aria-label={`Upravit realizaci ${r.name || r.code || r.id}`}>
                                <Edit2 className="w-4 h-4" />
                            </Button>
                        )}
                        {canDelete && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" aria-label={`Smazat realizaci ${r.name || r.code || r.id}`}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Smazat realizaci?</AlertDialogTitle>
                                        <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDelete(r.id)} className="bg-destructive">Smazat</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>
                );
            default:
                return null;
        }
    };

    const handleDragStart = (event, realizationId) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', realizationId);
        setDraggingRealizationId(realizationId);
    };

    const handleDragEnd = () => {
        setDraggingRealizationId(null);
    };

    const handleDelete = useCallback(async (id) => {
        const { error } = await supabase.from('realizations').delete().eq('id', id);
        if (error) {
            toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Realizace smazána' });
            fetchRealizations();
        }
    }, [fetchRealizations, toast]);

    const filteredRealizations = realizations.filter(r => {
        const q = debouncedSearchTerm.toLowerCase();
        const searchMatch = debouncedSearchTerm === '' ||
            (r.name || '').toLowerCase().includes(q) ||
            (r.investor?.name || '').toLowerCase().includes(q) ||
            (r.type || '').toLowerCase().includes(q);

        const statusMatch = statusFilter === 'all' || r.status === statusFilter;
        return searchMatch && statusMatch;
    });

    const stats = useMemo(() => calculateRealizationProjectionStats(realizations), [realizations]);

    const chartData = useMemo(() => buildRealizationProjectionChartData({
        realizations,
        stats,
        statusConfig,
        statusOrder,
        palette: chartPalette,
        canViewAmounts,
    }), [canViewAmounts, realizations, stats, statusOrder]);

    return (
        <div className="app-page">
            <PageHeader
                icon={HardHat}
                title="Realizace"
                description="Správa stavebních zakázek a projektů"
                actions={
                    <>
                    <Button variant="outline" onClick={fetchRealizations}><RefreshCw className="w-4 h-4 mr-2" /> Aktualizovat</Button>
                    {canEdit && (
                        <Button onClick={() => navigate('/realizace/new')}><Plus className="w-4 h-4 mr-2" /> Nová realizace</Button>
                    )}
                    </>
                }
            />

            <RealizationExecutiveDashboard canViewAmounts={canViewAmounts} chartData={chartData} stats={stats} />

            <div className="app-surface sticky top-0 z-10 flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 flex-1 w-full md:w-auto">
                    <div className="relative flex-1 md:max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Hledat..."
                            className="pl-9"
                            value={searchValue}
                            onChange={e => setSearchValue(e.target.value)}
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[200px]"><SelectValue placeholder="Stav" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Všechny stavy</SelectItem>
                            {Object.entries(statusConfig).map(([key, conf]) => (
                                <SelectItem key={key} value={key}>{conf.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                    <div className="border rounded-lg p-1 flex items-center bg-slate-50">
                        <Button variant={viewMode === 'table' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className="h-7 w-7 p-0 shadow-sm" aria-label="Zobrazit realizace jako tabulku"><List className="w-4 h-4" /></Button>
                        <Button variant={viewMode === 'grid' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className="h-7 w-7 p-0 shadow-sm" aria-label="Zobrazit realizace jako karty"><LayoutGrid className="w-4 h-4" /></Button>
                        <Button variant={viewMode === 'kanban' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('kanban')} className="h-7 w-7 p-0 shadow-sm" aria-label="Zobrazit realizace jako kanban"><Columns className="w-4 h-4" /></Button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Načítání dat...</div>
            ) : viewMode === 'table' ? (
                <ManagedTableSection
                    title="Realizace"
                    count={filteredRealizations.length}
                    toolbar={(
                        <ManagedTableToolbar
                            className="text-slate-700"
                            columns={realizationManagedTable.columns}
                            visibility={realizationManagedTable.visibility}
                            onMoveColumn={realizationManagedTable.moveColumn}
                            onToggleColumn={realizationManagedTable.toggleColumn}
                            onReset={realizationManagedTable.resetColumns}
                        />
                    )}
                >
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                {realizationVisibleColumns.map((column) => (
                                    <TableHead key={column.id} className={realizationHeadClasses[column.id]}>{column.label}</TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRealizations.length === 0 ? (
                                <TableRow><TableCell colSpan={realizationVisibleColumns.length} className="text-center py-8 text-muted-foreground">Žádné realizace nenalezeny</TableCell></TableRow>
                            ) : (
                                filteredRealizations.map(r => (
                                    <TableRow key={r.id} className="cursor-pointer bg-white hover:bg-blue-50/35" onClick={() => navigate(`/realizace/${r.id}`)}>
                                        {realizationVisibleColumns.map((column) => (
                                            <TableCell key={column.id} className={realizationCellClasses[column.id]} title={column.id === 'name' ? r.name : undefined}>
                                                {renderRealizationTableCell(r, column.id)}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </ManagedTableSection>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredRealizations.map(r => {
                        return (
                            <Card key={r.id} className="cursor-pointer hover:shadow-md transition-all duration-200 group border-l-4" onClick={() => navigate(`/realizace/${r.id}`)}>
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start gap-2 min-w-0">
                                        <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors" title={r.name}>{r.name}</CardTitle>
                                        <div className="shrink-0">{renderStatusMenu(r, "h-6 px-1")}</div>
                                    </div>
                                    <div className="text-sm text-muted-foreground">{r.type || 'Typ neuveden'}</div>
                                </CardHeader>
                                <CardContent className="text-sm space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Investor:</span>
                                        <span className="font-medium truncate max-w-[160px]" title={r.investor?.name || '-'}>{r.investor?.name || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Vedoucí:</span>
                                        <span className="font-medium truncate max-w-[160px]" title={r.lead_person?.name || '-'}>{r.lead_person?.name || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Zahájení:</span>
                                        <span>{formatDateShort(r.start_date)}</span>
                                    </div>
                                    {canViewAmounts && (
                                        <div className="flex justify-between pt-2 border-t mt-2">
                                            <span className="text-muted-foreground">Smlouva:</span>
                                            <span className="font-bold"><FinancialValueGuard value={formatCurrency(r.contract_amount)} /></span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {statusOrder.map((statusKey) => {
                        const columnItems = filteredRealizations.filter((item) => item.status === statusKey);
                        const status = statusConfig[statusKey] || { label: statusKey, variant: 'default' };
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
                                    const realizationId = event.dataTransfer.getData('text/plain');
                                    if (!realizationId) return;
                                    const target = realizations.find((item) => item.id === realizationId);
                                    if (!target || target.status === statusKey) return;
                                    updateRealizationStatus(realizationId, statusKey);
                                }}
                                onDragLeave={() => {
                                    if (!canEdit) return;
                                    setDragOverStatusKey((current) => (current === statusKey ? null : current));
                                }}
                            >
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <MemoBadge
                                            variant={status.variant}
                                            className="max-w-[160px] truncate text-xs"
                                            title={status.label}
                                        >
                                            {status.label}
                                        </MemoBadge>
                                        <span className="text-xs text-muted-foreground">{columnItems.length}</span>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {columnItems.length > 0 ? (
                                        columnItems.map((item) => (
                                            <div
                                                key={item.id}
                                                className={cn(
                                                    "bg-white border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer min-w-0",
                                                    draggingRealizationId === item.id && "opacity-60"
                                                )}
                                                onClick={() => navigate(`/realizace/${item.id}`)}
                                                draggable={canEdit}
                                                onDragStart={(event) => {
                                                    if (!canEdit) return;
                                                    handleDragStart(event, item.id);
                                                }}
                                                onDragEnd={handleDragEnd}
                                            >
                                                <div className="flex items-start justify-between gap-2 min-w-0">
                                                    <div className="min-w-0">
                                                        <div className="text-xs text-muted-foreground">{item.type || 'Typ neuveden'}</div>
                                                        <div className="font-medium line-clamp-2" title={item.name}>{item.name}</div>
                                                    </div>
                                                    <div className="shrink-0">
                                                        {renderStatusMenu(item, "h-6 px-1")}
                                                    </div>
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1 truncate" title={item.investor?.name || '-'}>
                                                    {item.investor?.name || '-'}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate" title={item.lead_person?.name || '-'}>
                                                    Vedoucí: {item.lead_person?.name || '-'}
                                                </div>
                                                <div className="flex justify-between items-center mt-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        Zahájení: {formatDateShort(item.start_date)}
                                                    </span>
                                                    {canViewAmounts && (
                                                        <span className="text-xs font-bold text-slate-700">
                                                            <FinancialValueGuard value={formatCurrency(item.contract_amount)} />
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-xs text-muted-foreground">Žádné realizace</div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Realizace;
