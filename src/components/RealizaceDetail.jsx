import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Edit2, Plus, Trash2, Download, Search, LayoutDashboard, DollarSign, Clock, ShoppingCart, PieChart, ChevronDown, Loader2, FileSignature, FolderOpen, GanttChart, Wallet, FileText, AlertTriangle } from 'lucide-react';
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
import SharePointFolderBrowser from '@/components/SharePointFolderBrowser';
import { RealizaceCostDialog } from './RealizaceFinancials';
import { calculateFinancials } from './RealizaceFinancialCalculations';
import RealizaceTeam from './RealizaceTeam';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialHealthAlert from '@/components/FinancialHealthAlert';
import BillingTracker from '@/components/BillingTracker';
import BillingOverviewSummary from '@/components/finance/BillingOverviewSummary';
import { deleteStoredFile, uploadInvoiceDocument } from '@/lib/documentStorageService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import PlanningBoard from '@/components/PlanningBoard';
import { FinanceAmount, FinanceDefinitionNote, FinanceMetricStrip, FinanceStageFlow } from '@/components/finance/FinanceWorkspace';
import { RecordWorkspaceHeader, RecordWorkspaceTabsList } from '@/components/ui/record-workspace';
import EkvLoader from '@/components/ui/ekv-loader';
import { calculateRealizationRewardAllocation } from '@/domain/financials';
import { formatMoney } from '@/lib/financePresentation';
import FinancialSettingsCard from '@/components/finance/FinancialSettingsCard';

const formatCurrency = formatMoney;
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
  const location = useLocation();
  const { toast } = useToast();
  const { hasPermission, userRole } = useAuth();

  const [realization, setRealization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [costs, setCosts] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [financialSummary, setFinancialSummary] = useState(null);
  const [laborFinancialSummary, setLaborFinancialSummary] = useState(null);
  const [financeLoadError, setFinanceLoadError] = useState(null);

  // Hourly costs state (calculated)
  const [hourlyCostsTotal, setHourlyCostsTotal] = useState(0);
  const [linkedProjectId, setLinkedProjectId] = useState(null);
  const [linkedProjectCode, setLinkedProjectCode] = useState(null);
  const [hourlyLoading, setHourlyLoading] = useState(false);

  // UI States
  const [costSearch, setCostSearch] = useState('');
  const [isCostDialogOpen, setIsCostDialogOpen] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Get visibility rules
  const { canViewAmounts, canViewCosts, canViewProfit } = getFinancialVisibility(userRole);
  const availableTabs = useMemo(() => [
    'overview',
    'plan',
    ...(canViewCosts ? ['finance'] : []),
    'orders',
    'documents',
    'handover',
  ], [canViewCosts]);
  const requestedTab = location.hash.substring(1);
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'overview';
  const setActiveTab = useCallback((value) => navigate(`#${value}`, { replace: true }), [navigate]);

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
    setFinanceLoadError(null);
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

    if (realData.linked_project_id) {
      const { data: linkedProject } = await supabase
        .from('projects')
        .select('code')
        .eq('id', realData.linked_project_id)
        .maybeSingle();
      setLinkedProjectCode(linkedProject?.code || null);
    } else {
      setLinkedProjectCode(null);
    }

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
      console.error('realization_financial_summary failed:', financialSummaryRes.error.message);
      setFinanceLoadError(financialSummaryRes.error.message);
      setFinancialSummary(null);
    } else {
      setFinancialSummary(financialSummaryRes.data || null);
    }
    if (laborSummaryRes.error) {
      console.error('realization_labor_financial_summary failed:', laborSummaryRes.error.message);
      setFinanceLoadError((current) => current || laborSummaryRes.error.message);
      setLaborFinancialSummary(null);
    } else {
      setLaborFinancialSummary(laborSummaryRes.data || null);
    }

    setLoading(false);
  }, [realizaceId, navigate, toast, canViewAmounts, canViewCosts, canViewProfit]);

  // The labor summary is the authoritative source. Direct member-rate reads are
  // intentionally forbidden because compensation is private.
  useEffect(() => {
    if (!canViewCosts) {
      setHourlyCostsTotal(0);
    } else {
      setHourlyCostsTotal(toNumber(laborFinancialSummary?.direct_project_cost));
    }
    setHourlyLoading(false);
  }, [canViewCosts, laborFinancialSummary]);

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
  const isCanonicalFinancialModel = Number(financialSummary?.financial_model_version || 0) >= 2;
  const grandTotalCosts = isCanonicalFinancialModel
    ? legacyGrandTotalCosts
    : laborFinancialSummary
    ? legacyGrandTotalCosts - paidHourlyPayouts + toNumber(laborFinancialSummary.direct_project_cost)
    : legacyGrandTotalCosts;
  const rewardBaseCosts = isCanonicalFinancialModel
    ? toNumber(financialSummary.operational_costs)
    : grandTotalCosts;
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
      rewardBaseCosts
    );
  }, [realization, totalRevenue, rewardBaseCosts]);

  const rewardAllocation = useMemo(() => calculateRealizationRewardAllocation(
    financialSummary?.member_shares || [],
    calculatedFinancials.teamBudget
  ), [financialSummary?.member_shares, calculatedFinancials.teamBudget]);

  // --- Cost Handlers ---
  const handleSaveCost = async (costData) => {
    if (financeLoadError) {
      toast({ title: 'Finanční data nejsou dostupná', description: 'Obnovte autoritativní finanční souhrn před provedením změny.', variant: 'destructive' });
      return;
    }
    try {
      const costId = editingCost?.id || crypto.randomUUID();
      let fileUrl = costData.existingInvoice?.url || null;
      let fileName = costData.existingInvoice?.name || null;
      let invoiceStorageFields = {};
      let uploadedInvoice = null;
      const previousInvoice = (costData.invoiceFile || costData.removeInvoice) && editingCost?.invoice_url
        ? {
            provider: editingCost.invoice_storage_provider,
            connectionId: editingCost.invoice_storage_connection_id,
            bucket: editingCost.invoice_storage_metadata?.bucket || 'project-files',
            filePath: editingCost.invoice_url,
            fileId: editingCost.invoice_external_file_id,
            entityType: 'invoice',
            entityId: editingCost.id,
            accessEntityType: 'realizace',
            accessEntityId: realizaceId,
          }
        : null;

      if (costData.removeInvoice) {
        fileUrl = null;
        fileName = null;
        invoiceStorageFields = {
          invoice_storage_provider: null,
          invoice_storage_connection_id: null,
          invoice_external_file_id: null,
          invoice_external_web_url: null,
          invoice_storage_metadata: {},
        };
      }

      if (costData.invoiceFile) {
        const file = costData.invoiceFile;
        uploadedInvoice = await uploadInvoiceDocument({
          file,
          recordId: costId,
          projectReference: linkedProjectCode || null,
          category: 'naklady-realizaci',
          accessEntityType: 'realizace',
          accessEntityId: realizaceId,
        });
        fileUrl = uploadedInvoice.dbUrl;
        fileName = file.name;
        invoiceStorageFields = {
          invoice_storage_provider: uploadedInvoice.provider,
          invoice_storage_connection_id: uploadedInvoice.connectionId,
          invoice_external_file_id: uploadedInvoice.fileId || null,
          invoice_external_web_url: uploadedInvoice.webUrl || null,
          invoice_storage_metadata: uploadedInvoice.metadata || {},
        };
      }

      const payload = {
        id: costId,
        realizace_id: realizaceId,
        description: costData.description,
        amount: costData.amount,
        supplier_id: costData.supplier_id,
        variable_symbol: costData.variable_symbol,
        note: costData.note,
        invoice_url: fileUrl,
        invoice_name: fileName,
        ...invoiceStorageFields,
      };

      if (editingCost) {
        const { error } = await supabase.from('realizace_costs').update(payload).eq('id', editingCost.id);
        if (error) {
          if (uploadedInvoice?.cleanup) await uploadedInvoice.cleanup().catch(console.error);
          throw error;
        }
        toast({ title: 'Náklad aktualizován' });
      } else {
        const { error } = await supabase.from('realizace_costs').insert(payload);
        if (error) {
          if (uploadedInvoice?.cleanup) await uploadedInvoice.cleanup().catch(console.error);
          throw error;
        }
        toast({ title: 'Náklad přidán' });
      }

      if (previousInvoice) {
        try {
          await deleteStoredFile(previousInvoice);
        } catch (storageError) {
          toast({
            title: 'Náklad je uložen, původní soubor zůstal v úložišti',
            description: storageError.message,
            variant: 'warning',
          });
        }
      }

      setIsCostDialogOpen(false);
      setEditingCost(null);
      fetchData();

    } catch (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteCost = async (id) => {
    if (financeLoadError) {
      toast({ title: 'Finanční data nejsou dostupná', description: 'Mazání nákladů je do obnovení souhrnu zablokováno.', variant: 'destructive' });
      return;
    }
    const cost = costs.find((entry) => entry.id === id);
    const { error } = await supabase.from('realizace_costs').delete().eq('id', id);
    if (error) {
      toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
    } else {
      if (cost?.invoice_url) {
        try {
          await deleteStoredFile({
            provider: cost.invoice_storage_provider,
            connectionId: cost.invoice_storage_connection_id,
            bucket: cost.invoice_storage_metadata?.bucket || 'project-files',
            filePath: cost.invoice_url,
            fileId: cost.invoice_external_file_id,
            entityType: 'invoice',
            entityId: cost.id,
            accessEntityType: 'realizace',
            accessEntityId: realizaceId,
          });
        } catch (storageError) {
          toast({
            title: 'Náklad byl smazán, soubor faktury zůstal v úložišti',
            description: storageError.message,
            variant: 'warning',
          });
        }
      }
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

  if (loading) return (
    <EkvLoader title="Načítám detail realizace" description="Připravuji průběh zakázky, tým, dokumenty a finance." />
  );

  if (!realization) return null;

  return (
    <div>
      <RecordWorkspaceHeader
        title={realization.name}
        subtitle={realization.location_address || 'Adresa neuvedena'}
        onBack={() => navigate('/realizace')}
        status={renderStatusMenu()}
        actions={canEdit && (
          <Button size="sm" onClick={() => navigate(`/realizace/${realizaceId}/edit`)}>
            <Edit2 className="mr-2 h-4 w-4" />Upravit
          </Button>
        )}
      />

      <div className="app-page-wide">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
          <RecordWorkspaceTabsList>
            <TabsTrigger value="overview" className="flex items-center gap-2"><LayoutDashboard className="w-4 h-4" /> Přehled</TabsTrigger>
            <TabsTrigger value="plan" className="flex items-center gap-2"><GanttChart className="w-4 h-4" /> Plán</TabsTrigger>
            {canViewCosts && <TabsTrigger value="finance" className="flex items-center gap-2"><DollarSign className="w-4 h-4" /> Finance</TabsTrigger>}
            <TabsTrigger value="orders" className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Objednávky</TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Dokumenty</TabsTrigger>
            <TabsTrigger value="handover" className="flex items-center gap-2"><FileSignature className="w-4 h-4" /> Předání</TabsTrigger>
          </RecordWorkspaceTabsList>

          <TabsContent value="overview">
            <div className="space-y-6">
              {canViewAmounts && (
                <FinancialHealthAlert
                  baseAmount={totalRevenue}
                  remainingAmount={calculatedFinancials.teamBudget}
                  availableAmount={financialSummary
                    ? isCanonicalFinancialModel
                      ? toNumber(financialSummary.available_for_payout)
                      : toNumber(financialSummary.available_for_payout) + paidHourlyPayouts - toNumber(laborFinancialSummary?.direct_project_cost)
                    : calculatedFinancials.teamBudget}
                />
              )}
              <RealizaceOverview
                realization={realization}
                financialSnapshot={{ teamBudget: calculatedFinancials.teamBudget }}
              />
              {userRole === 'admin' && (
                <BillingOverviewSummary
                  entityType="realization"
                  entityId={realizaceId}
                  onOpenDetails={() => setActiveTab('finance')}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="plan">
            <PlanningBoard entityType="realization" entityId={realizaceId} embedded canEdit={canEdit} />
          </TabsContent>

          {canViewCosts && (
            <TabsContent value="finance" className="space-y-6">
                {financeLoadError && (
                  <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Finanční data nejsou autoritativně dostupná</p>
                      <p className="mt-1 text-red-700">Výpočty z databáze se nepodařilo načíst. Finanční změny jsou do obnovení dat pozastavené.</p>
                    </div>
                  </div>
                )}
                <FinanceMetricStrip className="2xl:grid-cols-4" metrics={[
                  { label: 'Výnos zakázky', value: <FinanceAmount value={totalRevenue} />, detail: 'Smlouva a schválené vícepráce', tone: 'neutral', icon: DollarSign },
                  { label: 'Skutečné náklady', value: <FinanceAmount value={grandTotalCosts} />, detail: 'Včetně vyplacených odměn', tone: 'neutral', icon: Download },
                  { label: 'Nerozdělený budget', value: <FinanceAmount value={rewardAllocation.unallocatedBudget} />, detail: 'Po nákladech a naplánovaných podílech', tone: Number(rewardAllocation.unallocatedBudget || 0) < 0 ? 'negative' : 'positive', icon: Wallet },
                  { label: 'Režie realizace', value: <FinanceAmount value={calculatedFinancials.overheadAmount} />, detail: `${Number(realization.overhead_percent || 0).toLocaleString('cs-CZ')} % z výnosu`, tone: 'warning', icon: FileText },
                  { label: 'Rezervované výplaty', value: <FinanceAmount value={reservedPayouts} />, detail: 'Závazek, zatím ne náklad', tone: Number(reservedPayouts || 0) ? 'warning' : 'neutral', icon: Clock },
                  { label: 'Vyplacené odměny', value: <FinanceAmount value={paidPayoutCosts} />, detail: 'Součást skutečných nákladů', tone: 'neutral', icon: DollarSign },
                  { label: 'Plánovaná marže', value: <FinanceAmount value={calculatedFinancials.profitAmount} />, detail: `${Number(realization.profit_margin_percent || 0).toLocaleString('cs-CZ')} % z výnosu`, tone: Number(calculatedFinancials.profitAmount || 0) < 0 ? 'negative' : 'positive', icon: PieChart },
                  { label: 'Provozní zůstatek', value: <FinanceAmount value={profitAvailable} />, detail: 'Výnos minus skutečné náklady', tone: Number(profitAvailable || 0) < 0 ? 'negative' : 'positive', icon: Wallet },
                ]} />
                <FinanceStageFlow stages={[
                  { label: 'Výnos zakázky', value: totalRevenue, barClassName: 'bg-slate-500' },
                  { label: 'Projektový budget', value: calculatedFinancials.grossProjectBudget, barClassName: 'bg-blue-500' },
                  { label: 'Skutečné náklady', value: grandTotalCosts, barClassName: 'bg-amber-500' },
                  { label: 'Provozní zůstatek', value: profitAvailable, barClassName: Number(profitAvailable || 0) < 0 ? 'bg-red-500' : 'bg-emerald-500' },
                ]} />
                <FinanceDefinitionNote>Nerozdělený budget je týmový základ po skutečných nákladech a naplánovaných podílech. Režie zůstává oddělenou rezervou firmy; rezervované výplaty snižují dostupný limit, ale do skutečných nákladů vstoupí až po vyplacení.</FinanceDefinitionNote>
                {userRole === 'admin' && (
                  <FinancialSettingsCard
                    entityType="realization"
                    entityId={realizaceId}
                    values={realization}
                    disabled={!!financeLoadError}
                    onSaved={fetchData}
                  />
                )}
                {userRole === 'admin' && <BillingTracker entityType="realization" entityId={realizaceId} entityCode={linkedProjectCode} enableContractAnalysis showFinancialSummary={false} />}
                <RealizaceExtraCosts
                  realizaceId={realizaceId}
                  extraCosts={extraCosts}
                  onUpdate={fetchData}
                  canEdit={canEdit && !financeLoadError}
                />

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                      <CardTitle>Manuální náklady realizace</CardTitle>
                      <CardDescription>Evidence faktur, materiálů a ostatních výdajů</CardDescription>
                    </div>
                    {canEdit && (
                      <Button disabled={!!financeLoadError} onClick={() => { setEditingCost(null); setIsCostDialogOpen(true); }}>
                        <Plus className="w-4 h-4 mr-2" /> Přidat náklad
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
                      <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Hledat náklad..."
                          className="pl-9"
                          value={costSearch}
                          onChange={e => setCostSearch(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 md:ml-auto">
                        <span>{filteredCosts.length} záznamů</span>
                        <span className="font-semibold text-slate-900">Manuální náklady {formatCurrency(totalManualCosts)}</span>
                      </div>
                    </div>

                    <div className="rounded-md border">
                      <Table className="finance-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Popis</TableHead>
                            <TableHead>Dodavatel</TableHead>
                            <TableHead>VS</TableHead>
                            <TableHead className="text-right">Částka bez DPH</TableHead>
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
                                    <button
                                      type="button"
                                      className="inline-flex items-center text-blue-600 hover:underline"
                                      onClick={async () => {
                                        try {
                                          const result = await downloadInvoiceFromStorage({
                                            provider: cost.invoice_storage_provider,
                                            connectionId: cost.invoice_storage_connection_id,
                                            bucket: cost.invoice_storage_metadata?.bucket || 'project-files',
                                            filePath: cost.invoice_url,
                                            fileId: cost.invoice_external_file_id,
                                            fileName: cost.invoice_name,
                                            entityType: 'invoice',
                                            entityId: cost.id,
                                            accessEntityType: 'realizace',
                                            accessEntityId: realizaceId,
                                          });
                                          if (!result.success) throw new Error(result.error);
                                        } catch (error) {
                                          toast({ title: 'Fakturu se nepodařilo stáhnout', description: error.message, variant: 'destructive' });
                                        }
                                      }}
                                    >
                                      <Download className="w-3 h-3 mr-1" /> {cost.invoice_name || 'Stáhnout'}
                                    </button>
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

                <section className="space-y-4 border-t border-slate-200 pt-5">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Hodinové náklady</h3>
                    <p className="mt-1 text-sm text-slate-500">Detail odpracovaného času je součástí nákladů realizace a již nemá samostatnou hlavní záložku.</p>
                  </div>
                  <RealizaceHourlyCosts
                    realizaceId={realizaceId}
                    linkedProjectId={linkedProjectId}
                    onLinkProject={handleLinkProjectUpdate}
                    distributionAmount={calculatedFinancials.teamBudget}
                  />
                </section>

                {canViewProfit && (
                  <section className="space-y-4 border-t border-slate-200 pt-5">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">Rozdělení výsledku a odměn</h3>
                      <p className="mt-1 text-sm text-slate-500">Administrační detail odměn navazuje na stejný finanční základ jako souhrn výše.</p>
                    </div>
                    <RealizaceProfitSharing
                      realizaceId={realizaceId}
                      distributionAmount={calculatedFinancials.teamBudget}
                      sponsorDeductions={laborFinancialSummary?.sponsor_deductions || []}
                      isCompleted={realization.status === 'Dokončeno'}
                      canEdit={canEdit && !financeLoadError}
                    />
                  </section>
                )}

                <RealizaceCostDialog
                  isOpen={isCostDialogOpen}
                  onClose={() => setIsCostDialogOpen(false)}
                  onSave={handleSaveCost}
                  costData={editingCost}
                />
            </TabsContent>
          )}

          <TabsContent value="orders">
            <RealizaceOrdersTab
              realizaceId={realizaceId}
              realization={realization}
              distributionAmount={calculatedFinancials.teamBudget}
            />
          </TabsContent>

          <TabsContent value="documents">
            <SharePointFolderBrowser
              entityType="realizace"
              entity={realization}
              canEdit={canEdit}
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

        </Tabs>
      </div>
    </div>
  );
};

export default RealizaceDetail;
