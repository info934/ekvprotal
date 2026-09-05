export const attendanceRpcs = new Set([
  'save_attendance_records', 'save_attendance_record', 'delete_attendance_record',
  'submit_attendance_month', 'withdraw_attendance_submission', 'delete_attendance_submission',
  'approve_attendance_submission', 'reject_attendance_submission',
  'return_attendance_submission_for_edit', 'revert_attendance_submission',
]);

const failure = (message, code = '22023') => ({ data: null, error: { code, message: `Ukázková docházka: ${message}` } });
const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
const trim = value => String(value ?? '').trim() || null;
const clone = value => structuredClone(value);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const monthOf = value => `${String(value).slice(0, 7)}-01`;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const rowsForMonth = (rows, member, month) => rows.filter(row => row.member_id === member && monthOf(row.date) === month);
const sumHours = rows => rows.reduce((total, row) => total + Number(row.hours), 0);
const ledgerSubmissionId = row => row.attendance_submission_id || row.submission_id;

function canonicalRecord(input, actor) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Vyplňte záznam docházky.');
  const row = { member_id: input.member_id || actor, date: input.date, hours: Number(input.hours), project_id: input.project_id || null,
    realizace_id: input.realization_id || input.realizace_id || null, description: trim(input.description) };
  if (input.realization_id && input.realizace_id && input.realization_id !== input.realizace_id) fail('Identifikátory realizace se neshodují.');
  if (!row.member_id || !validDate(row.date) || !Number.isFinite(row.hours) || row.hours <= 0 || row.hours > 24) fail('Vyplňte platné datum a počet hodin větší než 0 a nejvýše 24.');
  if (Boolean(row.project_id) === Boolean(row.realizace_id)) fail('Zvolte právě jeden projekt nebo realizaci.');
  return row;
}

// Local contract simulation only: staging arrays models transaction atomicity,
// while database grants, locking and concurrency are verified separately in SQL.
export function runAttendanceRpc(name, args, { tables, memberId, isAdmin, newId, changed }) {
  if (!attendanceRpcs.has(name)) return failure('Tato operace není podporována.', 'PREVIEW_UNSUPPORTED');
  const now = new Date().toISOString();
  const attendance = tables.attendance || [];
  const submissions = tables.attendance_submissions || [];
  const ledger = tables.labor_cost_ledger || [];
  const members = tables.members || [];
  const canWrite = target => {
    if (!memberId || !members.some(row => row.id === memberId) || (!isAdmin && target !== memberId)) fail('Operace není pro aktuálního pracovníka dostupná.', '42501');
    if (!members.some(row => row.id === target)) fail('Pracovník není dostupný.');
  };
  const adminOnly = () => { if (!memberId || !isAdmin) fail('Rozhodnutí vyžaduje oprávnění správce docházky.', '42501'); };
  const hasHourlyLock = (member, month) => (tables.hourly_payout_requests || []).some(row => row.member_id === member && Number(row.payout_year) === Number(month.slice(0, 4)) && Number(row.payout_month) === Number(month.slice(5, 7)) && ['pending', 'approved', 'invoice_uploaded', 'paid'].includes(row.status));
  const ensureEditable = row => {
    const month = monthOf(row.date);
    if (submissions.some(item => item.member_id === row.member_id && item.month_date === month && ['submitted', 'approved'].includes(item.status))) fail('Odeslaný nebo schválený měsíc je uzamčený.');
    if (hasHourlyLock(row.member_id, month)) fail('Měsíc má aktivní nebo vyplacenou hodinovou žádost. Nejprve vyřešte žádost.');
  };
  const validateRecord = (row, staged, excludedId = null) => {
    canWrite(row.member_id); ensureEditable(row);
    if (row.project_id && !(tables.projects || []).some(project => project.id === row.project_id)) fail('Projekt nebyl nalezen.');
    if (row.realizace_id && !(tables.realizations || []).some(project => project.id === row.realizace_id)) fail('Realizace nebyla nalezena.');
    const hours = staged.filter(existing => existing.id !== excludedId && existing.member_id === row.member_id && existing.date === row.date).reduce((sum, existing) => sum + Number(existing.hours), 0);
    if (hours + row.hours > 24) fail('Celková docházka za den nemůže překročit 24 hodin.');
  };
  const saved = row => { changed(); return clone(row); };
  try {
    if (name === 'save_attendance_records') {
      if (!validUuid(args.p_batch_id) || !Array.isArray(args.p_records) || !args.p_records.length || args.p_records.length > 100) fail('Pro dávku je potřeba stabilní UUID a 1 až 100 záznamů.');
      const canonical = args.p_records.map(input => {
        if (input && ('id' in input || 'record_id' in input)) fail('Dávka slouží pouze k vytvoření nových záznamů.');
        return canonicalRecord(input, memberId);
      });
      if (new Set(canonical.map(row => row.member_id)).size !== 1) fail('Jedna dávka smí patřit pouze jednomu pracovníkovi.');
      canWrite(canonical[0].member_id);
      const receipts = tables.__attendanceReceipts || [];
      const previous = receipts.find(row => row.id === args.p_batch_id);
      if (previous) {
        if (previous.actor !== memberId || previous.member !== canonical[0].member_id || JSON.stringify(previous.payload) !== JSON.stringify(canonical)) fail('Identifikátor dávky již byl použit pro jiné údaje.');
        return clone(previous.result);
      }
      const staged = [...attendance];
      const result = [];
      for (const row of canonical) {
        validateRecord(row, staged);
        const record = { ...row, realization_id: row.realizace_id, id: newId(), created_at: now };
        staged.push(record); result.push(record);
      }
      // Receipts stay private to the local adapter and reset with the fixture object.
      if (!tables.__attendanceReceipts) Object.defineProperty(tables, '__attendanceReceipts', { value: [], enumerable: false });
      tables.attendance = staged;
      tables.__attendanceReceipts.push({ id: args.p_batch_id, actor: memberId, member: canonical[0].member_id, payload: clone(canonical), result: clone(result) });
      return saved(result);
    }
    if (name === 'save_attendance_record') {
      const previous = args.p_record_id ? attendance.find(row => row.id === args.p_record_id) : null;
      if (args.p_record_id && !previous) fail('Záznam nebyl nalezen.');
      if (previous) { canWrite(previous.member_id); ensureEditable(previous); }
      const row = canonicalRecord({ member_id: args.p_member_id, date: args.p_date, hours: args.p_hours, project_id: args.p_project_id, realizace_id: args.p_realizace_id, description: args.p_description }, memberId);
      validateRecord(row, attendance, previous?.id);
      const result = { ...(previous || { id: newId(), created_at: now }), ...row, realization_id: row.realizace_id };
      // Joined preview relation caches must not outlive changed foreign keys.
      for (const key of ['project', 'projects', 'realization', 'realizations', 'member', 'members']) delete result[key];
      tables.attendance = previous ? attendance.map(item => item.id === previous.id ? result : item) : [...attendance, result];
      return saved(result);
    }
    if (name === 'delete_attendance_record') {
      const row = attendance.find(item => item.id === args.p_record_id);
      if (!row) fail('Záznam nebyl nalezen.');
      canWrite(row.member_id); ensureEditable(row);
      tables.attendance = attendance.filter(item => item.id !== row.id);
      return saved(row);
    }
    if (name === 'submit_attendance_month') {
      canWrite(args.p_member_id);
      if (!validDate(args.p_month_date)) fail('Vyberte platný měsíc.');
      const month = monthOf(args.p_month_date);
      const previous = submissions.find(row => row.member_id === args.p_member_id && row.month_date === month);
      if (previous && !['draft', 'rejected', 'returned', 'submitted'].includes(previous.status)) fail('Tento měsíc nelze znovu odeslat.');
      const total = sumHours(rowsForMonth(attendance, args.p_member_id, month));
      if (!(total > 0)) fail('Prázdný měsíc nelze odeslat.');
      const result = { ...(previous || { id: newId(), created_at: now }), member_id: args.p_member_id, month_date: month, status: 'submitted', total_hours: total, submitted_at: now, approved_at: null, approver_id: null, notes: null };
      tables.attendance_submissions = previous ? submissions.map(row => row.id === previous.id ? result : row) : [...submissions, result];
      return saved(result);
    }

    const submission = submissions.find(row => row.id === args.p_submission_id);
    if (!submission) fail('Výkaz nebyl nalezen.');
    canWrite(submission.member_id);
    const administrative = !['withdraw_attendance_submission', 'delete_attendance_submission'].includes(name);
    if (administrative) adminOnly();
    if (name === 'delete_attendance_submission') {
      if (submission.status === 'approved') fail('Schválený výkaz nelze smazat.');
      tables.attendance_submissions = submissions.filter(row => row.id !== submission.id);
      return saved(submission);
    }
    let status;
    if (name === 'approve_attendance_submission' || name === 'reject_attendance_submission') {
      if (submission.status !== 'submitted') fail('Rozhodnout lze pouze o odeslaném výkazu.');
      status = name === 'approve_attendance_submission' ? 'approved' : 'rejected';
    } else if (name === 'return_attendance_submission_for_edit' || name === 'withdraw_attendance_submission') {
      if (submission.status === 'approved') fail('Schválený výkaz nejprve znovu otevřete ke kontrole.');
      status = name === 'return_attendance_submission_for_edit' ? 'returned' : 'draft';
    } else status = 'submitted'; // revert: administrative re-review, still locked
    if (submission.status === 'approved' && status !== 'approved' && (hasHourlyLock(submission.member_id, submission.month_date) || ledger.some(row => ledgerSubmissionId(row) === submission.id && row.status === 'paid'))) fail('Výkaz má aktivní nebo vyplacenou hodinovou žádost. Nevyplacenou žádost nejprve stornujte.');
    const monthRecords = rowsForMonth(attendance, submission.member_id, submission.month_date);
    const result = { ...submission, status, total_hours: sumHours(monthRecords), approver_id: status === 'submitted' || status === 'draft' ? null : memberId, approved_at: status === 'approved' ? now : null };
    if (status === 'draft') Object.assign(result, { submitted_at: null, notes: null });
    else if (status === 'returned' || status === 'rejected') result.notes = trim(args.p_notes);

    let nextLedger = [...ledger];
    let nextAttendance = [...attendance];
    if (status === 'approved') {
      const member = members.find(row => row.id === submission.member_id);
      for (const row of monthRecords) {
        const history = (tables.member_hourly_rate_history || []).filter(rate => rate.member_id === row.member_id && rate.valid_from <= row.date && (!rate.valid_to || rate.valid_to >= row.date)).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
        const rate = Number(history?.hourly_rate ?? member?.hourly_rate);
        if (!(rate > 0) || !Number.isFinite(rate)) fail('Pro schválení chybí platná hodinová sazba.');
        const realization = row.realization_id || row.realizace_id || null;
        const assignments = row.project_id ? tables.project_members || [] : tables.realizace_team_members || [];
        const assignment = assignments.filter(item => item.member_id === row.member_id && (row.project_id ? item.project_id === row.project_id : item.realizace_id === realization) && item.is_hourly === true && item.valid_from <= row.date && (!item.valid_to || item.valid_to >= row.date)).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
        const mode = assignment?.hourly_funding_mode || 'direct_project';
        const percent = mode === 'member_reward' ? Number(assignment?.hourly_sponsor_percent ?? 100) : 0;
        const pay = round(Number(row.hours) * rate);
        const cost = round(pay * (1 + Number(history?.employer_burden_percent || 0) / 100));
        const deduction = mode === 'member_reward' ? round(cost * percent / 100) : 0;
        const existing = nextLedger.find(item => item.attendance_id === row.id && ledgerSubmissionId(item) === submission.id && (item.source_version || 1) === 1);
        const entry = { ...(existing || { id: newId(), created_at: now, source_version: 1 }), attendance_id: row.id, attendance_submission_id: submission.id, member_id: row.member_id, project_id: row.project_id || null, realization_id: realization,
          work_date: row.date, posting_month: submission.month_date, hours: Number(row.hours), hourly_rate: rate, currency: history?.currency || 'CZK', pay_amount: pay, employer_cost: cost,
          funding_mode: mode, sponsor_member_id: assignment?.hourly_sponsor_member_id || null, sponsor_percent: percent, sponsor_reward_deduction: deduction, project_cost_impact: Math.max(0, cost - deduction), status: 'accrued', created_by: existing?.created_by || memberId, updated_at: now };
        nextLedger = existing ? nextLedger.map(item => item.id === existing.id ? entry : item) : [...nextLedger, entry];
        nextAttendance = nextAttendance.map(item => item.id === row.id ? { ...item, hourly_rate_snapshot: rate, employer_cost_snapshot: cost, funding_mode_snapshot: mode, sponsor_member_id_snapshot: entry.sponsor_member_id, sponsor_percent_snapshot: percent, financial_snapshot_at: now } : item);
      }
    } else if (submission.status === 'approved') nextLedger = ledger.map(row => ledgerSubmissionId(row) === submission.id && row.status !== 'paid' ? { ...row, status: 'reversed', updated_at: now } : row);
    tables.attendance_submissions = submissions.map(row => row.id === submission.id ? result : row);
    tables.attendance = nextAttendance;
    tables.labor_cost_ledger = nextLedger;
    return saved(result);
  } catch (error) { return failure(error.message, error.code); }
}
