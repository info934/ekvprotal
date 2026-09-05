import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { safeListReturnPath } from '@/lib/listWorkspaceState';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Edit2, Plus, Trash2, Download, Search, LayoutDashboard, DollarSign, Clock, ShoppingCart, PieChart, ChevronDown, Loader2, FolderOpen, GanttChart, Wallet, FileText, AlertTriangle, Users, EyeOff } from 'lucide-react';
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
import RealizaceTeam from './RealizaceTeam';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialHealthAlert from '@/components/FinancialHealthAlert';
import BillingTracker from '@/components/BillingTracker';
import BillingOverviewSummary from '@/components/finance/BillingOverviewSummary';
import { deleteStoredFile, uploadRealizationCostInvoice } from '@/lib/documentStorageService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import PlanningBoard from '@/components/PlanningBoard';
import { FinanceAmount, FinanceDefinitionNote, FinanceMetricStrip } from '@/components/finance/FinanceWorkspace';
import { RecordWorkspaceHeader, RecordWorkspaceNavigation, RecordWorkspaceSection } from '@/components/ui/record-workspace';
import EkvLoader from '@/components/ui/ekv-loader';
import { calculateRealizationRewardAllocation } from '@/domain/financials';
import FinancialSettingsCard from '@/components/finance/FinancialSettingsCard';
import {
  createTimedAbortController,
  isRequestAbortError,
  isRequestTimeoutError,
} from '@/lib/requestControl';

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
  const { hasPermission, userRole, isPrivateMode } = useAuth();

  const [realization, setRealization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [costs, setCosts] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [financialSummary, setFinancialSummary] = useState(null);
  const [laborFinancialSummary, setLaborFinancialSummary] = useState(null);
  const [financeLoadError, setFinanceLoadError] = useState(null);
  const loadRequestRef = useRef({ id: 0, controller: null });
  const financeRequestRef = useRef({ id: 0, controller: null });
  const loadedRealizationIdRef = useRef(null);

  // Linked project is contextual; labor costs come from the canonical ledger summary.
  const [linkedProjectId, setLinkedProjectId] = useState(null);
  const [linkedProjectCode, setLinkedProjectCode] = useState(null);

  // UI States
  const [costSearch, setCostSearch] = useState('');
  const [isCostDialogOpen, setIsCostDialogOpen] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [financeSection, setFinanceSection] = useState('summary');

  // Get visibility rules
  const { canViewAmounts, canViewCosts, canViewProfit } = getFinancialVisibility(userRole);
  const availableTabs = useMemo(() => [
    'overview',
    'plan',
    'team',
    ...(canViewCosts ? ['finance'] : []),
    'orders',
    'documents',
    'handover',
  ], [canViewCosts]);
  const workspaceGroups = [
    { label: 'Přehled', icon: LayoutDashboard, tabs: [{ value: 'overview', label: 'Přehled' }] },
    { label: 'Práce', icon: GanttChart, tabs: [{ value: 'plan', label: 'Plán' }, { value: 'orders', label: 'Objednávky' }] },
    { label: 'Lidé', icon: Users, tabs: [{ value: 'team', label: 'Tým realizace' }] },
    ...(canViewCosts ? [{ label: 'Finance', icon: DollarSign, tabs: [{ value: 'finance', label: 'Finance' }] }] : []),
    { label: 'Dokumenty', icon: FolderOpen, tabs: [{ value: 'documents', label: 'Soubory' }, { value: 'handover', label: 'Předání' }] },
  ];
  const financeSections = [
    { value: 'summary', label: 'Souhrn', icon: PieChart },
    { value: 'billing', label: 'Fakturace', icon: FileText },
    { value: 'costs', label: 'Náklady', icon: ShoppingCart },
    { value: 'rewards', label: 'Odměny', icon: Wallet },
  ];
  const requestedTab = location.hash.substring(1);
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'overview';
  const setActiveTab = useCallback((value) => navigate(`#${value}`, { replace: true, state: location.state }), [navigate, location.state]);

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
          <Button variant="ghost" size="sm" className="min-h-11 px-2 gap-1" aria-label={`Změnit stav: ${status.label}`} disabled={isUpdatingStatus}>
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

  const fetchData = useCallback(async ({ showLoader = false } = {}) => {
    loadRequestRef.current.controller?.abort();
    const requestId = loadRequestRef.current.id + 1;
    const request = createTimedAbortController(20_000);
    loadRequestRef.current = { id: requestId, controller: request.controller };
    const isCurrentRequest = () => loadRequestRef.current.id === requestId;

    if (showLoader || loadedRealizationIdRef.current !== realizaceId) setLoading(true);
    setFinanceLoadError(null);
    try {
      const { data: realData, error: realError } = await supabase.rpc('get_realization_safe', {
        p_realization_id: realizaceId,
      }).abortSignal(request.signal);

      if (!isCurrentRequest()) return false;
      if (realError) {
        toast({ title: 'Chyba', description: 'Nepodařilo se načíst realizaci.', variant: 'destructive' });
        navigate('/realizace');
        return false;
      }
      setRealization(realData);
      setLinkedProjectId(realData.linked_project_id);

      if (realData.linked_project_id) {
        const { data: linkedProject } = await supabase
          .from('projects')
          .select('code')
          .eq('id', realData.linked_project_id)
          .maybeSingle()
          .abortSignal(request.signal);
        if (!isCurrentRequest()) return false;
        setLinkedProjectCode(linkedProject?.code || null);
      } else {
        setLinkedProjectCode(null);
      }

      const shouldLoadFinancialSummary = canViewAmounts || canViewCosts || canViewProfit;
      const costsPromise = canViewCosts
        ? supabase.from('realizace_costs').select(`*, supplier:subjects!realizace_costs_supplier_id_fkey(name)`).eq('realizace_id', realizaceId).order('created_at', { ascending: false }).abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null });
      const extraCostsPromise = canViewCosts
        ? supabase.from('realizace_extra_costs').select('*').eq('realizace_id', realizaceId).order('created_at', { ascending: true }).abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null });
      const financialSummaryPromise = shouldLoadFinancialSummary
        ? supabase.rpc('realization_financial_preview', {
            p_realization_id: realizaceId,
            p_overrides: {},
            p_shares: null,
          }).abortSignal(request.signal)
        : Promise.resolve({ data: null, error: null });
      const laborSummaryPromise = shouldLoadFinancialSummary
        ? supabase.rpc('realization_labor_financial_summary', { p_realization_id: realizaceId }).abortSignal(request.signal)
        : Promise.resolve({ data: null, error: null });

      const [costsRes, extraRes, financialSummaryRes, laborSummaryRes] = await Promise.all([
        costsPromise,
        extraCostsPromise,
        financialSummaryPromise,
        laborSummaryPromise,
      ]);

      if (!isCurrentRequest()) return false;
      const financeListErrors = canViewCosts
        ? [costsRes, extraRes].map((result) => result.error?.message).filter(Boolean)
        : [];
      if (financeListErrors.length > 0) {
        setFinanceLoadError(financeListErrors.join(' · '));
      }

      if (canViewCosts) {
        setCosts(costsRes.data || []);
        setExtraCosts(extraRes.data || []);
      } else {
        setCosts([]);
        setExtraCosts([]);
      }

      if (financialSummaryRes.error) {
        console.error('realization_financial_preview failed:', financialSummaryRes.error.message);
        setFinanceLoadError(financialSummaryRes.error.message);
        setFinancialSummary(null);
      } else {
        setFinancialSummary(financialSummaryRes.data || null);
        if (shouldLoadFinancialSummary && !financialSummaryRes.data) setFinanceLoadError('Finanční souhrn není dostupný.');
      }
      if (laborSummaryRes.error) {
        console.error('realization_labor_financial_summary failed:', laborSummaryRes.error.message);
        setFinanceLoadError((current) => current || laborSummaryRes.error.message);
        setLaborFinancialSummary(null);
      } else {
        setLaborFinancialSummary(laborSummaryRes.data || null);
      }

      loadedRealizationIdRef.current = realizaceId;
      return true;
    } catch (error) {
      const timeout = isRequestTimeoutError(error) || isRequestTimeoutError(request.signal.reason);
      const superseded = request.signal.aborted && !timeout;
      if (!isCurrentRequest() || superseded || (isRequestAbortError(error) && !timeout)) return false;
      toast({
        title: 'Chyba při načítání realizace',
        description: timeout ? 'Načítání překročilo časový limit. Zkuste stránku obnovit.' : error.message,
        variant: 'destructive',
      });
      return false;
    } finally {
      request.dispose();
      if (isCurrentRequest()) setLoading(false);
    }
  }, [realizaceId, navigate, toast, canViewAmounts, canViewCosts, canViewProfit]);

  const refreshFinancialData = useCallback(async () => {
    const shouldLoadFinancialSummary = canViewAmounts || canViewCosts || canViewProfit;
    if (!canViewCosts && !shouldLoadFinancialSummary) return true;

    financeRequestRef.current.controller?.abort();
    const requestId = financeRequestRef.current.id + 1;
    const request = createTimedAbortController(15_000);
    financeRequestRef.current = { id: requestId, controller: request.controller };
    const isCurrentRequest = () => financeRequestRef.current.id === requestId;

    setFinanceLoadError(null);
    try {
      const costsPromise = canViewCosts
        ? supabase
            .from('realizace_costs')
            .select('*, supplier:subjects!realizace_costs_supplier_id_fkey(name)')
            .eq('realizace_id', realizaceId)
            .order('created_at', { ascending: false })
            .abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null });
      const extraCostsPromise = canViewCosts
        ? supabase
            .from('realizace_extra_costs')
            .select('*')
            .eq('realizace_id', realizaceId)
            .order('created_at', { ascending: true })
            .abortSignal(request.signal)
        : Promise.resolve({ data: [], error: null });
      const financialSummaryPromise = shouldLoadFinancialSummary
        ? supabase.rpc('realization_financial_preview', {
            p_realization_id: realizaceId,
            p_overrides: {},
            p_shares: null,
          }).abortSignal(request.signal)
        : Promise.resolve({ data: null, error: null });
      const laborSummaryPromise = shouldLoadFinancialSummary
        ? supabase.rpc('realization_labor_financial_summary', { p_realization_id: realizaceId }).abortSignal(request.signal)
        : Promise.resolve({ data: null, error: null });

      const [costsRes, extraRes, financialSummaryRes, laborSummaryRes] = await Promise.all([
        costsPromise,
        extraCostsPromise,
        financialSummaryPromise,
        laborSummaryPromise,
      ]);

      if (!isCurrentRequest()) return false;

      const errors = [costsRes, extraRes, financialSummaryRes, laborSummaryRes]
        .map((result) => result.error?.message)
        .filter(Boolean);
      if (errors.length > 0) {
        setFinanceLoadError(errors.join(' · '));
        return false;
      }

      if (canViewCosts) {
        setCosts(costsRes.data || []);
        setExtraCosts(extraRes.data || []);
      }
      setFinancialSummary(financialSummaryRes.data || null);
        if (shouldLoadFinancialSummary && !financialSummaryRes.data) setFinanceLoadError('Finanční souhrn není dostupný.');
      setLaborFinancialSummary(laborSummaryRes.data || null);
      return true;
    } catch (error) {
      const timeout = isRequestTimeoutError(error) || isRequestTimeoutError(request.signal.reason);
      const superseded = request.signal.aborted && !timeout;
      if (!isCurrentRequest() || superseded || (isRequestAbortError(error) && !timeout)) return false;
      const message = timeout
        ? 'Obnovení finančních dat překročilo časový limit.'
        : error.message;
      setFinanceLoadError(message);
      toast({ title: 'Finanční data se nepodařilo obnovit', description: message, variant: 'destructive' });
      return false;
    } finally {
      request.dispose();
    }
  }, [canViewAmounts, canViewCosts, canViewProfit, realizaceId, toast]);

  useEffect(() => {
    loadedRealizationIdRef.current = null;
    setRealization(null);
    setFinanceSection('summary');
    void fetchData({ showLoader: true });
    return () => {
      loadRequestRef.current.controller?.abort();
      financeRequestRef.current.controller?.abort();
      loadRequestRef.current = {
        id: loadRequestRef.current.id + 1,
        controller: null,
      };
      financeRequestRef.current = {
        id: financeRequestRef.current.id + 1,
        controller: null,
      };
    };
  }, [fetchData]);

  // --- Financial Calculations ---
  const hasFinancialSummary = !!financialSummary;
  const totalManualCosts = hasFinancialSummary ? toNumber(financialSummary.manual_costs) : 0;
  const totalExtraCostsCost = hasFinancialSummary ? toNumber(financialSummary.extra_costs) : 0;
  const totalExtraCostsSale = hasFinancialSummary ? toNumber(financialSummary.extra_revenue) : 0;
  const reservedPayouts = hasFinancialSummary ? toNumber(financialSummary.reserved_payouts) : 0;
  const paidTaskPayouts = hasFinancialSummary ? toNumber(financialSummary.paid_task_payouts) : 0;
  const paidHourlyPayouts = hasFinancialSummary ? toNumber(financialSummary.paid_hourly_payouts) : 0;
  const paidPayoutCosts = hasFinancialSummary ? toNumber(financialSummary.paid_payout_costs) : 0;
  const legacyGrandTotalCosts = hasFinancialSummary ? toNumber(financialSummary.costs_after_paid_payouts) : 0;
  const isCanonicalFinancialModel = Number(financialSummary?.financial_model_version || 0) >= 2;
  const grandTotalCosts = isCanonicalFinancialModel
    ? legacyGrandTotalCosts
    : laborFinancialSummary
    ? legacyGrandTotalCosts - paidHourlyPayouts + toNumber(laborFinancialSummary.direct_project_cost)
    : legacyGrandTotalCosts;
  const contractAmountBase = hasFinancialSummary ? toNumber(financialSummary.base_contract_amount) : Number(realization?.contract_amount || 0);
  const totalRevenue = hasFinancialSummary ? toNumber(financialSummary.total_revenue) : contractAmountBase + totalExtraCostsSale;
  
  // Available "profit" in the old sense (Revenue - Costs)
  const profitAvailable = totalRevenue - grandTotalCosts;

  // The database preview is the only financial calculation model used by
  // both the form and the detail. Lists below remain local only for rendering.
  const calculatedFinancials = useMemo(() => {
    if (!financialSummary) return {
      contractAmount: 0, profitAmount: 0, overheadAmount: 0, teamBudget: 0, totalCosts: 0
    };
    return {
      contractAmount: toNumber(financialSummary.total_revenue),
      profitAmount: toNumber(financialSummary.profit_amount),
      overheadAmount: toNumber(financialSummary.overhead_amount),
      teamBudget: toNumber(financialSummary.team_budget),
      totalCosts: toNumber(financialSummary.operational_costs),
    };
  }, [financialSummary]);

  const rewardAllocation = useMemo(() => calculateRealizationRewardAllocation(
    financialSummary?.member_shares || [],
    calculatedFinancials.teamBudget
  ), [financialSummary?.member_shares, calculatedFinancials.teamBudget]);

  // --- Cost Handlers ---
  const handleSaveCost = async (costData) => {
    if (financeLoadError) {
      toast({ title: 'Finanční data nejsou dostupná', description: 'Obnovte autoritativní finanční souhrn před provedením změny.', variant: 'destructive' });
      return false;
    }
    try {
      const costId = editingCost?.id || crypto.randomUUID();
      let fileUrl = costData.existingInvoice?.url || null;
      let fileName = costData.existingInvoice?.name || null;
      let invoiceStorageFields = {};
      let uploadedInvoice = null;
      const previousInvoiceIsLocal = editingCost?.invoice_storage_metadata?.storageRole === 'realization_cost_invoice';
      const previousInvoice = (costData.invoiceFile || costData.removeInvoice) && editingCost?.invoice_url
        ? {
            provider: editingCost.invoice_storage_provider,
            connectionId: editingCost.invoice_storage_connection_id,
            bucket: editingCost.invoice_storage_metadata?.bucket || (previousInvoiceIsLocal ? 'project-files' : 'invoices'),
            filePath: editingCost.invoice_url,
            fileId: editingCost.invoice_external_file_id,
            entityType: previousInvoiceIsLocal ? 'realizace' : 'invoice',
            entityId: previousInvoiceIsLocal ? realizaceId : editingCost.id,
            accessEntityType: previousInvoiceIsLocal ? undefined : 'realizace',
            accessEntityId: previousInvoiceIsLocal ? undefined : realizaceId,
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
        uploadedInvoice = await uploadRealizationCostInvoice({
          file,
          realization,
          costId,
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
      await refreshFinancialData();
      return true;

    } catch (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
      return false;
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
          const invoiceIsLocal = cost.invoice_storage_metadata?.storageRole === 'realization_cost_invoice';
          await deleteStoredFile({
            provider: cost.invoice_storage_provider,
            connectionId: cost.invoice_storage_connection_id,
            bucket: cost.invoice_storage_metadata?.bucket || (invoiceIsLocal ? 'project-files' : 'invoices'),
            filePath: cost.invoice_url,
            fileId: cost.invoice_external_file_id,
            entityType: invoiceIsLocal ? 'realizace' : 'invoice',
            entityId: invoiceIsLocal ? realizaceId : cost.id,
            accessEntityType: invoiceIsLocal ? undefined : 'realizace',
            accessEntityId: invoiceIsLocal ? undefined : realizaceId,
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
      void refreshFinancialData();
    }
  };

  const filteredCosts = costs.filter(c =>
    (c.description || '').toLowerCase().includes(costSearch.toLowerCase()) ||
    (c.supplier?.name || '').toLowerCase().includes(costSearch.toLowerCase())
  );

  const handleLinkProjectUpdate = (newProjectId, linkedProject = null) => {
    setLinkedProjectId(newProjectId);
    setRealization(current => current ? { ...current, linked_project_id: newProjectId } : current);
    setLinkedProjectCode(linkedProject?.code || null);
  };

  if (loading) return (
    <EkvLoader title="Načítám detail realizace" description="Připravuji průběh zakázky, tým, dokumenty a finance." />
  );

  if (!realization) return null;

  return (
    <div>
      <RecordWorkspaceHeader
        title={realization.name}
        subtitle={realization.code}
        onBack={() => navigate(safeListReturnPath(location.state?.returnTo, '/realizace'))}
        backLabel="Zpět na realizace"
        status={renderStatusMenu()}
        actions={canEdit && (
          <Button size="sm" onClick={() => navigate(`/realizace/${realizaceId}/edit`)}>
            <Edit2 className="mr-2 h-4 w-4" />Upravit
          </Button>
        )}
      />

      <div className="app-page-wide">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
          <RecordWorkspaceNavigation groups={workspaceGroups} activeTab={activeTab} onTabChange={setActiveTab} ariaLabel="Sekce realizace" />

          <TabsContent value="overview">
            <div className="space-y-6">
              {canViewAmounts && !isPrivateMode && financialSummary && !financeLoadError && (
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
                linkedProjectCode={linkedProjectCode}
                canEdit={canEdit}
                onEdit={() => navigate(`/realizace/${realizaceId}/edit`)}
              />
              {userRole === 'admin' && (
                <BillingOverviewSummary
                  compact
                  entityType="realization"
                  entityId={realizaceId}
                  onOpenDetails={() => { setFinanceSection('billing'); setActiveTab('finance'); }}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="plan">
            <PlanningBoard entityType="realization" entityId={realizaceId} embedded canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="team">
            <RealizaceTeam realizaceId={realizaceId} />
          </TabsContent>

          {canViewCosts && (
            <TabsContent value="finance" className="space-y-5">
              {isPrivateMode ? (
                <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-5" role="status">
                  <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div><h2 className="font-semibold">Finance jsou v soukromém režimu skryté</h2><p className="mt-1 text-sm text-muted-foreground">Pro prohlížení částek a úpravy finančních údajů vypněte soukromý režim v postranním menu.</p></div>
                </div>
              ) : <>
                {financeLoadError && (
                  <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Finanční přehled se nepodařilo načíst</p>
                      <p className="mt-1 text-red-700">Výpočty z databáze se nepodařilo načíst. Finanční změny jsou do obnovení dat pozastavené.</p>
                      <Button variant="outline" className="mt-3 min-h-11" onClick={refreshFinancialData}>Zkusit znovu</Button>
                    </div>
                  </div>
                )}
                {!financeLoadError && hasFinancialSummary && <>
                <nav aria-label="Finanční přehledy realizace" className="flex flex-wrap gap-2">
                  {financeSections.map(({ value, label, icon: Icon }) => <Button key={value} type="button" variant={financeSection === value ? 'secondary' : 'ghost'} className="min-h-11 gap-2" aria-pressed={financeSection === value} aria-controls={`realization-finance-${value}`} onClick={() => setFinanceSection(value)}><Icon className="h-4 w-4" />{label}</Button>)}
                </nav>
                <RecordWorkspaceSection active={financeSection === 'summary'} id="realization-finance-summary" aria-label="Finanční souhrn" className="space-y-5">
                <FinanceMetricStrip className="2xl:grid-cols-4" metrics={[
                  { label: 'Výnos zakázky bez DPH', value: <FinanceAmount value={totalRevenue} />, detail: 'Smlouva a schválené vícepráce', tone: 'neutral', icon: DollarSign },
                  { label: 'Skutečné náklady', value: <FinanceAmount value={grandTotalCosts} />, detail: 'Včetně vyplacených odměn', tone: 'neutral', icon: Download },
                  { label: 'Zbývá rozdělit týmu', value: <FinanceAmount value={rewardAllocation.unallocatedBudget} />, detail: 'Po nákladech a naplánovaných podílech', tone: Number(rewardAllocation.unallocatedBudget || 0) < 0 ? 'negative' : 'positive', icon: Wallet },
                  { label: 'Režie realizace', value: <FinanceAmount value={calculatedFinancials.overheadAmount} />, detail: `${Number(realization.overhead_percent || 0).toLocaleString('cs-CZ')} % z výnosu`, tone: 'warning', icon: FileText },
                  { label: 'Rezervované výplaty', value: <FinanceAmount value={reservedPayouts} />, detail: 'Závazek, zatím ne náklad', tone: Number(reservedPayouts || 0) ? 'warning' : 'neutral', icon: Clock },
                  { label: 'Vyplacené odměny', value: <FinanceAmount value={paidPayoutCosts} />, detail: 'Součást skutečných nákladů', tone: 'neutral', icon: DollarSign },
                  { label: 'Plánovaná marže', value: <FinanceAmount value={calculatedFinancials.profitAmount} />, detail: `${Number(realization.profit_margin_percent || 0).toLocaleString('cs-CZ')} % z výnosu`, tone: Number(calculatedFinancials.profitAmount || 0) < 0 ? 'negative' : 'positive', icon: PieChart },
                  { label: 'Provozní zůstatek', value: <FinanceAmount value={profitAvailable} />, detail: 'Výnos minus skutečné náklady', tone: Number(profitAvailable || 0) < 0 ? 'negative' : 'positive', icon: Wallet },
                ]} />
                <FinanceDefinitionNote>Částka k rozdělení týmu zbývá po odečtení skutečných nákladů a naplánovaných podílů. Režie zůstává oddělenou rezervou firmy; rezervované výplaty snižují dostupný limit, ale do skutečných nákladů vstoupí až po vyplacení.</FinanceDefinitionNote>
                {userRole === 'admin' && (
                  <FinancialSettingsCard
                    entityType="realization"
                    entityId={realizaceId}
                    values={realization}
                    disabled={!!financeLoadError}
                    onSaved={fetchData}
                  />
                )}
                </RecordWorkspaceSection>
                <RecordWorkspaceSection active={financeSection === 'billing'} id="realization-finance-billing" aria-label="Fakturace realizace">
                  {userRole === 'admin' && <BillingTracker entityType="realization" entityId={realizaceId} entityCode={realization.code} enableContractAnalysis showFinancialSummary={false} />}
                </RecordWorkspaceSection>
                <RecordWorkspaceSection active={financeSection === 'costs'} id="realization-finance-costs" aria-label="Náklady realizace" className="space-y-5">
                <RealizaceExtraCosts
                  realizaceId={realizaceId}
                  extraCosts={extraCosts}
                  onUpdate={refreshFinancialData}
                  canEdit={canEdit && !financeLoadError}
                />

                <Card>
                  <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
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
                          placeholder="Hledat náklad nebo dodavatele…"
                          aria-label="Hledat náklad nebo dodavatele"
                          className="pl-9"
                          value={costSearch}
                          onChange={e => setCostSearch(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 md:ml-auto">
                        <span>{filteredCosts.length} záznamů</span>
                        <span className="font-semibold text-slate-900">Manuální náklady <FinanceAmount value={totalManualCosts} /></span>
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
                                <TableCell className="text-right font-bold"><FinanceAmount value={cost.amount} /></TableCell>
                                <TableCell className="text-right">
                                  {cost.invoice_url && (
                                    <button
                                      type="button"
                                      className="inline-flex min-h-11 items-center text-blue-600 hover:underline"
                                      onClick={async () => {
                                        try {
                                          const invoiceIsLocal = cost.invoice_storage_metadata?.storageRole === 'realization_cost_invoice';
                                          const result = await downloadInvoiceFromStorage({
                                            provider: cost.invoice_storage_provider,
                                            connectionId: cost.invoice_storage_connection_id,
                                            bucket: cost.invoice_storage_metadata?.bucket || (invoiceIsLocal ? 'project-files' : 'invoices'),
                                            filePath: cost.invoice_url,
                                            fileId: cost.invoice_external_file_id,
                                            fileName: cost.invoice_name,
                                            entityType: invoiceIsLocal ? 'realizace' : 'invoice',
                                            entityId: invoiceIsLocal ? realizaceId : cost.id,
                                            accessEntityType: invoiceIsLocal ? undefined : 'realizace',
                                            accessEntityId: invoiceIsLocal ? undefined : realizaceId,
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
                                      <Button variant="ghost" size="icon" aria-label={`Upravit náklad: ${cost.description}`} onClick={() => { setEditingCost(cost); setIsCostDialogOpen(true); }}>
                                        <Edit2 className="w-4 h-4" />
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon" aria-label={`Smazat náklad: ${cost.description}`} className="text-red-500 hover:text-red-600">
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
                    <p className="mt-1 text-sm text-slate-500">Odpracovaný čas a jeho náklad podle pracovníků.</p>
                  </div>
                  <RealizaceHourlyCosts
                    realizaceId={realizaceId}
                    linkedProjectId={linkedProjectId}
                    onLinkProject={handleLinkProjectUpdate}
                  />
                </section>

                </RecordWorkspaceSection>
                {canViewProfit && (
                  <RecordWorkspaceSection active={financeSection === 'rewards'} id="realization-finance-rewards" aria-label="Odměny týmu" className="space-y-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">Rozdělení výsledku a odměn</h3>
                      <p className="mt-1 text-sm text-slate-500">Nastavte podíly členů a zkontrolujte, kolik z týmového rozpočtu zbývá rozdělit.</p>
                    </div>
                    <RealizaceProfitSharing
                      realizaceId={realizaceId}
                      distributionAmount={calculatedFinancials.teamBudget}
                      onSaved={refreshFinancialData}
                      sponsorDeductions={laborFinancialSummary?.sponsor_deductions || []}
                      isCompleted={['Dokončeno', 'Předáno'].includes(realization.status)}
                      canEdit={canEdit && !financeLoadError}
                    />
                  </RecordWorkspaceSection>
                )}

                <RealizaceCostDialog
                  isOpen={isCostDialogOpen}
                  onClose={() => setIsCostDialogOpen(false)}
                  onSave={handleSaveCost}
                  costData={editingCost}
                />
                </>}
              </>}
            </TabsContent>
          )}

          <TabsContent value="orders">
            <RealizaceOrdersTab
              realizaceId={realizaceId}
              realization={realization}
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
