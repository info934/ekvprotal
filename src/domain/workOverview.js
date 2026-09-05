export const CLOSED_TASK_STATUSES = ['Hotovo', 'Zrušeno', 'done', 'completed', 'cancelled', 'canceled'];
export const isClosedTask = task => CLOSED_TASK_STATUSES.some(status => status.toLocaleLowerCase('cs') === String(task?.status || '').toLocaleLowerCase('cs'));
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function taskDateLabel(value, now = new Date()) {
  if (!value) return 'Bez termínu';
  const day = String(value).slice(0, 10);
  if (day === localDateKey(now)) return 'Dnes';
  if (day < localDateKey(now)) return 'Po termínu';
  const next = new Date(now); next.setDate(next.getDate() + 1);
  if (day === localDateKey(next)) return 'Zítra';
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Bez termínu' : new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' }).format(date);
}
export const sumKnownCounts = values => values.some(value => value === null) ? null : values.reduce((total, value) => total + Number(value || 0), 0);
