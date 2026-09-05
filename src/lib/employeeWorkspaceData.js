import {
  employeeRequestTransitions, isValidEmployeeDate,
  validateEmployeeAsset, validateEmployeeRecord, validateEmployeeRequest,
} from './employeeWorkspace.js';

const MEMBERS = 'id,name,email,job_title,department,company,user_role';
const PROFILE = 'member_id,employment_status,note,updated_at,updated_by';
const ASSETS = 'id,member_id,asset_type,label,identifier,status,assigned_on,due_on,returned_on,note,created_at,updated_at';
const RECORDS = 'id,member_id,title,kind,status,valid_from,valid_until,reference_url,note,verified_by,verified_at,created_at,updated_at';
const REQUESTS = 'id,member_id,request_type,title,description,estimated_cost,requested_for,status,decision_note,decided_by,decided_at,fulfilled_by,fulfilled_at,created_at,updated_at,member:members!employee_requests_member_id_members_fkey(id,name,job_title)';
const EVENTS = 'id,request_id,member_id,actor_member_id,actor_name,from_status,to_status,note,created_at';

export const employeeLocalDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function fetchAllEmployeeRows(factory, signal, pageSize = 250) {
  const rows = [];
  while (true) {
    if (signal?.aborted) throw new DOMException('Načítání bylo zrušeno.', 'AbortError');
    let query = factory().range(rows.length, rows.length + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Server nevrátil platný seznam záznamů.');
    if (result.data.length === 0) return rows;
    rows.push(...result.data);
  }
}

async function loadRequestEvents(client, requests, signal) {
  const events = [];
  for (let start = 0; start < requests.length; start += 100) {
    const ids = requests.slice(start, start + 100).map((request) => request.id);
    events.push(...await fetchAllEmployeeRows(() => client.from('employee_request_events').select(EVENTS)
      .in('request_id', ids).order('created_at').order('id'), signal));
  }
  return events;
}

export async function loadEmployeeWorkspace(client, { actorMemberId, targetMemberId, isAdmin = false, scopeAll = false, signal }) {
  if (!actorMemberId) return { access: 'missing-member' };
  if (scopeAll && !isAdmin) return { access: 'forbidden' };
  if (targetMemberId !== actorMemberId && !isAdmin) return { access: 'forbidden' };

  if (scopeAll) {
    const requests = await fetchAllEmployeeRows(() => client.from('employee_requests').select(REQUESTS).order('created_at', { ascending: false }).order('id'), signal);
    const events = await loadRequestEvents(client, requests, signal);
    return { access: 'queue', requests, events, assets: [], records: [] };
  }

  const withSignal = query => signal ? query.abortSignal(signal) : query;
  // A member may legitimately have no employee profile. Read both independently
  // so an administrator can explicitly create it, rather than auto-enrolling.
  const [memberResult, profileResult] = await Promise.all([
    withSignal(client.from('members').select(MEMBERS).eq('id', targetMemberId).maybeSingle()),
    withSignal(client.from('employee_profiles').select(PROFILE).eq('member_id', targetMemberId).maybeSingle()),
  ]);
  if (memberResult.error) throw memberResult.error;
  if (profileResult.error) throw profileResult.error;
  if (!memberResult.data) return { access: 'not-found' };
  const base = { member: memberResult.data, profile: profileResult.data, assets: [], records: [], requests: [], events: [] };
  if (!profileResult.data) return { ...base, access: isAdmin ? 'needs-profile' : 'inactive' };
  if (!isAdmin && profileResult.data.employment_status !== 'active') return { access: 'inactive' };

  const [assets, records, requests] = await Promise.all([
    fetchAllEmployeeRows(() => client.from('employee_asset_assignments').select(ASSETS).eq('member_id', targetMemberId).order('assigned_on', { ascending: false }).order('id'), signal),
    fetchAllEmployeeRows(() => client.from('employee_records').select(RECORDS).eq('member_id', targetMemberId).order('valid_until', { ascending: true, nullsFirst: false }).order('id'), signal),
    fetchAllEmployeeRows(() => client.from('employee_requests').select(REQUESTS).eq('member_id', targetMemberId).order('created_at', { ascending: false }).order('id'), signal),
  ]);
  const events = await loadRequestEvents(client, requests, signal);
  return { ...base, access: 'ready', assets, records, requests, events };
}

export const employeeWorkspaceError = (error) => {
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return 'Zaměstnanecká karta vyžaduje databázovou aktualizaci. Obraťte se na administrátora.';
  if (error?.code === '42501') return 'K této operaci nemáte přístup, nebo zaměstnanecká samoobsluha není aktivní.';
  if (error?.name === 'AbortError') return 'Načítání bylo přerušeno. Zkuste kartu obnovit.';
  return error?.message || 'Operaci se nepodařilo dokončit. Vaše rozepsané hodnoty zůstaly ve formuláři.';
};

export function employeeRecordValidity(record, today = employeeLocalDate()) {
  if (record.status === 'expired' || (record.valid_until && record.valid_until < today)) return { tone: 'danger', label: 'Platnost skončila' };
  if (record.status !== 'verified') return { tone: 'warning', label: 'Čeká na ověření' };
  if (record.valid_from && record.valid_from > today) return { tone: 'neutral', label: 'Platnost ještě nezačala' };
  if (record.valid_until) {
    const days = Math.ceil((Date.parse(`${record.valid_until}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (days <= 30) return { tone: 'warning', label: days === 0 ? 'Platí do dneška' : `Končí za ${days} dní` };
  }
  return { tone: 'success', label: 'Ověřeno' };
}

const nullableText = value => String(value ?? '').trim() || null;
const requireAdmin = isAdmin => { if (!isAdmin) throw new Error('Tuto operaci provádí administrátor.'); };

export function buildEmployeeMutation(kind, form, { isAdmin, actorMemberId, targetMemberId, activeEmployee, request = null }) {
  if (!actorMemberId) throw new Error('Účet není propojený se zaměstnancem.');
  if (kind === 'request') {
    if (!activeEmployee || targetMemberId !== actorMemberId) throw new Error('Žádost lze vytvořit pouze ve vlastní aktivní zaměstnanecké kartě.');
    const requestData = { id: form.id, request_type: form.request_type, title: String(form.title || '').trim(), description: String(form.description || '').trim(),
      estimated_cost: form.estimated_cost === '' || form.estimated_cost == null ? null : Number(String(form.estimated_cost).replace(',', '.')),
      requested_for: form.requested_for || null };
    const error = validateEmployeeRequest(requestData);
    if (error) throw new Error(error);
    return { rpc: 'create_employee_request', args: { p_request: requestData } };
  }
  if (kind === 'transition') {
    const isOwner = Boolean(activeEmployee && request?.member_id === actorMemberId);
    if (!request || !employeeRequestTransitions(request.status, { isAdmin, isOwner }).includes(form.status)) throw new Error('Tuto změnu stavu žádosti nyní nelze provést. Obnovte přehled.');
    if (form.status === 'rejected' && !String(form.note || '').trim()) throw new Error('Uveďte důvod zamítnutí, aby žadatel věděl, jak pokračovat.');
    return { rpc: 'transition_employee_request', args: { p_request_id: request.id, p_status: form.status, p_note: nullableText(form.note) } };
  }
  requireAdmin(isAdmin);
  if (kind === 'profile') {
    if (!['active', 'inactive'].includes(form.employment_status)) throw new Error('Vyberte zaměstnanecký stav.');
    return { rpc: 'set_employee_profile', args: { p_member_id: targetMemberId, p_employment_status: form.employment_status, p_note: nullableText(form.note) } };
  }
  if (kind === 'asset') {
    const asset = { asset_type: form.asset_type, label: String(form.label || '').trim(), identifier: nullableText(form.identifier), assigned_on: form.assigned_on,
      due_on: form.due_on || null, note: nullableText(form.note) };
    if (!form.id && form.create_id) asset.id = form.create_id;
    const error = validateEmployeeAsset(asset);
    if (error) throw new Error(error);
    return { rpc: 'save_employee_asset', args: { p_member_id: targetMemberId, p_asset_id: form.id || null, p_asset: asset } };
  }
  if (kind === 'return') {
    if (!isValidEmployeeDate(form.returned_on) || (form.assigned_on && form.returned_on < form.assigned_on)) throw new Error('Datum vrácení nesmí být před předáním majetku.');
    return { rpc: 'return_employee_asset', args: { p_asset_id: form.id, p_returned_on: form.returned_on, p_note: nullableText(form.note) } };
  }
  if (kind === 'record') {
    const record = { title: String(form.title || '').trim(), kind: form.kind, status: form.status, valid_from: form.valid_from || null,
      valid_until: form.valid_until || null, reference_url: nullableText(form.reference_url), note: nullableText(form.note) };
    if (!form.id && form.create_id) record.id = form.create_id;
    const error = validateEmployeeRecord(record);
    if (error) throw new Error(error);
    return { rpc: 'save_employee_record', args: { p_member_id: targetMemberId, p_record_id: form.id || null, p_record: record } };
  }
  throw new Error('Neznámá operace zaměstnanecké karty.');
}

export async function saveEmployeeMutation(client, kind, form, context) {
  const mutation = buildEmployeeMutation(kind, form, context);
  const result = await client.rpc(mutation.rpc, mutation.args);
  if (result.error) throw result.error;
  if (!result.data?.id && !result.data?.member_id) throw new Error('Server nepotvrdil uložení. Obnovte přehled před opakováním operace.');
  return result.data;
}

export const employeeFiniteAmount = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function formatEmployeeMoney(value, currency = 'CZK') {
  if (employeeFiniteAmount(value) === null) return 'Nedostupné';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return 'Měna není uvedena';
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}
export function sumEmployeeAmounts(rows, field) {
  if (!Array.isArray(rows)) return null;
  const amounts = rows.map(row => employeeFiniteAmount(row[field]));
  return amounts.some(value => value === null) ? null : amounts.reduce((total, value) => total + value, 0);
}

export async function loadEmployeeFinance(client, { actorMemberId, targetMemberId, isAdmin = false, signal }) {
  if (!actorMemberId || !targetMemberId || (!isAdmin && actorMemberId !== targetMemberId)) throw new Error('K těmto finančním údajům nemáte přístup.');
  const rpc = async (name, args) => {
    let query = client.rpc(name, args);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    if (result.error) throw result.error;
    if (result.data == null) throw new Error('Finanční údaje nejsou dostupné.');
    return result.data;
  };
  const definitions = {
    compensation: () => rpc('get_member_compensation', { p_member_id: targetMemberId }),
    availability: async () => {
      const data = await rpc('get_payout_availability', { p_member_id: targetMemberId, p_edit_payout_id: null });
      if (!Array.isArray(data.projects) || !Array.isArray(data.realizations)) throw new Error('Přehled finančních nároků není úplný.');
      return data;
    },
    rewards: () => fetchAllEmployeeRows(() => client.rpc('get_member_project_rewards', { p_member_id: targetMemberId }).order('project_id'), signal),
    payouts: () => fetchAllEmployeeRows(() => client.from('payouts').select('id,member_id,amount,status,request_date,reason,payout_items(id,amount,project_id,realization_id,realizace_id,projects(name),realizations:realizations!payout_items_realizace_id_fkey(name),realization:realizations!payout_items_realization_id_fkey(name))').eq('member_id', targetMemberId).order('request_date', { ascending: false }).order('id'), signal),
    hourly: () => fetchAllEmployeeRows(() => client.from('hourly_payout_requests').select('id,member_id,total_amount,status,created_at').eq('member_id', targetMemberId).order('created_at', { ascending: false }).order('id'), signal),
  };
  const names = Object.keys(definitions);
  const results = await Promise.allSettled(names.map(name => definitions[name]()));
  if (signal?.aborted) throw new DOMException('Načítání bylo zrušeno.', 'AbortError');
  return Object.fromEntries(names.map((name, index) => [name, results[index].status === 'fulfilled' ? { data: results[index].value, error: null } : { data: null, error: employeeWorkspaceError(results[index].reason) }]));
}

export function employeeFinanceView(finance) {
  const availability = finance?.availability?.data;
  const entitlements = availability ? [
    ...availability.projects.map(row => ({ id: row.project_id, kind: 'Projekt', name: row.project_name, code: row.project_code,
      total: employeeFiniteAmount(row.total_reward), available: employeeFiniteAmount(row.available_balance), recommended: employeeFiniteAmount(row.recommended_available_balance ?? row.available_balance), reserved: employeeFiniteAmount(row.reserved_payouts), paid: employeeFiniteAmount(row.paid_payouts), href: `/projects/${row.project_id}` })),
    ...availability.realizations.map(row => ({ id: row.id, kind: 'Realizace', name: row.name, code: row.code,
      total: employeeFiniteAmount(row.total_share), available: employeeFiniteAmount(row.available_share), recommended: employeeFiniteAmount(row.recommended_available_share ?? row.available_share), reserved: employeeFiniteAmount(row.reserved_payouts), paid: employeeFiniteAmount(row.paid_amount), href: `/realizace/${row.id}` })),
  ] : null;
  // Payout headers are the only source for paid/pending totals. Never sum reward
  // rows together with availability, or payout line items together with headers.
  const fixed = finance?.payouts?.data;
  const hourly = finance?.hourly?.data;
  const payoutsComplete = Array.isArray(fixed) && Array.isArray(hourly);
  const payouts = Array.isArray(fixed) || Array.isArray(hourly) ? [
    ...(fixed || []).map(row => ({ ...row, key: `fixed-${row.id}`, kind: 'Odměna', date: row.request_date })),
    ...(hourly || []).map(row => ({ ...row, key: `hourly-${row.id}`, kind: 'Hodinová odměna', amount: row.total_amount, date: row.created_at })),
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : null;
  return { entitlements, payouts, payoutsComplete, available: sumEmployeeAmounts(entitlements, 'available'),
    paid: payoutsComplete ? sumEmployeeAmounts(payouts.filter(row => row.status === 'paid'), 'amount') : null,
    pending: payoutsComplete ? sumEmployeeAmounts(payouts.filter(row => ['pending', 'approved', 'invoice_uploaded'].includes(row.status)), 'amount') : null };
}
