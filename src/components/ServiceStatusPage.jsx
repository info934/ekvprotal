import React, { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, Download, MapPin, Wrench } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EkvLoader from '@/components/ui/ekv-loader';
import { formatServiceDate, serviceStatusLabels } from '@/lib/serviceModule';

export default function ServiceStatusPage() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  useEffect(() => {
    let active = true;
    supabase.functions.invoke('service-public-status', { body: { action: 'view', token } }).then(({ data, error }) => {
      if (!active) return;
      setState({ loading: false, data: data?.success ? data : null, error: data?.error || error?.message || '' });
    });
    return () => { active = false; };
  }, [token]);
  if (state.loading) return <EkvLoader title="Načítám servisní případ" description="Ověřuji bezpečný zákaznický odkaz." />;
  if (state.error || !state.data) return <main className="mx-auto flex min-h-screen max-w-xl items-center p-5"><Card className="w-full"><CardContent className="p-8 text-center"><Wrench className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-xl font-semibold">Servisní odkaz není dostupný</h1><p className="mt-2 text-sm text-slate-600">{state.error || 'Odkaz vypršel nebo byl zrušen.'}</p></CardContent></Card></main>;
  const item = state.data.serviceCase;
  return <main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-3xl space-y-5">
    <header className="rounded-2xl bg-slate-950 p-6 text-white"><p className="text-xs font-bold tracking-[0.18em] text-blue-300">EKV PROJECT · SERVIS</p><h1 className="mt-3 text-2xl font-semibold">{item.number} · {item.title}</h1><p className="mt-2 text-slate-300">{item.client_name}</p></header>
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Aktuální stav</CardTitle><Badge>{serviceStatusLabels[item.status] || item.status}</Badge></div></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><CalendarDays className="mb-2 h-5 w-5 text-blue-700" /><strong>Domluvený termín</strong><p className="mt-1 text-sm text-slate-600">{formatServiceDate(item.scheduled_start)}{item.scheduled_end ? ` – ${formatServiceDate(item.scheduled_end)}` : ''}</p></div><div className="rounded-xl bg-slate-50 p-4"><MapPin className="mb-2 h-5 w-5 text-blue-700" /><strong>Místo instalace</strong><p className="mt-1 text-sm text-slate-600">{item.installation_address || 'Bude upřesněno'}</p></div>{item.resolution_summary && <div className="rounded-xl bg-emerald-50 p-4 sm:col-span-2"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-700" /><strong>Výsledek servisu</strong><p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{item.resolution_summary}</p></div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Dokumenty pro klienta</CardTitle></CardHeader><CardContent>{state.data.documents.length ? <div className="divide-y rounded-xl border">{state.data.documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-4 p-4"><div><strong>{document.number}</strong><p className="text-sm text-slate-500">{document.title} · {document.status === 'signed' ? 'Podepsáno' : 'Odesláno'}</p></div>{document.downloadUrl && <Button asChild variant="outline" size="sm"><a href={document.downloadUrl}><Download className="mr-2 h-4 w-4" />Stáhnout</a></Button>}</div>)}</div> : <p className="text-sm text-slate-500">Zatím nejsou dostupné žádné dokumenty.</p>}</CardContent></Card>
    <p className="text-center text-xs text-slate-500">Odkaz je platný do {formatServiceDate(state.data.expiresAt)}.</p>
  </div></main>;
}
