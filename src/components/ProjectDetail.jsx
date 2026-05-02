import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Edit2, Trash2, DollarSign, Users, ClipboardList, Plus, BookOpen, Link2, Save, Target, Calendar, User, FileText, ChevronDown, ChevronUp, Briefcase, Wallet, Contact, UserCheck, Loader2, Copy } from 'lucide-react';
import AssignMemberDialog from '@/components/AssignMemberDialog';
import AssignSubcontractorDialog from '@/components/AssignSubcontractorDialog';
import ProjectCostDialog from '@/components/ProjectCostDialog';
import ProjectEngineering from '@/components/ProjectEngineering';
import ProjectTasks from '@/components/ProjectTasks';
import ProjectLinkDialog from '@/components/ProjectLinkDialog';
import ProjectContacts from '@/components/ProjectContacts';
import SaveTemplateModal from '@/components/SaveTemplateModal';
import { Textarea } from '@/components/ui/textarea';
import { cn, projectStatusConfig } from '@/lib/utils';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { calculateProjectBudget, calculateProjectFinancials, calculateProjectMemberReward, toAmount } from '@/domain/financials';

const StatCard = ({ title, value, icon: Icon, color = "default" }) => (
    <div className={cn("relative overflow-hidden transition-all duration-200 hover:shadow-lg bg-white rounded-lg border p-6")}>
        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
            <Icon className={cn("h-4 w-4", color === "success" && "text-green-600", color === "warning" && "text-yellow-600", color === "danger" && "text-red-600", color === "info" && "text-blue-600")} />
        </div>
        <div className="text-2xl font-bold">{value}</div>
    </div>
);

const InfoCard = ({ label, value, subValue, icon: Icon, isLink = false, to = '#' }) => (
    <div className="transition-all duration-200 hover:shadow-md bg-white rounded-lg border p-4">
        <div className="flex items-center gap-3">
            {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
            <div className="flex-1">
                {isLink ? (
                    <a href={to} className="font-semibold hover:text-primary transition-colors">{value || '-'}</a>
                ) : (
                    <p className="font-semibold">{value || '-'}</p>
                )}
                <p className="text-sm text-muted-foreground">{label}</p>
                {subValue && (
                    <p className="text-xs text-muted-foreground">{subValue}</p>
                )}
            </div>
        </div>
    </div>
);

const StatusBadge = ({ status, config }) => (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors", config?.color || "bg-gray-100 text-gray-800")}>
        {config?.label || status}
    </span>
);

const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = true, actions }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <Card>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors p-4" onClick={() => setIsOpen(!isOpen)}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-5 w-5 text-primary" />}
                        <h3 className="text-lg font-semibold">{title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                </div>
            </CardHeader>
            {isOpen && <CardContent className="p-4">{children}</CardContent>}
        </Card>
    );
};

const FinancialCard = ({ title, value, icon: Icon, colorClass, subValue }) => (
    <div className="p-4 bg-white border rounded-lg">
        <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-full", colorClass)}>
                <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className="text-lg font-bold">{value.toLocaleString('cs-CZ')} Kč</p>
                {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
            </div>
        </div>
    </div>
);

const ProjectDetail = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();
    const { hasPermission, isPrivateMode, memberId } = useAuth();

    const [project, setProject] = useState(null);
    const [members, setMembers] = useState([]);
    const [subcontractors, setSubcontractors] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [costs, setCosts] = useState([]);
    const [overheadCosts, setOverheadCosts] = useState([]);
    const [payoutItems, setPayoutItems] = useState([]);
    const [projectLinks, setProjectLinks] = useState([]);
    const [loading, setLoading] = useState(true);
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

    const canEdit = useMemo(() => hasPermission('projects', 'can_edit'), [hasPermission]);
    const canViewFinance = useMemo(() => hasPermission('projects', 'can_edit') && !isPrivateMode, [hasPermission, isPrivateMode]);

    const updateProjectStatus = useCallback(async (nextStatus) => {
        if (!project || isUpdatingStatus) return;
        setIsUpdatingStatus(true);
        try {
            const { error } = await supabase
                .from('projects')
                .update({ status: nextStatus })
                .eq('id', project.id);
            if (error) throw error;
            setProject((prev) => (prev ? { ...prev, status: nextStatus } : prev));
            toast({ title: 'Stav projektu aktualizován', description: projectStatusConfig[nextStatus]?.label || nextStatus });
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
                    <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
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

    const refreshData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: projectData, error: projectError } = await supabase
              .from('projects')
              .select(`*, investor:subjects!projects_investor_id_fkey(id, name), client:subjects!projects_client_id_fkey(id, name), stage:project_stages(name), project_manager:members!projects_created_by_member_id_fkey(id, name, email)`)
              .eq('id', projectId)
              .single();
              
            if (projectError) { toast({ title: 'Chyba při načítání projektu', variant: 'destructive', description: projectError.message }); navigate('/projects'); return; }
            setProject(projectData);
            setBriefContent(projectData.brief || '');

            const payoutItemsPromise = canViewFinance ? supabase.from('payout_items').select('id, amount, project_id, payouts(status, member:members!payouts_member_id_fkey(name))').eq('project_id', projectId) : Promise.resolve({ data: [], error: null });

            const [membersRes, subcontractorsRes, tasksRes, costsRes, linksRes, overheadCostsRes, payoutItemsRes] = await Promise.all([
                supabase.from('project_members').select('id, project_id, member_id, reward_percentage, reward_amount, reward_type, is_hourly, member:members!project_members_member_id_fkey(id, name, email)').eq('project_id', projectId),
                supabase.from('project_subcontractors').select('id, scope_of_work, price, subject:subjects!project_subcontractors_subject_id_fkey(id, name)').eq('project_id', projectId),
                supabase.from('project_tasks').select('*').eq('project_id', projectId),
                supabase.from('project_costs').select('*').eq('project_id', projectId),
                supabase.from('project_links').select('*').eq('project_id', projectId),
                supabase.from('project_overhead_costs').select('*, overhead_allocation_items!inner(overhead_costs(name, category))').eq('project_id', projectId),
                payoutItemsPromise,
            ]);

            setMembers(membersRes.data || []);
            setSubcontractors(subcontractorsRes.data || []);
            setTasks(tasksRes.data || []);
            setCosts(costsRes.data || []);
            setProjectLinks(linksRes.data || []);
            setOverheadCosts(overheadCostsRes.data || []);
            setPayoutItems(payoutItemsRes.data || []);

        } catch (error) {
            toast({ title: 'Chyba při načítání dat', variant: 'destructive', description: error.message });
        } finally {
            setLoading(false);
        }
    }, [projectId, toast, navigate, canViewFinance]);

    useEffect(() => { refreshData(); }, [refreshData]);

    const handleSaveGeneric = async (table, data, id, dialogSetter, editingState) => {
        const payload = { ...data, project_id: projectId };
        let query = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert(payload);
        const { error } = await query;
        if (error) toast({ title: `Chyba při ukládání`, variant: 'destructive', description: error.message });
        else { toast({ title: '✅ Uloženo' }); if (dialogSetter) dialogSetter(false); if (editingState) editingState(null); refreshData(); }
    };

    const handleDeleteGeneric = async () => {
        if (!itemToDelete) return;
        const { table, id } = itemToDelete;
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) toast({ title: `Chyba při mazání`, variant: 'destructive', description: error.message });
        else { toast({ title: '🗑️ Smazáno' }); refreshData(); }
        setItemToDelete(null);
    };

    const getMemberReward = useCallback((member, teamBudget) => {
        return calculateProjectMemberReward(member, teamBudget);
    }, []);

    const myRewardDisplay = useMemo(() => {
        if (!memberId || !project) return 'N/A';
        const assignment = members.find((member) => String(member.member_id) == String(memberId));
        if (!assignment) return 'N/A';
        const hasReward = assignment.reward_type === 'fixed' || assignment.reward_type === 'percentage';
        if (assignment.is_hourly && !hasReward) return 'Hodinove';
        let teamBudget = 0;
        if (assignment.reward_type === 'percentage') {
            teamBudget = calculateProjectBudget(project, subcontractors).teamBudget;
            if (teamBudget <= 0) { const pct = toAmount(assignment.reward_percentage); return pct > 0 ? `${pct.toFixed(2)} %` : 'N/A'; }
        }
        const amount = getMemberReward(assignment, teamBudget);
        if (amount <= 0) return 'N/A';
        return `${amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kc`;
    }, [memberId, members, project, subcontractors, getMemberReward]);

    const formatReward = (member, teamBudget) => {
        if (!canViewFinance) return 'Skryto';
        let parts = [];
        if (member.is_hourly) parts.push("Hodinová sazba");
        if (member.reward_type) {
            const amount = getMemberReward(member, teamBudget);
            const amountStr = amount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';
            if (member.reward_type === 'percentage') parts.push(`${amountStr} (${(parseFloat(member.reward_percentage) || 0).toFixed(2)}%)`);
            if (member.reward_type === 'fixed') parts.push(`${amountStr} (fixní)`);
        }
        if (parts.length === 0 && member.is_hourly) return "Hodinová sazba";
        if (parts.length === 0) return 'Není specifikováno';
        return parts.join(' + ');
    };

    const paidPayoutItems = useMemo(() => {
        if (!canViewFinance || payoutItems.length === 0) return [];
        return payoutItems.filter((item) => {
            const relatedPayout = Array.isArray(item.payouts) ? item.payouts[0] : item.payouts;
            return relatedPayout?.status === 'paid';
        });
    }, [payoutItems, canViewFinance]);

    const paidOutAmount = useMemo(() => paidPayoutItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0), [paidPayoutItems]);

    const financials = useMemo(() => {
        if (!project || !canViewFinance) return {};
        return calculateProjectFinancials({ project, members, subcontractors, costs, overheadCosts, paidOutAmount });
    }, [project, members, subcontractors, costs, overheadCosts, canViewFinance, paidOutAmount]);

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
            { key: 'paid-payouts', label: 'Vyplacené peníze', note: payoutDetails.length ? `${payoutDetails.length} položek ve stavu "paid"` : 'Ještě nebyla proplacena žádná položka', amount: financials.paidOutAmount || 0, details: payoutDetails },
        ];
    }, [canViewFinance, subcontractors, paidPayoutItems, financials]);

    const getProjectProgress = useCallback(() => tasks.length ? Math.round(tasks.filter(t => t.status === 'Hotovo').length / tasks.length * 100) : 0, [tasks]);

    if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
    if (!project) return <div className="p-8 text-center"><h1 className="text-2xl font-bold">Projekt nenalezen</h1></div>;

    const progress = getProjectProgress();
    const defaultTab = location.hash.substring(1) || "overview";

    return (
        <div>
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b">
                <div className="app-page py-4">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}><ChevronLeft className="h-4 w-4 mr-2" />Zpět</Button>
                            <div><h1 className="text-2xl font-bold">{project.name}</h1><p className="text-muted-foreground font-mono text-sm">{project.code}</p></div>
                        </div>
                        <div className="flex items-center gap-3">
                            {renderStatusMenu()}
                            {canEdit && (
                                <>
                                    <Button variant="outline" onClick={() => setIsTemplateModalOpen(true)}>
                                        <Copy className="h-4 w-4 mr-2" /> Uložit jako šablonu
                                    </Button>
                                    <Button onClick={() => navigate(`/projects/${projectId}/edit`)}>
                                        <Edit2 className="h-4 w-4 mr-2" />Upravit
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>

            <div className="app-page">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {!isPrivateMode && <StatCard title="Celková cena" value={canViewFinance ? `${(project.price || 0).toLocaleString('cs-CZ')} Kč` : myRewardDisplay} icon={DollarSign} color="success" />}
                    <StatCard title="Pokrok projektu" value={`${progress}%`} icon={Target} color={progress > 80 ? "success" : progress > 50 ? "warning" : "danger"} />
                    <StatCard title="Členové týmu" value={members.length} icon={Users} color="info" />
                    <StatCard title="Dokončení" value={project.completion_date ? format(parseISO(project.completion_date), 'd. M. yyyy') : "Není"} icon={Calendar} />
                </motion.div>

                <Tabs value={defaultTab} onValueChange={(value) => navigate(`#${value}`, { replace: true })} className="space-y-6">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
                        <TabsTrigger value="overview" className="flex items-center gap-2"><FileText className="w-4 h-4" />Přehled</TabsTrigger>
                        <TabsTrigger value="team" className="flex items-center gap-2"><Users className="w-4 h-4" />Tým</TabsTrigger>
                        <TabsTrigger value="tasks" className="flex items-center gap-2"><ClipboardList className="w-4 h-4" />Úkoly</TabsTrigger>
                        <TabsTrigger value="engineering" className="flex items-center gap-2"><Briefcase className="w-4 h-4" />Inženýring</TabsTrigger>
                        <TabsTrigger value="documents" className="flex items-center gap-2"><FileText className="w-4 h-4" />Dokumenty</TabsTrigger>
                        <TabsTrigger value="contacts" className="flex items-center gap-2"><Contact className="w-4 h-4" />Kontakty</TabsTrigger>
                        {canViewFinance && <TabsTrigger value="finance" className="flex items-center gap-2"><DollarSign className="w-4 h-4" />Finance</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <InfoCard label="Hlavní projektant" value={project.project_manager?.name || 'N/A'} subValue={project.project_manager?.email} icon={UserCheck} isLink={!!project.project_manager} to={`/members/${project.project_manager?.id}`} />
                            <InfoCard label="Investor" value={project.investor?.name || 'N/A'} icon={Users} isLink={!!project.investor} to={`/subjects/${project.investor?.id}`} />
                            <InfoCard label="Zadavatel" value={project.client?.name || 'N/A'} icon={User} isLink={!!project.client} to={`/subjects/${project.client?.id}`} />
                            <InfoCard label="Stupeň dokumentace" value={project.stage?.name || 'N/A'} icon={FileText} />
                        </div>
                        <CollapsibleSection title="Popis projektu" icon={BookOpen}>
                            {canEdit && <Button variant="outline" size="sm" onClick={() => setIsEditingBrief(true)} className="float-right"><Edit2 className="h-4 w-4" /></Button>}
                            {isEditingBrief ? (
                                <div className="space-y-2"><Textarea value={briefContent} onChange={(e) => setBriefContent(e.target.value)} rows={5} /><div className="flex gap-2"><Button onClick={() => { handleSaveGeneric('projects', { brief: briefContent }, project.id, () => setIsEditingBrief(false), null); }}><Save className="h-4 w-4 mr-2" />Uložit</Button><Button variant="ghost" onClick={() => setIsEditingBrief(false)}>Zrušit</Button></div></div>
                            ) : (<p className="text-muted-foreground whitespace-pre-wrap">{briefContent || 'Není zadán.'}</p>)}
                        </CollapsibleSection>
                        <CollapsibleSection title="Související odkazy" icon={Link2} actions={canEdit && <Button size="sm" onClick={() => { setEditingLink(null); setIsLinkDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat odkaz</Button>}>
                            {projectLinks.length > 0 ? (
                                <div className="space-y-2">
                                    {projectLinks.map(link => (
                                        <div key={link.id} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-50">
                                            <div><a href={link.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{link.description || link.url}</a><p className="text-xs text-muted-foreground">{link.url}</p></div>
                                            {canEdit && <div className="flex gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => { setEditingLink(link); setIsLinkDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={() => setItemToDelete({ table: 'project_links', id: link.id, name: 'odkaz' })}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                            </div>}
                                        </div>
                                    ))}
                                </div>
                            ) : (<p className="text-muted-foreground">Žádné odkazy nebyly přidány.</p>)}
                        </CollapsibleSection>
                    </TabsContent>
                    
                    <TabsContent value="team" className="space-y-6">
                        <CollapsibleSection title="Tým" icon={Users} actions={canEdit && <Button size="sm" onClick={() => { setEditingMember(null); setIsMemberDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat člena</Button>}>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Jméno</TableHead>
                                        <TableHead>Email</TableHead>
                                        {canViewFinance && <TableHead>Odměna</TableHead>}
                                        <TableHead className="text-right">Akce</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.length > 0 ? members.map(m => (
                                        <TableRow key={m.id}>
                                            <TableCell className="font-medium">{m.member?.name}</TableCell>
                                            <TableCell>{m.member?.email}</TableCell>
                                            {canViewFinance && <TableCell>{formatReward(m, financials.teamBudget)}</TableCell>}
                                            <TableCell className="text-right">
                                                {canEdit && (
                                                    <>
                                                        <Button variant="ghost" size="icon" onClick={() => { setEditingMember(m); setIsMemberDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" onClick={() => setItemToDelete({ table: 'project_members', id: m.id, name: 'člena' })}><Trash2 className="h-4 w-4 text-red-500" /></Button>
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
                        <CollapsibleSection title="Subdodavatelé" icon={Briefcase} actions={canEdit && <Button size="sm" onClick={() => { setEditingSubcontractor(null); setIsSubcontractorDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Přidat subdodavatele</Button>}>
                            <Table>
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
                                            <TableCell className="font-medium">{s.subject?.name}</TableCell>
                                            <TableCell>{s.scope_of_work}</TableCell>
                                            {canViewFinance && <TableCell>{(s.price || 0).toLocaleString('cs-CZ')} Kč</TableCell>}
                                            <TableCell className="text-right">
                                                {canEdit && (
                                                    <>
                                                        <Button variant="ghost" size="icon" onClick={() => { setEditingSubcontractor(s); setIsSubcontractorDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" onClick={() => setItemToDelete({ table: 'project_subcontractors', id: s.id, name: 'subdodavatele' })}><Trash2 className="h-4 w-4 text-red-500" /></Button>
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

                    <TabsContent value="tasks"><ProjectTasks projectId={projectId} project={project} tasks={tasks} members={members} canEdit={canEdit} onTaskUpdate={refreshData} /></TabsContent>
                    <TabsContent value="engineering"><ProjectEngineering projectId={projectId} project={project} canEdit={canEdit} /></TabsContent>
                    <TabsContent value="documents"><p>Tato sekce bude implementována.</p></TabsContent>
                    <TabsContent value="contacts"><ProjectContacts projectId={projectId} /></TabsContent>

                    {canViewFinance && <TabsContent value="finance" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                            <FinancialCard title="Celkový budget" value={financials.totalBudget} subValue={`${project.budget_percentage}% z ceny`} icon={Wallet} colorClass="bg-blue-500" />
                            <FinancialCard title="Budget na tým" value={financials.teamBudget} subValue={`Zbývá: ${financials.remainingTeamBudget.toLocaleString('cs-CZ')} Kč`} icon={Users} colorClass="bg-teal-500" />
                            <FinancialCard title="Budget na subdodavatele" value={financials.totalSubcontractorPrice} icon={Briefcase} colorClass="bg-yellow-500" />
                            <FinancialCard title="Rozpočet na režie" value={financials.overheadBudget} subValue={`${project.overhead_percentage}% z budgetu`} icon={ClipboardList} colorClass="bg-purple-500" />
                            <FinancialCard title="Zisk projektu" value={financials.projectProfit} icon={DollarSign} colorClass="bg-green-500" />
                        </div>
                        <CollapsibleSection title="Ostatní náklady" icon={DollarSign} actions={canEdit && <Button size="sm" onClick={() => { setEditingCost(null); setIsCostDialogOpen(true); }}><Plus className="h-4 h-4 mr-2" />Přidat náklad</Button>}>
                            <Table>
                                <TableHeader><TableRow><TableHead>Popis</TableHead><TableHead>Částka</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {(costs.length === 0 && financeDerivedRows.length === 0) ? (
                                        <TableRow><TableCell colSpan={3} className="text-center">Žádné náklady nebyly zadány.</TableCell></TableRow>
                                    ) : (
                                        <>
                                            {costs.map(cost => (
                                                <TableRow key={cost.id}><TableCell>{cost.description}</TableCell><TableCell>{(cost.amount || 0).toLocaleString('cs-CZ')} Kč</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => { setEditingCost(cost); setIsCostDialogOpen(true); }}><Edit2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setItemToDelete({ table: 'project_costs', id: cost.id, name: 'náklad' })}><Trash2 className="h-4 w-4 text-red-500" /></Button></TableCell></TableRow>
                                            ))}
                                            {financeDerivedRows.map((row) => (
                                                <React.Fragment key={row.key}>
                                                    <TableRow className="bg-slate-50/70"><TableCell><div className="font-semibold">{row.label}</div><p className="text-xs text-muted-foreground">{row.note}</p></TableCell><TableCell>{row.amount.toLocaleString('cs-CZ')} Kč</TableCell><TableCell className="text-right text-xs text-muted-foreground italic">automaticky</TableCell></TableRow>
                                                    {row.details?.length ? (<TableRow><TableCell colSpan={3} className="bg-slate-50/40"><div className="space-y-3">{row.details.map((detail) => (<div key={`${row.key}-${detail.key ?? detail.label}`} className="flex flex-col gap-1 rounded-md border bg-white/80 px-3 py-2 text-sm shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="font-medium text-slate-900">{detail.label}</p>{detail.description && (<p className="text-xs text-muted-foreground">{detail.description}</p>)}</div><span className="font-semibold text-slate-900 whitespace-nowrap">{detail.amount.toLocaleString('cs-CZ')} Kč</span></div></div>))}</div></TableCell></TableRow>) : null}
                                                </React.Fragment>
                                            ))}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </CollapsibleSection>
                        <CollapsibleSection title="Připsané režijní náklady" icon={ClipboardList}>
                            <Table>
                                <TableHeader><TableRow><TableHead>Název</TableHead><TableHead>Kategorie</TableHead><TableHead>Částka</TableHead><TableHead>Měsíc</TableHead></TableRow></TableHeader>
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
                    </TabsContent>}
                </Tabs>
            </div>

            <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu chcete smazat tohoto {itemToDelete?.name}?</AlertDialogTitle>
                        <AlertDialogDescription>Tato akce nemůže být vrácena.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteGeneric}>Smazat</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {isMemberDialogOpen && <AssignMemberDialog isOpen={isMemberDialogOpen} onClose={() => setIsMemberDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_members', data, editingMember?.id, () => setIsMemberDialogOpen(false), setEditingMember)} member={editingMember} team={members} project={project} projectSubcontractors={subcontractors} />}
            {isSubcontractorDialogOpen && <AssignSubcontractorDialog isOpen={isSubcontractorDialogOpen} onClose={() => setIsSubcontractorDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_subcontractors', data, editingSubcontractor?.id, () => setIsSubcontractorDialogOpen(false), setEditingSubcontractor)} assignedSubcontractor={editingSubcontractor} projectSubcontractors={subcontractors} />}
            {isCostDialogOpen && <ProjectCostDialog isOpen={isCostDialogOpen} onClose={() => setIsCostDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_costs', data, editingCost?.id, () => setIsCostDialogOpen(false), setEditingCost)} costData={editingCost} projectId={projectId} />}
            {isLinkDialogOpen && <ProjectLinkDialog isOpen={isLinkDialogOpen} onClose={() => setIsLinkDialogOpen(false)} onSave={(data) => handleSaveGeneric('project_links', data, editingLink?.id, () => setIsLinkDialogOpen(false), setEditingLink)} linkData={editingLink} />}
            {isTemplateModalOpen && <SaveTemplateModal isOpen={isTemplateModalOpen} onClose={() => setIsTemplateModalOpen(false)} projectData={{ ...project, tasks }} />}
        </div>
    );
};

export default ProjectDetail;
