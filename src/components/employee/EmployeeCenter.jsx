import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Car, Check, ChevronRight, ClipboardList, ExternalLink, FileCheck2, FileText, KeyRound, Laptop, Loader2, Package, Plus, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import PageHeader from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent, FormDialogHeader, FormDialogBody, FormDialogFooter } from '@/components/ui/form-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EMPLOYMENT_STATUSES, EMPLOYEE_ASSET_TYPES, EMPLOYEE_RECORD_KINDS, EMPLOYEE_RECORD_STATUSES, EMPLOYEE_REQUEST_TYPES, EMPLOYEE_REQUEST_STATUSES, employeeRequestTransitions, isSafeEmployeeReferenceUrl } from '@/lib/employeeWorkspace';
import { employeeLocalDate, employeeRecordValidity, employeeWorkspaceError, loadEmployeeWorkspace, saveEmployeeMutation } from '@/lib/employeeWorkspaceData';
import EmployeeFinance from './EmployeeFinance';

const TAB_LABELS = { overview: 'Přehled', assets: 'Majetek', records: 'Smlouvy a ověření', requests: 'Žádosti', finance: 'Finance' };
const ACTION_LABELS = { approved: 'Schválit', rejected: 'Zamítnout', fulfilled: 'Označit jako vyřízené', cancelled: 'Zrušit žádost' };
const ASSET_ICONS = { vehicle: Car, key: KeyRound, device: Laptop, license: ShieldCheck, other: Package };
const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('cs-CZ') : 'Neuvedeno';
const money = value => value == null ? 'Neuvedeno' : `${Number(value).toLocaleString('cs-CZ')} Kč`;
const requestTone = status => ({ approved: 'success', fulfilled: 'success', pending: 'warning', rejected: 'danger' }[status] || 'neutral');

function Pill({ tone = 'neutral', children }) {
  const tones = { success: 'bg-emerald-50 text-emerald-800', warning: 'bg-amber-50 text-amber-900', danger: 'bg-red-50 text-red-800', neutral: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-flex max-w-full items-center rounded-md px-2 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
function Panel({ title, description, action, children }) {
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="text-base font-semibold text-slate-900">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>{action}</div>{children}</section>;
}
function Empty({ children }) { return <p className="p-6 text-sm leading-6 text-slate-500">{children}</p>; }
function Field({ name, label, form, setForm, options, textarea = false, hint, ...props }) {
  const id = `employee-${name}`;
  const shared = { id, name, value: form[name] ?? '', onChange: event => setForm(current => ({ ...current, [name]: event.target.value })), ...props };
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium text-slate-800">{label}</label>{options ? <select {...shared} className={selectClass}>{Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select> : textarea ? <Textarea {...shared} rows={4} /> : <Input {...shared} />}{hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}</div>;
}

function AssetList({ assets, isAdmin, onEdit, onReturn, compact = false }) {
  if (!assets.length) return <Empty>Zatím zde není žádné evidované vybavení.</Empty>;
  return <ul className="divide-y divide-slate-100">{assets.map(asset => {
    const Icon = ASSET_ICONS[asset.asset_type] || Package;
    return <li key={asset.id} className="flex gap-3 p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words text-sm font-semibold text-slate-900">{asset.label}</h3><Pill tone={asset.status === 'returned' ? 'neutral' : 'success'}>{asset.status === 'returned' ? 'Vráceno' : EMPLOYEE_ASSET_TYPES[asset.asset_type]}</Pill></div><p className="mt-1 break-words text-xs text-slate-500">{asset.identifier || 'Bez inventárního označení'}</p>{!compact && <><p className="mt-3 text-xs text-slate-500">Předáno {dateLabel(asset.assigned_on)}{asset.due_on && ` · Vrátit do ${dateLabel(asset.due_on)}`}{asset.returned_on && ` · Vráceno ${dateLabel(asset.returned_on)}`}</p>{asset.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{asset.note}</p>}{asset.status === 'issued' && asset.due_on && asset.due_on < employeeLocalDate() && <p className="mt-2 text-xs font-medium text-amber-800">Termín plánovaného vrácení již uplynul.</p>}{isAdmin && asset.status === 'issued' && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onEdit(asset)}>Upravit</Button><Button size="sm" variant="ghost" onClick={() => onReturn(asset)}>Evidovat vrácení</Button></div>}</>}</div></li>;
  })}</ul>;
}
function RecordList({ records, isAdmin, onEdit, compact = false }) {
  if (!records.length) return <Empty>Smlouvy, školení a ověření se zobrazí po jejich zaevidování administrátorem.</Empty>;
  return <ul className="divide-y divide-slate-100">{records.map(record => {
    const validity = employeeRecordValidity(record);
    return <li key={record.id} className="flex gap-3 p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><FileText className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words text-sm font-semibold text-slate-900">{record.title}</h3><Pill tone={validity.tone}>{validity.label}</Pill></div><p className="mt-1 text-xs text-slate-500">{EMPLOYEE_RECORD_KINDS[record.kind]}{record.valid_until ? ` · Platí do ${dateLabel(record.valid_until)}` : ' · Konec platnosti neuveden'}</p>{!compact && <><p className="mt-3 text-xs text-slate-500">Platnost od {dateLabel(record.valid_from)}{record.verified_at && ` · Ověřeno ${dateLabel(record.verified_at)}`}</p>{record.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{record.note}</p>}<div className="mt-3 flex flex-wrap gap-2">{record.reference_url && isSafeEmployeeReferenceUrl(record.reference_url) && <Button size="sm" variant="outline" asChild><a href={record.reference_url} target="_blank" rel="noopener noreferrer">Otevřít dokument<ExternalLink className="ml-2 h-3.5 w-3.5" /></a></Button>}{isAdmin && <Button size="sm" variant="ghost" onClick={() => onEdit(record)}>Upravit záznam</Button>}</div></>}</div></li>;
  })}</ul>;
}

function RequestsPanel({ requests, events, isAdmin, actorMemberId, activeEmployee, queue, onTransition, compact = false, onShowAll }) {
  const { isPrivateMode } = useAuth();
  const [filter, setFilter] = useState(queue ? 'open' : 'all');
  const [expanded, setExpanded] = useState(null);
  const shown = requests.filter(request => filter === 'all' || (filter === 'open' ? ['pending', 'approved'].includes(request.status) : request.status === filter));
  return <Panel title={queue ? 'Žádosti zaměstnanců' : 'Žádosti'} description={queue ? 'Schválení, zamítnutí a evidence vyřízení.' : 'Vyřizuje administrátor. U každé žádosti najdete aktuální stav i historii.'} action={compact ? <Button variant="ghost" size="sm" onClick={onShowAll}>Všechny žádosti<ChevronRight className="ml-1 h-4 w-4" /></Button> : <label className="flex items-center gap-2 text-xs text-slate-500">Stav<select aria-label="Filtrovat žádosti podle stavu" value={filter} onChange={event => setFilter(event.target.value)} className={`${selectClass} max-w-[220px]`}><option value="all">Všechny ({requests.length})</option><option value="open">Otevřené</option>{Object.entries(EMPLOYEE_REQUEST_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}>
    {!shown.length ? <Empty>{requests.length ? 'Tomuto filtru neodpovídá žádná žádost.' : 'Zatím nejsou žádné žádosti. Požádat můžete o školení, licenci nebo vybavení.'}</Empty> : <ul className="divide-y divide-slate-100">{(compact ? shown.slice(0, 3) : shown).map(request => {
      const transitions = employeeRequestTransitions(request.status, { isAdmin, isOwner: activeEmployee && request.member_id === actorMemberId });
      return <li key={request.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold text-slate-900">{request.title}</h3><p className="mt-1 text-xs text-slate-500">{EMPLOYEE_REQUEST_TYPES[request.request_type]} · Podáno {dateLabel(request.created_at)}{queue && <> · <Link className="text-blue-700 hover:underline" to={`/members/${request.member_id}?tab=requests`}>{request.member?.name || 'Zaměstnanec'}</Link></>}</p></div><Pill tone={requestTone(request.status)}>{EMPLOYEE_REQUEST_STATUSES[request.status] || request.status}</Pill></div>{request.decision_note && <p className={`mt-3 rounded-lg p-3 text-sm ${request.status === 'rejected' ? 'bg-red-50 text-red-900' : 'bg-slate-50 text-slate-700'}`}><strong>{request.status === 'rejected' ? 'Důvod zamítnutí: ' : 'Vyjádření administrátora: '}</strong>{request.decision_note}</p>}<div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" className="px-0 text-blue-700" aria-expanded={expanded === request.id} onClick={() => setExpanded(current => current === request.id ? null : request.id)}>{expanded === request.id ? 'Skrýt detail' : 'Detail a historie'}</Button>{!compact && transitions.map(status => <Button key={status} size="sm" variant={status === 'approved' ? 'default' : 'outline'} onClick={() => onTransition(request, status)}>{ACTION_LABELS[status]}</Button>)}</div>{expanded === request.id && <div className="mt-3 space-y-4 rounded-lg border border-slate-100 bg-slate-50 p-4"><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.description}</p><dl className="flex flex-wrap gap-x-8 gap-y-3 text-xs"><div><dt className="text-slate-500">Požadovaný termín</dt><dd className="mt-1">{dateLabel(request.requested_for)}</dd></div><div><dt className="text-slate-500">Odhad ceny</dt><dd className="mt-1">{isPrivateMode ? 'Skryto' : money(request.estimated_cost)}</dd></div></dl><div><h4 className="text-xs font-semibold text-slate-700">Historie žádosti</h4><ol className="mt-2 space-y-3">{events.filter(event => event.request_id === request.id).map(event => <li key={event.id} className="border-l-2 border-slate-200 pl-3 text-xs"><p className="text-slate-800">{EMPLOYEE_REQUEST_STATUSES[event.to_status] || event.to_status} · {event.actor_name || 'Uživatel'}</p><p className="mt-1 text-slate-500">{new Date(event.created_at).toLocaleString('cs-CZ')}</p>{event.note && <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{event.note}</p>}</li>)}</ol>{!events.some(event => event.request_id === request.id) && <p className="mt-2 text-xs text-slate-500">Historie není k dispozici.</p>}</div></div>}</li>;
    })}</ul>}
  </Panel>;
}

function EmployeeEditor({ editor, busy, error, onClose, onSave }) {
  const [form, setForm] = useState(editor.form);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(editor.form);
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const close = () => { if (!busy) { if (dirty) setConfirmDiscard(true); else onClose(); } };
  const field = (name, label, props = {}) => <Field name={name} label={label} form={form} setForm={setForm} disabled={busy} {...props} />;
  const title = { request: 'Nová žádost', asset: form.id ? 'Upravit majetek' : 'Předat majetek zaměstnanci', record: form.id ? 'Upravit záznam' : 'Nová smlouva nebo ověření', profile: 'Zaměstnanecký status', return: 'Evidovat vrácení majetku', transition: ACTION_LABELS[form.status] }[editor.kind];
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><FormDialogContent><FormDialogHeader title={title} icon={editor.kind === 'request' ? ClipboardList : FileCheck2} description={editor.kind === 'request' ? 'Popište, co potřebujete. Žádost vyřídí administrátor.' : 'Změny se uloží až po potvrzení formuláře.'} /><FormDialogBody><form id="employee-editor" onSubmit={event => { event.preventDefault(); onSave(form); }} className="space-y-5">
    {editor.kind === 'request' && <>{field('request_type', 'Typ žádosti', { options: EMPLOYEE_REQUEST_TYPES })}{field('title', 'Předmět žádosti', { required: true, maxLength: 200, placeholder: 'Např. školení projektování fotovoltaiky' })}{field('description', 'Co potřebujete a proč', { textarea: true, required: true, maxLength: 4000 })}<div className="grid gap-5 sm:grid-cols-2">{field('estimated_cost', 'Odhad ceny v Kč (volitelné)', { inputMode: 'decimal', placeholder: 'Není znám' })}{field('requested_for', 'Požadovaný termín (volitelné)', { type: 'date' })}</div></>}
    {editor.kind === 'asset' && <>{field('asset_type', 'Druh majetku', { options: EMPLOYEE_ASSET_TYPES })}{field('label', 'Název majetku', { required: true, maxLength: 200 })}{field('identifier', 'Inventární / veřejný identifikátor', { maxLength: 200, hint: 'Např. inventární číslo nebo SPZ. Nevkládejte hesla ani aktivační klíče licencí.' })}<div className="grid gap-5 sm:grid-cols-2">{field('assigned_on', 'Datum předání', { required: true, type: 'date' })}{field('due_on', 'Plánované vrácení (volitelné)', { type: 'date' })}</div>{field('note', 'Poznámka', { textarea: true, maxLength: 4000 })}</>}
    {editor.kind === 'return' && <><p className="text-sm text-slate-600">Majetek <strong>{form.label}</strong> bude vedený jako vrácený. Záznam zůstane v historii zaměstnance.</p>{field('returned_on', 'Datum vrácení', { type: 'date', required: true })}{field('note', 'Poznámka k vrácení', { textarea: true, maxLength: 4000 })}</>}
    {editor.kind === 'record' && <>{field('title', 'Název záznamu', { required: true, maxLength: 200 })}<div className="grid gap-5 sm:grid-cols-2">{field('kind', 'Druh dokumentu', { options: EMPLOYEE_RECORD_KINDS })}{field('status', 'Stav ověření', { options: EMPLOYEE_RECORD_STATUSES })}</div><div className="grid gap-5 sm:grid-cols-2">{field('valid_from', 'Platnost od (volitelné)', { type: 'date' })}{field('valid_until', 'Platnost do (volitelné)', { type: 'date' })}</div>{field('reference_url', 'Odkaz na dokument (volitelné)', { type: 'url', placeholder: 'https://…', maxLength: 2000, hint: 'Použijte chráněné firemní úložiště. Odkaz neposkytuje automaticky přístup k dokumentu.' })}{field('note', 'Poznámka', { textarea: true, maxLength: 4000 })}</>}
    {editor.kind === 'profile' && <>{field('employment_status', 'Zaměstnanecký status', { options: EMPLOYMENT_STATUSES })}<p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{form.employment_status === 'active' ? 'Potvrzením zpřístupníte zaměstnanci jeho kartu a podávání žádostí.' : 'Potvrzením vypnete zaměstnaneckou samoobsluhu. Historie zůstane dostupná administrátorovi.'} Přihlašovací role účtu se nemění.</p>{field('note', 'Poznámka k zaměstnanecké kartě', { textarea: true, maxLength: 4000 })}</>}
    {editor.kind === 'transition' && <><p className="text-sm text-slate-600">Žádost: <strong>{editor.request.title}</strong></p><p className="text-sm text-slate-500">{form.status === 'fulfilled' ? 'Potvrďte skutečné vyřízení žádosti. Předání majetku nebo evidenci školení doplňte v příslušné záložce.' : form.status === 'cancelled' ? 'Zrušenou žádost již nebude administrátor schvalovat.' : 'Žadatel uvidí změnu stavu i vaše vyjádření.'}</p>{field('note', form.status === 'rejected' ? 'Důvod zamítnutí' : 'Vyjádření (volitelné)', { textarea: true, required: form.status === 'rejected', maxLength: 4000 })}</>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </form></FormDialogBody><FormDialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Zrušit</Button><Button type="submit" form="employee-editor" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? 'Ukládám…' : editor.kind === 'request' ? 'Odeslat žádost' : editor.kind === 'transition' ? ACTION_LABELS[form.status] : 'Potvrdit a uložit'}</Button></FormDialogFooter></FormDialogContent></Dialog><AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Zahodit rozepsané změny?</AlertDialogTitle><AlertDialogDescription>Údaje z tohoto formuláře ještě nejsou uložené.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Pokračovat v úpravách</AlertDialogCancel><AlertDialogAction onClick={onClose}>Zahodit změny</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

export default function EmployeeCenter({ embedded = false, targetId, tab, allRequests = false }) {
  const { memberId, userRole, loading: authLoading, permissionsReady } = useAuth();
  const { employeeMemberId } = useParams();
  const [search, setSearch] = useSearchParams();
  const isAdmin = userRole === 'admin';
  const targetMemberId = targetId || employeeMemberId || memberId;
  const scopeAll = !embedded && (allRequests || search.get('scope') === 'all');
  const selectedTab = tab || (scopeAll ? 'requests' : (TAB_LABELS[search.get('tab')] ? search.get('tab') : 'overview'));
  const key = `${memberId}|${targetMemberId}|${isAdmin}|${scopeAll}`;
  const liveKey = useRef(key); liveKey.current = key;
  const [state, setState] = useState({ key: null, loading: true, data: null, error: null });
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [assetFilter, setAssetFilter] = useState('issued');
  const inFlight = useRef(false);
  const abort = useRef(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const run = ++revision.current;
    setState({ key, loading: true, data: null, error: null });
    try {
      const data = await loadEmployeeWorkspace(supabase, { actorMemberId: memberId, targetMemberId, isAdmin, scopeAll, signal: controller.signal });
      if (run === revision.current && !controller.signal.aborted) setState({ key, loading: false, data, error: null });
    } catch (error) { if (run === revision.current && !controller.signal.aborted) setState({ key, loading: false, data: null, error: employeeWorkspaceError(error) }); }
  }, [key, memberId, targetMemberId, isAdmin, scopeAll]);
  useEffect(() => { if (!authLoading && permissionsReady) void refresh(); return () => abort.current?.abort(); }, [refresh, authLoading, permissionsReady]);
  const data = state.key === key ? state.data : null;
  const activeEmployee = data?.profile?.employment_status === 'active';
  const isOwn = Boolean(memberId && targetMemberId === memberId);
  const canFinance = Boolean(memberId && targetMemberId && (isOwn || isAdmin) && !scopeAll);
  const openEditor = useCallback((kind, form, request = null) => { setSaveError(null); setEditor({ kind, form, request, key }); }, [key]);
  const newRequest = useCallback(() => openEditor('request', { id: crypto.randomUUID(), request_type: 'training', title: '', description: '', estimated_cost: '', requested_for: '' }), [openEditor]);
  const deepLinkOpened = useRef(null);
  useEffect(() => {
    if (search.get('new') !== 'request') { deepLinkOpened.current = null; return; }
    if (data?.access === 'ready' && activeEmployee && isOwn && !scopeAll && deepLinkOpened.current !== key) { deepLinkOpened.current = key; newRequest(); }
  }, [data?.access, activeEmployee, isOwn, scopeAll, key, search, newRequest]);
  const closeEditor = () => { setEditor(null); setSaveError(null); if (search.has('new')) { const next = new URLSearchParams(search); next.delete('new'); setSearch(next, { replace: true }); } };
  const changeTab = tab => { const next = new URLSearchParams(search); next.set('tab', tab); next.delete('new'); next.delete('scope'); setSearch(next); };
  const save = async form => {
    if (inFlight.current || !editor || editor.key !== key) return;
    inFlight.current = true; setBusy(true); setSaveError(null);
    try {
      await saveEmployeeMutation(supabase, editor.kind, form, { isAdmin, actorMemberId: memberId, targetMemberId, activeEmployee, request: editor.request });
      if (liveKey.current === key) { closeEditor(); setNotice({ key, text: editor.kind === 'request' ? 'Žádost byla odeslána administrátorovi.' : 'Změny byly uloženy.' }); await refresh(); }
    } catch (error) { if (liveKey.current === key) setSaveError(employeeWorkspaceError(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const onEditAsset = asset => openEditor('asset', asset || { create_id: crypto.randomUUID(), asset_type: 'device', label: '', identifier: '', assigned_on: employeeLocalDate(), due_on: '', note: '' });
  const onEditRecord = record => openEditor('record', record || { create_id: crypto.randomUUID(), title: '', kind: 'contract', status: 'pending', valid_from: '', valid_until: '', reference_url: '', note: '' });
  const requestProps = { requests: data?.requests || [], events: data?.events || [], isAdmin, actorMemberId: memberId, activeEmployee, queue: scopeAll, onTransition: (request, status) => openEditor('transition', { status, note: '' }, request) };
  const issued = useMemo(() => (data?.assets || []).filter(asset => asset.status === 'issued'), [data?.assets]);
  const expiring = useMemo(() => (data?.records || []).filter(record => record.status === 'verified' && record.valid_until && record.valid_until >= employeeLocalDate() && employeeRecordValidity(record).tone === 'warning'), [data?.records]);
  const openRequests = (data?.requests || []).filter(request => ['pending', 'approved'].includes(request.status));
  const pendingView = authLoading || !permissionsReady || state.key !== key || state.loading;
  const access = data?.access;
  const TabRoot = embedded ? 'div' : Tabs;
  const TabPanel = embedded ? 'div' : TabsContent;
  const unavailable = ['missing-member', 'forbidden', 'not-found', 'inactive'].includes(access);
  return <div className={embedded ? "space-y-5" : "app-page-wide space-y-6 pb-8"}>
    {!embedded && <PageHeader title={scopeAll ? 'Žádosti zaměstnanců' : isOwn ? 'Moje karta' : 'Karta zaměstnance'} description={scopeAll ? 'Přehled požadavků, které vyřizuje administrátor.' : 'Vybavení, dokumenty, žádosti a finance na jednom místě.'} actions={<div className="flex flex-wrap gap-2">{isAdmin && !scopeAll && <Button asChild variant="outline"><Link to="/members?view=requests">Žádosti ke schválení</Link></Button>}{isOwn && activeEmployee && !scopeAll && <Button onClick={newRequest}><Plus className="mr-2 h-4 w-4" />Nová žádost</Button>}{scopeAll && <Button asChild variant="outline"><Link to="/members">Zpět na zaměstnance</Link></Button>}</div>} />}
    {notice?.key === key && <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check className="h-4 w-4" />{notice.text}</p>}
    {!embedded && canFinance && (unavailable || access === 'needs-profile' || state.error) && <div className="flex flex-wrap gap-2"><Button variant={selectedTab === 'finance' ? 'default' : 'outline'} onClick={() => changeTab('finance')}>Moje finance</Button><Button variant="ghost" onClick={() => changeTab('overview')}>Zaměstnanecká karta</Button></div>}
    {selectedTab === 'finance' && canFinance && !pendingView && (unavailable || access === 'needs-profile' || state.error) ? <EmployeeFinance memberId={targetMemberId} /> : pendingView ? <div role="status" className="flex items-center gap-3 rounded-xl border bg-white p-8 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Načítám zaměstnaneckou kartu…</div> : state.error ? <Panel title="Kartu se nepodařilo načíst"><div className="space-y-4 p-6"><p role="alert" className="text-sm text-red-700">{state.error}</p><Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Zkusit znovu</Button></div></Panel> : unavailable ? <Panel title={access === 'inactive' ? 'Zaměstnanecká samoobsluha není aktivní' : 'Karta není dostupná'}><Empty>{access === 'missing-member' ? 'Účet zatím není propojený s členem týmu. Propojení provede administrátor.' : access === 'inactive' ? 'Administrátor může zaměstnaneckou kartu aktivovat. Finanční přehled je dál dostupný v záložce Finance.' : 'Tuto zaměstnaneckou kartu nemůžete zobrazit, nebo již neexistuje.'}</Empty></Panel> : access === 'queue' ? <RequestsPanel key={key} {...requestProps} /> : data && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-800"><User className="h-5 w-5" /></span><div className="min-w-0">{!embedded && <p className="break-words font-semibold text-slate-900">{data.member?.name || 'Zaměstnanec'}</p>}<p className="mt-0.5 break-words text-sm text-slate-500">{[data.member?.job_title, data.member?.department, data.profile ? EMPLOYMENT_STATUSES[data.profile.employment_status] : 'Zaměstnanecký profil není vytvořen'].filter(Boolean).join(' · ')}</p></div></div>{isAdmin && <Button variant="outline" size="sm" onClick={() => openEditor('profile', { employment_status: data.profile?.employment_status || 'active', note: data.profile?.note || '' })}>{data.profile ? 'Upravit zaměstnanecký status' : 'Označit jako zaměstnance'}</Button>}</div>
      {access === 'needs-profile' ? <Panel title="Aktivujte zaměstnaneckou kartu"><Empty>Člen týmu zatím není označený jako zaměstnanec. Tlačítkem „Označit jako zaměstnance“ potvrďte aktivaci karty, evidenci vybavení a podávání žádostí.</Empty></Panel> : <>
        {!activeEmployee && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Zaměstnanecká samoobsluha je neaktivní. Administrátor může spravovat evidenci a vyřídit dřívější žádosti.</p>}
        <TabRoot {...(!embedded ? { value: selectedTab, onValueChange: changeTab } : {})}>{!embedded && <TabsList aria-label="Záložky zaměstnanecké karty">{Object.entries(TAB_LABELS).map(([value, label]) => <TabsTrigger value={value} key={value}>{label}</TabsTrigger>)}</TabsList>}<TabPanel {...(!embedded ? { value: selectedTab } : {})} className="space-y-5 pt-4">
        {selectedTab === 'overview' && <>
          <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">{[{ value: issued.length, label: 'Přidělený majetek', icon: Package, tab: 'assets' }, { value: expiring.length, label: 'Platnost končí do 30 dní', icon: FileCheck2, tab: 'records' }, { value: openRequests.length, label: 'Otevřené žádosti', icon: ClipboardList, tab: 'requests' }].map(({ value, label, icon: Icon, tab }) => <button key={tab} onClick={() => changeTab(tab)} className="flex items-center gap-4 bg-white p-5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-blue-600"><Icon className="h-6 w-6 shrink-0 text-blue-700" /><div><span className="text-2xl font-semibold tabular-nums text-slate-900">{value}</span><p className="mt-1 text-xs text-slate-500">{label}</p></div><ArrowRight className="ml-auto h-4 w-4 text-slate-400" /></button>)}</div>
          {!embedded && <><div className="grid items-start gap-5 lg:grid-cols-2"><Panel title={isOwn ? "Moje vybavení" : "Přidělené vybavení"} action={<Button variant="ghost" size="sm" onClick={() => changeTab('assets')}>Zobrazit vše<ChevronRight className="ml-1 h-4 w-4" /></Button>}><AssetList assets={issued.slice(0, 4)} compact /></Panel><Panel title="Smlouvy a ověření" action={<Button variant="ghost" size="sm" onClick={() => changeTab('records')}>Zobrazit vše<ChevronRight className="ml-1 h-4 w-4" /></Button>}><RecordList records={data.records.slice(0, 4)} compact /></Panel></div>
          <RequestsPanel key={`${key}-overview`} {...requestProps} compact onShowAll={() => changeTab('requests')} /></>}
        </>}
        {selectedTab === 'assets' && <Panel title="Přidělený majetek" description="Auta, klíče, technika a licence evidované na této kartě." action={<div className="flex flex-wrap gap-2"><select aria-label="Zobrazit majetek podle stavu" className={`${selectClass} w-auto`} value={assetFilter} onChange={event => setAssetFilter(event.target.value)}><option value="issued">Aktuálně přidělený</option><option value="returned">Vrácený</option><option value="all">Celá historie</option></select>{isAdmin && <Button onClick={() => onEditAsset()}><Plus className="mr-2 h-4 w-4" />Přidat majetek</Button>}</div>}><AssetList assets={data.assets.filter(asset => assetFilter === 'all' || asset.status === assetFilter)} isAdmin={isAdmin} onEdit={onEditAsset} onReturn={asset => openEditor('return', { id: asset.id, label: asset.label, assigned_on: asset.assigned_on, returned_on: employeeLocalDate(), note: '' })} /></Panel>}
        {selectedTab === 'records' && <Panel title="Smlouvy a ověření" description="Platnosti dokumentů a odkaz na jejich zabezpečené uložení." action={isAdmin && <Button onClick={() => onEditRecord()}><Plus className="mr-2 h-4 w-4" />Přidat záznam</Button>}><RecordList records={data.records} isAdmin={isAdmin} onEdit={onEditRecord} /></Panel>}
        {selectedTab === 'requests' && <RequestsPanel key={key} {...requestProps} />}
        {selectedTab === 'finance' && <EmployeeFinance memberId={targetMemberId} />}</TabPanel></TabRoot>
      </>}
    </>}
    {editor?.key === key && <EmployeeEditor key={`${key}-${editor.kind}-${editor.form.id || editor.form.create_id || editor.request?.id || 'new'}`} editor={editor} busy={busy} error={saveError} onClose={closeEditor} onSave={save} />}
  </div>;
}
