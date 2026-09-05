import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { loadAttendanceRows, sumAttendanceHours } from '@/lib/attendanceWorkspace';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { AttendanceLoadState } from './AttendanceWorkspaceParts';

export default function YearlyAttendanceSummary({ memberId, attendanceEnabled, revision = 0 }) {
  const { memberId: actorMemberId, userRole } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const allowed = Boolean(memberId && actorMemberId && (memberId === actorMemberId || userRole === 'admin'));
  const loader = useCallback(signal => loadAttendanceRows(supabase, { memberId, start: `${year}-01-01`, end: `${year}-12-31`, signal, select: 'id,date,hours' }), [memberId, year]);
  const resource = useAttendanceResource(`year:${memberId}:${year}:${revision}`, loader, allowed && attendanceEnabled);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    const rows = (resource.data || []).filter(row => row.date.startsWith(key));
    return { key, name: new Date(year, index, 1).toLocaleDateString('cs-CZ', { month: 'long' }), hours: sumAttendanceHours(rows), count: rows.length };
  }), [resource.data, year]);
  if (!attendanceEnabled || !allowed) return null;
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">Roční souhrn</h3><p className="mt-1 text-xs text-slate-500">Všechny zapsané hodiny po měsících, včetně neodeslaných výkazů.</p></div><div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="Předchozí rok" onClick={() => setYear(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-14 text-center font-semibold" aria-live="polite">{year}</span><Button variant="outline" size="icon" aria-label="Další rok" onClick={() => setYear(value => value + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
    <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>
      {resource.ready && <><p className="text-2xl font-semibold tabular-nums">{sumAttendanceHours(resource.data).toLocaleString('cs-CZ')} h <span className="text-sm font-normal text-slate-500">za rok {year}</span></p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{months.map(month => <Link key={month.key} className="rounded-lg border p-3 hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to={`/attendance?tab=my-attendance&month=${month.key}`}><p className="text-xs capitalize text-slate-500">{month.name}</p><p className="mt-2 font-semibold tabular-nums">{month.hours.toLocaleString('cs-CZ')} h</p><p className="mt-1 text-xs text-slate-500">{month.count} záznamů</p></Link>)}</div></>}
    </AttendanceLoadState>
  </section>;
}