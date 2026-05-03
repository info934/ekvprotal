import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
    FilePieChart,
    Plus,
    Search,
    Filter,
    Trash2,
    Edit2,
    MoreHorizontal,
    ChevronLeft,
    ChevronRight,
    Copy,
    Calendar,
    Tag,
    RefreshCw,
    BarChart,
    List,
    FileText,
    Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import OverheadCostForm from '@/components/OverheadCostForm';
import MonthlyAllocation from '@/components/MonthlyAllocation';
import PageHeader from '@/components/ui/page-header';

const formatCurrency = (value = 0) =>
    new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value || 0);

const StatsCard = ({ title, value, description, icon: Icon, tone = 'blue' }) => {
    const toneClass = {
        blue: 'text-blue-700 bg-blue-50 ring-blue-100',
        emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
        amber: 'text-amber-700 bg-amber-50 ring-amber-100',
        violet: 'text-violet-700 bg-violet-50 ring-violet-100',
    }[tone] || 'text-blue-700 bg-blue-50 ring-blue-100';

    return (
        <Card className="group overflow-hidden">
            <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>
                    <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-950">{formatCurrency(value)}</p>
                    {description && <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>}
                </div>
                {Icon && (
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ring-1 ${toneClass}`}>
                        <Icon className="h-5 w-5" />
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const CostTypeBadge = ({ type }) => (
    <Badge
        variant={type === 'PRAVIDELNY' ? 'info' : 'warning'}
        className="whitespace-nowrap"
    >
        {type === 'PRAVIDELNY' ? 'Pravidelné' : 'Proměnlivé'}
    </Badge>
);

const PreviewList = ({ title, description, items, empty, dateFormatter }) => (
    <Card className="overflow-hidden">
        <CardHeader className="border-b bg-slate-50/70 pb-4">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="p-3">
            {items.length ? (
                <ul className="space-y-2">
                    {items.map((item) => (
                        <li key={item.id} className="rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm">
                            <div className="flex min-w-0 items-center justify-between gap-3">
                                <span className="truncate font-medium text-slate-950">{item.name}</span>
                                <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(item.amount)}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{dateFormatter(item)}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="flex min-h-[132px] items-center justify-center rounded-lg border border-dashed bg-white/70 p-4 text-center text-sm text-muted-foreground">
                    {empty}
                </div>
            )}
        </CardContent>
    </Card>
);

const MonthlyCategoryBreakdown = ({ categories, total }) => (
    <Card className="overflow-hidden">
        <CardHeader className="border-b bg-slate-50/70 pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <CardTitle className="text-base">Rozpad aktuálního měsíce</CardTitle>
                    <CardDescription>Největší kategorie podle částky</CardDescription>
                </div>
                <Badge variant="secondary">{categories.length} kategorií</Badge>
            </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4 sm:p-5">
            {categories.length ? (
                categories.slice(0, 6).map(({ category, amount }) => {
                    const percentage = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
                    return (
                        <div key={category} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="truncate font-medium text-slate-800">{category}</span>
                                <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(amount)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed bg-white/70 p-6 text-center text-sm text-muted-foreground">
                    V tomto měsíci zatím nejsou zaznamenané žádné režie.
                </div>
            )}
        </CardContent>
    </Card>
);

const OverheadCostsList = () => {
    const { toast } = useToast();
    const [costs, setCosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingCost, setEditingCost] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ type: 'all', category: 'all' });
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const [deleteId, setDeleteId] = useState(null);

    const fetchCosts = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('overhead_costs').select('*').order('created_at', { ascending: false });

        if (error) {
            toast({ title: 'Chyba při načítání nákladů', description: error.message, variant: 'destructive' });
        } else {
            setCosts(data);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchCosts();
    }, []);

    const handleSave = async (costData) => {
        const { error } =
            editingCost && editingCost.id
                ? await supabase.from('overhead_costs').update(costData).eq('id', editingCost.id)
                : await supabase.from('overhead_costs').insert([costData]);

        if (error) {
            toast({ title: 'Chyba při ukládání nákladu', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: '✅ Náklad úspěšně uložen' });
            fetchCosts();
            setIsFormOpen(false);
            setEditingCost(null);
        }
    };

    const handleDelete = async (id) => {
        const { error } = await supabase.from('overhead_costs').delete().eq('id', id);
        if (error) {
            toast({
                title: 'Chyba při mazání nákladu',
                description: 'Tento náklad je pravděpodobně použit v měsíčním vyúčtování. Smažte nejprve vyúčtování.',
                variant: 'destructive',
            });
        } else {
            toast({ title: '🗑️ Náklad smazán' });
            fetchCosts();
        }
        setDeleteId(null);
    };

    const handleEdit = (cost) => {
        setEditingCost(cost);
        setIsFormOpen(true);
    };

    const handleCopy = (cost) => {
        const { id, created_at, updated_at, ...rest } = cost;
        setEditingCost({ ...rest, name: `${cost.name} (kopie)` });
        setIsFormOpen(true);
    };

    const handleNewCost = () => {
        setEditingCost(null);
        setIsFormOpen(true);
    };

    const uniqueCategories = useMemo(() => {
        const categories = new Set(costs.map((c) => c.category).filter(Boolean));
        return ['all', ...Array.from(categories)];
    }, [costs]);

    const monthStart = useMemo(() => startOfMonth(new Date()), []);
    const monthEnd = useMemo(() => endOfMonth(new Date()), []);
    const monthLabel = useMemo(
        () => new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(monthStart),
        [monthStart],
    );

    const stats = useMemo(() => {
        const totals = {
            total: 0,
            regular: 0,
            variable: 0,
            regularCount: 0,
            variableCount: 0,
            monthlyTotal: 0,
        };
        const categoryMap = {};

        costs.forEach((cost) => {
            const amount = Number(cost.amount) || 0;
            totals.total += amount;

            const isRegular = cost.type === 'PRAVIDELNY';
            if (isRegular) {
                totals.regular += amount;
                totals.regularCount += 1;
            } else {
                totals.variable += amount;
                totals.variableCount += 1;
            }

            const includeRegular =
                isRegular &&
                cost.valid_from &&
                cost.valid_to &&
                new Date(cost.valid_from) <= monthEnd &&
                new Date(cost.valid_to) >= monthStart;

            const includeVariable =
                !isRegular &&
                cost.date_incurred &&
                new Date(cost.date_incurred) >= monthStart &&
                new Date(cost.date_incurred) <= monthEnd;

            if (includeRegular || includeVariable) {
                totals.monthlyTotal += amount;
                const category = cost.category || 'Bez kategorie';
                categoryMap[category] = (categoryMap[category] || 0) + amount;
            }
        });

        const monthlyCategories = Object.entries(categoryMap)
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);

        return { ...totals, monthlyCategories };
    }, [costs, monthEnd, monthStart]);

    const regularPreview = useMemo(
        () => costs.filter((cost) => cost.type === 'PRAVIDELNY').slice(0, 5),
        [costs],
    );
    const variablePreview = useMemo(
        () => costs.filter((cost) => cost.type === 'PROMENLIVY').slice(0, 5),
        [costs],
    );

    const filteredCosts = useMemo(() => {
        return costs.filter((cost) => {
            const searchMatch =
                searchTerm === '' ||
                cost.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (cost.description && cost.description.toLowerCase().includes(searchTerm.toLowerCase()));
            const typeMatch = filters.type === 'all' || cost.type === filters.type;
            const categoryMatch = filters.category === 'all' || cost.category === filters.category;
            return searchMatch && typeMatch && categoryMatch;
        });
    }, [costs, searchTerm, filters]);

    const hasActiveFilters = searchTerm.trim() !== '' || filters.type !== 'all' || filters.category !== 'all';
    const paginatedCosts = filteredCosts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    const totalPages = Math.ceil(filteredCosts.length / itemsPerPage);

    const AllocationKeyPreview = ({ value }) => {
        if (!value || !value.allocations || value.allocations.length === 0) {
            return <span className="text-muted-foreground text-xs">Není</span>;
        }
        return <Badge variant="secondary" className="text-xs">{value.allocations.length} projektů</Badge>;
    };

    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatsCard title="Celkové režie" value={stats.total} description={`${costs.length} položek v evidenci`} icon={FilePieChart} tone="blue" />
                <StatsCard title="Aktuální měsíc" value={stats.monthlyTotal} description={monthLabel} icon={Calendar} tone="emerald" />
                <StatsCard title="Pravidelné" value={stats.regular} description={`${stats.regularCount} aktivních nákladů`} icon={RefreshCw} tone="violet" />
                <StatsCard title="Proměnlivé" value={stats.variable} description={`${stats.variableCount} položek`} icon={Tag} tone="amber" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <MonthlyCategoryBreakdown categories={stats.monthlyCategories} total={stats.monthlyTotal} />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    <PreviewList
                        title="Pravidelné náklady"
                        description={`Posledních ${regularPreview.length} záznamů`}
                        items={regularPreview}
                        empty="Nemáte žádné pravidelné náklady."
                        dateFormatter={(item) =>
                            item.valid_from && item.valid_to
                                ? `${format(new Date(item.valid_from), 'd.M.yyyy')} - ${format(new Date(item.valid_to), 'd.M.yyyy')}`
                                : 'Bez platnosti'
                        }
                    />
                    <PreviewList
                        title="Proměnlivé náklady"
                        description={`Posledních ${variablePreview.length} záznamů`}
                        items={variablePreview}
                        empty="Nemáte žádné proměnlivé náklady."
                        dateFormatter={(item) => (item.date_incurred ? format(new Date(item.date_incurred), 'd.M.yyyy') : 'Bez data')}
                    />
                </div>
            </div>

            <Card className="overflow-hidden">
                <CardHeader className="border-b bg-slate-50/70">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Wallet className="h-5 w-5 text-primary" />
                                Evidence režijních nákladů
                            </CardTitle>
                            <CardDescription>
                                {filteredCosts.length} z {costs.length} položek
                            </CardDescription>
                        </div>
                        <div className="relative w-full xl:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                            <Input
                                placeholder="Hledat náklad..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <Filter className="w-4 h-4 text-muted-foreground" />
                            <Select value={filters.type} onValueChange={(value) => setFilters((prev) => ({ ...prev, type: value }))}>
                                <SelectTrigger className="w-full bg-white sm:w-40">
                                    <SelectValue placeholder="Typ" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Všechny typy</SelectItem>
                                    <SelectItem value="PRAVIDELNY">Pravidelné</SelectItem>
                                    <SelectItem value="PROMENLIVY">Proměnlivé</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={filters.category} onValueChange={(value) => setFilters((prev) => ({ ...prev, category: value }))}>
                                <SelectTrigger className="w-full bg-white sm:w-52">
                                    <SelectValue placeholder="Kategorie" />
                                </SelectTrigger>
                                <SelectContent>
                                    {uniqueCategories.map((category) => (
                                        <SelectItem key={category} value={category}>
                                            {category === 'all' ? 'Všechny kategorie' : category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {hasActiveFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setSearchTerm('');
                                        setFilters({ type: 'all', category: 'all' });
                                    }}
                                >
                                    Zrušit filtry
                                </Button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={fetchCosts} className="bg-white">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Aktualizovat
                            </Button>
                            <Button onClick={handleNewCost}>
                                <Plus className="mr-2 h-4 w-4" />
                                Nový náklad
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název</TableHead>
                                <TableHead>Kategorie</TableHead>
                                <TableHead>Částka</TableHead>
                                <TableHead>Typ</TableHead>
                                <TableHead>Platnost / Datum</TableHead>
                                <TableHead>Výchozí klíč</TableHead>
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center p-8">
                                        Načítání...
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCosts.length > 0 ? (
                                paginatedCosts.map((cost) => (
                                    <TableRow key={cost.id} className="hover:bg-slate-50/80">
                                        <TableCell className="min-w-[240px]">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-slate-950">{cost.name}</p>
                                                {cost.description && <p className="truncate text-xs text-muted-foreground">{cost.description}</p>}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{cost.category || 'N/A'}</Badge>
                                        </TableCell>
                                        <TableCell className="font-semibold tabular-nums">{formatCurrency(cost.amount)}</TableCell>
                                        <TableCell><CostTypeBadge type={cost.type} /></TableCell>
                                        <TableCell className="min-w-[170px] text-sm">
                                            {cost.type === 'PRAVIDELNY'
                                                ? cost.valid_from && cost.valid_to
                                                    ? `${format(new Date(cost.valid_from), 'd.M.yyyy')} - ${format(new Date(cost.valid_to), 'd.M.yyyy')}`
                                                    : 'Bez platnosti'
                                                : cost.date_incurred
                                                    ? format(new Date(cost.date_incurred), 'd.M.yyyy')
                                                    : 'Bez data'}
                                        </TableCell>
                                        <TableCell>
                                            <AllocationKeyPreview value={cost.default_allocation_key} />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEdit(cost)}>
                                                        <Edit2 className="mr-2 h-4 w-4" />
                                                        Upravit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleCopy(cost)}>
                                                        <Copy className="mr-2 h-4 w-4" />
                                                        Kopírovat
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem className="text-red-500" onClick={() => setDeleteId(cost.id)}>
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Smazat
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center p-8">
                                        Nenalezeny žádné náklady.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 mt-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                    >
                        <ChevronLeft className="w-4 h-4" /> Předchozí
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Stránka {currentPage} z {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                    >
                        Další <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {isFormOpen && (
                <OverheadCostForm
                    isOpen={isFormOpen}
                    onClose={() => {
                        setIsFormOpen(false);
                        setEditingCost(null);
                    }}
                    onSave={handleSave}
                    cost={editingCost}
                    allCategories={uniqueCategories.filter((category) => category !== 'all')}
                />
            )}

            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu smazat náklad?</AlertDialogTitle>
                        <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(deleteId)} className="bg-red-600 hover:bg-red-700">
                            Smazat
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

const OverheadCosts = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const { tab } = useParams();

    const activeTab = tab || 'costs';

    useEffect(() => {
        if (!isAdmin) {
            navigate('/');
            toast({ title: 'Přístup odepřen', description: 'Tento modul je pouze pro administrátory.', variant: 'destructive' });
        }
    }, [isAdmin, navigate, toast]);

    const onTabChange = (newTab) => {
        navigate(`/overhead-costs/${newTab}`);
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={FilePieChart}
                title="Režijní náklady"
                description="Správa a rozdělování režijních nákladů firmy."
                actions={
                    <Button variant="outline" onClick={() => navigate('/overhead-costs/reports')}>
                        <BarChart className="mr-2 h-4 w-4" /> Reporty
                    </Button>
                }
            />
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <div className="hidden">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                            <FilePieChart className="w-8 h-8 text-primary" />
                            Režijní náklady
                        </h1>
                        <p className="text-muted-foreground">Správa a rozdělování režijních nákladů firmy.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => navigate('/overhead-costs/reports')}>
                            <BarChart className="mr-2 h-4 w-4" /> Reporty
                        </Button>
                    </div>
                </div>
            </motion.div>

            <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="costs">
                        <List className="mr-2 h-4 w-4" /> Náklady
                    </TabsTrigger>
                    <TabsTrigger value="settlement">
                        <FileText className="mr-2 h-4 w-4" /> Měsíční vyúčtování
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="costs">
                    <OverheadCostsList />
                </TabsContent>
                <TabsContent value="settlement">
                    <MonthlyAllocation />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default OverheadCosts;
