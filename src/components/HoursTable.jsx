import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { attendanceMonthRange, groupAttendanceWork, loadAttendanceRows, sumAttendanceHours } from '@/lib/attendanceWorkspace';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { AttendanceLoadState, AttendanceRecordsTable } from './AttendanceWorkspaceParts';

export default function HoursTable({ selectedMonth, memberId, onDataFetched }) {
  const { memberId: actorMemberId, userRole } = useAuth();
  const allowed = Boolean(actorMemberId && memberId && (actorMemberId === memberId || userRole === 'admin'));
  const range = useMemo(() => selectedMonth ? attendanceMonthRange(selectedMonth) : null, [selectedMonth]);
  const key = `${actorMemberId}:${memberId}:${range?.start || ''}`;
  const loader = useCallback(signal => loadAttendanceRows(supabase, { memberId, ...range, signal }), [memberId, range]);
  const resource = useAttendanceResource(key, loader, allowed && Boolean(range));
  const callbackRef = useRef(onDataFetched);
  callbackRef.current = onDataFetched;
  useEffect(() => {
    if (!allowed || !resource.ready) {
      callbackRef.current?.({ records: [], totalHours: null, breakdown: {}, status: allowed ? resource.status : 'forbidden', error: resource.error || null, month: range?.start, memberId });
      return;
    }
    const breakdown = {};
    for (const group of groupAttendanceWork(resource.data)) breakdown[group.name] = (breakdown[group.name] || 0) + group.hours;
    callbackRef.current?.({ records: resource.data, totalHours: sumAttendanceHours(resource.data), breakdown, status: 'ready', error: null, month: range?.start, memberId });
  }, [allowed, resource.ready, resource.status, resource.data, resource.error, range, memberId]);
  if (!allowed) return <p role="alert" className="rounded-xl border bg-white p-5 text-sm text-slate-600">Tyto hodiny jsou dostupné jejich vlastníkovi a administrátorovi.</p>;
  if (!range) return <p className="text-sm text-slate-500">Vyberte měsíc pro zobrazení hodin.</p>;
  return <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>
    {resource.ready && <div className="space-y-3"><p className="text-sm font-medium">Zapsané hodiny za měsíc: {sumAttendanceHours(resource.data).toLocaleString('cs-CZ')} h</p><AttendanceRecordsTable records={resource.data} empty="Pro vybraný měsíc zatím nejsou zapsané hodiny." /><p className="text-xs text-slate-500">Součet docházky není automaticky nárokem k výplatě. Ten se řídí schválenými podklady výše.</p></div>}
  </AttendanceLoadState>;
}