import { validateMeetingNote } from '../lib/meetingNotes.js';
import { createFixtures, ADMIN_ID, MEMBER_ID, AUTH_ADMIN_ID, AUTH_MEMBER_ID, uuid } from './fixtures.js';
import { getPreviewRole } from './previewState.js';
import { canReadEmployeeRow, employeeTables, employeeRpcs, runEmployeeRpc } from './employeePreview.js';
import { billingFinancialPreview, memberFinancialPreview, projectFinancialPreview, realizationFinancialPreview } from './financialPreview.js';
import { payoutRpcs, runPayoutRpc } from './payoutPreview.js';
import { attendanceRpcs, runAttendanceRpc } from './attendancePreview.js';

let tables = createFixtures();
let nextId = 50000;
const changes = new Set();
const clone = value => value == null ? value : structuredClone(value);
const unavailable = name => ({ data: null, error: { code: 'PREVIEW_UNAVAILABLE', message: `Ukázková data: ${name} není připojeno. Integrace ani serverové operace se v náhledu nespouštějí.` } });
const denied = () => ({ data: null, error: { code: '42501', message: 'Ukázková data: tato operace není pro aktuální roli dostupná.' } });
export const getPreviewMember = () => tables.members.find(item => item.id === (getPreviewRole() === 'admin' ? ADMIN_ID : MEMBER_ID));
export const getPreviewUser = () => {
  const member = getPreviewMember();
  return { id: getPreviewRole() === 'admin' ? AUTH_ADMIN_ID : AUTH_MEMBER_ID, email: member.email, user_metadata: { full_name: member.name }, app_metadata: {} };
};
export const resetPreviewData = () => { tables = createFixtures(); nextId = 50000; changes.forEach(callback => callback()); };

function hydrate(row, table, depth = 0) {
  if (!row || typeof row !== 'object') return row;
  const result = clone(row);
  if (depth > 1) return result;
  const relations = [
    ['project_id', 'projects', ['projects', 'project']],
    ['member_id', 'members', ['members', 'member']],
    ['actor_member_id', 'members', ['actor', 'actor_member']],
    ['subject_id', 'subjects', ['subjects', 'subject', 'customer']],
    ['realization_id', 'realizations', ['realizations', 'realization']],
  ];
  for (const [key, relation, aliases] of relations) {
    const target = tables[relation]?.find(item => item.id === row[key]);
    if (target) for (const alias of aliases) result[alias] = hydrate(target, relation, depth + 1);
  }
  if (table === 'payouts') result.payout_items = tables.payout_items.filter(item => item.payout_id === row.id).map(item => hydrate(item, 'payout_items', depth + 1));
  if (table === 'payout_items') result.payouts = hydrate(tables.payouts.find(item => item.id === row.payout_id), 'payouts', depth + 1);
  if (table === 'projects') result.project_members = tables.project_members.filter(item => item.project_id === row.id).map(item => hydrate(item, 'project_members', depth + 1));
  if (table === 'realizations') result.team = tables.members.filter(item => row.team_members?.includes(item.id));
  return result;
}

const fieldValue = (row, field) => String(field).split('.').reduce((value, key) => value?.[key], row);
const valuesOf = value => Array.isArray(value) ? value : String(value).replace(/^\(|\)$/g, '').split(',').map(item => item.trim().replace(/^"|"$/g, ''));
function matches(actual, operator, expected) {
  switch (operator) {
    case 'eq': return String(actual) === String(expected);
    case 'neq': return String(actual) !== String(expected);
    case 'is': return expected === null || expected === 'null' ? actual == null : actual === expected || String(actual) === String(expected);
    case 'in': return valuesOf(expected).map(String).includes(String(actual));
    case 'lt': return actual != null && actual < expected;
    case 'lte': return actual != null && actual <= expected;
    case 'gt': return actual != null && actual > expected;
    case 'gte': return actual != null && actual >= expected;
    case 'ilike': case 'like': {
      const pattern = String(expected).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(String(actual || ''));
    }
    case 'contains': return valuesOf(expected).every(value => valuesOf(actual || []).includes(value));
    case 'overlaps': return valuesOf(expected).some(value => valuesOf(actual || []).includes(value));
    default: return false;
  }
}

class PreviewQuery {
  constructor(table, source = null, scalar = false) {
    this.table = table; this.source = source; this.scalar = scalar; this.filters = []; this.sorts = [];
    this.operation = 'read'; this.options = {}; this.start = 0; this.end = Infinity;
  }
  select(_fields = '*', options = {}) { this.options = options; return this; }
  filter(field, operator, expected) { this.filters.push(row => matches(fieldValue(row, field), operator, expected)); return this; }
  eq(field, value) { return this.filter(field, 'eq', value); }
  neq(field, value) { return this.filter(field, 'neq', value); }
  is(field, value) { return this.filter(field, 'is', value); }
  in(field, value) { return this.filter(field, 'in', value); }
  lt(field, value) { return this.filter(field, 'lt', value); }
  lte(field, value) { return this.filter(field, 'lte', value); }
  gt(field, value) { return this.filter(field, 'gt', value); }
  gte(field, value) { return this.filter(field, 'gte', value); }
  like(field, value) { return this.filter(field, 'like', value); }
  ilike(field, value) { return this.filter(field, 'ilike', value); }
  contains(field, value) { return this.filter(field, 'contains', value); }
  overlaps(field, value) { return this.filter(field, 'overlaps', value); }
  not(field, operator, value) { this.filters.push(row => !matches(fieldValue(row, field), operator, value)); return this; }
  match(fields) { Object.entries(fields).forEach(([field, value]) => this.eq(field, value)); return this; }
  or(expression) {
    const conditions = expression.split(/,(?![^()]*\))/).map(part => {
      const [field, operator, ...value] = part.split('.');
      return row => matches(fieldValue(row, field), operator, value.join('.'));
    });
    this.filters.push(row => conditions.some(condition => condition(row))); return this;
  }
  order(field, { ascending = true, nullsFirst = false } = {}) { this.sorts.push({ field, ascending, nullsFirst }); return this; }
  limit(value) { this.end = this.start + value; return this; }
  range(start, end) { this.start = start; this.end = end + 1; return this; }
  abortSignal(signal) { this.signal = signal; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  insert(value) { this.operation = 'insert'; this.payload = value; return this; }
  upsert(value) { this.operation = 'upsert'; this.payload = value; return this; }
  update(value) { this.operation = 'update'; this.payload = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  returns() { return this; }
  throwOnError() { this.shouldThrow = true; return this; }
  then(resolve, reject) { this.promise ||= this.execute(); return this.promise.then(resolve, reject); }
  catch(reject) { return this.then(undefined, reject); }
  async execute() {
    if (this.signal?.aborted) throw this.signal.reason || new DOMException('Aborted', 'AbortError');
    let source = typeof this.source === 'function' ? await this.source() : this.source;
    if (source?.error) { if (this.shouldThrow) throw source.error; return source; }
    if (this.scalar) return { data: clone(source), error: null, count: null };
    if (employeeTables.has(this.table) && this.operation !== 'read') {
      const result = denied();
      if (this.shouldThrow) throw result.error;
      return result;
    }
    let rows = source || tables[this.table] || [];
    if (!Array.isArray(rows)) rows = rows == null ? [] : [rows];
    if (employeeTables.has(this.table)) rows = rows.filter(row => canReadEmployeeRow(row, { tables, memberId: getPreviewMember().id, isAdmin: getPreviewRole() === 'admin' }));
    const accepted = row => this.filters.every(filter => filter(hydrate(row, this.table)));
    if (this.operation !== 'read') {
      if (!tables[this.table]) tables[this.table] = [];
      if (this.operation === 'insert' || this.operation === 'upsert') {
        rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(value => {
          const existing = this.operation === 'upsert' && value.id ? tables[this.table].find(item => item.id === value.id) : null;
          if (existing) { Object.assign(existing, clone(value)); return existing; }
          const item = { id: uuid(nextId++), created_at: new Date().toISOString(), ...clone(value) };
          tables[this.table].push(item); return item;
        });
      } else {
        rows = tables[this.table].filter(accepted);
        if (this.operation === 'update') rows.forEach(row => Object.assign(row, clone(this.payload)));
        if (this.operation === 'delete') tables[this.table] = tables[this.table].filter(row => !accepted(row));
      }
      queueMicrotask(() => changes.forEach(callback => callback()));
    } else rows = rows.filter(accepted);
    const count = rows.length;
    rows = [...rows].sort((a, b) => {
      for (const { field, ascending, nullsFirst } of this.sorts) {
        const left = fieldValue(a, field), right = fieldValue(b, field);
        if (left === right) continue;
        if (left == null || right == null) return (left == null ? -1 : 1) * (nullsFirst ? 1 : -1);
        const comparison = String(left).localeCompare(String(right), 'cs', { numeric: true });
        if (comparison) return ascending ? comparison : -comparison;
      }
      return 0;
    }).slice(this.start, this.end).map(row => hydrate(row, this.table));
    if (this.options.head) return { data: null, error: null, count };
    if (this.singleMode) {
      if (rows.length > 1 || (this.singleMode === 'single' && !rows.length)) {
        return { data: null, error: { code: 'PGRST116', message: 'Ukázkový dotaz nevrátil právě jeden záznam.' }, count };
      }
      return { data: rows[0] || null, error: null, count };
    }
    return { data: rows, error: null, count: this.options.count ? count : null };
  }
}

function rpc(name, args = {}) {
  if(name==='create_meeting_point_task')return new PreviewQuery(name,()=>{
   if(getPreviewRole()!=='admin')return denied();
   const note=tables.meeting_notes?.find(n=>n.id===args.p_note_id),point=note?.points[args.p_point_index];
   if(!note||note.version!==args.p_version||!point||point.planning_item_id)return {data:null,error:{message:'Zápis se změnil nebo bod již má úkol.'}};
   if(!tables.members.some(m=>m.id===args.p_member_id)||!args.p_name?.trim()||!args.p_due)return {data:null,error:{message:'Vyplňte úkol, osobu a termín.'}};
   const id=uuid(nextId++);tables.planning_items.push({id,plan_id:note.plan_id,item_type:'task',name:args.p_name,status:'planned',member_id:args.p_member_id,end_date:args.p_due,start_date:new Date().toLocaleDateString('sv-SE')});
   point.kind='task';point.planning_item_id=id;note.version++;
   tables.meeting_note_versions ||= [];tables.meeting_note_versions.push({note_id:note.id,version:note.version,snapshot:clone(note),created_at:new Date().toISOString()});
   return clone(note);
  },true);
  if (name === 'save_meeting_note') return new PreviewQuery(name, () => {
    if (getPreviewRole() !== 'admin') return denied();
    const row = { id: args.p_id, plan_id: args.p_plan_id, title: args.p_title, meeting_date: args.p_date, participants: args.p_participants, points: args.p_points, version: args.p_version + 1 };
    const message = validateMeetingNote(row);
    if (message) return { data:null, error:{message} };
    if (!tables.planning_plans.some(p => p.plan_id===row.plan_id)) return denied();
    if(row.points.some(p=>p.planning_item_id && !tables.planning_items.some(i=>i.id===p.planning_item_id && i.plan_id===row.plan_id)))return denied();
    tables.meeting_notes ||= [];
    const old=tables.meeting_notes.find(r=>r.id===row.id);
    if ((old && (old.version!==args.p_version || old.plan_id!==row.plan_id)) || (!old && args.p_version!==0))return {data:null,error:{message:'Zápis mezitím upravil někdo jiný.'}};
    if(old)Object.assign(old,clone(row));else tables.meeting_notes.push(clone(row));
    tables.meeting_note_versions ||= []; tables.meeting_note_versions.push({note_id:row.id,version:row.version,snapshot:clone(row),created_at:new Date().toISOString()});
    return row;
  },true);
  const projectId = args.p_project_id;
  const realizationId = args.p_realization_id || args.p_realizace_id;
  const one = source => new PreviewQuery(name, source, true);
  const list = (table, predicate = () => true) => new PreviewQuery(table, () => (tables[table] || []).filter(predicate));
  if (attendanceRpcs.has(name)) return one(() => runAttendanceRpc(name, args, {
    tables, memberId: getPreviewMember().id, isAdmin: getPreviewRole() === 'admin', newId: () => uuid(nextId++),
    changed: () => queueMicrotask(() => changes.forEach(callback => callback())),
  }));
  if (payoutRpcs.has(name)) return one(() => runPayoutRpc(name, args, {
    tables, memberId: getPreviewMember().id, isAdmin: getPreviewRole() === 'admin', newId: () => uuid(nextId++),
    changed: () => queueMicrotask(() => changes.forEach(callback => callback())),
  }));
  if (employeeRpcs.has(name)) return one(() => runEmployeeRpc(name, args, {
    tables, memberId: getPreviewMember().id, isAdmin: getPreviewRole() === 'admin', newId: () => uuid(nextId++),
    changed: () => queueMicrotask(() => changes.forEach(callback => callback())),
  }));
  const targetMemberId = args.p_member_id || getPreviewMember().id;
  const canReadCompensation = () => getPreviewRole() === 'admin' || targetMemberId === getPreviewMember().id;
  const memberFinancials = () => canReadCompensation() ? memberFinancialPreview(tables, targetMemberId) : denied();
  switch (name) {
    case 'get_hourly_payout_discrepancies': return new PreviewQuery(name, () => getPreviewRole() === 'admin' ? [] : denied());
    case 'list_member_compensations_admin': return new PreviewQuery(name, () => getPreviewRole() === 'admin' ? tables.members.map(row => ({ member_id: row.id, hourly_rate: row.hourly_rate, currency: 'CZK', attendance_enabled: row.attendance_enabled })) : denied());
    case 'list_projects_safe': case 'get_user_projects': return list('projects');
    case 'get_project_safe': return one(() => hydrate(tables.projects.find(item => item.id === projectId), 'projects'));
    case 'list_realizations_safe': return list('realizations');
    case 'get_realization_safe': return one(() => hydrate(tables.realizations.find(item => item.id === realizationId), 'realizations'));
    case 'list_project_members_safe': return list('project_members', item => item.project_id === projectId);
    case 'list_planning_members_safe': case 'list_members_safe': return list('members');
    case 'list_planning_plans_safe': return list('planning_plans', item => !args.p_entity_type || item.entity_type === args.p_entity_type);
    case 'get_member_compensation': return one(() => canReadCompensation() ? { member_id: targetMemberId, hourly_rate: 450, currency: 'CZK', attendance_enabled: true, compensation_mode: 'hourly' } : denied());
    case 'get_member_id': return one(getPreviewMember().id);
    case 'get_user_role': return one(getPreviewRole() === 'admin' ? 'admin' : 'user');
    case 'get_current_member_identity': return new PreviewQuery('members', () => [getPreviewMember()]);
    case 'get_member_project_rewards': return new PreviewQuery(name, () => { const result = memberFinancials(); return result.error ? result : result.projects; });
    case 'get_projects_with_balance': return one(() => { const result = memberFinancials(); return result.error ? result : result.projects; });
    case 'get_realizations_with_balance': return one(() => { const result = memberFinancials(); return result.error ? result : result.realizations; });
    case 'get_my_realization_reward': return one(() => {
      // The production RPC always resolves the signed-in member, never a caller-supplied member id.
      const memberId = getPreviewMember().id;
      const reward = memberFinancialPreview(tables, memberId).realizations.find(row => row.realization_id === realizationId);
      return { realization_id: realizationId, member_id: memberId, has_reward: Boolean(reward),
        share_type: reward?.share_type || null, share_value: reward?.share_value || 0,
        gross_reward: reward?.total_share || 0, sponsored_labor_deduction: 0, net_reward: reward?.total_share || 0 };
    });
    case 'get_payout_availability': return one(memberFinancials);
    case 'get_user_activities': return one([]);
    case 'list_project_subcontractors_safe': case 'list_planning_subcontractors_safe': return one([]);
    case 'project_financial_summary': return one(() => projectFinancialPreview(tables, projectId));
    case 'project_labor_financial_summary': case 'realization_labor_financial_summary': return one({ total_hours: 29.5, approved_hours: 21.5, pending_hours: 8, hourly_cost: 13275, paid_amount: 10000, pending_amount: 3275, members: [] });
    case 'realization_financial_preview': return one(() => realizationFinancialPreview(tables, realizationId, args.p_overrides));
    case 'get_realization_reward_plan': return one(() => {
      if (getPreviewRole() !== 'admin') return denied();
      const result = realizationFinancialPreview(tables, realizationId);
      if (result.error) return result;
      const row = tables.realizations.find(item => item.id === realizationId);
      const active = ['Dokončeno', 'Předáno'].includes(row.status);
      const shares = result.member_shares.map((share, index) => ({ ...share, id: `${realizationId}-reward-${index}`, member_name: share.members?.name, note: null }));
      return { realization_id: realizationId, status: row.status, activation_state: active ? 'active' : 'planned', shares, active_shares: active ? shares : [] };
    });
    case 'get_entity_billing_summary': return one(() => billingFinancialPreview(tables, args.p_entity_type, args.p_entity_id));
    case 'get_user_financials': return one([{ total_reward: 120000, paid_amount: 44000, pending_amount: 28500, available_balance: 47500 }]);
    case 'get_company_financials': return one([{ realized_profit: 165000, potential_profit: 475000, total_overhead: 98000, total_project_value: 1420000, unallocated_budget: 125000 }]);
    case 'get_overhead_summary': return one([{ total_allocated_overhead: 98000, total_accounted_overhead: 84000 }]);
    case 'can_access_project': case 'can_access_realization': return one(true);
    case 'get_attendance_for_admin': case 'get_attendance_summary': return list('attendance');
    case 'update_project_status': case 'update_realization_status': return one(() => {
      const table = name === 'update_project_status' ? 'projects' : 'realizations';
      const row = tables[table].find(item => item.id === (projectId || realizationId));
      if (!row) return null;
      row.status = args.p_next_status;
      return hydrate(row, table);
    });
    default: return new PreviewQuery(name, () => unavailable(`RPC ${name}`));
  }
}

export const supabase = {
  from: table => new PreviewQuery(table), rpc,
  auth: {
    getUser: async () => ({ data: { user: getPreviewUser() }, error: null }),
    getSession: async () => ({ data: { session: { user: getPreviewUser(), access_token: null } }, error: null }),
    signOut: async () => unavailable('Odhlášení z reálného účtu'),
    signInWithPassword: async () => unavailable('Přihlášení'),
    signInWithOAuth: async () => unavailable('SSO'),
    updateUser: async () => unavailable('Změna účtu nebo hesla'),
    verifyOtp: async () => unavailable('Ověření relace'),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  functions: { invoke: async name => unavailable(`Integrace ${name}`) },
  storage: { from: () => ({
    upload: async () => unavailable('Nahrávání souborů'), download: async () => unavailable('Stažení souboru'),
    remove: async () => unavailable('Smazání souboru'), list: async () => ({ data: [], error: null }),
    createSignedUrl: async () => unavailable('Odkaz na soubor'), getPublicUrl: () => ({ data: { publicUrl: null } }),
  }) },
  channel() {
    const callbacks = [];
    const channel = {
      on(_event, _filter, callback) { callbacks.push(callback); return channel; },
      subscribe() { callbacks.forEach(callback => changes.add(callback)); return channel; },
      unsubscribe() { callbacks.forEach(callback => changes.delete(callback)); return Promise.resolve(); },
    };
    return channel;
  },
  removeChannel: channel => channel.unsubscribe(),
};
export const customSupabaseClient = supabase;
export default supabase;
