import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RealizationSchema } from '@/lib/validationSchemas';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { crmOpportunityPath } from '@/lib/crmRoutes';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { HardHat, Calendar, Plus, Save, Trash2, ChevronLeft, MapPin, User, Building, Users, DollarSign, TrendingUp, X, AlertCircle, Percent, Coins } from 'lucide-react';
import SubjectDialog from '@/components/SubjectDialog';
import { parseApiError } from '@/lib/apiValidation';
import SubjectSelect from '@/components/SubjectSelect';
import MemberSelect from '@/components/MemberSelect';
import PageHeader from '@/components/ui/page-header';
import { ensureEntityFolder } from '@/lib/documentStorageService';

const RealizaceForm = () => {
    const { realizaceId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { hasPermission, userRole } = useAuth();

    const isEditing = Boolean(realizaceId);
    const sourceOpportunityId = !isEditing ? searchParams.get('crmOpportunityId') : null;
    // Strict role check
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';
    const canDelete = hasPermission('realizace', 'can_delete') && userRole !== 'user';

    const [realizationData, setRealizationData] = useState(null);
    const [members, setMembers] = useState([]);
    const [realizationTypes, setRealizationTypes] = useState([]);
    const [sourceOpportunity, setSourceOpportunity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [teamEntries, setTeamEntries] = useState([{ member_id: '', share_type: '', share_value: '' }]);
    const [profitSharesLoading, setProfitSharesLoading] = useState(false);

    // Toggle states for percent/fixed
    const [profitMode, setProfitMode] = useState('percent'); // 'percent' | 'fixed'
    const [overheadMode, setOverheadMode] = useState('percent'); // 'percent' | 'fixed'


    // Subject Dialog State
    const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
    const [subjectDialogTarget, setSubjectDialogTarget] = useState(null); // 'investor'

    // Form setup with Zod
    const { 
        register, 
        handleSubmit, 
        control, 
        setValue, 
        watch, 
        formState: { errors, isSubmitting } 
    } = useForm({
        resolver: zodResolver(RealizationSchema),
        defaultValues: {
            name: '',
            status: 'Připravuje se',
            type: '',
            investor_id: null,
            lead_person_id: null,
            contract_amount: 0,
            budget: 0,
            expected_total_cost: 0,
            actual_costs: 0,
            profit_margin_percent: 0,
            overhead_percent: 0,
            start_date: '',
            planned_end_date: '',
            actual_end_date: '',
            location_address: ''
        }
    });

    const watchStatus = watch('status', '');
    const watchContract = watch('contract_amount', 0);
    const watchActual = watch('actual_costs', 0);
    const watchExpected = watch('expected_total_cost', 0);
    const watchBudget = watch('budget', 0);
    const watchProfitPercent = watch('profit_margin_percent', 0);
    const watchOverheadPercent = watch('overhead_percent', 0);

    const realizationStatuses = ['Připravuje se', 'Probíhá', 'Pozastaveno', 'Dokončeno', 'Předáno'];
    const isCompleted = watchStatus === 'Dokončeno';
    
    const numberVal = (val) => {
        const n = parseFloat(val);
        return Number.isNaN(n) ? 0 : n;
    };
    const safeContract = numberVal(watchContract);
    const safeActual = numberVal(watchActual);
    const safeExpected = numberVal(watchExpected);
    const safeBudget = numberVal(watchBudget);
    const baseCost = safeActual ?? safeExpected ?? safeBudget ?? 0;
    const availableProfitRaw = safeContract - baseCost;
    const availableProfit = Number.isFinite(availableProfitRaw) ? Math.max(0, availableProfitRaw) : 0;
    const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value || 0);

    // Helpers for switching modes
    const getProfitValue = () => {
        if (profitMode === 'percent') return watchProfitPercent;
        if (safeContract === 0) return 0;
        return (numberVal(watchProfitPercent) / 100) * safeContract;
    };

    const getOverheadValue = () => {
        if (overheadMode === 'percent') return watchOverheadPercent;
        if (safeContract === 0) return 0;
        return (numberVal(watchOverheadPercent) / 100) * safeContract;
    };

    const handleProfitChange = (e) => {
        const val = numberVal(e.target.value);
        if (profitMode === 'percent') {
            setValue('profit_margin_percent', val);
        } else {
            // Fixed mode: calculate percent
            if (safeContract > 0) {
                setValue('profit_margin_percent', (val / safeContract) * 100);
            } else {
                setValue('profit_margin_percent', 0);
            }
        }
    };

    const handleOverheadChange = (e) => {
        const val = numberVal(e.target.value);
        if (overheadMode === 'percent') {
            setValue('overhead_percent', val);
        } else {
            // Fixed mode: calculate percent
            if (safeContract > 0) {
                setValue('overhead_percent', (val / safeContract) * 100);
            } else {
                setValue('overhead_percent', 0);
            }
        }
    };


    const loadProfitShares = useCallback(async (id) => {
        setProfitSharesLoading(true);
        const { data, error } = await supabase
            .from('realization_profit_shares')
            .select('member_id, share_type, share_value')
            .eq('realizace_id', id);

        if (!error && data) {
            setTeamEntries((prev) => {
                const base = prev.length ? prev : [{ member_id: '', share_type: '', share_value: '' }];
                const merged = base.map((entry) => {
                    const found = data.find((s) => s.member_id === entry.member_id);
                    if (found) {
                        return { ...entry, share_type: found.share_type, share_value: found.share_value };
                    }
                    return entry;
                });
                const extras = data
                    .filter((s) => !merged.some((m) => m.member_id === s.member_id))
                    .map((s) => ({ member_id: s.member_id, share_type: s.share_type, share_value: s.share_value }));
                return [...merged, ...extras];
            });
        } else if (error) {
            toast({ title: 'Chyba při načítání podílů', description: error.message, variant: 'destructive' });
        }
        setProfitSharesLoading(false);
    }, [toast]);

    const fetchData = useCallback(async () => {
        try {
            const [membersRes, typesRes] = await Promise.all([
                supabase.from('members').select('id, name').order('name'),
                supabase.from('realization_types').select('name').order('name'),
            ]);

            setMembers(membersRes.data || []);
            setRealizationTypes(typesRes.data?.map(t => t.name) || []);

            if (isEditing) {
                const { data, error } = await supabase.from('realizations').select('*').eq('id', realizaceId).single();
                if (error) throw error;
                setRealizationData(data);
                
                Object.keys(data).forEach(key => {
                    if ((key.endsWith('_date')) && data[key]) {
                        setValue(key, format(parseISO(data[key]), 'yyyy-MM-dd'));
                    } else if (key !== 'id' && key !== 'created_at') {
                        setValue(key, data[key]);
                    }
                });

                if (data.team_members && Array.isArray(data.team_members)) {
                    setTeamEntries(data.team_members.map((id) => ({ member_id: id, share_type: '', share_value: '' })));
                }
                await loadProfitShares(realizaceId);
            } else {
                setValue('status', 'Připravuje se');
                setTeamEntries([{ member_id: '', share_type: '', share_value: '' }]);
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
                        setValue('investor_id', opportunity.subject_id || null);
                        setValue('contract_amount', Number(opportunity.value || 1));
                        setValue('budget', Math.round(Number(opportunity.value || 0) * 0.72));
                        setValue('expected_total_cost', Math.round(Number(opportunity.value || 0) * 0.72));
                        setValue('planned_end_date', opportunity.expected_close_date || '');
                        setValue('status', 'Připravuje se');
                    }
                }
            }
        } catch (error) {
            toast({ title: 'Chyba při načítání dat', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [realizaceId, isEditing, setValue, toast, loadProfitShares, sourceOpportunityId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const onSubmit = async (formData) => {
        if (!canEdit) {
            toast({ title: 'Nemáte oprávnění k úpravám', variant: 'destructive' });
            return;
        }

        let dataToSave = { ...formData };
        
        // Cleanup empty strings to null
        ['investor_id', 'lead_person_id', 'start_date', 'planned_end_date', 'actual_end_date'].forEach(key => {
            if (dataToSave[key] === '') dataToSave[key] = null;
        });

        // Ensure numbers
        dataToSave.profit_margin_percent = numberVal(dataToSave.profit_margin_percent);
        dataToSave.overhead_percent = numberVal(dataToSave.overhead_percent);


        // Add team members to payload
        const memberIds = teamEntries.map(entry => entry.member_id).filter(Boolean);
        dataToSave.team_members = memberIds;
        if (sourceOpportunityId) dataToSave.crm_opportunity_id = sourceOpportunityId;

        if (dataToSave.status === 'Dokončeno') {
            const percentTotal = teamEntries
                .filter((entry) => entry.share_type === 'percent')
                .reduce((sum, entry) => sum + numberVal(entry.share_value), 0);
            const fixedTotal = teamEntries
                .filter((entry) => entry.share_type === 'fixed')
                .reduce((sum, entry) => sum + numberVal(entry.share_value), 0);

            if (percentTotal > 100) {
                toast({ title: 'Součet procent přesáhl 100 %', variant: 'destructive' });
                return;
            }

            const projected = fixedTotal + (availableProfit * (percentTotal / 100));
            if (!Number.isFinite(projected) || projected > availableProfit + 0.01) {
                toast({ title: 'Rozdělení přesahuje dostupný zisk', description: 'Upravte částky nebo procenta.', variant: 'destructive' });
                return;
            }
        }

        try {
            let targetId = realizaceId;
            if (isEditing) {
                const { status: nextStatus, ...realizationPayload } = dataToSave;
                const { error } = await supabase.from('realizations').update(realizationPayload).eq('id', realizaceId);
                if (error) throw error;
                if (nextStatus) {
                    const { error: statusError } = await supabase.rpc('update_realization_status', {
                        p_realization_id: realizaceId,
                        p_next_status: nextStatus,
                        p_note: 'realization_form_update',
                    });
                    if (statusError) throw statusError;
                }
            } else {
                let { data: newRealization, error } = await supabase.from('realizations').insert(dataToSave).select().single();
                if (error && ['42703', 'PGRST204'].includes(error.code) && sourceOpportunityId) {
                    const { crm_opportunity_id, ...legacyData } = dataToSave;
                    const legacyResult = await supabase.from('realizations').insert(legacyData).select().single();
                    newRealization = legacyResult.data;
                    error = legacyResult.error;
                }
                if (error) throw error;
                targetId = newRealization.id;

                if (sourceOpportunityId) {
                    await supabase
                        .from('crm_opportunities')
                        .update({ realization_id: newRealization.id, updated_at: new Date().toISOString() })
                        .eq('id', sourceOpportunityId);
                }

                try {
                    await ensureEntityFolder({
                        entityType: 'realizace',
                        entityId: newRealization.id,
                        code: newRealization.code,
                        name: newRealization.name,
                    });
                } catch (storageError) {
                    console.warn('Failed to prepare realization storage folder', storageError);
                    toast({ title: 'Realizace vytvořena, ale složku dokumentů se nepodařilo připravit.', variant: 'warning' });
                }
            }

            // Pokud je dokončeno, uložíme rozdělení zisku pro tým
            if (dataToSave.status === 'Dokončeno' && targetId) {
                const shares = teamEntries
                    .filter(entry => entry.member_id && entry.share_type && parseFloat(entry.share_value) > 0)
                    .map(entry => ({
                        realizace_id: targetId,
                        member_id: entry.member_id,
                        share_type: entry.share_type,
                        share_value: parseFloat(entry.share_value)
                    }));

                await supabase.from('realization_profit_shares').delete().eq('realizace_id', targetId);
                if (shares.length) {
                    await supabase.from('realization_profit_shares').insert(shares);
                }
            }

            toast({ title: isEditing ? 'Realizace aktualizována' : 'Realizace vytvořena' });
            navigate(`/realizace/${targetId}`);
        } catch (error) {
             const msg = parseApiError(error);
             toast({ 
                title: 'Chyba při ukládání', 
                description: msg, 
                variant: 'destructive' 
             });
        }
    };

    const handleDelete = async () => {
        try {
            const { error } = await supabase.from('realizations').delete().eq('id', realizaceId);
            if (error) throw error;
            toast({ title: 'Realizace smazána' });
            navigate('/realizace');
        } catch (error) {
            const msg = parseApiError(error);
            toast({ title: 'Chyba při mazání', description: msg, variant: 'destructive' });
        }
    };

    const handleSubjectSave = async (formData) => {
        try {
            const { data: newSubject, error } = await supabase
                .from('subjects')
                .insert(formData)
                .select()
                .single();
            
            if (error) throw error;

            if (subjectDialogTarget === 'investor') {
                setValue('investor_id', newSubject.id);
            }

            toast({ title: 'Subjekt vytvořen', description: `Subjekt ${newSubject.name} byl úspěšně přidán.` });
            setIsSubjectDialogOpen(false);
            setSubjectDialogTarget(null);
        } catch (error) {
            const msg = parseApiError(error);
            toast({ title: 'Chyba při vytváření subjektu', description: msg, variant: 'destructive' });
        }
    };

    if (loading) return <div>Načítání...</div>;

    // If user somehow gets here without permission
    if (!canEdit) {
        return (
            <div className="app-page-wide text-center">
                <Card>
                    <CardHeader>
                        <CardTitle>Přístup odepřen</CardTitle>
                    </CardHeader>
                    <CardContent>
                        Nemáte oprávnění k úpravám této realizace.
                    </CardContent>
                    <CardFooter className="justify-center">
                        <Button onClick={() => navigate(isEditing ? `/realizace/${realizaceId}` : '/realizace')}>Zpět</Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="app-page-wide">
            <PageHeader
                icon={HardHat}
                title={isEditing ? 'Upravit realizaci' : 'Nová realizace'}
                actions={
                    <Button variant="ghost" onClick={() => navigate(isEditing ? `/realizace/${realizaceId}` : '/realizace')}>
                        <ChevronLeft className="w-4 h-4 mr-2" /> Zpět
                    </Button>
                }
                className="mb-6"
            />
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="hidden">
                <Button variant="ghost" onClick={() => navigate(isEditing ? `/realizace/${realizaceId}` : '/realizace')} className="mb-4">
                    <ChevronLeft className="w-4 h-4 mr-2" /> Zpět
                </Button>
                <h1 className="text-3xl font-bold mb-6 flex items-center gap-3">
                    <HardHat className="w-8 h-8 text-primary" />
                    {isEditing ? 'Upravit realizaci' : 'Nová realizace'}
                </h1>
            </motion.div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {sourceOpportunity && (
                    <Card className="border-emerald-200 bg-emerald-50/80 shadow-sm">
                        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-emerald-950">
                                    Realizace bude vytvorena z obchodniho pripadu {sourceOpportunity.number || ''}
                                </p>
                                <p className="text-sm text-emerald-800">
                                    {sourceOpportunity.title} {sourceOpportunity.subject?.name ? `- ${sourceOpportunity.subject.name}` : ''}
                                </p>
                            </div>
                            <Button type="button" variant="outline" onClick={() => navigate(crmOpportunityPath(sourceOpportunity))}>
                                Zpet na OP
                            </Button>
                        </CardContent>
                    </Card>
                )}
                <fieldset disabled={!canEdit || isSubmitting}>
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />Základní informace</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1">
                                <Label htmlFor="name">Název realizace *</Label>
                                <Input id="name" {...register('name')} className={errors.name ? 'border-red-500' : ''} />
                                {errors.name && <p className="text-red-500 text-xs">{errors.name.message}</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label>Investor</Label>
                                    <Controller 
                                        name="investor_id" 
                                        control={control} 
                                        render={({ field }) => (
                                            <SubjectSelect
                                                value={field.value}
                                                onChange={field.onChange}
                                                placeholder="Vybrat investora..."
                                            />
                                        )} 
                                    />
                                </div>
                                <div>
                                    <Label>Vedoucí realizace</Label>
                                    <Controller 
                                        name="lead_person_id" 
                                        control={control} 
                                        render={({ field }) => (
                                            <MemberSelect
                                                value={field.value}
                                                onChange={field.onChange}
                                                placeholder="Vybrat vedoucího..."
                                            />
                                        )} 
                                    />
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="location_address">Místo realizace</Label>
                                <Input id="location_address" {...register('location_address')} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label>Typ</Label>
                                    <Controller name="type" control={control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <SelectTrigger><SelectValue placeholder="Vyberte typ" /></SelectTrigger>
                                            <SelectContent>{realizationTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                                        </Select>
                                    )} />
                                </div>
                                <div>
                                    <Label>Stav</Label>
                                    <Controller name="status" control={control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <SelectTrigger><SelectValue placeholder="Vyberte stav" /></SelectTrigger>
                                            <SelectContent>{realizationStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                        </Select>
                                    )} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    
                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Finance a rozpočet</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label htmlFor="contract_amount">Celková částka zakázky (Kč)</Label>
                                    <Input 
                                        id="contract_amount" 
                                        type="number" 
                                        step="0.01"
                                        {...register('contract_amount')} 
                                        className={errors.contract_amount ? 'border-red-500' : ''}
                                    />
                                    {errors.contract_amount && <p className="text-red-500 text-xs">{errors.contract_amount.message}</p>}
                                    <p className="text-xs text-muted-foreground mt-1">Smluvní hodnota/zakázková cena, ze které se počítá zisk.</p>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="budget">Plánovaný rozpočet (Kč)</Label>
                                    <Input 
                                        id="budget" 
                                        type="number" 
                                        step="0.01"
                                        {...register('budget')} 
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Celková alokovaná částka na realizaci.</p>
                                </div>
                            </div>
                            
                            {/* NEW FINANCIAL FIELDS: Profit & Overhead */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="profit_margin_percent">
                                            Zisk ({profitMode === 'percent' ? '%' : 'CZK'})
                                        </Label>
                                        <div className="flex bg-muted rounded-lg p-0.5 h-6">
                                            <button
                                                type="button"
                                                onClick={() => setProfitMode('percent')}
                                                className={`px-2 flex items-center justify-center rounded-md text-xs transition-colors ${profitMode === 'percent' ? 'bg-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                                title="Zadat v procentech"
                                            >
                                                <Percent className="w-3 h-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setProfitMode('fixed')}
                                                className={`px-2 flex items-center justify-center rounded-md text-xs transition-colors ${profitMode === 'fixed' ? 'bg-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                                title="Zadat fixní částkou"
                                            >
                                                <Coins className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                    <Input
                                        id="profit_margin_display"
                                        type="number"
                                        step={profitMode === 'percent' ? "0.1" : "1"}
                                        value={Number(getProfitValue()).toFixed(2)}
                                        onChange={handleProfitChange}
                                        disabled={profitMode === 'fixed' && safeContract === 0}
                                        className={errors.profit_margin_percent ? 'border-red-500' : ''}
                                    />
                                    {errors.profit_margin_percent && <p className="text-red-500 text-xs">{errors.profit_margin_percent.message}</p>}
                                    {profitMode === 'fixed' && safeContract === 0 && (
                                        <p className="text-orange-500 text-xs">Zadejte nejprve částku zakázky pro výpočet.</p>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="overhead_percent">
                                            Režije ({overheadMode === 'percent' ? '%' : 'CZK'})
                                        </Label>
                                        <div className="flex bg-muted rounded-lg p-0.5 h-6">
                                            <button
                                                type="button"
                                                onClick={() => setOverheadMode('percent')}
                                                className={`px-2 flex items-center justify-center rounded-md text-xs transition-colors ${overheadMode === 'percent' ? 'bg-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                                title="Zadat v procentech"
                                            >
                                                <Percent className="w-3 h-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setOverheadMode('fixed')}
                                                className={`px-2 flex items-center justify-center rounded-md text-xs transition-colors ${overheadMode === 'fixed' ? 'bg-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                                title="Zadat fixní částkou"
                                            >
                                                <Coins className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                    <Input
                                        id="overhead_display"
                                        type="number"
                                        step={overheadMode === 'percent' ? "0.1" : "1"}
                                        value={Number(getOverheadValue()).toFixed(2)}
                                        onChange={handleOverheadChange}
                                        disabled={overheadMode === 'fixed' && safeContract === 0}
                                        className={errors.overhead_percent ? 'border-red-500' : ''}
                                    />
                                    {errors.overhead_percent && <p className="text-red-500 text-xs">{errors.overhead_percent.message}</p>}
                                     {overheadMode === 'fixed' && safeContract === 0 && (
                                        <p className="text-orange-500 text-xs">Zadejte nejprve částku zakázky pro výpočet.</p>
                                    )}
                                </div>
                            </div>
                            
                            {/* Hidden inputs to actually register the values properly if we used uncontrolled above, 
                                but we are using controlled setValue so we don't strictly need these, 
                                but registering them ensures they are in the formData submitted. 
                                Since we use setValue, we should make sure the register is called or use Controller.
                                The simplest way is to register them hidden, or just rely on getValues/watch if we were manual. 
                                But handleSubmit uses registered fields.
                                Let's add hidden inputs to ensure registration. */}
                            <input type="hidden" {...register('profit_margin_percent')} />
                            <input type="hidden" {...register('overhead_percent')} />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
                                <div className="space-y-1">
                                    <Label htmlFor="expected_total_cost">Očekávaný celkový náklad (Kč)</Label>
                                    <Input 
                                        id="expected_total_cost" 
                                        type="number" 
                                        step="0.01"
                                        {...register('expected_total_cost')} 
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Plánovaný náklad, oproti kterému se vyhodnocuje skutečnost.</p>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="actual_costs">Aktuální náklady (Kč)</Label>
                                    <Input 
                                        id="actual_costs" 
                                        type="number" 
                                        step="0.01"
                                        {...register('actual_costs')} 
                                        className={errors.actual_costs ? 'border-red-500' : ''}
                                    />
                                    {errors.actual_costs && <p className="text-red-500 text-xs">{errors.actual_costs.message}</p>}
                                    {safeActual > safeContract && (
                                        <p className="text-orange-500 text-xs flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>Pozor: Náklady převyšují smluvní částku.</p>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">Manuální override, pokud nechcete počítat automaticky z objednávek a nákladů.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Tým realizace</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <p className="text-sm text-muted-foreground">
                                        {isCompleted ? `Dostupný zisk k rozdělení: ${formatCurrency(availableProfit)}` : 'Vyberte členy týmu, kteří budou mít přístup.'}
                                    </p>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setTeamEntries([...teamEntries, { member_id: '', share_type: '', share_value: '' }])} disabled={!canEdit}>
                                        <Plus className="w-4 h-4 mr-2" /> Přidat člena
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {teamEntries.map((entry, idx) => (
                                        <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 border rounded-lg bg-slate-50/60">
                                            {(() => {
                                                const shareVal = numberVal(entry.share_value);
                                                const payout = entry.share_type === 'percent'
                                                    ? (availableProfit * shareVal) / 100
                                                    : entry.share_type === 'fixed'
                                                        ? shareVal
                                                        : 0;
                                                entry._computedPayout = payout; 
                                                return null;
                                            })()}
                                            <div className="md:col-span-4">
                                                <Label className="text-xs text-muted-foreground">Člen týmu</Label>
                                                <Controller
                                                    name={`team_member_${idx}`}
                                                    control={control}
                                                    render={() => (
                                                        <MemberSelect
                                                            value={entry.member_id}
                                                            onChange={(value) => {
                                                                const clone = [...teamEntries];
                                                                clone[idx].member_id = value;
                                                                setTeamEntries(clone);
                                                            }}
                                                            placeholder="Vybrat člena..."
                                                        />
                                                    )}
                                                />
                                            </div>

                                            {isCompleted && (
                                                <>
                                                    <div className="md:col-span-4">
                                                        <Label className="text-xs text-muted-foreground">Typ podílu</Label>
                                                        <Select
                                                            value={entry.share_type || 'none'}
                                                            onValueChange={(value) => {
                                                                const clone = [...teamEntries];
                                                                clone[idx].share_type = value === 'none' ? '' : value;
                                                                clone[idx].share_value = '';
                                                                setTeamEntries(clone);
                                                            }}
                                                            disabled={!canEdit}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder="Nezadáno" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="none">Nezadáno</SelectItem>
                                                                <SelectItem value="percent">Procento</SelectItem>
                                                                <SelectItem value="fixed">Fixní částka</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="md:col-span-3">
                                                        <Label className="text-xs text-muted-foreground">Hodnota</Label>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            disabled={!entry.share_type || !canEdit}
                                                            value={entry.share_value}
                                                            onChange={(e) => {
                                                                const clone = [...teamEntries];
                                                                clone[idx].share_value = e.target.value;
                                                                setTeamEntries(clone);
                                                            }}
                                                            placeholder={entry.share_type === 'percent' ? 'např. 10 %' : 'např. 5000 Kč'}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            <div className="md:col-span-1 flex items-center justify-end">
                                                {teamEntries.length > 1 && canEdit && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setTeamEntries(teamEntries.filter((_, i) => i !== idx))}
                                                    >
                                                        <X className="w-4 h-4 text-red-500" />
                                                    </Button>
                                                )}
                                            </div>

                                            {isCompleted && (
                                                <div className="md:col-span-12 text-xs text-muted-foreground flex items-center justify-between">
                                                    <span>
                                                        Součet pro tohoto člena: {formatCurrency(entry._computedPayout || 0)}
                                                        {entry.share_type === 'percent' ? ` (${entry.share_value || 0}% z dostupného zisku)` : ''}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {isCompleted && (
                                    <p className="text-xs text-muted-foreground">
                                        Přidělujte podíly ze zisku pouze po dokončení realizace. Součet procent by neměl překročit 100 % ani dostupný zisk.
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Časové údaje</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <Label>Datum zahájení</Label>
                                <Input type="date" {...register('start_date')} />
                            </div>
                            <div className="space-y-1">
                                <Label>Plánované dokončení</Label>
                                <Input type="date" {...register('planned_end_date')} className={errors.planned_end_date ? 'border-red-500' : ''}/>
                                {errors.planned_end_date && <p className="text-red-500 text-xs">{errors.planned_end_date.message}</p>}
                            </div>
                            <div className="space-y-1">
                                <Label>Reálné dokončení</Label>
                                <Input type="date" {...register('actual_end_date')} />
                            </div>
                        </CardContent>
                    </Card>

                    <CardFooter className="mt-6 flex justify-between items-center">
                        <div>
                            {isEditing && canDelete && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button type="button" variant="destructive"><Trash2 className="w-4 h-4 mr-2" /> Smazat realizaci</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader><AlertDialogTitle>Opravdu chcete smazat tuto realizaci?</AlertDialogTitle><AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Zrušit</AlertDialogCancel><AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Smazat</AlertDialogAction></AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={() => navigate(isEditing ? `/realizace/${realizaceId}` : '/realizace')}>Zrušit</Button>
                            {canEdit && (
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? 'Ukládání...' : (isEditing ? <><Save className="w-4 h-4 mr-2" /> Uložit změny</> : <><Plus className="w-4 h-4 mr-2" /> Vytvořit realizaci</>)}
                                </Button>
                            )}
                        </div>
                    </CardFooter>
                </fieldset>
            </form>

             <SubjectDialog 
                isOpen={isSubjectDialogOpen}
                onClose={() => {
                    setIsSubjectDialogOpen(false);
                    setSubjectDialogTarget(null);
                }}
                onSave={handleSubjectSave}
            />
        </div>
    );
};

export default RealizaceForm;
