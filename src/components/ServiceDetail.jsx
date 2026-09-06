import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, Clock3, Download, ExternalLink, FileSignature, FolderOpen, ImagePlus, Mail, MapPin, Package, Paperclip, Pencil, Play, Plus, Send, ShieldCheck, User, Wrench } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { createHandoverProtocolPdfBlob } from '@/lib/documentGenerationService';
import { ensureEntityFolder } from '@/lib/documentStorageService';
import { blobToDataUrl, buildServiceProtocolModel, formatServiceDate, parseServiceLines, priorityTone, serviceDocumentLabels, servicePriorityLabels, serviceSafetyChecks, serviceStatusLabels, serviceTypeLabels, statusTone, warrantyLabels } from '@/lib/serviceModule';
import SharePointFolderBrowser from '@/components/SharePointFolderBrowser';
import SignaturePad from '@/components/SignaturePad';
import ServiceOperationsPanel from '@/components/ServiceOperationsPanel';
import { compressServicePhoto, enqueueServicePhoto, enqueueServiceVisit, getServiceOfflineState, loadServiceOfflineDraft, removeServiceOfflineDraft, saveServiceOfflineDraft, serviceDraftKey, subscribeServiceOfflineState, syncServiceOfflineQueue } from '@/lib/serviceOfflineQueue';

const selectClass = 'h-10 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const emptyVisit = (serviceCase, number) => ({
  id: '', visit_number: number, status: 'draft', scheduled_start: serviceCase?.scheduled_start?.slice(0, 16) || '', scheduled_end: serviceCase?.scheduled_end?.slice(0, 16) || '',
  lead_technician_id: serviceCase?.assigned_member_id || '', diagnostics: '', root_cause: '', work_performed: '', recommendations: '', next_action: '', client_statement: '',
  materials_text: '', measurements_text: '', safety_checks: (serviceSafetyChecks[serviceCase?.system_type] || serviceSafetyChecks.other).map((label) => ({ label, checked: false })), client_present: false,
  client_mutation_id: crypto.randomUUID(), client_signature_data_url: '', client_signed_by: '', client_signed_at: null,
});
const normalizeVisit = (visit) => ({
  ...visit, scheduled_start: visit.scheduled_start?.slice(0, 16) || '', scheduled_end: visit.scheduled_end?.slice(0, 16) || '',
  materials_text: (visit.materials || []).map((item) => `${item.name} | ${item.quantity || 1} | ${item.unit || 'ks'}`).join('\n'),
  measurements_text: (visit.measurements || []).map((item) => `${item.label} | ${item.value || ''} | ${item.unit || ''}`).join('\n'),
  safety_checks: visit.safety_checks || [],
});

const ServiceDetail = () => {
  const { serviceCaseId } = useParams();
  const { hasPermission, memberId } = useAuth();
  const canEdit = hasPermission('service', 'can_edit');
  const { toast } = useToast();
  const navigate = useNavigate();
  const photoInput = useRef(null);
  const [serviceCase, setServiceCase] = useState(null);
  const [visits, setVisits] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [inboundAttachments, setInboundAttachments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visitOpen, setVisitOpen] = useState(false);
  const [visitDraft, setVisitDraft] = useState(null);
  const [savingVisit, setSavingVisit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [prepared, setPrepared] = useState(null);
  const [sendDraft, setSendDraft] = useState({ recipientName: '', recipientEmail: '', message: '' });
  const [sending, setSending] = useState(false);
  const [preparingFolder, setPreparingFolder] = useState(false);
  const [visitStep, setVisitStep] = useState(0);
  const [offlineState, setOfflineState] = useState({ pending: 0, visits: 0, photos: 0, errors: 0 });
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [photoQueue, setPhotoQueue] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [caseRes, visitRes, attachmentRes, inboundAttachmentRes, documentRes, eventRes, memberRes] = await Promise.all([
      supabase.from('service_cases').select('*, assigned:assigned_member_id(id,name,email), subject:subject_id(id,name,email,phone,contact_person,address,ico,dic), project:project_id(id,name,code), realizace:realizace_id(id,name,status), opportunity:opportunity_id(id,number,title)').eq('id', serviceCaseId).maybeSingle(),
      supabase.from('service_visits').select('*, lead_technician:lead_technician_id(id,name)').eq('service_case_id', serviceCaseId).order('visit_number', { ascending: false }),
      supabase.from('service_attachments').select('*').eq('service_case_id', serviceCaseId).order('created_at', { ascending: false }),
      supabase.from('service_ticket_attachments').select('*, ticket:service_ticket_id(number,subject,sender_email,received_at)').eq('service_case_id', serviceCaseId).order('created_at', { ascending: false }),
      supabase.from('service_documents').select('*').eq('service_case_id', serviceCaseId).order('created_at', { ascending: false }),
      supabase.from('service_events').select('id,event_type,summary,created_at,actor:actor_member_id(id,name)').eq('service_case_id', serviceCaseId).order('created_at', { ascending: false }).limit(100),
      supabase.from('members').select('id,name').not('auth_user_id', 'is', null).order('name'),
    ]);
    const error = caseRes.error || visitRes.error || attachmentRes.error || inboundAttachmentRes.error || documentRes.error || eventRes.error || memberRes.error;
    if (error) toast({ title: 'Detail servisu se nepodařilo načíst', description: error.message, variant: 'destructive' });
    if (!caseRes.data && !caseRes.error) navigate('/service', { replace: true });
    const photos = await Promise.all((attachmentRes.data || []).map(async (item) => {
      const { data } = await supabase.storage.from('service-photos').createSignedUrl(item.storage_path, 3600);
      return { ...item, signedUrl: data?.signedUrl || '' };
    }));
    const emailFiles = await Promise.all((inboundAttachmentRes.data || []).map(async (item) => {
      const { data } = await supabase.storage.from('service-inbox').createSignedUrl(item.storage_path, 3600);
      return { ...item, signedUrl: data?.signedUrl || '' };
    }));
    setServiceCase(caseRes.data); setVisits(visitRes.data || []); setAttachments(photos); setInboundAttachments(emailFiles); setDocuments(documentRes.data || []); setEvents(eventRes.data || []); setMembers(memberRes.data || []); setLoading(false);
  }, [navigate, serviceCaseId, toast]);
  useEffect(() => { load(); }, [load]);
  const refreshOfflineState = useCallback(() => getServiceOfflineState(serviceCaseId).then(setOfflineState).catch(() => {}), [serviceCaseId]);
  const synchronizeOffline = useCallback(async ({ quiet = false } = {}) => {
    if (!navigator.onLine || syncingOffline) return;
    setSyncingOffline(true);
    const result = await syncServiceOfflineQueue({ supabase, serviceCaseId }).catch((error) => ({ synced: 0, failed: 1, error }));
    setSyncingOffline(false);
    await refreshOfflineState();
    if (result.synced) { if (!quiet) toast({ title: 'Offline data byla synchronizována', description: `${result.synced} položek bylo bezpečně odesláno.` }); await load(); }
    if (result.failed && !quiet) toast({ title: 'Část offline dat čeká na další pokus', description: result.error?.message || 'Zkontrolujte připojení a opakujte synchronizaci.', variant: 'destructive' });
  }, [load, refreshOfflineState, serviceCaseId, syncingOffline, toast]);
  useEffect(() => {
    refreshOfflineState();
    const unsubscribe = subscribeServiceOfflineState(() => { refreshOfflineState(); if (navigator.onLine) synchronizeOffline({ quiet: true }); });
    if (navigator.onLine) synchronizeOffline({ quiet: true });
    return unsubscribe;
  }, [refreshOfflineState]);
  useEffect(() => {
    if (!visitOpen || !visitDraft) return undefined;
    const timer = setTimeout(() => saveServiceOfflineDraft(serviceDraftKey(serviceCaseId, visitDraft.id || 'new'), visitDraft).catch(() => {}), 500);
    return () => clearTimeout(timer);
  }, [serviceCaseId, visitDraft, visitOpen]);
  const latestVisit = visits[0] || null;

  const updateCase = async (patch) => {
    const { error } = await supabase.from('service_cases').update(patch).eq('id', serviceCaseId);
    if (error) return toast({ title: 'Změnu se nepodařilo uložit', description: error.message, variant: 'destructive' });
    await load();
  };
  const prepareServiceFolder = async () => {
    setPreparingFolder(true);
    try {
      await ensureEntityFolder({ entityType: 'service', entityId: serviceCaseId, code: serviceCase.number, name: serviceCase.title });
      toast({ title: 'Servisní složka je připravená', description: 'Najdete ji v Dokumenty – Realizace.' });
      await load();
    } catch (error) {
      toast({ title: 'Složku se nepodařilo připravit', description: error.message, variant: 'destructive' });
    } finally {
      setPreparingFolder(false);
    }
  };
  const openVisit = async (visit = null) => {
    const initial = visit ? normalizeVisit(visit) : emptyVisit(serviceCase, (visits[0]?.visit_number || 0) + 1);
    const saved = await loadServiceOfflineDraft(serviceDraftKey(serviceCaseId, visit?.id || 'new')).catch(() => null);
    setVisitDraft(saved?.snapshot ? { ...initial, ...saved.snapshot } : initial);
    setVisitStep(0);
    setVisitOpen(true);
    if (saved?.snapshot) toast({ title: 'Obnoven rozepsaný výjezd', description: 'Pokračujete od poslední automaticky uložené změny.' });
  };
  const setVisit = (key, value) => setVisitDraft((current) => ({ ...current, [key]: value }));
  const saveVisit = async (event) => {
    event.preventDefault(); setSavingVisit(true);
    const payload = {
      service_case_id: serviceCaseId, visit_number: visitDraft.visit_number, status: visitDraft.status,
      scheduled_start: visitDraft.scheduled_start || null, scheduled_end: visitDraft.scheduled_end || null,
      lead_technician_id: visitDraft.lead_technician_id || null, technician_ids: visitDraft.lead_technician_id ? [visitDraft.lead_technician_id] : [],
      diagnostics: visitDraft.diagnostics.trim() || null, root_cause: visitDraft.root_cause.trim() || null,
      work_performed: visitDraft.work_performed.trim() || null, recommendations: visitDraft.recommendations.trim() || null,
      next_action: visitDraft.next_action.trim() || null, client_statement: visitDraft.client_statement.trim() || null,
      materials: parseServiceLines(visitDraft.materials_text, 'material'), measurements: parseServiceLines(visitDraft.measurements_text, 'measurement'),
      safety_checks: visitDraft.safety_checks, client_present: Boolean(visitDraft.client_present), created_by_member_id: memberId,
      client_mutation_id: visitDraft.client_mutation_id || crypto.randomUUID(),
      client_signature_data_url: visitDraft.client_signature_data_url || null,
      client_signed_by: visitDraft.client_signature_data_url ? (visitDraft.client_signed_by?.trim() || serviceCase.client_contact_name || serviceCase.client_name) : null,
      client_signed_at: visitDraft.client_signature_data_url ? (visitDraft.client_signed_at || new Date().toISOString()) : null,
    };
    if (!navigator.onLine) {
      try {
        await enqueueServiceVisit({ serviceCaseId, visitId: visitDraft.id || null, payload });
        await removeServiceOfflineDraft(serviceDraftKey(serviceCaseId, visitDraft.id || 'new')).catch(() => {});
        setVisitOpen(false);
        toast({ title: 'Výjezd je uložen offline', description: 'Po návratu připojení se automaticky synchronizuje.' });
        await refreshOfflineState();
      } catch (offlineError) {
        toast({ title: 'Offline uložení se nezdařilo', description: offlineError.message, variant: 'destructive' });
      } finally { setSavingVisit(false); }
      return;
    }
    const request = visitDraft.id
      ? supabase.from('service_visits').update({ ...payload, offline_synced_at: new Date().toISOString() }).eq('id', visitDraft.id)
      : supabase.from('service_visits').upsert({ ...payload, offline_synced_at: new Date().toISOString() }, { onConflict: 'client_mutation_id' });
    const { error } = await request; setSavingVisit(false);
    if (error) {
      await enqueueServiceVisit({ serviceCaseId, visitId: visitDraft.id || null, payload });
      await removeServiceOfflineDraft(serviceDraftKey(serviceCaseId, visitDraft.id || 'new')).catch(() => {});
      toast({ title: 'Výjezd čeká v offline frontě', description: 'Přenos se nezdařil a portál jej bezpečně zopakuje.', variant: 'destructive' });
      setVisitOpen(false); await refreshOfflineState(); return;
    }
    await removeServiceOfflineDraft(serviceDraftKey(serviceCaseId, visitDraft.id || 'new')).catch(() => {});
    toast({ title: 'Servisní výjezd byl uložen' }); setVisitOpen(false); await load();
  };
  const startVisit = async (visit) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('service_visits').update({ status: 'in_progress', started_at: visit.started_at || now }).eq('id', visit.id);
    if (!error) await updateCase({ status: 'in_progress' }); else toast({ title: 'Výjezd nelze zahájit', description: error.message, variant: 'destructive' });
  };
  const completeVisit = async (visit) => {
    if (!visit.work_performed?.trim()) return toast({ title: 'Doplňte provedené práce', description: 'Před ukončením musí být jasně zapsáno, co technik provedl.', variant: 'destructive' });
    const now = new Date().toISOString();
    const { error } = await supabase.from('service_visits').update({ status: 'completed', completed_at: now }).eq('id', visit.id);
    if (!error) await updateCase({ status: visit.next_action ? 'waiting_parts' : 'resolved', resolved_at: visit.next_action ? null : now, resolution_summary: visit.work_performed }); else toast({ title: 'Výjezd nelze dokončit', description: error.message, variant: 'destructive' });
  };
  const uploadPhotos = async (event) => {
    const files = [...(event.target.files || [])]; if (!files.length) return;
    setUploading(true);
    const compressed = [];
    for (const originalFile of files) {
      const file = await compressServicePhoto(originalFile).catch(() => originalFile);
      if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) { toast({ title: `${file.name} nebyl vybrán`, description: 'Povoleny jsou obrázky do 15 MB.', variant: 'destructive' }); continue; }
      compressed.push({ file, preview: URL.createObjectURL(file) });
    }
    event.target.value = ''; setUploading(false); setPhotoQueue(compressed);
  };
  const confirmPhotos = async () => {
    setUploading(true);
    for (const item of photoQueue) {
      const file = item.file;
      if (!navigator.onLine) {
        await enqueueServicePhoto({ serviceCaseId, serviceVisitId: latestVisit?.id || null, file });
        continue;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const path = `${serviceCaseId}/${latestVisit?.id || 'case'}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('service-photos').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { await enqueueServicePhoto({ serviceCaseId, serviceVisitId: latestVisit?.id || null, file }); toast({ title: `${file.name} čeká na synchronizaci`, description: 'Fotografie zůstala bezpečně uložená v zařízení.', variant: 'destructive' }); continue; }
      const { error: rowError } = await supabase.from('service_attachments').insert({ service_case_id: serviceCaseId, service_visit_id: latestVisit?.id || null, category: latestVisit?.status === 'completed' ? 'after' : 'during', file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, captured_at: new Date(file.lastModified || Date.now()).toISOString(), uploaded_by_member_id: memberId });
      if (rowError) { await supabase.storage.from('service-photos').remove([path]); toast({ title: 'Fotku se nepodařilo zařadit', description: rowError.message, variant: 'destructive' }); }
    }
    photoQueue.forEach(item => URL.revokeObjectURL(item.preview));
    setPhotoQueue([]); setUploading(false); await refreshOfflineState(); if (navigator.onLine) await load();
  };

  const prepareDocument = async (documentType, mode) => {
    if (!latestVisit) return toast({ title: 'Nejdříve založte servisní výjezd', description: 'Protokol musí obsahovat konkrétní záznam technika.', variant: 'destructive' });
    const snapshot = { case: serviceCase, visit: latestVisit, attachments: attachments.map(({ signedUrl, ...item }) => item) };
    const { data: document, error } = await supabase.rpc('create_service_document', { p_service_case_id: serviceCaseId, p_service_visit_id: latestVisit?.id || null, p_document_type: documentType, p_document_snapshot: snapshot });
    if (error) return toast({ title: 'Dokument se nepodařilo vytvořit', description: error.message, variant: 'destructive' });
    try {
      const protocol = buildServiceProtocolModel({ serviceCase, visit: latestVisit, document, attachments });
      const pdf = await createHandoverProtocolPdfBlob({ protocol, template: null });
      if (mode === 'download') {
        const url = URL.createObjectURL(pdf.blob); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = pdf.fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast({ title: `${serviceDocumentLabels[documentType]} byl vygenerován` }); await load(); return;
      }
      setPrepared({ document, pdf }); setSendDraft({ recipientName: serviceCase.client_contact_name || serviceCase.client_name, recipientEmail: serviceCase.client_email || '', message: `Dobrý den,\n\nv příloze posíláme ${serviceDocumentLabels[documentType].toLowerCase()} k servisnímu případu ${serviceCase.number}. Dokument prosím otevřete a elektronicky podepište.\n\nTým EKV Project` }); setSendOpen(true);
    } catch (pdfError) { toast({ title: 'PDF se nepodařilo vygenerovat', description: pdfError.message, variant: 'destructive' }); }
  };
  const sendDocument = async (event) => {
    event.preventDefault(); setSending(true);
    try {
      const pdfBase64 = await blobToDataUrl(prepared.pdf.blob);
      const { data, error } = await supabase.functions.invoke('send-service-document', { body: { documentId: prepared.document.id, ...sendDraft, pdfBase64 } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: 'Dokument byl odeslán k podpisu' }); setSendOpen(false); setPrepared(null); await load();
    } catch (error) { toast({ title: 'Odeslání se nepodařilo', description: error.message, variant: 'destructive' }); }
    setSending(false);
  };

  if (loading || !serviceCase) return <div className="app-page py-16 text-center text-muted-foreground">Načítám servisní případ…</div>;
  const link = serviceCase.opportunity ? `/crm/opportunities/${serviceCase.opportunity.id}` : serviceCase.realizace ? `/realizace/${serviceCase.realizace.id}` : serviceCase.project ? `/projects/${serviceCase.project.id}` : null;

  return <div className="app-page space-y-5 pb-24 md:pb-8">
    <Button asChild variant="ghost" className="-ml-3"><Link to="/service"><ArrowLeft className="mr-2 h-4 w-4" />Zpět na servis</Link></Button>
    <PageHeader icon={Wrench} title={`${serviceCase.number} · ${serviceCase.title}`} description={`${serviceCase.client_name} · ${serviceTypeLabels[serviceCase.system_type]}`}
      actions={<div className="flex flex-wrap gap-2">{canEdit && <Button variant="outline" onClick={() => openVisit()}><Plus className="mr-2 h-4 w-4" />Přidat výjezd</Button>}<Button onClick={() => photoInput.current?.click()} disabled={uploading}><Camera className="mr-2 h-4 w-4" />{uploading ? 'Nahrávám…' : 'Pořídit fotky'}</Button><input ref={photoInput} hidden type="file" accept="image/*" capture="environment" multiple onChange={uploadPhotos} /></div>} />

    {(!navigator.onLine || offlineState.pending > 0) && <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${navigator.onLine ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
      <div><strong>{navigator.onLine ? 'Data čekají na synchronizaci' : 'Pracujete bez připojení'}</strong><p className="mt-1 text-sm">{offlineState.visits} výjezdů a {offlineState.photos} fotografií zůstává uložených v tomto zařízení.</p></div>
      {navigator.onLine && <Button type="button" size="sm" onClick={() => synchronizeOffline()} disabled={syncingOffline}>{syncingOffline ? 'Synchronizuji…' : 'Synchronizovat nyní'}</Button>}
    </div>}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card><CardContent className="p-5"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(serviceCase.status)}`}>{serviceStatusLabels[serviceCase.status]}</span><Badge variant="outline">{serviceTypeLabels[serviceCase.system_type]}</Badge><span className={`text-sm font-semibold ${priorityTone(serviceCase.priority)}`}>{servicePriorityLabels[serviceCase.priority]} priorita</span><Badge variant="outline">{warrantyLabels[serviceCase.warranty_status]}</Badge></div><div className="mt-5 grid gap-5 md:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Klient</p><h2 className="mt-1 text-lg font-semibold">{serviceCase.client_name}</h2><p className="mt-1 text-sm text-slate-600">{serviceCase.client_contact_name}</p><p className="text-sm text-slate-600">{serviceCase.client_email} {serviceCase.client_phone && `· ${serviceCase.client_phone}`}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Instalace</p><p className="mt-1 font-medium">{serviceCase.installation_address || 'Adresa není vyplněna'}</p>{link && <Button asChild variant="link" className="h-auto p-0"><Link to={link}>{serviceCase.opportunity?.number || serviceCase.realizace?.name || serviceCase.project?.code} · otevřít zdroj</Link></Button>}</div></div><div className="mt-5 border-t pt-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nahlášený problém</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{serviceCase.description}</p>{serviceCase.equipment_summary && <p className="mt-3 text-sm text-slate-600"><strong>Zařízení:</strong> {serviceCase.equipment_summary}</p>}</div></CardContent></Card>

        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Servisní výjezdy</CardTitle>{canEdit && <Button size="sm" variant="outline" onClick={() => openVisit()}><Plus className="mr-2 h-4 w-4" />Nový</Button>}</CardHeader><CardContent className="space-y-3">
          {visits.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Zatím není naplánovaný žádný výjezd.</div> : visits.map((visit) => <div key={visit.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">Výjezd #{visit.visit_number}</h3><Badge variant="outline">{visit.status === 'completed' ? 'Dokončen' : visit.status === 'in_progress' ? 'Probíhá' : 'Koncept'}</Badge></div><p className="mt-1 text-sm text-slate-500">{formatServiceDate(visit.scheduled_start)} · {visit.lead_technician?.name || 'Nepřiřazeno'}</p></div>{canEdit && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openVisit(visit)}><Pencil className="mr-2 h-4 w-4" />Upravit</Button>{visit.status === 'draft' && <Button size="sm" onClick={() => startVisit(visit)}><Play className="mr-2 h-4 w-4" />Zahájit</Button>}{visit.status === 'in_progress' && <Button size="sm" onClick={() => completeVisit(visit)}><CheckCircle2 className="mr-2 h-4 w-4" />Ukončit</Button>}</div>}</div>{visit.diagnostics && <p className="mt-4 whitespace-pre-wrap text-sm"><strong>Diagnostika:</strong> {visit.diagnostics}</p>}{visit.work_performed && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Provedené práce:</strong> {visit.work_performed}</p>}<div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500"><span><Package className="mr-1 inline h-3.5 w-3.5" />{visit.materials?.length || 0} položek</span><span><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />{visit.safety_checks?.filter((item) => item.checked).length || 0}/{visit.safety_checks?.length || 0} kontrol</span><span><Camera className="mr-1 inline h-3.5 w-3.5" />{attachments.filter((item) => item.service_visit_id === visit.id).length} fotek</span></div></div>)}
        </CardContent></Card>

        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Fotodokumentace</CardTitle><Button size="sm" variant="outline" onClick={() => photoInput.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Přidat</Button></CardHeader><CardContent>{attachments.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Fotografie lze pořídit přímo fotoaparátem telefonu.</div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{attachments.map((item) => <a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border bg-slate-50"><img src={item.signedUrl} alt={item.caption || item.file_name} className="aspect-square w-full object-cover transition group-hover:scale-105" /><p className="truncate p-2 text-xs text-slate-600">{item.caption || item.file_name}</p></a>)}</div>}{inboundAttachments.length > 0 && <div className="mt-5 border-t pt-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" />Přílohy původního e-mailu</h3><div className="grid gap-2 sm:grid-cols-2">{inboundAttachments.map((item) => <a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-slate-50"><Paperclip className="h-4 w-4 shrink-0 text-blue-700" /><span className="min-w-0"><strong className="block truncate">{item.file_name}</strong><span className="text-xs text-slate-500">{item.ticket?.number} · {Math.ceil(item.size_bytes / 1024)} kB</span></span></a>)}</div></div>}</CardContent></Card>
        <SharePointFolderBrowser entityType="service" entity={{ ...serviceCase, name: serviceCase.title, code: serviceCase.number }} canEdit={canEdit} />
      </div>

      <aside className="space-y-5">
        <Card><CardHeader><CardTitle>Práce v terénu</CardTitle></CardHeader><CardContent className="space-y-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><User className="mr-2 inline h-4 w-4" />{serviceCase.assigned?.name || 'Technik není přiřazen'}</div><div className="rounded-lg bg-slate-50 p-3 text-sm"><Clock3 className="mr-2 inline h-4 w-4" />{formatServiceDate(serviceCase.scheduled_start)}</div><div className="rounded-lg bg-slate-50 p-3 text-sm"><MapPin className="mr-2 inline h-4 w-4" />{serviceCase.installation_address || 'Bez adresy'}</div>{serviceCase.shared_drive_link ? <Button asChild variant="outline" className="w-full justify-start"><a href={serviceCase.shared_drive_link} target="_blank" rel="noreferrer"><FolderOpen className="mr-2 h-4 w-4" />Otevřít složku servisu<ExternalLink className="ml-auto h-4 w-4" /></a></Button> : canEdit ? <Button type="button" variant="outline" className="w-full justify-start" onClick={prepareServiceFolder} disabled={preparingFolder}><FolderOpen className="mr-2 h-4 w-4" />{preparingFolder ? 'Připravuji složku…' : 'Připravit složku servisu'}</Button> : null}{canEdit && <select aria-label="Stav případu" className={selectClass} value={serviceCase.status} onChange={(e) => updateCase({ status: e.target.value })}>{Object.entries(serviceStatusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Protokoly a podpis</CardTitle></CardHeader><CardContent className="space-y-2">{!latestVisit && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Nejdříve založte servisní výjezd. Z jeho záznamu se vytvoří protokol.</p>}<Button className="w-full justify-start" variant="outline" disabled={!latestVisit} onClick={() => prepareDocument('service_protocol', 'download')}><Download className="mr-2 h-4 w-4" />Servisní protokol PDF</Button><Button className="w-full justify-start" variant="outline" disabled={!latestVisit} onClick={() => prepareDocument('handover_protocol', 'download')}><Download className="mr-2 h-4 w-4" />Předávací protokol PDF</Button><Button className="w-full justify-start" onClick={() => prepareDocument('service_protocol', 'send')} disabled={!latestVisit || !serviceCase.client_email}><Send className="mr-2 h-4 w-4" />Odeslat servisní k podpisu</Button><Button className="w-full justify-start" onClick={() => prepareDocument('handover_protocol', 'send')} disabled={!latestVisit || !serviceCase.client_email}><FileSignature className="mr-2 h-4 w-4" />Odeslat předávací k podpisu</Button>{documents.length > 0 && <div className="mt-4 space-y-2 border-t pt-4">{documents.slice(0, 8).map((doc) => <div key={doc.id} className="flex items-center justify-between gap-2 text-sm"><div><strong>{doc.number}</strong><p className="text-xs text-slate-500">{serviceDocumentLabels[doc.document_type]}</p></div><Badge variant={doc.status === 'signed' ? 'secondary' : 'outline'}>{doc.status === 'signed' ? 'Podepsáno' : doc.status === 'sent' || doc.status === 'viewed' ? 'Odesláno' : 'Připraveno'}</Badge></div>)}</div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Historie případu</CardTitle></CardHeader><CardContent><ol className="space-y-4">{events.slice(0, 12).map((event) => <li key={event.id} className="relative border-l pl-4 text-sm before:absolute before:-left-1 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-blue-500"><p className="font-medium text-slate-800">{event.summary}</p><p className="mt-1 text-xs text-slate-500">{formatServiceDate(event.created_at)} · {event.actor?.name || 'Systém'}</p></li>)}</ol></CardContent></Card>
        <ServiceOperationsPanel serviceCase={serviceCase} canEdit={canEdit} onChanged={load} />
      </aside>
    </div>

    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-white/95 p-3 shadow-lg backdrop-blur md:hidden"><Button className="flex-1" onClick={() => !latestVisit || latestVisit.status === 'completed' ? openVisit() : latestVisit.status === 'in_progress' ? completeVisit(latestVisit) : startVisit(latestVisit)}>{latestVisit?.status === 'in_progress' ? <CheckCircle2 className="mr-2 h-4 w-4" /> : latestVisit && latestVisit.status !== 'completed' ? <Play className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{latestVisit?.status === 'in_progress' ? 'Ukončit výjezd' : latestVisit && latestVisit.status !== 'completed' ? 'Zahájit výjezd' : 'Přidat výjezd'}</Button><Button size="icon" variant="outline" onClick={() => photoInput.current?.click()} aria-label="Pořídit fotografie"><Camera className="h-5 w-5" /></Button></div>

    <Dialog open={visitOpen} onOpenChange={(open) => !savingVisit && setVisitOpen(open)}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{visitDraft?.id ? `Výjezd #${visitDraft.visit_number}` : 'Nový servisní výjezd'}</DialogTitle>
          <DialogDescription>Každý krok se automaticky ukládá do tohoto zařízení a lze jej dokončit bez signálu.</DialogDescription>
        </DialogHeader>
        {visitDraft && <form onSubmit={saveVisit} className="space-y-5">
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Postup servisního výjezdu">
            {['Zahájení', 'Diagnostika', 'Práce', 'Měření', 'Kontrola', 'Podpis'].map((label, index) => <button key={label} type="button" onClick={() => setVisitStep(index)} className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold ${visitStep === index ? 'bg-blue-700 text-white' : index < visitStep ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{index + 1}. {label}</button>)}
          </div>

          {visitStep === 0 && <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label>Vedoucí technik</Label><select className={selectClass} value={visitDraft.lead_technician_id} onChange={(e) => setVisit('lead_technician_id', e.target.value)}><option value="">Nepřiřazeno</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="space-y-2"><Label>Začátek</Label><Input type="datetime-local" value={visitDraft.scheduled_start} onChange={(e) => setVisit('scheduled_start', e.target.value)} /></div>
            <div className="space-y-2"><Label>Konec</Label><Input type="datetime-local" value={visitDraft.scheduled_end} onChange={(e) => setVisit('scheduled_end', e.target.value)} /></div>
          </div>}

          {visitStep === 1 && <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Diagnostika</Label><Textarea className="min-h-[180px]" value={visitDraft.diagnostics} onChange={(e) => setVisit('diagnostics', e.target.value)} placeholder="Alarmy, stav zařízení, vzdálená diagnostika…" /></div>
            <div className="space-y-2"><Label>Zjištěná příčina</Label><Textarea className="min-h-[180px]" value={visitDraft.root_cause} onChange={(e) => setVisit('root_cause', e.target.value)} /></div>
          </div>}

          {visitStep === 2 && <div className="space-y-4">
            <div className="space-y-2"><Label>Provedené práce</Label><Textarea className="min-h-[160px]" value={visitDraft.work_performed} onChange={(e) => setVisit('work_performed', e.target.value)} placeholder="Popište zásah v pořadí, v jakém byl proveden." /></div>
            <div className="space-y-2"><Label>Použitý materiál</Label><Textarea className="min-h-[130px]" value={visitDraft.materials_text} onChange={(e) => setVisit('materials_text', e.target.value)} placeholder={'Pojistka DC | 2 | ks\nKonektor MC4 | 4 | ks'} /><p className="text-xs text-slate-500">Název | množství | jednotka</p></div>
          </div>}

          {visitStep === 3 && <div className="space-y-2"><Label>Měření</Label><Textarea className="min-h-[220px]" value={visitDraft.measurements_text} onChange={(e) => setVisit('measurements_text', e.target.value)} placeholder={'Napětí stringu 1 | 612 | V\nIzolační odpor | 128 | MΩ'} /><p className="text-xs text-slate-500">Měření | hodnota | jednotka</p></div>}

          {visitStep === 4 && <div className="space-y-4">
            <fieldset className="rounded-xl border p-4"><legend className="px-2 text-sm font-semibold">Bezpečnostní a funkční kontrola</legend><div className="grid gap-3 sm:grid-cols-2">{visitDraft.safety_checks.map((item,index) => <label key={`${item.label}-${index}`} className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-50 px-3 text-sm"><input type="checkbox" className="h-5 w-5 rounded" checked={Boolean(item.checked)} onChange={(e) => setVisit('safety_checks', visitDraft.safety_checks.map((check,i) => i === index ? { ...check, checked:e.target.checked } : check))} />{item.label}</label>)}</div></fieldset>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Doporučení klientovi</Label><Textarea value={visitDraft.recommendations} onChange={(e) => setVisit('recommendations', e.target.value)} /></div><div className="space-y-2"><Label>Další krok</Label><Textarea value={visitDraft.next_action} onChange={(e) => setVisit('next_action', e.target.value)} placeholder="Prázdné znamená, že lze případ vyřešit." /></div></div>
          </div>}

          {visitStep === 5 && <div className="space-y-4">
            <div className="space-y-2"><Label>Vyjádření klienta</Label><Textarea value={visitDraft.client_statement} onChange={(e) => setVisit('client_statement', e.target.value)} /></div>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={visitDraft.client_present} onChange={(e) => setVisit('client_present', e.target.checked)} />Klient byl zásahu přítomen</label>
            {visitDraft.client_present && <div className="space-y-3 rounded-xl border p-4"><div className="space-y-2"><Label>Jméno podepisujícího</Label><Input value={visitDraft.client_signed_by || ''} onChange={(e) => setVisit('client_signed_by', e.target.value)} placeholder={serviceCase.client_contact_name || serviceCase.client_name} /></div><Label>Podpis klienta</Label><SignaturePad onChange={(value) => setVisit('client_signature_data_url', value)} /></div>}
            <div className="rounded-lg bg-slate-50 p-4 text-sm"><strong>Souhrn:</strong> {parseServiceLines(visitDraft.materials_text, 'material').length} položek materiálu, {parseServiceLines(visitDraft.measurements_text, 'measurement').length} měření a {visitDraft.safety_checks.filter((item) => item.checked).length}/{visitDraft.safety_checks.length} kontrol.</div>
          </div>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => visitStep === 0 ? setVisitOpen(false) : setVisitStep((step) => step - 1)}>{visitStep === 0 ? 'Zavřít' : 'Zpět'}</Button>
            {visitStep < 5 ? <Button type="button" onClick={() => setVisitStep((step) => Math.min(5, step + 1))}>Pokračovat</Button> : <Button disabled={savingVisit}>{savingVisit ? 'Ukládám…' : navigator.onLine ? 'Uložit výjezd' : 'Uložit offline'}</Button>}
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>

    <Dialog open={photoQueue.length > 0} onOpenChange={(open) => { if (!open && !uploading) { photoQueue.forEach(item => URL.revokeObjectURL(item.preview)); setPhotoQueue([]); } }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Kontrola fotografií</DialogTitle><DialogDescription>Zkontrolujte snímky před uložením. Fotografie byly zmenšeny pro rychlý přenos z mobilu.</DialogDescription></DialogHeader><div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">{photoQueue.map(item => <figure key={item.preview} className="overflow-hidden rounded-lg border bg-slate-50"><img src={item.preview} alt={item.file.name} className="aspect-square w-full object-cover" /><figcaption className="truncate p-2 text-xs">{item.file.name}</figcaption></figure>)}</div><DialogFooter><Button variant="outline" disabled={uploading} onClick={() => { photoQueue.forEach(item => URL.revokeObjectURL(item.preview)); setPhotoQueue([]); }}>Zrušit</Button><Button disabled={uploading} onClick={confirmPhotos}>{uploading ? 'Ukládám…' : navigator.onLine ? `Uložit fotografie (${photoQueue.length})` : `Uložit offline (${photoQueue.length})`}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={sendOpen} onOpenChange={setSendOpen}><DialogContent><DialogHeader><DialogTitle>Odeslat dokument k podpisu</DialogTitle><DialogDescription>Klient dostane PDF a bezpečný odkaz, na kterém dokument podepíše prstem nebo myší.</DialogDescription></DialogHeader><form onSubmit={sendDocument} className="space-y-4"><div className="space-y-2"><Label>Jméno příjemce</Label><Input required value={sendDraft.recipientName} onChange={(e) => setSendDraft((d) => ({...d,recipientName:e.target.value}))} /></div><div className="space-y-2"><Label>E-mail příjemce</Label><Input required type="email" value={sendDraft.recipientEmail} onChange={(e) => setSendDraft((d) => ({...d,recipientEmail:e.target.value}))} /></div><div className="space-y-2"><Label>Zpráva</Label><Textarea className="min-h-[160px]" required value={sendDraft.message} onChange={(e) => setSendDraft((d) => ({...d,message:e.target.value}))} /></div><div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900"><Mail className="mr-2 inline h-4 w-4" />Odkaz platí 30 dní a po podpisu se dokument uzamkne.</div><DialogFooter><Button type="button" variant="outline" onClick={() => setSendOpen(false)}>Zrušit</Button><Button disabled={sending}>{sending ? 'Odesílám…' : 'Odeslat k podpisu'}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
};

export default ServiceDetail;
