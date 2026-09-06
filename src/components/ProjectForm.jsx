import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema } from '@/lib/validationSchemas';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { crmOpportunityPath } from '@/lib/crmRoutes';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from '@/components/ui/switch';
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Briefcase, Building, DollarSign, FileText, Plus, Save, Trash2, ChevronLeft, AlertCircle, Loader2, Info, Copy } from 'lucide-react';
import MemberSelect from '@/components/MemberSelect';
import SubjectSelect from '@/components/SubjectSelect';
import { parseApiError } from '@/lib/apiValidation';
import PageHeader from '@/components/ui/page-header';
import { initializeProjectWorkspace } from '@/lib/documentStorageService';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';

const ProjectForm = () => {
    const { projectId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { memberId, user, hasPermission, isAdmin } = useAuth();
    
    const isEditing = Boolean(projectId);
    const sourceOpportunityId = !isEditing ? searchParams.get('crmOpportunityId') : null;
    const canDelete = hasPermission('projects', 'can_admin');

    const { 
        register, 
        handleSubmit, 
        control, 
        watch, 
        setValue,
        reset,
        getValues,
        formState: { errors, isSubmitting } 
    } = useForm({
        resolver: zodResolver(useMemo(() => createProjectSchema({ requireFinance: isAdmin }), [isAdmin])),
        defaultValues: {
            name: '',
            code: '',
            status: 'nabidka',
            price: 0,
            budget_percentage: 30,
            overhead_percentage: 10,
            type: '',
            stage_id: null,
            created_by_member_id: memberId,
            completion_date: '',
            start_date: '',
            investor_id: null,
            client_id: null,
            is_priority: false
        }
    });

    const [projectTypes, setProjectTypes] = useState([]);
    const [projectStages, setProjectStages] = useState([]);
    const [projectCodePattern, setProjectCodePattern] = useState('');
    const [investorIsClient, setInvestorIsClient] = useState(false);
    const [sourceOpportunity, setSourceOpportunity] = useState(null);
    const [initialInvestor, setInitialInvestor] = useState(null);
    const [initialClient, setInitialClient] = useState(null);
    const [loading, setLoading] = useState(true);
    
    // Templates
    const [templates, setTemplates] = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');

    const unsaved = useUnsavedChanges({
        draftKey: `project:${user?.id || memberId}:${projectId || `new:${sourceOpportunityId || 'standalone'}`}`,
        snapshot: { values: watch(), investorIsClient, selectedTemplateId },
        readSnapshot: () => ({ values: getValues(), investorIsClient, selectedTemplateId }),
        ready: !loading,
        busy: isSubmitting,
        onRestore: draft => {
            reset(draft.values);
            setInvestorIsClient(Boolean(draft.investorIsClient));
            setSelectedTemplateId(draft.selectedTemplateId || '');
        },
    });

    const watchInvestorId = watch('investor_id');

    const buildProjectCodeFromOpportunity = (opportunity) => {
        const base = opportunity?.number || opportunity?.title || 'OP';
        return String(base)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toUpperCase()
            .slice(0, 24) || `OP-${new Date().getFullYear()}`;
    };

    useEffect(() => {
        if (investorIsClient) {
            setValue('client_id', watchInvestorId || null);
        }
    }, [investorIsClient, watchInvestorId, setValue]);

    const fetchTemplates = useCallback(async () => {
        if (!user || isEditing) return;
        setLoadingTemplates(true);
        try {
            const { data, error } = await supabase
                .from('project_templates_custom')
                .select('*')
                .eq('user_id', user.id);
            if (!error && data) setTemplates(data);
        } catch (err) {
            console.error('Failed to load templates', err);
        } finally {
            setLoadingTemplates(false);
        }
    }, [user, isEditing]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [typesRes, stagesRes, patternRes] = await Promise.all([
                supabase.from('project_types').select('id, name').order('name'),
                supabase.from('project_stages').select('id, name').order('name'),
                supabase.from('app_settings').select('value').eq('key', 'project_code_pattern').maybeSingle(),
            ]);

            setProjectTypes(typesRes.data || []);
            setProjectStages(stagesRes.data || []);
            setProjectCodePattern(patternRes.data?.value || '');
            
            if (isEditing) {
                const { data, error } = await supabase.rpc('get_project_safe', { p_project_id: projectId });
                if (error) throw error;
                
                reset({
                    ...data,
                    completion_date: data.completion_date ? format(parseISO(data.completion_date), 'yyyy-MM-dd') : '',
                    start_date: data.start_date ? format(parseISO(data.start_date), 'yyyy-MM-dd') : '',
                    price: isAdmin ? Number(data.price || 0) : null,
                    budget_percentage: isAdmin ? Number(data.budget_percentage ?? 30) : null,
                    overhead_percentage: isAdmin ? Number(data.overhead_percentage ?? 10) : null,
                });
                setInitialInvestor(data.investor || null);
                setInitialClient(data.client || null);
                
                if (data.investor_id && data.investor_id === data.client_id) {
                    setInvestorIsClient(true);
                } else if (!data.client_id && data.investor_id) {
                     setInvestorIsClient(false);
                }
            } else {
                setValue('status', 'nabidka');
                setValue('budget_percentage', 30);
                setValue('overhead_percentage', 10);
                setValue('created_by_member_id', memberId);
                setInvestorIsClient(true);
                if (sourceOpportunityId) {
                    const { data: opportunity, error: opportunityError } = await supabase
                        .from('crm_opportunities')
                        .select('id, number, title, value, expected_close_date, description, subject_id, subject:subject_id(id, name)')
                        .eq('id', sourceOpportunityId)
                        .maybeSingle();

                    if (opportunityError) throw opportunityError;
                    if (opportunity) {
                        setSourceOpportunity(opportunity);
                        setValue('name', opportunity.title || '');
                        setValue('code', buildProjectCodeFromOpportunity(opportunity));
                        setValue('status', 'active');
                        setValue('price', Math.max(1, Number(opportunity.value || 0)));
                        setValue('investor_id', opportunity.subject_id || null);
                        setValue('client_id', opportunity.subject_id || null);
                        setValue('completion_date', opportunity.expected_close_date || '');
                        setInvestorIsClient(true);
                    }
                }
                fetchTemplates();
            }
        } catch (error) {
            console.error("Fetch data error:", error);
            toast({ title: 'Chyba při načítání dat', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [projectId, isEditing, setValue, reset, toast, memberId, fetchTemplates, sourceOpportunityId, isAdmin]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleTemplateSelect = (templateId) => {
        setSelectedTemplateId(templateId);
        if (templateId && templateId !== 'none') {
            const tpl = templates.find(t => t.id === templateId);
            if (tpl) {
                setValue('name', tpl.name);
                toast({ title: 'Šablona aplikována', description: 'Název a předvolby byly načteny.' });
            }
        }
    };


    const onSubmit = async (formData) => {
        let dataToSave = { ...formData };
        // Financial settings are edited only through the audited RPC on the
        // Finance tab. Never let hidden form defaults overwrite them here.
        if (!isAdmin || isEditing) {
            delete dataToSave.price;
            delete dataToSave.budget_percentage;
            delete dataToSave.overhead_percentage;
        }
        
        if (investorIsClient) {
            dataToSave.client_id = dataToSave.investor_id;
        }

        ['investor_id', 'client_id', 'stage_id', 'created_by_member_id'].forEach(key => {
            if (dataToSave[key] === '') dataToSave[key] = null;
        });

        if (!dataToSave.completion_date) dataToSave.completion_date = null;
        if (!dataToSave.start_date) dataToSave.start_date = null;
        if (sourceOpportunityId) dataToSave.crm_opportunity_id = sourceOpportunityId;

        try {
            if (isEditing) {
                const { status: nextStatus, ...projectPayload } = dataToSave;
                const { data: savedProject, error } = await supabase.rpc('save_project_safe', {
                    p_project_id: projectId,
                    p_payload: projectPayload,
                    p_next_status: nextStatus || null,
                });
                if (error) throw error;
                try {
                    await initializeProjectWorkspace({ project: savedProject });
                } catch (storageError) {
                    console.warn('Failed to synchronize project workspace', storageError);
                    toast({
                        title: 'Projekt je uložený, dokumentaci se nepodařilo synchronizovat',
                        description: 'Na kartě Dokumenty lze synchronizaci bezpečně zopakovat.',
                        variant: 'warning',
                    });
                }
                toast({ title: 'Projekt úspěšně aktualizován', variant: 'default' }); 
                unsaved.markSaved();
                navigate(`/projects/${projectId}`);
            } else {
                let { data: newProject, error } = await supabase.rpc('save_project_safe', {
                    p_project_id: null,
                    p_payload: dataToSave,
                    p_next_status: null,
                });
                if (error) throw error;

                if (sourceOpportunityId) {
                    await supabase
                        .from('crm_opportunities')
                        .update({ project_id: newProject.id, updated_at: new Date().toISOString() })
                        .eq('id', sourceOpportunityId);
                }

                try {
                    await initializeProjectWorkspace({ project: newProject });
                } catch (storageError) {
                    console.warn('Failed to prepare project storage folder', storageError);
                    toast({
                        title: 'Projekt je uložený, dokumentaci se nepodařilo připravit',
                        description: 'Na kartě Dokumenty ji lze bezpečně vytvořit znovu.',
                        variant: 'warning',
                    });
                }
                
                if (selectedTemplateId && selectedTemplateId !== 'none') {
                    const tpl = templates.find(t => t.id === selectedTemplateId);
                    if (tpl && tpl.tasks_data && tpl.tasks_data.length > 0) {
                         const tasksToInsert = tpl.tasks_data.map(task => ({
                             ...task,
                             id: undefined,
                             project_id: newProject.id
                         }));
                         const { error: taskError } = await supabase.from('project_tasks').insert(tasksToInsert);
                         if (taskError) {
                             console.error("Failed to insert template tasks", taskError);
                             toast({ title: 'Projekt vytvořen, ale úkoly z šablony se nepodařilo přidat.', variant: 'warning' });
                         }
                    }
                }

                toast({ title: 'Projekt úspěšně vytvořen', variant: 'default' }); 
                unsaved.markSaved();
                navigate(`/projects/${newProject.id}`);
            }
        } catch (error) {
            console.error("Submit error:", error);
            const msg = parseApiError(error);
            toast({ 
                title: 'Chyba při ukládání', 
                variant: 'destructive', 
                description: msg 
            });
        }
    };
    
    const onFormError = (validationErrors) => {
        const firstErrorKey = Object.keys(validationErrors)[0];
        const errorMessage = validationErrors[firstErrorKey]?.message || "Zkontrolujte prosím všechna povinná pole.";
        toast({ title: 'Chyba validace formuláře', description: errorMessage, variant: 'destructive' });
    };

    const handleDelete = async () => {
        try {
            // Updated: Ensure we use 'id'
            const { error } = await supabase.from('projects').delete().eq('id', projectId);
            if (error) throw error;
            toast({ title: 'Projekt byl smazán' });
            unsaved.markSaved();
            navigate('/projects');
        } catch (error) {
             const msg = parseApiError(error);
             toast({ title: 'Chyba při mazání', description: msg, variant: 'destructive' });
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2"/>Načítání projektu...</div>;

    return (
        <div className="app-page-wide pb-20">
            {unsaved.dialogs}
            <PageHeader
                icon={Briefcase}
                title={isEditing ? 'Upravit projekt' : 'Založit nový projekt'}
                actions={
                    <Button variant="ghost" onClick={() => unsaved.requestLeave(isEditing ? `/projects/${projectId}` : '/projects')} className="text-slate-500 hover:text-slate-800">
                        <ChevronLeft className="w-4 h-4 mr-2" /> Zpět
                    </Button>
                }
                className="mb-6"
            />
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="hidden">
                 <Button variant="ghost" onClick={() => unsaved.requestLeave(isEditing ? `/projects/${projectId}` : '/projects')} className="mb-4 text-slate-500 hover:text-slate-800">
                    <ChevronLeft className="w-4 h-4 mr-2" /> Zpět
                </Button>
                <h1 className="text-3xl font-bold mb-6 flex items-center gap-3 text-slate-800">
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                        <Briefcase className="w-7 h-7 text-primary" />
                    </div>
                    {isEditing ? 'Upravit projekt' : 'Založit nový projekt'}
                </h1>
            </motion.div>

            {unsaved.dirty && <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Máte neuložené změny. Uložte je pomocí tlačítka na konci formuláře.</p>}
            <form onSubmit={handleSubmit(onSubmit, onFormError)} className="space-y-6">
                {sourceOpportunity && (
                    <Card className="border-emerald-200 bg-emerald-50/80 shadow-sm">
                        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-emerald-950">
                                    Projekt bude vytvoren z obchodniho pripadu {sourceOpportunity.number || ''}
                                </p>
                                <p className="text-sm text-emerald-800">
                                    {sourceOpportunity.title} {sourceOpportunity.subject?.name ? `- ${sourceOpportunity.subject.name}` : ''}
                                </p>
                            </div>
                            <Button type="button" variant="outline" onClick={() => unsaved.requestLeave(crmOpportunityPath(sourceOpportunity))}>
                                Zpet na OP
                            </Button>
                        </CardContent>
                    </Card>
                )}
                
                {!isEditing && (
                    <Card className="shadow-sm border-slate-200 bg-blue-50/30">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <Copy className="w-5 h-5 text-blue-500 shrink-0" />
                                <div className="flex-1">
                                    <Label className="text-slate-700 block mb-1.5">Vybrat šablonu (volitelné)</Label>
                                    <Select value={selectedTemplateId} onValueChange={handleTemplateSelect} disabled={loadingTemplates}>
                                        <SelectTrigger className="bg-white">
                                            <SelectValue placeholder={loadingTemplates ? "Načítání šablon..." : "Začít s prázdným projektem"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">-- Prázdný projekt --</SelectItem>
                                            {templates.map(t => (
                                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                        <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
                            <FileText className="w-5 h-5 text-slate-500" />Základní informace
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-6">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                                <Label htmlFor="name" className="text-slate-700">Název projektu <span className="text-red-500">*</span></Label>
                                <Input id="name" {...register('name')} className={errors.name ? 'border-red-500 focus-visible:ring-red-500' : ''} placeholder="Např. Bytový dům Praha" />
                                {errors.name && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.name.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="code" className="text-slate-700">Kód projektu <span className="text-red-500">*</span></Label>
                                <Input id="code" {...register('code')} placeholder={projectCodePattern || 'PRJ-2026-001'} className={errors.code ? 'border-red-500 focus-visible:ring-red-500' : ''} />
                                {errors.code && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.code.message}</p>}
                            </div>
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                                <Label className="text-slate-700">Druh projektu</Label>
                                <Controller name="type" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value || ''}>
                                        <SelectTrigger className="bg-white"><SelectValue placeholder="Vyberte druh" /></SelectTrigger>
                                        <SelectContent>{projectTypes.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-700">Stupeň dokumentace</Label>
                                 <Controller name="stage_id" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value || ''}>
                                        <SelectTrigger className="bg-white"><SelectValue placeholder="Vyberte stupeň" /></SelectTrigger>
                                        <SelectContent>{projectStages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )} />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-1.5">
                                <Label htmlFor="start_date" className="text-slate-700">Datum zahájení</Label>
                                <Input id="start_date" type="date" {...register('start_date')} className="bg-white" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="completion_date" className="text-slate-700">Termín dokončení</Label>
                                <Input id="completion_date" type="date" {...register('completion_date')} className={errors.completion_date ? 'border-red-500' : 'bg-white'}/>
                                {errors.completion_date && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.completion_date.message}</p>}
                            </div>
                            <div className="space-y-1.5">
                                <Controller 
                                    name="created_by_member_id" 
                                    control={control} 
                                    render={({ field }) => (
                                        <MemberSelect
                                            label="Hlavní projektant"
                                            value={field.value}
                                            onChange={field.onChange}
                                            placeholder="Vyberte osobu..."
                                        />
                                    )} 
                                />
                            </div>
                        </div>
                        <div className="flex items-center space-x-3 p-4 bg-slate-50 rounded-lg border border-slate-100">
                             <Controller name="is_priority" control={control} render={({ field }) => <Switch id="is_priority" checked={field.value} onCheckedChange={field.onChange} />} />
                             <div className="space-y-0.5">
                                <Label htmlFor="is_priority" className="font-medium text-slate-800 cursor-pointer">Prioritní projekt</Label>
                                <p className="text-xs text-slate-500">Označí projekt jako důležitý v přehledech a tabulkách.</p>
                             </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                        <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
                            <Building className="w-5 h-5 text-slate-500" />Zúčastněné strany
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-6">
                        <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg mb-2">
                            <p className="text-sm text-blue-800 flex items-start gap-2">
                                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                                Zvolte subjekty spojené s tímto projektem. Pokud je zadavatel stejný jako investor, stačí ponechat zaškrtnuté příslušné pole.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                             <Controller 
                                name="investor_id" 
                                control={control} 
                                render={({ field }) => (
                                    <SubjectSelect
                                        label="Konečný Investor"
                                        value={field.value}
                                        onChange={field.onChange}
                                        initialSubject={initialInvestor}
                                        placeholder="Vyhledat investora..."
                                    />
                                )} 
                             />
                             {errors.investor_id && <p className="text-red-500 text-xs flex items-center"><AlertCircle className="w-3 h-3 mr-1"/>{errors.investor_id.message}</p>}
                        </div>

                        <div className="flex items-center space-x-3 py-2">
                            <Checkbox id="investorIsClient" checked={investorIsClient} onCheckedChange={setInvestorIsClient} />
                            <Label htmlFor="investorIsClient" className="cursor-pointer text-slate-700">Investor je zároveň přímý zadavatel (klient)</Label>
                        </div>
                        
                        <AnimatePresence>
                        {!investorIsClient && (
                            <motion.div 
                                initial={{ opacity: 0, height: 0, marginTop: 0 }} 
                                animate={{ opacity: 1, height: 'auto', marginTop: 8 }} 
                                exit={{ opacity: 0, height: 0, marginTop: 0 }} 
                                className="overflow-hidden"
                            >
                                <div className="flex flex-col gap-1.5 p-4 bg-slate-50 rounded-lg border border-slate-100">
                                    <Controller 
                                        name="client_id" 
                                        control={control} 
                                        render={({ field }) => (
                                            <SubjectSelect
                                                label="Zadavatel (Klient)"
                                                value={field.value}
                                                onChange={field.onChange}
                                                initialSubject={initialClient}
                                                placeholder="Vyhledat zadavatele..."
                                            />
                                        )} 
                                    />
                                    {errors.client_id && <p className="text-red-500 text-xs flex items-center"><AlertCircle className="w-3 h-3 mr-1"/>{errors.client_id.message}</p>}
                                </div>
                            </motion.div>
                        )}
                        </AnimatePresence>
                    </CardContent>
                </Card>

                {isAdmin && <Card className="shadow-sm border-slate-200">
                     <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                         <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
                            <DollarSign className="w-5 h-5 text-slate-500" />{isEditing ? 'Stav projektu' : 'Finance a nastavení'}
                         </CardTitle>
                     </CardHeader>
                     <CardContent className="space-y-6 pt-6">
                         {!isEditing && <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                             <div className="space-y-1.5">
                                <Label className="text-slate-700">Prodejní cena (Kč bez DPH)</Label>
                                <Input type="number" step="0.01" {...register('price')} className={errors.price ? 'border-red-500 font-medium' : 'font-medium bg-white'} />
                                {errors.price && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.price.message}</p>}
                             </div>
                             <div className="space-y-1.5">
                                <Label className="text-slate-700">Celkový budget (%)</Label>
                                <Input type="number" step="0.1" {...register('budget_percentage')} className={errors.budget_percentage ? 'border-red-500 bg-white' : 'bg-white'} />
                                {errors.budget_percentage && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.budget_percentage.message}</p>}
                             </div>
                             <div className="space-y-1.5">
                                <Label className="text-slate-700">Režie z budgetu (%)</Label>
                                <Input type="number" step="0.1" {...register('overhead_percentage')} className={errors.overhead_percentage ? 'border-red-500 bg-white' : 'bg-white'} />
                                {errors.overhead_percentage && <p className="text-red-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.overhead_percentage.message}</p>}
                             </div>
                         </div>}
                         <div className="w-full md:w-1/3">
                             <Label className="text-slate-700 mb-1.5 block">Stav projektu</Label>
                             <Controller name="status" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="nabidka">Nabídka</SelectItem>
                                        <SelectItem value="active">Aktivní</SelectItem>
                                        <SelectItem value="ready_for_delivery">Připraveno k dodání</SelectItem>
                                        <SelectItem value="delivered">Dodáno</SelectItem>
                                        <SelectItem value="closed">Uzavřeno</SelectItem>
                                    </SelectContent>
                                </Select>
                             )} />
                         </div>
                     </CardContent>
                </Card>}

                <div className="flex flex-col-reverse sm:flex-row justify-between items-center gap-4 pt-4">
                    <div>
                    {isEditing && canDelete && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button type="button" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                                    <Trash2 className="w-4 h-4 mr-2" /> Smazat projekt
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle className="text-red-600">Opravdu chcete smazat tento projekt?</AlertDialogTitle>
                                    <AlertDialogDescription>Tato akce je nevratná a smaže veškerá související data (úkoly, dokumenty, vazby).</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">Ano, smazat nenávratně</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => unsaved.requestLeave(isEditing ? `/projects/${projectId}` : '/projects')}>
                            Zrušit
                        </Button>
                        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto min-w-[140px] shadow-sm">
                            {isSubmitting ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Ukládání...</>
                            ) : (
                                isEditing ? <><Save className="w-4 h-4 mr-2"/> Uložit změny</> : <><Plus className="w-4 h-4 mr-2"/> Vytvořit projekt</>
                            )}
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default ProjectForm;
