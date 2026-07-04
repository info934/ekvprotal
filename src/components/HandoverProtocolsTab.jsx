import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileSignature, Lock, Mail, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  createHandoverProtocol,
  emptyHandoverDefect,
  emptyHandoverItem,
  handoverProtocolStatusLabels,
  handoverProtocolTypeLabels,
  listHandoverProtocols,
  loadHandoverTemplates,
  saveHandoverProtocol,
  signHandoverProtocol,
} from '@/lib/handoverProtocolService';
import {
  downloadHandoverProtocolDocx,
  downloadHandoverProtocolHtml,
  downloadHandoverProtocolPdf,
} from '@/lib/documentGenerationService';
import {
  buildHandoverProtocolEmailDefaults,
  sendHandoverProtocolEmail,
} from '@/lib/handoverProtocolEmailService';

const protocolTypes = ['handover_full', 'handover_partial', 'service_protocol', 'contract'];
const editableStatuses = ['draft', 'ready_for_signature'];
const formatDateTime = (value) => (value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-');

const normalizeProtocolForEdit = (protocol) => ({
  ...protocol,
  items: [...(protocol?.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  defects: [...(protocol?.defects || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  signatures: protocol?.signatures || [],
});

const SignaturePad = ({ onChange }) => {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  };

  const start = (event) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    setDrawing(true);
  };

  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const point = getPoint(event);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const stop = () => {
    if (!drawing) return;
    setDrawing(false);
    onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onChange?.('');
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={680}
        height={180}
        className="h-40 w-full rounded-lg border border-slate-200 bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
      />
      <Button type="button" variant="outline" size="sm" onClick={clear}>Vymazat podpis</Button>
    </div>
  );
};

const HandoverProtocolsTab = ({ projectId, realizaceId, project, realization, opportunityId, subjectId, canEdit = false }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [protocols, setProtocols] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('default');
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signature, setSignature] = useState({ signer_name: '', signer_email: '', signer_role: 'Klient', signature_data_url: '' });
  const [emailOpen, setEmailOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState({ recipients: '', subject: '', message: '' });

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId) || null, [templates, templateId]);
  const isLocked = Boolean(draft?.locked_at || draft?.status === 'signed' || draft?.status === 'archived');
  const canModifyDraft = canEdit && draft && !isLocked && editableStatuses.includes(draft.status || 'draft');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listHandoverProtocols({ projectId, realizaceId, opportunityId });
      setProtocols(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
      if (selectedId) {
        const next = rows.find((row) => row.id === selectedId);
        if (next) setDraft(normalizeProtocolForEdit(next));
      }
    } catch (error) {
      toast({ title: 'Nelze načíst protokoly', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [projectId, realizaceId, opportunityId, selectedId, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const protocol = protocols.find((row) => row.id === selectedId) || protocols[0];
    setDraft(protocol ? normalizeProtocolForEdit(protocol) : null);
  }, [protocols, selectedId]);

  useEffect(() => {
    const loadTemplates = async () => {
      if (!draft?.document_type) return;
      const rows = await loadHandoverTemplates(draft.document_type);
      setTemplates(rows);
      setTemplateId(rows[0]?.id || 'default');
    };
    loadTemplates();
  }, [draft?.document_type]);

  const createProtocol = async (documentType) => {
    try {
      const created = await createHandoverProtocol({
        documentType,
        project: project || (projectId ? { id: projectId } : null),
        realization: realization || (realizaceId ? { id: realizaceId } : null),
        opportunity: opportunityId ? { id: opportunityId } : null,
        subjectId,
        createdBy: user?.id,
      });
      setProtocols((prev) => [created, ...prev]);
      setSelectedId(created.id);
      toast({ title: 'Dokument vytvořen', description: created.number });
    } catch (error) {
      toast({ title: 'Nelze vytvořit dokument', description: error.message, variant: 'destructive' });
    }
  };

  const updateDraft = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateItem = (index, patch) => setDraft((prev) => ({
    ...prev,
    items: prev.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
  }));
  const updateDefect = (index, patch) => setDraft((prev) => ({
    ...prev,
    defects: prev.defects.map((defect, defectIndex) => (defectIndex === index ? { ...defect, ...patch } : defect)),
  }));

  const save = async (statusOverride = null) => {
    try {
      const saved = await saveHandoverProtocol(statusOverride ? { ...draft, status: statusOverride } : draft);
      setDraft(normalizeProtocolForEdit(saved));
      setProtocols((prev) => prev.map((row) => (row.id === saved.id ? saved : row)));
      toast({ title: 'Dokument uložen' });
    } catch (error) {
      toast({ title: 'Nelze uložit dokument', description: error.message, variant: 'destructive' });
    }
  };

  const exportDocument = async (format) => {
    try {
      if (format === 'html') downloadHandoverProtocolHtml({ protocol: draft, template: selectedTemplate });
      if (format === 'docx') await downloadHandoverProtocolDocx({ protocol: draft, template: selectedTemplate });
      if (format === 'pdf') await downloadHandoverProtocolPdf({ protocol: draft, template: selectedTemplate });
    } catch (error) {
      toast({ title: 'Generování selhalo', description: error.message, variant: 'destructive' });
    }
  };

  const openEmailDialog = () => {
    const defaults = buildHandoverProtocolEmailDefaults(draft);
    setEmailDraft(defaults);
    setEmailOpen(true);
  };

  const sendProtocolEmail = async () => {
    setSendingEmail(true);
    try {
      const result = await sendHandoverProtocolEmail({
        protocol: draft,
        template: selectedTemplate,
        recipients: emailDraft.recipients,
        subject: emailDraft.subject,
        message: emailDraft.message,
        salutation: 'S pozdravem,<br>' + (user?.user_metadata?.full_name || user?.email || 'EKV Project'),
      });
      setEmailOpen(false);
      toast({ title: 'Protokol odeslán', description: 'Odesláno na ' + result.recipients.join(', ') + '.' });
    } catch (error) {
      toast({ title: 'Odeslání selhalo', description: error.message, variant: 'destructive' });
    } finally {
      setSendingEmail(false);
    }
  };

  const sign = async () => {
    try {
      const signed = await signHandoverProtocol(draft, {
        ...signature,
        signer_name: signature.signer_name || user?.user_metadata?.full_name || user?.email,
        signer_email: signature.signer_email || user?.email,
        user_agent: navigator.userAgent,
      });
      setDraft(normalizeProtocolForEdit(signed));
      setProtocols((prev) => prev.map((row) => (row.id === signed.id ? signed : row)));
      setSignatureOpen(false);
      toast({ title: 'Dokument podepsán', description: 'Verze byla uzamčena pro audit.' });
    } catch (error) {
      toast({ title: 'Podpis se nepodařil', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Předání, smlouvy a podpisy</h2>
          <p className="text-sm text-slate-500">Protokoly, smlouvy, vady/nedodělky, export a interní podpis.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Obnovit</Button>
          {canEdit && protocolTypes.map((type) => (
            <Button key={type} size="sm" onClick={() => createProtocol(type)}><Plus className="mr-2 h-4 w-4" />{handoverProtocolTypeLabels[type]}</Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-slate-50/80 px-4 py-3">
            <CardTitle className="text-sm">Dokumenty</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {protocols.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">Zatím není vytvořen žádný protokol ani smlouva.</div>
            ) : (
              <div className="divide-y">
                {protocols.map((protocol) => (
                  <button
                    key={protocol.id}
                    type="button"
                    className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${selectedId === protocol.id ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedId(protocol.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-950">{protocol.number || protocol.title}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{handoverProtocolTypeLabels[protocol.document_type] || protocol.document_type}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[11px]">{handoverProtocolStatusLabels[protocol.status] || protocol.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {!draft ? (
          <Card><CardContent className="p-8 text-sm text-slate-500">Vyberte nebo vytvořte dokument.</CardContent></Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-white px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-base">{draft.number || 'Bez čísla'} - {draft.title}</CardTitle>
                    {isLocked && <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />Uzamčeno</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">{handoverProtocolTypeLabels[draft.document_type]} - vytvořeno {formatDateTime(draft.created_at)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Výchozí šablona" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Výchozí šablona</SelectItem>
                      {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => exportDocument('html')}><Download className="mr-2 h-4 w-4" />HTML</Button>
                  <Button variant="outline" size="sm" onClick={() => exportDocument('pdf')}>PDF</Button>
                  <Button variant="outline" size="sm" onClick={() => exportDocument('docx')}>DOCX</Button>
                  {canEdit && <Button variant="outline" size="sm" onClick={openEmailDialog}><Mail className="mr-2 h-4 w-4" />Odeslat</Button>}
                  {canModifyDraft && <Button size="sm" onClick={() => save()}><Save className="mr-2 h-4 w-4" />Uložit</Button>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-4">
              <div className="grid gap-3 lg:grid-cols-4">
                <div className="lg:col-span-2 space-y-1.5">
                  <Label>Název dokumentu</Label>
                  <Input value={draft.title || ''} disabled={!canModifyDraft} onChange={(event) => updateDraft({ title: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Stav</Label>
                  <Select value={draft.status || 'draft'} disabled={!canModifyDraft} onValueChange={(value) => updateDraft({ status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(handoverProtocolStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Datum dokumentu</Label>
                  <Input type="date" value={(draft.document_date || '').slice(0, 10)} disabled={!canModifyDraft} onChange={(event) => updateDraft({ document_date: event.target.value })} />
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Rozsah předání</Label>
                  <Textarea className="min-h-28" value={draft.handover_scope || ''} disabled={!canModifyDraft} onChange={(event) => updateDraft({ handover_scope: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Servisní popis / poznámka</Label>
                  <Textarea className="min-h-28" value={draft.service_description || ''} disabled={!canModifyDraft} onChange={(event) => updateDraft({ service_description: event.target.value })} />
                </div>
              </div>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Předané položky / části</h3>
                  {canModifyDraft && <Button variant="outline" size="sm" onClick={() => updateDraft({ items: [...draft.items, emptyHandoverItem(draft.items.length)] })}><Plus className="mr-2 h-4 w-4" />Položka</Button>}
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Kód</TableHead><TableHead>Název</TableHead><TableHead>Množství</TableHead><TableHead>MJ</TableHead><TableHead>Stav / poznámka</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {draft.items.length === 0 ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">Bez položek.</TableCell></TableRow> : draft.items.map((item, index) => (
                        <TableRow key={item.id || index}>
                          <TableCell><Input className="h-8 min-w-24" value={item.code || ''} disabled={!canModifyDraft} onChange={(event) => updateItem(index, { code: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 min-w-56" value={item.name || ''} disabled={!canModifyDraft} onChange={(event) => updateItem(index, { name: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 w-24" type="number" value={item.quantity || 0} disabled={!canModifyDraft} onChange={(event) => updateItem(index, { quantity: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 w-20" value={item.unit || ''} disabled={!canModifyDraft} onChange={(event) => updateItem(index, { unit: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 min-w-64" value={item.condition_note || ''} disabled={!canModifyDraft} onChange={(event) => updateItem(index, { condition_note: event.target.value })} /></TableCell>
                          <TableCell>{canModifyDraft && <Button variant="ghost" size="icon" onClick={() => updateDraft({ items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4 text-red-500" /></Button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Vady a nedodělky</h3>
                  {canModifyDraft && <Button variant="outline" size="sm" onClick={() => updateDraft({ defects: [...draft.defects, emptyHandoverDefect(draft.defects.length)] })}><Plus className="mr-2 h-4 w-4" />Vada</Button>}
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Název</TableHead><TableHead>Stav</TableHead><TableHead>Závažnost</TableHead><TableHead>Odpovědný</TableHead><TableHead>Termín</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {draft.defects.length === 0 ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">Bez vad a nedodělků.</TableCell></TableRow> : draft.defects.map((defect, index) => (
                        <TableRow key={defect.id || index}>
                          <TableCell><Input className="h-8 min-w-64" value={defect.title || ''} disabled={!canModifyDraft} onChange={(event) => updateDefect(index, { title: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 w-28" value={defect.status || ''} disabled={!canModifyDraft} onChange={(event) => updateDefect(index, { status: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 w-28" value={defect.severity || ''} disabled={!canModifyDraft} onChange={(event) => updateDefect(index, { severity: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 min-w-36" value={defect.responsible || ''} disabled={!canModifyDraft} onChange={(event) => updateDefect(index, { responsible: event.target.value })} /></TableCell>
                          <TableCell><Input className="h-8 w-36" type="date" value={(defect.due_date || '').slice(0, 10)} disabled={!canModifyDraft} onChange={(event) => updateDefect(index, { due_date: event.target.value })} /></TableCell>
                          <TableCell>{canModifyDraft && <Button variant="ghost" size="icon" onClick={() => updateDraft({ defects: draft.defects.filter((_, defectIndex) => defectIndex !== index) })}><Trash2 className="h-4 w-4 text-red-500" /></Button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-1.5">
                  <Label>Poznámky</Label>
                  <Textarea className="min-h-24" value={draft.notes || ''} disabled={!canModifyDraft} onChange={(event) => updateDraft({ notes: event.target.value })} />
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">Podpisy</h3>
                    {canEdit && draft.status !== 'signed' && <Button size="sm" onClick={() => { setSignature({ signer_name: '', signer_email: user?.email || '', signer_role: 'Klient', signature_data_url: '' }); setSignatureOpen(true); }}><FileSignature className="mr-2 h-4 w-4" />Podepsat</Button>}
                  </div>
                  <div className="space-y-2">
                    {draft.signatures.length === 0 ? <p className="text-sm text-slate-500">Zatím bez podpisu.</p> : draft.signatures.map((item) => (
                      <div key={item.id} className="rounded-md border bg-white p-2 text-xs">
                        <div className="font-semibold text-slate-900">{item.signer_name}</div>
                        <div className="text-slate-500">{item.signer_role} - {formatDateTime(item.signed_at)}</div>
                      </div>
                    ))}
                  </div>
                  {canModifyDraft && draft.status === 'draft' && <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => save('ready_for_signature')}><Check className="mr-2 h-4 w-4" />Připravit k podpisu</Button>}
                </div>
              </section>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Odeslat protokol e-mailem</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">
              Dokument se odešle jako HTML příloha v aktuálně vybrané šabloně. Příjemce je předvyplněný z e-mailu subjektu/investora, další adresy oddělte čárkou nebo středníkem.
            </div>
            <div className="space-y-1.5">
              <Label>Příjemci</Label>
              <Input
                type="text"
                value={emailDraft.recipients}
                onChange={(event) => setEmailDraft((prev) => ({ ...prev, recipients: event.target.value }))}
                placeholder="investor@example.cz, dalsi@example.cz"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Předmět</Label>
              <Input value={emailDraft.subject} onChange={(event) => setEmailDraft((prev) => ({ ...prev, subject: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Zpráva</Label>
              <Textarea className="min-h-32" value={emailDraft.message} onChange={(event) => setEmailDraft((prev) => ({ ...prev, message: event.target.value }))} />
              <p className="text-xs text-slate-500">Můžete použít jednoduché HTML, například &lt;br&gt; pro nový řádek.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={sendingEmail}>Zrušit</Button>
            <Button onClick={sendProtocolEmail} disabled={sendingEmail || !emailDraft.recipients.trim()}>
              {sendingEmail ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {sendingEmail ? 'Odesílám...' : 'Odeslat protokol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signatureOpen} onOpenChange={setSignatureOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Interní podpis dokumentu</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Jméno</Label><Input value={signature.signer_name} onChange={(event) => setSignature((prev) => ({ ...prev, signer_name: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input value={signature.signer_email} onChange={(event) => setSignature((prev) => ({ ...prev, signer_email: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Role</Label><Input value={signature.signer_role} onChange={(event) => setSignature((prev) => ({ ...prev, signer_role: event.target.value }))} /></div>
            </div>
            <SignaturePad onChange={(dataUrl) => setSignature((prev) => ({ ...prev, signature_data_url: dataUrl }))} />
            <p className="text-xs text-slate-500">Podpis vytvoří auditní záznam, uloží hash dokumentu a uzamkne aktuální verzi.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignatureOpen(false)}>Zrušit</Button>
            <Button onClick={sign} disabled={!signature.signature_data_url}>Podepsat a uzamknout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HandoverProtocolsTab;
