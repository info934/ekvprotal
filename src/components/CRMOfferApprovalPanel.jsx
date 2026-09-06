import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, ShieldAlert, XCircle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const reasonLabel = (reason) => reason.code === 'discount'
  ? `Sleva ${Number(reason.value).toLocaleString('cs-CZ')} % překračuje limit ${Number(reason.limit).toLocaleString('cs-CZ')} %.`
  : `Marže ${Number(reason.value).toLocaleString('cs-CZ')} % je pod limitem ${Number(reason.limit).toLocaleString('cs-CZ')} %.`;

export default function CRMOfferApprovalPanel({ document, canEdit, isAdmin, onChanged, onRequirement }) {
  const { toast } = useToast();
  const [state, setState] = useState({ loading: true, check: null, request: null });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [checkRes, requestRes] = await Promise.all([
      supabase.rpc('crm_offer_approval_check', { p_document_id: document.id }),
      supabase.from('crm_offer_approval_requests').select('*').eq('document_id', document.id).order('requested_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const check = checkRes.data || { required: false, reasons: [] };
    setState({ loading: false, check, request: requestRes.data || null });
    onRequirement?.(Boolean(check.required));
  }, [document.id, onRequirement]);
  useEffect(() => { load(); }, [load, document.approval_status]);

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('submit_crm_offer_for_approval', { p_document_id: document.id });
    setBusy(false);
    if (error) return toast({ title: 'Žádost se nepodařilo odeslat', description: error.message, variant: 'destructive' });
    toast({ title: 'Nabídka byla odeslána ke schválení' }); await load(); await onChanged?.();
  };
  const decide = async (approve) => {
    if (!state.request?.id) return;
    setBusy(true);
    const { error } = await supabase.rpc('decide_crm_offer_approval', { p_request_id: state.request.id, p_approve: approve, p_note: null });
    setBusy(false);
    if (error) return toast({ title: 'Rozhodnutí se nepodařilo uložit', description: error.message, variant: 'destructive' });
    toast({ title: approve ? 'Nabídka byla schválena' : 'Nabídka byla zamítnuta' }); await load(); await onChanged?.();
  };

  if (state.loading) return null;
  if (!state.check?.required) return <Alert className="border-emerald-200 bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-700" /><AlertTitle>Schválení není potřeba</AlertTitle><AlertDescription>Nabídka splňuje nastavené limity slevy a marže.</AlertDescription></Alert>;
  const approvalStatus = document.approval_status || state.request?.status || 'required';
  return <Alert className={approvalStatus === 'approved' ? 'border-emerald-200 bg-emerald-50' : approvalStatus === 'rejected' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}>
    <ShieldAlert className="h-4 w-4" /><AlertTitle className="flex flex-wrap items-center gap-2">Schválení nabídky <Badge variant="outline">{approvalStatus === 'approved' ? 'Schváleno' : approvalStatus === 'pending' ? 'Čeká na rozhodnutí' : approvalStatus === 'rejected' ? 'Zamítnuto' : 'Vyžadováno'}</Badge></AlertTitle>
    <AlertDescription><ul className="mt-2 list-disc space-y-1 pl-5">{(state.check.reasons || []).map((reason) => <li key={reason.code}>{reasonLabel(reason)}</li>)}</ul><div className="mt-4 flex flex-wrap gap-2">{canEdit && !isAdmin && approvalStatus !== 'pending' && approvalStatus !== 'approved' && <Button size="sm" onClick={submit} disabled={busy}><Clock3 className="mr-2 h-4 w-4" />Odeslat administrátorovi</Button>}{isAdmin && approvalStatus !== 'approved' && <Button size="sm" onClick={() => state.request?.status === 'pending' ? decide(true) : submit().then(() => {})} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" />{state.request?.status === 'pending' ? 'Schválit nabídku' : 'Vytvořit žádost'}</Button>}{isAdmin && state.request?.status === 'pending' && <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={busy}><XCircle className="mr-2 h-4 w-4" />Zamítnout</Button>}</div></AlertDescription>
  </Alert>;
}
