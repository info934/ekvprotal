import { previewDate } from './previewState.js';

export const uuid = index => `26090500-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const ADMIN_ID = uuid(1);
export const MEMBER_ID = uuid(2);
export const AUTH_ADMIN_ID = uuid(101);
export const AUTH_MEMBER_ID = uuid(102);
const timestamp = offset => `${previewDate(offset)}T08:30:00Z`;

export function createFixtures() {
  const members = [
    { id: ADMIN_ID, auth_user_id: AUTH_ADMIN_ID, name: 'Jan Novák', email: 'jan.novak@example.invalid', user_role: 'admin', job_title: 'Vedoucí projektů' },
    { id: MEMBER_ID, auth_user_id: AUTH_MEMBER_ID, name: 'Petr Svoboda', email: 'petr.svoboda@example.invalid', user_role: 'user', job_title: 'Projektant elektro' },
    { id: uuid(3), auth_user_id: uuid(103), name: 'Anna Dvořáková', email: 'anna.dvorakova@example.invalid', user_role: 'user', job_title: 'Koordinátorka zakázek' },
  ].map(member => ({ ...member, attendance_enabled: true, hourly_rate: 450, phone: '+420 000 000 000', notification_preferences: {}, created_at: timestamp(-90), status: 'active' }));
  const subjects = [
    { id: uuid(201), name: 'Novotní · soukromý investor', ico: '00000001', type: 'customer', city: 'Brno', address: 'Ukázková 24', email: 'investor@example.invalid', phone: '+420 000 000 000' },
    { id: uuid(202), name: 'Morava Development · ukázka', ico: '00000002', type: 'customer', city: 'Olomouc', address: 'Projektová 8', email: 'morava@example.invalid' },
    { id: uuid(203), name: 'Obec Javorová · ukázka', ico: '00000003', type: 'customer', city: 'Javorová', address: 'Náměstí 1', email: 'obec@example.invalid' },
  ];
  const projects = [
    { id: uuid(301), code: 'PR-26-024', name: 'Rodinný dům · projektová dokumentace', status: 'active', price: 185000, start_date: previewDate(-28), completion_date: previewDate(12), investor_id: subjects[0].id, investor: subjects[0], brief: 'Dokumentace elektroinstalace rodinného domu. Koordinace silnoproudu, slaboproudu a ochrany před bleskem. Aktuálně dokončujeme podklady pro investora.' },
    { id: uuid(302), code: 'PR-26-021', name: 'Bytový dům Javorová', status: 'active', price: 640000, start_date: previewDate(-45), completion_date: previewDate(5), investor_id: subjects[1].id, investor: subjects[1], brief: 'Projekt elektro pro 24 bytových jednotek a společné prostory.' },
    { id: uuid(303), code: 'PR-26-019', name: 'Modernizace základní školy', status: 'nabidka', price: 320000, start_date: previewDate(-8), completion_date: previewDate(30), investor_id: subjects[2].id, investor: subjects[2], brief: 'Příprava nabídky a soupisu potřebných podkladů.' },
    { id: uuid(304), code: 'PR-26-016', name: 'Administrativní budova · osvětlení', status: 'delivered', price: 275000, start_date: previewDate(-60), completion_date: previewDate(-4), investor_id: subjects[1].id, investor: subjects[1], brief: 'Dokumentace předána investorovi.' },
  ].map((project, index) => ({ ...project, created_at: timestamp(-40 + index * 4), updated_at: timestamp(-1), budget_percentage: 65, overhead_percentage: 15, team_members: [ADMIN_ID, MEMBER_ID], project_type: 'DPS', project_stage: 'DPS', address: project.investor.address, city: project.investor.city, total_budget: project.price * .65, member_rewards: project.price * .35, total_paid: 15000, manager_id: ADMIN_ID, manager: members[0], subject: project.investor }));
  const realizations = [
    { id: uuid(401), name: 'Bytový dům Javorová · elektroinstalace', code: 'RE-26-012', status: 'Probíhá', project_id: projects[1].id, contract_amount: 1450000, contract_price: 1450000, start_date: previewDate(-14), planned_end_date: previewDate(25), actual_end_date: null, investor_id: subjects[1].id, investor: subjects[1], team_members: [ADMIN_ID, MEMBER_ID], lead_id: ADMIN_ID, lead: members[0] },
    { id: uuid(402), name: 'Obecní úřad · datové rozvody', code: 'RE-26-009', status: 'Připravuje se', project_id: projects[2].id, contract_amount: 380000, contract_price: 380000, start_date: previewDate(4), planned_end_date: previewDate(35), actual_end_date: null, investor_id: subjects[2].id, investor: subjects[2], team_members: [MEMBER_ID, uuid(3)], lead_id: MEMBER_ID, lead: members[1] },
  ].map(item => ({ ...item, linked_project_id: item.project_id, created_at: timestamp(-18), updated_at: timestamp(-2), location: item.investor.city, location_address: item.investor.address, lead_person: item.lead, profit_margin_percent: 15, overhead_percent: 10, total_budget: item.contract_amount * .75, price: item.contract_amount, description: 'Ukázková realizační zakázka pro ověření rozhraní.' }));
  const realizace_team_members = realizations.flatMap((realization, index) => realization.team_members.map((memberId, memberIndex) => ({
    id: uuid(3301 + index * 10 + memberIndex), realizace_id: realization.id, member_id: memberId,
    responsibility: memberIndex ? 'Montáž a kontrola elektroinstalace' : 'Koordinace a vedení realizace',
    is_hourly: true, valid_from: realization.start_date, valid_to: null, ended_at: null, ended_reason: null,
    hourly_funding_mode: 'direct_project', hourly_sponsor_member_id: null, hourly_sponsor_percent: 0,
  })));
  const taskNames = ['Doplnit schéma rozvaděče', 'Odeslat podklady investorovi', 'Koordinace tras s projektantem VZT', 'Kontrola výkazu výměr', 'Zpracovat světelný výpočet', 'Připravit nabídku na další etapu'];
  const project_tasks = taskNames.map((name, index) => ({
    id: uuid(501 + index), name, description: 'Ukázkový pracovní úkol. Změny v náhledu zůstávají pouze v paměti prohlížeče.',
    project_id: projects[index % projects.length].id, member_id: index === 4 ? uuid(3) : (index % 2 ? MEMBER_ID : ADMIN_ID),
    status: ['V řešení', 'Nové', 'V řešení', 'Hotovo', 'Nové', 'Nové'][index],
    start_date: previewDate(-5), end_date: previewDate([-2, 0, 2, -1, 4, 7][index]), priority: index === 0 ? 'high' : 'normal',
    created_at: timestamp(-6), estimated_hours: 8, progress: index === 3 ? 100 : index === 0 ? 65 : 0,
  }));
  project_tasks.push({ id: uuid(507), project_id: projects[0].id, name: 'Potvrdit termín koordinační schůzky', description: 'Termín bude upřesněn s investorem.', member_id: MEMBER_ID, status: 'Nové', start_date: null, end_date: null, priority: 'normal', created_at: timestamp(-1), estimated_hours: 1, progress: 0 });
  const project_members = projects.flatMap(project => members.slice(0, 2).map((member, index) => ({
    id: uuid(600 + Number(project.id.slice(-3)) * 3 + index), project_id: project.id, member_id: member.id,
    role_id: uuid(801 + index), members: member, member, roles: { name: index ? 'Projektant' : 'Vedoucí projektu' },
    member_name: member.name, name: member.name, reward_type: 'fixed', reward_amount: 30000, reward_percentage: 0, is_hourly: true,
  })));
  const attendance = [ADMIN_ID, MEMBER_ID].flatMap((memberId, memberIndex) => Array.from({ length: 4 }, (_, index) => ({
    id: uuid(900 + memberIndex * 10 + index), member_id: memberId, project_id: projects[index % 2].id,
    realization_id: null, date: previewDate(-index), hours: [7.5, 8, 6, 8][index], description: ['Dokumentace elektroinstalace', 'Koordinace profesí', 'Kontrola výkresů', 'Práce na výkazu výměr'][index],
    start_time: '08:00', end_time: index === 2 ? '14:00' : '16:00', work_type: 'project', status: 'draft', created_at: timestamp(-index),
  })));
  const payouts = [
    { id: uuid(1001), member_id: MEMBER_ID, amount: 28500, status: 'pending', request_date: timestamp(-2), description: 'Projektová dokumentace · srpen', invoice_url: null },
    { id: uuid(1002), member_id: ADMIN_ID, amount: 25000, status: 'approved', approved_without_invoice: true, request_date: timestamp(-4), approved_at: timestamp(-2), description: 'Koordinace projekce · srpen', invoice_url: null },
    { id: uuid(1003), member_id: MEMBER_ID, amount: 24000, status: 'paid', request_date: timestamp(-35), paid_at: timestamp(-25), description: 'Projektová dokumentace · červenec', invoice_url: null },
  ].map(payout => ({ ...payout, total_amount: payout.amount, created_at: payout.request_date, updated_at: payout.request_date, payout_type: 'fixed', approved_by: ADMIN_ID }));
  const payout_items = payouts.map((payout, index) => ({ id: uuid(1101 + index), payout_id: payout.id, project_id: projects[index === 0 ? 0 : 1].id, member_id: payout.member_id, amount: payout.amount, description: payout.description }));
  const documents = [
    { id: uuid(1201), name: 'Půdorys 1. NP · elektroinstalace.pdf', project_id: projects[0].id, file_type: 'application/pdf', type: 'project', size: 1285000, created_at: timestamp(-1) },
    { id: uuid(1202), name: 'Koordinační zápis · Javorová.pdf', project_id: projects[1].id, file_type: 'application/pdf', type: 'project', size: 468000, created_at: timestamp(-2) },
  ].map(item => ({ ...item, file_name: item.name, file_url: null, storage_path: null, uploaded_by: ADMIN_ID }));
  const crm_opportunities = [
    { id: uuid(1301), title: 'Rekonstrukce školy · elektro', number: 'OP-26-018', status: 'open', stage: 'proposal', estimated_value: 320000, expected_value: 320000, probability: 70, expected_close_date: previewDate(10), subject_id: subjects[2].id, assigned_to: ADMIN_ID, created_at: timestamp(-7) },
    { id: uuid(1302), title: 'Rodinný dům · realizace', number: 'OP-26-020', status: 'open', stage: 'qualification', estimated_value: 450000, expected_value: 450000, probability: 40, expected_close_date: previewDate(25), subject_id: subjects[0].id, assigned_to: MEMBER_ID, created_at: timestamp(-3) },
  ];
  const crm_commercial_documents = [{ id: uuid(1401), type: 'offer', title: 'Elektroinstalace základní školy', number: 'NAB-26-018', status: 'draft', subject_id: subjects[2].id, opportunity_id: crm_opportunities[0].id, total_without_vat: 320000, total_with_vat: 387200, created_at: timestamp(-2), valid_until: previewDate(14), issue_date: previewDate(-2), items: [] }];
  const planning_plans = projects.slice(0, 2).map((project, index) => ({ id: uuid(1501 + index), plan_id: uuid(1501 + index), entity_type: 'project', entity_id: project.id, name: project.name, entity_name: project.name, entity_code: project.code }));
  const planning_items = project_tasks.slice(0, 4).map((task, index) => ({ ...task, legacy_project_task_id: task.id, id: uuid(1601 + index), plan_id: planning_plans[index % 2].id, item_type: 'task', start_at: `${task.start_date}T08:00:00`, end_at: `${task.end_date}T16:00:00`, status: task.status === 'Hotovo' ? 'done' : 'in_progress', sort_order: index, calendar_sync_enabled: false, calendar_link: null }));
  const tables = {
    members, subjects, projects, realizations, realizace_team_members, project_tasks, project_members, attendance, payouts, payout_items, documents,
    crm_opportunities, crm_commercial_documents, planning_plans, planning_items,
    planning_assignments: planning_items.map((item, index) => ({ id: uuid(1701 + index), item_id: item.id, member_id: item.member_id, allocation_percentage: 100 })),
    notifications: [{ id: uuid(1801), user_id: AUTH_ADMIN_ID, type: 'payout', title: 'Žádost čeká na schválení', message: 'Petr Svoboda odeslal žádost o výplatu.', is_read: false, created_at: timestamp(-1) }],
    attendance_submissions: [{ id: uuid(1901), member_id: ADMIN_ID, month_date: `${previewDate(-8).slice(0, 7)}-01`, total_hours: 12, status: 'submitted', submitted_at: timestamp(-3), created_at: timestamp(-3) }],
    hourly_payout_requests: [{ id: uuid(2001), member_id: MEMBER_ID, project_id: projects[0].id, month_date: '2026-07-01', payout_year: 2026, payout_month: 7, total_hours: 24, hours: 24, hourly_rate: 450, amount: 10800, total_amount: 10800, status: 'pending', created_at: timestamp(-1), request_date: timestamp(-1), invoice_url: null }],
    project_statuses: ['nabidka', 'active', 'ready_for_delivery', 'delivered', 'closed'].map((name, index) => ({ id: uuid(2101 + index), name })),
    task_statuses: ['Nové', 'V řešení', 'Hotovo', 'Zrušeno'].map((name, index) => ({ id: uuid(2201 + index), name })),
    roles: [{ id: uuid(801), name: 'Vedoucí projektu' }, { id: uuid(802), name: 'Projektant' }],
    user_roles: [{ role_name: 'admin' }, { role_name: 'user' }],
    user_account_status: [{ auth_user_id: AUTH_ADMIN_ID, status: 'active' }, { auth_user_id: AUTH_MEMBER_ID, status: 'active' }],
    engineering_activities: [{ id: uuid(2301), project_id: projects[0].id, subject: 'Vyjádření správce sítě', status: 'in_progress', end_date: previewDate(5), created_at: timestamp(-8) }],
    commercial_item_catalog: [{ id: uuid(2401), name: 'Projektová dokumentace elektro', code: 'PROJ-01', unit: 'soubor', sale_price: 185000, purchase_price: 110000, is_active: true }],
    employee_profiles: members.map(member => ({ member_id: member.id, employment_status: 'active', note: '', created_by: ADMIN_ID, created_at: timestamp(-90), updated_by: ADMIN_ID, updated_at: timestamp(-5) })),
    employee_asset_assignments: [
      { id: uuid(2501), member_id: MEMBER_ID, asset_type: 'vehicle', label: 'Škoda Octavia · služební vůz', identifier: 'DEMO-01', assigned_on: previewDate(-60), due_on: null },
      { id: uuid(2502), member_id: MEMBER_ID, asset_type: 'key', label: 'Klíče od kanceláře a skladu', identifier: 'K-024', assigned_on: previewDate(-90), due_on: null },
      { id: uuid(2503), member_id: MEMBER_ID, asset_type: 'device', label: 'Notebook pro projektování', identifier: 'NTB-026', assigned_on: previewDate(-90), due_on: null },
      { id: uuid(2504), member_id: MEMBER_ID, asset_type: 'license', label: 'CAD · roční licence', identifier: 'LIC-026', assigned_on: previewDate(-330), due_on: previewDate(35) },
      { id: uuid(2505), member_id: ADMIN_ID, asset_type: 'device', label: 'Pracovní telefon', identifier: 'TEL-001', assigned_on: previewDate(-90), due_on: null },
    ].map(row => ({ ...row, status: 'issued', returned_on: null, note: 'Ukázková evidence předání.', created_at: timestamp(-60), updated_at: timestamp(-5), created_by: ADMIN_ID, updated_by: ADMIN_ID })),
    employee_records: [
      { id: uuid(2601), member_id: MEMBER_ID, title: 'Pracovní smlouva', kind: 'contract', status: 'verified', valid_from: previewDate(-90), valid_until: null },
      { id: uuid(2602), member_id: MEMBER_ID, title: 'Odborná způsobilost · kontrola platnosti', kind: 'verification', status: 'verified', valid_from: previewDate(-350), valid_until: previewDate(15) },
      { id: uuid(2603), member_id: MEMBER_ID, title: 'Školení bezpečnosti práce', kind: 'training', status: 'pending', valid_from: null, valid_until: null },
      { id: uuid(2604), member_id: ADMIN_ID, title: 'Pracovní smlouva', kind: 'contract', status: 'verified', valid_from: previewDate(-365), valid_until: null },
    ].map(row => ({ ...row, reference_url: null, note: '', verified_by: row.status === 'verified' ? ADMIN_ID : null, verified_at: row.status === 'verified' ? timestamp(-10) : null, created_at: timestamp(-60), updated_at: timestamp(-10) })),
    employee_requests: [
      { id: uuid(2701), member_id: MEMBER_ID, request_type: 'training', title: 'Školení projektování osvětlení', description: 'Kurz práce se světelnými výpočty pro připravované zakázky.', estimated_cost: 4800, requested_for: previewDate(21), status: 'pending' },
      { id: uuid(2702), member_id: MEMBER_ID, request_type: 'equipment', title: 'Druhý monitor pro projektování', description: 'Monitor pro souběžnou práci s výkresy a výkazem výměr.', estimated_cost: 6500, requested_for: previewDate(14), status: 'approved' },
      { id: uuid(2703), member_id: uuid(3), request_type: 'license', title: 'Licence pro koordinaci dokumentů', description: 'Roční licence pro společné připomínkování podkladů.', estimated_cost: 3200, requested_for: previewDate(10), status: 'pending' },
    ].map(row => ({ ...row, decision_note: row.status === 'approved' ? 'Schváleno pro pracoviště projektanta.' : null, decided_by: row.status === 'approved' ? ADMIN_ID : null, decided_at: row.status === 'approved' ? timestamp(-1) : null, fulfilled_by: null, fulfilled_at: null, created_at: timestamp(-3), updated_at: timestamp(-1) })),
    employee_request_events: [
      { id: uuid(2801), request_id: uuid(2701), member_id: MEMBER_ID, actor_member_id: MEMBER_ID, from_status: null, to_status: 'pending', note: null, created_at: timestamp(-3) },
      { id: uuid(2802), request_id: uuid(2702), member_id: MEMBER_ID, actor_member_id: MEMBER_ID, from_status: null, to_status: 'pending', note: null, created_at: timestamp(-3) },
      { id: uuid(2803), request_id: uuid(2702), member_id: MEMBER_ID, actor_member_id: ADMIN_ID, from_status: 'pending', to_status: 'approved', note: 'Schváleno pro pracoviště projektanta.', created_at: timestamp(-1) },
      { id: uuid(2804), request_id: uuid(2703), member_id: uuid(3), actor_member_id: uuid(3), from_status: null, to_status: 'pending', note: null, created_at: timestamp(-3) },
    ].map(row => ({ ...row, actor_name: members.find(member => member.id === row.actor_member_id)?.name || 'Uživatel' })),
    project_costs: projects.map((project, index) => ({ id: uuid(2901 + index), project_id: project.id, member_id: null, description: 'Podklady a měření · ukázkový náklad', amount: 15000, date: previewDate(-5), created_at: timestamp(-5) })),
    realizace_costs: realizations.map((realization, index) => ({ id: uuid(3001 + index), realizace_id: realization.id, description: 'Materiál a montáž · ukázkový náklad', amount: realization.contract_amount * .55, date: previewDate(-3), created_at: timestamp(-3) })),
    portal_settings: [], settings: [], role_permissions: [],
  };
  tables.attendance_submissions.push(
    { id: uuid(1902), member_id: MEMBER_ID, month_date: '2026-08-01', total_hours: 16, status: 'approved', approved_at: timestamp(-3) },
    { id: uuid(1903), member_id: MEMBER_ID, month_date: '2026-07-01', total_hours: 24, status: 'approved', approved_at: timestamp(-30) },
  );
  const historicRows = [
    { member_id: MEMBER_ID, date: '2026-08-27', hours: 8, submission_id: uuid(1902) },
    { member_id: MEMBER_ID, date: '2026-08-28', hours: 8, submission_id: uuid(1902) },
    { member_id: ADMIN_ID, date: '2026-08-28', hours: 6, submission_id: uuid(1901) },
    { member_id: ADMIN_ID, date: '2026-08-29', hours: 6, submission_id: uuid(1901) },
    ...['2026-07-27','2026-07-28','2026-07-29'].map(date => ({ member_id: MEMBER_ID, date, hours: 8, submission_id: uuid(1903) })),
  ].map((row, index) => ({ id: uuid(3100 + index), ...row, project_id: projects[0].id, realization_id: null, description: 'Dokumentace a koordinace · ukázková docházka', created_at: `${row.date}T08:00:00Z` }));
  tables.attendance.push(...historicRows);
  tables.labor_cost_ledger = historicRows.filter(row => row.member_id === MEMBER_ID).map((row, index) => ({
    id: uuid(3200 + index), attendance_id: row.id, attendance_submission_id: row.submission_id, member_id: row.member_id, project_id: row.project_id, realization_id: null,
    work_date: row.date, posting_month: `${row.date.slice(0,7)}-01`, hours: row.hours, hourly_rate: 450, pay_amount: row.hours * 450,
    cost_rate: 450, employer_cost: row.hours * 450, currency: 'CZK', funding_mode: 'project_budget', status: 'accrued',
    hourly_payout_request_id: row.date.startsWith('2026-07') ? uuid(2001) : null,
  }));
  tables.hourly_payout_requests[0].attendance_snapshot = tables.labor_cost_ledger.filter(row => row.hourly_payout_request_id === uuid(2001)).map(row => ({ ledger_id: row.id, attendance_id: row.attendance_id, date: row.work_date, hours: row.hours, hourly_rate: row.hourly_rate, pay_amount: row.pay_amount, currency: row.currency, project_id: row.project_id, realization_id: row.realization_id, funding_mode: row.funding_mode }));
  return tables;
}
