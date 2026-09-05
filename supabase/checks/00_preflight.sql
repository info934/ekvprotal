-- EKV Portal 2.0: read-only checks BEFORE migration, using a database admin.
-- Does not apply migrations, repair history or invoke application RPCs.
-- Run the entire file. On any error stop; do not bypass the failing check.
-- Also compare ALL local/remote versions with: supabase migration list --linked
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $check$
DECLARE
  v_name text;
  v_signature text;
  v_private text;
  v_row record;
  v_applied boolean;
  v_gap boolean := false;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Migration history is missing. Reconcile the existing database before using this upgrade.';
  END IF;
  FOREACH v_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_name) THEN
      RAISE EXCEPTION 'Required Supabase role is missing: %', v_name;
    END IF;
  END LOOP;

  -- These five versions may be absent, fully applied, or an applied prefix.
  -- A gap means history is inconsistent with the required deployment order.
  FOREACH v_name IN ARRAY ARRAY['20260905100000', '20260905110000', '20260905120000', '20260905130000', '20260905140000'] LOOP
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
      INTO v_applied USING v_name;
    IF v_applied AND v_gap THEN
      RAISE EXCEPTION 'Out-of-order EKV 2.0 migration history at %. Reconcile history first.', v_name;
    END IF;
    v_gap := v_gap OR NOT v_applied;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY[
    'public.members', 'public.role_permissions', 'public.user_account_status',
    'public.crm_opportunities', 'public.crm_opportunity_items',
    'public.crm_commercial_documents', 'public.crm_commercial_document_items',
    'public.product_sets', 'public.product_set_items', 'public.task_statuses',
    'public.planning_plans', 'public.planning_items', 'public.project_tasks',
    'public.projects', 'public.realizations', 'public.project_members', 'public.realizace_team_members',
    'public.attendance', 'public.attendance_submissions', 'public.hourly_payout_requests',
    'public.labor_cost_ledger', 'public.member_hourly_rate_history',
    'public.payouts', 'public.payout_items', 'storage.objects'
  ] LOOP
    IF to_regclass(v_name) IS NULL THEN
      RAISE EXCEPTION 'Required existing table is missing: %', v_name;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'auth.uid()', 'auth.jwt()', 'pg_catalog.gen_random_uuid()',
    'public.get_member_id()', 'public.get_user_role()', 'public.get_permissions(text)',
    'public.get_current_member_identity()', 'public.can_edit_crm()',
    'public.allocate_crm_number(text)', 'public.replace_crm_document_items(uuid,jsonb)',
    'public.replace_crm_opportunity_items(uuid,jsonb,boolean)',
    'public.recalculate_hourly_payout_request(uuid)', 'public.build_hourly_attendance_snapshot(uuid,date)',
    'public.can_admin_module(text)', 'public.can_edit_module(text)',
    'public.log_workflow_audit(text,jsonb)', 'public.validate_payout_request_items(uuid,jsonb,uuid)',
    'public.assert_project_reward_allocation(uuid)', 'public.can_access_invoice_storage_object(text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required existing function is missing: %', v_signature;
    END IF;
  END LOOP;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
    INTO v_applied USING '20260905110000';
  IF (to_regprocedure('public.replace_crm_opportunity_items_financial_v1(uuid,jsonb,boolean)') IS NOT NULL) <> v_applied THEN
    RAISE EXCEPTION 'CRM function rename does not match migration history (20260905110000). Do not rerun or rename manually.';
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
    INTO v_applied USING '20260905140000';
  FOREACH v_signature IN ARRAY ARRAY[
    'public.save_attendance_record(uuid,uuid,date,numeric,uuid,uuid,text)',
    'public.delete_attendance_record(uuid)', 'public.submit_attendance_month(uuid,date)',
    'public.approve_attendance_submission(uuid)', 'public.reject_attendance_submission(uuid,text)',
    'public.revert_attendance_submission(uuid)', 'public.return_attendance_submission_for_edit(uuid,text)',
    'public.withdraw_attendance_submission(uuid)', 'public.delete_attendance_submission(uuid)',
    'public.create_hourly_payout_request(uuid,integer,integer,text,uuid)',
    'public.approve_hourly_payout_request(uuid,text,boolean)', 'public.mark_hourly_payout_paid(uuid)',
    'public.reject_payout(uuid,text)', 'public.reject_hourly_payout_request(uuid,text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required workflow function is missing: %', v_signature;
    END IF;
    v_private := replace(v_signature, '(', '_private_20260905(');
    IF (to_regprocedure(v_private) IS NOT NULL) <> v_applied THEN
      RAISE EXCEPTION 'Function rename does not match migration 20260905140000: %', v_private;
    END IF;
  END LOOP;
  IF (to_regclass('public.attendance_write_batches') IS NOT NULL) <> v_applied THEN
    RAISE EXCEPTION 'Attendance batch table does not match migration history.';
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)'
    INTO v_applied USING '20260905130000';
  FOREACH v_name IN ARRAY ARRAY['employee_profiles', 'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events'] LOOP
    IF (to_regclass('public.' || v_name) IS NOT NULL) <> v_applied THEN
      RAISE EXCEPTION 'Employee table does not match migration history: %', v_name;
    END IF;
  END LOOP;

  -- These migrations replace trigger functions but do not recreate old bindings.
  FOR v_row IN SELECT * FROM (VALUES
    ('public.project_tasks', 'public.sync_project_task_to_planning()'),
    ('public.planning_items', 'public.sync_planning_item_to_project_task()'),
    ('public.attendance_submissions', 'public.prevent_paid_attendance_submission_reopen()'),
    ('public.attendance_submissions', 'public.materialize_attendance_labor_costs()'),
    ('public.hourly_payout_requests', 'public.sync_hourly_payout_labor_ledger()'),
    ('public.payouts', 'public.validate_project_reward_on_payout()'),
    ('public.payout_items', 'public.validate_project_reward_on_payout_item()')
  ) AS required(table_name, signature) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_row.table_name)
        AND t.tgfoid = to_regprocedure(v_row.signature) AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
    ) THEN
      RAISE EXCEPTION 'Missing enabled trigger on % for %', v_row.table_name, v_row.signature;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM (VALUES
    ('members', 'auth_user_id'), ('members', 'email'), ('members', 'user_role'),
    ('user_account_status', 'auth_user_id'), ('user_account_status', 'status'),
    ('planning_items', 'legacy_project_task_id'),
    ('labor_cost_ledger', 'posting_month'), ('labor_cost_ledger', 'funding_mode'),
    ('labor_cost_ledger', 'project_cost_impact'), ('labor_cost_ledger', 'sponsor_reward_deduction'),
    ('payouts', 'invoice_storage_provider'), ('payouts', 'invoice_external_file_id'),
    ('hourly_payout_requests', 'invoice_storage_provider'), ('hourly_payout_requests', 'invoice_external_file_id')
  ) AS required(table_name, column_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || v_row.table_name)
      AND a.attname = v_row.column_name AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'Missing required column: %.%', v_row.table_name, v_row.column_name;
    END IF;
  END LOOP;
END;
$check$;

-- Review these results too: presence alone does not verify function body versions.
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

SELECT p.oid::regprocedure AS signature, pg_get_userbyid(p.proowner) AS owner,
       r.rolsuper, r.rolbypassrls, p.prosecdef AS security_definer, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
WHERE p.oid IN (to_regprocedure('public.get_member_id()'), to_regprocedure('public.get_user_role()'), to_regprocedure('public.get_permissions(text)'));

-- Required uniqueness: task_statuses(name), planning_items(legacy_project_task_id),
-- planning_plans(project_id) WHERE project_id IS NOT NULL, and the labor ledger
-- (attendance_id, attendance_submission_id, source_version). Review index predicates.
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('task_statuses', 'planning_plans', 'planning_items', 'labor_cost_ledger')
ORDER BY tablename, indexname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('members', 'user_account_status'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT 'Catalog preflight completed. Review results, full migration history and staging tests before deployment.' AS result;
ROLLBACK;
