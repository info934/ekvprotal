import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, CircleDollarSign, Clock3, Edit2, Loader2, Mail, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { formatMoney } from '@/lib/financePresentation';

const CONDITIONS = {
  handover: 'Po předání díla',
  warranty: 'Po skončení záruky',
  custom: 'Vlastní podmínka',
};
const STATUS = {
  planned: { label: 'Naplánováno', variant: 'secondary' },
  requested: { label: 'Žádost odeslána', variant: 'info' },
  paid: { label: 'Vyplaceno', variant: 'success' },
  cancelled: { label: 'Zrušeno', variant: 'outline' },
};
const defaultDraft = (item = null) => ({
  id: item?.id || null,
  label: item?.label || '',
  percentage: item?.percentage ?? '',
  release_condition: item?.release_condition || 'handover',
  notification_at: item?.notification_at ? toLocalInput(item.notification_at) : '',
  recipient_email: item?.recipient_email || 'info@ekvproject.cz',
  auto_request_enabled: Boolean(item?.auto_request_enabled),
  note: item?.note || '',
});
function toLocalInput(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
const formatDateTime = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'nenastaveno';
const amountOf = (contractAmount, percentage) => Number(contractAmount || 0) * Number(percentage || 0) / 100;

const RealizaceRetentions = ({ realizaceId, contractAmount, canManage }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sendingId, setSendingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsResult, listResult] = await Promise.all([
      supabase.rpc('get_realization_retention_settings', { p_realization_id: realizaceId }),
      supabase.rpc('list_realization_retentions', { p_realization_id: realizaceId }),
    ]);
    if (settingsResult.error || listResult.error) {
      toast({ title: 'Zádržné se nepodařilo načíst', description: settingsResult.error?.message || listResult.error?.message, variant: 'destructive' });
    } else {
      setEnabled(Boolean(settingsResult.data?.enabled));
      setItems(listResult.data || []);
    }
    setLoading(false);
  }, [realizaceId, toast]);

  useEffect(() => { load(); }, [load]);

  const activeTotal = useMemo(() => items.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + Number(item.percentage || 0), 0), [items]);
  const pendingAmount = useMemo(() => items.filter((item) => ['planned', 'requested'].includes(item.status)).reduce((sum, item) => sum + amountOf(contractAmount, item.percentage), 0), [items, contractAmount]);

  const setRetentionEnabled = async (next) => {
    if (!canManage) return;
    setSaving(true);
    const { error } = await supabase.rpc('set_realization_retention_enabled', { p_realization_id: realizaceId, p_enabled: next });
    setSaving(false);
    if (error) return toast({ title: 'Nastavení zádržného se nepodařilo uložit', description: error.message, variant: 'destructive' });
    setEnabled(next);
    toast({ title: next ? 'Evidence zádržného je aktivní' : 'Evidence zádržného je vypnutá', description: next ? 'Termíny a žádosti můžete nyní naplánovat.' : 'Položky se zachovaly, ale automatické žádosti se neodešlou.' });
  };

  const save = async (event) => {
    event.preventDefault();
    const percentage = Number(draft.percentage);
    if (!draft.label.trim() || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      return toast({ title: 'Zkontrolujte zádržné', description: 'Vyplňte název a procento v rozsahu 0 až 100.', variant: 'destructive' });
    }
    if (draft.auto_request_enabled && (!draft.notification_at || !draft.recipient_email.trim())) {
      return toast({ title: 'Chybí plán odeslání', description: 'Pro automatickou žádost vyplňte datum, čas a e-mail příjemce.', variant: 'destructive' });
    }
    setSaving(true);
    const payload = {
      ...draft,
      label: draft.label.trim(),
      percentage,
      recipient_email: draft.recipient_email.trim(),
      notification_at: draft.notification_at ? new Date(draft.notification_at).toISOString() : null,
      note: draft.note.trim(),
    };
    delete payload.id;
    const { error } = await supabase.rpc('save_realization_retention', {
      p_retention_id: draft.id,
      p_realization_id: realizaceId,
      p_payload: payload,
    });
    setSaving(false);
    if (error) return toast({ title: 'Zádržné se nepodařilo uložit', description: error.message, variant: 'destructive' });
    setDraft(null); await load(); toast({ title: 'Zádržné uloženo' });
  };

  const addStandardTerms = async () => {
    setSaving(true);
    const terms = [
      { label: 'Zádržné 5 % do předání díla', percentage: 5, release_condition: 'handover' },
      { label: 'Zádržné 5 % po skončení záruky', percentage: 5, release_condition: 'warranty' },
    ];
    try {
      for (const term of terms) {
        const { error } = await supabase.rpc('save_realization_retention', { p_retention_id: null, p_realization_id: realizaceId, p_payload: { ...term, recipient_email: 'info@ekvproject.cz', auto_request_enabled: false } });
        if (error) throw error;
      }
      await load(); toast({ title: 'Přidány dvě části zádržného', description: 'Doplňte termíny a případně zapněte automatickou žádost.' });
    } catch (error) { toast({ title: 'Předvyplnění se nepodařilo', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const mark = async (id, status) => {
    setSaving(true);
    const { error } = await supabase.rpc('set_realization_retention_status', { p_retention_id: id, p_status: status });
    setSaving(false);
    if (error) return toast({ title: 'Stav se nepodařilo změnit', description: error.message, variant: 'destructive' });
    await load(); toast({ title: status === 'paid' ? 'Zádržné označeno jako vyplacené' : 'Zádržné zrušeno' });
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    const { error } = await supabase.rpc('delete_realization_retention', { p_retention_id: deleting.id });
    setSaving(false); setDeleting(null);
    if (error) return toast({ title: 'Zádržné se nepodařilo odstranit', description: error.message, variant: 'destructive' });
    await load(); toast({ title: 'Zádržné odstraněno' });
  };

  const sendNow = async (id) => {
    setSendingId(id);
    const { data, error } = await supabase.functions.invoke('send-realization-retention-request', { body: { action: 'sendNow', retentionId: id } });
    setSendingId(null);
    if (error || data?.error) return toast({ title: 'Žádost se nepodařilo odeslat', description: data?.error || error?.message, variant: 'destructive' });
    await load(); toast({ title: 'Žádost o vyplacení byla odeslána' });
  };

  if (loading) return <Card><CardContent className="flex min-h-36 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;

  return <section className="space-y-4">
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-slate-50 to-white sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><CardTitle>Zádržné</CardTitle></div><CardDescription>Plánujte více částí, datum uvolnění a automatickou žádost o vyplacení.</CardDescription></div>
        <div className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2"><Label htmlFor="retention-enabled" className="text-sm">Evidovat zádržné</Label><Switch id="retention-enabled" checked={enabled} onCheckedChange={setRetentionEnabled} disabled={!canManage || saving} /></div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {!enabled ? <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">Zapnutím evidence založíte finanční plán zádržného. Uložené položky zůstávají zachované, dokud je znovu nepotřebujete.</div> : <>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Aktivní zádržné" value={`${activeTotal.toLocaleString('cs-CZ')} %`} detail="součet nezrušených částí" /><Metric label="Čeká na uvolnění" value={formatMoney(pendingAmount)} detail="z částky realizace" /><Metric label="Částí v plánu" value={String(items.length)} detail="každá má vlastní termín" /></div>
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted-foreground">Zádržné nemění smluvní výnos, náklady ani rozpočet odměn týmu. Slouží k hlídání smluvního nároku a žádosti o jeho uvolnění.</p>
          {canManage && <div className="flex flex-wrap gap-2"><Button onClick={() => setDraft(defaultDraft())}><Plus className="mr-2 h-4 w-4" />Přidat část</Button>{items.length === 0 && <Button variant="outline" disabled={saving} onClick={addStandardTerms}>Předvyplnit 2 × 5 %</Button>}</div>}
          {items.length === 0 ? <div className="rounded-lg border border-dashed p-7 text-center text-sm text-muted-foreground">Zatím není naplánována žádná část zádržného.</div> : <div className="space-y-3">{items.map((item) => <RetentionRow key={item.id} item={item} contractAmount={contractAmount} canManage={canManage} saving={saving} sending={sendingId === item.id} onEdit={() => setDraft(defaultDraft(item))} onDelete={() => setDeleting(item)} onPaid={() => mark(item.id, 'paid')} onCancel={() => mark(item.id, 'cancelled')} onSend={() => sendNow(item.id)} />)}</div>}
        </>}
      </CardContent>
    </Card>
    <RetentionDialog draft={draft} setDraft={setDraft} onSave={save} saving={saving} />
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Odstranit část zádržného?</AlertDialogTitle><AlertDialogDescription>Odstranit lze jen položku, pro kterou ještě nebyla odeslána žádost o vyplacení.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Zpět</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={remove} className="bg-destructive">Odstranit</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
};

const Metric = ({ label, value, detail }) => <div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div>;

const RetentionRow = ({ item, contractAmount, canManage, saving, sending, onEdit, onDelete, onPaid, onCancel, onSend }) => {
  const status = STATUS[item.status] || STATUS.planned;
  return <article className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.label}</h3><Badge variant={status.variant}>{status.label}</Badge></div><div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2"><span><CircleDollarSign className="mr-1 inline h-4 w-4" />{Number(item.percentage).toLocaleString('cs-CZ')} % · {formatMoney(amountOf(contractAmount, item.percentage))}</span><span><ShieldCheck className="mr-1 inline h-4 w-4" />{CONDITIONS[item.release_condition]}</span><span><Clock3 className="mr-1 inline h-4 w-4" />{formatDateTime(item.notification_at)}</span><span><Mail className="mr-1 inline h-4 w-4" />{item.recipient_email || 'bez příjemce'}</span></div>{item.note && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{item.note}</p>}</div>{canManage && <div className="flex flex-wrap gap-2 lg:justify-end">{item.status === 'planned' && item.recipient_email && <Button size="sm" disabled={saving || sending} onClick={onSend}>{sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bell className="mr-1 h-4 w-4" />}Odeslat nyní</Button>}{item.status === 'requested' && <Button size="sm" variant="outline" disabled={saving} onClick={onPaid}><CheckCircle2 className="mr-1 h-4 w-4" />Vyplaceno</Button>}{item.status === 'planned' && <><Button size="icon" variant="ghost" aria-label={`Upravit ${item.label}`} disabled={saving} onClick={onEdit}><Edit2 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" aria-label={`Odstranit ${item.label}`} disabled={saving} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></>}{['planned', 'requested'].includes(item.status) && <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Zrušit</Button>}</div>}</div></article>;
};

const RetentionDialog = ({ draft, setDraft, onSave, saving }) => <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && !saving && setDraft(null)}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{draft?.id ? 'Upravit zádržné' : 'Přidat část zádržného'}</DialogTitle><DialogDescription>Každá část má vlastní procento, podmínku a čas pro žádost o vyplacení.</DialogDescription></DialogHeader>{draft && <form onSubmit={onSave} className="space-y-4"><div className="grid gap-4 sm:grid-cols-[1fr_10rem]"><div className="space-y-2"><Label>Název části</Label><Input autoFocus maxLength={160} required value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Např. Zádržné do předání díla" /></div><div className="space-y-2"><Label>Procento</Label><Input type="number" min="0.01" max="100" step="0.01" required value={draft.percentage} onChange={(event) => setDraft({ ...draft, percentage: event.target.value })} /></div></div><div className="space-y-2"><Label>Podmínka uvolnění</Label><select className="min-h-11 w-full rounded-md border bg-white px-3 text-sm" value={draft.release_condition} onChange={(event) => setDraft({ ...draft, release_condition: event.target.value })}>{Object.entries(CONDITIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="rounded-lg border bg-slate-50 p-3"><div className="flex items-start justify-between gap-4"><div><Label htmlFor="retention-auto" className="font-semibold">Odeslat žádost automaticky</Label><p className="mt-1 text-xs text-muted-foreground">V nastavený čas dorazí e-mail s žádostí o vyplacení.</p></div><Switch id="retention-auto" checked={draft.auto_request_enabled} onCheckedChange={(checked) => setDraft({ ...draft, auto_request_enabled: checked })} /></div>{draft.auto_request_enabled && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium">Datum a čas<Input type="datetime-local" required value={draft.notification_at} onChange={(event) => setDraft({ ...draft, notification_at: event.target.value })} /></label><label className="space-y-2 text-sm font-medium">Příjemce<Input type="email" required value={draft.recipient_email} onChange={(event) => setDraft({ ...draft, recipient_email: event.target.value })} /></label></div>}</div><div className="space-y-2"><Label>Poznámka pro žádost</Label><Textarea maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Např. číslo smluvního ustanovení nebo podmínky uvolnění" /></div><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>Zrušit</Button><Button disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Ukládám</> : 'Uložit zádržné'}</Button></DialogFooter></form>}</DialogContent></Dialog>;

export default RealizaceRetentions;
