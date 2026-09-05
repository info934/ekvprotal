const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const hours = row => (row.end_minute - row.start_minute - row.break_minutes) / 60;
const number = value => value.toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const kinds = { work: 'Pracoviště', home_office: 'Home office', absence: 'Nepřítomnost' };
export const REPORT_RECIPIENT = 'info@ekvproject.cz';
export function pragueDate(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}
export function nextReportMonth(now = new Date()) {
  const { year, month } = pragueDate(now);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
}
// First-day grace window recovers a missed run after a server outage.
export function scheduledReportMonth(now = new Date()) {
  const { year, month, day, hour } = pragueDate(now);
  if (day === new Date(Date.UTC(year, month, 0)).getUTCDate() && hour >= 18) return nextReportMonth(now);
  if (day === 1 && hour < 18) return `${year}-${String(month).padStart(2, '0')}`;
  return null;
}
export function reportRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid report month');
  const [year, value] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${month}-${new Date(Date.UTC(year, value, 0)).getUTCDate()}` };
}
export async function allReportRows(factory) {
  const result = []; const seen = new Set();
  for (;;) {
    const { data, error } = await factory().range(result.length, result.length + 499);
    if (error || !Array.isArray(data)) throw new Error('Report data could not be loaded completely.');
    if (!data.length) return result;
    for (const row of data) { const key = row.id || row.member_id; if (seen.has(key)) throw new Error('Duplicate report page'); seen.add(key); result.push(row); }
  }
}
export async function loadReportData(admin, month) {
  const range = reportRange(month);
  const [members, profiles, plans] = await Promise.all([
    allReportRows(() => admin.from('members').select('id,name,attendance_enabled').order('id')),
    allReportRows(() => admin.from('employee_profiles').select('member_id,employment_status').order('member_id')),
    allReportRows(() => admin.from('attendance_plans').select('id,member_id,date,start_minute,end_minute,break_minutes,kind,note').eq('cancelled', false).gte('date', range.start).lte('date', range.end).order('id')),
  ]);
  const status = new Map(profiles.map(row => [row.member_id, row.employment_status]));
  const planned = new Set(plans.map(row => row.member_id));
  // Explicit employee status takes precedence; existing attendance users remain
  // included while HR enrollment is being completed. Never omit a stored plan.
  const employees = members.filter(row => planned.has(row.id) || status.get(row.id) === 'active' || (!status.has(row.id) && row.attendance_enabled));
  if (plans.some(row => !members.some(member => member.id === row.member_id))) throw new Error('Report member metadata missing');
  return { employees, plans };
}
export function demoReportData(month) {
  return { employees: [{ id: 'demo-a', name: 'Ukázkový zaměstnanec A' }, { id: 'demo-b', name: 'Ukázkový zaměstnanec B' }, { id: 'demo-c', name: 'Ukázkový zaměstnanec C' }], plans: [
    { id: 'demo-1', member_id: 'demo-a', date: `${month}-05`, start_minute: 480, end_minute: 990, break_minutes: 30, kind: 'work', note: 'Ukázka plánované směny' },
    { id: 'demo-2', member_id: 'demo-a', date: `${month}-06`, start_minute: 480, end_minute: 990, break_minutes: 30, kind: 'home_office', note: 'Ukázka home office' },
    { id: 'demo-3', member_id: 'demo-b', date: `${month}-07`, start_minute: 480, end_minute: 960, break_minutes: 0, kind: 'absence', note: 'Ukázka plánované nepřítomnosti, nikoli schválená dovolená' },
  ] };
}
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function buildAttendanceReport({ month, employees, plans, demo = false }) {
  reportRange(month);
  const active = plans.filter(row => !row.cancelled && row.date.startsWith(`${month}-`));
  for (const row of active) if (!kinds[row.kind] || !Number.isFinite(hours(row)) || hours(row) <= 0 || row.end_minute > 1440 || row.start_minute < 0) throw new Error('Invalid report plan');
  const ordered = [...employees].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs'));
  const totals = { work: 0, home_office: 0, absence: 0, missing: 0 };
  const csv = [['Zaměstnanec', 'Datum', 'Od', 'Do', 'Přestávka min', 'Typ', 'Hodiny', 'Poznámka']];
  const detail = []; const summary = [];
  for (const employee of ordered) {
    const rows = active.filter(row => row.member_id === employee.id).sort((a, b) => a.date.localeCompare(b.date) || a.start_minute - b.start_minute);
    const subtotal = { work: 0, home_office: 0, absence: 0 };
    if (!rows.length) { totals.missing++; csv.push([employee.name, '', '', '', '', 'Bez plánu', '', '']); }
    for (const row of rows) {
      const value = hours(row); subtotal[row.kind] += value; totals[row.kind] += value;
      csv.push([employee.name, row.date, time(row.start_minute), time(row.end_minute), row.break_minutes, kinds[row.kind], number(value), row.note]);
      detail.push(`<tr><td>${escape(employee.name)}</td><td>${escape(row.date)}</td><td>${time(row.start_minute)}–${time(row.end_minute)}</td><td>${escape(kinds[row.kind])}</td><td>${number(value)}</td><td>${escape(row.note)}</td></tr>`);
    }
    summary.push(`<tr><td>${escape(employee.name)}</td><td>${number(subtotal.work)}</td><td>${number(subtotal.home_office)}</td><td>${number(subtotal.absence)}</td><td>${rows.length ? rows.length + ' záznamů' : '<strong>Bez vyplněného plánu</strong>'}</td></tr>`);
  }
  const label = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const subject = `${demo ? '[DEMO] ' : ''}EKV – plánovaná docházka – ${label}`;
  const html = `<!doctype html><html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;color:#172b3a;background:#f3f6f8;margin:0}td,th{padding:9px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:13px;vertical-align:top}table{border-collapse:collapse;width:100%}th{background:#edf2f7}h2{font-size:18px}p{line-height:1.6}</style></head><body><div style="max-width:900px;margin:20px auto;background:white;padding:24px"><h1 style="font-size:24px">${escape(subject)}</h1>${demo ? '<p style="padding:14px;background:#fff3cd"><strong>TESTOVACÍ DEMO – výhradně smyšlená ukázková data.</strong> Tento e-mail nepotvrzuje skutečný rozpis zaměstnanců.</p>' : ''}<p>Přehled plánů na <strong>${escape(label)}</strong>. Obsahuje všechny aktivní zaměstnance a pracovníky s povolenou docházkou bez HR profilu; zahrnuje i každého dalšího pracovníka s plánem v tomto měsíci.</p><p><strong>${ordered.length} pracovníků · ${number(totals.work + totals.home_office)} h plánované práce · ${number(totals.absence)} h nepřítomnosti</strong><br>Bez vyplněného plánu: <strong>${totals.missing}</strong></p><h2>Souhrn podle zaměstnanců</h2><table><thead><tr><th>Zaměstnanec</th><th>Pracoviště (h)</th><th>Home office (h)</th><th>Nepřítomnost (h)</th><th>Stav plánu</th></tr></thead><tbody>${summary.join('') || '<tr><td colspan="5">Nejsou evidováni žádní zaměstnanci.</td></tr>'}</tbody></table><h2>Rozpis plánovaných dnů</h2>${detail.length ? `<table><thead><tr><th>Zaměstnanec</th><th>Datum</th><th>Čas</th><th>Typ</th><th>Hodiny</th><th>Poznámka</th></tr></thead><tbody>${detail.join('')}</tbody></table>` : '<p>Na tento měsíc zatím nejsou uložené žádné plány.</p>'}<p>Hodiny jsou po odečtení přestávek. Jde o plán, nikoli skutečně odpracované hodiny, podklad pro výplatu ani potvrzení schválené dovolené.</p><p><a href="https://portal.ekvproject.cz/attendance?tab=planning&amp;month=${month}">Otevřít plán docházky v portálu</a></p><p style="color:#64748b;font-size:12px">Pravidelný report: poslední den měsíce v 18:00, Europe/Prague. Příjemce: ${REPORT_RECIPIENT}. Podrobný přehled je také v CSV příloze.</p></div></body></html>`;
  return { subject, html, csv: '\uFEFF' + csv.map(row => row.map(csvCell).join(';')).join('\r\n'), employeeCount: ordered.length, planCount: active.length, missingCount: totals.missing };
}
