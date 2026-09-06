import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSignature, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SignaturePad from '@/components/SignaturePad';
import { supabase } from '@/lib/customSupabaseClient';
import { serviceDocumentLabels, serviceTypeLabels } from '@/lib/serviceModule';

const formatDate = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : '—';
const documentStatus = {
  sent: 'Čeká na podpis', viewed: 'Čeká na podpis', signed: 'Podepsáno', declined: 'Odmítnuto', cancelled: 'Zrušeno',
};

const DetailRow = ({ label, children }) => children ? <div className="grid gap-1 border-b border-slate-100 py-3 sm:grid-cols-[180px_1fr]"><dt className="text-sm text-slate-500">{label}</dt><dd className="whitespace-pre-wrap text-sm font-medium text-slate-900">{children}</dd></div> : null;

const ServiceSignPage = () => {
  const { token } = useParams();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [result, setResult] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ signerName: '', signerEmail: '', signatureDataUrl: '', consent: false, note: '' });

  const invoke = useCallback(async (body) => {
    const { data, error: functionError } = await supabase.functions.invoke('respond-service-document', { body: { token, ...body } });
    if (functionError || data?.error) throw new Error(data?.error || functionError?.message || 'Dokument se nepodařilo načíst.');
    return data;
  }, [token]);

  useEffect(() => {
    let active = true;
    invoke({ action: 'view' }).then((data) => {
      if (!active) return;
      setDocument(data.document); setExpired(Boolean(data.expired));
      setForm((current) => ({ ...current, signerName: data.document?.recipientName || '', signerEmail: data.document?.recipientEmail || '' }));
    }).catch((requestError) => active && setError(requestError.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [invoke]);

  const submit = async (action) => {
    if (action === 'sign' && (!form.signatureDataUrl || !form.consent)) {
      setError('Doplňte podpis a potvrďte souhlas.'); return;
    }
    if (action === 'decline' && !form.note.trim()) {
      setError('Doplňte důvod odmítnutí.'); return;
    }
    setSubmitting(true); setError('');
    try {
      await invoke({ action, ...form }); setResult(action === 'sign' ? 'signed' : 'declined');
    } catch (requestError) { setError(requestError.message); }
    setSubmitting(false);
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><Loader2 className="h-8 w-8 animate-spin text-blue-700" /><span className="ml-3 text-sm text-slate-600">Načítám dokument…</span></main>;
  if (error && !document) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-lg rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-10 w-10 text-rose-600" /><h1 className="mt-4 text-xl font-semibold">Dokument nelze otevřít</h1><p className="mt-2 text-sm text-slate-600">{error}</p></div></main>;

  const snapshot = document?.snapshot || {};
  const visit = snapshot.visit || {};
  const terminalStatus = result || document?.status;
  const terminal = ['signed', 'declined', 'cancelled'].includes(terminalStatus);

  return <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
    <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
      <header className="border-b bg-slate-950 px-5 py-6 text-white sm:px-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">EKV Project</p><h1 className="mt-2 text-2xl font-semibold">{serviceDocumentLabels[document.documentType] || 'Servisní dokument'}</h1><p className="mt-1 text-sm text-slate-300">{document.number} · {document.case?.number}</p></div><span className="w-fit rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium">{documentStatus[terminalStatus] || 'Dokument'}</span></div></header>

      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <h2 className="text-lg font-semibold text-slate-950">Přehled servisního zásahu</h2>
          <dl className="mt-3">
            <DetailRow label="Klient">{document.case?.clientName}</DetailRow>
            <DetailRow label="Technologie">{serviceTypeLabels[document.case?.systemType] || document.case?.systemType}</DetailRow>
            <DetailRow label="Místo instalace">{document.case?.installationAddress}</DetailRow>
            <DetailRow label="Termín zásahu">{formatDate(visit.completedAt || visit.startedAt || visit.scheduledStart)}</DetailRow>
            <DetailRow label="Diagnostika">{visit.diagnostics}</DetailRow>
            <DetailRow label="Zjištěná příčina">{visit.rootCause}</DetailRow>
            <DetailRow label="Provedené práce">{visit.workPerformed}</DetailRow>
            <DetailRow label="Doporučení">{visit.recommendations}</DetailRow>
            <DetailRow label="Fotodokumentace">{snapshot.photoCount ? `${snapshot.photoCount} souborů u případu` : null}</DetailRow>
          </dl>
          {document.pdfUrl && <Button asChild variant="outline" className="mt-5 w-full sm:w-auto"><a href={document.pdfUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Otevřít PDF dokument</a></Button>}
        </section>

        <aside>
          {terminal ? <div className={`rounded-xl border p-6 text-center ${terminalStatus === 'signed' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            {terminalStatus === 'signed' ? <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" /> : <XCircle className="mx-auto h-11 w-11 text-rose-600" />}
            <h2 className="mt-4 font-semibold">{terminalStatus === 'signed' ? 'Dokument byl podepsán' : terminalStatus === 'declined' ? 'Dokument byl odmítnut' : 'Dokument byl zrušen'}</h2>
            <p className="mt-2 text-sm text-slate-600">{terminalStatus === 'signed' ? `Podpis je bezpečně uložen${document.signedAt ? ` od ${formatDate(document.signedAt)}` : ''}.` : 'O změně jsme informovali servisní tým.'}</p>
          </div> : expired ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><AlertTriangle className="mb-3 h-7 w-7" /><strong>Platnost odkazu vypršela.</strong><p className="mt-2">Požádejte EKV Project o nový podpisový odkaz.</p></div> : <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div><FileSignature className="h-7 w-7 text-blue-700" /><h2 className="mt-2 font-semibold text-slate-950">Potvrzení klienta</h2><p className="mt-1 text-xs leading-5 text-slate-600">Dokument podepište prstem nebo myší. Podpis se uloží společně s časem a kontrolním otiskem.</p></div>
            <div className="space-y-2"><Label htmlFor="signer-name">Jméno a příjmení</Label><Input id="signer-name" required value={form.signerName} onChange={(event) => setForm({ ...form, signerName: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="signer-email">E-mail</Label><Input id="signer-email" type="email" value={form.signerEmail} onChange={(event) => setForm({ ...form, signerEmail: event.target.value })} /></div>
            <div className="space-y-2"><Label>Podpis</Label><SignaturePad onChange={(signatureDataUrl) => setForm({ ...form, signatureDataUrl })} /></div>
            <label className="flex gap-3 rounded-lg bg-white p-3 text-sm leading-5"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} />Potvrzuji správnost dokumentu a souhlasím s elektronickým podpisem.</label>
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <Button className="w-full" disabled={submitting} onClick={() => submit('sign')}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Podepsat dokument</Button>
            <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm text-slate-600">Dokument nesouhlasí</summary><div className="mt-3 space-y-3"><Textarea placeholder="Uveďte důvod odmítnutí" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /><Button variant="destructive" size="sm" disabled={submitting} onClick={() => submit('decline')}>Odmítnout dokument</Button></div></details>
          </div>}
        </aside>
      </div>
      <footer className="border-t bg-slate-50 px-5 py-4 text-center text-xs text-slate-500">EKV Project · bezpečný elektronický servisní protokol</footer>
    </div>
  </main>;
};

export default ServiceSignPage;
