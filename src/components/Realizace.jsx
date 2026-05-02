import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat, Plus, Search, LayoutGrid, List, Edit2, Trash2, RefreshCw, Columns, ChevronDown, Loader2, Activity, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const statusConfig = {
    'Připravuje se': { variant: 'info', label: 'Připravuje se' },
    'Probíhá': { variant: 'warning', label: 'Probíhá' },
    'Pozastaveno': { variant: 'destructive', label: 'Pozastaveno' },
    'Dokončeno': { variant: 'success', label: 'Dokončeno' },
    'Předáno': { variant: 'default', label: 'Předáno' },
    'waiting_for_approval': { variant: 'secondary', label: 'Čeká na schválení' }
};

const formatDateShort = (date) => date ? format(new Date(date), 'd.M.yyyy') : 'Neuvedeno';

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
    const { hasPermission, memberId, isSuperUser, userRole } = useAuth();
    const statusOrder = useMemo(() => Object.keys(statusConfig), []);
    
    const { canViewAmounts } = getFinancialVisibility(userRole);

    // Restricted access for 'user' role
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';
    const canDelete = hasPermission('realizace', 'can_admin') && userRole !== 'user';

    const fetchRealizations = useCallback(async () => {
        setLoading(true);
        let query = supabase.from('realizations').select(`
      id, name, status, type, start_date, team_members,
      contract_amount, expected_total_cost, actual_costs, budget,
      investor:investor_id (id, name),
      lead_person:lead_person_id (id, name)
    `).order('created_at', { ascending: false });

        if (!isSuperUser && memberId) {
            query = query.or(`lead_person_id.eq.${memberId},team_members.cs.{${memberId}}`);
        }

        const { data, error } = await query;

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
    }, [toast, isSuperUser, memberId]);

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
        const searchMatch = debouncedSearchTerm === '' ||
            r.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            r.investor?.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
            r.type?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());

        const statusMatch = statusFilter === 'all' || r.status === statusFilter;
        return searchMatch && statusMatch;
    });

    const stats = {
        total: realizations.length,
        running: realizations.filter(r => r.status === 'Probíhá').length,
        value: realizations.reduce((acc, r) => acc + (Number(r.contract_amount) || 0), 0)
    };

    return (
        <div className="space-y-6 container mx-auto px-4 py-8 max-w-7xl">
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Celkem realizací</p>
                            <p className="text-2xl font-bold">{stats.total}</p>
                        </div>
                        <div className="p-3 bg-slate-100 rounded-full">
                            <HardHat className="w-6 h-6 text-slate-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Probíhající</p>
                            <p className="text-2xl font-bold text-blue-600">{stats.running}</p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-full">
                            <Activity className="w-6 h-6 text-blue-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Hodnota zakázek</p>
                            <p className="text-2xl font-bold text-green-600">
                                <FinancialValueGuard value={formatCurrency(stats.value)} />
                            </p>
                        </div>
                        <div className="p-3 bg-green-50 rounded-full">
                            <DollarSign className="w-6 h-6 text-green-600" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-lg border shadow-sm sticky top-0 z-10">
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
                        <Button variant={viewMode === 'table' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className="h-7 w-7 p-0 shadow-sm"><List className="w-4 h-4" /></Button>
                        <Button variant={viewMode === 'grid' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('grid')} className="h-7 w-7 p-0 shadow-sm"><LayoutGrid className="w-4 h-4" /></Button>
                        <Button variant={viewMode === 'kanban' ? 'white' : 'ghost'} size="sm" onClick={() => setViewMode('kanban')} className="h-7 w-7 p-0 shadow-sm"><Columns className="w-4 h-4" /></Button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Načítání dat...</div>
            ) : viewMode === 'table' ? (
                <div className="rounded-md border bg-white">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název</TableHead>
                                <TableHead>Investor</TableHead>
                                <TableHead>Typ</TableHead>
                                <TableHead>Stav</TableHead>
                                <TableHead>Start</TableHead>
                                <TableHead>Vedoucí</TableHead>
                                {canViewAmounts && <TableHead className="text-right">Smlouva</TableHead>}
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRealizations.length === 0 ? (
                                <TableRow><TableCell colSpan={canViewAmounts ? 8 : 7} className="text-center py-8 text-muted-foreground">Žádné realizace nenalezeny</TableCell></TableRow>
                            ) : (
                                filteredRealizations.map(r => {
                                    return (
                                        <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/realizace/${r.id}`)}>
                                            <TableCell className="font-medium truncate max-w-[280px]" title={r.name}>{r.name}</TableCell>
                                            <TableCell>{r.investor?.name || '-'}</TableCell>
                                            <TableCell>{r.type || '-'}</TableCell>
                                            <TableCell>{renderStatusMenu(r)}</TableCell>
                                            <TableCell>{formatDateShort(r.start_date)}</TableCell>
                                            <TableCell>{r.lead_person?.name || '-'}</TableCell>
                                            {canViewAmounts && (
                                                <TableCell className="text-right font-medium">
                                                    <FinancialValueGuard value={formatCurrency(r.contract_amount)} />
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                                                    {canEdit && (
                                                        <Button variant="ghost" size="icon" onClick={() => navigate(`/realizace/${r.id}/edit`)}>
                                                            <Edit2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                    {canDelete && (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600">
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
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
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
