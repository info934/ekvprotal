const relation = value => Array.isArray(value) ? value[0] || null : value || null;
export const attendanceHours = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const attendanceRealizationId = row => row?.realization_id || row?.realizace_id || null;
export const sumAttendanceHours = rows => rows.reduce((total, row) => total + attendanceHours(row.hours), 0);

export function attendanceDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Datum není platné.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function attendanceMonthRange(value) {
  const date = attendanceDateOnly(value);
  const [year, month] = date.split('-').map(Number);
  return { start: `${date.slice(0, 7)}-01`, end: attendanceDateOnly(new Date(year, month, 0)) };
}

export function normalizeAttendanceRow(row) {
  const project = relation(row.projects || row.project);
  const realization = relation(row.realizations || row.realization);
  const member = relation(row.members || row.member);
  const realizationId = attendanceRealizationId(row);
  return { ...row, hours: attendanceHours(row.hours), realization_id: realizationId, realizace_id: realizationId,
    project, projects: project, realization, realizations: realization, member, members: member };
}

export function filterAttendanceRows(rows, { type = 'all', search = '' } = {}) {
  const term = search.trim().toLocaleLowerCase('cs');
  return rows.filter(row => {
    if (type === 'project' && !row.project_id) return false;
    if (type === 'realization' && !attendanceRealizationId(row)) return false;
    return !term || [row.members?.name, row.projects?.name, row.projects?.code, row.realizations?.name, row.description]
      .filter(Boolean).some(value => String(value).toLocaleLowerCase('cs').includes(term));
  });
}

export function groupAttendanceWork(rows) {
  const groups = new Map();
  for (const row of rows) {
    const realizationId = attendanceRealizationId(row);
    const key = row.project_id ? `project:${row.project_id}` : realizationId ? `realization:${realizationId}` : 'unassigned';
    const entry = groups.get(key) || { id: key, type: row.project_id ? 'Projekt' : realizationId ? 'Realizace' : 'Bez přiřazení', name: row.projects?.name || row.realizations?.name || 'Bez přiřazení', code: row.projects?.code || '', hours: 0 };
    entry.hours += attendanceHours(row.hours);
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.hours - a.hours);
}

export const attendanceMonthEditable = (submission, ready = true) => ready && (!submission || ['draft', 'rejected', 'returned'].includes(submission.status));
export const attendanceErrorMessage = error => ['PGRST202', '42883'].includes(error?.code)
  ? 'Docházka vyžaduje databázovou aktualizaci. Obraťte se na administrátora.'
  : error?.message || 'Docházku se nepodařilo načíst. Zkuste obnovit přehled.';

export async function fetchAllAttendanceRows(factory, signal, pageSize = 500) {
  const rows = [];
  const seen = new Set();
  while (true) {
    if (signal?.aborted) throw new DOMException('Načítání přerušeno.', 'AbortError');
    let query = factory().range(rows.length, rows.length + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Server nevrátil úplný seznam docházky.');
    if (!data.length) return rows;
    for (const row of data) {
      const identity = row.id || row.member_id;
      if (identity && seen.has(identity)) throw new Error('Načítání vrátilo opakované řádky. Obnovte přehled.');
      if (identity) seen.add(identity);
    }
    rows.push(...data);
  }
}

export async function loadAttendanceRows(client, { memberId, start, end, signal, select = '*, members:members!attendance_member_id_fkey(id,name), projects(id,name,code), realizations(id,name)' }) {
  const rows = await fetchAllAttendanceRows(() => {
    let query = client.from('attendance').select(select).gte('date', start).lte('date', end).order('date', { ascending: false }).order('id');
    if (memberId && memberId !== 'all') query = query.eq('member_id', memberId);
    return query;
  }, signal);
  return rows.map(normalizeAttendanceRow);
}

export async function loadAttendanceMonth(client, { memberId, month, signal }) {
  const { start, end } = attendanceMonthRange(month);
  const [records, result] = await Promise.all([
    loadAttendanceRows(client, { memberId, start, end, signal }),
    client.from('attendance_submissions').select('*').eq('member_id', memberId).eq('month_date', start).maybeSingle().abortSignal(signal),
  ]);
  if (result.error) throw result.error;
  return { records, submission: result.data || null };
}

export const loadAttendanceSubmissions = (client, { signal, month } = {}) => fetchAllAttendanceRows(() => {
  let query = client.from('attendance_submissions').select('*, member:members!attendance_submissions_member_id_fkey(id,name,email)').order('month_date', { ascending: false }).order('id');
  if (month) query = query.eq('month_date', attendanceMonthRange(month).start);
  return query;
}, signal);

export function buildAttendanceReportData({ records, submissions, memberRows, compensations }) {
  const rates = new Map(compensations.map(row => [row.member_id, row]));
  const required = new Set([...records.map(row => row.member_id), ...submissions.map(row => row.member_id)]);
  if ([...required].some(id => !memberRows.some(row => row.id === id))) throw new Error('Některý pracovník z výkazu není dostupný. Finanční report nelze úplně sestavit.');
  const members = memberRows.filter(row => row.attendance_enabled || required.has(row.id)).map(row => {
    const compensation = rates.get(row.id);
    if (compensation?.hourly_rate == null || !Number.isFinite(Number(compensation.hourly_rate))) throw new Error(`Chybí hodinová sazba pracovníka ${row.name}. Doplňte odměňování před vytvořením finančního reportu.`);
    if (compensation.currency !== 'CZK') throw new Error(`Finanční report v Kč nelze sestavit: pracovník ${row.name} nemá sazbu v CZK.`);
    return { ...row, hourly_rate: Number(compensation.hourly_rate) };
  });
  return { records, submissions, members };
}

export async function loadAttendanceReport(client, { month, signal }) {
  const [records, submissions, memberRows, compensations] = await Promise.all([
    loadAttendanceRows(client, { ...attendanceMonthRange(month), signal }),
    loadAttendanceSubmissions(client, { month, signal }),
    fetchAllAttendanceRows(() => client.from('members').select('id,name,attendance_enabled').order('name').order('id'), signal),
    fetchAllAttendanceRows(() => client.rpc('list_member_compensations_admin').order('member_id'), signal),
  ]);
  return buildAttendanceReportData({ records, submissions, memberRows, compensations });
}
