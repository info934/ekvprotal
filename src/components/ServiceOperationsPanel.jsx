import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ClipboardCopy, Coins, ExternalLink, Link2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const money = (value) => `${Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč`;
const dateTime = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Není nastaveno';
const emptyEntry = { entry_type: 'labor', description: '', quantity: 1, unit: 'hod', unit_cost: 0, billable: true };

export default function ServiceOperationsPanel({ serviceCase, canEdit, onChanged }) {
  const { memberId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [draft, setDraft] = useState(emptyEntry);
  const [saving, setSaving] = useState(false);
  const [publicLink, setPublicLink] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('service_work_entries').select('*').eq('service_case_id', serviceCase.id).order('created_at', { ascending: false });
    if (!error) setEntries(data || []);
  }, [serviceCase.id]);
  useEffect(() => { load(); }, [load]);
  const total = useMemo(() => entries.reduce((sum, item) => sum + Number(item.total_cost || 0), 0), [entries]);

  const saveEntry = async (event) => {
    event.preventDefault(); setSaving(true);
    const { error } = await supabase.from('service_work_entries').insert({
      service_case_id: serviceCase.id,
      service_visit_id: null,
      ...draft,
      quantity: Number(draft.quantity || 0),
      unit_cost: Number(draft.unit_cost || 0),
      created_by_member_id: memberId,
    });
    setSaving(false);
    if (error) return toast({ title: 'Položku se nepodařilo uložit', description: error.message, variant: 'destructive' });
    setEntryOpen(false); setDraft(emptyEntry); await load(); toast({ title: 'Servisní náklad byl uložen' });
  };

  const createPublicLink = async () => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('service-public-status', { body: { action: 'create', serviceCaseId: serviceCase.id } });
    setSaving(false);
    if (error || !data?.success) return toast({ title: 'Zákaznický odkaz se nepodařilo vytvořit', description: data?.error || error?.message, variant: 'destructive' });
    setPublicLink(data);
    await navigator.clipboard?.writeText(data.url).catch(() => {});
    toast({ title: 'Zákaznický odkaz je připravený', description: 'Odkaz byl zkopírován do schránky a platí 30 dní.' });
    await onChanged?.();
  };

  const convertToOffer = async () => {
    if (!serviceCase.subject_id) return toast({ title: 'Nejdříve propojte servis s klientem', description: 'Pro nabídku je potřeba vybraný subjekt.', variant: 'destructive' });
    setSaving(true);
    const { data, error } = await supabase.rpc('create_crm_commercial_document_atomic', {
      p_opportunity_id: null,
      p_type: 'offer',
      p_new_opportunity: { title: `Placený servis ${serviceCase.number} – ${serviceCase.title}`, subject_id: serviceCase.subject_id, value: 0 },
    });
    if (!error && data?.opportunity_id) await supabase.from('service_cases').update({ opportunity_id: data.opportunity_id }).eq('id', serviceCase.id);
    setSaving(false);
    if (error || !data?.id) return toast({ title: 'Nabídku se nepodařilo vytvořit', description: error?.message || 'Server nevrátil nový dokument.', variant: 'destructive' });
    toast({ title: 'CRM nabídka byla vytvořena' });
    navigate(`/crm/offers/${data.id}`);
  };

  return <>
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />SLA a termíny</CardTitle><Badge variant={serviceCase.sla_breached_at ? 'destructive' : 'outline'}>{serviceCase.sla_breached_at ? 'Po SLA' : 'Sleduje se'}</Badge></div></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-500">První reakce do</span><strong className="mt-1 block">{dateTime(serviceCase.response_due_at)}</strong></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-500">Vyřešení do</span><strong className="mt-1 block">{dateTime(serviceCase.resolution_due_at)}</strong></div></CardContent></Card>
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" />Práce, doprava a materiál</CardTitle>{canEdit && <Button size="sm" variant="outline" onClick={() => setEntryOpen(true)}><Plus className="mr-2 h-4 w-4" />Položka</Button>}</div></CardHeader><CardContent><div className="mb-3 flex items-center justify-between rounded-lg bg-slate-950 p-3 text-white"><span className="text-sm">Evidované náklady</span><strong>{money(total)}</strong></div>{entries.length ? <div className="divide-y rounded-lg border">{entries.slice(0, 8).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div><strong>{item.description}</strong><p className="text-xs text-slate-500">{item.quantity} {item.unit} · {item.entry_type}</p></div><span className="font-semibold">{money(item.total_cost)}</span></div>)}</div> : <p className="text-sm text-slate-500">Zatím nejsou evidované žádné položky.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Klient a obchod</CardTitle></CardHeader><CardContent className="space-y-2">{canEdit && <Button className="w-full justify-start" variant="outline" onClick={createPublicLink} disabled={saving}><ClipboardCopy className="mr-2 h-4 w-4" />Vytvořit zákaznický odkaz</Button>}{publicLink?.url && <Button asChild className="w-full justify-start" variant="outline"><a href={publicLink.url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Otevřít zákaznický pohled</a></Button>}{canEdit && <Button className="w-full justify-start" onClick={convertToOffer} disabled={saving || !serviceCase.subject_id}><Coins className="mr-2 h-4 w-4" />Vytvořit placenou CRM nabídku</Button>}{!serviceCase.subject_id && <p className="text-xs text-amber-700">Pro vytvoření nabídky propojte případ s klientským subjektem.</p>}</CardContent></Card>

    <Dialog open={entryOpen} onOpenChange={setEntryOpen}><DialogContent><DialogHeader><DialogTitle>Nová servisní položka</DialogTitle></DialogHeader><form onSubmit={saveEntry} className="space-y-4"><div className="space-y-2"><Label>Typ</Label><select className="h-11 w-full rounded-md border bg-white px-3" value={draft.entry_type} onChange={(e) => setDraft((current) => ({ ...current, entry_type: e.target.value, unit: e.target.value === 'labor' ? 'hod' : e.target.value === 'travel' ? 'km' : 'ks' }))}><option value="labor">Práce</option><option value="travel">Doprava</option><option value="material">Materiál</option><option value="other">Ostatní</option></select></div><div className="space-y-2"><Label>Popis</Label><Input required value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} /></div><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label>Množství</Label><Input required type="number" min="0" step="0.01" value={draft.quantity} onChange={(e) => setDraft((current) => ({ ...current, quantity: e.target.value }))} /></div><div className="space-y-2"><Label>Jednotka</Label><Input required value={draft.unit} onChange={(e) => setDraft((current) => ({ ...current, unit: e.target.value }))} /></div><div className="space-y-2"><Label>Cena/jedn.</Label><Input required type="number" min="0" step="0.01" value={draft.unit_cost} onChange={(e) => setDraft((current) => ({ ...current, unit_cost: e.target.value }))} /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEntryOpen(false)}>Zrušit</Button><Button disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</Button></DialogFooter></form></DialogContent></Dialog>
  </>;
}
