import React, { useEffect, useState } from 'react';
import { Save, TimerReset, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const PRIORITIES = [
  ['critical', 'Kritická'],
  ['high', 'Vysoká'],
  ['normal', 'Běžná'],
  ['low', 'Nízká'],
];

const minutesToHours = value => Number((Number(value || 0) / 60).toFixed(2));
const hoursToMinutes = value => Math.max(15, Math.round(Number(value || 0) * 60));

export default function SettingsService() {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('service_sla_policies').select('*').then(({ data, error }) => {
      if (error) toast({ variant: 'destructive', title: 'SLA se nepodařilo načíst', description: error.message });
      setRows(PRIORITIES.map(([priority]) => {
        const row = (data || []).find(item => item.priority === priority) || {};
        return { priority, responseHours: minutesToHours(row.response_minutes), resolutionHours: minutesToHours(row.resolution_minutes), isActive: row.is_active !== false };
      }));
      setLoading(false);
    });
  }, [toast]);

  const update = (priority, key, value) => setRows(current => current.map(row => row.priority === priority ? { ...row, [key]: value } : row));
  const save = async () => {
    setSaving(true);
    const payload = rows.map(row => ({
      priority: row.priority,
      response_minutes: hoursToMinutes(row.responseHours),
      resolution_minutes: hoursToMinutes(row.resolutionHours),
      is_active: row.isActive,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('service_sla_policies').upsert(payload, { onConflict: 'priority' });
    setSaving(false);
    toast(error
      ? { variant: 'destructive', title: 'SLA se nepodařilo uložit', description: error.message }
      : { title: 'Servisní SLA bylo uloženo' });
  };

  return <section className="app-surface overflow-hidden">
    <div className="flex items-start gap-3 border-b p-5">
      <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><TimerReset className="h-5 w-5" /></span>
      <div><h2 className="text-lg font-semibold">Servisní SLA</h2><p className="mt-1 text-sm text-muted-foreground">Lhůty se použijí při založení případu a při změně priority.</p></div>
    </div>
    {loading ? <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Načítám nastavení…</div> : <div className="divide-y">
      {rows.map(row => {
        const label = PRIORITIES.find(([value]) => value === row.priority)?.[1];
        return <div key={row.priority} className="grid gap-4 p-5 sm:grid-cols-[minmax(120px,1fr)_1fr_1fr_auto] sm:items-end">
          <div><p className="font-semibold">{label}</p><p className="text-xs text-muted-foreground">Priorita {row.priority}</p></div>
          <div className="space-y-1.5"><Label htmlFor={`${row.priority}-response`}>První reakce (hodiny)</Label><Input id={`${row.priority}-response`} type="number" min="0.25" step="0.25" value={row.responseHours} onChange={e => update(row.priority, 'responseHours', e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`${row.priority}-resolution`}>Vyřešení (hodiny)</Label><Input id={`${row.priority}-resolution`} type="number" min="0.25" step="0.25" value={row.resolutionHours} onChange={e => update(row.priority, 'resolutionHours', e.target.value)} /></div>
          <div className="flex h-10 items-center gap-2"><Switch checked={row.isActive} onCheckedChange={value => update(row.priority, 'isActive', value)} aria-label={`Aktivovat ${label}`} /><span className="text-sm">Aktivní</span></div>
        </div>;
      })}
    </div>}
    <div className="flex justify-end border-t bg-slate-50 p-4"><Button onClick={save} disabled={loading || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Uložit SLA</Button></div>
  </section>;
}
