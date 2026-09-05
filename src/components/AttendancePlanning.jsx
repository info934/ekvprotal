import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { eachDayOfInterval, endOfMonth, format, getDay, isToday, startOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { attendanceMonthRange, fetchAllAttendanceRows } from '@/lib/attendanceWorkspace';
import { PLAN_LABELS, planHours, planPayload, planTime, planningTotals } from '@/lib/attendancePlanning';
import { AttendanceLoadState, AttendanceMonthControl } from './AttendanceWorkspaceParts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';

export default function AttendancePlanning({ memberId }) {
  const { hasPermission, isAdmin } = useAuth();
  const manage = isAdmin || hasPermission('attendance', 'can_admin');
  const editable = manage || hasPermission('attendance', 'can_edit');
  const [params, setParams] = useSearchParams();
  const candidate = (params.get('month') || '').slice(0, 7);
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : format(new Date(), 'yyyy-MM');
  const month = useMemo(() => new Date(`${monthKey}-01T12:00:00`), [monthKey]);
  const [selectedMember, setSelectedMember] = useState(memberId);
  const target = manage ? selectedMember || memberId : memberId;
  const [selectedDay, setSelectedDay] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const loadMembers = useCallback(signal => fetchAllAttendanceRows(() => supabase.from('members').select('id,name').eq('attendance_enabled', true).order('name').order('id'), signal), []);
  const members = useAttendanceResource('planning-members', loadMembers, manage);
  const load = useCallback(signal => {
    const range = attendanceMonthRange(month);
    return fetchAllAttendanceRows(() => supabase.from('attendance_plans').select('id,member_id,date,start_minute,end_minute,break_minutes,kind,note,version,cancelled')
      .eq('member_id', target).eq('cancelled', false).gte('date', range.start).lte('date', range.end).order('date').order('start_minute').order('id'), signal);
  }, [target, month]);
  const resource = useAttendanceResource(`plans:${target}:${monthKey}`, load, Boolean(target));
  const rows = resource.data || [];
  const totals = planningTotals(rows);
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const offset = (getDay(startOfMonth(month)) + 6) % 7;
  const activeDate = selectedDay?.startsWith(monthKey) ? selectedDay : `${monthKey}-01`;
  const dayRows = rows.filter(row => row.date === activeDate);
  const newPlan = date => {
    setError('');
    setDraft({ id: crypto.randomUUID(), version: 0, date, start: '08:00', end: '16:30', break_minutes: 30, kind: 'work', note: '' });
  };
  const mutate = async (payload, close) => {
    if (busy.current || !editable || !resource.ready) return;
    busy.current = true; setPending(true); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('save_attendance_plan', payload);
      if (failure) throw failure;
      if (!data?.id) throw new Error('Uložení nebylo potvrzeno. Zkuste požadavek zopakovat.');
      close(); resource.refresh();
    } catch (failure) { setError(failure.message || 'Plán se nepodařilo uložit.'); }
    finally { busy.current = false; setPending(false); }
  };
  const save = event => {
    event.preventDefault();
    try { const payload = planPayload(draft, target); mutate(payload, () => { setSelectedDay(draft.date); if (!draft.date.startsWith(monthKey)) setParams(current => { const next = new URLSearchParams(current); next.set('month', draft.date.slice(0, 7)); return next; }); setDraft(null); }); }
    catch (failure) { setError(failure.message); }
  };
  return <div className="space-y-5">
    <div className="rounded-xl border bg-white p-5"><h2 className="text-lg font-semibold">Plán docházky</h2><p className="mt-1 text-sm text-slate-600">Rozvrhněte směny, home office a nepřítomnost. Tento plán nevytváří odpracované hodiny ani nárok na výplatu. Nepřítomnost zde není schválenou dovolenou.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><AttendanceMonthControl value={month} disabled={pending} onChange={value => setParams(current => { const next = new URLSearchParams(current); next.set('month', format(value, 'yyyy-MM')); return next; })} />
      {manage && <label className="text-sm">Pracovník<select aria-label="Pracovník pro plán docházky" disabled={pending || members.loading} className="ml-2 max-w-[240px] rounded-md border bg-white p-2" value={target || ''} onChange={event => { setSelectedMember(event.target.value); setSelectedDay(null); setError(''); }}><option value={memberId || ''}>Moje plánování</option>{(members.data || []).filter(row => row.id !== memberId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    </div>
    {manage && members.error && <p role="alert" className="text-sm text-red-700">Seznam pracovníků se nepodařilo načíst. <Button variant="outline" onClick={members.refresh}>Obnovit pracovníky</Button></p>}
    <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>{resource.ready && <>
      <div className="flex flex-wrap gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm"><span>Plánovaná práce: <strong>{totals.work.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} h</strong></span><span>Nepřítomnost: <strong>{totals.absence.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} h</strong></span><span className="text-slate-600">Kliknutím vyberte den. Tlačítkem + přidáte plán.</span></div>
      <div className="rounded-xl border bg-white p-2 sm:p-4"><div className="mb-2 grid grid-cols-7 text-center text-xs font-semibold text-slate-500">{['Po','Út','St','Čt','Pá','So','Ne'].map(day => <div key={day}>{day}</div>)}</div><div className="grid grid-cols-7 gap-1 sm:gap-2">{Array.from({ length: offset }, (_, index) => <div key={`blank-${index}`} />)}{days.map(day => {
        const date = format(day, 'yyyy-MM-dd'); const entries = rows.filter(row => row.date === date);
        return <div key={date} className={`min-w-0 rounded-lg border ${date === activeDate ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200'} ${[0,6].includes(getDay(day)) ? 'bg-slate-50' : 'bg-white'}`}>
          <button type="button" onClick={() => setSelectedDay(date)} aria-pressed={date === activeDate} aria-label={`${format(day, 'd. MMMM yyyy', { locale: cs })}, ${entries.length} plánů`} className="flex min-h-24 w-full min-w-0 flex-col gap-1 overflow-hidden rounded-t-lg p-1 text-left focus-visible:ring-2 focus-visible:ring-indigo-500 sm:min-h-28 sm:p-2"><span className={`text-sm font-semibold ${isToday(day) ? 'rounded bg-indigo-600 px-1 text-white' : ''}`}>{format(day,'d')}</span>{entries.slice(0,2).map(row => <span key={row.id} className={`block w-full truncate rounded px-1 text-[10px] sm:text-xs ${row.kind === 'absence' ? 'bg-amber-100 text-amber-900' : row.kind === 'home_office' ? 'bg-violet-100 text-violet-900' : 'bg-blue-100 text-blue-900'}`}>{planTime(row.start_minute)} · {PLAN_LABELS[row.kind]}</span>)}{entries.length > 2 && <span className="text-[10px]">+{entries.length-2} další</span>}</button>
          {editable && <button type="button" className="flex min-h-8 w-full justify-center rounded-b-lg border-t py-1 text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={`Přidat plán na ${date}`} onClick={() => { setSelectedDay(date); newPlan(date); }}><Plus size={16} /></button>}
        </div>;
      })}</div></div>
      <section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{format(new Date(`${activeDate}T12:00:00`),'EEEE d. MMMM',{locale:cs})}</h3>{editable && <Button onClick={() => newPlan(activeDate)}><Plus className="mr-2 h-4 w-4" />Přidat plán</Button>}</div>{!dayRows.length && <p className="mt-4 text-sm text-slate-500">Na tento den zatím nic neplánujete.</p>}<ul className="mt-3 divide-y">{dayRows.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div><p className="font-medium">{planTime(row.start_minute)}–{planTime(row.end_minute)} · {PLAN_LABELS[row.kind]}</p><p className="text-sm text-slate-600">{planHours(row).toLocaleString('cs-CZ',{maximumFractionDigits:2})} h · přestávka {row.break_minutes} min</p><p className="whitespace-pre-wrap break-words text-sm">{row.note}</p></div>{editable && <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="Upravit plán" onClick={() => { setError(''); setDraft({ ...row,start:planTime(row.start_minute),end:planTime(row.end_minute) }); }}><Pencil size={16}/></Button><Button variant="ghost" size="icon" aria-label="Zrušit plán" onClick={() => { setError(''); setDeleting(row); }}><Trash2 size={16}/></Button></div>}</li>)}</ul></section>
    </>}</AttendanceLoadState>
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !pending) setDraft(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{draft?.version ? 'Upravit plán' : 'Naplánovat docházku'}</DialogTitle><DialogDescription>Plán se nezapočítává do odpracovaných hodin. Směnu přes půlnoc rozdělte do dvou dnů.</DialogDescription></DialogHeader>{draft && <form onSubmit={save} className="grid grid-cols-2 gap-4"><label className="col-span-2 text-sm">Datum<Input required type="date" disabled={pending} value={draft.date} onChange={event=>setDraft({...draft,date:event.target.value})}/></label><label className="text-sm">Od<Input required type="time" disabled={pending} value={draft.start} onChange={event=>setDraft({...draft,start:event.target.value})}/></label><label className="text-sm">Do<Input required type="text" placeholder="16:30 nebo 24:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" disabled={pending} value={draft.end} onChange={event=>setDraft({...draft,end:event.target.value})}/></label><label className="text-sm">Přestávka (min)<Input required type="number" min="0" max="1439" step="1" disabled={pending} value={draft.break_minutes} onChange={event=>setDraft({...draft,break_minutes:event.target.value})}/></label><label className="text-sm">Typ<select className="mt-1 w-full rounded-md border p-2" disabled={pending} value={draft.kind} onChange={event=>setDraft({...draft,kind:event.target.value})}>{Object.entries(PLAN_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="col-span-2 text-sm">Místo / zakázka / poznámka<Textarea maxLength={1000} disabled={pending} value={draft.note} onChange={event=>setDraft({...draft,note:event.target.value})}/></label>{error && <p role="alert" className="col-span-2 text-sm text-red-700">{error}</p>}<div className="col-span-2 flex gap-2"><Button type="submit" disabled={pending}>{pending?'Ukládám…':'Uložit plán'}</Button><Button type="button" variant="outline" disabled={pending} onClick={()=>setDraft(null)}>Zavřít</Button></div></form>}</DialogContent></Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={open=>{if(!open&&!pending)setDeleting(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Zrušit tento plán?</AlertDialogTitle><AlertDialogDescription>Zmizí z plánovaného kalendáře. Skutečná docházka zůstane beze změny.</AlertDialogDescription></AlertDialogHeader>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Zpět</AlertDialogCancel><Button disabled={pending} variant="destructive" onClick={()=>mutate({p_id:deleting.id,p_member_id:target,p_date:null,p_start:null,p_end:null,p_break:null,p_kind:null,p_note:null,p_version:deleting.version,p_cancel:true},()=>setDeleting(null))}>Zrušit plán</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
