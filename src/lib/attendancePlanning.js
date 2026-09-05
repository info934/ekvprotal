export const PLAN_LABELS = { work: 'Práce na pracovišti', home_office: 'Home office', absence: 'Plánovaná nepřítomnost' };
export function planTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function planMinutes(time) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('Zadejte platný čas.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function planHours(row) { return (row.end_minute - row.start_minute - row.break_minutes) / 60; }
export function planningTotals(rows) {
  return rows.filter(row => !row.cancelled).reduce((result, row) => {
    result[row.kind === 'absence' ? 'absence' : 'work'] += planHours(row);
    return result;
  }, { work: 0, absence: 0 });
}
export function planPayload(draft, memberId) {
  const start = planMinutes(draft.start), end = draft.end === '24:00' ? 1440 : planMinutes(draft.end);
  const pause = Number(draft.break_minutes);
  const date = new Date(`${draft.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.date) throw new Error('Zadejte platné datum.');
  if (!Number.isInteger(pause) || pause < 0 || end <= start || pause >= end - start) throw new Error('Konec musí být po začátku a přestávka kratší než směna.');
  if (!PLAN_LABELS[draft.kind]) throw new Error('Vyberte typ plánu.');
  if ((draft.note || '').length > 1000) throw new Error('Poznámka smí mít nejvýše 1000 znaků.');
  return { p_id: draft.id, p_member_id: memberId, p_date: draft.date, p_start: start, p_end: end, p_break: pause, p_kind: draft.kind, p_note: (draft.note || '').trim(), p_version: draft.version || 0, p_cancel: false };
}
