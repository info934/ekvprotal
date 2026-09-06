import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Download, Eye, FileClock, Loader2, Mail, Send, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { formatMoney } from '@/lib/financePresentation';
import {
  commercialDocumentEmailDefaults,
  compareCommercialDocumentVersions,
  downloadCommercialDocumentVersion,
  fetchCommercialDocumentHistory,
  parseCommercialDocumentRecipients,
  previewCommercialDocumentPdf,
  sendCommercialDocument,
} from '@/lib/crmCommercialDocumentDelivery';

const formatDateTime = (value) => value ? new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value)) : '-';

const deliveryTone = {
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-rose-200 bg-rose-50 text-rose-800',
  failed: 'border-rose-200 bg-rose-50 text-rose-800',
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
};

const deliveryLabel = {
  sent: 'Odesláno', accepted: 'Přijato', rejected: 'Odmítnuto', failed: 'Chyba', pending: 'Odesílá se',
};

const CRMCommercialDocumentDelivery = ({
  document,
  template,
  open,
  onOpenChange,
  canSend,
  onSent,
}) => {
  const { toast } = useToast();
  const [history, setHistory] = useState({ versions: [], deliveries: [], events: [], activities: [], notes: [] });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const [draft, setDraft] = useState(() => commercialDocumentEmailDefaults(document));
  const [customRecipientConfirmed, setCustomRecipientConfirmed] = useState(false);

  const refreshHistory = useCallback(async () => {
    if (!document?.id) return;
    setHistoryLoading(true);
    try {
      setHistory(await fetchCommercialDocumentHistory(document.id, document.opportunity_id));
    } catch (error) {
      if (!String(error?.message || '').includes('does not exist')) console.error(error);
    } finally {
      setHistoryLoading(false);
    }
  }, [document?.id]);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);
  useEffect(() => {
    if (!open) return;
    setDraft(commercialDocumentEmailDefaults(document));
    setCustomRecipientConfirmed(false);
  }, [document, open]);

  const clientEmail = String(document?.subject?.email || document?.opportunity?.subject?.email || '').toLowerCase();
  const hasForeignRecipient = useMemo(() => parseCommercialDocumentRecipients(draft.recipients)
    .some((email) => email !== clientEmail), [clientEmail, draft.recipients]);

  const comparisons = useMemo(() => history.versions.map((version, index) => ({
    version,
    comparison: history.versions[index + 1] ? compareCommercialDocumentVersions(version, history.versions[index + 1]) : null,
  })), [history.versions]);

  const handleSend = async () => {
    if (hasForeignRecipient && !customRecipientConfirmed) return;
    setSending(true);
    try {
      const result = await sendCommercialDocument({
        document, template, ...draft, customRecipientConfirmed,
      });
      toast({
        title: `${document.type === 'offer' ? 'Nabídka' : 'Objednávka'} byla odeslána`,
        description: `Uložena verze V${result.version?.version_number || ''} a záznam doručení.`,
      });
      onOpenChange(false);
      await refreshHistory();
      await onSent?.(result);
    } catch (error) {
      toast({ title: 'Odeslání se nepodařilo', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleDownload = async (version) => {
    setDownloadingId(version.id);
    try {
      await downloadCommercialDocumentVersion(version);
    } catch (error) {
      toast({ title: 'Verzi se nepodařilo stáhnout', description: error.message, variant: 'destructive' });
    } finally {
      setDownloadingId('');
    }
  };

  return <>
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Odeslat klientovi</DialogTitle>
          <DialogDescription>Portál vytvoří neměnnou PDF verzi, připojí ji k e-mailu a uloží doručení do historie.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2"><Label htmlFor="crm-email-to">Příjemce</Label><Input id="crm-email-to" value={draft.recipients} onChange={(event) => setDraft((current) => ({ ...current, recipients: event.target.value }))} placeholder="klient@firma.cz" /></div>
          <div className="space-y-2"><Label htmlFor="crm-email-cc">Kopie</Label><Input id="crm-email-cc" value={draft.ccRecipients} onChange={(event) => setDraft((current) => ({ ...current, ccRecipients: event.target.value }))} placeholder="volitelné adresy oddělené čárkou" /></div>
          <div className="space-y-2"><Label htmlFor="crm-email-subject">Předmět</Label><Input id="crm-email-subject" value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} /></div>
          <div className="space-y-2"><Label htmlFor="crm-email-message">Zpráva</Label><Textarea id="crm-email-message" rows={8} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} /></div>
          {hasForeignRecipient && <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Checkbox id="confirm-custom-recipient" checked={customRecipientConfirmed} onCheckedChange={(value) => setCustomRecipientConfirmed(value === true)} />
            <div><Label htmlFor="confirm-custom-recipient" className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-700" />Potvrzuji jinou adresu</Label><p className="mt-1 text-xs text-amber-800">Příjemce se liší od kontaktu uloženého u klienta ({clientEmail || 'kontakt chybí'}). Tato volba se uloží do auditu.</p></div>
          </div>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => previewCommercialDocumentPdf({ document, template })} disabled={sending}><Eye className="mr-2 h-4 w-4" />Náhled PDF</Button>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Zrušit</Button><Button type="button" onClick={handleSend} disabled={sending || !canSend || !draft.subject.trim() || !draft.message.trim() || (hasForeignRecipient && !customRecipientConfirmed)}>{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Odeslat</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Card className="crm-panel">
      <CardHeader className="crm-panel-header">
        <div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><FileClock className="h-4 w-4 text-primary" />Verze a komunikace</CardTitle><CardDescription>Neměnné PDF verze, doručení a odpovědi klienta.</CardDescription></div>{historyLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}</div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {comparisons.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"><Mail className="mx-auto mb-2 h-5 w-5" />Zatím nebyla odeslána žádná verze.</div> : comparisons.map(({ version, comparison }) => {
          const delivery = history.deliveries.find((item) => item.version_id === version.id);
          return <div key={version.id} className="rounded-lg border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong>Verze V{version.version_number}</strong>{delivery && <Badge variant="outline" className={deliveryTone[delivery.status]}>{deliveryLabel[delivery.status] || delivery.status}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(version.created_at)} · {version.file_name}</p></div><Button size="sm" variant="outline" onClick={() => handleDownload(version)} disabled={downloadingId === version.id}>{downloadingId === version.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}PDF</Button></div>
            {delivery && <p className="mt-2 text-xs text-slate-600">Komu: {(delivery.recipients || []).join(', ')}{delivery.cc_recipients?.length ? ` · kopie: ${delivery.cc_recipients.join(', ')}` : ''}</p>}
            {comparison && <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="secondary">Rozdíl {formatMoney(comparison.totalDelta)}</Badge><Badge variant="secondary">+{comparison.added} / -{comparison.removed} položek</Badge>{comparison.changed > 0 && <Badge variant="secondary">{comparison.changed} změněno</Badge>}</div>}
          </div>;
        })}
        {history.events.length > 0 && <div className="border-t pt-4"><h3 className="mb-3 text-sm font-semibold">Časová osa</h3><div className="space-y-3">{history.events.slice(0, 8).map((event) => <div key={event.id} className="flex gap-3 text-sm">{event.event_type.includes('reject') ? <XCircle className="mt-0.5 h-4 w-4 text-rose-600" /> : event.event_type.includes('accept') ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Clock3 className="mt-0.5 h-4 w-4 text-blue-600" />}<div><p className="font-medium">{event.summary}</p><p className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</p></div></div>)}</div></div>}
        {(history.activities.length > 0 || history.notes.length > 0) && <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
          <div><h3 className="mb-3 text-sm font-semibold">Úkoly a schůzky</h3>{history.activities.length ? <div className="space-y-2">{history.activities.slice(0, 6).map((activity) => <div key={activity.id} className="rounded-md bg-slate-50 p-2 text-sm"><div className="flex justify-between gap-2"><strong>{activity.title}</strong><Badge variant="outline">{activity.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{activity.type}{activity.due_at ? ` · ${formatDateTime(activity.due_at)}` : ''}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Bez navazujících aktivit.</p>}</div>
          <div><h3 className="mb-3 text-sm font-semibold">Poznámky</h3>{history.notes.length ? <div className="space-y-2">{history.notes.slice(0, 6).map((note) => <div key={note.id} className="rounded-md bg-slate-50 p-2 text-sm"><p>{note.body}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(note.created_at)}</p></div>)}</div> : <p className="text-sm text-muted-foreground">Bez poznámek.</p>}</div>
        </div>}
      </CardContent>
    </Card>
  </>;
};

export default CRMCommercialDocumentDelivery;
