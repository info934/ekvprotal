import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crmCommercialDocumentPath, crmOpportunityPath, findCrmRecordByRef } from '../src/lib/crmRoutes.js';
import { formatCrmNumber, formatCrmYearToken, normalizeCrmNumbering } from '../src/lib/crmNumbering.js';

const opportunity = { id: 'uuid-op', number: 'OP-26-003', title: 'Test opportunity' };
assert.equal(crmOpportunityPath(opportunity), '/crm/OP-26-003');
assert.equal(findCrmRecordByRef([opportunity], 'op-26-003'), opportunity);
assert.equal(findCrmRecordByRef([opportunity], 'uuid-op'), opportunity);

assert.equal(crmCommercialDocumentPath({ type: 'offer', number: 'NAB-26-010' }), '/crm/offers/NAB-26-010');
assert.equal(crmCommercialDocumentPath({ type: 'order', number: 'OBJ-26-010' }), '/crm/orders/OBJ-26-010');

const settings = normalizeCrmNumbering([
  { document_type: 'opportunity', prefix: ' op ', next_number: 7, padding: 4, year_format: 'YYYY' },
]);
assert.equal(formatCrmNumber(settings, 'opportunity', null, new Date('2026-07-12T10:00:00Z')), 'OP-2026-0007');
assert.equal(formatCrmYearToken('YY', new Date('2026-07-12T10:00:00Z')), '26');
assert.equal(formatCrmYearToken('NONE', new Date('2026-07-12T10:00:00Z')), '');

const financialGuardMigration = readFileSync(
  new URL('../supabase/migrations/20260712133000_financial_data_consistency_guards.sql', import.meta.url),
  'utf8'
);
for (const requiredGuard of [
  'crm_document_items_financial_values_check',
  'crm_opportunity_items_financial_values_check',
  'projects_financial_percentages_check',
  'realizations_financial_percentages_check',
  'payouts_paid_metadata_check',
  'validate_realization_percentage_share_total',
]) {
  assert.ok(financialGuardMigration.includes(requiredGuard), `missing financial database guard: ${requiredGuard}`);
}

const laborFundingMigration = readFileSync(
  new URL('../supabase/migrations/20260712173000_project_labor_funding_workflow.sql', import.meta.url),
  'utf8'
);
for (const requiredInvariant of [
  'labor_cost_ledger',
  'member_hourly_rate_history',
  'hourly_sponsor_member_id',
  'project_labor_financial_summary',
  'realization_labor_financial_summary',
  'member_labor_reward_deduction',
  'validate_labor_funding_assignment',
  'materialize_attendance_labor_costs',
]) {
  assert.ok(laborFundingMigration.includes(requiredInvariant), `missing labor funding invariant: ${requiredInvariant}`);
}

const financialPrivacyMigration = readFileSync(
  new URL('../supabase/migrations/20260712180000_admin_only_financial_privacy.sql', import.meta.url),
  'utf8'
);
for (const requiredPrivacyRule of [
  "get_user_role() = 'admin'",
  'project_financial_summary_admin_internal',
  'realization_financial_summary_admin_internal',
  'Labor ledger visible to admin or worker',
  'Project members read own or admin',
  'Realization profit shares read own or admin',
  'Enable read for own payouts or admins',
  'protect_member_financial_columns',
  'Realization costs admin access',
]) {
  assert.ok(financialPrivacyMigration.includes(requiredPrivacyRule), `missing financial privacy rule: ${requiredPrivacyRule}`);
}

const privateCompensationMigration = readFileSync(
  new URL('../supabase/migrations/20260712181000_private_member_compensation.sql', import.meta.url),
  'utf8'
);
for (const requiredCompensationRule of [
  'member_compensation_private',
  'get_member_compensation',
  'list_member_compensations_admin',
  'revoke select on table public.members from authenticated',
]) {
  assert.ok(privateCompensationMigration.includes(requiredCompensationRule), `missing private compensation rule: ${requiredCompensationRule}`);
}

const rolloutSafetyMigration = readFileSync(
  new URL('../supabase/migrations/20260712182000_financial_rollout_safety.sql', import.meta.url),
  'utf8'
);
for (const requiredSafetyRule of [
  'economic_project_cost',
  'prevent_paid_attendance_submission_reopen',
  'hourly_payout_request_created_from_labor_ledger',
  'replace_realization_profit_shares',
  'protect_labor_assignment_financial_fields',
  'Realization profit shares admin write',
]) {
  assert.ok(rolloutSafetyMigration.includes(requiredSafetyRule), `missing rollout safety rule: ${requiredSafetyRule}`);
}

const adminSummaryMigration = readFileSync(
  new URL('../supabase/migrations/20260712190000_admin_company_financial_summaries.sql', import.meta.url),
  'utf8'
);
for (const requiredAdminSummaryRule of [
  'get_company_financials',
  'get_overhead_summary',
  "get_user_role() <> 'admin'",
  'security definer',
]) {
  assert.ok(adminSummaryMigration.toLowerCase().includes(requiredAdminSummaryRule), `missing admin summary rule: ${requiredAdminSummaryRule}`);
}

console.log('Critical route and numbering checks passed');
