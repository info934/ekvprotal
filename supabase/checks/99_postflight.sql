-- EKV Portal 2.0: read-only catalog verification AFTER all five migrations.
-- Does not replace functional/RLS tests on staging or verification of Edge functions.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $check$
DECLARE v_name text; v_signature text; v_oid oid; v_row record;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Migration history is missing.';
  END IF;
  FOREACH v_name IN ARRAY ARRAY['20260905100000', '20260905110000', '20260905120000', '20260905130000', '20260905140000'] LOOP
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_name) THEN
      RAISE EXCEPTION 'Required migration is not recorded: %', v_name;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['employee_profiles', 'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events'] LOOP
    v_oid := to_regclass('public.' || v_name);
    IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_oid AND relrowsecurity) THEN
      RAISE EXCEPTION 'Missing employee table or disabled RLS: %', v_name;
    END IF;
    IF has_table_privilege('anon', v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', v_oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('service_role', v_oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR NOT has_table_privilege('authenticated', v_oid, 'SELECT')
       OR NOT has_table_privilege('service_role', v_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Unexpected direct table permissions: %', v_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_oid
      AND polname = 'employee_active_account_required' AND NOT polpermissive AND polcmd = '*') THEN
      RAISE EXCEPTION 'Missing restrictive active-account policy: %', v_name;
    END IF;
  END LOOP;

  v_oid := to_regclass('public.attendance_write_batches');
  IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_oid AND relrowsecurity) THEN
    RAISE EXCEPTION 'Missing attendance idempotency table or disabled RLS.';
  END IF;
  IF has_table_privilege('anon', v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('authenticated', v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role', v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Attendance idempotency table is directly accessible.';
  END IF;

  FOR v_row IN SELECT c.oid, n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relrowsecurity AND c.relkind IN ('r', 'p')
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
      AND NOT (n.nspname = 'public' AND c.relname IN (
        'user_account_status', 'attendance_write_batches', 'employee_profiles',
        'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events'
      ))
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_row.oid
      AND polname = 'active_account_required' AND NOT polpermissive AND polcmd = '*'
      AND (SELECT oid FROM pg_roles WHERE rolname = 'authenticated') = ANY(polroles)) THEN
      RAISE EXCEPTION 'Missing restrictive active-account policy on %.%', v_row.nspname, v_row.relname;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.replace_crm_opportunity_items_financial_v1(uuid,jsonb,boolean)',
    'public.lock_attendance_member_20260905(uuid)',
    'public.lock_labor_scopes_20260905(uuid[],uuid[])',
    'public.assert_hourly_snapshot_current_20260905(uuid)',
    'public.employee_reference_url_is_safe(text)',
    'public.employee_request_audit_transition()', 'public.employee_request_event_immutable()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Missing required internal helper: %', v_signature;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM (VALUES
    ('public.project_tasks', 'public.sync_project_task_to_planning()'),
    ('public.planning_items', 'public.sync_planning_item_to_project_task()'),
    ('public.attendance_submissions', 'public.prevent_paid_attendance_submission_reopen()'),
    ('public.attendance_submissions', 'public.materialize_attendance_labor_costs()'),
    ('public.hourly_payout_requests', 'public.sync_hourly_payout_labor_ledger()'),
    ('public.payouts', 'public.validate_project_reward_on_payout()'),
    ('public.payout_items', 'public.validate_project_reward_on_payout_item()'),
    ('public.employee_requests', 'public.employee_request_audit_transition()'),
    ('public.employee_request_events', 'public.employee_request_event_immutable()')
  ) AS required(table_name, signature) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_row.table_name)
      AND t.tgfoid = to_regprocedure(v_row.signature) AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')) THEN
      RAISE EXCEPTION 'Missing enabled trigger on % for %', v_row.table_name, v_row.signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_current_member_identity()',
    'public.replace_crm_opportunity_items(uuid,jsonb,boolean)',
    'public.save_crm_commercial_document_draft(uuid,jsonb,jsonb,boolean)',
    'public.create_crm_commercial_document_atomic(uuid,text,jsonb,text)',
    'public.relate_crm_commercial_document_atomic(uuid,uuid,text,text,jsonb)',
    'public.save_product_set_atomic(uuid,jsonb,jsonb)',
    'public.save_crm_opportunity_fields_atomic(uuid,jsonb,jsonb,jsonb)',
    'public.set_employee_profile(uuid,text,text)', 'public.save_employee_asset(uuid,jsonb,uuid)',
    'public.return_employee_asset(uuid,date,text)', 'public.save_employee_record(uuid,jsonb,uuid)',
    'public.create_employee_request(jsonb)', 'public.transition_employee_request(uuid,text,text)',
    'public.save_attendance_record(uuid,uuid,date,numeric,uuid,uuid,text)',
    'public.save_attendance_records(jsonb,uuid)', 'public.delete_attendance_record(uuid)',
    'public.submit_attendance_month(uuid,date)', 'public.approve_attendance_submission(uuid)',
    'public.reject_attendance_submission(uuid,text)', 'public.revert_attendance_submission(uuid)',
    'public.return_attendance_submission_for_edit(uuid,text)', 'public.withdraw_attendance_submission(uuid)',
    'public.delete_attendance_submission(uuid)',
    'public.create_hourly_payout_request(uuid,integer,integer,text,uuid)',
    'public.approve_hourly_payout_request(uuid,text,boolean)', 'public.mark_hourly_payout_paid(uuid)',
    'public.reject_payout(uuid,text)', 'public.reject_hourly_payout_request(uuid,text)',
    'public.cancel_hourly_payout_request(uuid,text)', 'public.get_hourly_payout_discrepancies()',
    'public.create_payout_request(uuid,date,text,jsonb)',
    'public.update_payout_request(uuid,uuid,date,text,jsonb)',
    'public.invoice_object_detached_20260905(text)'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing public RPC: %', v_signature; END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
      OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected public RPC permissions: %', v_signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
      RAISE EXCEPTION 'Expected SECURITY DEFINER RPC: %', v_signature;
    END IF;
  END LOOP;

  -- PUBLIC grants are included in effective anon/authenticated privilege checks.
  FOR v_row IN SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      strpos(p.proname, '_private_20260905') > 0 OR p.proname IN (
        'replace_crm_opportunity_items_financial_v1', 'recalculate_hourly_payout_request',
        'build_hourly_attendance_snapshot', 'lock_attendance_member_20260905',
        'lock_labor_scopes_20260905', 'assert_hourly_snapshot_current_20260905',
        'assert_attendance_month_editable', 'employee_reference_url_is_safe',
        'employee_request_audit_transition', 'employee_request_event_immutable'
      )
    ) LOOP
    IF has_function_privilege('authenticated', v_row.oid, 'EXECUTE')
      OR has_function_privilege('anon', v_row.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Private helper is exposed to API callers: %', v_row.signature;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.hourly_payout_requests', 'DELETE') THEN
    RAISE EXCEPTION 'Direct deletion of hourly payouts is still allowed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
    AND polname = 'Referenced payout invoices cannot be deleted' AND NOT polpermissive AND polcmd = 'd') THEN
    RAISE EXCEPTION 'Missing restrictive invoice deletion policy.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.task_statuses WHERE name = 'Zrušeno') THEN
    RAISE EXCEPTION 'Cancelled task status is missing.';
  END IF;
END;
$check$;

SELECT c.oid::regclass AS table_name, t.tgname, t.tgenabled, p.oid::regprocedure AS function_name
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal AND p.proname IN (
  'sync_project_task_to_planning', 'sync_planning_item_to_project_task',
  'prevent_paid_attendance_submission_reopen', 'materialize_attendance_labor_costs',
  'sync_hourly_payout_labor_ledger', 'validate_project_reward_on_payout',
  'validate_project_reward_on_payout_item', 'employee_request_audit_transition', 'employee_request_event_immutable'
)
ORDER BY table_name, t.tgname;

SELECT 'Catalog postflight completed. Also rerun 00_preflight.sql to verify renamed functions and old trigger bindings; verify Edge functions and staging behavior separately.' AS result;
ROLLBACK;
