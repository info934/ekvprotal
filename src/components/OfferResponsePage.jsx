import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileCheck2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { formatMoney } from '@/lib/financePresentation';

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' }).format(new Date(value))
  : '-';

const OfferResponsePage = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [signerName, setSignerName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState('');

  const loadOffer = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    const { data, error } = await supabase.functions.invoke('respond-crm-commercial-offer', {
      body: { token, action: 'view' },
    });
    setState({ loading: false, error: error?.message || data?.error || '', data: data?.offer ? data : null });
  }, [token]);

  useEffect(() => { loadOffer(); }, [loadOffer]);

  const respond = async (action) => {
    if (!signerName.trim()) {
      setState((current) => ({ ...current, error: 'Doplňte jméno potvrzující osoby.' }));
      return;
    }
    if (action === 'reject' && !note.trim()) {
      setState((current) => ({ ...current, error: 'Pro odmítnutí doplňte důvod.' }));
      return;
    }
    setSubmitting(action);
    setState((current) => ({ ...current, error: '' }));
    const { data, error } = await supabase.functions.invoke('respond-crm-commercial-offer', {
      body: { token, action, signerName: signerName.trim(), note: note.trim() },
    });
    if (error || data?.error) {
      setState((current) => ({ ...current, error: data?.error || error?.message || 'Odpověď se nepodařilo uložit.' }));
    } else {
      setState((current) => ({ ...current, data: { ...current.data, status: data.status, responded: true, orderNumber: data.orderNumber } }));
    }
    setSubmitting('');
  };

  if (state.loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  );

  if (!state.data) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-lg"><CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <XCircle className="h-12 w-12 text-rose-600" />
        <h1 className="text-xl font-bold">Nabídku nelze otevřít</h1>
        <p className="text-muted-foreground">{state.error || 'Odkaz je neplatný nebo jeho platnost skončila.'}</p>
      </CardContent></Card>
    </div>
  );

  const { offer } = state.data;
  const terminal = state.data.responded || ['accepted', 'rejected'].includes(state.data.status);
  const accepted = state.data.status === 'accepted';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="h-1.5 rounded-full bg-gradient-to-r from-blue-900 via-blue-600 to-emerald-600" />
        <header className="flex flex-col gap-4 rounded-xl border bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">EKV Project</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">{offer.document.title}</h1>
            <p className="mt-1 text-slate-600">{offer.document.label} {offer.document.number}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-5 py-3 text-right">
            <p className="text-xs font-semibold uppercase text-emerald-800">Celkem s DPH</p>
            <p className="text-xl font-black text-emerald-950">{formatMoney(offer.document.totalWithTax)}</p>
          </div>
        </header>

        {terminal && <Card className={accepted ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}>
          <CardContent className="flex items-start gap-3 p-6">
            {accepted ? <CheckCircle2 className="mt-0.5 h-7 w-7 text-emerald-700" /> : <XCircle className="mt-0.5 h-7 w-7 text-rose-700" />}
            <div><h2 className="font-bold">{accepted ? 'Nabídka byla přijata' : 'Nabídka byla odmítnuta'}</h2>
              <p className="text-sm text-slate-700">{accepted && state.data.orderNumber ? `Byla vytvořena objednávka ${state.data.orderNumber}.` : 'Odpověď je uložená v EKV Portálu.'}</p>
            </div>
          </CardContent>
        </Card>}

        <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-blue-600" />Rozsah nabídky</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <div><p className="text-xs uppercase text-slate-500">Klient</p><p className="font-semibold">{offer.client.name || '-'}</p></div>
                <div><p className="text-xs uppercase text-slate-500">Projekt</p><p className="font-semibold">{offer.opportunity.projectName || offer.opportunity.title || '-'}</p></div>
                <div><p className="text-xs uppercase text-slate-500">Vystaveno</p><p>{formatDate(offer.document.issueDate)}</p></div>
                <div><p className="text-xs uppercase text-slate-500">Platnost</p><p>{formatDate(offer.document.validUntil)}</p></div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-600"><tr><th className="p-3">Položka</th><th className="p-3 text-right">Množství</th><th className="p-3 text-right">Cena bez DPH</th></tr></thead>
                  <tbody>{offer.items.map((item) => <tr key={`${item.position}-${item.code}`} className={item.includedInTotal === false ? 'border-t bg-amber-50/60' : 'border-t'}><td className="p-3"><div className="flex flex-wrap items-center gap-2"><strong>{item.name}</strong>{item.itemKind !== 'standard' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">{item.itemKind === 'alternative' ? 'Alternativa' : 'Volitelné'}</span>}</div>{item.description && <p className="text-xs text-slate-500">{item.description}</p>}</td><td className="p-3 text-right">{item.quantity} {item.unit}</td><td className="p-3 text-right font-semibold">{item.includedInTotal === false ? `${formatMoney(Number(item.quantity || 0) * Number(item.unitPrice || 0))} volitelně` : formatMoney(item.lineTotal)}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="ml-auto grid max-w-sm gap-2 text-sm"><div className="flex justify-between"><span>Cena bez DPH</span><strong>{formatMoney(offer.document.total)}</strong></div><div className="flex justify-between"><span>DPH</span><strong>{formatMoney(offer.document.taxTotal)}</strong></div><div className="flex justify-between rounded-lg bg-emerald-50 p-3 text-base"><span>Celkem s DPH</span><strong>{formatMoney(offer.document.totalWithTax)}</strong></div></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vyjádření klienta</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><ShieldCheck className="h-5 w-5 shrink-0" /><span>Odpověď se bezpečně uloží k přesné verzi nabídky.</span></div>
              {!terminal && !state.data.expired ? <>
                <div className="space-y-2"><Label htmlFor="signer-name">Jméno a příjmení</Label><Input id="signer-name" value={signerName} onChange={(event) => setSignerName(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="response-note">Poznámka</Label><Textarea id="response-note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="Volitelné upřesnění" /></div>
                {state.error && <p className="text-sm font-medium text-rose-700">{state.error}</p>}
                <Button className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={() => respond('accept')} disabled={Boolean(submitting)}>{submitting === 'accept' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Přijmout nabídku</Button>
                <Button className="w-full" variant="outline" onClick={() => respond('reject')} disabled={Boolean(submitting)}>{submitting === 'reject' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Odmítnout nabídku</Button>
              </> : !terminal && <p className="text-sm text-rose-700">Platnost odkazu skončila. Kontaktujte EKV Project.</p>}
              <p className="text-xs text-slate-500">Odkaz platí do {formatDate(state.data.responseExpiresAt)}.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
};

export default OfferResponsePage;
