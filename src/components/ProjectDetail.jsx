import MeetingNotes from '@/components/MeetingNotes';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { recordReturnPath, taskIsDone, taskIsOpen, taskIsCancelled, taskProgress } from '@/lib/listWorkspaceState';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Edit2, Trash2, DollarSign, Users, ClipboardList, Plus, BookOpen, Link2, Save, Target, Calendar, User, FileText, ChevronDown, ChevronUp, Briefcase, Wallet, Contact, UserCheck, Loader2, Copy, AlertTriangle, Clock, History, GanttChart, MoreHorizontal } from 'lucide-react';
import AssignMemberDialog from '@/components/AssignMemberDialog';
import AssignSubcontractorDialog from '@/components/AssignSubcontractorDialog';
import ProjectCostDialog from '@/components/ProjectCostDialog';
import ProjectEngineering from '@/components/ProjectEngineering';
import ProjectTasks from '@/components/ProjectTasks';
import ProjectLinkDialog from '@/components/ProjectLinkDialog';
import ProjectContacts from '@/components/ProjectContacts';
import SaveTemplateModal from '@/components/SaveTemplateModal';
import HandoverProtocolsTab from '@/components/HandoverProtocolsTab';
import SharePointFolderBrowser from '@/components/SharePointFolderBrowser';
import { Textarea } from '@/components/ui/textarea';
import { cn, projectStatusConfig } from '@/lib/utils';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
    calculateProjectBudget,
    calculateProjectFinancials,
    calculateProjectMemberNetReward,
    calculateProjectMemberReward,
    calculateProjectRewardPool,
    getProjectFinancialHealthInputs,
    normalizeProjectMemberRewardSummary,
    sumProjectCostsForMember,
    sumUnassignedProjectCosts,
    toAmount
} from '@/domain/financials';
import { DataVizMetricCard } from '@/components/ui/data-viz';
import EkvLoader from '@/components/ui/ekv-loader';
import FinancialHealthAlert from '@/components/FinancialHealthAlert';
import BillingTracker from '@/components/BillingTracker';
import BillingOverviewSummary from '@/components/finance/BillingOverviewSummary';
import { deleteStoredFile, uploadProjectCostInvoice } from '@/lib/documentStorageService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import PlanningBoard from '@/components/PlanningBoard';
import { FinanceAmount, FinanceDefinitionNote, FinanceMetricStrip } from '@/components/finance/FinanceWorkspace';
import { formatMoney } from '@/lib/financePresentation';
import { RecordMetricGrid, RecordWorkspaceHeader, RecordWorkspaceNavigation, RecordWorkspaceSection } from '@/components/ui/record-workspace';
import { formatProjectDate, projectTaskIsOverdue, projectTaskOverview, loadProjectTasks } from '@/lib/projectDetailWorkspace';
import ProjectBonuses from '@/components/finance/ProjectBonuses';
import FinancialSettingsCard from '@/components/finance/FinancialSettingsCard';
import {
    createTimedAbortController,
    isRequestAbortError,
    isRequestTimeoutError,
} from '@/lib/requestControl';

const StatCard = ({ title, value, icon: Icon, color = "default", subtitle, progress }) => {
  const tone = color === 'success' ? 'emerald' : color === 'warning' ? 'amber' : color === 'danger' ? 'rose' : color === 'info' ? 'blue' : 'slate';
  const barTone = color === 'success' ? 'bg-emerald-500' : color === 'warning' ? 'bg-amber-500' : color === 'danger' ? 'bg-rose-500' : color === 'info' ? 'bg-blue-500' : 'bg-slate-500';

  return (
    <div className="relative">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 sm:hidden">
        <span className="text-xs font-medium text-slate-500">{title}</span>
        <strong className="text-right text-lg font-semibold tabular-nums text-slate-950">{value}</strong>
      </div>
      <DataVizMetricCard icon={Icon} label={title} value={value} detail={subtitle} tone={tone} className={cn('hidden sm:flex', typeof progress === 'number' && 'pb-8')} />
      {typeof progress === 'number' && (
        <div className="absolute inset-x-4 bottom-4 hidden h-2 overflow-hidden rounded-full bg-slate-100 sm:block">
          <div className={cn('h-full rounded-full transition-all', barTone)} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
};

const InfoCard = ({ label, value, subValue, icon: Icon, isLink = false, to = '#' }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:border-blue-200 hover:shadow-md">
        <div className="flex items-start gap-3">
            {Icon && <div className="rounded-lg bg-slate-100 p-2 text-slate-600"><Icon className="h-4 w-4" /></div>}
            <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                {isLink ? (
                    <a href={to} className="mt-1 block truncate font-semibold text-slate-950 transition-colors hover:text-primary">{value || '-'}</a>
                ) : (
                    <p className="mt-1 truncate font-semibold text-slate-950">{value || '-'}</p>
                )}
                {subValue && (
                    <p className="mt-1 truncate text-xs text-slate-500">{subValue}</p>
                )}
            </div>
        </div>
    </div>
);

export const ProjectOverviewPanels = ({ project, tasks = [], onOpenTab, onOpenTask, descriptionPanel, operationalLoadError }) => {
    const { overdue, missingDates, upcoming } = projectTaskOverview(tasks);
    const fields = [
        { label: 'Hlavní projektant', value: project.project_manager?.name || 'Nepřiřazen', to: project.project_manager?.id ? `/members/${project.project_manager.id}` : null },
        { label: 'Termín dokončení', value: formatProjectDate(project.completion_date, 'Není stanoven') },
        { label: 'Investor', value: project.investor?.name || 'Neuveden', to: project.investor?.id ? `/subjects/${project.investor.id}` : null },
        { label: 'Zadavatel', value: project.client?.name || 'Neuveden', to: project.client?.id ? `/subjects/${project.client.id}` : null },
        { label: 'Stupeň dokumentace', value: project.stage?.name || 'Neuveden' },
    ];
    return <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="space-y-5">
            <Card><CardHeader className="px-5 pb-3 pt-5"><h2 className="text-base font-semibold">Základní informace</h2></CardHeader><CardContent className="px-5 pb-5">
                <dl className="grid gap-x-6 sm:grid-cols-2">{fields.map(field => <div key={field.label} className="min-w-0 border-b border-slate-100 py-3">
                    <dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="mt-1 break-words text-sm font-medium">{field.to ? <Link to={field.to} className="text-primary hover:underline">{field.value}</Link> : field.value}</dd>
                </div>)}</dl>
            </CardContent></Card>
            {descriptionPanel}
        </div>
        <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5"><h2 className="text-base font-semibold">Nejbližší úkoly</h2><Button variant="ghost" size="sm" onClick={() => onOpenTab('tasks')}>Otevřít úkoly</Button></CardHeader><CardContent className="px-5 pb-5">
            {!operationalLoadError && (overdue.length > 0 || missingDates.length > 0) && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 shrink-0" />Je potřeba doplnit plán práce</p>
                <p className="mt-1">{[overdue.length > 0 && `${overdue.length} po termínu`, missingDates.length > 0 && `${missingDates.length} bez platného termínu`].filter(Boolean).join(' · ')}. Upravte termíny nebo dokončené úkoly uzavřete.</p>
            </div>}
            {operationalLoadError ? <p className="text-sm text-muted-foreground">Úkoly se nepodařilo načíst.</p> : upcoming.length ? <div className="divide-y rounded-lg border">{upcoming.map(task => <button type="button" key={task.id} onClick={() => onOpenTask ? onOpenTask(task) : onOpenTab('tasks')} className="flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block break-words font-medium text-primary">{task.name}</span><span className="mt-1 block text-xs text-muted-foreground">{task.member?.name || 'Řešitel nepřiřazen'}</span></span><span className={cn('shrink-0 text-xs', projectTaskIsOverdue(task) ? 'font-medium text-amber-700' : 'text-muted-foreground')}>{formatProjectDate(task.end_date, 'Bez termínu', 'd. M.')}</span>
            </button>)}</div> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Projekt nemá otevřené úkoly. Další práci naplánujete v záložce Úkoly.</p>}
        </CardContent></Card>
    </div>;
};

const StatusBadge = ({ status, config }) => (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors", config?.color || "bg-gray-100 text-gray-800")}>
        {config?.label || status}
    </span>
);

const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = true, actions }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <Card>
            <CardHeader className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" aria-expanded={isOpen} className="flex min-h-[44px] flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setIsOpen(!isOpen)}>
                        {Icon && <Icon className="h-5 w-5 text-primary" />}
                        <h3 className="text-lg font-semibold">{title}</h3>
                    </button>
                    <div className="flex items-center gap-2">
                        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
                        <Button variant="ghost" size="icon" aria-label={`${isOpen ? 'Sbalit' : 'Rozbalit'} ${title}`} aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
                    </div>
                </div>
            </CardHeader>
            {isOpen && <CardContent className="p-4">{children}</CardContent>}
        </Card>
    );
};

const ProjectDetail = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();
    const { hasPermission, isPrivateMode, memberId, user, isAdmin } = useAuth();

    const [project, setProject] = useState(null);
    const [members, setMembers] = useState([]);
    const [subcontractors, setSubcontractors] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [costs, setCosts] = useState([]);
    const [overheadCosts, setOverheadCosts] = useState([]);
    const [payoutItems, setPayoutItems] = useState([]);
    const [projectFinancialSummary, setProjectFinancialSummary] = useState(null);
    const [projectLaborSummary, setProjectLaborSummary] = useState(null);
    const [financeLoadError, setFinanceLoadError] = useState(null);
    const [operationalLoadError, setOperationalLoadError] = useState(null);
    const [projectLinks, setProjectLinks] = useState([]);
    const [loading, setLoading] = useState(true);
    const loadRequestRef = useRef({ id: 0, controller: null });
    const financeRequestRef = useRef({ id: 0, controller: null });
    const loadedProjectIdRef = useRef(null);
    const [briefContent, setBriefContent] = useState('');
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

    const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [isSubcontractorDialogOpen, setIsSubcontractorDialogOpen] = useState(false);
    const [editingSubcontractor, setEditingSubcontractor] = useState(null);
    const [isCostDialogOpen, setIsCostDialogOpen] = useState(false);
    const [editingCost, setEditingCost] = useState(null);
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
    const [editingLink, setEditingLink] = useState(null);
    const [isEditingBrief, setIsEditingBrief] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);
    
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [financeSection, setFinanceSection] = useState('summary');

    const canEdit = useMemo(() => hasPermission('projects', 'can_edit'), [hasPermission]);
    const canViewHistory = isAdmin;
    const canViewFinance = isAdmin && !isPrivateMode;

    const updateProjectStatus = useCallback(async (nextStatus) => {
        if (!project || isUpdatingStatus) return;
        setIsUpdatingStatus(true);
        try {
            const { data, error } = await supabase.rpc('update_project_status', {
                p_project_id: project.id,
                p_next_status: nextStatus,
            });
            if (error) throw error;
            setProject((prev) => (prev ? { ...prev, ...data } : prev));
            toast({ title: 'Stav projektu aktualizován', description: projectStatusConfig[data?.status || nextStatus]?.label || data?.status || nextStatus });
        } catch (error) {
            toast({ title: 'Chyba změny stavu', description: error.message, variant: 'destructive' });
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [project, toast, isUpdatingStatus]);

    const renderStatusMenu = () => {
        if (!project) return null;
        const label = projectStatusConfig[project.status]?.label || project.status;
        if (!canEdit) return <StatusBadge status={project.status} config={projectStatusConfig[project.status]} />;
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" aria-label="Změnit stav projektu" className="min-h-11 px-2 gap-1">
                        <Badge className={cn("font-normal max-w-[160px] truncate text-xs", projectStatusConfig[project.status]?.color)} title={label}>
                            {label}
                        </Badge>
                        {isUpdatingStatus ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {Object.entries(projectStatusConfig).map(([key, conf]) => (
                        <DropdownMenuItem key={key} disabled={isUpdatingStatus || project.status === key} onClick={() => updateProjectStatus(key)}>
                            <span className={cn("w-2 h-2 rounded-full mr-2", conf.color.split(' ')[0])} />{conf.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    const refreshData = useCallback(async ({ showLoader = false } = {}) => {
        loadRequestRef.current.controller?.abort();
        const requestId = loadRequestRef.current.id + 1;
        const request = createTimedAbortController(20_000);
        loadRequestRef.current = { id: requestId, controller: request.controller };
        const isCurrentRequest = () => loadRequestRef.current.id === requestId;

        if (showLoader || loadedProjectIdRef.current !== projectId) setLoading(true);
        setFinanceLoadError(null);
        setOperationalLoadError(null);
        try {
            const { data: projectData, error: projectError } = await supabase.rpc('get_project_safe', {
                p_project_id: projectId,
            }).abortSignal(request.signal);

            if (!isCurrentRequest()) return false;
              
            if (projectError) {
                toast({ title: 'Chyba při načítání projektu', variant: 'destructive', description: projectError.message });
                navigate('/projects');
                return false;
            }
            setProject(projectData);
            setBriefContent(projectData.brief || '');

            const payoutItemsPromise = canViewFinance
                ? supabase.from('payout_items').select('id, amount, project_id, payouts(status, member:members!payouts_member_id_fkey(name))').eq('project_id', projectId).abortSignal(request.signal)
                : Promise.resolve({ data: [], error: null });
            const financialSummaryPromise = canViewFinance
                ? supabase.rpc('project_financial_summary', { p_project_id: projectId }).abortSignal(request.signal)
                : Promise.resolve({ data: null, error: null });
            const laborSummaryPromise = canViewFinance
                ? supabase.rpc('project_labor_financial_summary', { p_project_id: projectId }).abortSignal(request.signal)
                : Promise.resolve({ data: null, error: null });
            const costsPromise = canViewFinance
                ? supabase.from('project_costs').select('*, member:members!project_costs_member_id_fkey(id, name, email)').eq('project_id', projectId).abortSignal(request.signal)
                : Promise.resolve({ data: [], error: null });
            const overheadCostsPromise = canViewFinance
                ? supabase.from('project_overhead_costs').select('*, overhead_allocation_items!inner(overhead_costs(name, category))').eq('project_id', projectId).abortSignal(request.signal)
                : Promise.resolve({ data: [], error: null });

            const [membersRes, subcontractorsRes, tasksRes, costsRes, linksRes, overheadCostsRes, payoutItemsRes, financialSummaryRes, laborSummaryRes] = await Promise.all([
                supabase.rpc('list_project_members_safe', { p_project_id: projectId }).abortSignal(request.signal),
                supabase.rpc('list_project_subcontractors_safe', { p_project_id: projectId }).abortSignal(request.signal),
                loadProjectTasks(supabase, projectId, request.signal).then(data => ({ data, error: null }), error => ({ data: [], error })),
                costsPromise,
                supabase.from('project_links').select('*').eq('project_id', projectId).abortSignal(request.signal),
                overheadCostsPromise,
                payoutItemsPromise,
                financialSummaryPromise,
                laborSummaryPromise,
            ]);

            if (!isCurrentRequest()) return false;

            const operationalErrors = [membersRes, subcontractorsRes, tasksRes, linksRes]
                .map((result) => result.error?.message)
                .filter(Boolean);
            if (operationalErrors.length > 0) {
                setOperationalLoadError(operationalErrors.join(' · '));
            }
            const financeErrors = canViewFinance
                ? [costsRes, overheadCostsRes, payoutItemsRes].map((result) => result.error?.message).filter(Boolean)
                : [];
            if (financeErrors.length > 0) {
                setFinanceLoadError(financeErrors.join(' · '));
            }

            setMembers(membersRes.data || []);
            setSubcontractors(subcontractorsRes.data || []);
            setTasks(tasksRes.data || []);
            setCosts(costsRes.data || []);
            setProjectLinks(linksRes.data || []);
            setOverheadCosts(overheadCostsRes.data || []);
            setPayoutItems(payoutItemsRes.data || []);
            if (financialSummaryRes.error) {
                console.error('project_financial_summary failed:', financialSummaryRes.error.message);
                setFinanceLoadError(financialSummaryRes.error.message);
                setProjectFinancialSummary(null);
            } else {
                setProjectFinancialSummary(financialSummaryRes.data || null);
            }
            if (laborSummaryRes.error) {
                console.error('project_labor_financial_summary failed:', laborSummaryRes.error.message);
                setFinanceLoadError((current) => current || laborSummaryRes.error.message);
                setProjectLaborSummary(null);
            } else {
                setProjectLaborSummary(laborSummaryRes.data || null);
            }
            loadedProjectIdRef.current = projectId;
            return true;
        } catch (error) {
            const timeout = isRequestTimeoutError(error) || isRequestTimeoutError(request.signal.reason);
            const superseded = request.signal.aborted && !timeout;
            if (!isCurrentRequest() || superseded || (isRequestAbortError(error) && !timeout)) return false;
            toast({ title: 'Chyba při načítání dat', variant: 'destructive', description: error.message });
            return false;
        } finally {
            request.dispose();
            if (isCurrentRequest()) setLoading(false);
        }
    }, [projectId, toast, navigate, canViewFinance]);

    const refreshFinancialData = useCallback(async () => {
        if (!canViewFinance) return true;

        financeRequestRef.current.controller?.abort();
        const requestId = financeRequestRef.current.id + 1;
        const request = createTimedAbortController(15_000);
        financeRequestRef.current = { id: requestId, controller: request.controller };
        const isCurrentRequest = () => financeRequestRef.current.id === requestId;

        setFinanceLoadError(null);
        try {
            const [costsRes, overheadCostsRes, payoutItemsRes, financialSummaryRes, laborSummaryRes] = await Promise.all([
                supabase
                    .from('project_costs')
                    .select('*, member:members!project_costs_member_id_fkey(id, name, email)')
                    .eq('project_id', projectId)
                    .abortSignal(request.signal),
                supabase
                    .from('project_overhead_costs')
                    .select('*, overhead_allocation_items!inner(overhead_costs(name, category))')
                    .eq('project_id', projectId)
                    .abortSignal(request.signal),
                supabase
                    .from('payout_items')
                    .select('id, amount, project_id, payouts(status, member:members!payouts_member_id_fkey(name))')
                    .eq('project_id', projectId)
                    .abortSignal(request.signal),
                supabase.rpc('project_financial_summary', { p_project_id: projectId }).abortSignal(request.signal),
                supabase.rpc('project_labor_financial_summary', { p_project_id: projectId }).abortSignal(request.signal),
            ]);

            if (!isCurrentRequest()) return false;

            const errors = [costsRes, overheadCostsRes, payoutItemsRes, financialSummaryRes, laborSummaryRes]
                .map((result) => result.error?.message)
                .filter(Boolean);
            if (errors.length > 0) {
                setFinanceLoadError(errors.join(' · '));
                return false;
            }

            setCosts(costsRes.data || []);
            setOverheadCosts(overheadCostsRes.data || []);
            setPayoutItems(payoutItemsRes.data || []);
            setProjectFinancialSummary(financialSummaryRes.data || null);
            setProjectLaborSummary(laborSummaryRes.data || null);
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
    }, [canViewFinance, projectId, toast]);

    useEffect(() => {
        loadedProjectIdRef.current = null;
        setProject(null);
        void refreshData({ showLoader: true });
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
    }, [refreshData]);

    const paidPayoutItems = useMemo(() => {
        if (!canViewFinance || payoutItems.length === 0) return [];
        return payoutItems.filter((item) => {
            const relatedPayout = Array.isArray(item.payouts) ? item.payouts[0] : item.payouts;
            return relatedPayout?.status === 'paid';
        });
    }, [payoutItems, canViewFinance]);

    const paidOutAmount = useMemo(() => paidPayoutItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0), [paidPayoutItems]);

    const sponsorDeductionByMember = useMemo(() => {
        const deductions = Array.isArray(projectLaborSummary?.sponsor_deductions) ? projectLaborSummary.sponsor_deductions : [];
        return new Map(deductions.map((entry) => [String(entry.sponsor_member_id), toAmount(entry.amount)]));
    }, [projectLaborSummary]);

    const getSponsoredLaborDeduction = useCallback((targetMemberId) => (
        sponsorDeductionByMember.get(String(targetMemberId)) || 0
    ), [sponsorDeductionByMember]);

    const buildRewardSnapshot = useCallback((sourceMembers = members, sourceCosts = costs, sourceSummary = projectFinancialSummary) => {
        if (!canViewFinance || !project) return [];
        const fallbackFinancials = calculateProjectFinancials({
            project,
            members: sourceMembers,
            subcontractors,
            costs: sourceCosts,
            overheadCosts,
            paidOutAmount,
        });
        const isCanonicalModel = Number(sourceSummary?.financial_model_version || 0) >= 2;
        const rewardBaseBudget = sourceSummary
            ? isCanonicalModel
                ? toAmount(sourceSummary.cost_adjusted_team_budget ?? sourceSummary.remaining_after_costs)
                : toAmount(sourceSummary.team_budget_after_paid_payouts ?? sourceSummary.remaining_after_costs ?? sourceSummary.team_budget)
                  + (projectLaborSummary ? toAmount(sourceSummary.paid_hourly_payouts) - toAmount(projectLaborSummary.direct_project_cost) : 0)
            : toAmount(fallbackFinancials.remainingAfterCosts) - toAmount(paidOutAmount);

        const rewardPool = calculateProjectRewardPool(sourceMembers, rewardBaseBudget);
        return (sourceMembers || []).map((assignment) => {
            const grossReward = calculateProjectMemberReward(assignment, rewardBaseBudget, {
                percentageRewardPool: rewardPool.percentageRewardPool,
            });
            const assignedCosts = sumProjectCostsForMember(sourceCosts, assignment.member_id);
            const sponsoredLaborCosts = getSponsoredLaborDeduction(assignment.member_id);
            return {
                member_id: assignment.member_id,
                member_name: assignment.member?.name || assignment.member?.email || 'Neznámý člen',
                reward_type: assignment.reward_type,
                reward_percentage: toAmount(assignment.reward_percentage),
                reward_fixed_amount: toAmount(assignment.reward_amount),
                gross_reward: grossReward,
                assigned_costs: assignedCosts + sponsoredLaborCosts,
                sponsored_labor_costs: sponsoredLaborCosts,
                total_reward: Math.max(0, grossReward - assignedCosts - sponsoredLaborCosts),
            };
        });
    }, [canViewFinance, project, members, costs, projectFinancialSummary, projectLaborSummary, subcontractors, overheadCosts, paidOutAmount, getSponsoredLaborDeduction]);

    const fetchBackendRewardSnapshot = useCallback(async () => {
        if (!canViewFinance) return [];
        const { data, error } = await supabase.rpc('project_financial_summary', { p_project_id: projectId });
        if (error) throw error;
        const rows = Array.isArray(data?.member_rewards) ? data.member_rewards : [];
        return rows.map((rawRow) => {
            const row = normalizeProjectMemberRewardSummary(rawRow);
            return {
                member_id: row.member_id,
                member_name: members.find((assignment) => String(assignment.member_id) === String(row.member_id))?.member?.name || row.member_id,
                reward_type: row.reward_type,
                reward_percentage: toAmount(row.reward_percentage),
                reward_fixed_amount: toAmount(row.reward_amount),
                gross_reward: toAmount(row.gross_reward),
                assigned_costs: toAmount(row.assigned_costs),
                direct_assigned_costs: toAmount(row.direct_assigned_costs),
                sponsored_labor_costs: toAmount(row.sponsored_labor_costs),
                total_deductions: toAmount(row.total_deductions),
                total_reward: toAmount(row.total_reward),
            };
        });
    }, [canViewFinance, members, projectId]);

    const logRewardSnapshot = useCallback(async ({ action, table, itemId, before }) => {
        if (!canViewFinance || !project) return;
        try {
            const after = await fetchBackendRewardSnapshot();

            await supabase.from('audit_logs').insert({
                user_id: user?.id || null,
                user_email: user?.email || null,
                action: 'project_reward_snapshot',
                details: {
                    project_id: projectId,
                    project_name: project.name,
                    source_action: action,
                    source_table: table,
                    source_id: itemId || null,
                    before,
                    after,
                },
            });
        } catch (error) {
            console.warn('Failed to write project reward history:', error.message);
        }
    }, [canViewFinance, fetchBackendRewardSnapshot, project, projectId, user]);

    const handleSaveGeneric = async (table, data, id, dialogSetter, editingState) => {
        const changesFinancialModel = ['project_members', 'project_subcontractors', 'project_costs'].includes(table);
        if (financeLoadError && changesFinancialModel) {
            toast({ title: 'Finanční data nejsou dostupná', description: 'Obnovte autoritativní finanční souhrn před provedením změny.', variant: 'destructive' });
            return false;
        }
        const payload = { ...data, project_id: projectId };
        // Member assignment writes are audited transactionally by the RPC.
        const shouldLogRewards = ['project_subcontractors', 'project_costs'].includes(table);
        const rewardSnapshotBefore = shouldLogRewards ? buildRewardSnapshot() : null;
        let result;
        if (table === 'projects') {
            result = await supabase.rpc('save_project_safe', {
                p_project_id: projectId,
                p_payload: data,
                p_next_status: null,
            });
        } else if (table === 'project_members') {
            result = await supabase.rpc('save_project_member_safe', {
                p_project_id: projectId,
                p_assignment_id: id || null,
                p_payload: data,
            });
        } else if (table === 'project_subcontractors') {
            result = await supabase.rpc('save_project_subcontractor_safe', {
                p_project_id: projectId,
                p_assignment_id: id || null,
                p_payload: data,
            });
        } else {
            const query = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert(payload);
            result = await query;
        }
        const { error } = result;
        if (error) {
            const rewardBudgetMatch = error.message?.match(/Project rewards exceed the current team budget by\s+([\d.]+)/i);
            const committedPayoutConflict = error.message?.includes('Automatic reward rebalance would reduce a member below already committed payouts');
            const description = rewardBudgetMatch
                ? `Součet odměn překračuje dostupný fond o ${toAmount(rewardBudgetMatch[1]).toLocaleString('cs-CZ')} Kč. Nejprve upravte existující podíly členů týmu.`
                : committedPayoutConflict
                    ? 'Automatický přepočet by snížil odměnu některého člena pod již schválenou nebo vyplacenou částku. Podíly upravte ručně.'
                    : error.message;
            toast({ title: 'Chyba při ukládání', variant: 'destructive', description });
            return false;
        }
        else {
            toast({ title: '✅ Uloženo' });
            if (shouldLogRewards) {
                const savedId = result?.data?.id || id || data?.id || null;
                await logRewardSnapshot({ action: id ? 'update' : 'create', table, itemId: savedId, before: rewardSnapshotBefore });
            }
            if (dialogSetter) dialogSetter(false);
            if (editingState) editingState(null);
            refreshData();
            return true;
        }
    };

    const deleteProjectCostStorage = async (cost) => {
        if (!cost?.invoice_url) return;
        const metadata = cost.invoice_storage_metadata || {};
        const isCentralCostInvoice = metadata.storageRole === 'central_cost_invoice';
        const deletions = [deleteStoredFile({
            provider: cost.invoice_storage_provider,
            connectionId: cost.invoice_storage_connection_id,
            bucket: metadata.bucket || (isCentralCostInvoice ? 'invoices' : 'project-files'),
            filePath: cost.invoice_url,
            fileId: cost.invoice_external_file_id,
            entityType: isCentralCostInvoice ? 'invoice' : 'project',
            entityId: isCentralCostInvoice ? cost.id : projectId,
            accessEntityType: isCentralCostInvoice ? 'project' : undefined,
            accessEntityId: isCentralCostInvoice ? projectId : undefined,
        })];
        if (metadata.projectLinkFileId) {
            deletions.push(deleteStoredFile({
                provider: cost.invoice_storage_provider,
                connectionId: cost.invoice_storage_connection_id,
                fileId: metadata.projectLinkFileId,
                entityType: 'project',
                entityId: projectId,
            }));
        } else if (metadata.centralLinkFileId) {
            // Compatibility with invoices stored before central accounting storage became authoritative.
            deletions.push(deleteStoredFile({
                provider: cost.invoice_storage_provider,
                connectionId: cost.invoice_storage_connection_id,
                fileId: metadata.centralLinkFileId,
                entityType: 'invoice',
                entityId: cost.id,
                accessEntityType: 'project',
                accessEntityId: projectId,
            }));
        }
        const results = await Promise.allSettled(deletions);
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) throw new Error(failures.map((result) => result.reason?.message).filter(Boolean).join('; '));
    };

    const handleSaveProjectCost = async (costData) => {
        if (financeLoadError) {
            toast({ title: 'Finanční data nejsou dostupná', description: 'Obnovte autoritativní finanční souhrn před provedením změny.', variant: 'destructive' });
            return false;
        }
        const {
            invoiceFile,
            existingInvoice,
            removeInvoice,
            ...financialData
        } = costData;
        const costId = editingCost?.id || crypto.randomUUID();
        const rewardSnapshotBefore = buildRewardSnapshot();
        let uploadedInvoice = null;
        const previousInvoice = (invoiceFile || removeInvoice) && editingCost?.invoice_url ? editingCost : null;
        const payload = {
            ...financialData,
            id: costId,
            project_id: projectId,
        };

        if (removeInvoice) {
            Object.assign(payload, {
                invoice_url: null,
                invoice_name: null,
                invoice_storage_connection_id: null,
                invoice_external_file_id: null,
                invoice_external_web_url: null,
                invoice_storage_metadata: {},
            });
        } else if (existingInvoice) {
            payload.invoice_url = existingInvoice.url;
            payload.invoice_name = existingInvoice.name;
        }

        try {
            if (invoiceFile) {
                uploadedInvoice = await uploadProjectCostInvoice({
                    file: invoiceFile,
                    project,
                    costId,
                });
                Object.assign(payload, uploadedInvoice.storageFields);
            }

            const query = editingCost
                ? supabase.from('project_costs').update(payload).eq('id', editingCost.id)
                : supabase.from('project_costs').insert(payload);
            const { error } = await query;
            if (error) throw error;

            if (previousInvoice) {
                try {
                    await deleteProjectCostStorage(previousInvoice);
                } catch (storageError) {
                    toast({
                        title: 'Nova faktura je ulozena, stary soubor zustal v ulozisti',
                        description: storageError.message,
                        variant: 'warning',
                    });
                }
            }

            await logRewardSnapshot({
                action: editingCost ? 'update' : 'create',
                table: 'project_costs',
                itemId: costId,
                before: rewardSnapshotBefore,
            });
            toast({ title: 'Náklad uložen' });
            setIsCostDialogOpen(false);
            setEditingCost(null);
            await refreshFinancialData();
            return true;
        } catch (error) {
            if (uploadedInvoice?.cleanup) await uploadedInvoice.cleanup().catch(console.error);
            toast({ title: 'Náklad se nepodařilo uložit', description: error.message, variant: 'destructive' });
            return false;
        }
    };

    const handleDeleteGeneric = async () => {
        if (!itemToDelete) return;
        const { table, id } = itemToDelete;
        const changesFinancialModel = ['project_members', 'project_subcontractors', 'project_costs'].includes(table);
        const shouldLogRewards = ['project_subcontractors', 'project_costs'].includes(table);
        if (financeLoadError && changesFinancialModel) {
            toast({ title: 'Finanční data nejsou dostupná', description: 'Mazání finančních vazeb je do obnovení souhrnu zablokováno.', variant: 'destructive' });
            setItemToDelete(null);
            return;
        }
        const rewardSnapshotBefore = shouldLogRewards ? buildRewardSnapshot() : null;
        const cost = table === 'project_costs'
            ? costs.find((entry) => entry.id === id)
            : null;
        const invoiceToDelete = cost?.invoice_url ? cost : null;
        let result;
        if (table === 'project_members') {
            result = await supabase.rpc('delete_project_member_safe', {
                p_project_id: projectId,
                p_assignment_id: id,
            });
        } else if (table === 'project_subcontractors') {
            result = await supabase.rpc('delete_project_subcontractor_safe', {
                p_project_id: projectId,
                p_assignment_id: id,
            });
        } else {
            result = await supabase.from(table).delete().eq('id', id);
        }
        const { error } = result;
        if (error) toast({ title: `Chyba při mazání`, variant: 'destructive', description: error.message });
        else {
            if (invoiceToDelete) {
                try {
                    await deleteProjectCostStorage(invoiceToDelete);
                } catch (storageError) {
                    toast({
                        title: 'Náklad byl smazán, soubor faktury zůstal v úložišti',
                        description: storageError.message,
                        variant: 'warning',
                    });
                }
            }
            toast({ title: table === 'project_members' ? 'Platnost přiřazení byla ukončena' : 'Smazáno' });
            if (shouldLogRewards) {
                await logRewardSnapshot({ action: 'delete', table, itemId: id, before: rewardSnapshotBefore });
            }
            if (table === 'project_costs') {
                await refreshFinancialData();
            } else {
                refreshData();
            }
        }
        setItemToDelete(null);
    };

    const formatCurrency = useCallback((value) => {
        return formatMoney(toAmount(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }, []);

    const memberRewardSummaryById = useMemo(() => new Map(
        (Array.isArray(projectFinancialSummary?.member_rewards) ? projectFinancialSummary.member_rewards : [])
            .map((rawReward) => {
                const reward = normalizeProjectMemberRewardSummary(rawReward);
                return [String(reward.member_id), reward];
            })
    ), [projectFinancialSummary]);

    const rewardPool = useMemo(() => calculateProjectRewardPool(
        members,
        projectFinancialSummary
            ? toAmount(projectFinancialSummary.cost_adjusted_team_budget ?? projectFinancialSummary.remaining_after_costs)
            : calculateProjectBudget(project, subcontractors).teamBudget
    ), [members, projectFinancialSummary, project, subcontractors]);

    const getMemberReward = useCallback((member, teamBudget) => {
        const authoritativeReward = memberRewardSummaryById.get(String(member.member_id));
        if (authoritativeReward) return Math.max(0, toAmount(authoritativeReward.total_reward));
        return Math.max(0, calculateProjectMemberNetReward(
            member,
            teamBudget,
            costs,
            { percentageRewardPool: rewardPool.percentageRewardPool }
        ) - getSponsoredLaborDeduction(member.member_id));
    }, [costs, getSponsoredLaborDeduction, memberRewardSummaryById, rewardPool.percentageRewardPool]);

    const myRewardDisplay = useMemo(() => {
        if (!memberId || !project) return 'N/A';
        const assignment = members.find((member) => String(member.member_id) == String(memberId));
        if (!assignment) return 'N/A';
        const hasReward = assignment.reward_type === 'fixed' || assignment.reward_type === 'percentage';
        if (assignment.is_hourly && !hasReward) return 'Hodinove';
        let teamBudget = 0;
        if (assignment.reward_type === 'percentage') {
            teamBudget = projectFinancialSummary
                ? Number(projectFinancialSummary.financial_model_version || 0) >= 2
                    ? toAmount(projectFinancialSummary.cost_adjusted_team_budget ?? projectFinancialSummary.remaining_after_costs)
                    : toAmount(projectFinancialSummary.team_budget_after_paid_payouts ?? projectFinancialSummary.remaining_after_costs)
                : calculateProjectBudget(project, subcontractors).teamBudget;
            if (teamBudget <= 0) { const pct = toAmount(assignment.reward_percentage); return pct > 0 ? `${pct.toFixed(2)} %` : 'N/A'; }
        }
        const amount = getMemberReward(assignment, teamBudget);
        if (amount <= 0) return 'N/A';
        return `${amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kc`;
    }, [memberId, members, project, subcontractors, projectFinancialSummary, getMemberReward]);

    const formatReward = (member, teamBudget) => {
        if (!canViewFinance) return 'Skryto';
        let parts = [];
        if (member.is_hourly) {
            const sponsorName = member.member?.hourly_sponsor_name;
            const sponsorPercent = toAmount(member.member?.hourly_sponsor_percent);
            parts.push(member.member?.hourly_funding_mode === 'member_reward'
                ? `Hodinová sazba z odměny ${sponsorName || 'člena týmu'} (${sponsorPercent.toFixed(2)} %)`
                : 'Hodinová sazba z rozpočtu projektu');
        }
        if (member.reward_type) {
            const authoritativeReward = memberRewardSummaryById.get(String(member.member_id));
            const grossAmount = authoritativeReward
                ? toAmount(authoritativeReward.gross_reward)
                : calculateProjectMemberReward(member, teamBudget, { percentageRewardPool: rewardPool.percentageRewardPool });
            const assignedCosts = authoritativeReward
                ? toAmount(authoritativeReward.direct_assigned_costs)
                : sumProjectCostsForMember(costs, member.member_id);
            const sponsoredLaborCosts = authoritativeReward
                ? toAmount(authoritativeReward.sponsored_labor_costs)
                : getSponsoredLaborDeduction(member.member_id);
            const totalDeductions = authoritativeReward
                ? toAmount(authoritativeReward.total_deductions)
                : assignedCosts + sponsoredLaborCosts;
            const amount = authoritativeReward
                ? toAmount(authoritativeReward.total_reward)
                : Math.max(0, grossAmount - totalDeductions);
            const amountStr = amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
            const deduction = totalDeductions > 0
                ? `, hrubá ${grossAmount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč - běžné náklady ${assignedCosts.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč - práce týmu ${sponsoredLaborCosts.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`
                : '';
            const available = toAmount(authoritativeReward?.available_amount);
            const paid = toAmount(authoritativeReward?.paid_amount);
            const reserved = toAmount(authoritativeReward?.reserved_amount);
            const payoutOverview = authoritativeReward
                ? `; volno ${formatCurrency(available)}; vyplaceno ${formatCurrency(paid)}${reserved > 0 ? `; rezervováno ${formatCurrency(reserved)}` : ''}`
                : '';
            if (member.reward_type === 'percentage') parts.push(`${amountStr} (${toAmount(member.reward_percentage).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} % ze zbytku${deduction}${payoutOverview})`);
            if (member.reward_type === 'fixed') parts.push(`${amountStr} (fixní${deduction}${payoutOverview})`);
        }
        if (parts.length === 0 && member.is_hourly) return "Hodinová sazba";
        if (parts.length === 0) return 'Není specifikováno';
        return parts.join(' · ');
    };

    const financials = useMemo(() => {
        if (!project || !canViewFinance) return {};
        const fallbackFinancials = calculateProjectFinancials({ project, members, subcontractors, costs, overheadCosts, paidOutAmount });
        if (!projectFinancialSummary) return fallbackFinancials;

        const summary = projectFinancialSummary;
        const isCanonicalModel = Number(summary.financial_model_version || 0) >= 2;
        const teamBudget = toAmount(summary.team_budget);
        const laborReplacementAdjustment = !isCanonicalModel && projectLaborSummary
            ? toAmount(summary.paid_hourly_payouts) - toAmount(projectLaborSummary.direct_project_cost)
            : 0;
        const rewardBaseBudget = isCanonicalModel
            ? toAmount(summary.cost_adjusted_team_budget ?? summary.remaining_after_costs)
            : toAmount(summary.team_budget_after_paid_payouts ?? summary.remaining_after_costs ?? summary.team_budget) + laborReplacementAdjustment;
        const authoritativeRewards = isCanonicalModel && Array.isArray(summary.member_rewards)
            ? summary.member_rewards
            : null;
        const fallbackRewardPool = calculateProjectRewardPool(members, rewardBaseBudget);
        const teamRewards = authoritativeRewards
            ? authoritativeRewards.reduce((sum, reward) => sum + toAmount(reward.total_reward), 0)
            : members.reduce((sum, member) => (
                sum + Math.max(0, calculateProjectMemberNetReward(
                    member,
                    rewardBaseBudget,
                    costs,
                    { percentageRewardPool: fallbackRewardPool.percentageRewardPool }
                ) - getSponsoredLaborDeduction(member.member_id))
            ), 0);
        const totalBudget = toAmount(summary.gross_project_budget);
        const totalCosts = toAmount(summary.direct_costs);
        const unassignedCosts = toAmount(summary.unassigned_direct_costs ?? sumUnassignedProjectCosts(costs));
        const assignedMemberCosts = toAmount(summary.assigned_member_costs ?? (totalCosts - unassignedCosts));
        const overheadBudget = toAmount(summary.planned_overhead_amount);
        const totalAllocatedOverhead = toAmount(summary.allocated_overhead_costs);
        const paidPayoutCosts = toAmount(summary.paid_payout_costs);
        const reservedPayouts = toAmount(summary.reserved_payouts);
        const costsBeforePaidPayouts = toAmount(summary.costs_before_paid_payouts);
        const costsAfterPaidPayouts = toAmount(summary.costs_after_paid_payouts);
        const teamBudgetAfterPaidPayouts = toAmount(summary.team_budget_after_paid_payouts) + laborReplacementAdjustment;
        const unallocatedBudget = rewardBaseBudget - (authoritativeRewards ? authoritativeRewards.reduce((sum, reward) => sum + toAmount(reward.gross_reward), 0) : teamRewards);

        return {
            ...fallbackFinancials,
            price: toAmount(summary.price),
            budgetPercentage: toAmount(summary.budget_percentage),
            overheadPercentage: toAmount(summary.overhead_percentage),
            totalBudget,
            overheadBudget,
            subcontractorCosts: toAmount(summary.subcontractor_costs),
            totalSubcontractorPrice: toAmount(summary.subcontractor_costs),
            teamBudget,
            teamRewards,
            rewardBaseBudget,
            unallocatedBudget,
            remainingTeamBudget: unallocatedBudget,
            totalCosts,
            unassignedCosts,
            assignedMemberCosts,
            plannedMargin: toAmount(summary.price) - totalBudget,
            projectProfit: toAmount(summary.price) - totalBudget,
            totalAllocatedOverhead,
            remainingOverheadBudget: overheadBudget - totalAllocatedOverhead,
            paidOutAmount: toAmount(summary.paid_payouts),
            paidTaskPayouts: toAmount(summary.paid_task_payouts),
            paidHourlyPayouts: toAmount(summary.paid_hourly_payouts),
            paidPayoutCosts,
            reservedPayouts,
            reservedOrPaidPayouts: toAmount(summary.reserved_or_paid_payouts),
            remainingAfterCosts: isCanonicalModel
                ? toAmount(summary.remaining_after_costs)
                : toAmount(summary.remaining_after_costs) - (projectLaborSummary ? toAmount(projectLaborSummary.direct_project_cost) : 0),
            costsBeforePaidPayouts,
            costsAfterPaidPayouts,
            teamBudgetAfterPaidPayouts,
            availableForPayout: toAmount(summary.available_for_payout) + laborReplacementAdjustment,
        };
    }, [project, members, subcontractors, costs, overheadCosts, canViewFinance, paidOutAmount, projectFinancialSummary, projectLaborSummary, getSponsoredLaborDeduction]);

    // Member rewards are allocated from the cost-adjusted reward pool. Paid
    // payouts reduce liquidity, but must not change the base used by existing
    // percentage assignments (the database validator follows the same rule).
    const rewardCalculationBudget = financials.rewardBaseBudget ?? financials.remainingAfterCosts ?? financials.teamBudget ?? 0;
    const projectFinancialHealth = getProjectFinancialHealthInputs(financials);

    const financeDerivedRows = useMemo(() => {
        if (!canViewFinance) return [];
        const subcontractorDetails = subcontractors.map((sub) => ({ key: sub.id, label: sub.subject?.name || 'Subdodavatel bez názvu', description: sub.scope_of_work || 'Bez popisu', amount: parseFloat(sub.price) || 0 }));
        const payoutDetails = paidPayoutItems.map((item) => {
            const relatedPayout = Array.isArray(item.payouts) ? item.payouts[0] : item.payouts;
            const memberName = relatedPayout?.member?.name;
            return { key: item.id, label: memberName ? `Výplata pro ${memberName}` : `Položka výplaty #${item.id}`, description: relatedPayout?.status ? `Stav: ${relatedPayout.status}` : null, amount: parseFloat(item.amount) || 0 };
        });
        return [
            { key: 'subcontractor-costs', label: 'Náklady na subdodavatele', note: subcontractors.length ? `${subcontractors.length} aktivních subdodavatelů v týmu` : 'Zatím nebyl přiřazen žádný subdodavatel', amount: financials.totalSubcontractorPrice || 0, details: subcontractorDetails },
            { key: 'paid-payouts', label: 'Vyplacené úkolové odměny', note: payoutDetails.length ? `${payoutDetails.length} položek ve stavu "paid"` : 'Ještě nebyla proplacena žádná úkolová odměna', amount: financials.paidTaskPayouts ?? financials.paidOutAmount ?? 0, details: payoutDetails },
            { key: 'paid-hourly-payouts', label: 'Vyplacené hodinové mzdy', note: 'Do nákladů vstupují až po označení hodinové výplaty jako paid.', amount: financials.paidHourlyPayouts || 0, details: [] },
        ];
    }, [canViewFinance, subcontractors, paidPayoutItems, financials]);

    const requestDeleteLink = useCallback((link) => {
        setItemToDelete({
            table: 'project_links',
            id: link.id,
            name: 'odkaz',
            displayName: link.description || link.url,
            severity: 'low',
            summary: 'Smaže se pouze uložený odkaz. Projektová data ani finance se tím nezmění.',
        });
    }, []);

    const requestDeleteMember = useCallback((assignment) => {
        const rewardAmount = canViewFinance
            ? getMemberReward(assignment, rewardCalculationBudget)
            : null;

        setItemToDelete({
            table: 'project_members',
            id: assignment.id,
            name: 'člena',
            displayName: assignment.member?.name || assignment.member?.email || 'Neznámý člen',
            severity: 'high',
            confirmLabel: 'Ukončit přiřazení',
            amountLabel: canViewFinance ? 'Aktuálně vypočtená odměna' : null,
            amount: rewardAmount,
            summary: 'Aktivní přiřazení člena bude ukončeno. Záznam, finanční vazby, rezervované i vyplacené částky zůstanou zachované v historii.',
            details: [
                'Databáze ověří čistý nárok člena proti všem rezervovaným a vyplaceným výplatám.',
                'Řádková změna i finanční snapshot budou propojené společným auditním identifikátorem.',
            ],
        });
    }, [canViewFinance, getMemberReward, rewardCalculationBudget]);

    const requestDeleteSubcontractor = useCallback((subcontractor) => {
        setItemToDelete({
            table: 'project_subcontractors',
            id: subcontractor.id,
            name: 'subdodavatele',
            displayName: subcontractor.subject?.name || subcontractor.scope_of_work || 'Subdodavatel',
            severity: 'high',
            amountLabel: 'Cena subdodavatele',
            amount: subcontractor.price,
            summary: 'Smazáním subdodavatele se přepočítá projektový budget a dostupné finance projektu.',
            details: [
                'Tato částka se po smazání přestane odečítat z projektových výpočtů.',
                'Zkontrolujte, že nejde o historicky uzavřený nebo vyfakturovaný náklad.',
            ],
        });
    }, []);

    const requestDeleteCost = useCallback((cost) => {
        setItemToDelete({
            table: 'project_costs',
            id: cost.id,
            name: 'náklad',
            displayName: cost.description || 'Projektový náklad',
            severity: 'high',
            amountLabel: 'Částka nákladu bez DPH',
            amount: cost.amount,
            summary: 'Smazáním nákladu se okamžitě změní finanční přehled projektu.',
            details: [
                'Dostupný budget se po smazání přepočítá.',
                'Pokud jde o účetní opravu, zvažte raději korekční záznam místo mazání historie.',
            ],
        });
    }, []);

    const getProjectProgress = useCallback(() => taskProgress(tasks), [tasks]);

    if (loading) return <EkvLoader title="Načítám detail projektu" description="Synchronizuji tým, úkoly, dokumenty a finance." />;
    if (!project) return <div className="p-8 text-center"><h1 className="text-2xl font-bold">Projekt nenalezen</h1></div>;

    const progress = getProjectProgress();
    const availableTabs = [
        'overview', 'team', 'tasks', 'plan', 'engineering', 'meetings', 'documents', 'handover', 'contacts',
        ...(isAdmin ? ['finance'] : []),
    ];
    const requestedTab = location.hash.substring(1);
    const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'overview';
    const openTab = value => navigate({ pathname: location.pathname, search: location.search, hash: `#${value}` }, { replace: true, state: location.state });
    const navigationGroups = [
        { label: 'Přehled', icon: FileText, tabs: [{ value: 'overview', label: 'Přehled' }] },
        { label: 'Práce', icon: ClipboardList, tabs: [{ value: 'tasks', label: 'Úkoly' }, { value: 'plan', label: 'Plán' }, { value: 'engineering', label: 'Inženýring' }, { value: 'meetings', label: 'Zápisy KD' }] },
        { label: 'Lidé', icon: Users, tabs: [{ value: 'team', label: 'Tým a dodavatelé' }, { value: 'contacts', label: 'Externí kontakty' }] },
        ...(isAdmin ? [{ label: 'Finance', icon: Wallet, tabs: [{ value: 'finance', label: 'Finance' }] }] : []),
        { label: 'Dokumenty', icon: FileText, tabs: [{ value: 'documents', label: 'Soubory' }, { value: 'handover', label: 'Předání' }] },
    ];

    return (
        <div>
            <RecordWorkspaceHeader
                title={project.name}
                subtitle={project.code}
                onBack={() => navigate(recordReturnPath(location.state?.returnTo, '/projects'))}
                backLabel={recordReturnPath(location.state?.returnTo, '/projects').split('?')[0] === '/tasks' ? 'Zpět na úkoly' : 'Zpět na projekce'}
                status={renderStatusMenu()}
                actions={(
                    <>
                        {canEdit && <Button size="sm" onClick={() => navigate(`/projects/${projectId}/edit`)}><Edit2 className="mr-2 h-4 w-4" />Upravit</Button>}
                        {(canEdit || canViewHistory) && <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label="Další akce projektu"><MoreHorizontal className="mr-2 h-4 w-4" />Další</Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {canViewHistory && <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/history`)}><History className="mr-2 h-4 w-4" />Historie změn</DropdownMenuItem>}
                                {canEdit && <DropdownMenuItem onSelect={() => setIsTemplateModalOpen(true)}><Copy className="mr-2 h-4 w-4" />Uložit jako šablonu</DropdownMenuItem>}
                            </DropdownMenuContent>
                        </DropdownMenu>}
                    </>
                )}
            />

            <div className="app-page-wide">
                <Tabs value={activeTab} onValueChange={openTab} className="space-y-4">
                    <RecordWorkspaceNavigation groups={navigationGroups} activeTab={activeTab} onTabChange={openTab} />

                    <TabsContent value="overview" className="space-y-6">
                        <RecordMetricGrid className="xl:grid-cols-3">
                            <StatCard title="Pokrok práce" value={operationalLoadError ? '—' : tasks.some(task => !taskIsCancelled(task)) ? `${progress}%` : 'Bez úkolů'} subtitle={operationalLoadError ? 'Data nejsou dostupná' : `${tasks.filter(taskIsDone).length} dokončených z ${tasks.filter(task => !taskIsCancelled(task)).length} úkolů`} icon={Target} progress={operationalLoadError ? undefined : progress} />
                            <StatCard title="Projektový tým" value={operationalLoadError ? '—' : members.length} subtitle="Přiřazení členové • správa v části Lidé" icon={Users} />
                            {!isAdmin && !isPrivateMode ? <StatCard title="Moje odměna" value={myRewardDisplay} subtitle="Moje přiřazení na projektu" icon={Wallet} /> : <StatCard title="Subdodavatelé" value={operationalLoadError ? '—' : subcontractors.length} subtitle="Zapojené firmy • správa v části Lidé" icon={Briefcase} />}
                        </RecordMetricGrid>
                        {operationalLoadError && (
                            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                                <div><p className="font-semibold">Část provozních dat se nepodařilo načíst</p><p className="mt-1 text-amber-800">Prázdné seznamy nemusí znamenat, že projekt nemá úkoly nebo členy. Obnovte stránku.</p></div>
                            </div>
                        )}
                        {canViewFinance && (
                            <FinancialHealthAlert
                                {...projectFinancialHealth}
                            />
                        )}
                        <ProjectOverviewPanels
                            project={project}
                            tasks={tasks}
                            operationalLoadError={operationalLoadError}
                            onOpenTab={openTab}
                            onOpenTask={task => { const params = new URLSearchParams(location.search); params.set('task', task.id); navigate({ pathname: location.pathname, search: params.toString(), hash: '#tasks' }, { state: location.state }); }}
                            descriptionPanel={<CollapsibleSection title="Popis projektu" icon={BookOpen}>
                            {canEdit && !isEditingBrief && <Button variant="outline" size="sm" aria-label="Upravit popis projektu" onClick={() => setIsEditingBrief(true)} className="float-right"><Edit2 className="h-4 w-4" /></Button>}
                            {isEditingBrief ? (
                                <div className="space-y-2"><Textarea aria-label="Popis projektu" value={briefContent} onChange={(e) => setBriefContent(e.target.value)} rows={5} /><div className="flex gap-2"><Button onClick={() => { handleSaveGeneric('projects', { brief: briefContent }, project.id, () => setIsEditingBrief(false), null); }}><Save className="h-4 w-4 mr-2" />Uložit</Button><Button variant="ghost" onClick={() => { setBriefContent(project.brief || ''); setIsEditingBrief(false); }}>Zrušit</Button></div></div>
                            ) : (<p className="text-muted-foreground whitespace-pre-wrap">{briefContent || 'Není zadán.'}</p>)}
                        </CollapsibleSection>}
                        />
                        {canViewFinance && (
                            <BillingOverviewSummary
                                compact
                                entityType="project"
                                entityId={projectId}
                                onOpenDetails={() => { setFinanceSection('billing'); openTab('finance'); }}
                            />
                        )}


                    </TabsContent>
                    
                    <TabsContent value="team" className="space-y-6">
                        <CollapsibleSection title="Tým" icon={Users} actions={isAdmin && <Button size="sm" onClick={() => { setEditingMember(null); setIsMemberDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat člena</Button>}>
                            <Table className="finance-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Jméno</TableHead>
                                        <TableHead>Kontakt</TableHead>
                                        {canViewFinance && <TableHead>Odměna</TableHead>}
                                        <TableHead className="text-right">Akce</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.length > 0 ? members.map(m => (
                                        <TableRow key={m.id}>
                                            <TableCell className="font-medium">{m.member?.name}</TableCell>
                                            <TableCell><div className="space-y-1 text-sm">{m.member?.email && <a className="block text-primary hover:underline" href={`mailto:${m.member.email}`}>{m.member.email}</a>}{m.member?.phone && <a className="block text-primary hover:underline" href={`tel:${m.member.phone}`}>{m.member.phone}</a>}{!m.member?.email && !m.member?.phone && <span className="text-muted-foreground">Není doplněn</span>}</div></TableCell>
                                            {canViewFinance && (
                                                <TableCell className="max-w-[760px] whitespace-normal text-sm leading-5">
                                                    <details><summary className="cursor-pointer py-2 text-primary">Odměna a podíl</summary><div className="pt-2">{formatReward(m, rewardCalculationBudget)}</div></details>
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right">
                                                {isAdmin && (
                                                    <>
                                                        <Button variant="ghost" size="icon" aria-label={`Upravit člena ${m.member?.name || 'týmu'}`} onClick={() => { setEditingMember(m); setIsMemberDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" aria-label={`Ukončit přiřazení ${m.member?.name || 'člena'}`} onClick={() => requestDeleteMember(m)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow>
                                            <TableCell colSpan={canViewFinance ? 4 : 3} className="text-center">Žádní členové nebyli přiřazeni.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CollapsibleSection>
                        <CollapsibleSection title="Subdodavatelé" icon={Briefcase} actions={isAdmin && <Button size="sm" onClick={() => { setEditingSubcontractor(null); setIsSubcontractorDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat subdodavatele</Button>}>
                            <Table className="finance-table">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Firma</TableHead>
                                        <TableHead>Rozsah práce</TableHead>
                                        {canViewFinance && <TableHead>Cena</TableHead>}
                                        <TableHead className="text-right">Akce</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {subcontractors.length > 0 ? subcontractors.map(s => (
                                        <TableRow key={s.id}>
                                            <TableCell><p className="font-medium">{s.subject?.name}</p>{s.subject?.contact_person && <p className="mt-1 text-xs text-muted-foreground">{s.subject.contact_person}</p>}{s.subject?.email && <a className="mt-1 block text-sm text-primary hover:underline" href={`mailto:${s.subject.email}`}>{s.subject.email}</a>}{s.subject?.phone && <a className="mt-1 block text-sm text-primary hover:underline" href={`tel:${s.subject.phone}`}>{s.subject.phone}</a>}</TableCell>
                                            <TableCell>{s.scope_of_work}</TableCell>
                                            {canViewFinance && <TableCell>{(s.price || 0).toLocaleString('cs-CZ')} Kč</TableCell>}
                                            <TableCell className="text-right">
                                                {isAdmin && (
                                                    <>
                                                        <Button variant="ghost" size="icon" aria-label={`Upravit dodavatele ${s.subject?.name || 'firmy'}`} onClick={() => { setEditingSubcontractor(s); setIsSubcontractorDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" aria-label={`Odebrat dodavatele ${s.subject?.name || 'firmy'}`} onClick={() => requestDeleteSubcontractor(s)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow>
                                            <TableCell colSpan={canViewFinance ? 4 : 3} className="text-center">Žádní subdodavatelé nebyli přiřazeni.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CollapsibleSection>
                    </TabsContent>

                    <TabsContent value="meetings"><MeetingNotes entityTitle={project.name} entityType="project" entityId={projectId} canEdit={canEdit} onOpenPlan={() => openTab('plan')} /></TabsContent>
                    <TabsContent value="tasks"><ProjectTasks projectId={projectId} project={project} tasks={tasks} members={members} canEdit={canEdit} onTaskUpdate={setTasks} loadError={operationalLoadError} onRetry={refreshData} /></TabsContent>
                    <TabsContent value="plan"><PlanningBoard entityType="project" entityId={projectId} embedded canEdit={canEdit} /></TabsContent>
                    <TabsContent value="engineering"><ProjectEngineering projectId={projectId} project={project} canEdit={canEdit} /></TabsContent>
                    <TabsContent value="documents" className="space-y-6">
                        <CollapsibleSection title="Související odkazy" icon={Link2} actions={canEdit && <Button size="sm" onClick={() => { setEditingLink(null); setIsLinkDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat odkaz</Button>}>
                            {projectLinks.length > 0 ? (
                                <div className="space-y-2">
                                    {projectLinks.map(link => (
                                        <div key={link.id} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-50">
                                            <div className="min-w-0 flex-1 break-words"><a href={link.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{link.description || link.url}</a><p className="text-xs text-muted-foreground">{link.url}</p></div>
                                            {canEdit && <div className="flex gap-2">
                                                <Button variant="ghost" size="icon" aria-label="Upravit odkaz" onClick={() => { setEditingLink(link); setIsLinkDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" aria-label="Smazat odkaz" onClick={() => requestDeleteLink(link)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                            </div>}
                                        </div>
                                    ))}
                                </div>
                            ) : (<p className="text-muted-foreground">Žádné odkazy nebyly přidány.</p>)}
                        </CollapsibleSection>
                        <SharePointFolderBrowser
                            entityType="project"
                            entity={project}
                            canEdit={canEdit}
                        />
                    </TabsContent>
                    <TabsContent value="handover">
                        <HandoverProtocolsTab
                            projectId={projectId}
                            project={project}
                            subjectId={project?.client?.id || project?.investor?.id || null}
                            canEdit={canEdit}
                        />
                    </TabsContent>
                    <TabsContent value="contacts"><ProjectContacts projectId={projectId} /></TabsContent>

                    {isAdmin && !canViewFinance && <TabsContent value="finance"><Card><CardContent className="p-6"><h2 className="font-semibold">Finanční údaje jsou skryté</h2><p className="mt-2 text-sm text-muted-foreground">Pro zobrazení rozpočtu, fakturace a nákladů vypněte soukromý režim.</p></CardContent></Card></TabsContent>}
                    {canViewFinance && <TabsContent value="finance" className="space-y-6">
                        {financeLoadError && (
                            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                                <div>
                                    <p className="font-semibold">Finanční data nejsou autoritativně dostupná</p>
                                    <p className="mt-1 text-red-700">Výpočty z databáze se nepodařilo načíst. Finanční změny neprovádějte, dokud se data po obnovení nenačtou správně.</p>
                                </div>
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-2" role="group" aria-label="Sekce financí projektu">
                            {[{ value: 'summary', label: 'Souhrn' }, { value: 'billing', label: 'Fakturace' }, { value: 'costs', label: 'Náklady' }].map(section => <Button key={section.value} variant={financeSection === section.value ? 'secondary' : 'ghost'} aria-pressed={financeSection === section.value} onClick={() => setFinanceSection(section.value)}>{section.label}</Button>)}
                        </div>
                        <RecordWorkspaceSection active={financeSection === 'summary'} aria-label="Finanční souhrn projektu" className="space-y-5">
                        {!financeLoadError && <FinanceMetricStrip className="2xl:grid-cols-4" metrics={[
                            { label: 'Evidovaná hodnota zakázky bez DPH', value: <FinanceAmount value={financials.price ?? project.price} />, detail: 'Základ projektového rozpočtu', tone: 'neutral', icon: DollarSign },
                            { label: 'Plánovaný projektový rozpočet', value: <FinanceAmount value={financials.totalBudget} />, detail: `${project.budget_percentage}% z hodnoty`, tone: 'plan', icon: Wallet },
                            { label: 'Skutečné náklady', value: <FinanceAmount value={financials.costsAfterPaidPayouts} />, detail: 'Včetně vyplacených odměn', tone: 'neutral', icon: ClipboardList },
                            { label: 'Nerozdělený rozpočet', value: <FinanceAmount value={financials.unallocatedBudget} />, detail: 'Po nákladech a plánovaných odměnách', tone: Number(financials.unallocatedBudget || 0) < 0 ? 'negative' : 'positive', icon: Wallet },
                            { label: 'Režie projektu', value: <FinanceAmount value={financials.overheadBudget} />, detail: `Zbývá ${formatCurrency(financials.remainingOverheadBudget)} po alokaci`, tone: Number(financials.remainingOverheadBudget || 0) < 0 ? 'negative' : 'warning', icon: ClipboardList },
                            { label: 'Rezervované výplaty', value: <FinanceAmount value={financials.reservedPayouts} />, detail: 'Závazek, zatím ne náklad', tone: Number(financials.reservedPayouts || 0) ? 'warning' : 'neutral', icon: Clock },
                            { label: 'Dostupné pro výplatu', value: <FinanceAmount value={financials.availableForPayout} />, detail: 'Po kontrolách a rezervacích', tone: Number(financials.availableForPayout || 0) < 0 ? 'negative' : 'positive', icon: Users },
                            { label: 'Plánovaná marže', value: <FinanceAmount value={financials.plannedMargin ?? financials.projectProfit} />, detail: 'Hodnota minus plánovaný rozpočet', tone: Number(financials.plannedMargin || 0) < 0 ? 'negative' : 'positive', icon: DollarSign },
                        ]} />}
                        <FinanceDefinitionNote>Nerozdělený rozpočet je týmový základ po nákladech a naplánovaných odměnách; není totožný s limitem dostupným pro výplatu, který navíc zohledňuje rezervované žádosti. Režie je samostatná plánovaná rezerva a její detail najdete v části Náklady v přehledu připsaných režií.</FinanceDefinitionNote>
                        <ProjectBonuses key={projectId} projectId={projectId} members={members} available={Math.max(0, Math.floor(financials.unallocatedBudget * 100) / 100)} disabled={!!financeLoadError} onSaved={refreshData} />
                        <FinancialSettingsCard
                            entityType="project"
                            entityId={projectId}
                            values={project}
                            disabled={!!financeLoadError}
                            onSaved={refreshData}
                        />
                        </RecordWorkspaceSection>
                        <RecordWorkspaceSection active={financeSection === 'billing'} aria-label="Fakturace projektu"><BillingTracker entityType="project" entityId={projectId} entityCode={project.code} enableContractAnalysis={isAdmin} showFinancialSummary={false} /></RecordWorkspaceSection>
                        <RecordWorkspaceSection active={financeSection === 'costs'} aria-label="Náklady projektu" className="space-y-5">
                        <CollapsibleSection title="Ostatní náklady" icon={DollarSign} actions={canEdit && <Button size="sm" disabled={!!financeLoadError} onClick={() => { setEditingCost(null); setIsCostDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat náklad</Button>}>
                            <Table className="finance-table">
                                <TableHeader><TableRow><TableHead>Popis</TableHead><TableHead>Odečíst z</TableHead><TableHead>Částka bez DPH</TableHead><TableHead>Faktura</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {(costs.length === 0 && financeDerivedRows.length === 0) ? (
                                        <TableRow><TableCell colSpan={5} className="text-center">Žádné náklady nebyly zadány.</TableCell></TableRow>
                                    ) : (
                                        <>
                                            {costs.map(cost => (
                                                <TableRow key={cost.id}>
                                                    <TableCell>{cost.description}</TableCell>
                                                    <TableCell>
                                                        {cost.member_id ? (
                                                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                                {cost.member?.name || 'Člen týmu'}
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                                                Společný budget
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{(cost.amount || 0).toLocaleString('cs-CZ')} Kč</TableCell>
                                                    <TableCell>
                                                        {cost.invoice_url ? (
                                                            <button type="button" onClick={async () => {
                                                                const isCentralCostInvoice = cost.invoice_storage_metadata?.storageRole === 'central_cost_invoice';
                                                                const result = await downloadInvoiceFromStorage({
                                                                    provider: cost.invoice_storage_provider,
                                                                    connectionId: cost.invoice_storage_connection_id,
                                                                    bucket: cost.invoice_storage_metadata?.bucket || (isCentralCostInvoice ? 'invoices' : 'project-files'),
                                                                    filePath: cost.invoice_url,
                                                                    fileId: cost.invoice_external_file_id,
                                                                    fileName: cost.invoice_name,
                                                                    entityType: isCentralCostInvoice ? 'invoice' : 'project',
                                                                    entityId: isCentralCostInvoice ? cost.id : projectId,
                                                                    accessEntityType: isCentralCostInvoice ? 'project' : undefined,
                                                                    accessEntityId: isCentralCostInvoice ? projectId : undefined,
                                                                });
                                                                if (!result.success) toast({ title: 'Fakturu se nepodarilo stahnout', description: result.error, variant: 'destructive' });
                                                            }} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
                                                                <FileText className="h-4 w-4" />
                                                                {cost.invoice_name || 'Otevřít'}
                                                            </button>
                                                        ) : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-right"><Button variant="ghost" size="icon" aria-label={`Upravit náklad ${cost.description || 'projektu'}`} onClick={() => { setEditingCost(cost); setIsCostDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Smazat náklad ${cost.description || 'projektu'}`} onClick={() => requestDeleteCost(cost)}><Trash2 className="h-4 w-4 text-red-500" /></Button></TableCell>
                                                </TableRow>
                                            ))}
                                            {financeDerivedRows.map((row) => (
                                                <React.Fragment key={row.key}>
                                                    <TableRow className="bg-slate-50/70"><TableCell><div className="font-semibold">{row.label}</div><p className="text-xs text-muted-foreground">{row.note}</p></TableCell><TableCell>Společný budget</TableCell><TableCell>{row.amount.toLocaleString('cs-CZ')} Kč</TableCell><TableCell>—</TableCell><TableCell className="text-right text-xs text-muted-foreground italic">automaticky</TableCell></TableRow>
                                                    {row.details?.length ? (<TableRow><TableCell colSpan={5} className="bg-slate-50/40"><div className="space-y-3">{row.details.map((detail) => (<div key={`${row.key}-${detail.key ?? detail.label}`} className="flex flex-col gap-1 rounded-md border bg-white/80 px-3 py-2 text-sm shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="font-medium text-slate-900">{detail.label}</p>{detail.description && (<p className="text-xs text-muted-foreground">{detail.description}</p>)}</div><span className="font-semibold text-slate-900 whitespace-nowrap">{detail.amount.toLocaleString('cs-CZ')} Kč</span></div></div>))}</div></TableCell></TableRow>) : null}
                                                </React.Fragment>
                                            ))}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </CollapsibleSection>
                        <CollapsibleSection title="Připsané režijní náklady" icon={ClipboardList}>
                            <Table className="finance-table">
                                <TableHeader><TableRow><TableHead>Název</TableHead><TableHead>Kategorie</TableHead><TableHead>Částka bez DPH</TableHead><TableHead>Měsíc</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {overheadCosts.length > 0 ? overheadCosts.map(cost => (
                                        <TableRow key={cost.id}><TableCell>{cost.overhead_allocation_items?.overhead_costs?.name || 'N/A'}</TableCell><TableCell>{cost.overhead_allocation_items?.overhead_costs?.category || 'N/A'}</TableCell><TableCell>{(cost.amount || 0).toLocaleString('cs-CZ')} Kč</TableCell><TableCell>{cost.month}</TableCell></TableRow>
                                    )) : <TableRow><TableCell colSpan={4} className="text-center">Žádné režijní náklady nebyly připsány.</TableCell></TableRow>}
                                </TableBody>
                                <TableFooter>
                                    <TableRow className="bg-slate-50"><TableCell colSpan={2} className="font-semibold text-right">Celkem připsáno:</TableCell><TableCell colSpan={2} className="font-semibold">{financials.totalAllocatedOverhead.toLocaleString('cs-CZ')} Kč</TableCell></TableRow>
                                    <TableRow className="bg-slate-100"><TableCell colSpan={2} className="font-bold text-right text-base">Zůstatek z režií:</TableCell><TableCell colSpan={2} className="font-bold text-base">{financials.remainingOverheadBudget.toLocaleString('cs-CZ')} Kč</TableCell></TableRow>
                                </TableFooter>
                            </Table>
                        </CollapsibleSection>
                        </RecordWorkspaceSection>
                    </TabsContent>}
                </Tabs>
            </div>

            <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-start gap-3">
                            <span className={cn(
                                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                itemToDelete?.severity === 'high' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                            )}>
                                <AlertTriangle className="h-5 w-5" />
                            </span>
                            <span>
                                Opravdu chcete smazat tohoto {itemToDelete?.name}?
                                {itemToDelete?.displayName && (
                                    <span className="mt-1 block text-base font-medium text-muted-foreground">
                                        {itemToDelete.displayName}
                                    </span>
                                )}
                            </span>
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3 pt-2 text-sm text-muted-foreground">
                                <p>{itemToDelete?.summary || 'Tato akce nemůže být vrácena.'}</p>
                                {itemToDelete?.amountLabel && (
                                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-800">
                                        <span className="block text-xs font-medium uppercase text-muted-foreground">
                                            {itemToDelete.amountLabel}
                                        </span>
                                        <span className="text-base font-semibold">
                                            {formatCurrency(itemToDelete.amount)}
                                        </span>
                                    </div>
                                )}
                                {itemToDelete?.details?.length > 0 && (
                                    <ul className="list-disc space-y-1 pl-5">
                                        {itemToDelete.details.map((detail) => (
                                            <li key={detail}>{detail}</li>
                                        ))}
                                    </ul>
                                )}
                                <p className="font-medium text-red-600">Tato akce nemůže být vrácena.</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteGeneric} className="bg-red-600 hover:bg-red-700">
                            {itemToDelete?.confirmLabel || 'Smazat'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {isMemberDialogOpen && <AssignMemberDialog isOpen={isMemberDialogOpen} onClose={() => setIsMemberDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_members', data, editingMember?.id, () => setIsMemberDialogOpen(false), setEditingMember)} member={editingMember} team={members} project={project} projectSubcontractors={subcontractors} teamBudgetOverride={canViewFinance ? rewardCalculationBudget : null} />}
            {isSubcontractorDialogOpen && <AssignSubcontractorDialog isOpen={isSubcontractorDialogOpen} onClose={() => setIsSubcontractorDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_subcontractors', data, editingSubcontractor?.id, () => setIsSubcontractorDialogOpen(false), setEditingSubcontractor)} assignedSubcontractor={editingSubcontractor} projectSubcontractors={subcontractors} />}
            {isCostDialogOpen && <ProjectCostDialog isOpen={isCostDialogOpen} onClose={() => setIsCostDialogOpen(false)} onSave={handleSaveProjectCost} costData={editingCost} projectId={projectId} members={members} />}
            {isLinkDialogOpen && <ProjectLinkDialog isOpen={isLinkDialogOpen} onClose={() => setIsLinkDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_links', data, editingLink?.id, () => setIsLinkDialogOpen(false), setEditingLink)} linkData={editingLink} />}
            {isTemplateModalOpen && <SaveTemplateModal isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} projectData={{ ...project, tasks }} />}
        </div>
    );
};

export default ProjectDetail;
