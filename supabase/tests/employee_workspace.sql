-- Run ONLY against an isolated migrated Supabase test database as postgres.
-- psql <local-test-db-url> -v ON_ERROR_STOP=1 -f supabase/tests/employee_workspace.sql
-- Single-session transactional scenarios; true concurrent sessions need separate verification.
-- Staging concurrency acceptance (two separate authenticated admin connections):
-- hold transaction A open after a create with a stable p_asset.id / p_record.id;
-- start the identical create in B, which must wait; COMMIT A, then B must return
-- the same row/id and exactly one row must exist. Repeat with changed payload or
-- member_id in B: after A commits B must fail, leaving A's row unchanged. Repeat
-- with ROLLBACK A: B must create the single row. Use isolated fixtures only.
BEGIN;
DO $$
DECLARE v_admin uuid := gen_random_uuid(); v_owner uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_outsider uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('test.employee_admin', v_admin::text, true);
  PERFORM set_config('test.employee_owner', v_owner::text, true);
  PERFORM set_config('test.employee_other', v_other::text, true);
  PERFORM set_config('test.employee_outsider', v_outsider::text, true);
  INSERT INTO auth.users (id, email) VALUES (v_admin, v_admin::text || '@example.invalid'), (v_owner, v_owner::text || '@example.invalid'),
    (v_other, v_other::text || '@example.invalid'), (v_outsider, v_outsider::text || '@example.invalid');
  INSERT INTO public.members (id, auth_user_id, name, email, user_role) VALUES
    (v_admin, v_admin, 'Employee admin fixture', v_admin::text || '@example.invalid', 'admin'),
    (v_owner, v_owner, 'Employee owner fixture', v_owner::text || '@example.invalid', 'user'),
    (v_other, v_other, 'Employee other fixture', v_other::text || '@example.invalid', 'user'),
    (v_outsider, v_outsider, 'Non-employee fixture', v_outsider::text || '@example.invalid', 'user');
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_admin'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
  v_owner uuid := current_setting('test.employee_owner')::uuid;
  v_other uuid := current_setting('test.employee_other')::uuid;
  v_asset jsonb; v_record jsonb; v_replay jsonb; v_asset_payload jsonb; v_record_payload jsonb;
BEGIN
  PERFORM public.set_employee_profile(v_owner, 'active', 'Explicit enrollment');
  PERFORM public.set_employee_profile(current_setting('test.employee_other')::uuid, 'active');
  v_asset_payload := jsonb_build_object('id', gen_random_uuid(), 'asset_type', 'device', 'label', 'Test notebook', 'assigned_on', current_date);
  v_asset := public.save_employee_asset(v_owner, v_asset_payload);
  PERFORM set_config('test.employee_asset', v_asset ->> 'id', true);
  PERFORM set_config('test.employee_asset_payload', v_asset_payload::text, true);
  IF v_asset ->> 'id' IS DISTINCT FROM v_asset_payload ->> 'id' THEN RAISE EXCEPTION 'Create asset UUID was ignored'; END IF;
  v_replay := public.save_employee_asset(v_owner, v_asset_payload || jsonb_build_object('label', ' Test notebook ', 'identifier', ' ', 'note', ''));
  IF v_replay IS DISTINCT FROM v_asset THEN RAISE EXCEPTION 'Canonical asset replay changed or duplicated original row'; END IF;
  IF (SELECT count(*) FROM public.employee_asset_assignments WHERE member_id = v_owner) <> 1 THEN RAISE EXCEPTION 'Create asset replay duplicated evidence'; END IF;
  BEGIN
    PERFORM public.save_employee_asset(v_owner, v_asset_payload || jsonb_build_object('label', 'Different notebook'));
    RAISE EXCEPTION 'Different asset data reused an existing UUID' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_employee_asset(v_other, v_asset_payload);
    RAISE EXCEPTION 'Asset UUID reassigned to another employee' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF (SELECT to_jsonb(a) FROM public.employee_asset_assignments a WHERE id = (v_asset ->> 'id')::uuid) IS DISTINCT FROM v_asset THEN
    RAISE EXCEPTION 'Rejected asset replay altered original evidence';
  END IF;
  v_record_payload := jsonb_build_object('id', gen_random_uuid(), 'title', 'Test verification', 'kind', 'verification', 'status', 'verified', 'reference_url', 'https://example.invalid/record');
  v_record := public.save_employee_record(v_owner, v_record_payload);
  IF v_record ->> 'verified_by' IS DISTINCT FROM current_setting('test.employee_admin') THEN RAISE EXCEPTION 'Verification actor missing'; END IF;
  IF v_record ->> 'id' IS DISTINCT FROM v_record_payload ->> 'id' THEN RAISE EXCEPTION 'Create record UUID was ignored'; END IF;
  v_replay := public.save_employee_record(v_owner, v_record_payload || jsonb_build_object('title', ' Test verification ', 'note', ' '));
  IF v_replay IS DISTINCT FROM v_record THEN RAISE EXCEPTION 'Canonical record replay changed verification evidence or duplicated record'; END IF;
  IF (SELECT count(*) FROM public.employee_records WHERE member_id = v_owner) <> 1 THEN RAISE EXCEPTION 'Create record replay duplicated evidence'; END IF;
  BEGIN
    PERFORM public.save_employee_record(v_owner, v_record_payload || jsonb_build_object('title', 'Different verification'));
    RAISE EXCEPTION 'Different record data reused an existing UUID' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_employee_record(v_other, v_record_payload);
    RAISE EXCEPTION 'Record UUID reassigned to another employee' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF (SELECT to_jsonb(r) FROM public.employee_records r WHERE id = (v_record ->> 'id')::uuid) IS DISTINCT FROM v_record THEN
    RAISE EXCEPTION 'Rejected record replay altered original evidence';
  END IF;
  BEGIN
    PERFORM public.save_employee_record(v_owner, jsonb_build_object('title', 'Unsafe link', 'kind', 'contract', 'reference_url', 'javascript:alert(1)'));
    RAISE EXCEPTION 'Unsafe reference URL was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_id uuid := gen_random_uuid(); v_payload jsonb; v_request jsonb; v_replay jsonb;
BEGIN
  IF (SELECT count(*) FROM public.employee_profiles) <> 1 THEN RAISE EXCEPTION 'Owner can read another employee profile'; END IF;
  IF (SELECT count(*) FROM public.employee_asset_assignments) <> 1 THEN RAISE EXCEPTION 'Owner asset access broken'; END IF;
  IF (SELECT count(*) FROM public.employee_records) <> 1 THEN RAISE EXCEPTION 'Owner record access broken'; END IF;
  v_payload := jsonb_build_object('id', v_id, 'member_id', current_setting('test.employee_other'), 'request_type', 'training', 'title', 'Test training', 'description', 'Training request fixture', 'estimated_cost', 1500);
  v_request := public.create_employee_request(v_payload);
  v_replay := public.create_employee_request(v_payload);
  IF v_request ->> 'member_id' IS DISTINCT FROM current_setting('test.employee_owner') THEN RAISE EXCEPTION 'Request owner was spoofed'; END IF;
  IF v_replay ->> 'id' IS DISTINCT FROM v_request ->> 'id' THEN RAISE EXCEPTION 'Idempotent request replay duplicated request'; END IF;
  IF (SELECT count(*) FROM public.employee_request_events WHERE request_id = v_id) <> 1 THEN RAISE EXCEPTION 'Idempotent replay duplicated audit event'; END IF;
  PERFORM set_config('test.employee_request', v_id::text, true);
  BEGIN
    PERFORM public.set_employee_profile(current_setting('test.employee_owner')::uuid, 'inactive');
    RAISE EXCEPTION 'Owner changed employment status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.employee_asset_assignments SET label = 'tampered';
    RAISE EXCEPTION 'Owner directly changed an asset';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.transition_employee_request(v_id, 'approved');
    RAISE EXCEPTION 'Owner approved own request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.create_employee_request(jsonb_build_object('request_type', 'license', 'title', 'Invalid amount', 'description', 'NaN must fail', 'estimated_cost', 'NaN'));
    RAISE EXCEPTION 'NaN request amount accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_request := public.create_employee_request(jsonb_build_object('request_type', 'equipment', 'title', 'Cancel fixture', 'description', 'Can be cancelled'));
  PERFORM public.transition_employee_request((v_request ->> 'id')::uuid, 'cancelled', 'No longer required');
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_other'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employee_asset_assignments) OR EXISTS (SELECT 1 FROM public.employee_records)
    OR EXISTS (SELECT 1 FROM public.employee_requests) OR EXISTS (SELECT 1 FROM public.employee_request_events) THEN RAISE EXCEPTION 'Another employee can read private evidence'; END IF;
  BEGIN
    PERFORM public.transition_employee_request(current_setting('test.employee_request')::uuid, 'cancelled');
    RAISE EXCEPTION 'Other employee cancelled a foreign request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_outsider'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.create_employee_request(jsonb_build_object('request_type', 'license', 'title', 'Denied', 'description', 'Not enrolled'));
    RAISE EXCEPTION 'Non-employee created a request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_admin'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_request jsonb; v_id uuid := current_setting('test.employee_request')::uuid; v_returned_asset jsonb; v_replay jsonb;
BEGIN
  BEGIN
    PERFORM public.transition_employee_request(v_id, 'rejected', ' ');
    RAISE EXCEPTION 'Missing rejection reason accepted' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF (SELECT status FROM public.employee_requests WHERE id = v_id) <> 'pending' THEN RAISE EXCEPTION 'Failed rejection modified request'; END IF;
  PERFORM public.transition_employee_request(v_id, 'approved', 'Approved fixture');
  BEGIN
    PERFORM public.transition_employee_request(v_id, 'rejected', 'Stale decision');
    RAISE EXCEPTION 'Stale transition overwrote approval' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  v_request := public.transition_employee_request(v_id, 'fulfilled', 'Purchased fixture');
  IF v_request ->> 'decided_by' IS DISTINCT FROM current_setting('test.employee_admin') OR v_request ->> 'fulfilled_at' IS NULL THEN RAISE EXCEPTION 'Decision evidence missing'; END IF;
  IF (SELECT count(*) FROM public.employee_request_events WHERE request_id = v_id) <> 3 THEN RAISE EXCEPTION 'Transition audit incomplete'; END IF;
  BEGIN
    DELETE FROM public.employee_request_events WHERE request_id = v_id;
    RAISE EXCEPTION 'Authenticated admin deleted audit history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v_returned_asset := public.return_employee_asset(current_setting('test.employee_asset')::uuid);
  v_replay := public.save_employee_asset(current_setting('test.employee_owner')::uuid, current_setting('test.employee_asset_payload')::jsonb);
  IF v_replay IS DISTINCT FROM v_returned_asset OR v_replay ->> 'status' <> 'returned' THEN
    RAISE EXCEPTION 'Create replay reopened a returned asset or changed return evidence';
  END IF;
  PERFORM public.set_employee_profile(current_setting('test.employee_owner')::uuid, 'inactive');
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_owner'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employee_profiles) OR EXISTS (SELECT 1 FROM public.employee_requests) THEN RAISE EXCEPTION 'Inactive employee can still access workspace'; END IF;
END;
$$;

RESET ROLE;
INSERT INTO public.user_account_status (auth_user_id, status)
VALUES (current_setting('test.employee_admin')::uuid, 'disabled');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.employee_admin'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.set_employee_profile(current_setting('test.employee_owner')::uuid, 'active');
    RAISE EXCEPTION 'Disabled admin managed employee profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.create_employee_request(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'Anonymous request RPC grant'; END IF;
  IF has_table_privilege('authenticated', 'public.employee_requests', 'INSERT') THEN RAISE EXCEPTION 'Direct request write grant'; END IF;
  BEGIN
    UPDATE public.employee_request_events SET note = 'Owner-level tampering' WHERE request_id = current_setting('test.employee_request')::uuid;
    RAISE EXCEPTION 'Database owner bypassed immutable event trigger';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
ROLLBACK;
