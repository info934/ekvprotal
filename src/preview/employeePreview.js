import { previewDate } from './previewState.js';

export const employeeTables = new Set(['employee_profiles', 'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events']);
export const employeeRpcs = new Set(['set_employee_profile', 'save_employee_asset', 'return_employee_asset', 'save_employee_record', 'create_employee_request', 'transition_employee_request']);
const failure = (message, code = '22023') => ({ data: null, error: { code, message: `Ukázková evidence: ${message}` } });
const denied = () => failure('Tato operace není pro aktuální roli dostupná.', '42501');
const text = value => String(value ?? '').trim();
const hasActiveProfile = (tables, memberId) => tables.employee_profiles.some(row => row.member_id === memberId && row.employment_status === 'active');
const validDate = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
const datesInOrder = (start, end) => validDate(start) && validDate(end) && (!start || !end || end >= start);

export const canReadEmployeeRow = (row, { tables, memberId, isAdmin }) => isAdmin || (row.member_id === memberId && hasActiveProfile(tables, memberId));

// A bounded, local simulation of the employee RPC contract. Database RLS,
// transactions and concurrency remain covered by backend checks, not this mock.
export function runEmployeeRpc(name, args, { tables, memberId, isAdmin, newId, changed }) {
  const now = new Date().toISOString();
  const memberExists = id => tables.members.some(row => row.id === id);
  const saved = row => { changed(); return structuredClone(row); };
  const audit = row => Object.assign(row, { updated_by: memberId, updated_at: now });
  const event = (request, from, note = null) => tables.employee_request_events.push({
    id: newId(), request_id: request.id, member_id: request.member_id, actor_member_id: memberId,
    actor_name: tables.members.find(row => row.id === memberId)?.name || 'Uživatel', from_status: from, to_status: request.status, note, created_at: now,
  });

  if (name === 'set_employee_profile') {
    if (!isAdmin) return denied();
    if (!memberExists(args.p_member_id) || !['active', 'inactive'].includes(args.p_employment_status)) return failure('Vyberte pracovníka a platný stav zaměstnání.');
    let row = tables.employee_profiles.find(profile => profile.member_id === args.p_member_id);
    if (!row) { row = { member_id: args.p_member_id, created_by: memberId, created_at: now }; tables.employee_profiles.push(row); }
    Object.assign(row, { employment_status: args.p_employment_status, note: text(args.p_note) || null });
    return saved(audit(row));
  }

  if (name === 'create_employee_request') {
    if (!hasActiveProfile(tables, memberId)) return denied();
    const input = args.p_request || {};
    const cost = input.estimated_cost == null || input.estimated_cost === '' ? null : Number(input.estimated_cost);
    if (!['training', 'license', 'equipment'].includes(input.request_type) || !text(input.title)) return failure('Vyplňte typ a název žádosti.');
    if ((cost !== null && (!Number.isFinite(cost) || cost < 0)) || !validDate(input.requested_for)) return failure('Zkontrolujte cenu a požadovaný termín.');
    const previous = input.id ? tables.employee_requests.find(row => row.id === input.id) : null;
    if (previous) {
      const identical = previous.member_id === memberId && previous.request_type === input.request_type && previous.title === text(input.title)
        && previous.description === text(input.description) && previous.estimated_cost === cost && previous.requested_for === (input.requested_for || null);
      return identical ? structuredClone(previous) : failure('Identifikátor žádosti již používá jiný záznam.');
    }
    const row = { id: input.id || newId(), member_id: memberId, request_type: input.request_type, title: text(input.title), description: text(input.description), estimated_cost: cost,
      requested_for: input.requested_for || null, status: 'pending', decision_note: null, decided_by: null, decided_at: null,
      fulfilled_by: null, fulfilled_at: null, created_at: now, updated_at: now };
    tables.employee_requests.push(row);
    event(row, null);
    return saved(row);
  }

  if (name === 'transition_employee_request') {
    const row = tables.employee_requests.find(request => request.id === args.p_request_id);
    if (!row || !canReadEmployeeRow(row, { tables, memberId, isAdmin })) return denied();
    const next = args.p_status;
    const ownCancellation = row.member_id === memberId && hasActiveProfile(tables, memberId) && row.status === 'pending' && next === 'cancelled';
    const adminDecision = isAdmin && ((row.status === 'pending' && ['approved', 'rejected'].includes(next)) || (row.status === 'approved' && next === 'fulfilled'));
    if (!ownCancellation && !adminDecision) return failure('Tento přechod stavu není povolen.');
    const note = text(args.p_note) || null;
    if (next === 'rejected' && !note) return failure('Při zamítnutí vyplňte důvod.');
    const previous = row.status;
    Object.assign(row, { status: next, updated_at: now });
    if (next !== 'fulfilled') Object.assign(row, { decision_note: note, decided_by: memberId, decided_at: now });
    if (next === 'fulfilled') Object.assign(row, { decision_note: note || row.decision_note, fulfilled_by: memberId, fulfilled_at: now });
    event(row, previous, row.decision_note);
    return saved(row);
  }

  if (!isAdmin) return denied();
  if (name === 'save_employee_asset') {
    const input = args.p_asset || {};
    const row = args.p_asset_id ? tables.employee_asset_assignments.find(asset => asset.id === args.p_asset_id && asset.member_id === args.p_member_id) : null;
    if (!tables.employee_profiles.some(profile => profile.member_id === args.p_member_id) || (args.p_asset_id && !row)) return failure('Profil zaměstnance nebo předaný majetek nebyl nalezen.');
    if (row && row.status !== 'issued') return failure('Vrácený majetek již nelze měnit.');
    if (!['vehicle', 'key', 'device', 'license', 'other'].includes(input.asset_type) || !text(input.label)) return failure('Vyplňte typ a název majetku.');
    const assigned = input.assigned_on || row?.assigned_on || previewDate();
    if (!datesInOrder(assigned, input.due_on)) return failure('Zkontrolujte datum předání a vrácení.');
    const fields = { asset_type: input.asset_type, label: text(input.label), identifier: text(input.identifier) || null, assigned_on: assigned, due_on: input.due_on || null, note: text(input.note) || null };
    const previous = !args.p_asset_id && input.id ? tables.employee_asset_assignments.find(asset => asset.id === input.id) : null;
    if (previous) {
      const identical = previous.member_id === args.p_member_id && Object.entries(fields).every(([key, value]) => previous[key] === value);
      return identical ? structuredClone(previous) : failure('Identifikátor majetku již používá jiný záznam.');
    }
    const target = row || { id: input.id || newId(), member_id: args.p_member_id, status: 'issued', returned_on: null, created_by: memberId, created_at: now };
    Object.assign(target, fields);
    if (!row) tables.employee_asset_assignments.push(target);
    return saved(audit(target));
  }
  if (name === 'return_employee_asset') {
    const row = tables.employee_asset_assignments.find(asset => asset.id === args.p_asset_id);
    if (!row || row.status !== 'issued') return failure('Majetek není evidován jako předaný.');
    const returned = args.p_returned_on === undefined ? previewDate() : args.p_returned_on;
    if (!returned || !datesInOrder(row.assigned_on, returned)) return failure('Vrácení nesmí předcházet předání.');
    Object.assign(row, { status: 'returned', returned_on: returned, note: text(args.p_note) || row.note });
    return saved(audit(row));
  }
  if (name === 'save_employee_record') {
    const input = args.p_record || {};
    const row = args.p_record_id ? tables.employee_records.find(record => record.id === args.p_record_id && record.member_id === args.p_member_id) : null;
    if (!tables.employee_profiles.some(profile => profile.member_id === args.p_member_id) || (args.p_record_id && !row)) return failure('Profil zaměstnance nebo dokument nebyl nalezen.');
    const status = input.status || 'pending';
    if (!['contract', 'verification', 'training'].includes(input.kind) || !['pending', 'verified', 'expired'].includes(status) || !text(input.title)) return failure('Vyplňte název, typ a stav dokumentu.');
    if (!datesInOrder(input.valid_from, input.valid_until)) return failure('Zkontrolujte období platnosti.');
    const url = text(input.reference_url) || null;
    if (url && (!/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#].*)?$/.test(url) || /[\s<>"'\\]/.test(url))) return failure('Použijte platný a bezpečný HTTPS odkaz.');
    const fields = { title: text(input.title), kind: input.kind, status, valid_from: input.valid_from || null, valid_until: input.valid_until || null, reference_url: url, note: text(input.note) || null };
    const previous = !args.p_record_id && input.id ? tables.employee_records.find(record => record.id === input.id) : null;
    if (previous) {
      const identical = previous.member_id === args.p_member_id && Object.entries(fields).every(([key, value]) => previous[key] === value);
      return identical ? structuredClone(previous) : failure('Identifikátor dokumentu již používá jiný záznam.');
    }
    const target = row || { id: input.id || newId(), member_id: args.p_member_id, created_by: memberId, created_at: now };
    Object.assign(target, { ...fields, verified_by: status === 'verified' ? memberId : status === 'expired' ? target.verified_by || null : null,
      verified_at: status === 'verified' ? now : status === 'expired' ? target.verified_at || null : null });
    if (!row) tables.employee_records.push(target);
    return saved(audit(target));
  }
  return failure('Nepodporovaná operace.');
}
