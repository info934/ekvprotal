import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { CheckCircle, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { attendanceMonthRange, loadAttendanceRows, loadAttendanceSubmissions, sumAttendanceHours } from '@/lib/attendanceWorkspace';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { approveAttendanceSubmission, rejectAttendanceSubmission, returnAttendanceSubmissionForEdit, revertAttendanceSubmission } from '@/lib/attendanceWorkflowService';
import { sendAttendanceNotification } from '@/lib/attendanceEmailService';
import { AttendanceLoadState, AttendanceRecordsTable, AttendanceStatus } from './AttendanceWorkspaceParts';

const monthLabel = date => format(new Date(`${date.slice(0, 10)}T12:00:00`), 'LLLL yyyy', { locale: cs });
const actionLabels = { approved: 'Schválit měsíc', returned: 'Vrátit k úpravě', rejected: 'Zamítnout měsíc', submitted: 'Znovu otevřít ke kontrole' };

export default function AttendanceSubmissionsOptimized() {
  const { toast } = useToast();
  const { hasPermission, userRole } = useAuth();
  const canAdmin = userRole === 'admin' || hasPermission('attendance', 'can_admin');
  const [filter, setFilter] = useState('submitted');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const busy = useRef(false);
  const loader = useCallback(signal => loadAttendanceSubmissions(supabase, { signal }), []);
  const resource = useAttendanceResource('attendance-submissions', loader);
  const detailsLoader = useCallback(signal => loadAttendanceRows(supabase, { memberId: detail?.member_id, ...attendanceMonthRange(detail?.month_date || new Date()), signal }), [detail]);
  const details = useAttendanceResource(`attendance-detail:${detail?.id || ''}`, detailsLoader, Boolean(detail));
  const submissions = resource.data || [];
  const filtered = useMemo(() => submissions.filter(row => (filter === 'all' || row.status === filter) && (!month || row.month_date.startsWith(month)) && (!search.trim() || row.member?.name?.toLocaleLowerCase('cs').includes(search.trim().toLocaleLowerCase('cs')))), [submissions, filter, month, search]);
  useEffect(() => setPage(1), [filter, month, search, resource.data]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const safePage = Math.min(page, pages);
  const startDecision = status => { setDecision(status); setNote(''); setActionError(''); };
  const applyDecision = async () => {
    if (!canAdmin || !detail || !['submitted', 'approved'].includes(detail.status) || busy.current || !details.ready) return;
    if (['returned', 'rejected'].includes(decision) && !note.trim()) { setActionError('Napište pracovníkovi, co je potřeba opravit.'); return; }
    busy.current = true; setPending(true); setActionError('');
    try {
      const saved = decision === 'submitted' ? await revertAttendanceSubmission(detail.id) : decision === 'approved' ? await approveAttendanceSubmission(detail.id) : decision === 'returned' ? await returnAttendanceSubmissionForEdit(detail.id, note.trim()) : await rejectAttendanceSubmission(detail.id, note.trim());
      const info = { ...detail, ...(saved || {}) };
      const eventType = decision;
      setDecision(null); setDetail(null); resource.refresh();
      toast({ title: 'Stav měsíce byl uložen' });
      if (decision === 'submitted') return;
      try {
        const notification = await sendAttendanceNotification({ submissionId: info.id, eventType, memberName: info.member?.name || 'Pracovník', monthDate: monthLabel(info.month_date), totalHours: info.total_hours, reason: note.trim() || undefined });
        if (!notification?.success) throw new Error('Notification not confirmed');
      } catch { toast({ title: 'Stav je uložený', description: 'E-mailovou notifikaci se nepodařilo potvrdit.', variant: 'warning' }); }
    } catch (error) { setActionError(error.message || 'Změnu se nepodařilo uložit.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="space-y-5">
    <section className="space-y-4 rounded-xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Schvalování docházky</h2><p className="mt-1 text-sm text-slate-500">Otevřete výkaz, zkontrolujte záznamy a rozhodněte o celém měsíci.</p></div><Button variant="outline" onClick={resource.refresh} disabled={pending}><RefreshCw className="mr-2 h-4 w-4" />Obnovit</Button></div><div className="flex flex-wrap gap-3 border-t pt-4"><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Hledat pracovníka" placeholder="Hledat pracovníka…" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} /></div><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="Stav výkazu" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="submitted">Ke schválení</SelectItem><SelectItem value="approved">Schváleno</SelectItem><SelectItem value="returned">Vráceno k úpravě</SelectItem><SelectItem value="rejected">Zamítnuto</SelectItem><SelectItem value="draft">Koncept</SelectItem><SelectItem value="all">Všechny stavy</SelectItem></SelectContent></Select><Input className="w-44" type="month" aria-label="Filtrovat měsíc výkazu" value={month} onChange={event => setMonth(event.target.value)} />{month && <Button variant="ghost" onClick={() => setMonth('')}>Všechna období</Button>}</div></section>
    <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>{resource.ready && <><div className="flex flex-wrap gap-6 rounded-xl border bg-white px-5 py-4 text-sm"><span><strong>{submissions.filter(row => row.status === 'submitted').length}</strong> čeká na schválení</span><span><strong>{submissions.filter(row => row.status === 'approved').length}</strong> schválených</span><span className="text-slate-500">{filtered.length} zobrazených výkazů</span></div>{filtered.length ? <div className="overflow-hidden rounded-xl border bg-white"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Pracovník</TableHead><TableHead>Měsíc</TableHead><TableHead className="text-right">Hodiny</TableHead><TableHead>Stav</TableHead><TableHead>Odesláno</TableHead><TableHead className="text-right">Kontrola</TableHead></TableRow></TableHeader><TableBody>{filtered.slice((safePage - 1) * 25, safePage * 25).map(row => <TableRow key={row.id}><TableCell className="min-w-40 font-medium">{row.member?.name || 'Neznámý pracovník'}{row.notes && <p className="mt-1 max-w-xs truncate text-xs font-normal text-slate-500" title={row.notes}>{row.notes}</p>}</TableCell><TableCell className="whitespace-nowrap capitalize">{monthLabel(row.month_date)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{Number(row.total_hours).toLocaleString('cs-CZ')} h</TableCell><TableCell><AttendanceStatus status={row.status} /></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-500">{row.submitted_at ? new Date(row.submitted_at).toLocaleDateString('cs-CZ') : 'Neodesláno'}</TableCell><TableCell className="text-right"><Button variant="outline" disabled={pending} onClick={() => setDetail(row)}>Otevřít výkaz</Button></TableCell></TableRow>)}</TableBody></Table></div>{pages > 1 && <div className="flex items-center justify-end gap-3 border-t p-3 text-sm"><Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Předchozí</Button>{safePage} / {pages}<Button variant="outline" size="sm" disabled={safePage === pages} onClick={() => setPage(safePage + 1)}>Další</Button></div>}</div> : <div className="rounded-xl border border-dashed bg-white p-10 text-center"><CheckCircle className="mx-auto mb-3 h-7 w-7 text-slate-400" /><p className="font-medium">{filter === 'submitted' ? 'Žádný výkaz nyní nečeká na schválení' : 'Žádný výkaz neodpovídá filtrům'}</p><p className="mt-2 text-sm text-slate-500">Stav a měsíc můžete změnit ve filtrech nahoře.</p></div>}</>}</AttendanceLoadState>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open && !pending && !decision) setDetail(null); }}><DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden"><DialogHeader><DialogTitle>{detail?.member?.name || 'Výkaz docházky'}</DialogTitle><DialogDescription>{detail ? monthLabel(detail.month_date) : ''} · odeslaný součet {Number(detail?.total_hours || 0).toLocaleString('cs-CZ')} h</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto"><AttendanceLoadState loading={details.loading} error={details.error} onRetry={details.refresh}>{details.ready && <><p className="mb-3 text-sm text-slate-500">Načtené záznamy: {sumAttendanceHours(details.data).toLocaleString('cs-CZ')} h. {detail?.notes && `Poznámka: ${detail.notes}`}</p><AttendanceRecordsTable records={details.data} /></>}</AttendanceLoadState></div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setDetail(null)}>Zavřít</Button>{canAdmin && detail?.status === 'approved' && <Button variant="outline" disabled={pending || !details.ready} onClick={() => startDecision('submitted')}>Znovu otevřít ke kontrole</Button>}{canAdmin && detail?.status === 'submitted' && <><Button variant="outline" disabled={pending || !details.ready} onClick={() => startDecision('returned')}>Vrátit k úpravě</Button><Button variant="outline" disabled={pending || !details.ready} onClick={() => startDecision('rejected')}>Zamítnout</Button><Button disabled={pending || !details.ready} onClick={() => startDecision('approved')}>Schválit měsíc</Button></>}</DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(decision)} onOpenChange={open => { if (!open && !pending) setDecision(null); }}><DialogContent><DialogHeader><DialogTitle>{actionLabels[decision]}</DialogTitle><DialogDescription>{detail?.member?.name} · {detail ? monthLabel(detail.month_date) : ''}. {decision === 'submitted' ? 'Výkaz se vrátí do stavu Ke schválení. Záznamy zůstanou uzamčené do následného vrácení pracovníkovi. Aktivní nebo vyplacená hodinová žádost opětovné otevření blokuje.' : decision === 'approved' ? 'Schválený výkaz bude podkladem pro hodinové výplaty a jeho záznamy zůstanou uzamčené.' : 'Napište konkrétně, co má pracovník opravit před dalším odesláním.'}</DialogDescription></DialogHeader>{['returned', 'rejected'].includes(decision) && <div className="space-y-2"><Label htmlFor="attendance-decision-note">Důvod a pokyny pro pracovníka</Label><Textarea id="attendance-decision-note" value={note} onChange={event => setNote(event.target.value)} disabled={pending} rows={4} /></div>}{actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}<DialogFooter><Button variant="outline" disabled={pending} onClick={() => setDecision(null)}>Zrušit</Button><Button variant={decision === 'rejected' ? 'destructive' : 'default'} disabled={pending || (['returned', 'rejected'].includes(decision) && !note.trim())} onClick={applyDecision}>{pending ? 'Ukládám…' : actionLabels[decision]}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
