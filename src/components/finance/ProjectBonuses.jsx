import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FinanceAmount } from './FinanceWorkspace';

export default function ProjectBonuses({ projectId, members, available, disabled, onSaved }) {
  const { isAdmin } = useAuth();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (isAdmin) supabase.from('project_bonuses').select('id,member_id,amount,reason,created_at')
      .eq('project_id', projectId).order('created_at', { ascending: false }).limit(100).abortSignal(controller.signal)
      .then(({ data, error: failure }) => { if (!controller.signal.aborted) { setRows(data || []); setError(failure ? 'Historii bonusů se nepodařilo načíst.' : ''); } });
    return () => controller.abort();
  }, [projectId, isAdmin, reload]);
  if (!isAdmin) return null;
  const today = new Date().toLocaleDateString('en-CA');
  const eligible = members.filter(row => !row.ended_at && (!row.valid_from || row.valid_from <= today) && (!row.valid_to || row.valid_to >= today));
  const save = async event => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); setMessage('');
    try {
      const { data, error: failure } = await supabase.rpc('award_project_bonus', {
        p_id: draft.id, p_project_id: projectId, p_member_id: draft.member,
        p_amount: Number(draft.amount), p_reason: draft.reason.trim(),
      });
      if (failure) throw failure;
      if (!data?.id) throw new Error('Uložení bonusu nebylo potvrzeno. Zkuste požadavek zopakovat.');
      setDraft(null); setReload(value => value + 1);
      setMessage('Bonus byl přidělen a oznámení doručeno do portálu příjemce.');
      await onSaved();
    } catch (failure) { setMessage(failure.message || 'Bonus se nepodařilo uložit.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border bg-white p-5 space-y-4" aria-label="Mimořádné bonusy">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Mimořádné bonusy</h3><p className="text-sm text-muted-foreground">Z nerozděleného rozpočtu, bez změny sjednaných podílů. Výplata probíhá běžnou žádostí.</p><p className="mt-2 text-sm">Zbývá k přidělení: <FinanceAmount value={available} /></p></div>
      {!draft && <Button disabled={disabled || !(available >= 0.01) || !eligible.length || !!error} onClick={() => { setMessage(''); setDraft({ id: crypto.randomUUID(), member: '', amount: '', reason: '' }); }}>Přidělit bonus</Button>}</div>
    {draft && <form onSubmit={save} className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
      <label className="text-sm">Člen projektu<select required disabled={busy} className="mt-1 w-full rounded-md border bg-white p-2" value={draft.member} onChange={event => setDraft({ ...draft, member: event.target.value })}><option value="">Vyberte příjemce</option>{eligible.map(row => <option key={row.id} value={row.member_id}>{row.member?.name || row.member_id}</option>)}</select></label>
      <label className="text-sm">Částka v Kč<Input required type="number" min="0.01" max={available} step="0.01" disabled={busy} value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
      <label className="text-sm sm:col-span-2">Za co bonus přidělujete<Textarea required minLength={3} maxLength={2000} disabled={busy} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Příjemce dostane oznámení s částkou a důvodem. Přidělený bonus se stane součástí jeho nároku na odměnu.</p>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy || disabled}>{busy ? 'Přiděluji…' : 'Potvrdit přidělení'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Zrušit</Button></div>
    </form>}
    {message && <p role="status" className="text-sm">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!error && (rows.length ? <ul className="divide-y">{rows.map(row => <li key={row.id} className="py-3"><div className="flex justify-between gap-3"><strong className="text-sm">{members.find(member => member.member_id === row.member_id)?.member?.name || 'Člen projektu'}</strong><FinanceAmount value={row.amount} /></div><p className="whitespace-pre-wrap break-words text-sm">{row.reason}</p><p className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString('cs-CZ')}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">Zatím nebyl přidělen žádný mimořádný bonus.</p>)}
    {rows.length === 100 && <p className="text-xs text-muted-foreground">Zobrazeno posledních 100 bonusů.</p>}
  </section>;
}
