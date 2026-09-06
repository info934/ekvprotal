import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const config = read('supabase/config.toml');
const authContext = read('src/contexts/SupabaseAuthContext.jsx');
const orderPage = read('src/components/OrderPage.jsx');
const subcontractorOrderPage = read('src/components/SubcontractorOrderPage.jsx');
const hardeningMigration = read('supabase/migrations/20260721223000_security_permissions_rls_hardening.sql');
const documentStorageFunction = read('supabase/functions/document-storage/index.ts');
const documentStorageMigration = read('supabase/migrations/20260721220000_secure_document_storage_authority.sql');
const hourlyInvoiceMigration = read('supabase/migrations/20260721220500_hourly_payout_invoice_storage_metadata.sql');
const taskInvoiceMigration = read('supabase/migrations/20260721220700_task_payout_invoice_storage_metadata.sql');
const crmIntegrityMigration = read('supabase/migrations/20260721221500_crm_supplier_and_document_integrity.sql');
const planningWriteMigration = read('supabase/migrations/20260721222000_atomic_planning_writes.sql');
const payoutNotificationFunction = read('supabase/functions/send-payout-notification/index.ts');
const scheduledReportsFunction = read('supabase/functions/send-scheduled-reports/index.ts');
const crmCommercialMigration = read('supabase/migrations/20260906100000_crm_commercial_workflow_v2.sql');
const crmCommercialSendFunction = read('supabase/functions/send-crm-commercial-document/index.ts');
const crmCommercialResponseFunction = read('supabase/functions/respond-crm-commercial-offer/index.ts');
const crmCommercialReminderFunction = read('supabase/functions/send-crm-commercial-reminders/index.ts');
const crmActivityMigration = read('supabase/migrations/20260906110000_crm_sales_activity_tracking.sql');
const crmActivityCalendarFunction = read('supabase/functions/crm-activity-calendar/index.ts');
const raynetImportMigration = read('supabase/migrations/20260906120000_crm_raynet_import_staging.sql');
const raynetImportFunction = read('supabase/functions/raynet-crm-import/index.ts');
const crmParticipantAuditMigration = read('supabase/migrations/20260906130000_crm_opportunity_participants_audit.sql');

assert(/enable_signup\s*=\s*false/.test(config), 'Public signup must remain disabled.');
for (const functionName of [
  'send-message-to-member',
  'send-email',
  'send-payout-email',
  'send-admin-payout-notification',
  'send-payout-notification',
]) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(
    new RegExp(`\\[functions\\.${escaped}\\]\\s+verify_jwt\\s*=\\s*true`, 'm').test(config),
    `${functionName} must require a JWT.`,
  );
}

assert(!orderPage.includes(".from('project_orders')"), 'Public project orders must use token RPCs.');
assert(!subcontractorOrderPage.includes(".from('subcontractor_orders')"), 'Public subcontractor orders must use token RPCs.');
assert(!authContext.includes('finalPermissions = { ...basicPermissions'), 'Permission failures must not use fail-open defaults.');
assert(hardeningMigration.includes('revoke all on table public.project_orders from anon'), 'Anonymous project order table access must be revoked.');
assert(hardeningMigration.includes("return null; end if;"), 'Unauthenticated role lookup must fail closed.');
assert(documentStorageFunction.includes('body.accessEntityType'), 'External storage actions must validate their concrete access entity.');
assert(documentStorageFunction.includes("action === 'deleteFile'"), 'External storage deletion must remain server-authorized.');
assert(documentStorageFunction.includes(".from('document_storage_files')"), 'External file access must use the ownership registry.');
assert(documentStorageMigration.includes("where id in ('project-files', 'invoices')"), 'Financial storage buckets must remain private.');
assert(documentStorageMigration.includes('document_storage_files'), 'External storage ownership registry migration is required.');
assert(hourlyInvoiceMigration.includes('upload_hourly_payout_invoice_v2'), 'Hourly payout invoice metadata must be persisted atomically.');
assert(taskInvoiceMigration.includes('upload_payout_invoice_v2'), 'Task payout invoice metadata must be persisted atomically.');
assert(crmIntegrityMigration.includes('save_crm_commercial_document_draft'), 'CRM document header and items must be saved atomically.');
assert(planningWriteMigration.includes('save_planning_item_with_resources'), 'Planning items and resources must be saved atomically.');
assert(payoutNotificationFunction.includes('{ adminOnly: true }'), 'Legacy payout email diagnostics must remain admin-only.');
assert(scheduledReportsFunction.includes("req.headers.get('x-cron-secret')"), 'Scheduled reports must require the cron secret.');
assert(/\[functions\.send-crm-commercial-document\]\s+verify_jwt\s*=\s*true/m.test(config), 'CRM commercial sending must require a JWT.');
assert(crmCommercialSendFunction.includes("authorizeFunctionRequest(req, { module: 'crm', level: 'edit' })"), 'CRM commercial sending must enforce CRM edit permission.');
assert(crmCommercialSendFunction.includes('customRecipientConfirmed'), 'CRM commercial sending must confirm alternate recipients.');
assert(crmCommercialSendFunction.includes("pdfBytes.byteLength > 10 * 1024 * 1024"), 'CRM commercial PDFs must enforce an upload size limit.');
assert(crmCommercialMigration.includes("'crm-commercial-documents', 'crm-commercial-documents', false"), 'CRM commercial PDFs must use private storage.');
assert(crmCommercialMigration.includes("if auth.uid() is null then raise exception 'Authentication required'"), 'CRM item replacement wrappers must require authentication.');
assert(crmCommercialMigration.includes('response_token_hash'), 'CRM offer response links must store token hashes only.');
assert(!crmCommercialResponseFunction.includes('response_token: rawToken'), 'CRM offer response endpoint must not persist raw response tokens.');
assert(crmCommercialReminderFunction.includes("req.headers.get('x-cron-secret')"), 'CRM reminder endpoint must require the cron secret.');
assert(/\[functions\.crm-activity-calendar\]\s+verify_jwt\s*=\s*true/m.test(config), 'CRM activity calendar must require a JWT.');
assert(crmActivityCalendarFunction.includes("authorizeFunctionRequest(req, { module: 'crm', level: 'edit' })"), 'CRM activity calendar must enforce CRM edit permission.');
assert(!crmActivityCalendarFunction.includes('activity.meeting_minutes'), 'Private CRM meeting minutes must not be copied into external invitations.');
assert(crmActivityMigration.includes("and p.can_admin"), 'Team sales performance and goal administration must require CRM admin permission.');
assert(crmActivityMigration.includes('alter table public.crm_activity_events enable row level security'), 'CRM activity audit events must use RLS.');
assert(/\[functions\.raynet-crm-import\]\s+verify_jwt\s*=\s*true/m.test(config), 'Raynet CRM import must require a JWT.');
assert(raynetImportFunction.includes("authorizeFunctionRequest(req, { module: 'crm', level: 'admin' })"), 'Raynet CRM import must require CRM administrator permission.');
assert(!/api_key\s+text|password\s+text/i.test(raynetImportMigration), 'Raynet credentials must not be persisted in import tables.');
assert(raynetImportMigration.includes('alter table public.crm_import_rows enable row level security'), 'Raynet staging rows must use RLS.');
assert(raynetImportMigration.includes('pg_advisory_xact_lock'), 'Raynet import apply must be serialized per batch.');
assert(raynetImportMigration.includes('apply_raynet_crm_import'), 'Raynet import must use one server-side transactional apply function.');
assert(raynetImportFunction.includes('/businessCase/${encodeURIComponent(clean(item.id))}/'), 'Raynet import must read opportunity details so custom FVE fields are included.');
assert(raynetImportFunction.includes('businessCase[IN]'), 'Raynet activity import must filter activities to selected opportunities at the provider.');
assert(crmParticipantAuditMigration.includes('alter table public.crm_opportunity_participants enable row level security'), 'CRM opportunity participants must use RLS.');
assert(crmParticipantAuditMigration.includes('alter table public.crm_opportunity_events enable row level security'), 'CRM opportunity audit events must use RLS.');
assert(crmParticipantAuditMigration.includes('after insert or update or delete on public.crm_opportunities'), 'CRM opportunity changes must be audited by a database trigger.');

if (failures.length) {
  console.error('Security invariant checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Security permission and RLS invariants passed');
