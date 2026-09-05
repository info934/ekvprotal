import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { loadXlsx } from '@/lib/xlsx';
import { attendanceEntryDate } from '@/lib/operationsHelpers';
import { attendanceMonthRange, attendanceMonthEditable, fetchAllAttendanceRows, filterAttendanceRows, groupAttendanceWork, loadAttendanceRows, loadAttendanceSubmissions, sumAttendanceHours } from '@/lib/attendanceWorkspace';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { deleteAttendanceRecord, saveAttendanceRecords } from '@/lib/attendanceWorkflowService';
import AttendanceDialog from './AttendanceDialog';
import { AttendanceLoadState, AttendanceMonthControl, AttendanceRecordsTable } from './AttendanceWorkspaceParts';

export default function GlobalAttendanceOptimized() {
  const { toast } = useToast();
  const { userRole, hasPermission } = useAuth();
  const canManage = userRole === 'admin' || hasPermission('attendance', 'can_admin');
  const [params, setParams] = useSearchParams();
  const candidate = (params.get('month') || '').slice(0, 7);
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : format(new Date(), 'yyyy-MM');
  const month = useMemo(() => new Date(`${monthKey}-01T12:00:00`), [monthKey]);
  const [member, setMember] = useState('all');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const loadMembers = useCallback(signal => fetchAllAttendanceRows(() => supabase.from('members').select('id,name').order('name').order('id'), signal), []);
  const members = useAttendanceResource('attendance-members', loadMembers);
  const load = useCallback(async signal => {
    const [records, submissions] = await Promise.all([
      loadAttendanceRows(supabase, { memberId: member, ...attendanceMonthRange(month), signal }),
      loadAttendanceSubmissions(supabase, { month, signal }),
    ]);
    return { records, submissions };
  }, [member, month]);
  const resource = useAttendanceResource(`team-attendance:${monthKey}:${member}`, load);
  const rows = useMemo(() => filterAttendanceRows(resource.data?.records || [], { type, search }), [resource.data, type, search]);
  const submissions = useMemo(() => new Map((resource.data?.submissions || []).map(row => [row.member_id, row])), [resource.data]);
  const editable = row => canManage && attendanceMonthEditable(submissions.get(row.member_id), resource.ready);
  const save = async (payload, options) => {
    if (busy.current || !canManage) throw new Error('Zápis nyní není dostupný.');
    busy.current = true; setPending(true);
    try {
      await saveAttendanceRecords(payload, dialog?.record?.id || null, options);
      setDialog(null); resource.refresh(); toast({ title: 'Docházka uložena' });
    } finally { busy.current = false; setPending(false); }
  };
  const remove = async () => {
    if (!deleting || !editable(deleting) || busy.current) return;
    busy.current = true; setPending(true);
    try { await deleteAttendanceRecord(deleting.id); setDeleting(null); resource.refresh(); toast({ title: 'Záznam smazán' }); }
    catch (error) { toast({ title: 'Záznam se nepodařilo smazat', description: error.message, variant: 'destructive' }); }
    finally { busy.current = false; setPending(false); }
  };
  const exportRows = async () => {
    setExporting(true);
    try {
      const XLSX = await loadXlsx();
      const data = rows.map(row => ({ Datum: row.date, Pracovník: row.members?.name || '', Typ: row.project_id ? 'Projekt' : row.realization_id ? 'Realizace' : 'Bez přiřazení', Zakázka: row.projects?.name || row.realizations?.name || '', Kód: row.projects?.code || '', Popis: row.description || '', Hodiny: row.hours }));
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), 'Docházka');
      XLSX.writeFile(book, `dochazka_tym_${monthKey}.xlsx`);
    } catch (error) { toast({ title: 'Export se nepodařil', description: error.message, variant: 'destructive' }); }
    finally { setExporting(false); }
  };
  return <div className="space-y-5">
    <section className="space-y-4 rounded-xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Docházka týmu</h2><p className="mt-1 text-sm text-slate-500">Záznamy pracovníků podle měsíce a zakázky. Odeslané a schválené výkazy jsou uzamčené.</p></div>{canManage && <Button disabled={!resource.ready || pending} onClick={() => setDialog({ date: attendanceEntryDate(month) })}><Plus className="mr-2 h-4 w-4" />Zapsat hodiny</Button>}</div><AttendanceMonthControl value={month} disabled={pending} onChange={date => setParams(current => { const next = new URLSearchParams(current); next.set('month', format(date, 'yyyy-MM')); return next; })} /><div className="flex flex-wrap items-center gap-3 border-t pt-4"><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Hledat v týmové docházce" className="pl-9" placeholder="Pracovník, zakázka nebo popis…" value={search} onChange={event => setSearch(event.target.value)} /></div><Select value={member} onValueChange={setMember} disabled={pending || !members.ready}><SelectTrigger aria-label="Pracovník" className="w-full sm:w-52"><SelectValue placeholder="Načítám pracovníky" /></SelectTrigger><SelectContent><SelectItem value="all">Všichni pracovníci</SelectItem>{(members.data || []).map(row => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select><Select value={type} onValueChange={setType}><SelectTrigger aria-label="Typ zakázky" className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Všechny zakázky</SelectItem><SelectItem value="project">Projekty</SelectItem><SelectItem value="realization">Realizace</SelectItem></SelectContent></Select><Button variant="ghost" size="icon" aria-label="Obnovit týmovou docházku" onClick={resource.refresh} disabled={pending}><RefreshCw className="h-4 w-4" /></Button><Button variant="outline" onClick={exportRows} disabled={!resource.ready || !rows.length || exporting}><Download className="mr-2 h-4 w-4" />Export zobrazených</Button></div>{members.error && <AttendanceLoadState error={members.error} onRetry={members.refresh} />}</section>
    <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>{resource.ready && <><div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-slate-200">{[['Zobrazené hodiny', sumAttendanceHours(rows).toLocaleString('cs-CZ') + ' h'], ['Pracovníci', new Set(rows.map(row => row.member_id)).size], ['Zakázky', groupAttendanceWork(rows).length]].map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>)}</div><AttendanceRecordsTable records={rows} showMember pending={pending} canEditRecord={editable} onEdit={canManage ? row => setDialog({ record: row }) : null} onDelete={canManage ? setDeleting : null} empty="Vybranému měsíci a filtrům neodpovídá žádný záznam." /></>}</AttendanceLoadState>
    <AttendanceDialog isOpen={Boolean(dialog)} onClose={() => { if (!pending) setDialog(null); }} onSave={save} record={dialog?.record || null} initialDate={dialog?.date} isAdmin={canManage} memberId={member === 'all' ? null : member} />
    <AlertDialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !pending) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat záznam docházky?</AlertDialogTitle><AlertDialogDescription>{deleting?.members?.name} · {deleting?.date} · {deleting?.hours} h. Záznam se odečte z měsíčního součtu a nelze jej obnovit.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Zrušit</AlertDialogCancel><Button variant="destructive" disabled={pending} onClick={remove}>{pending ? 'Mažu…' : 'Smazat záznam'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
