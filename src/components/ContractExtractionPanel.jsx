import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Sparkles, Upload, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import {
  applyContractExtraction,
  listContractExtractions,
  rejectContractExtraction,
  setContractMilestoneAccepted,
  uploadAndAnalyzeContract,
} from '@/lib/contractExtractionService';

const money = (value, currency = 'CZK') => value == null ? 'Neuvedeno' : new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency: currency || 'CZK', maximumFractionDigits: 0,
}).format(Number(value));
const date = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('cs-CZ') : 'Neuvedeno';
const confidence = (value) => `${Math.round(Number(value || 0) * 100)} %`;

const ContractExtractionPanel = ({ entityType, entityId, onApplied }) => {
  const { toast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [updateContractValue, setUpdateContractValue] = useState(true);
  const [createBillingMilestones, setCreateBillingMilestones] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const loadedJobs = await listContractExtractions({ entityType, entityId });
      setJobs(loadedJobs);
      setSelectedJobId((current) => loadedJobs.some((job) => job.id === current) ? current : loadedJobs[0]?.id || null);
    } catch (error) {
      if (!['42P01', 'PGRST205'].includes(error?.code)) {
        toast({ title: 'AI návrhy se nepodařilo načíst', description: error.message, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, toast]);

  useEffect(() => { load(); }, [load]);
  const latest = jobs.find((job) => job.id === selectedJobId) || jobs[0] || null;
  const extracted = latest?.extracted_data || {};
  const milestones = useMemo(
    () => [...(latest?.contract_extraction_milestones || [])].sort((a, b) => a.sequence_number - b.sequence_number),
    [latest],
  );

  const analyze = async () => {
    if (!file) return;
    try {
      setAnalyzing(true);
      const result = await uploadAndAnalyzeContract({ entityType, entityId, file });
      setFile(null);
      await load();
      if (result?.extractionId) setSelectedJobId(result.extractionId);
      toast(result?.duplicate
        ? { title: 'Tato smlouva už byla analyzována', description: 'Zobrazuji existující návrh bez dalšího placeného AI zpracování.' }
        : { title: 'Smlouva byla analyzována', description: 'Zkontrolujte navrženou hodnotu a fakturační etapy.' });
    } catch (error) {
      toast({ title: 'Analýza smlouvy selhala', description: error.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleMilestone = async (milestone, checked) => {
    try {
      await setContractMilestoneAccepted(milestone.id, checked);
      setJobs((current) => current.map((job) => job.id !== latest.id ? job : ({
        ...job,
        contract_extraction_milestones: job.contract_extraction_milestones.map((item) => (
          item.id === milestone.id ? { ...item, accepted: checked } : item
        )),
      })));
    } catch (error) {
      toast({ title: 'Výběr etapy se nepodařilo uložit', description: error.message, variant: 'destructive' });
    }
  };

  const apply = async () => {
    if (createBillingMilestones && milestones.every((item) => !item.accepted)) {
      toast({ title: 'Není vybraná žádná etapa', description: 'Vyberte alespoň jednu etapu, nebo vypněte vytvoření fakturačních etap.', variant: 'destructive' });
      return;
    }
    try {
      setApplying(true);
      await applyContractExtraction({
        extractionId: latest.id,
        updateContractValue,
        createBillingMilestones,
      });
      await load();
      await onApplied?.();
      toast({ title: 'Údaje ze smlouvy byly doplněny', description: 'Změna je zapsaná v auditní historii.' });
    } catch (error) {
      toast({ title: 'Návrh se nepodařilo použít', description: error.message, variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const reject = async () => {
    if (rejectionReason.trim().length < 3) return;
    try {
      setRejecting(true);
      await rejectContractExtraction({ extractionId: latest.id, reason: rejectionReason.trim() });
      setRejectDialogOpen(false);
      setRejectionReason('');
      await load();
      toast({ title: 'AI návrh byl zamítnut', description: 'Důvod je uložený v auditní historii.' });
    } catch (error) {
      toast({ title: 'Návrh se nepodařilo zamítnout', description: error.message, variant: 'destructive' });
    } finally {
      setRejecting(false);
    }
  };

  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="rounded-md bg-blue-100 p-2 text-blue-700"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h4 className="text-sm font-semibold text-slate-950">AI kontrola smlouvy</h4>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-slate-600">
              Originál se uloží do SharePointu. AI připraví pouze návrh ceny, splatnosti a platebních etap; finance se změní až po kontrole administrátorem.
            </p>
          </div>
        </div>
        <div className="flex min-w-[280px] flex-1 items-center justify-end gap-2 sm:flex-initial">
          <Input
            className="h-9 max-w-sm bg-white text-xs"
            type="file"
            accept=".pdf,.doc,.docx,.txt,image/png,image/jpeg,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <Button size="sm" onClick={analyze} disabled={!file || analyzing}>
            {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {analyzing ? 'Analyzuji…' : 'Vyčíst smlouvu'}
          </Button>
        </div>
      </div>

      {loading && <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Načítám návrhy…</div>}
      {!loading && !latest && <div className="mt-4 rounded-md border border-dashed bg-white px-3 py-4 text-center text-xs text-slate-500">Zatím nebyla analyzována žádná smlouva.</div>}

      {latest && (
        <div className="mt-4 space-y-3">
          {jobs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 text-xs">
              <span className="font-medium text-slate-700">Historie analýz:</span>
              {jobs.slice(0, 6).map((job, index) => (
                <Button
                  key={job.id}
                  type="button"
                  size="sm"
                  variant={job.id === latest.id ? 'secondary' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedJobId(job.id)}
                >
                  {index === 0 ? 'Nejnovější' : new Date(job.created_at).toLocaleDateString('cs-CZ')}
                  <span className="ml-1 text-slate-500">{job.status === 'approved' ? 'schváleno' : job.status === 'rejected' ? 'zamítnuto' : job.status === 'review' ? 'kontrola' : job.status}</span>
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={latest.status === 'approved' ? 'success' : ['failed', 'rejected'].includes(latest.status) ? 'destructive' : 'secondary'}>
              {latest.status === 'review' ? 'Ke kontrole' : latest.status === 'approved' ? 'Schváleno' : latest.status === 'rejected' ? 'Zamítnuto' : latest.status === 'failed' ? 'Chyba' : 'Zpracování'}
            </Badge>
            <span className="font-medium text-slate-800">{latest.source_file_name}</span>
            <span className="text-slate-500">Spolehlivost {confidence(latest.confidence)}</span>
            {latest.source_web_url && <a className="inline-flex items-center gap-1 text-blue-700 hover:underline" href={latest.source_web_url} target="_blank" rel="noreferrer">Originál <ExternalLink className="h-3 w-3" /></a>}
          </div>

          {latest.status === 'failed' && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Analýza selhala</AlertTitle><AlertDescription>{latest.error_message}</AlertDescription></Alert>}
          {latest.status === 'rejected' && <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertTitle>Návrh byl zamítnut</AlertTitle><AlertDescription>{latest.review_note || latest.error_message}</AlertDescription></Alert>}
          {(latest.warnings || []).length > 0 && <Alert className="border-amber-200 bg-amber-50 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>Vyžaduje kontrolu</AlertTitle><AlertDescription><ul className="mt-1 list-disc pl-4">{latest.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></AlertDescription></Alert>}

          {['review', 'approved'].includes(latest.status) && (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['Cena bez DPH', money(extracted.contract_value_excl_vat, extracted.currency)],
                  ['DPH', extracted.vat_rate == null ? 'Neuvedeno' : `${extracted.vat_rate} %`],
                  ['Cena s DPH', money(extracted.contract_value_incl_vat, extracted.currency)],
                  ['Splatnost', extracted.payment_terms_days == null ? 'Neuvedeno' : `${extracted.payment_terms_days} dní`],
                  ['Dokončení', date(extracted.completion_date)],
                ].map(([label, value]) => <div key={label} className="rounded-md border bg-white px-3 py-2"><div className="text-[11px] font-medium uppercase text-slate-500">{label}</div><div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div></div>)}
              </div>

              <div className="overflow-x-auto rounded-md border bg-white">
                <Table className="min-w-[980px] text-xs">
                  <TableHeader><TableRow><TableHead className="w-12">Použít</TableHead><TableHead>#</TableHead><TableHead>Platební etapa</TableHead><TableHead>Podmínka</TableHead><TableHead>Termín</TableHead><TableHead>Splatnost</TableHead><TableHead className="text-right">Podíl</TableHead><TableHead className="text-right">Bez DPH</TableHead><TableHead>Důkaz</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {milestones.length === 0 ? <TableRow><TableCell colSpan={9} className="h-16 text-center text-slate-500">Ve smlouvě nebyl nalezen platební plán.</TableCell></TableRow> : milestones.map((milestone) => <TableRow key={milestone.id}>
                      <TableCell><Checkbox checked={milestone.accepted} disabled={latest.status !== 'review'} onCheckedChange={(checked) => toggleMilestone(milestone, Boolean(checked))} /></TableCell>
                      <TableCell>{milestone.sequence_number}</TableCell><TableCell className="font-medium">{milestone.name}</TableCell>
                      <TableCell className="max-w-[220px] whitespace-normal">{milestone.condition_text || '—'}</TableCell>
                      <TableCell>{date(milestone.performance_date)}</TableCell><TableCell>{milestone.due_days == null ? date(milestone.due_date) : `${milestone.due_days} dní`}</TableCell>
                      <TableCell className="text-right">{milestone.percent_of_contract == null ? '—' : `${milestone.percent_of_contract} %`}</TableCell>
                      <TableCell className="text-right font-medium">{money(milestone.amount_excl_vat, extracted.currency)}</TableCell>
                      <TableCell className="max-w-[280px] whitespace-normal text-slate-500">{milestone.evidence || 'Bez citace'} <span className="whitespace-nowrap">({confidence(milestone.confidence)})</span></TableCell>
                    </TableRow>)}
                  </TableBody>
                </Table>
              </div>

              {latest.status === 'review' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white p-3">
                <div className="flex flex-wrap gap-5">
                  <Label className="flex items-center gap-2 text-xs"><Checkbox checked={updateContractValue} onCheckedChange={(checked) => setUpdateContractValue(Boolean(checked))} />Aktualizovat hodnotu zakázky</Label>
                  <Label className="flex items-center gap-2 text-xs"><Checkbox checked={createBillingMilestones} onCheckedChange={(checked) => setCreateBillingMilestones(Boolean(checked))} />Vytvořit vybrané fakturační etapy</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setRejectDialogOpen(true)}>
                    <XCircle className="mr-2 h-4 w-4" />Zamítnout
                  </Button>
                  <Button size="sm" onClick={apply} disabled={applying || (!updateContractValue && !createBillingMilestones)}>{applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Schválit a doplnit</Button>
                </div>
              </div>}
            </>
          )}
        </div>
      )}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Zamítnout vytěžený návrh?</AlertDialogTitle>
            <AlertDialogDescription>
              Do projektu ani realizace se nic nepřenese. Návrh a důvod zamítnutí zůstanou dohledatelné v auditu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="contract-rejection-reason">Důvod zamítnutí</Label>
            <Input
              id="contract-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Např. dodatek neobsahuje úplný platební plán"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejecting}>Zpět</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={rejecting || rejectionReason.trim().length < 3}
              onClick={(event) => { event.preventDefault(); reject(); }}
            >
              {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Zamítnout návrh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default ContractExtractionPanel;
