import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogHeader } from '@/components/ui/form-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, DollarSign, Calendar, FileText, User, Building, AlertCircle, Trash2, Wallet, Info, X, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { z } from 'zod';
import { PayoutSchema } from '@/lib/validationSchemas';
import { sendPayoutCreatedEmail } from '@/lib/payoutWorkflowEmailService';
import { toAmount } from '@/domain/financials';

const FormSection = ({ title, icon: Icon, children, className }) => (
  <div className={cn("space-y-4", className)}>
    <div className="flex items-center gap-2 pb-2 border-b">
      <Icon className="w-5 h-5 text-muted-foreground" />
      <h3 className="font-semibold text-lg">{title}</h3>
    </div>
    <div className="space-y-4">
      {children}
    </div>
  </div>
);

const FormField = ({ label, icon: Icon, required, children, error }) => (
  <div className="space-y-2">
    <Label className="flex items-center gap-2 text-sm font-medium">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      {label}
      {required && <span className="text-red-500">*</span>}
    </Label>
    {children}
    {error && <p className="text-xs text-red-500 flex items-center"><AlertCircle className="w-3 h-3 mr-1"/>{error}</p>}
  </div>
);

const projectStatusConfig = {
  nabidka: { label: "Nabídka", color: "text-gray-600" },
  active: { label: "Aktivní", color: "text-blue-600" },
  ready_for_delivery: { label: "K dodání", color: "text-yellow-600" },
  delivered: { label: "Dodáno", color: "text-green-600" },
  closed: { label: "Uzavřeno", color: "text-purple-600" },
};

const mapRealizationForSelection = (realization, currentAmount = 0) => ({
  realization_id: realization.id,
  realization_name: realization.name,
  realization_status: realization.status,
  available_share: (realization.available_share || 0) + toAmount(currentAmount),
  total_share: realization.total_share || 0,
  team_budget: realization.team_budget || 0,
  total_costs: realization.total_costs || 0,
  total_revenue: realization.total_revenue || 0,
  reserved_payouts: realization.reserved_payouts || 0,
  paid_payout_costs: realization.paid_payout_costs || realization.paid_amount || 0,
  reserved_or_paid_amount: realization.reserved_or_paid_amount || 0,
  availability_reason: realization.availability_reason,
});

const ProjectPayoutInput = ({ project, onAmountChange, amount, onRemove, onFillMax }) => {
  const [localAmount, setLocalAmount] = useState(amount);

  useEffect(() => { setLocalAmount(amount); }, [amount]);

  const handleAmountChange = (e) => {
    const value = e.target.value;
    setLocalAmount(value);
    onAmountChange(project.project_id, value);
  };

  const isOverBudget = parseFloat(localAmount) > project.available_balance;
  const isNotInFinalStatus = !['delivered', 'closed'].includes(project.project_status);

  return (
    <motion.div
      layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
      className={cn("p-4 border rounded-lg space-y-3 transition-colors", isOverBudget ? "bg-red-50 border-red-200" : (isNotInFinalStatus ? "bg-orange-50 border-orange-200" : "bg-gray-50"))}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="font-semibold">{project.project_name}</p>
          <p className="text-sm text-muted-foreground">{project.project_code}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemove(project.project_id)}>
          <Trash2 className="w-4 w-4 text-red-500" />
        </Button>
      </div>
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor={`amount-${project.project_id}`} className="text-xs text-muted-foreground">Částka k vyplacení</Label>
          <Input id={`amount-${project.project_id}`} type="number" value={localAmount} onChange={handleAmountChange} placeholder="0.00" min="0" max={project.available_balance} step="0.01" className={cn("text-right font-mono", isOverBudget && "border-red-500 focus-visible:ring-red-500")} />
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Dostupné</p>
          <p className="font-semibold text-green-600">{project.available_balance.toLocaleString('cs-CZ')} Kč</p>
          <Button type="button" variant="link" size="sm" className="h-6 px-0 text-xs" onClick={() => onFillMax(project.project_id, project.available_balance)}>Vyplnit max</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-white/70 p-3 text-xs">
        <div>
          <div className="text-muted-foreground">Rezervováno</div>
          <div className="font-mono font-semibold">{toAmount(project.reserved_payouts).toLocaleString('cs-CZ')} Kč</div>
        </div>
        <div>
          <div className="text-muted-foreground">Vyplaceno</div>
          <div className="font-mono font-semibold">{toAmount(project.paid_payouts).toLocaleString('cs-CZ')} Kč</div>
        </div>
      </div>
      {isOverBudget && <div className="flex items-center gap-2 text-xs text-red-600"><AlertCircle className="w-4 h-4" />Částka překračuje dostupný zůstatek.</div>}
      {isNotInFinalStatus && <div className="flex items-center gap-2 text-xs text-orange-600"><AlertCircle className="w-4 h-4" />Projekt je ve stavu: <strong className={projectStatusConfig[project.project_status]?.color || 'text-orange-700'}>{projectStatusConfig[project.project_status]?.label || project.project_status}</strong>.</div>}
    </motion.div>
  );
};

const PayoutDialog = ({ isOpen, onClose, onSave, onDelete, payout, embedded = false }) => {
  const { toast } = useToast();
  const { memberId: currentMemberId, isSuperUser, hasPermission } = useAuth();
  const isEditMode = Boolean(payout);
  const canAdmin = hasPermission('payouts', 'can_admin');
  const canDelete = Boolean(isEditMode && onDelete && (canAdmin || (payout?.status === 'pending' && payout?.member_id === currentMemberId)));
  
  const [memberId, setMemberId] = useState('');
  const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [members, setMembers] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [projectsWithBalance, setProjectsWithBalance] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [selectedRealizations, setSelectedRealizations] = useState([]);
  const [payoutAmounts, setPayoutAmounts] = useState({});
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [realizationSearch, setRealizationSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchMembers = async () => {
      let fetchedMembers = [];
      if (isSuperUser) {
        const { data } = await supabase.from('members').select('id, name').order('name');
        fetchedMembers = data || [];
      } else if (currentMemberId) {
        const { data } = await supabase.from('members').select('id, name').eq('id', currentMemberId).single();
        if (data) fetchedMembers = [data];
      }
      setMembers(fetchedMembers);
    };
    fetchMembers();
  }, [isSuperUser, currentMemberId]);

  useEffect(() => {
    if (isOpen) {
      setValidationErrors({});
      setIsSubmitting(false);
      if (payout) {
        setMemberId(payout.member_id);
        setRequestDate(payout.request_date ? new Date(payout.request_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
        setReason(payout.reason || '');
        const amounts = payout.payout_items.reduce((acc, item) => {
          if (item.project_id) acc[item.project_id] = item.amount;
          if (item.realization_id) acc[`r-${item.realization_id}`] = item.amount;
          return acc;
        }, {});
        setPayoutAmounts(amounts);
      } else {
        setRequestDate(new Date().toISOString().split('T')[0]);
        setReason(''); setProjectsWithBalance([]); setRealizations([]); setSelectedProjects([]); setSelectedRealizations([]); setPayoutAmounts({});
        if (isSuperUser) setMemberId(''); else if (currentMemberId) setMemberId(currentMemberId);
      }
    }
  }, [isOpen, payout, isSuperUser, currentMemberId]);

  useEffect(() => { if (!isOpen) return; setProjectSearch(''); setRealizationSearch(''); }, [memberId, isOpen]);

  useEffect(() => {
    const fetchProjects = async () => {
      if (!memberId) {
        setProjectsWithBalance([]); setSelectedProjects([]); setPayoutAmounts({}); setRealizations([]); return;
      }
      setIsLoadingProjects(true);
      try {
        const { data, error } = await supabase.rpc('get_payout_availability', {
          p_member_id: memberId,
          p_edit_payout_id: payout?.id || null,
        });
        if (error) throw error;

        const availableProjects = data?.projects || [];
        const visibleRealizace = data?.realizations || [];
        setProjectsWithBalance(availableProjects); setRealizations(visibleRealizace);

        if (payout && payout.payout_items) {
          const projectItems = payout.payout_items.filter(i => i.project_id);
          const realizaceItems = payout.payout_items.filter(i => i.realization_id);
          setSelectedProjects(projectItems.map(item => {
            const projectData = availableProjects.find(p => p.project_id === item.project_id);
            return {
              project_id: item.project_id, project_name: item.projects?.name || projectData?.project_name || 'N/A', project_code: item.projects?.code || projectData?.project_code || 'N/A',
              available_balance: projectData?.available_balance || 0, project_status: projectData?.project_status || 'unknown',
            };
          }));
          setSelectedRealizations(realizaceItems.map(item => {
            const found = visibleRealizace.find(r => r.id === item.realization_id);
            const currentAmount = 0;
            if (found) return mapRealizationForSelection({
              ...found,
              name: item.realizations?.name || item.realizations_legacy?.name || found.name || 'N/A',
              status: found.status || 'unknown',
            }, currentAmount);
            return {
              realization_id: item.realization_id,
              realization_name: item.realizations?.name || item.realizations_legacy?.name || 'N/A',
              realization_status: 'unknown',
              available_share: toAmount(currentAmount),
              availability_reason: 'Nelze načíst aktuální výpočet',
            };
          }));
        }
      } catch (error) {
        console.error('[PayoutDialog] Failed to load payout items:', error);
        toast({
          title: "Chyba načítání",
          description: error.message || "Nepodařilo se načíst projekty a realizace pro výplatu.",
          variant: "destructive"
        });
      } finally {
        setIsLoadingProjects(false);
      }
    };
    if (isOpen) fetchProjects();
  }, [memberId, payout, isOpen, toast, isSuperUser]);

  const handleAmountChange = (projectId, amount) => setPayoutAmounts(prev => ({ ...prev, [projectId]: amount }));
  const handleFillProjectMax = useCallback((projectId, maxAmount) => setPayoutAmounts(prev => ({ ...prev, [projectId]: String(maxAmount) })), []);
  
  const handleAddProject = (projectId) => {
    if (!projectId || selectedProjects.some(p => p.project_id === projectId)) return;
    const projectToAdd = projectsWithBalance.find(p => p.project_id === projectId);
    if (projectToAdd) { setSelectedProjects(prev => [...prev, projectToAdd]); setPayoutAmounts(prev => ({ ...prev, [projectToAdd.project_id]: '' })); }
  };
  const handleRemoveProject = (projectId) => {
    setSelectedProjects(prev => prev.filter(p => p.project_id !== projectId));
    setPayoutAmounts(prev => { const newAmounts = { ...prev }; delete newAmounts[projectId]; return newAmounts; });
  };
  const handleAddRealizace = (realizaceId) => {
    if (!realizaceId || selectedRealizations.some(r => r.realization_id === realizaceId)) return;
    const found = realizations.find(r => r.id === realizaceId);
    if (found) {
      setSelectedRealizations(prev => [...prev, mapRealizationForSelection(found)]);
      setPayoutAmounts(prev => ({ ...prev, [`r-${realizaceId}`]: '' }));
    }
  };
  const handleRemoveRealizace = (realizaceId) => {
    setSelectedRealizations(prev => prev.filter(r => r.realization_id !== realizaceId));
    setPayoutAmounts(prev => { const newAmounts = { ...prev }; delete newAmounts[`r-${realizaceId}`]; return newAmounts; });
  };

  const totalAmount = useMemo(() => Object.values(payoutAmounts).reduce((sum, amount) => sum + (parseFloat(amount) || 0), 0), [payoutAmounts]);
  const totalItems = useMemo(() => selectedProjects.length + selectedRealizations.length, [selectedProjects, selectedRealizations]);

  const resetForm = () => {
    setMemberId(isSuperUser ? '' : currentMemberId);
    setRequestDate(new Date().toISOString().split('T')[0]);
    setReason('');
    setSelectedProjects([]);
    setSelectedRealizations([]);
    setPayoutAmounts({});
    setValidationErrors({});
    setProjectSearch('');
    setRealizationSearch('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationErrors({});
    setIsSubmitting(true);

    try {
      const projectItems = selectedProjects.map(p => ({ 
        project_id: p.project_id, 
        amount: parseFloat(payoutAmounts[p.project_id]) || 0, 
        project_status: p.project_status, 
        project_name: p.project_name, 
        project_code: p.project_code, 
        type: 'project' 
      })).filter(item => item.amount > 0);

      const realizaceItems = selectedRealizations.map(r => ({ 
        realization_id: r.realization_id, 
        amount: parseFloat(payoutAmounts[`r-${r.realization_id}`]) || 0, 
        realization_status: r.realization_status, 
        realization_name: r.realization_name, 
        type: 'realization' 
      })).filter(item => item.amount > 0);

      const items = [...projectItems, ...realizaceItems];

      const dataToValidate = { 
        member_id: memberId, 
        request_date: requestDate, 
        reason: reason, 
        items: items 
      };

      // Validate with Zod schema
      PayoutSchema.parse(dataToValidate);

      // Additional validation: check project budgets
      for (const item of projectItems) {
        const project = selectedProjects.find(p => p.project_id === item.project_id);
        if (item.amount > project.available_balance) { 
          toast({ 
            title: "Chyba validace", 
            description: `Částka pro projekt "${project.project_name}" překračuje dostupný zůstatek.`, 
            variant: "destructive" 
          }); 
          setIsSubmitting(false);
          return; 
        }
      }

      for (const item of realizaceItems) {
        const realization = selectedRealizations.find(r => r.realization_id === item.realization_id);
        if (realization && item.amount > (realization.available_share || 0)) {
          toast({
            title: "Chyba validace",
            description: `Částka pro realizaci "${realization.realization_name}" překračuje dostupný zůstatek.`,
            variant: "destructive"
          });
          setIsSubmitting(false);
          return;
        }
      }

      console.log('[PayoutDialog] Submitting payout data:', dataToValidate);

      // Call the onSave callback with the validated data
      const savedPayout = await onSave(dataToValidate, isEditMode, payout?.id);

      // Success handling
      toast({ 
        title: isEditMode ? "Žádost aktualizována" : "Žádost vytvořena", 
        description: isEditMode ? "Žádost o výplatu byla úspěšně aktualizována." : "Žádost o výplatu byla úspěšně vytvořena.",
        variant: "default" 
      });

      // TASK 3: Send email only for new requests (not edits)
      if (!isEditMode) {
        try {
          console.log('[PayoutDialog] Sending creation email notification...');
          
          // FIXED: Fetch the newly created payout with explicit FK
          const { data: fetchedPayout } = savedPayout?.id ? await supabase
            .from('payouts')
            .select('*, members:members!payouts_member_id_fkey(name, email)')
            .eq('id', savedPayout.id)
            .single() : { data: null };

          const newPayout = fetchedPayout || savedPayout;

          if (newPayout) {
            const emailResult = await sendPayoutCreatedEmail(newPayout);
            
            if (emailResult.success) {
              console.log('[PayoutDialog] Email notification sent successfully');
            } else {
              console.error('[PayoutDialog] Email notification failed:', emailResult.error);
              toast({ 
                title: "Upozornění", 
                description: `Žádost byla vytvořena, ale emailové notifikace se nepodařilo odeslat: ${emailResult.error || 'neznámá chyba'}`,
                variant: "warning" 
              });
            }
          }
        } catch (emailError) {
          console.error('[PayoutDialog] Failed to send email notification:', emailError);
          // Don't fail the whole operation if email fails
          toast({ 
            title: "Upozornění", 
            description: `Žádost byla vytvořena, ale emailové notifikace se nepodařilo odeslat: ${emailError.message || 'neznámá chyba'}`,
            variant: "warning" 
          });
        }
      }

      // Reset form and close dialog
      resetForm();
      onClose();

    } catch (error) {
      console.error('[PayoutDialog] Form submission error:', error);
      
      if (error instanceof z.ZodError) {
        const errors = {};
        error.errors.forEach(err => { 
          errors[err.path[0]] = err.message; 
        });
        setValidationErrors(errors);
        toast({ 
          title: "Chyba validace formuláře", 
          description: "Zkontrolujte prosím všechna povinná pole.", 
          variant: "destructive" 
        });
      } else {
        toast({ 
          title: "Chyba při ukládání", 
          description: error.message || "Došlo k neočekávané chybě při ukládání žádosti.", 
          variant: "destructive" 
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableProjectsToAdd = projectsWithBalance.filter(p => !selectedProjects.some(sp => sp.project_id === p.project_id));
  const availableRealizaceToAdd = realizations.filter(r => !selectedRealizations.some(sr => sr.realization_id === r.id));
  const filteredProjectsToAdd = useMemo(() => {
    const q = projectSearch.trim().toLowerCase(); if (!q) return availableProjectsToAdd;
    return availableProjectsToAdd.filter((p) => `${p.project_code || ''} ${p.project_name || ''}`.toLowerCase().includes(q));
  }, [projectSearch, availableProjectsToAdd]);
  const filteredRealizaceToAdd = useMemo(() => {
    const q = realizationSearch.trim().toLowerCase(); if (!q) return availableRealizaceToAdd;
    return availableRealizaceToAdd.filter((r) => `${r.name || ''} ${r.status || ''}`.toLowerCase().includes(q));
  }, [realizationSearch, availableRealizaceToAdd]);

  const content = (
    <>
      {embedded ? (
        <div className="border-b bg-slate-50/60 px-5 py-4 text-left sm:px-6">
          <div className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="h-5 w-5" />
            </span>
            <span className="min-w-0 truncate">Nová žádost o výplatu</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Nová žádost</span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{totalItems} položek</span>
          </div>
        </div>
      ) : (
        <FormDialogHeader
          icon={isEditMode ? Edit2 : Plus}
          title={isEditMode ? 'Upravit žádost o výplatu' : 'Nová žádost o výplatu'}
          description={
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", isEditMode ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700")}>{isEditMode ? 'Editace' : 'Nová žádost'}</span>
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-700">{totalItems} položek</span>
            </div>
          }
        />
      )}

      <FormDialogBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form id="payout-form" onSubmit={handleSubmit} className="min-w-0 space-y-6">
            <div className="rounded-xl border bg-slate-50/60 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField label="Zaměstnanec" icon={User} required error={validationErrors.member_id}>
                  <Select value={memberId} onValueChange={setMemberId} disabled={!isSuperUser || isSubmitting}>
                    <SelectTrigger className={validationErrors.member_id ? "border-red-500" : ""}><SelectValue placeholder="-- Vyberte zaměstnance --" /></SelectTrigger>
                    <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                <FormField label="Datum žádosti" icon={Calendar} required error={validationErrors.request_date}>
                  <Input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={validationErrors.request_date ? "border-red-500" : ""} disabled={isSubmitting} />
                </FormField>
              </div>
            </div>

            <FormSection title="Položky k vyplacení" icon={Building}>
              {validationErrors.items && <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mb-2 flex items-center"><AlertCircle className="w-4 h-4 mr-2"/> {validationErrors.items}</div>}
              {isLoadingProjects ? <div className="text-center p-4 text-muted-foreground">Načítám projekty...</div> : (
                <div className="space-y-5">
                  <div className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800">Vybrané položky</div>
                        <div className="text-xs text-slate-500">Kliknutím na štítek položku odeberete.</div>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{totalItems} položek</div>
                    </div>
                    {selectedProjects.length === 0 && selectedRealizations.length === 0 ? <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">Zatím žádné vybrané položky. Vyberte projekt nebo realizaci níže.</div> : (
                      <div className="flex flex-wrap gap-2">
                        {selectedProjects.map((project) => (
                          <button type="button" key={project.project_id} onClick={() => !isSubmitting && handleRemoveProject(project.project_id)} disabled={isSubmitting} className="inline-flex items-center gap-2 rounded-full border bg-slate-50 px-3 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span className="max-w-[220px] truncate">{project.project_code} · {project.project_name}</span><X className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))}
                        {selectedRealizations.map((realizace) => (
                          <button type="button" key={realizace.realization_id} onClick={() => !isSubmitting && handleRemoveRealizace(realizace.realization_id)} disabled={isSubmitting} className="inline-flex items-center gap-2 rounded-full border bg-slate-50 px-3 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
                            <span className="max-w-[220px] truncate">Realizace: {realizace.realization_name}</span><X className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {memberId && (
                      <div className="space-y-2 rounded-xl border bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-800">Projekty</div>
                            <div className="text-xs text-slate-500">Dostupné částky už odečítají přímé náklady, alokované režie a rezervované výplaty.</div>
                          </div>
                        </div>
                        <Input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="Hledat projekt..." disabled={isSubmitting} />
                        <div className="max-h-56 overflow-y-auto rounded-lg border bg-white">
                          {filteredProjectsToAdd.length > 0 ? filteredProjectsToAdd.map(p => (
                              <button type="button" key={p.project_id} onClick={() => !isSubmitting && handleAddProject(p.project_id)} disabled={isSubmitting} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                                <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{p.project_name}</span><span className="block truncate text-xs text-slate-500">{p.project_code}</span></span><span className="ml-3 shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-700">{p.available_balance.toLocaleString('cs-CZ')} Kč</span>
                              </button>
                            )) : <div className="px-3 py-2 text-sm text-muted-foreground">Nenalezeny žádné projekty</div>}
                        </div>
                      </div>
                    )}
                    {memberId && (
                      <div className="space-y-2 rounded-xl border bg-white p-4">
                        <div>
                          <div className="font-medium text-slate-800">Realizace</div>
                          <div className="text-xs text-slate-500">Vyberte realizaci podle dostupného podílu.</div>
                        </div>
                        <Input value={realizationSearch} onChange={(e) => setRealizationSearch(e.target.value)} placeholder="Hledat realizaci..." disabled={isSubmitting} />
                        <div className="max-h-56 overflow-y-auto rounded-lg border bg-white">
                          {filteredRealizaceToAdd.length > 0 ? filteredRealizaceToAdd.map(r => (
                              <button type="button" key={r.id} onClick={() => !isSubmitting && handleAddRealizace(r.id)} disabled={isSubmitting} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                                <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{r.name}</span><span className="block truncate text-xs text-slate-500">{r.availability_reason || 'Realizace'}</span></span><span className={cn("ml-3 shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-semibold", (r.available_share || 0) > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{(r.available_share || 0).toLocaleString('cs-CZ')} Kč</span>
                              </button>
                            )) : <div className="px-3 py-2 text-sm text-muted-foreground">Nenalezeny žádné realizace</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  {(selectedProjects.length > 0 || selectedRealizations.length > 0) && (
                    <div className="space-y-4">
                      <AnimatePresence>
                        {selectedProjects.map(project => <ProjectPayoutInput key={project.project_id} project={project} amount={payoutAmounts[project.project_id] || ''} onAmountChange={handleAmountChange} onFillMax={handleFillProjectMax} onRemove={handleRemoveProject} />)}
                        {selectedRealizations.map(realizace => (
                          <motion.div key={realizace.realization_id} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className={cn("p-4 border rounded-lg space-y-3", (parseFloat(payoutAmounts[`r-${realizace.realization_id}`]) || 0) > (realizace.available_share || 0) ? "bg-red-50 border-red-200" : "bg-slate-50")}>
                            <div className="flex justify-between items-start">
                              <div><p className="font-semibold">{realizace.realization_name}</p><p className="text-xs text-muted-foreground uppercase">Realizace</p></div>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveRealizace(realizace.realization_id)} disabled={isSubmitting}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 rounded-md bg-white/70 p-3 text-xs md:grid-cols-5">
                              <div><div className="text-muted-foreground">Výnos</div><div className="font-mono font-semibold">{(realizace.total_revenue || 0).toLocaleString('cs-CZ')} Kč</div></div>
                              <div><div className="text-muted-foreground">Náklady</div><div className="font-mono font-semibold">{(realizace.total_costs || 0).toLocaleString('cs-CZ')} Kč</div></div>
                              <div><div className="text-muted-foreground">Týmový rozpočet</div><div className="font-mono font-semibold">{(realizace.team_budget || 0).toLocaleString('cs-CZ')} Kč</div></div>
                              <div><div className="text-muted-foreground">Rezervováno</div><div className="font-mono font-semibold">{(realizace.reserved_payouts || 0).toLocaleString('cs-CZ')} Kč</div></div>
                              <div><div className="text-muted-foreground">Vyplaceno</div><div className="font-mono font-semibold">{(realizace.paid_payout_costs || 0).toLocaleString('cs-CZ')} Kč</div></div>
                            </div>
                            <div className="flex items-end gap-4">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground">Částka k vyplacení</Label>
                                <Input type="number" value={payoutAmounts[`r-${realizace.realization_id}`] || ''} onChange={(e) => setPayoutAmounts(prev => ({ ...prev, [`r-${realizace.realization_id}`]: e.target.value }))} placeholder="0.00" min="0" max={realizace.available_share || 0} step="0.01" className={cn("text-right font-mono", (parseFloat(payoutAmounts[`r-${realizace.realization_id}`]) || 0) > (realizace.available_share || 0) && "border-red-500 focus-visible:ring-red-500")} disabled={isSubmitting} />
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground">Dostupné</p>
                                <p className="font-semibold text-green-600">{(realizace.available_share || 0).toLocaleString('cs-CZ')} Kč</p>
                                <Button type="button" variant="link" size="sm" className="h-6 px-0 text-xs" onClick={() => setPayoutAmounts(prev => ({ ...prev, [`r-${realizace.realization_id}`]: String(realizace.available_share || 0) }))} disabled={isSubmitting}>Vyplnit max</Button>
                              </div>
                            </div>
                            {realizace.availability_reason && <div className={cn("flex items-center gap-2 text-xs", (realizace.available_share || 0) > 0 ? "text-emerald-700" : "text-slate-600")}><Info className="w-4 h-4" />{realizace.availability_reason}</div>}
                            {(parseFloat(payoutAmounts[`r-${realizace.realization_id}`]) || 0) > (realizace.available_share || 0) && <div className="flex items-center gap-2 text-xs text-red-600"><AlertCircle className="w-4 h-4" />Částka překračuje dostupný zůstatek.</div>}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}

                  {!memberId && <div className="text-center p-4 border-2 border-dashed rounded-lg text-muted-foreground"><Info className="mx-auto w-8 h-8 mb-2" />Nejprve vyberte zaměstnance.</div>}
                </div>
              )}
            </FormSection>

            <FormSection title="Dodatečné informace" icon={FileText}>
              <FormField label="Důvod / Poznámka" icon={FileText}>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Zadejte důvod žádosti nebo další poznámky..." rows={3} disabled={isSubmitting} />
              </FormField>
            </FormSection>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-xl border bg-slate-50/60 p-4">
              <div className="text-sm text-muted-foreground">Souhrn</div>
              <div className="mt-2 text-2xl font-bold">{totalAmount.toLocaleString('cs-CZ')} Kč</div>
              <div className="mt-1 text-xs text-muted-foreground">{totalItems} položek</div>
            </div>

            <div className="flex flex-col gap-3">
              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button type="button" variant="destructive" disabled={isSubmitting}>Smazat</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Smazat žádost?</AlertDialogTitle><AlertDialogDescription>Tato akce je nevratná. Žádost o výplatu bude trvale smazána.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Zrušit</AlertDialogCancel><AlertDialogAction onClick={() => { onDelete(payout.id); onClose(); }}>Smazat</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }} disabled={isSubmitting}>Zrušit</Button>
              <Button type="submit" form="payout-form" disabled={isSubmitting || totalItems === 0 || totalAmount === 0}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isEditMode ? 'Ukládám...' : 'Vytvářím...'}
                  </>
                ) : (
                  isEditMode ? 'Uložit změny' : 'Vytvořit žádost'
                )}
              </Button>
            </div>
          </aside>
        </FormDialogBody>
      </>
  );

  if (embedded) {
    return <div className="rounded-xl border border-slate-200 bg-white shadow-sm">{content}</div>;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isSubmitting) { resetForm(); onClose(); } }} modal={false}>
    <FormDialogContent size="xl" onInteractOutside={(e) => { if (isSubmitting) e.preventDefault(); }} onPointerDownOutside={(e) => { if (isSubmitting) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (isSubmitting) e.preventDefault(); }}>
      {content}
    </FormDialogContent>
    </Dialog>
  );
};

export default PayoutDialog;
