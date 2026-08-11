import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Users, DollarSign, Percent, Calendar, Plus, Edit2, AlertCircle, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { sendEmail } from '@/lib/email';
import { calculateProjectBudget, calculateProjectMemberReward, calculateProjectRewardPool, calculateProjectRewardRebalance, toAmount } from '@/domain/financials';

const AssignMemberDialog = ({ isOpen, onClose, onSave, member, team = [], project, projectSubcontractors = [], teamBudgetOverride = null }) => {
  const [formData, setFormData] = useState({
    member_id: '',
    is_hourly: false,
    reward_type: null,
    reward_percentage: '',
    reward_amount: '',
    valid_from: '',
    valid_to: '',
    hourly_funding_mode: 'direct_project',
    hourly_sponsor_member_id: '',
    hourly_sponsor_percent: '100',
    createOrder: false,
    orderValidity: 7,
    completion_date: '',
  });
  const [availableMembers, setAvailableMembers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchMembers = async () => {
      const { data } = await supabase.from('members').select('id, name, email');
      if (data) {
        const assignedMemberIds = team.map(m => m.member_id);
        const unassigned = data.filter(m => !assignedMemberIds.includes(m.id));
        setAvailableMembers(unassigned);
      }
    };

    if (isOpen && !member) {
      fetchMembers();
    }
  }, [isOpen, team, member]);

  const { teamBudget: fallbackTeamBudget } = calculateProjectBudget(project, projectSubcontractors);
  const teamBudget = teamBudgetOverride === null || teamBudgetOverride === undefined
    ? fallbackTeamBudget
    : toAmount(teamBudgetOverride);

  useEffect(() => {
    if (isOpen) {
      if (member) {
        setFormData({
          member_id: member.member_id || '',
          is_hourly: member.is_hourly ?? false,
          reward_type: member.reward_type || null,
          reward_percentage: member.reward_percentage || '',
          reward_amount: member.reward_amount || '',
          valid_from: member.member?.valid_from || '',
          valid_to: member.member?.valid_to || '',
          hourly_funding_mode: member.member?.hourly_funding_mode || 'direct_project',
          hourly_sponsor_member_id: member.member?.hourly_sponsor_member_id || '',
          hourly_sponsor_percent: member.member?.hourly_sponsor_percent ?? '100',
          createOrder: false,
          orderValidity: 7,
          completion_date: '',
        });
      } else {
        setFormData({
          member_id: '',
          is_hourly: false,
          reward_type: null,
          reward_percentage: '',
          reward_amount: '',
          valid_from: new Date().toISOString().slice(0, 10),
          valid_to: '',
          hourly_funding_mode: 'direct_project',
          hourly_sponsor_member_id: '',
          hourly_sponsor_percent: '100',
          createOrder: false,
          orderValidity: 7,
          completion_date: '',
        });
      }
    }
  }, [member, isOpen]);

  const getMemberRewardAmount = (rewardType, rewardValue) => {
    const rewardPool = calculateProjectRewardPool(team, teamBudget);
    return calculateProjectMemberReward({
      reward_type: rewardType,
      reward_amount: rewardType === 'fixed' ? rewardValue : null,
      reward_percentage: rewardType === 'percentage' ? rewardValue : null,
    }, teamBudget, { percentageRewardPool: rewardPool.percentageRewardPool });
  };
  
  const sendAssignmentEmail = async (memberData, rewardData) => {
    const memberInfo = member ? { name: member.member.name, email: member.member.email } : availableMembers.find(m => m.id === memberData.member_id);
    if (!memberInfo || !memberInfo.email) {
      console.error("Cannot send email: member email not found.");
      return;
    }

    let rewardAmount = 0;
    if (rewardData.reward_type) {
        rewardAmount = getMemberRewardAmount(rewardData.reward_type, rewardData.reward_type === 'percentage' ? rewardData.reward_percentage : rewardData.reward_amount);
    }
    
    let rewardText = '';
    if (rewardAmount > 0) {
      rewardText = `Vaše paušální odměna za tento projekt je stanovena na <strong>${rewardAmount.toLocaleString('cs-CZ')} Kč</strong>.`;
    } else if (memberData.is_hourly) {
      rewardText = 'Vaše práce na projektu bude odměňována na základě hodinové sazby.';
    } else {
        // No reward specified, don't send email.
        return;
    }

    const projectUrl = `${window.location.origin}/projects/${project.id}`;
    const subject = `Byli jste přiřazeni k projektu: ${project.name}`;
    const htmlContent = `
        <p>byli jste přiřazeni k novému projektu v našem portálu.</p>
        <p style="margin: 20px 0; padding: 15px; background-color: #f2f5f7; border-left: 4px solid #3b82f6; color: #333;">
            <strong>Projekt:</strong> ${project.name} (${project.code})<br>
            <strong>Odměna:</strong> ${rewardText}
        </p>
        <p>Pro více detailů se prosím přihlaste do portálu a zobrazte si projekt:</p>
    `;

    try {
      await sendEmail({
          to: memberInfo.email,
          subject,
          greeting: `Dobrý den, ${memberInfo.name},`,
          content: htmlContent,
          cta: {
            url: projectUrl,
            text: 'Zobrazit projekt'
          },
          salutation: `S pozdravem,<br>Tým EKV`
      });
      toast({ title: 'Oznámení odesláno', description: `Email byl odeslán členovi ${memberInfo.name}.` });
    } catch(e) {
      toast({ title: 'Chyba při odesílání emailu', variant: 'destructive' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.member_id) {
      toast({ title: "Chyba", description: "Prosím, vyberte projektanta.", variant: "destructive" });
      return;
    }
    
    if (!formData.is_hourly && !formData.reward_type) {
      toast({ title: "Chyba", description: "Musíte zvolit alespoň jeden typ odměny (hodinová sazba nebo paušál).", variant: "destructive" });
      return;
    }

    if (formData.reward_type) {
        if (formData.reward_type === 'percentage' && (!formData.reward_percentage || parseFloat(formData.reward_percentage) <= 0)) {
          toast({ title: "Chyba", description: "Prosím, zadejte platné procento paušální odměny.", variant: "destructive" });
          return;
        }

        if (formData.reward_type === 'fixed' && (!formData.reward_amount || parseFloat(formData.reward_amount) <= 0)) {
          toast({ title: "Chyba", description: "Prosím, zadejte platnou částku paušální odměny.", variant: "destructive" });
          return;
        }
    }

    if (formData.is_hourly && formData.hourly_funding_mode === 'member_reward' && !formData.hourly_sponsor_member_id) {
      toast({ title: 'Chybí financující člen', description: 'Vyberte člena týmu, z jehož odměny se bude hodinová práce odečítat.', variant: 'destructive' });
      return;
    }

    if (isRewardOverBudget) {
      toast({
        title: 'Odměnu nelze přidělit',
        description: `Fond odměn je již vyčerpán. Nová odměna překračuje dostupný zůstatek o ${budgetExceededBy.toLocaleString('cs-CZ')} Kč.`,
        variant: 'destructive',
      });
      return;
    }
    
    const { createOrder, orderValidity, completion_date, ...dataToSave } = formData;

    if (!dataToSave.is_hourly || dataToSave.hourly_funding_mode === 'direct_project') {
      dataToSave.hourly_funding_mode = 'direct_project';
      dataToSave.hourly_sponsor_member_id = null;
      dataToSave.hourly_sponsor_percent = 0;
    }
    
    if (!dataToSave.reward_type) {
        dataToSave.reward_amount = null;
        dataToSave.reward_percentage = null;
    } else {
        if (dataToSave.reward_type === 'percentage') {
            dataToSave.reward_amount = null;
        } else {
            dataToSave.reward_percentage = null;
        }
    }

    setIsSaving(true);
    try {
      const saved = await onSave(dataToSave);
      if (saved === false) return;

      // Notify only after the assignment has been accepted by the database.
      if (!member) {
        await sendAssignmentEmail(dataToSave, {
          reward_type: dataToSave.reward_type,
          reward_amount: dataToSave.reward_amount,
          reward_percentage: dataToSave.reward_percentage,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };
  
  const rewardPreview = calculateProjectRewardRebalance({
    teamBudget,
    assignments: team,
    editedMemberId: member?.member_id || null,
    rewardType: formData.reward_type,
    rewardAmount: formData.reward_amount,
    rewardPercentage: formData.reward_percentage,
  });
  const {
    currentTeamRewards,
    availableRewardAmount,
    newRewardAmount,
    budgetAfter: budgetAfterAllRewards,
    budgetExceededBy,
    fixedRewardsTotal,
    percentageRewardPool,
    percentageOverrun,
    percentageTotalBefore: currentTotalPercentage,
    percentageTotalAfter,
  } = rewardPreview;
  const newRewardPercentage = formData.reward_type === 'percentage' ? toAmount(formData.reward_percentage) : 0;
  const isRewardOverBudget = Boolean(formData.reward_type)
    && (budgetExceededBy > 0.01 || percentageOverrun > 0.0001);
  
  const availableRewardPercentage = 100 - currentTotalPercentage;
  const sponsorOptions = team.filter((teamMember) => {
      if (teamMember.member_id === formData.member_id) return false;
      return teamMember.reward_type === 'fixed' || teamMember.reward_type === 'percentage';
  });

  const handleRewardTypeChange = (value) => {
      if (formData.reward_type === value) {
          setFormData({ ...formData, reward_type: null }); // Uncheck
      } else {
          setFormData({ ...formData, reward_type: value }); // Check
      }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <FormDialogContent size="md">
        <div className="hidden">
          <div className="text-xl font-bold flex items-center gap-2">
            {member ? <Edit2 className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
            {member ? 'Upravit člena týmu' : 'Přiřadit člena týmu'}
          </div>
        </div>
        <FormDialogHeader
          icon={member ? Edit2 : Plus}
          title={member ? 'Upravit člena týmu' : 'Přiřadit člena týmu'}
          description="Nastavte projektanta, typ odměny a návazné finanční parametry."
        />
        
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FormDialogBody className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member" className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" /> Projektant <span className="text-red-500">*</span>
              </Label>
              <Select value={formData.member_id} onValueChange={(value) => setFormData({ ...formData, member_id: value })} required disabled={!!member}>
                <SelectTrigger>
                  <SelectValue placeholder="-- Vyberte projektanta --" />
                </SelectTrigger>
                <SelectContent>
                  {member && <SelectItem value={member.member_id}>{member.member.name}</SelectItem>}
                  {availableMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!!member && <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3 w-3" />Projektanta nelze změnit. Pro změnu ho odeberte a přidejte znovu.</p>}
            </div>

            <div className="space-y-4">
              <Label className="text-sm font-medium">Typ odměny</Label>
              <div className="flex items-center space-x-2 p-3 border rounded-lg">
                <Checkbox id="is_hourly" checked={formData.is_hourly} onCheckedChange={(checked) => setFormData({...formData, is_hourly: checked})} />
                <Label htmlFor="is_hourly" className="flex items-center gap-2 cursor-pointer text-sm">
                  <Clock className="h-4 w-4" /> Hodinová sazba (pro vykazování docházky)
                </Label>
              </div>
              {formData.is_hourly && (
                <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                  <div className="space-y-2">
                    <Label>Zdroj hodinového nákladu</Label>
                    <Select
                      value={formData.hourly_funding_mode}
                      onValueChange={(value) => setFormData((current) => ({
                        ...current,
                        hourly_funding_mode: value,
                        hourly_sponsor_member_id: value === 'direct_project' ? '' : current.hourly_sponsor_member_id,
                        hourly_sponsor_percent: value === 'direct_project' ? '0' : (current.hourly_sponsor_percent || '100'),
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct_project">Přímo z rozpočtu projektu</SelectItem>
                        <SelectItem value="member_reward">Z odměny konkrétního člena týmu</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.hourly_funding_mode === 'member_reward' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                      <div className="space-y-2">
                        <Label>Financující člen týmu</Label>
                        <Select value={formData.hourly_sponsor_member_id} onValueChange={(value) => setFormData({ ...formData, hourly_sponsor_member_id: value })}>
                          <SelectTrigger><SelectValue placeholder="Vyberte člena s odměnou" /></SelectTrigger>
                          <SelectContent>
                            {sponsorOptions.map((assignment) => (
                              <SelectItem key={assignment.member_id} value={assignment.member_id}>
                                {assignment.member?.name || assignment.member?.email || 'Člen týmu'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Podíl nákladu (%)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={formData.hourly_sponsor_percent}
                          onChange={(event) => setFormData({ ...formData, hourly_sponsor_percent: event.target.value })}
                          className="text-right font-mono"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-xs leading-5 text-muted-foreground">
                    Přímý náklad sníží společný rozpočet. Náklad financovaný členem sníží jeho hrubou odměnu a do společného rozpočtu vstoupí jen případný nepokrytý zbytek.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assignment-valid-from">Platnost od</Label>
                  <Input id="assignment-valid-from" type="date" value={formData.valid_from} onChange={(event) => setFormData({ ...formData, valid_from: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assignment-valid-to">Platnost do</Label>
                  <Input id="assignment-valid-to" type="date" value={formData.valid_to} onChange={(event) => setFormData({ ...formData, valid_to: event.target.value })} />
                </div>
              </div>
              <div className="p-3 border rounded-lg space-y-4">
                 <Label className="flex items-center gap-2 text-sm font-medium">
                    <DollarSign className="h-4 w-4" /> Paušální odměna (procentem nebo částkou)
                  </Label>
                   <RadioGroup value={formData.reward_type || ""} onValueChange={(value) => handleRewardTypeChange(value)} className="grid grid-cols-2 gap-2">
                    <Label htmlFor="reward-percentage" className="flex items-center gap-2 p-3 border rounded-md cursor-pointer hover:bg-muted/50 has-[:checked]:bg-primary/10 has-[:checked]:border-primary">
                      <RadioGroupItem value="percentage" id="reward-percentage" /> <Percent className="h-4 w-4" /> Procentuálně
                    </Label>
                    <Label htmlFor="reward-amount" className="flex items-center gap-2 p-3 border rounded-md cursor-pointer hover:bg-muted/50 has-[:checked]:bg-primary/10 has-[:checked]:border-primary">
                      <RadioGroupItem value="fixed" id="reward-amount" /> <DollarSign className="h-4 w-4" /> Částkou
                    </Label>
                  </RadioGroup>
              
                  <AnimatePresence>
                    {formData.reward_type && (
                      <motion.div
                        key="flat_fee_options"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-4 pt-4"
                      >
                        {formData.reward_type === 'percentage' && (
                          <div className="space-y-2">
                            <div className="flex justify-between items-baseline">
                              <Label htmlFor="reward_percentage" className="flex items-center gap-2">
                                <Percent className="h-4 w-4 text-muted-foreground" /> Odměna z budgetu týmu (%) <span className="text-red-500">*</span>
                              </Label>
                              <span className="text-xs text-muted-foreground">K dispozici ze zbytku: {Math.max(0, availableRewardPercentage).toFixed(2)} %</span>
                            </div>
                            <Input id="reward_percentage" type="number" step="0.01" value={formData.reward_percentage} onChange={(e) => setFormData({ ...formData, reward_percentage: e.target.value })} required placeholder="např. 50" className="text-right font-mono" />
                          </div>
                        )}
                        {formData.reward_type === 'fixed' && (
                          <div className="space-y-2">
                            <Label htmlFor="reward_amount" className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-muted-foreground" /> Odměna (Kč) <span className="text-red-500">*</span>
                            </Label>
                            <Input id="reward_amount" type="number" step="0.01" value={formData.reward_amount} onChange={(e) => setFormData({ ...formData, reward_amount: e.target.value })} required placeholder="např. 50000" className="text-right font-mono" />
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
            </div>
          </motion.div>
          
          {formData.reward_type && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg space-y-3">
              <div className="text-center">
                <p className="text-sm text-blue-800 font-medium">Paušální odměna projektanta</p>
                <p className="text-xl font-bold text-blue-900">
                  {newRewardAmount.toLocaleString('cs-CZ')} Kč
                  {formData.reward_type === 'percentage' && <span className="text-sm font-normal ml-2">({newRewardPercentage.toFixed(2)} %)</span>}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-blue-200 pt-3 text-sm sm:grid-cols-5">
                <div>
                  <p className="text-muted-foreground">Fond odměn</p>
                  <p className="font-semibold text-slate-900">{teamBudget.toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fixně rezervováno</p>
                  <p className="font-semibold text-slate-900">{fixedRewardsTotal.toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fond pro procenta</p>
                  <p className="font-semibold text-slate-900">{percentageRewardPool.toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Již přiděleno</p>
                  <p className="font-semibold text-slate-900">{currentTeamRewards.toLocaleString('cs-CZ')} Kč</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Volné před změnou</p>
                  <p className="font-semibold text-slate-900">{availableRewardAmount.toLocaleString('cs-CZ')} Kč</p>
                </div>
              </div>
              <div className={`rounded-md border p-3 text-center ${isRewardOverBudget ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <p className={`text-sm font-medium ${isRewardOverBudget ? 'text-red-800' : 'text-emerald-800'}`}>
                  Zůstatek fondu po této změně
                </p>
                <p className={`text-lg font-bold ${isRewardOverBudget ? 'text-red-900' : 'text-emerald-900'}`}>
                  {budgetAfterAllRewards.toLocaleString('cs-CZ')} Kč
                </p>
                {isRewardOverBudget && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-xs text-red-700">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {percentageOverrun > 0.0001
                      ? `Součet procentních podílů překračuje 100 % o ${percentageOverrun.toLocaleString('cs-CZ')} %.`
                      : `Fixní odměny překračují fond o ${budgetExceededBy.toLocaleString('cs-CZ')} Kč.`}
                  </p>
                )}
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">Fixní odměny se odečítají jako první</p>
                <p className="mt-1 text-xs leading-5 text-blue-800">
                  Procentní podíly zůstávají beze změny ({percentageTotalAfter.toFixed(2)} %) a počítají se až ze zbytku{' '}
                  {percentageRewardPool.toLocaleString('cs-CZ')} Kč po odečtení fixních odměn. Změna bude dohledatelná v historii projektu.
                </p>
              </div>
            </motion.div>
          )}

          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
            <Button type="submit" className="min-w-[120px]" disabled={isSaving || isRewardOverBudget}>
              {isSaving ? 'Ukládám…' : member ? 'Uložit změny' : 'Přiřadit'}
            </Button>
          </FormDialogFooter>
        </form>
      </FormDialogContent>
    </Dialog>
  );
};

export default AssignMemberDialog;
