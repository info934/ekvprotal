import React, { useCallback, useEffect, useState } from 'react';
import { Save, SlidersHorizontal, Target } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_CRM_NUMBERING, normalizeCrmNumbering } from '@/lib/crmNumbering';

const DEFAULT_STAGE_CONFIG = [
  { value: 'lead', label: 'Lead', color: 'bg-slate-100 text-slate-700 border-slate-200', probability: 10, sort_order: 10, is_active: true, is_closed: false },
  { value: 'qualified', label: 'Kvalifikovano', color: 'bg-blue-100 text-blue-700 border-blue-200', probability: 25, sort_order: 20, is_active: true, is_closed: false },
  { value: 'proposal', label: 'Nabidka', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', probability: 45, sort_order: 30, is_active: true, is_closed: false },
  { value: 'negotiation', label: 'Jednani', color: 'bg-amber-100 text-amber-800 border-amber-200', probability: 70, sort_order: 40, is_active: true, is_closed: false },
  { value: 'won', label: 'Vyhrano', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', probability: 100, sort_order: 50, is_active: true, is_closed: true },
  { value: 'lost', label: 'Ztraceno', color: 'bg-rose-100 text-rose-700 border-rose-200', probability: 0, sort_order: 60, is_active: true, is_closed: true },
];

const DEFAULT_PRIORITY_CONFIG = [
  { value: 'low', label: 'Nizka', tone: 'secondary', sort_order: 10, is_active: true },
  { value: 'medium', label: 'Stredni', tone: 'outline', sort_order: 20, is_active: true },
  { value: 'high', label: 'Vysoka', tone: 'destructive', sort_order: 30, is_active: true },
];

const normalizeStages = (stages) => (
  (stages?.length ? stages : DEFAULT_STAGE_CONFIG).map((stage, index) => ({
    ...stage,
    probability: Number(stage.probability || 0),
    sort_order: Number(stage.sort_order ?? ((index + 1) * 10)),
    is_active: stage.is_active ?? true,
    is_closed: Boolean(stage.is_closed),
  }))
);

const normalizePriorities = (priorities) => (
  (priorities?.length ? priorities : DEFAULT_PRIORITY_CONFIG).map((priority, index) => ({
    ...priority,
    sort_order: Number(priority.sort_order ?? ((index + 1) * 10)),
    is_active: priority.is_active ?? true,
  }))
);

const SettingsCRM = () => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [crmStages, setCrmStages] = useState(() => normalizeStages(DEFAULT_STAGE_CONFIG));
  const [crmPriorities, setCrmPriorities] = useState(() => normalizePriorities(DEFAULT_PRIORITY_CONFIG));
  const [crmNumbering, setCrmNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canAdmin = hasPermission('settings', 'can_admin');

  const fetchCrmConfig = useCallback(async () => {
    if (!canAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [stagesRes, prioritiesRes, numberingRes] = await Promise.all([
      supabase
        .from('crm_stage_definitions')
        .select('value, label, color, probability, sort_order, is_active, is_closed')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_priority_definitions')
        .select('value, label, tone, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_numbering_settings')
        .select('document_type, prefix, next_number, padding')
        .in('document_type', ['opportunity', 'offer', 'order']),
    ]);

    const error = stagesRes.error || prioritiesRes.error;
    if (error) {
      toast({
        title: 'CRM nastaveni se nepodarilo nacist',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setCrmStages(normalizeStages(stagesRes.data));
      setCrmPriorities(normalizePriorities(prioritiesRes.data));
      setCrmNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));
    }
    setLoading(false);
  }, [canAdmin, toast]);

  useEffect(() => {
    fetchCrmConfig();
  }, [fetchCrmConfig]);

  const updateStageConfig = (index, field, value) => {
    setCrmStages((current) => current.map((stage, stageIndex) => (
      stageIndex === index ? { ...stage, [field]: field === 'probability' ? Number(value || 0) : value } : stage
    )));
  };

  const updatePriorityConfig = (index, field, value) => {
    setCrmPriorities((current) => current.map((priority, priorityIndex) => (
      priorityIndex === index ? { ...priority, [field]: value } : priority
    )));
  };

  const addStageConfig = () => {
    setCrmStages((current) => ([
      ...current,
      {
        value: `stage_${Date.now()}`,
        label: 'Novy stav',
        color: 'bg-slate-100 text-slate-700 border-slate-200',
        probability: 50,
        sort_order: (current.length + 1) * 10,
        is_active: true,
        is_closed: false,
      },
    ]));
  };

  const addPriorityConfig = () => {
    setCrmPriorities((current) => ([
      ...current,
      { value: `priority_${Date.now()}`, label: 'Nova priorita', tone: 'secondary', sort_order: (current.length + 1) * 10, is_active: true },
    ]));
  };

  const updateNumberingConfig = (type, field, value) => {
    setCrmNumbering((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [field]: field === 'prefix' ? value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') : Number(value || 1),
      },
    }));
  };

  const resetCrmConfig = () => {
    setCrmStages(normalizeStages(DEFAULT_STAGE_CONFIG));
    setCrmPriorities(normalizePriorities(DEFAULT_PRIORITY_CONFIG));
  };

  const handleSaveCrmConfig = async () => {
    if (!canAdmin) return;

    setSaving(true);

    const stageRows = crmStages.map((stage, index) => ({
      value: stage.value,
      label: stage.label.trim() || stage.value,
      color: stage.color || 'bg-slate-100 text-slate-700 border-slate-200',
      probability: Math.min(100, Math.max(0, Number(stage.probability || 0))),
      sort_order: (index + 1) * 10,
      is_active: true,
      is_closed: Boolean(stage.is_closed),
    }));

    const priorityRows = crmPriorities.map((priority, index) => ({
      value: priority.value,
      label: priority.label.trim() || priority.value,
      tone: priority.tone || 'secondary',
      sort_order: (index + 1) * 10,
      is_active: true,
    }));

    const numberingRows = Object.values(crmNumbering).map((config) => ({
      document_type: config.document_type,
      prefix: String(config.prefix || '').trim().toUpperCase() || DEFAULT_CRM_NUMBERING[config.document_type]?.prefix || 'DOC',
      next_number: Math.max(1, Number(config.next_number || 1)),
      padding: Math.max(2, Number(config.padding || 3)),
    }));

    const { error: stagesError } = await supabase
      .from('crm_stage_definitions')
      .upsert(stageRows, { onConflict: 'value' });

    const { error: prioritiesError } = stagesError ? { error: null } : await supabase
      .from('crm_priority_definitions')
      .upsert(priorityRows, { onConflict: 'value' });

    const { error: numberingError } = (stagesError || prioritiesError) ? { error: null } : await supabase
      .from('crm_numbering_settings')
      .upsert(numberingRows, { onConflict: 'document_type' });

    setSaving(false);

    const error = stagesError || prioritiesError || numberingError;
    if (error) {
      toast({
        title: 'CRM nastaveni se nepodarilo ulozit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setCrmStages(normalizeStages(stageRows));
    setCrmPriorities(normalizePriorities(priorityRows));
    setCrmNumbering(normalizeCrmNumbering(numberingRows));
    toast({ title: 'CRM nastaveni ulozeno' });
    fetchCrmConfig();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Target}
        title="CRM nastaveni"
        description="Sprava stavu obchodnich pripadu, pravdepodobnosti a priorit pro CRM pipeline."
      />

      {!canAdmin && (
        <Alert>
          <SlidersHorizontal className="h-4 w-4" />
          <AlertTitle>Nedostatecna opravneni</AlertTitle>
          <AlertDescription>Tuto cast nastaveni muze menit pouze administrator.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="border-b bg-slate-50/70">
          <CardTitle>Cislovani CRM dokumentu</CardTitle>
          <CardDescription>Prefixy a dalsi cislo pro obchodni pripady, nabidky a objednavky.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          {Object.values(crmNumbering).map((config) => (
            <div key={config.document_type} className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="mb-3">
                <div className="text-sm font-semibold text-slate-900">{config.label}</div>
                <div className="text-xs text-muted-foreground">Priklad: {config.prefix}-26-{String(config.next_number || 1).padStart(Number(config.padding || 3), '0')}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Prefix</Label>
                  <Input
                    value={config.prefix}
                    onChange={(event) => updateNumberingConfig(config.document_type, 'prefix', event.target.value)}
                    disabled={loading || saving || !canAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dalsi cislo</Label>
                  <Input
                    type="number"
                    min="1"
                    value={config.next_number}
                    onChange={(event) => updateNumberingConfig(config.document_type, 'next_number', event.target.value)}
                    disabled={loading || saving || !canAdmin}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 border-b bg-slate-50/70">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle>Stavy obchodniho pripadu</CardTitle>
              <CardDescription>Tyto hodnoty se pouzivaji v CRM pipeline a pri vytvareni prilezitosti.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addStageConfig} disabled={loading || saving || !canAdmin}>
              Pridat stav
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {crmStages.map((stage, index) => (
            <div key={stage.value} className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm md:grid-cols-[minmax(140px,1fr)_110px_minmax(190px,1.2fr)_120px]">
              <div className="space-y-2">
                <Label>Nazev</Label>
                <Input
                  value={stage.label}
                  onChange={(event) => updateStageConfig(index, 'label', event.target.value)}
                  disabled={loading || saving || !canAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label>Pravdep.</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={stage.probability}
                  onChange={(event) => updateStageConfig(index, 'probability', event.target.value)}
                  disabled={loading || saving || !canAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label>Barva</Label>
                <Select value={stage.color} onValueChange={(value) => updateStageConfig(index, 'color', value)} disabled={loading || saving || !canAdmin}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bg-slate-100 text-slate-700 border-slate-200">Neutral</SelectItem>
                    <SelectItem value="bg-blue-100 text-blue-700 border-blue-200">Modra</SelectItem>
                    <SelectItem value="bg-indigo-100 text-indigo-700 border-indigo-200">Indigo</SelectItem>
                    <SelectItem value="bg-amber-100 text-amber-800 border-amber-200">Oranzova</SelectItem>
                    <SelectItem value="bg-emerald-100 text-emerald-700 border-emerald-200">Zelena</SelectItem>
                    <SelectItem value="bg-rose-100 text-rose-700 border-rose-200">Cervena</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select value={stage.is_closed ? 'closed' : 'open'} onValueChange={(value) => updateStageConfig(index, 'is_closed', value === 'closed')} disabled={loading || saving || !canAdmin}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Otevreno</SelectItem>
                    <SelectItem value="closed">Uzavreno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 border-b bg-slate-50/70">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle>Priority</CardTitle>
              <CardDescription>Priority se zobrazuji v kartach pipeline a ve formulari prilezitosti.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addPriorityConfig} disabled={loading || saving || !canAdmin}>
              Pridat prioritu
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {crmPriorities.map((priority, index) => (
            <div key={priority.value} className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_140px] xl:grid-cols-1">
              <div className="space-y-2">
                <Label>Nazev</Label>
                <Input
                  value={priority.label}
                  onChange={(event) => updatePriorityConfig(index, 'label', event.target.value)}
                  disabled={loading || saving || !canAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label>Vzhled</Label>
                <Select value={priority.tone} onValueChange={(value) => updatePriorityConfig(index, 'tone', value)} disabled={loading || saving || !canAdmin}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="secondary">Neutral</SelectItem>
                    <SelectItem value="outline">Obrys</SelectItem>
                    <SelectItem value="destructive">Vyrazna</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={resetCrmConfig} disabled={loading || saving || !canAdmin}>
          Obnovit vychozi
        </Button>
        <Button type="button" onClick={handleSaveCrmConfig} disabled={loading || saving || !canAdmin}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Ukladam...' : 'Ulozit CRM nastaveni'}
        </Button>
      </div>
    </div>
  );
};

export default SettingsCRM;
