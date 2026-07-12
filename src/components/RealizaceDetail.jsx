import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Edit2, Plus, Trash2, Download, Search, LayoutDashboard, DollarSign, Clock, ShoppingCart, PieChart, ChevronDown, Loader2, FileSignature } from 'lucide-react';
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
import HandoverProtocolsTab from './HandoverProtocolsTab';
import { RealizaceCostDialog } from './RealizaceFinancials';
import { calculateFinancials } from './RealizaceFinancialCalculations';
import RealizaceTeam from './RealizaceTeam';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialHealthAlert from '@/components/FinancialHealthAlert';

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value || 0);
const toNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

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
  const [costs, setCosts] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [financialSummary, setFinancialSummary] = useState(null);
  const [laborFinancialSummary, setLaborFinancialSummary] = useState(null);

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

  // Get visibility rules
  const { canViewAmounts, canViewCosts, canViewProfit } = getFinancialVisibility(userRole);

  // Strictly disable edit for 'user' role
  const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';

  const updateRealizationStatus = useCallback(async (nextStatus) => {
    if (!realization || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      const { data, error } = await supabase.rpc('update_realization_status', {
        p_realization_id: realization.id,
        p_next_status: nextStatus,
      });

      if (error) throw error;

      setRealization((prev) => (prev ? { ...prev, ...data } : prev));
      toast({
        title: 'Stav realizace aktualizován',
        description: statusConfig[data?.status || nextStatus]?.label || data?.status || nextStatus,
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
    const { data: realData, error: realError } = await supabase.rpc('get_realization_safe', {
      p_realization_id: realizaceId,
    });

    if (realError) {
      toast({ title: 'Chyba', description: 'Nepodařilo se načíst realizaci.', variant: 'destructive' });
      navigate('/realizace');
      return;
    }
    setRealization(realData);
    setLinkedProjectId(realData.linked_project_id);

    const shouldLoadFinancialSummary = canViewAmounts || canViewCosts || canViewProfit;
    const costsPromise = canViewCosts
      ? supabase.from('realizace_costs').select(`*, supplier:subjects!realizace_costs_supplier_id_fkey(name)`).eq('realizace_id', realizaceId).order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null });
    const extraCostsPromise = canViewCosts
      ? supabase.from('realizace_extra_costs').select('*').eq('realizace_id', realizaceId).order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null });
    const financialSummaryPromise = shouldLoadFinancialSummary
      ? supabase.rpc('realization_financial_summary', { p_realization_id: realizaceId })
      : Promise.resolve({ data: null, error: null });
    const laborSummaryPromise = shouldLoadFinancialSummary
      ? supabase.rpc('realization_labor_financial_summary', { p_realization_id: realizaceId })
      : Promise.resolve({ data: null, error: null });

    const [costsRes, extraRes, financialSummaryRes, laborSummaryRes] = await Promise.all([
      costsPromise,
      extraCostsPromise,
      financialSummaryPromise,
      laborSummaryPromise,
    ]);

    if (canViewCosts) {
      setCosts(costsRes.data || []);
      setExtraCosts(extraRes.data || []);
    } else {
      setCosts([]);
      setExtraCosts([]);
    }

    if (financialSummaryRes.error) {
      console.warn('realization_financial_summary failed, using local fallback:', financialSummaryRes.error.message);
      setFinancialSummary(null);
    } else {
      setFinancialSummary(financialSummaryRes.data || null);
    }
    if (laborSummaryRes.error) {
      console.warn('realization_labor_financial_summary failed, using legacy labor model:', laborSummaryRes.error.message);
      setLaborFinancialSummary(null);
    } else {
      setLaborFinancialSummary(laborSummaryRes.data || null);
    }

    setLoading(false);
  }, [realizaceId, navigate, toast, canViewAmounts, canViewCosts, canViewProfit]);

  // Fetch Hourly Costs Total - Includes BOTH direct attendance and linked project attendance
  useEffect(() => {
    const fetchHourlyTotal = async () => {
      if (!realizaceId || !canViewCosts) {
        setHourlyCostsTotal(0);
        setHourlyLoading(false);
        return;
      }
      setHourlyLoading(true);
      try {
        // 1. Direct Realization Attendance
        const { data: directData, error: directError } = await supabase
          .from('attendance')
          .select('hours, members:members!attendance_member_id_fkey(hourly_rate)')
          .eq('realizace_id', realizaceId);

        if (directError) throw directError;

        // 2. Linked Project Attendance (if applicable)
        let projectData = [];
        if (linkedProjectId) {
          const { data: pData, error: pError } = await supabase
            .from('attendance')
            .select('hours, members:members!attendance_member_id_fkey(hourly_rate)')
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
  }, [realizaceId, linkedProjectId, canViewCosts]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Financial Calculations ---
  // Legacy Financial Calculations (for backwards compat)
  const localManualCosts = costs.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const localExtraCostsCost = extraCosts.reduce((sum, c) => sum + Number(c.cost_amount || 0), 0);
  const localExtraCostsSale = extraCosts.reduce((sum, c) => sum + Number(c.sale_amount || 0), 0);
  const hasFinancialSummary = !!financialSummary;
  const totalManualCosts = hasFinancialSummary ? toNumber(financialSummary.manual_costs) : localManualCosts;
  const totalExtraCostsCost = hasFinancialSummary ? toNumber(financialSummary.extra_costs) : localExtraCostsCost;
  const totalExtraCostsSale = hasFinancialSummary ? toNumber(financialSummary.extra_revenue) : localExtraCostsSale;
  const effectiveHourlyCostsTotal = hasFinancialSummary ? toNumber(financialSummary.hourly_costs) : hourlyCostsTotal;
  const reservedPayouts = hasFinancialSummary ? toNumber(financialSummary.reserved_payouts) : 0;
  const paidTaskPayouts = hasFinancialSummary ? toNumber(financialSummary.paid_task_payouts) : 0;
  const paidHourlyPayouts = hasFinancialSummary ? toNumber(financialSummary.paid_hourly_payouts) : 0;
  const paidPayoutCosts = hasFinancialSummary ? toNumber(financialSummary.paid_payout_costs) : 0;
  const costsBeforePaidPayouts = hasFinancialSummary ? toNumber(financialSummary.costs_before_paid_payouts) : totalManualCosts + totalExtraCostsCost;
  const legacyGrandTotalCosts = hasFinancialSummary ? toNumber(financialSummary.costs_after_paid_payouts) : totalManualCosts + totalExtraCostsCost;
  const grandTotalCosts = laborFinancialSummary
    ? legacyGrandTotalCosts - paidHourlyPayouts + toNumber(laborFinancialSummary.direct_project_cost)
    : legacyGrandTotalCosts;
  const contractAmountBase = hasFinancialSummary ? toNumber(financialSummary.base_contract_amount) : Number(realization?.contract_amount || 0);
  const totalRevenue = hasFinancialSummary ? toNumber(financialSummary.total_revenue) : contractAmountBase + totalExtraCostsSale;
  
  // Available "profit" in the old sense (Revenue - Costs)
  const profitAvailable = totalRevenue - grandTotalCosts;

  // New Financial Model
  const calculatedFinancials = useMemo(() => {
    if (!realization) return {
      contractAmount: 0, profitAmount: 0, overheadAmount: 0, teamBudget: 0, totalCosts: 0
    };
    return calculateFinancials(
      totalRevenue, // Base calculation on Total Revenue (Contract + Extra Works Sale)
      realization.profit_margin_percent, 
      realization.overhead_percent,
      grandTotalCosts
    );
  }, [realization, totalRevenue, grandTotalCosts]);

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
      fetchData();
    }
  };

  const filteredCosts = costs.filter(c =>
    (c.description || '').toLowerCase().includes(costSearch.toLowerCase()) ||
    (c.supplier?.name || '').toLowerCase().includes(costSearch.toLowerCase())
  );

  const handleLinkProjectUpdate = (newProjectId) => {
    setLinkedProjectId(newProjectId);
  };

  const handleRealizationUpdate = (updatedRealization) => {
    setRealization(updatedRealization);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );

  if (!realization) return null;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b">
        <div className="app-page py-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/realizace')}>
                <ChevronLeft className="w-4 h-4 mr-2" /> Zpět
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{realization.name}</h1>
                <p className="text-muted-foreground text-sm">{realization.location_address || 'Adresa neuvedena'}</p>
              </div>
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
        </div>
      </motion.div>

      <div className="app-page-wide">
        {canViewAmounts && (
          <div className="mb-4">
            <FinancialHealthAlert
              baseAmount={totalRevenue}
              remainingAmount={calculatedFinancials.teamBudget}
              availableAmount={financialSummary
                ? toNumber(financialSummary.available_for_payout) + paidHourlyPayouts - toNumber(laborFinancialSummary?.direct_project_cost)
                : calculatedFinancials.teamBudget}
            />
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-6 mb-4">
            <TabsTrigger value="overview" className="flex items-center gap-2"><LayoutDashboard className="w-4 h-4" /> Přehled</TabsTrigger>
            {canViewCosts && <TabsTrigger value="finance" className="flex items-center gap-2"><DollarSign className="w-4 h-4" /> Náklady & Finance</TabsTrigger>}
            <TabsTrigger value="hourly" className="flex items-center gap-2"><Clock className="w-4 h-4" /> Hodinové náklady</TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Objednávky</TabsTrigger>
            <TabsTrigger value="handover" className="flex items-center gap-2"><FileSignature className="w-4 h-4" /> Předání</TabsTrigger>
            {canViewProfit && (
              <TabsTrigger value="profit" className="flex items-center gap-2"><PieChart className="w-4 h-4" /> Zisk</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            <RealizaceOverview
              realization={realization}
              costStats={{
                totalRecordedCosts: totalManualCosts,
                hourlyCosts: effectiveHourlyCostsTotal,
                extraCosts: totalExtraCostsCost,
                grandTotal: grandTotalCosts,
                costsBeforePaidPayouts,
                paidPayoutCosts,
                reservedPayouts,
                costCount: costs.length,
                extraCostsSale: totalExtraCostsSale
              }}
              financialSnapshot={{
                baseContractAmount: contractAmountBase,
                contractAmount: totalRevenue,
                actualCost: grandTotalCosts,
                profitAvailable: profitAvailable, // Legacy
                profitPercentage: totalRevenue > 0 ? (profitAvailable / totalRevenue) * 100 : 0,
                // New financial model data
                teamBudget: calculatedFinancials.teamBudget,
                profitAmount: calculatedFinancials.profitAmount,
                overheadAmount: calculatedFinancials.overheadAmount,
                totalCosts: calculatedFinancials.totalCosts,
                paidPayoutCosts,
                reservedPayouts
              }}
              loading={hourlyLoading}
              onRealizationUpdate={handleRealizationUpdate}
            />
          </TabsContent>

          {canViewCosts && (
            <TabsContent value="finance" className="space-y-6">
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
                          <span className="text-muted-foreground">Hodinová mzda evid.:</span> <span className="font-bold">{hourlyLoading && !hasFinancialSummary ? '...' : formatCurrency(effectiveHourlyCostsTotal)}</span>
                        </div>
                        <div className="bg-amber-50 px-3 py-1 rounded text-amber-700">
                          <span className="text-muted-foreground">Rezervováno:</span> <span className="font-bold">{formatCurrency(reservedPayouts)}</span>
                        </div>
                        <div className="bg-rose-50 px-3 py-1 rounded text-rose-700">
                          <span className="text-muted-foreground">Paid výplaty:</span> <span className="font-bold">{formatCurrency(paidPayoutCosts)}</span>
                          <span className="ml-2 text-xs text-rose-600">úkolové {formatCurrency(paidTaskPayouts)} / hodinové {formatCurrency(paidHourlyPayouts)}</span>
                        </div>
                        <div className="bg-green-50 px-3 py-1 rounded text-green-700 border border-green-200">
                          <span className="font-medium mr-1">NÁKLADY PO PAID:</span>
                          <span className="font-bold text-lg">{hourlyLoading && !hasFinancialSummary ? '...' : formatCurrency(grandTotalCosts)}</span>
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
            </TabsContent>
          )}

          <TabsContent value="hourly">
            <RealizaceHourlyCosts
              realizaceId={realizaceId}
              linkedProjectId={linkedProjectId}
              onLinkProject={handleLinkProjectUpdate}
              distributionAmount={calculatedFinancials.teamBudget}
            />
          </TabsContent>

          <TabsContent value="orders">
            <RealizaceOrdersTab
              realizaceId={realizaceId}
              realization={realization}
              distributionAmount={calculatedFinancials.teamBudget}
            />
          </TabsContent>

          <TabsContent value="handover">
            <HandoverProtocolsTab
              realizaceId={realizaceId}
              realization={realization}
              projectId={linkedProjectId}
              canEdit={canEdit}
            />
          </TabsContent>

          {canViewProfit && (
            <TabsContent value="profit">
              <RealizaceProfitSharing
                realizaceId={realizaceId}
                distributionAmount={calculatedFinancials.teamBudget}
                sponsorDeductions={laborFinancialSummary?.sponsor_deductions || []}
                isCompleted={realization.status === 'Dokončeno'}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default RealizaceDetail;
