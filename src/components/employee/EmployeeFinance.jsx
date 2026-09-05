import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import FinancialValueGuard from '@/components/FinancialValueGuard';
import { employeeFinanceView, employeeFiniteAmount, formatEmployeeMoney, employeeWorkspaceError, loadEmployeeFinance } from '@/lib/employeeWorkspaceData';

const PAYOUT_LABELS = { pending: 'Čeká na schválení', approved: 'Schváleno', invoice_uploaded: 'Doklad přiložen', paid: 'Vyplaceno', rejected: 'Zamítnuto', cancelled: 'Zrušeno' };

const panel = 'min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white';

export default function EmployeeFinance({ memberId: targetMemberId }) {
  const { memberId: actorMemberId, userRole, isPrivateMode, hasPermission } = useAuth();
  const isAdmin = userRole === 'admin';
  const isOwn = Boolean(actorMemberId && actorMemberId === targetMemberId);
  const allowed = Boolean(actorMemberId && targetMemberId && (isAdmin || isOwn));
  const key = `${actorMemberId}|${targetMemberId}|${isAdmin}`;
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (allowed) {
      setState({ key, data: null, error: null });
      loadEmployeeFinance(supabase, { actorMemberId, targetMemberId, isAdmin, signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setState({ key, data, error: null }); })
        .catch(error => { if (!controller.signal.aborted) setState({ key, data: null, error: employeeWorkspaceError(error) }); });
    }
    return () => controller.abort();
  }, [allowed, key, actorMemberId, targetMemberId, isAdmin, reload]);
  const data = state.key === key ? state.data : null;
  const view = useMemo(() => employeeFinanceView(data), [data]);
  const [payoutPage, setPayoutPage] = useState(1);
  const [rewardPage, setRewardPage] = useState(1);
  const [entitlementPage, setEntitlementPage] = useState(1);
  // Global FinancialValueGuard hides company finances from workers. This
  // explicitly self-scoped view is authorized separately, like MemberDetail.
  const value = (amount, currency = 'CZK') => isPrivateMode ? <span aria-label="Soukromý finanční údaj">Skryto</span> : isAdmin ? <FinancialValueGuard value={formatEmployeeMoney(amount, currency)} /> : isOwn ? formatEmployeeMoney(amount, currency) : 'Skryto';
  const more = (rows, page, setPage) => rows?.length > page * 20 && <div className="border-t p-4"><Button variant="outline" onClick={() => setPage(page + 1)}>Zobrazit dalších {Math.min(20, rows.length - page * 20)}</Button></div>;
  const errorBlock = section => data?.[section]?.error && <p role="alert" className="p-5 text-sm text-red-800">{data[section].error}</p>;
  if (!allowed) return <p role="alert" className="rounded-xl border bg-white p-6 text-sm text-slate-600">Tyto finanční údaje jsou dostupné jen jejich vlastníkovi a administrátorovi.</p>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{isOwn ? 'Moje finance' : 'Finance zaměstnance'}</h2><p className="mt-1 text-sm text-slate-500">Osobní sazba, nároky ze zakázek a stav výplat. Částky respektují soukromý režim.</p></div><div className="flex flex-wrap gap-2">{hasPermission('payouts', 'can_read') && <Button asChild variant="outline"><Link to="/payouts">Přejít do výplat<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>}<Button variant="ghost" size="icon" aria-label="Obnovit finance" onClick={() => setReload(current => current + 1)}><RefreshCw className="h-4 w-4" /></Button></div></div>
    {!data ? <div role={state.error ? 'alert' : 'status'} className={`${panel} flex items-center gap-3 p-6 text-sm text-slate-600`}>{state.error || <><Loader2 className="h-4 w-4 animate-spin" />Načítám finanční přehled…</>}</div> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: 'Hodinová sazba', amount: data.compensation.data?.hourly_rate, currency: data.compensation.data?.currency ?? null, suffix: '/ hod', description: data.compensation.error || 'Osobní sazba z evidence odměňování' }, { label: 'Dostupné k žádosti', amount: view.available, description: 'Nároky po odečtení rezervací a výplat' }, { label: 'Vyplaceno', amount: view.paid, description: 'Odměny i hodinové výplaty' }, { label: 'Čekající výplaty', amount: view.pending, description: 'Čeká na schválení, doklad nebo úhradu' }].map(item => <div key={item.label} className={`${panel} p-5`}><p className="text-xs text-slate-500">{item.label}</p><p className="mt-2 break-words text-2xl font-semibold tabular-nums text-slate-900">{value(item.amount, item.currency)}{item.suffix && employeeFiniteAmount(item.amount) !== null && !isPrivateMode && <span className="ml-1 text-xs font-normal text-slate-500">{item.suffix}</span>}</p><p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p></div>)}</div>
      <section className={panel}><div className="border-b p-5"><h3 className="font-semibold text-slate-900">Nároky ze zakázek</h3><p className="mt-1 text-xs text-slate-500">Dostupná částka zbývá po odečtení vyplacených odměn a otevřených žádostí o výplatu.</p></div>{errorBlock('availability')}{view.entitlements && (!view.entitlements.length ? <p className="p-5 text-sm text-slate-500">Zatím zde nejsou nároky ze zakázek.</p> : <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Zakázka', 'Celkový nárok', 'Rezervováno', 'Vyplaceno', 'Dostupné'].map(label => <th key={label} className="whitespace-nowrap px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y">{view.entitlements.slice(0, entitlementPage * 20).map(row => <tr key={`${row.kind}-${row.id}`}><td className="min-w-[210px] px-5 py-4"><Link className="font-medium text-blue-700 hover:underline" to={row.href}>{row.name || row.code || 'Zakázka'}</Link><p className="mt-1 text-xs text-slate-500">{row.kind}{row.code && ` · ${row.code}`}</p></td>{['total', 'reserved', 'paid', 'available'].map(field => <td key={field} className={`whitespace-nowrap px-5 py-4 tabular-nums ${field === 'available' ? 'font-semibold' : ''}`}>{value(row[field])}{field === 'available' && row.recommended !== null && row.available !== null && row.recommended < row.available && <p className="mt-1 text-xs font-normal text-slate-500">Kryto úhradami: {value(row.recommended)}</p>}</td>)}</tr>)}</tbody></table></div>{more(view.entitlements, entitlementPage, setEntitlementPage)}</>)}</section>
      <section className={panel}><div className="border-b p-5"><h3 className="font-semibold text-slate-900">Odměny podle projektů</h3><p className="mt-1 text-xs text-slate-500">Přehled sjednaných odměn a způsobu odměňování na jednotlivých projektech.</p></div>{errorBlock('rewards')}{data.rewards.data && (!data.rewards.data.length ? <p className="p-5 text-sm text-slate-500">Zatím není evidovaná projektová odměna.</p> : <><ul className="divide-y">{data.rewards.data.slice(0, rewardPage * 20).map(row => <li className="flex flex-wrap items-center justify-between gap-3 p-5" key={row.project_id}><div className="min-w-0"><Link className="break-words text-sm font-medium text-blue-700 hover:underline" to={`/projects/${row.project_id}`}>{row.project_name || row.project_code || 'Projekt'}</Link><p className="mt-1 text-xs text-slate-500">{row.is_hourly ? 'Hodinová odměna' : row.reward_type === 'percentage' ? 'Podílová odměna' : 'Projektová odměna'}</p></div><span className="font-semibold tabular-nums">{value(row.total_reward)}</span></li>)}</ul>{more(data.rewards.data, rewardPage, setRewardPage)}</>)}</section>
      <section className={panel}><div className="border-b p-5"><h3 className="font-semibold text-slate-900">Historie výplat</h3><p className="mt-1 text-xs text-slate-500">Paušální a hodinové žádosti o výplatu, včetně uzavřených stavů.</p></div>{errorBlock('payouts')}{errorBlock('hourly')}{view.payouts && (!view.payouts.length ? <p className="p-5 text-sm text-slate-500">{view.payoutsComplete ? 'Zatím nejsou evidované žádosti o výplatu.' : 'V dostupné části historie nejsou výplaty. Úplný přehled zobrazíte po obnovení neúspěšného načítání.'}</p> : <><ul className="divide-y">{view.payouts.slice(0, payoutPage * 20).map(row => <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-sm font-medium text-slate-900">{row.kind}</p><p className="mt-1 text-xs text-slate-500">{row.date ? new Date(row.date).toLocaleDateString('cs-CZ') : 'Datum neuvedeno'} · {PAYOUT_LABELS[row.status] || row.status}</p></div><span className="font-semibold tabular-nums">{value(row.amount)}</span>{(row.reason || row.payout_items?.length > 0) && <details className="basis-full text-sm"><summary className="cursor-pointer text-blue-700">Rozdělení výplaty a poznámka</summary>{row.reason && <p className="mt-2 whitespace-pre-wrap text-slate-600">{row.reason}</p>}<ul className="mt-2 divide-y rounded-lg border px-3">{(row.payout_items || []).map((item, index) => <li key={item.id || index} className="flex flex-wrap justify-between gap-2 py-2"><span>{item.projects?.name || item.realizations?.name || item.realization?.name || 'Zakázka'}</span><span className="tabular-nums">{value(item.amount)}</span></li>)}</ul></details>}</li>)}</ul>{more(view.payouts, payoutPage, setPayoutPage)}</>)}</section>
    </>}
  </div>;
}
