import { format, isValid, parseISO } from 'date-fns';
import { fetchAllListRows, taskIsOpen } from './listWorkspaceState.js';

export function projectDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

export function formatProjectDate(value, fallback = 'Bez termínu', pattern = 'd. M. yyyy') {
  const date = projectDate(value);
  return date ? format(date, pattern) : fallback;
}

export function projectTaskIsOverdue(task, now = new Date()) {
  const date = projectDate(task?.end_date);
  if (!date || !taskIsOpen(task)) return false;
  date.setHours(23, 59, 59, 999);
  return date < now;
}

export function projectTaskOverview(tasks, now = new Date()) {
  const open = tasks.filter(taskIsOpen);
  return {
    open,
    overdue: open.filter(task => projectTaskIsOverdue(task, now)),
    missingDates: open.filter(task => !projectDate(task.end_date)),
    upcoming: [...open].sort((a, b) => (projectDate(a.end_date)?.getTime() ?? Infinity) - (projectDate(b.end_date)?.getTime() ?? Infinity)).slice(0, 5),
  };
}

export const projectTaskStatus = task => String(task?.status || '').trim() || 'Bez stavu';

export function projectTaskStatuses(tasks, defaults = ['Nové', 'V řešení', 'Blokováno', 'Hotovo', 'Zrušeno']) {
  return [...new Set([...defaults, ...tasks.map(projectTaskStatus)])];
}

// Drag data can come from outside this board. Only an existing task in this
// project is eligible; the database still enforces permissions on the update.
export function resolveProjectTaskDrop(serialized, tasks, projectId, canEdit) {
  if (!canEdit || !projectId) return null;
  try {
    const id = JSON.parse(serialized)?.id;
    return tasks.find(task => task.id === id && task.project_id === projectId) || null;
  } catch {
    return null;
  }
}

export async function loadProjectTasks(client, projectId, signal) {
  if (!projectId) throw new Error('Chybí projekt pro načtení úkolů.');
  return fetchAllListRows((from, to) => {
    let query = client.from('project_tasks').select('*, member:members(name)').eq('project_id', projectId)
      .order('end_date', { ascending: true, nullsFirst: false }).order('id').range(from, to);
    if (signal) query = query.abortSignal(signal);
    return query;
  });
}
