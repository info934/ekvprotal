import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit2, FileText, Plus, Receipt, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const money = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency: 'CZK', maximumFractionDigits: 0,
}).format(Number(value || 0));

const percent = (value) => `${Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`;

const statusLabels = {
  draft: 'Koncept', issued: 'Vystavená', partially_paid: 'Částečně uhrazená',
  paid: 'Uhrazená', cancelled: 'Stornovaná', overdue: 'Po splatnosti',
};

const coverageLabels = {
  not_configured: 'Neevidováno', not_invoiced: 'Nevyfakturováno',
  partially_invoiced: 'Částečně fakturováno', invoiced_unpaid: 'Čeká na úhradu',
  partially_paid: 'Částečně uhrazeno', fully_paid: 'Plně uhrazeno',
};

const kindLabels = {
  advance: 'Zálohová', partial: 'Dílčí', final: 'Konečná', credit_note: 'Dobropis',
};

const emptyForm = {
  invoice_number: '', invoice_kind: 'partial', status: 'draft', issue_date: '', due_date: '', paid_date: '',
  amount_excl_vat: '', vat_rate: '21', paid_amount: '', note: '', document_url: '',
};

const BillingTracker = ({ entityType, entityId, onSummaryChange }) => {
  const { toast } = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_entity_billing_summary', {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (error) {
      toast({ title: 'Fakturaci se nepodařilo načíst', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    setSummary(data);
    onSummaryChange?.(data);
    setLoading(false);
  }, [entityId, entityType, onSummaryChange, toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (entry) => {
    setEditingId(entry.id);
    setForm({
      invoice_number: entry.invoice_number || '',
      invoice_kind: entry.invoice_kind || 'partial',
      status: entry.status || 'draft',
      issue_date: entry.issue_date || '', due_date: entry.due_date || '', paid_date: entry.paid_date || '',
      amount_excl_vat: String(entry.amount_excl_vat ?? ''), vat_rate: String(entry.vat_rate ?? 21),
      paid_amount: String(entry.paid_amount ?? ''), note: entry.note || '', document_url: entry.document_url || '',
    });
    setDialogOpen(true);
  };

  const grossPreview = useMemo(() => {
    const net = Number(form.amount_excl_vat || 0);
    const vat = Number(form.vat_rate || 0);
    return net * (1 + vat / 100);
  }, [form.amount_excl_vat, form.vat_rate]);

  const save = async () => {
    const amount = Number(form.amount_excl_vat);
    const paid = Number(form.paid_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Zadejte částku faktury bez DPH', variant: 'destructive' });
      return;
    }
    if (paid > grossPreview + 0.01 && form.invoice_kind !== 'credit_note') {
      toast({ title: 'Uhrazená částka je vyšší než faktura', variant: 'destructive' });
      return;
    }
    if (form.status === 'partially_paid' && (paid <= 0 || paid >= grossPreview)) {
      toast({
        title: 'Částečná úhrada není zadaná správně',
        description: 'Uhrazená částka musí být vyšší než nula a nižší než celková částka faktury.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const payload = {
      entity_type: entityType,
      project_id: entityType === 'project' ? entityId : null,
      realization_id: entityType === 'realization' ? entityId : null,
      invoice_number: form.invoice_number.trim() || null,
      invoice_kind: form.invoice_kind,
      status: form.status,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      paid_date: form.paid_date || null,
      amount_excl_vat: amount,
      vat_rate: Number(form.vat_rate || 0),
      paid_amount: form.status === 'paid' ? grossPreview : paid,
      note: form.note.trim() || null,
      document_url: form.document_url.trim() || null,
    };
    const query = editingId
      ? supabase.from('entity_billing_entries').update(payload).eq('id', editingId)
      : supabase.from('entity_billing_entries').insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      toast({ title: 'Fakturu se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }
    setDialogOpen(false);
    toast({ title: editingId ? 'Fakturace aktualizována' : 'Faktura přidána' });
    await load();
  };

  const remove = async (entry) => {
    if (!window.confirm(`Odstranit evidenci faktury ${entry.invoice_number || ''}? Změna zůstane v auditní historii.`)) return;
    const { error } = await supabase.from('entity_billing_entries').delete().eq('id', entry.id);
    if (error) {
      toast({ title: 'Fakturu se nepodařilo odstranit', description: error.message, variant: 'destructive' });
      return;
    }
    await load();
  };

  if (loading) return <div className="rounded-lg border bg-white p-5 text-sm text-slate-500">Načítám fakturaci…</div>;

  const healthy = summary?.status === 'fully_paid';
  const entries = summary?.entries || [];

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-700" />
            <h3 className="text-base font-semibold text-slate-950">Fakturace zakázky</h3>
            <Badge variant={healthy ? 'success' : 'secondary'}>{coverageLabels[summary?.status] || summary?.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Úhrady určují doporučenou část výplat krytou skutečným cash-flow. Celková hodnota zakázky a faktury s DPH musí používat stejný cenový základ.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Přidat fakturu</Button>
      </div>

      {summary?.warning && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Zakázka není plně finančně pokrytá</AlertTitle>
          <AlertDescription>{summary.warning_message} Výplata nad krytý limit vyžaduje kontrolu administrátora.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Hodnota zakázky', money(summary?.contract_amount)],
          ['Vystavené faktury', money(summary?.invoiced_amount), percent(summary?.invoice_coverage_percent)],
          ['Uhrazeno', money(summary?.paid_amount), percent(summary?.payment_coverage_percent)],
          ['Zbývá uhradit', money(Math.max(0, Number(summary?.contract_amount || 0) - Number(summary?.paid_amount || 0)))],
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-md border bg-slate-50 px-3 py-2.5">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="mt-1 font-semibold tabular-nums text-slate-950">{value}</div>
            {detail && <div className="text-xs text-slate-500">{detail}</div>}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[900px]">
          <TableHeader><TableRow>
            <TableHead>Číslo</TableHead><TableHead>Typ</TableHead><TableHead>Vystaveno</TableHead>
            <TableHead>Splatnost</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Celkem</TableHead>
            <TableHead className="text-right">Uhrazeno</TableHead><TableHead className="w-24 text-right">Akce</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center text-slate-500">Fakturace zatím není evidována.</TableCell></TableRow>
            ) : entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.invoice_number || 'Bez čísla'}</TableCell>
                <TableCell>{kindLabels[entry.invoice_kind]}</TableCell>
                <TableCell>{entry.issue_date ? new Date(entry.issue_date).toLocaleDateString('cs-CZ') : '—'}</TableCell>
                <TableCell>{entry.due_date ? new Date(entry.due_date).toLocaleDateString('cs-CZ') : '—'}</TableCell>
                <TableCell><Badge variant={entry.status === 'paid' ? 'success' : entry.status === 'overdue' ? 'destructive' : 'secondary'}>{statusLabels[entry.status]}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{money(entry.amount_incl_vat)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(entry.paid_amount)}</TableCell>
                <TableCell><div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(entry)}><Edit2 className="h-4 w-4" /><span className="sr-only">Upravit</span></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(entry)}><Trash2 className="h-4 w-4 text-rose-600" /><span className="sr-only">Odstranit</span></Button>
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{editingId ? 'Upravit fakturaci' : 'Přidat fakturu'}</DialogTitle>
            <DialogDescription>Evidence odběratelské faktury a její úhrady pro kontrolu dostupných výplat.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Číslo faktury</Label><Input value={form.invoice_number} onChange={(e) => setForm((p) => ({ ...p, invoice_number: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Typ faktury</Label><Select value={form.invoice_kind} onValueChange={(v) => setForm((p) => ({ ...p, invoice_kind: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kindLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Stav</Label><Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Datum vystavení</Label><Input type="date" value={form.issue_date} onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Datum splatnosti</Label><Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Datum úhrady</Label><Input type="date" value={form.paid_date} onChange={(e) => setForm((p) => ({ ...p, paid_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Částka bez DPH</Label><Input type="number" min="0" step="0.01" value={form.amount_excl_vat} onChange={(e) => setForm((p) => ({ ...p, amount_excl_vat: e.target.value }))} /></div>
            <div className="space-y-2"><Label>DPH</Label><Select value={form.vat_rate} onValueChange={(v) => setForm((p) => ({ ...p, vat_rate: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['0', '12', '21'].map((v) => <SelectItem key={v} value={v}>{v} %</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Celkem s DPH</Label><Input value={money(grossPreview)} disabled /></div>
            <div className="space-y-2"><Label>Uhrazená částka</Label><Input type="number" min="0" step="0.01" value={form.paid_amount} onChange={(e) => setForm((p) => ({ ...p, paid_amount: e.target.value }))} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Odkaz na fakturu</Label><Input type="url" value={form.document_url} onChange={(e) => setForm((p) => ({ ...p, document_url: e.target.value }))} placeholder="https://…" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Poznámka</Label><Textarea rows={3} value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Zrušit</Button><Button onClick={save} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default BillingTracker;
