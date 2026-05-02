import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Edit2, Plus, Trash2, Download, Search, LayoutDashboard, DollarSign, Clock, ShoppingCart, PieChart, ChevronDown, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MemoBadge } from '@/components/ui/memo-badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import RealizaceOverview from './RealizaceOverview';
import RealizaceOrdersTab from './RealizaceOrdersTab';
import RealizaceHourlyCosts from './RealizaceHourlyCosts';
import RealizaceProfitSharing from './RealizaceProfitSharing';
import RealizaceExtraCosts from './RealizaceExtraCosts';
import { RealizaceCostDialog } from './RealizaceFinancials';

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value || 0);

const statusConfig = {
    'Připravuje se': { variant: 'info', label: 'Připravuje se' },
    'Probíhá': { variant: 'warning', label: 'Probíhá' },
    'Pozastaveno': { variant: 'destructive', label: 'Pozastaveno' },
    'Dokončeno': { variant: 'success', label: 'Dokončeno' },
    'Předáno': { variant: 'default', label: 'Předáno' },
    'waiting_for_approval': { variant: 'secondary', label: 'Čeká na schválení' }
};

const RealizaceDetail = () => {
    const { realizaceId } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { hasPermission, userRole } = useAuth();

    const [realization, setRealization] = useState(null);
    const [loading, setLoading] = useState(true);
    const [costs, setCosts] = useState([]); // Manual costs
    const [extraCosts, setExtraCosts] = useState([]);

    // Hourly costs state (calculated)
    const [hourlyCostsTotal, setHourlyCostsTotal] = useState(0);
    const [linkedProjectId, setLinkedProjectId] = useState(null);
    const [hourlyLoading, setHourlyLoading] = useState(false);

    // UI States
    const [costSearch, setCostSearch] = useState('');
    const [isCostDialogOpen, setIsCostDialogOpen] = useState(false);
    const [editingCost, setEditingCost] = useState(null);
    const [activeTab, setActiveTab] = useState("overview");
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    // Strictly disable edit for 'user' role
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';
    const canViewFinance = (hasPermission('finance', 'can_read') || hasPermission('realizace', 'can_read')) && userRole !== 'user';

    const updateRealizationStatus = useCallback(async (nextStatus) => {
        if (!realization || isUpdatingStatus) return;
        setIsUpdatingStatus(true);
        try {
            const { error } = await supabase
                .from('realizations')
                .update({ status: nextStatus })
                .eq('id', realization.id);

            if (error) throw error;

            setRealization((prev) => (prev ? { ...prev, status: nextStatus } : prev));
            toast({
                title: 'Stav realizace aktualizován',
                description: statusConfig[nextStatus]?.label || nextStatus,
            });
        } catch (error) {
            toast({ title: 'Chyba změny stavu', description: error.message, variant: 'destructive' });
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [realization, toast, isUpdatingStatus]);

    const renderStatusMenu = () => {
        if (!realization) return null;
        const status = statusConfig[realization.status] || { label: realization.status, variant: 'default' };

        if (!canEdit) {
            return (
                <MemoBadge variant={status.variant} className="max-w-[160px] truncate text-xs" title={status.label}>
                    {status.label}
                </MemoBadge>
            );
        }

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
                        <MemoBadge variant={status.variant} className="max-w-[160px] truncate text-xs" title={status.label}>
                            {status.label}
                        </MemoBadge>
                        {isUpdatingStatus ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {Object.entries(statusConfig).map(([key, conf]) => (
                        <DropdownMenuItem
                            key={key}
                            disabled={isUpdatingStatus || realization.status === key}
                            onClick={() => updateRealizationStatus(key)}
                        >
                            {conf.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        // Fetch Realization with linked_project_id
        const { data: realData, error: realError } = await supabase
            .from('realizations')
            .select(`*, investor:investor_id(name), lead_person:lead_person_id(name)`)
            .eq('id', realizaceId)
            .single();

        if (realError) {
            toast({ title: 'Chyba', description: 'Nepodařilo se načíst realizaci.', variant: 'destructive' });
            navigate('/realizace');
            return;
        }
        setRealization(realData);
        setLinkedProjectId(realData.linked_project_id);

        // Fetch Manual Costs and Extra Costs if allowed
        if (canViewFinance) {
            const [costsRes, extraRes] = await Promise.all([
                supabase.from('realizace_costs').select(`*, supplier:supplier_id(name)`).eq('realizace_id', realizaceId).order('created_at', { ascending: false }),
                supabase.from('realizace_extra_costs').select('*').eq('realizace_id', realizaceId).order('created_at', { ascending: true })
            ]);

            setCosts(costsRes.data || []);
            setExtraCosts(extraRes.data || []);
        }

        setLoading(false);
    }, [realizaceId, navigate, toast, canViewFinance]);

    // Fetch Hourly Costs Total - Includes BOTH direct attendance and linked project attendance
    useEffect(() => {
        const fetchHourlyTotal = async () => {
            if (!realizaceId) return;
            setHourlyLoading(true);
            try {
                // 1. Direct Realization Attendance
                const { data: directData, error: directError } = await supabase
                    .from('attendance')
                    .select('hours, members(hourly_rate)')
                    .eq('realizace_id', realizaceId);

                if (directError) throw directError;

                // 2. Linked Project Attendance (if applicable)
                let projectData = [];
                if (linkedProjectId) {
                    const { data: pData, error: pError } = await supabase
                        .from('attendance')
                        .select('hours, members(hourly_rate)')
                        .eq('project_id', linkedProjectId);

                    if (pError) throw pError;
                    projectData = pData || [];
                }

                // Calculate Total
                const allRecords = [...(directData || []), ...projectData];
                const total = allRecords.reduce((sum, item) => {
                    const hours = Number(item.hours) || 0;
                    const rate = item.members?.hourly_rate ? Number(item.members.hourly_rate) : 0;
                    return sum + (hours * rate);
                }, 0);

                setHourlyCostsTotal(total);
            } catch (err) {
                console.error("Error calculating hourly costs:", err);
                // Fail silently on calc error, display 0
            } finally {
                setHourlyLoading(false);
            }
        };

        fetchHourlyTotal();
    }, [realizaceId, linkedProjectId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // --- Cost Handlers ---
    const handleSaveCost = async (costData) => {
        try {
            let fileUrl = costData.existingInvoice?.url || null;
            let fileName = costData.existingInvoice?.name || null;

            if (costData.removeInvoice) {
                fileUrl = null;
                fileName = null;
            }

            if (costData.invoiceFile) {
                const file = costData.invoiceFile;
                const fileExt = file.name.split('.').pop();
                const filePath = `${realizaceId}/${Date.now()}.${fileExt}`;

                const { error: uploadError } = await supabase.storage
                    .from('invoices')
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                const { data: publicData } = supabase.storage.from('invoices').getPublicUrl(filePath);
                fileUrl = publicData.publicUrl;
                fileName = file.name;
            }

            const payload = {
                realizace_id: realizaceId,
                description: costData.description,
                amount: costData.amount,
                supplier_id: costData.supplier_id,
                variable_symbol: costData.variable_symbol,
                note: costData.note,
                invoice_url: fileUrl,
                invoice_name: fileName
            };

            if (editingCost) {
                const { error } = await supabase.from('realizace_costs').update(payload).eq('id', editingCost.id);
                if (error) throw error;
                toast({ title: 'Náklad aktualizován' });
            } else {
                const { error } = await supabase.from('realizace_costs').insert(payload);
                if (error) throw error;
                toast({ title: 'Náklad přidán' });
            }

            setIsCostDialogOpen(false);
            setEditingCost(null);
            fetchData();

        } catch (error) {
            toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
        }
    };

    const handleDeleteCost = async (id) => {
        const { error } = await supabase.from('realizace_costs').delete().eq('id', id);
        if (error) {
            toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Náklad smazán' });
            setCosts(prev => prev.filter(c => c.id !== id));
        }
    };

    const filteredCosts = costs.filter(c =>
        c.description.toLowerCase().includes(costSearch.toLowerCase()) ||
        c.supplier?.name?.toLowerCase().includes(costSearch.toLowerCase())
    );

    // --- Financial Calculations ---
    const totalManualCosts = costs.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const totalExtraCostsCost = extraCosts.reduce((sum, c) => sum + Number(c.cost_amount || 0), 0);
    const totalExtraCostsSale = extraCosts.reduce((sum, c) => sum + Number(c.sale_amount || 0), 0);

    const grandTotalCosts = totalManualCosts + hourlyCostsTotal + totalExtraCostsCost;
    const contractAmountBase = Number(realization?.contract_amount || 0);
    const totalRevenue = contractAmountBase + totalExtraCostsSale; // Contract + Extra Works (Vícenáklady)
    const profitAvailable = totalRevenue - grandTotalCosts;

    const handleLinkProjectUpdate = (newProjectId) => {
        setLinkedProjectId(newProjectId);
    };

    if (loading) return (
        <div className="flex items-center justify-center h-screen">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
    );

    if (!realization) return null;

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
                <Button variant="ghost" className="w-fit" onClick={() => navigate('/realizace')}>
                    <ChevronLeft className="w-4 h-4 mr-2" /> Zpět na seznam
                </Button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">{realization.name}</h1>
                        <p className="text-muted-foreground">{realization.location_address || 'Adresa neuvedena'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {renderStatusMenu()}
                        {canEdit && (
                            <Button onClick={() => navigate(`/realizace/${realizaceId}/edit`)}>
                                <Edit2 className="w-4 h-4 mr-2" /> Upravit realizaci
                            </Button>
                        )}
                    </div>
                </div>
            </motion.div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full md:w-auto grid grid-cols-2 md:inline-flex mb-4">
                    <TabsTrigger value="overview" className="flex items-center gap-2"><LayoutDashboard className="w-4 h-4" /> Přehled</TabsTrigger>
                    {canViewFinance && <TabsTrigger value="finance" className="flex items-center gap-2"><DollarSign className="w-4 h-4" /> Náklady & Finance</TabsTrigger>}
                    <TabsTrigger value="hourly" className="flex items-center gap-2"><Clock className="w-4 h-4" /> Hodinové náklady</TabsTrigger>
                    <TabsTrigger value="orders" className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Objednávky</TabsTrigger>
                    {canViewFinance && (
                        <TabsTrigger value="profit" className="flex items-center gap-2"><PieChart className="w-4 h-4" /> Zisk</TabsTrigger>
                    )}
                </TabsList>

                <TabsContent value="overview">
                    <RealizaceOverview
                        realization={realization}
                        costStats={{
                            totalRecordedCosts: totalManualCosts,
                            hourlyCosts: hourlyCostsTotal,
                            extraCosts: totalExtraCostsCost,
                            grandTotal: grandTotalCosts,
                            costCount: costs.length,
                            extraCostsSale: totalExtraCostsSale // Added for detailed breakdown
                        }}
                        financialSnapshot={{
                            baseContractAmount: contractAmountBase, // New prop
                            contractAmount: totalRevenue, // Show Total Revenue (Base + Extras)
                            actualCost: grandTotalCosts,
                            profitAvailable: profitAvailable,
                            profitPercentage: totalRevenue > 0 ? (profitAvailable / totalRevenue) * 100 : 0
                        }}
                        loading={hourlyLoading}
                    />
                </TabsContent>

                <TabsContent value="finance" className="space-y-6">
                    {canViewFinance ? (
                        <>
                            {/* NEW: Extra Costs Component */}
                            <RealizaceExtraCosts
                                realizaceId={realizaceId}
                                extraCosts={extraCosts}
                                onUpdate={fetchData}
                            />

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <div className="space-y-1">
                                        <CardTitle>Manuální náklady realizace</CardTitle>
                                        <CardDescription>Evidence faktur, materiálů a ostatních výdajů</CardDescription>
                                    </div>
                                    {canEdit && (
                                        <Button onClick={() => { setEditingCost(null); setIsCostDialogOpen(true); }}>
                                            <Plus className="w-4 h-4 mr-2" /> Přidat náklad
                                        </Button>
                                    )}
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col md:flex-row md:items-center mb-4 gap-4">
                                        <div className="relative w-full max-w-sm">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Hledat náklad..."
                                                className="pl-9"
                                                value={costSearch}
                                                onChange={e => setCostSearch(e.target.value)}
                                            />
                                        </div>
                                        <div className="md:ml-auto flex items-center gap-4 text-sm flex-wrap">
                                            <div className="bg-slate-100 px-3 py-1 rounded">
                                                <span className="text-muted-foreground">Manuální:</span> <span className="font-bold">{formatCurrency(totalManualCosts)}</span>
                                            </div>
                                            <div className="bg-orange-50 px-3 py-1 rounded text-orange-700">
                                                <span className="text-muted-foreground">Vícenáklady:</span> <span className="font-bold">{formatCurrency(totalExtraCostsCost)}</span>
                                            </div>
                                            <div className="bg-blue-50 px-3 py-1 rounded text-blue-700">
                                                <span className="text-muted-foreground">Hodinové:</span> <span className="font-bold">{hourlyLoading ? '...' : formatCurrency(hourlyCostsTotal)}</span>
                                            </div>
                                            <div className="bg-green-50 px-3 py-1 rounded text-green-700 border border-green-200">
                                                <span className="font-medium mr-1">CELKEM:</span>
                                                <span className="font-bold text-lg">{hourlyLoading ? '...' : formatCurrency(grandTotalCosts)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Popis</TableHead>
                                                    <TableHead>Dodavatel</TableHead>
                                                    <TableHead>VS</TableHead>
                                                    <TableHead className="text-right">Částka</TableHead>
                                                    <TableHead className="text-right">Faktura</TableHead>
                                                    <TableHead className="text-right">Akce</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredCosts.length === 0 ? (
                                                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Žádné náklady</TableCell></TableRow>
                                                ) : (
                                                    filteredCosts.map(cost => (
                                                        <TableRow key={cost.id}>
                                                            <TableCell className="font-medium">{cost.description}</TableCell>
                                                            <TableCell>{cost.supplier?.name || '-'}</TableCell>
                                                            <TableCell className="font-mono text-xs">{cost.variable_symbol || '-'}</TableCell>
                                                            <TableCell className="text-right font-bold">{formatCurrency(cost.amount)}</TableCell>
                                                            <TableCell className="text-right">
                                                                {cost.invoice_url && (
                                                                    <a href={cost.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-blue-600 hover:underline">
                                                                        <Download className="w-3 h-3 mr-1" /> {cost.invoice_name || 'Stáhnout'}
                                                                    </a>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {canEdit && (
                                                                    <div className="flex justify-end gap-1">
                                                                        <Button variant="ghost" size="icon" onClick={() => { setEditingCost(cost); setIsCostDialogOpen(true); }}>
                                                                            <Edit2 className="w-4 h-4" />
                                                                        </Button>
                                                                        <AlertDialog>
                                                                            <AlertDialogTrigger asChild>
                                                                                <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600">
                                                                                    <Trash2 className="w-4 h-4" />
                                                                                </Button>
                                                                            </AlertDialogTrigger>
                                                                            <AlertDialogContent>
                                                                                <AlertDialogHeader>
                                                                                    <AlertDialogTitle>Smazat náklad?</AlertDialogTitle>
                                                                                </AlertDialogHeader>
                                                                                <AlertDialogFooter>
                                                                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                                                                    <AlertDialogAction onClick={() => handleDeleteCost(cost.id)} className="bg-destructive">Smazat</AlertDialogAction>
                                                                                </AlertDialogFooter>
                                                                            </AlertDialogContent>
                                                                        </AlertDialog>
                                                                    </div>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>

                            <RealizaceCostDialog
                                isOpen={isCostDialogOpen}
                                onClose={() => setIsCostDialogOpen(false)}
                                onSave={handleSaveCost}
                                costData={editingCost}
                            />
                        </>
                    ) : (
                        <div className="p-8 text-center text-muted-foreground bg-slate-50 rounded-lg">Nemáte oprávnění prohlížet finance.</div>
                    )}
                </TabsContent>

                <TabsContent value="hourly">
                    <RealizaceHourlyCosts
                        realizaceId={realizaceId}
                        linkedProjectId={linkedProjectId}
                        onLinkProject={handleLinkProjectUpdate}
                    />
                </TabsContent>

                <TabsContent value="orders">
                    <RealizaceOrdersTab
                        realizaceId={realizaceId}
                        realization={realization}
                    />
                </TabsContent>

                {canViewFinance && (
                    <TabsContent value="profit">
                        <RealizaceProfitSharing
                            realizaceId={realizaceId}
                            contractAmount={totalRevenue}
                            totalCosts={grandTotalCosts}
                            isCompleted={realization.status === 'Dokončeno'}
                        />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
};

export default RealizaceDetail;