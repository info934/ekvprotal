import { formatProjectCode, normalizeProjectPrefix, PROJECT_PREFIX_PATTERN } from '../lib/projectNumbering.js';

export const jobCreationRpcs = new Set(['preview_project_code', 'preview_crm_opportunity_number', 'save_project_type', 'save_project_safe', 'create_crm_opportunity_simple', 'update_entity_planning_estimate', 'save_project_workspace_preference']);

export function runJobCreationRpc(name, args, { tables, isAdmin, memberId, newId }) {
  const fail = (message, code = '23514') => ({ data: null, error: { message, code } });
  if (!isAdmin) return fail('Ukázková data: nemáte oprávnění upravovat projekty nebo CRM.', '42501');
  const year = new Date().getFullYear();
  const prefixFor = type => tables.project_types?.find(item => item.name === type)?.code_prefix || 'PR';
  const next = (kind, prefix) => {
    const stem = `${prefix}-${String(year).slice(-2)}-`;
    const rows = kind === 'project' ? tables.projects : tables.crm_opportunities;
    const existing = rows.map(row => String((kind === 'project' ? row.code : row.number) || '').trim())
      .filter(code => code.startsWith(stem) && /^[0-9]{1,12}$/.test(code.slice(stem.length)))
      .map(code => Number(code.slice(stem.length)));
    const counter = tables.job_number_sequences?.find(item => item.kind === kind && item.prefix === prefix && item.year === year);
    return Math.max(0, counter?.last_number || 0, ...existing) + 1;
  };
  const allocate = (kind, prefix) => {
    const sequence = next(kind, prefix);
    tables.job_number_sequences ||= [];
    let counter = tables.job_number_sequences.find(item => item.kind === kind && item.prefix === prefix && item.year === year);
    if (!counter) { counter = { kind, prefix, year }; tables.job_number_sequences.push(counter); }
    counter.last_number = sequence;
    return formatProjectCode(prefix, sequence, year);
  };
  if (name === 'preview_project_code') return formatProjectCode(prefixFor(args.p_project_type), next('project', prefixFor(args.p_project_type)), year);
  if (name === 'preview_crm_opportunity_number') {
    const prefix = args.p_project_type ? `OP-${prefixFor(args.p_project_type)}` : 'OP';
    return formatProjectCode(prefix, next('opportunity', prefix), year);
  }
  if (name === 'save_project_type') {
    const nameValue = String(args.p_name || '').trim();
    const prefix = normalizeProjectPrefix(args.p_code_prefix);
    if (!nameValue || nameValue.length > 100 || !PROJECT_PREFIX_PATTERN.test(prefix)) return fail('Zkontrolujte název a prefix.');
    tables.project_types ||= [];
    if (!args.p_type_id && tables.project_types.some(item => item.name === nameValue)) return fail('Typ projektu již existuje.', '23505');
    let type = tables.project_types.find(item => item.id === args.p_type_id && item.name === nameValue);
    if (args.p_type_id && !type) return fail('Typ projektu nebyl nalezen.');
    if (!type) { type = { id: newId(), name: nameValue }; tables.project_types.push(type); }
    type.code_prefix = prefix;
    return structuredClone(type);
  }
  if (name === 'save_project_safe') {
    const payload = structuredClone(args.p_payload || {});
    if (!payload.name?.trim()) return fail('Název projektu je povinný.');
    const existing = tables.projects.find(row => row.id === args.p_project_id);
    if (args.p_project_id && !existing) return fail('Projekt nebyl nalezen.');
    const code = String(payload.code ?? existing?.code ?? '').trim();
    if (existing && !code) return fail('Kód existujícího projektu nelze vymazat.');
    if (code && tables.projects.some(row => row.id !== existing?.id && row.code?.trim().toLowerCase() === code.toLowerCase())) return fail('Kód projektu již existuje.', '23505');
    if (payload.price != null && Number(payload.price) < 0) return fail('Cena nesmí být záporná.');
    if (existing) {
      Object.assign(existing, payload, { code, status: args.p_next_status || existing.status });
      return structuredClone(existing);
    }
    const row = { id: newId(), status: 'nabidka', price: 0, budget_percentage: 30, overhead_percentage: 10, type: 'Ostatní', created_by_member_id: memberId, investor_id: null, client_id: null, created_at: new Date().toISOString(), ...payload, code: code || allocate('project', prefixFor(payload.type)) };
    tables.projects.push(row);
    return structuredClone(row);
  }
  if (name === 'create_crm_opportunity_simple') {
    const payload = structuredClone(args.p_payload || {});
    if (!payload.title?.trim()) return fail('Název obchodního případu je povinný.');
    if (Number(payload.value || 0) < 0 || Number(payload.probability ?? 10) < 0 || Number(payload.probability ?? 10) > 100) return fail('Neplatná hodnota nebo pravděpodobnost.');
    if (payload.stage === 'lost' && !payload.lost_reason?.trim()) return fail('Doplňte důvod prohry.');
    const row = { id: newId(), stage: 'lead', status: 'open', priority: 'medium', value: 0, probability: 10, subject_id: null, deleted_at: null, archived_at: null, cancelled_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload, owner_member_id: memberId, number: allocate('opportunity', payload.project_type ? `OP-${prefixFor(payload.project_type)}` : 'OP') };
    tables.crm_opportunities.push(row);
    return structuredClone(row);
  }
  if (name === 'update_entity_planning_estimate') {
    const table = args.p_entity_type === 'project' ? tables.projects : tables.realizations;
    const row = table.find(item => item.id === args.p_entity_id);
    if (!row) return fail('Zakázka nebyla nalezena.');
    Object.assign(row, { complexity_level: args.p_complexity_level, estimated_work_days: args.p_estimated_work_days });
    return structuredClone(row);
  }
  if (name === 'save_project_workspace_preference') {
    tables.project_workspace_preferences ||= [];
    let row = tables.project_workspace_preferences.find(item => item.project_id === args.p_project_id);
    if (!row) { row = { project_id: args.p_project_id }; tables.project_workspace_preferences.push(row); }
    Object.assign(row, { create_folder: args.p_create_folder, folder_name: args.p_folder_name });
    return structuredClone(row);
  }
}
