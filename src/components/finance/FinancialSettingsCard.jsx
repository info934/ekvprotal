import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const fieldDefinitions = {
  project: [
    { key: 'price', label: 'Hodnota zakázky bez DPH', min: 0.01, max: null, step: 0.01, suffix: 'Kč' },
    { key: 'budget_percentage', label: 'Projektový budget', min: 0, max: 100, step: 0.1, suffix: '%' },
    { key: 'overhead_percentage', label: 'Režie z budgetu', min: 0, max: 100, step: 0.1, suffix: '%' },
  ],
  realization: [
    { key: 'contract_amount', label: 'Smluvní hodnota bez DPH', min: 0.01, max: null, step: 0.01, suffix: 'Kč' },
    { key: 'profit_margin_percent', label: 'Plánovaná marže', min: 0, max: 100, step: 0.1, suffix: '%' },
    { key: 'overhead_percent', label: 'Režie firmy', min: 0, max: 100, step: 0.1, suffix: '%' },
  ],
};

const normalizeValues = (type, values) => Object.fromEntries(
  fieldDefinitions[type].map(({ key }) => [key, Number(values?.[key] || 0)]),
);

const FinancialSettingsCard = ({ entityType, entityId, values, disabled = false, onSaved }) => {
  const { toast } = useToast();
  const [formValues, setFormValues] = useState(() => normalizeValues(entityType, values));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormValues(normalizeValues(entityType, values));
  }, [entityType, values?.price, values?.budget_percentage, values?.overhead_percentage, values?.contract_amount, values?.profit_margin_percent, values?.overhead_percent]);

  const fields = fieldDefinitions[entityType];

  const save = async () => {
    const invalid = fields.find(({ key, min, max }) => {
      const value = Number(formValues[key]);
      return !Number.isFinite(value) || value < min || (max !== null && value > max);
    });
    if (invalid) {
      toast({ title: 'Neplatná finanční hodnota', description: `Zkontrolujte pole ${invalid.label}.`, variant: 'destructive' });
      return;
    }
    if (entityType === 'realization' && Number(formValues.profit_margin_percent) + Number(formValues.overhead_percent) > 100) {
      toast({ title: 'Neplatné rozdělení', description: 'Součet marže a režie nesmí přesáhnout 100 %.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const rpcName = entityType === 'project' ? 'update_project_financial_settings' : 'update_realization_financial_settings';
      const idKey = entityType === 'project' ? 'p_project_id' : 'p_realization_id';
      const { data, error } = await supabase.rpc(rpcName, { [idKey]: entityId, p_values: formValues });
      if (error) throw error;
      toast({ title: 'Finanční nastavení uloženo', description: 'Souhrny byly přepočítány z autoritativních dat.' });
      await onSaved?.(data);
    } catch (error) {
      toast({ title: 'Finanční nastavení se nepodařilo uložit', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nastavení finančního modelu</CardTitle>
        <CardDescription>Kanonické vstupy může měnit pouze administrátor. Každá změna se ukládá do auditu.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
        {fields.map(({ key, label, min, max, step, suffix }) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`${entityType}-${key}`}>{label}</Label>
            <div className="relative">
              <Input
                id={`${entityType}-${key}`}
                type="number"
                min={min}
                max={max ?? undefined}
                step={step}
                value={formValues[key]}
                onChange={(event) => setFormValues((current) => ({ ...current, [key]: event.target.value }))}
                disabled={disabled || saving}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
            </div>
          </div>
        ))}
        <Button type="button" onClick={save} disabled={disabled || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Uložit
        </Button>
      </CardContent>
    </Card>
  );
};

export default FinancialSettingsCard;
