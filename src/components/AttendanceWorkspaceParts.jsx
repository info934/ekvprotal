import React, { useEffect, useState } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const statuses = { draft: ['Koncept', 'secondary'], submitted: ['Ke schválení', 'warning'], approved: ['Schváleno', 'success'], rejected: ['Zamítnuto', 'destructive'], returned: ['Vráceno k úpravě', 'warning'] };
export function AttendanceStatus({ status = 'draft' }) {
  const [label, variant] = statuses[status] || ['Neznámý stav', 'outline'];
  return <Badge variant={variant}>{label}</Badge>;
}

export function AttendanceMonthControl({ value, onChange, disabled = false }) {
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="icon" disabled={disabled} onClick={() => onChange(subMonths(value, 1))} aria-label="Předchozí měsíc"><ChevronLeft className="h-4 w-4" /></Button>
    <Input aria-label="Měsíc docházky" type="month" value={format(value, 'yyyy-MM')} disabled={disabled} className="w-44" onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onChange(new Date(`${event.target.value}-01T12:00:00`)); }} />
    <Button variant="outline" size="icon" disabled={disabled} onClick={() => onChange(addMonths(value, 1))} aria-label="Další měsíc"><ChevronRight className="h-4 w-4" /></Button>
    <Button variant="ghost" disabled={disabled} onClick={() => onChange(new Date())}>Tento měsíc</Button>
  </div>;
}

export function AttendanceLoadState({ loading, error, onRetry, children }) {
  if (loading) return <div role="status" className="flex min-h-44 items-center justify-center gap-2 rounded-xl border bg-white p-6 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Načítám docházku…</div>;
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900"><p>{error}</p><Button variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Zkusit znovu</Button></div>;
  return children;
}

export function AttendanceRecordsTable({ records, showMember = false, onEdit, onDelete, pending = false, canEditRecord = () => true, empty = 'V tomto období zatím nejsou zapsané hodiny.' }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [records]);
  const pageCount = Math.max(1, Math.ceil(records.length / 50));
  const safePage = Math.min(page, pageCount);
  const shown = records.slice((safePage - 1) * 50, safePage * 50);
  if (!records.length) return <p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">{empty}</p>;
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Datum</TableHead>{showMember && <TableHead>Pracovník</TableHead>}<TableHead>Zakázka a práce</TableHead><TableHead className="text-right">Hodiny</TableHead>{(onEdit || onDelete) && <TableHead className="text-right">Akce</TableHead>}</TableRow></TableHeader><TableBody>
      {shown.map(row => <TableRow key={row.id}><TableCell className="whitespace-nowrap align-top">{format(new Date(`${row.date.slice(0, 10)}T12:00:00`), 'd. M. yyyy', { locale: cs })}</TableCell>{showMember && <TableCell className="min-w-36 align-top font-medium">{row.members?.name || 'Neznámý pracovník'}</TableCell>}<TableCell className="min-w-52"><div className="font-medium text-slate-900">{row.projects?.name || row.realizations?.name || 'Bez přiřazení'}</div><div className="mt-1 text-xs text-slate-500">{row.project_id ? 'Projekt' : row.realization_id ? 'Realizace' : 'Bez zakázky'}{row.projects?.code && ` · ${row.projects.code}`}</div>{row.description && <p className="mt-2 max-w-xl whitespace-pre-wrap break-words text-sm text-slate-600">{row.description}</p>}</TableCell><TableCell className="text-right align-top font-semibold tabular-nums">{Number(row.hours).toLocaleString('cs-CZ')} h</TableCell>{(onEdit || onDelete) && <TableCell className="text-right align-top"><div className="flex justify-end gap-1">{canEditRecord(row) ? <>{onEdit && <Button variant="ghost" size="icon" disabled={pending} aria-label={`Upravit záznam ${row.date}`} onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /></Button>}{onDelete && <Button variant="ghost" size="icon" disabled={pending} aria-label={`Smazat záznam ${row.date}`} onClick={() => onDelete(row)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</> : <span className="text-xs text-slate-500">Uzamčeno</span>}</div></TableCell>}</TableRow>)}
    </TableBody></Table></div>
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-slate-500"><span>{records.length} záznamů</span>{pageCount > 1 && <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Předchozí</Button><span>{safePage} / {pageCount}</span><Button variant="outline" size="sm" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}>Další</Button></div>}</div>
  </div>;
}
