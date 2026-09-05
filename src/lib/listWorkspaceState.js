export const LIST_DEFAULTS = { q: '', status: 'all', view: 'table', sort: 'created_at', dir: 'desc' };

export function normalizeListState(input = {}, allowedStatuses = [], allowedSorts = ['created_at', 'name', 'code']) {
  return {
    q: typeof input.q === 'string' ? input.q.slice(0, 250) : '',
    status: input.status === 'all' || allowedStatuses.includes(input.status) ? input.status : 'all',
    view: ['table', 'grid', 'kanban'].includes(input.view) ? input.view : 'table',
    sort: allowedSorts.includes(input.sort) ? input.sort : 'created_at',
    dir: input.dir === 'asc' ? 'asc' : 'desc',
  };
}

export function resolveListState(search, saved, statuses, sorts) {
  const params = new URLSearchParams(search);
  const keys = Object.keys(LIST_DEFAULTS);
  // An explicit linked query starts a new view; stale saved filters must not hide results.
  const source = keys.some(key => params.has(key)) ? Object.fromEntries(params) : saved;
  return normalizeListState(source, statuses, sorts);
}

export function listStateSearch(state) {
  const params = new URLSearchParams();
  for (const key of Object.keys(LIST_DEFAULTS)) if (state[key] !== LIST_DEFAULTS[key]) params.set(key, state[key]);
  // A marker distinguishes an explicitly reset table from restoring a saved filter.
  if (!params.size) params.set('view', 'table');
  return `?${params.toString()}`;
}

export function safeListReturnPath(candidate, fallback) {
  return typeof candidate === 'string' && (candidate === fallback || candidate.startsWith(`${fallback}?`)) ? candidate : fallback;
}

export function compareListRecords(a, b, key, direction = 'asc') {
  const aValue = a[key], bValue = b[key];
  if (aValue == null || aValue === '') return bValue == null || bValue === '' ? 0 : 1;
  if (bValue == null || bValue === '') return -1;
  const result = typeof aValue === 'number' && typeof bValue === 'number'
    ? aValue - bValue
    : String(aValue).localeCompare(String(bValue), 'cs', { numeric: true, sensitivity: 'base' });
  return direction === 'desc' ? -result : result;
}

export function isRecordActivation(event) {
  if (event.defaultPrevented) return false;
  if (event.type === 'keydown') return event.target === event.currentTarget && ['Enter', ' '].includes(event.key);
  const interactive = event.target?.closest?.('a, button, input, select, textarea, [role="button"], [role="menuitem"], [role="checkbox"]');
  return !interactive || interactive === event.currentTarget;
}

const doneStatuses = new Set(['hotovo', 'done', 'completed', 'dokončeno']);
const cancelledStatuses = new Set(['zrušeno', 'zruseno', 'cancelled', 'canceled']);
export const taskIsDone = task => doneStatuses.has(String(task?.status || '').toLocaleLowerCase('cs-CZ'));
export const taskIsCancelled = task => cancelledStatuses.has(String(task?.status || '').toLocaleLowerCase('cs-CZ'));
export const taskIsOpen = task => !taskIsDone(task) && !taskIsCancelled(task);
export function taskProgress(tasks) {
  const relevant = tasks.filter(task => !taskIsCancelled(task));
  return relevant.length ? Math.round(relevant.filter(taskIsDone).length / relevant.length * 100) : 0;
}

export async function fetchAllListRows(fetchPage, pageSize = 500) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  const rows = [];
  while (true) {
    const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Seznam nemá očekávaný formát.');
    rows.push(...data);
    if (!data.length) return rows;
  }
}

export function recordReturnPath(candidate,fallback){
 if(typeof candidate==='string'&&(candidate==='/tasks'||candidate.startsWith('/tasks?')))return candidate;
 return safeListReturnPath(candidate,fallback);
}
