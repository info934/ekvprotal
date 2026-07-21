import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, Edit2, ExternalLink, FileText,
  Link2, MoreHorizontal, Plus, Receipt, Trash2, Upload,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { uploadInvoiceDocument } from '@/lib/documentStorageService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
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
import ContractExtractionPanel from '@/components/ContractExtractionPanel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinanceMetricStrip, FinanceStageFlow, FinanceDefinitionNote } from '@/components/finance/FinanceWorkspace';
import { formatMoney, formatPercent, getFinanceErrorMessage, VAT_RATE_OPTIONS } from '@/lib/financePresentation';
import ConfirmActionDialog from '@/components/ui/confirm-action-dialog';

const money = formatMoney;
const percent = formatPercent;
const localDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('cs-CZ') : '—';
const toDateInput = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + Number(days || 0));
  return toDateInput(next);
};

const statusLabels = {
  draft: 'Koncept', issued: 'Vystavená', partially_paid: 'Částečně uhrazená',
  paid: 'Uhrazená', cancelled: 'Stornovaná', overdue: 'Po splatnosti',
};

const milestoneStatusLabels = {
  planned: 'Plánováno', ready: 'Připraveno', invoiced: 'Vyfakturováno',
  partially_paid: 'Částečně uhrazeno', completed: 'Dokončeno', overdue: 'Po termínu', cancelled: 'Stornováno',
};

const coverageLabels = {
  not_configured: 'Neevidováno', not_invoiced: 'Nevyfakturováno',
  partially_invoiced: 'Částečně fakturováno', invoiced_unpaid: 'Čeká na úhradu',
  partially_paid: 'Částečně uhrazeno', fully_paid: 'Plně uhrazeno',
};

const kindLabels = {
  advance: 'Zálohová', partial: 'Dílčí', final: 'Konečná', credit_note: 'Dobropis',
};

const emptyInvoiceForm = {
  milestone_id: '', invoice_number: '', invoice_kind: 'partial', status: 'draft',
  performance_date: '', issue_date: '', due_date: '', paid_date: '',
  amount_excl_vat: '', vat_rate: '21', paid_amount: '', note: '',
  document_url: '', document_file_name: '', document_required: true,
};

const emptyMilestoneForm = {
  installment_number: '', name: '', status: 'planned', performance_date: '',
  planned_issue_date: '', due_date: '', amount_excl_vat: '', vat_rate: '21',
  percent_of_contract: '', note: '',
};

const BillingTracker = ({ entityType, entityId, entityCode, onSummaryChange, enableContractAnalysis = false, showFinancialSummary = true }) => {
  const { toast } = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [milestoneForm, setMilestoneForm] = useState(emptyMilestoneForm);
  const [planForm, setPlanForm] = useState({ count: '3', first_date: toDateInput(new Date()), interval_days: '30', vat_rate: '21' });

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_entity_billing_summary', {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (error) {
      toast({ title: 'Fakturaci se nepodařilo načíst', description: getFinanceErrorMessage(error), variant: 'destructive' });
      setLoading(false);
      return;
    }
    setSummary(data);
    onSummaryChange?.(data);
    setLoading(false);
  }, [entityId, entityType, onSummaryChange, toast]);

  useEffect(() => { load(); }, [load]);

  const entries = useMemo(() => summary?.entries || [], [summary]);
  const milestones = useMemo(() => summary?.milestones || [], [summary]);
  const milestoneById = useMemo(() => new Map(milestones.map((item) => [item.id, item])), [milestones]);
  const linkedMilestoneIds = useMemo(() => new Set(entries.filter((entry) => entry.status !== 'cancelled').map((entry) => entry.milestone_id).filter(Boolean)), [entries]);

  const grossPreview = useMemo(() => {
    const net = Number(invoiceForm.amount_excl_vat || 0);
    const vat = Number(invoiceForm.vat_rate || 0);
    return net * (1 + vat / 100);
  }, [invoiceForm.amount_excl_vat, invoiceForm.vat_rate]);

  const openCreateInvoice = (milestone = null) => {
    setEditingInvoiceId(null);
    setInvoiceFile(null);
    setInvoiceForm(milestone ? {
      ...emptyInvoiceForm,
      milestone_id: milestone.id,
      invoice_kind: milestone.installment_number === milestones.filter((item) => item.status !== 'cancelled').length ? 'final' : 'partial',
      performance_date: milestone.performance_date || '',
      issue_date: milestone.planned_issue_date || '',
      due_date: milestone.due_date || '',
      amount_excl_vat: String(milestone.amount_excl_vat ?? ''),
      vat_rate: String(milestone.vat_rate ?? 21),
      note: milestone.name || '',
    } : emptyInvoiceForm);
    setInvoiceDialogOpen(true);
  };

  const openEditInvoice = (entry) => {
    setEditingInvoiceId(entry.id);
    setInvoiceFile(null);
    setInvoiceForm({
      milestone_id: entry.milestone_id || '',
      invoice_number: entry.invoice_number || '',
      invoice_kind: entry.invoice_kind || 'partial',
      status: entry.status || 'draft',
      performance_date: entry.performance_date || '', issue_date: entry.issue_date || '',
      due_date: entry.due_date || '', paid_date: entry.paid_date || '',
      amount_excl_vat: String(entry.amount_excl_vat ?? ''), vat_rate: String(entry.vat_rate ?? 21),
      paid_amount: String(entry.paid_amount ?? ''), note: entry.note || '',
      document_url: entry.document_url || '', document_file_name: entry.document_file_name || '',
      document_required: entry.document_required !== false,
    });
    setInvoiceDialogOpen(true);
  };

  const openCreateMilestone = () => {
    const nextNumber = milestones.reduce((max, item) => Math.max(max, Number(item.installment_number || 0)), 0) + 1;
    setEditingMilestoneId(null);
    setMilestoneForm({ ...emptyMilestoneForm, installment_number: String(nextNumber), name: `${nextNumber}. fakturační etapa` });
    setMilestoneDialogOpen(true);
  };

  const openEditMilestone = (milestone) => {
    setEditingMilestoneId(milestone.id);
    setMilestoneForm({
      installment_number: String(milestone.installment_number), name: milestone.name || '', status: milestone.status || 'planned',
      performance_date: milestone.performance_date || '', planned_issue_date: milestone.planned_issue_date || '',
      due_date: milestone.due_date || '', amount_excl_vat: String(milestone.amount_excl_vat ?? ''),
      vat_rate: String(milestone.vat_rate ?? 21), percent_of_contract: String(milestone.percent_of_contract ?? ''),
      note: milestone.note || '',
    });
    setMilestoneDialogOpen(true);
  };

  const saveMilestone = async () => {
    const amount = Number(milestoneForm.amount_excl_vat);
    if (!milestoneForm.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Doplňte název a kladnou částku etapy', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      entity_type: entityType,
      project_id: entityType === 'project' ? entityId : null,
      realization_id: entityType === 'realization' ? entityId : null,
      installment_number: Number(milestoneForm.installment_number),
      name: milestoneForm.name.trim(), status: milestoneForm.status,
      performance_date: milestoneForm.performance_date || null,
      planned_issue_date: milestoneForm.planned_issue_date || null,
      due_date: milestoneForm.due_date || null,
      amount_excl_vat: amount, vat_rate: Number(milestoneForm.vat_rate),
      percent_of_contract: milestoneForm.percent_of_contract === '' ? null : Number(milestoneForm.percent_of_contract),
      note: milestoneForm.note.trim() || null,
    };
    const query = editingMilestoneId
      ? supabase.from('entity_billing_milestones').update(payload).eq('id', editingMilestoneId)
      : supabase.from('entity_billing_milestones').insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      toast({ title: 'Etapu se nepodařilo uložit', description: getFinanceErrorMessage(error), variant: 'destructive' });
      return;
    }
    setMilestoneDialogOpen(false);
    toast({ title: editingMilestoneId ? 'Etapa aktualizována' : 'Etapa přidána' });
    await load();
  };

  const createEqualPlan = async () => {
    const count = Number(planForm.count);
    const interval = Number(planForm.interval_days);
    const vatRate = Number(planForm.vat_rate);
    const contractGross = Number(summary?.contract_amount || 0);
    const existingGross = milestones.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + Number(item.amount_incl_vat || 0), 0);
    const remainingGross = Math.max(0, contractGross - existingGross);
    if (!Number.isInteger(count) || count < 1 || count > 24 || remainingGross <= 0 || !planForm.first_date) {
      toast({ title: 'Zkontrolujte počet etap, první termín a zbývající hodnotu zakázky', variant: 'destructive' });
      return;
    }
    const firstNumber = milestones.reduce((max, item) => Math.max(max, Number(item.installment_number || 0)), 0) + 1;
    const grossPerPart = remainingGross / count;
    const netPerPart = grossPerPart / (1 + vatRate / 100);
    const rows = Array.from({ length: count }, (_, index) => {
      const issueDate = addDays(planForm.first_date, interval * index);
      const isLast = index === count - 1;
      const priorNet = Number(netPerPart.toFixed(2)) * (count - 1);
      const lastNet = Math.max(0, remainingGross / (1 + vatRate / 100) - priorNet);
      return {
        entity_type: entityType,
        project_id: entityType === 'project' ? entityId : null,
        realization_id: entityType === 'realization' ? entityId : null,
        installment_number: firstNumber + index,
        name: `${firstNumber + index}. fakturační etapa`,
        status: 'planned',
        performance_date: issueDate,
        planned_issue_date: issueDate,
        due_date: addDays(issueDate, 14),
        amount_excl_vat: isLast ? Number(lastNet.toFixed(2)) : Number(netPerPart.toFixed(2)),
        vat_rate: vatRate,
        percent_of_contract: Number((100 / count).toFixed(3)),
      };
    });
    setSaving(true);
    const { error } = await supabase.from('entity_billing_milestones').insert(rows);
    setSaving(false);
    if (error) {
      toast({ title: 'Plán etap se nepodařilo vytvořit', description: getFinanceErrorMessage(error), variant: 'destructive' });
      return;
    }
    setPlanDialogOpen(false);
    toast({ title: `Vytvořeno ${count} fakturačních etap` });
    await load();
  };

  const saveInvoice = async () => {
    const amount = Number(invoiceForm.amount_excl_vat);
    const paid = Number(invoiceForm.paid_amount || 0);
    const isIssued = !['draft', 'cancelled'].includes(invoiceForm.status);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Zadejte částku faktury bez DPH', variant: 'destructive' });
      return;
    }
    if (isIssued && (!invoiceForm.invoice_number.trim() || !invoiceForm.performance_date || !invoiceForm.issue_date || !invoiceForm.due_date)) {
      toast({ title: 'Vystavená faktura vyžaduje číslo a všechna data', description: 'Doplňte datum plnění, vystavení a splatnosti.', variant: 'destructive' });
      return;
    }
    if (isIssued && invoiceForm.document_required && !invoiceFile && !invoiceForm.document_url) {
      toast({ title: 'Nahrajte doklad faktury', description: 'Vystavenou fakturu nelze uložit bez souboru nebo ověřitelného odkazu.', variant: 'destructive' });
      return;
    }
    if (paid > grossPreview + 0.01 && invoiceForm.invoice_kind !== 'credit_note') {
      toast({ title: 'Uhrazená částka je vyšší než faktura', variant: 'destructive' });
      return;
    }
    if (invoiceForm.status === 'partially_paid' && (paid <= 0 || paid >= grossPreview)) {
      toast({ title: 'Částečná úhrada není zadaná správně', description: 'Musí být vyšší než nula a nižší než celková částka faktury.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    let storedDocument = null;
    try {
      if (invoiceFile) {
        storedDocument = await uploadInvoiceDocument({
          file: invoiceFile,
          recordId: editingInvoiceId || globalThis.crypto.randomUUID(),
          projectReference: entityCode || null,
          category: 'odberatelska-faktura',
          accessEntityType: entityType,
          accessEntityId: entityId,
        });
      }
      const payload = {
        entity_type: entityType,
        project_id: entityType === 'project' ? entityId : null,
        realization_id: entityType === 'realization' ? entityId : null,
        milestone_id: invoiceForm.milestone_id || null,
        invoice_number: invoiceForm.invoice_number.trim() || null,
        invoice_kind: invoiceForm.invoice_kind, status: invoiceForm.status,
        performance_date: invoiceForm.performance_date || null,
        issue_date: invoiceForm.issue_date || null, due_date: invoiceForm.due_date || null,
        paid_date: invoiceForm.paid_date || null,
        amount_excl_vat: amount, vat_rate: Number(invoiceForm.vat_rate || 0),
        paid_amount: invoiceForm.status === 'paid' ? grossPreview : paid,
        note: invoiceForm.note.trim() || null,
        document_url: storedDocument?.dbUrl || storedDocument?.webUrl || invoiceForm.document_url.trim() || null,
        document_file_name: storedDocument?.fileName || invoiceForm.document_file_name || null,
        document_uploaded_at: storedDocument ? new Date().toISOString() : undefined,
        document_required: invoiceForm.document_required,
      };
      if (!payload.document_uploaded_at) delete payload.document_uploaded_at;
      const query = editingInvoiceId
        ? supabase.from('entity_billing_entries').update(payload).eq('id', editingInvoiceId)
        : supabase.from('entity_billing_entries').insert(payload);
      const { error } = await query;
      if (error) throw error;
      setInvoiceDialogOpen(false);
      toast({ title: editingInvoiceId ? 'Fakturace aktualizována' : 'Faktura přidána' });
      await load();
    } catch (error) {
      if (storedDocument?.cleanup) await storedDocument.cleanup().catch(() => null);
      toast({ title: 'Fakturu se nepodařilo uložit', description: getFinanceErrorMessage(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const removeInvoice = async (entry) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('entity_billing_entries').delete().eq('id', entry.id);
      if (error) throw error;
      await load();
      setConfirmAction(null);
    } catch (error) {
      toast({ title: 'Fakturu se nepodařilo odstranit', description: getFinanceErrorMessage(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openInvoiceDocument = async (entry) => {
    const result = await downloadInvoiceFromStorage(entry.document_url);
    if (!result.success) {
      toast({ title: 'Doklad se nepodařilo otevřít', description: result.error, variant: 'destructive' });
    }
  };

  const removeMilestone = async (milestone) => {
    if (linkedMilestoneIds.has(milestone.id)) {
      toast({ title: 'Etapa už má navázanou fakturu', description: 'Nejdříve stornujte nebo odpojte navázanou fakturu.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('entity_billing_milestones').delete().eq('id', milestone.id);
      if (error) throw error;
      await load();
      setConfirmAction(null);
    } catch (error) {
      toast({ title: 'Etapu se nepodařilo odstranit', description: getFinanceErrorMessage(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-lg border bg-white p-5 text-sm text-slate-500">Načítám fakturaci…</div>;

  const healthy = summary?.status === 'fully_paid' && !summary?.missing_document_count && !summary?.overdue_milestone_count;
  const planDiff = Number(summary?.plan_variance || 0);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-700" />
            <h3 className="text-base font-semibold text-slate-950">Fakturační plán a úhrady</h3>
            <Badge variant={healthy ? 'success' : 'secondary'}>{coverageLabels[summary?.status] || summary?.status}</Badge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
            Plán fakturace, skutečně vystavené doklady a přijaté úhrady jsou vedené odděleně.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openCreateInvoice()}><Plus className="mr-2 h-4 w-4" />Přidat fakturu</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="mr-2 h-4 w-4" />Plán</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setPlanDialogOpen(true)}><CalendarDays className="mr-2 h-4 w-4" />Rozdělit do etap</DropdownMenuItem>
              <DropdownMenuItem onSelect={openCreateMilestone}><Plus className="mr-2 h-4 w-4" />Přidat jednu etapu</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {enableContractAnalysis && (
        <details className="group rounded-lg border border-blue-100 bg-blue-50/30" open={Boolean(summary?.warning)}>
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-blue-900 marker:hidden">
            AI kontrola smlouvy <span className="font-normal text-blue-700">· návrh vyžaduje schválení administrátorem</span>
          </summary>
          <div className="border-t border-blue-100 p-3"><ContractExtractionPanel entityType={entityType} entityId={entityId} onApplied={load} /></div>
        </details>
      )}

      {summary?.warning && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Zakázka vyžaduje finanční kontrolu</AlertTitle>
          <AlertDescription>{summary.warning_message} Výplata nad krytý limit vyžaduje kontrolu administrátora.</AlertDescription>
        </Alert>
      )}

      {showFinancialSummary && (
        <>
          <FinanceMetricStrip metrics={[
            { label: 'Hodnota zakázky s DPH', value: money(summary?.contract_amount), tone: 'neutral' },
            { label: 'Plán fakturace s DPH', value: money(summary?.planned_amount), detail: planDiff === 0 ? 'Plán odpovídá zakázce' : `Odchylka ${money(planDiff)}`, tone: planDiff === 0 ? 'plan' : 'warning' },
            { label: 'Vystaveno s DPH', value: money(summary?.invoiced_amount), detail: percent(summary?.invoice_coverage_percent), tone: 'plan' },
            { label: 'Uhrazeno', value: money(summary?.paid_amount), detail: percent(summary?.payment_coverage_percent), tone: 'positive' },
            { label: 'Zbývá uhradit', value: money(Math.max(0, Number(summary?.contract_amount || 0) - Number(summary?.paid_amount || 0))), tone: Number(summary?.overdue_milestone_count || 0) ? 'warning' : 'neutral' },
          ]} className="2xl:grid-cols-5" />

          <FinanceStageFlow stages={[
            { label: 'Hodnota zakázky', value: summary?.contract_amount, barClassName: 'bg-slate-500' },
            { label: 'Naplánováno', value: summary?.planned_amount, barClassName: 'bg-blue-500' },
            { label: 'Vystaveno', value: summary?.invoiced_amount, barClassName: 'bg-indigo-500' },
            { label: 'Uhrazeno', value: summary?.paid_amount, barClassName: 'bg-emerald-500' },
          ]} />
        </>
      )}
      <FinanceDefinitionNote>Dostupnost výplat se počítá ze skutečně uhrazených faktur. Plánovaná ani pouze vystavená částka sama o sobě nezvyšuje limit pro výplatu.</FinanceDefinitionNote>

      <Tabs defaultValue="milestones" className="space-y-3">
        <TabsList className="h-9 w-full justify-start rounded-md bg-slate-100 p-1 sm:w-auto">
          <TabsTrigger value="milestones" className="h-7 text-xs">Plán plnění ({milestones.length})</TabsTrigger>
          <TabsTrigger value="invoices" className="h-7 text-xs">Faktury ({entries.length})</TabsTrigger>
        </TabsList>
      <TabsContent value="milestones" className="space-y-2">
        <div className="flex items-center justify-between">
          <div><h4 className="text-sm font-semibold text-slate-900">Plán dílčích plnění</h4><p className="text-xs text-slate-500">{milestones.length} etap, {summary?.overdue_milestone_count || 0} po termínu</p></div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table className="finance-table min-w-[1040px]">
            <TableHeader><TableRow>
              <TableHead className="w-16">#</TableHead><TableHead>Etapa</TableHead><TableHead>Termín plnění</TableHead>
              <TableHead>Plán vystavení</TableHead><TableHead>Splatnost</TableHead><TableHead>Stav</TableHead>
              <TableHead className="text-right">Podíl</TableHead><TableHead className="text-right">Celkem</TableHead><TableHead className="w-32 text-right">Akce</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {milestones.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center text-slate-500">Fakturační etapy zatím nejsou naplánované.</TableCell></TableRow>
              ) : milestones.map((milestone) => {
                const isLinked = linkedMilestoneIds.has(milestone.id);
                return <TableRow key={milestone.id}>
                  <TableCell className="font-medium">{milestone.installment_number}</TableCell>
                  <TableCell><div className="font-medium text-slate-900">{milestone.name}</div>{milestone.note && <div className="max-w-[280px] truncate text-xs text-slate-500">{milestone.note}</div>}</TableCell>
                  <TableCell>{localDate(milestone.performance_date)}</TableCell><TableCell>{localDate(milestone.planned_issue_date)}</TableCell>
                  <TableCell>{localDate(milestone.due_date)}</TableCell>
                  <TableCell><Badge variant={milestone.status === 'completed' ? 'success' : milestone.status === 'overdue' ? 'destructive' : 'secondary'}>{milestoneStatusLabels[milestone.status] || milestone.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{milestone.percent_of_contract == null ? '—' : percent(milestone.percent_of_contract)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(milestone.amount_incl_vat)}</TableCell>
                  <TableCell><div className="flex justify-end gap-1">
                    {!isLinked && milestone.status !== 'cancelled' && <Button variant="ghost" size="icon" title="Vytvořit fakturu" onClick={() => openCreateInvoice(milestone)}><Receipt className="h-4 w-4 text-blue-700" /></Button>}
                    <Button variant="ghost" size="icon" title="Upravit etapu" onClick={() => openEditMilestone(milestone)}><Edit2 className="h-4 w-4" /></Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={linkedMilestoneIds.has(milestone.id) ? 'Etapa má navázanou fakturu' : 'Odstranit etapu'}
                      aria-label={`Odstranit etapu ${milestone.name}`}
                      disabled={linkedMilestoneIds.has(milestone.id)}
                      onClick={() => setConfirmAction({ type: 'milestone', item: milestone })}
                    ><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                  </div></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="invoices" className="space-y-2">
        <div><h4 className="text-sm font-semibold text-slate-900">Vystavené faktury</h4><p className="text-xs text-slate-500">Doklad je povinný pro každou nově vystavenou fakturu.</p></div>
        <div className="overflow-x-auto rounded-md border">
          <Table className="finance-table min-w-[1120px]">
            <TableHeader><TableRow>
              <TableHead>Číslo</TableHead><TableHead>Etapa</TableHead><TableHead>Typ</TableHead><TableHead>Plnění</TableHead>
              <TableHead>Vystaveno</TableHead><TableHead>Splatnost</TableHead><TableHead>Doklad</TableHead><TableHead>Stav</TableHead>
              <TableHead className="text-right">Celkem</TableHead><TableHead className="text-right">Uhrazeno</TableHead><TableHead className="w-24 text-right">Akce</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="h-24 text-center text-slate-500">Žádná skutečná faktura zatím není evidována.</TableCell></TableRow>
              ) : entries.map((entry) => {
                const milestone = milestoneById.get(entry.milestone_id);
                const hasDocument = Boolean(entry.document_url);
                return <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.invoice_number || 'Bez čísla'}</TableCell>
                  <TableCell>{milestone ? `${milestone.installment_number}. ${milestone.name}` : 'Mimo plán'}</TableCell>
                  <TableCell>{kindLabels[entry.invoice_kind]}</TableCell><TableCell>{localDate(entry.performance_date)}</TableCell>
                  <TableCell>{localDate(entry.issue_date)}</TableCell><TableCell>{localDate(entry.due_date)}</TableCell>
                  <TableCell>{hasDocument ? <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openInvoiceDocument(entry)}><ExternalLink className="mr-1 h-3.5 w-3.5" />{entry.document_file_name || 'Otevřít'}</Button> : <Badge variant="destructive">Chybí doklad</Badge>}</TableCell>
                  <TableCell><Badge variant={entry.status === 'paid' ? 'success' : entry.status === 'overdue' ? 'destructive' : 'secondary'}>{statusLabels[entry.status]}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{money(entry.amount_incl_vat)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(entry.paid_amount)}</TableCell>
                  <TableCell><div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditInvoice(entry)}><Edit2 className="h-4 w-4" /><span className="sr-only">Upravit</span></Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmAction({ type: 'invoice', item: entry })}
                    ><Trash2 className="h-4 w-4 text-rose-600" /><span className="sr-only">Odstranit</span></Button>
                  </div></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
      </Tabs>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Rozdělit zbývající hodnotu do etap</DialogTitle><DialogDescription>Etapy se vytvoří rovnoměrně. Každou částku i termín lze následně upravit.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Počet etap</Label><Input type="number" min="1" max="24" value={planForm.count} onChange={(e) => setPlanForm((p) => ({ ...p, count: e.target.value }))} /></div>
            <div className="space-y-2"><Label>První termín plnění</Label><Input type="date" value={planForm.first_date} onChange={(e) => setPlanForm((p) => ({ ...p, first_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Rozestup etap (dnů)</Label><Input type="number" min="1" value={planForm.interval_days} onChange={(e) => setPlanForm((p) => ({ ...p, interval_days: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Sazba DPH</Label><Select value={planForm.vat_rate} onValueChange={(v) => setPlanForm((p) => ({ ...p, vat_rate: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VAT_RATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="rounded-md border bg-slate-50 p-3 sm:col-span-2"><div className="text-xs text-slate-500">Zbývá naplánovat</div><div className="text-lg font-semibold">{money(Math.max(0, Number(summary?.contract_amount || 0) - Number(summary?.planned_amount || 0)))}</div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Zrušit</Button><Button onClick={createEqualPlan} disabled={saving}>{saving ? 'Vytvářím…' : 'Vytvořit etapy'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={milestoneDialogOpen} onOpenChange={setMilestoneDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" />{editingMilestoneId ? 'Upravit fakturační etapu' : 'Přidat fakturační etapu'}</DialogTitle><DialogDescription>Plánovaný termín a hodnota dílčího plnění.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Pořadí</Label><Input type="number" min="1" value={milestoneForm.installment_number} onChange={(e) => setMilestoneForm((p) => ({ ...p, installment_number: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Název etapy</Label><Input value={milestoneForm.name} onChange={(e) => setMilestoneForm((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Termín plnění</Label><Input type="date" value={milestoneForm.performance_date} onChange={(e) => setMilestoneForm((p) => ({ ...p, performance_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Plánované vystavení</Label><Input type="date" value={milestoneForm.planned_issue_date} onChange={(e) => setMilestoneForm((p) => ({ ...p, planned_issue_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Plánovaná splatnost</Label><Input type="date" value={milestoneForm.due_date} onChange={(e) => setMilestoneForm((p) => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Stav</Label><Select value={milestoneForm.status} onValueChange={(v) => setMilestoneForm((p) => ({ ...p, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(milestoneStatusLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Částka bez DPH</Label><Input type="number" min="0" step="0.01" value={milestoneForm.amount_excl_vat} onChange={(e) => setMilestoneForm((p) => ({ ...p, amount_excl_vat: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Sazba DPH</Label><Select value={milestoneForm.vat_rate} onValueChange={(v) => setMilestoneForm((p) => ({ ...p, vat_rate: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VAT_RATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Podíl zakázky (%)</Label><Input type="number" min="0" max="100" step="0.001" value={milestoneForm.percent_of_contract} onChange={(e) => setMilestoneForm((p) => ({ ...p, percent_of_contract: e.target.value }))} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Poznámka / podmínka plnění</Label><Textarea rows={3} value={milestoneForm.note} onChange={(e) => setMilestoneForm((p) => ({ ...p, note: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMilestoneDialogOpen(false)}>Zrušit</Button><Button onClick={saveMilestone} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit etapu'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{editingInvoiceId ? 'Upravit fakturu' : 'Přidat fakturu'}</DialogTitle><DialogDescription>Skutečný daňový doklad, jeho plnění, splatnost a úhrada. Pro vystavenou fakturu je povinný soubor nebo ověřitelný odkaz.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2"><Label>Fakturační etapa</Label><Select value={invoiceForm.milestone_id || 'none'} onValueChange={(v) => setInvoiceForm((p) => ({ ...p, milestone_id: v === 'none' ? '' : v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Mimo plán</SelectItem>{milestones.filter((m) => m.status !== 'cancelled' && (!linkedMilestoneIds.has(m.id) || m.id === invoiceForm.milestone_id)).map((m) => <SelectItem key={m.id} value={m.id}>{m.installment_number}. {m.name} · {money(m.amount_incl_vat)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Číslo faktury</Label><Input value={invoiceForm.invoice_number} onChange={(e) => setInvoiceForm((p) => ({ ...p, invoice_number: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Typ faktury</Label><Select value={invoiceForm.invoice_kind} onValueChange={(v) => setInvoiceForm((p) => ({ ...p, invoice_kind: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kindLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Stav</Label><Select value={invoiceForm.status} onValueChange={(v) => setInvoiceForm((p) => ({ ...p, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Datum plnění (DUZP)</Label><Input type="date" value={invoiceForm.performance_date} onChange={(e) => setInvoiceForm((p) => ({ ...p, performance_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Datum vystavení</Label><Input type="date" value={invoiceForm.issue_date} onChange={(e) => setInvoiceForm((p) => ({ ...p, issue_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Datum splatnosti</Label><Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((p) => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Datum úhrady</Label><Input type="date" value={invoiceForm.paid_date} onChange={(e) => setInvoiceForm((p) => ({ ...p, paid_date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Částka bez DPH</Label><Input type="number" min="0" step="0.01" value={invoiceForm.amount_excl_vat} onChange={(e) => setInvoiceForm((p) => ({ ...p, amount_excl_vat: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Sazba DPH</Label><Select value={invoiceForm.vat_rate} onValueChange={(v) => setInvoiceForm((p) => ({ ...p, vat_rate: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VAT_RATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Celkem s DPH</Label><Input value={money(grossPreview)} disabled /></div>
            <div className="space-y-2"><Label>Uhrazená částka</Label><Input type="number" min="0" step="0.01" value={invoiceForm.paid_amount} onChange={(e) => setInvoiceForm((p) => ({ ...p, paid_amount: e.target.value }))} /></div>
            <div className="space-y-2 rounded-md border border-dashed p-3 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="billing-invoice-file" className="flex items-center gap-2"><Upload className="h-4 w-4" />Soubor faktury</Label>
              <Input id="billing-invoice-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-slate-500">{invoiceFile?.name || invoiceForm.document_file_name || (invoiceForm.document_url ? 'Je uložen odkaz na doklad.' : 'Pro vystavenou fakturu je doklad povinný.')}</p>
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label className="flex items-center gap-2"><Link2 className="h-4 w-4" />Externí odkaz na fakturu</Label><Input type="url" value={invoiceForm.document_url} onChange={(e) => setInvoiceForm((p) => ({ ...p, document_url: e.target.value }))} placeholder="https://…" /></div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label>Poznámka</Label><Textarea rows={3} value={invoiceForm.note} onChange={(e) => setInvoiceForm((p) => ({ ...p, note: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setInvoiceDialogOpen(false)}>Zrušit</Button><Button onClick={saveInvoice} disabled={saving}>{saving ? 'Ukládám…' : <><CheckCircle2 className="mr-2 h-4 w-4" />Uložit fakturu</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={confirmAction?.type === 'invoice' ? 'Odstranit evidenci faktury?' : 'Odstranit fakturační etapu?'}
        description={confirmAction?.type === 'invoice'
          ? `Faktura ${confirmAction?.item?.invoice_number || 'bez čísla'} bude odebrána. Změna zůstane v auditní historii.`
          : `Etapa „${confirmAction?.item?.name || ''}“ bude trvale odstraněna.`}
        confirmLabel="Odstranit"
        destructive
        loading={saving}
        onConfirm={() => {
          if (confirmAction?.type === 'invoice') removeInvoice(confirmAction.item);
          if (confirmAction?.type === 'milestone') removeMilestone(confirmAction.item);
        }}
      />
    </section>
  );
};

export default BillingTracker;
