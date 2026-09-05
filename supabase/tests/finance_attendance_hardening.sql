-- ISOLATED, fully migrated Supabase test database ONLY; execute as postgres.
-- psql "service=ekvportal_staging_test" -X -v ON_ERROR_STOP=1 -f supabase/tests/finance_attendance_hardening.sql
-- No provider calls. Fixtures and all mutations roll back. These single-session
-- tests do not prove concurrency; two-session acceptance scenarios are below.
BEGIN;
DO $$
DECLARE v_admin uuid := gen_random_uuid(); v_owner uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid(); v_project_other uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('test.fa_admin_auth', v_admin::text, true);
  PERFORM set_config('test.fa_owner_auth', v_owner::text, true);
  PERFORM set_config('test.fa_other_auth', v_other::text, true);
  PERFORM set_config('test.fa_project', v_project::text, true);
  PERFORM set_config('test.fa_project_other', v_project_other::text, true);
  INSERT INTO auth.users(id, email) VALUES
    (v_admin, v_admin::text || '@example.invalid'), (v_owner, v_owner::text || '@example.invalid'),
    (v_other, v_other::text || '@example.invalid');
  INSERT INTO public.members(id, auth_user_id, name, email, user_role, hourly_rate) VALUES
    (v_admin, v_admin, 'Finance test administrator', v_admin::text || '@example.invalid', 'admin', 100),
    (v_owner, v_owner, 'Finance test employee', v_owner::text || '@example.invalid', 'user', 100),
    (v_other, v_other, 'Finance test other employee', v_other::text || '@example.invalid', 'user', 100)
  ON CONFLICT (auth_user_id) DO UPDATE SET name = EXCLUDED.name, user_role = EXCLUDED.user_role, hourly_rate = EXCLUDED.hourly_rate;
  -- Member IDs are distinct from Auth IDs in production.
  SELECT id INTO v_admin FROM public.members WHERE auth_user_id = v_admin;
  PERFORM set_config('test.fa_admin', v_admin::text, true);
  SELECT id INTO v_owner FROM public.members WHERE auth_user_id = v_owner;
  PERFORM set_config('test.fa_owner', v_owner::text, true);
  SELECT id INTO v_other FROM public.members WHERE auth_user_id = v_other;
  PERFORM set_config('test.fa_other', v_other::text, true);
  INSERT INTO public.member_hourly_rate_history(member_id, hourly_rate, currency, valid_from)
  VALUES (v_owner, 100, 'CZK', '1900-01-01') ON CONFLICT (member_id, valid_from) DO NOTHING;
  INSERT INTO public.member_hourly_rate_history(member_id, hourly_rate, currency, valid_from)
  VALUES (v_owner, 100.01, 'CZK', '2026-08-04');
  INSERT INTO public.role_permissions(role, module, can_read, can_edit, can_admin)
  VALUES ('user', 'attendance', true, true, false)
  ON CONFLICT (role, module) DO UPDATE SET can_read = true, can_edit = true, can_admin = false;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
  INSERT INTO public.projects(id, name, code, status, price, budget_percentage, overhead_percentage) VALUES
    (v_project, 'Finance attendance fixture A', 'FA-' || v_project::text, 'V řešení', 100000, 100, 0),
    (v_project_other, 'Finance attendance fixture B', 'FA-' || v_project_other::text, 'V řešení', 100000, 100, 0);
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
  v_owner uuid := current_setting('test.fa_owner')::uuid; v_project uuid := current_setting('test.fa_project')::uuid;
  v_batch uuid := gen_random_uuid(); v_failed_batch uuid := gen_random_uuid(); v_rows jsonb; v_payload jsonb; v_submission jsonb;
BEGIN
  v_payload := jsonb_build_array(
    jsonb_build_object('member_id', v_owner, 'project_id', v_project, 'date', '2026-08-03', 'hours', 3, 'description', 'Test A'),
    jsonb_build_object('member_id', v_owner, 'project_id', v_project, 'date', '2026-08-04', 'hours', 2, 'description', 'Test B')
  );
  v_rows := public.save_attendance_records(v_payload, v_batch);
  IF jsonb_array_length(v_rows) <> 2 THEN RAISE EXCEPTION 'Batch did not return both attendance rows'; END IF;
  IF public.save_attendance_records(v_payload, v_batch) IS DISTINCT FROM v_rows THEN RAISE EXCEPTION 'Same batch did not return original result'; END IF;
  IF (SELECT count(*) FROM public.attendance WHERE member_id = v_owner) <> 2 THEN RAISE EXCEPTION 'Retry duplicated attendance'; END IF;
  PERFORM set_config('test.fa_batch', v_batch::text, true);
  PERFORM set_config('test.fa_payload', v_payload::text, true);
  PERFORM set_config('test.fa_result', v_rows::text, true);
  PERFORM set_config('test.fa_attendance', v_rows -> 0 ->> 'id', true);
  BEGIN
    PERFORM public.save_attendance_records(jsonb_set(v_payload, '{0,hours}', '4'::jsonb), v_batch);
    RAISE EXCEPTION 'Changed batch payload accepted' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_attendance_records(jsonb_build_array(
      jsonb_build_object('member_id', v_owner, 'project_id', v_project, 'date', '2026-08-05', 'hours', 13),
      jsonb_build_object('member_id', v_owner, 'project_id', v_project, 'date', '2026-08-05', 'hours', 13)
    ), v_failed_batch);
    RAISE EXCEPTION 'Daily total above 24 hours accepted' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.attendance WHERE member_id = v_owner AND date = '2026-08-05') THEN
    RAISE EXCEPTION 'Failed batch left a partial attendance write';
  END IF;
  PERFORM set_config('test.fa_failed_batch', v_failed_batch::text, true);
  BEGIN
    PERFORM public.save_attendance_records(jsonb_build_array(jsonb_build_object(
      'member_id', current_setting('test.fa_other'), 'project_id', v_project, 'date', '2026-08-03', 'hours', 1
    )), gen_random_uuid());
    RAISE EXCEPTION 'Worker saved another member attendance' USING ERRCODE = '23514';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v_submission := public.submit_attendance_month(v_owner, '2026-08-01');
  PERFORM set_config('test.fa_submission', v_submission ->> 'id', true);
  IF (v_submission ->> 'total_hours')::numeric <> 5 THEN RAISE EXCEPTION 'Month closure lost attendance hours'; END IF;
  BEGIN
    PERFORM public.save_attendance_record(NULL, v_owner, '2026-08-06', 1, v_project, NULL, 'Should fail');
    RAISE EXCEPTION 'Submitted month allowed a new row' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF public.save_attendance_records(v_payload, v_batch) IS DISTINCT FROM v_rows THEN
    RAISE EXCEPTION 'Committed batch cannot be safely replayed after month closure';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
SELECT public.approve_attendance_submission(current_setting('test.fa_submission')::uuid);
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_request jsonb;
BEGIN
  v_request := public.create_hourly_payout_request(current_setting('test.fa_owner')::uuid, 8, 2026);
  PERFORM set_config('test.fa_request', v_request ->> 'id', true);
  IF (v_request ->> 'total_amount')::numeric <> 500.02 OR (v_request ->> 'total_hours')::numeric <> 5 THEN
    RAISE EXCEPTION 'Ledger payout totals do not equal the recorded hours and rate';
  END IF;
  BEGIN
    DELETE FROM public.hourly_payout_requests WHERE id = (v_request ->> 'id')::uuid;
    RAISE EXCEPTION 'Owner directly deleted financial history' USING ERRCODE = '23514';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_discrepancy record;
BEGIN
  SELECT * INTO v_discrepancy FROM public.get_hourly_payout_discrepancies()
  WHERE request_id = current_setting('test.fa_request')::uuid;
  IF NOT FOUND OR v_discrepancy.has_discrepancy OR v_discrepancy.current_total_amount <> 500.02 THEN
    RAISE EXCEPTION 'Rounded weighted rate created a false ledger discrepancy';
  END IF;
  BEGIN
    PERFORM public.revert_attendance_submission(current_setting('test.fa_submission')::uuid);
    RAISE EXCEPTION 'Active hourly snapshot allowed attendance reopening' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.reject_hourly_payout_request(current_setting('test.fa_request')::uuid, ' ');
    RAISE EXCEPTION 'Hourly rejection without reason accepted' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.reject_payout(gen_random_uuid(), ' ');
    RAISE EXCEPTION 'Fixed rejection without reason accepted' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_other_auth'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.cancel_hourly_payout_request(current_setting('test.fa_request')::uuid, 'Foreign request');
    RAISE EXCEPTION 'Worker cancelled a foreign request' USING ERRCODE = '23514';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.recalculate_hourly_payout_request(current_setting('test.fa_request')::uuid);
    RAISE EXCEPTION 'Private wage helper still callable' USING ERRCODE = '23514';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_cancelled jsonb;
BEGIN
  v_cancelled := public.cancel_hourly_payout_request(current_setting('test.fa_request')::uuid, 'Correction needed');
  IF v_cancelled ->> 'status' <> 'cancelled' OR v_cancelled ->> 'cancelled_by' IS DISTINCT FROM current_setting('test.fa_owner_auth') THEN
    RAISE EXCEPTION 'Cancellation evidence missing';
  END IF;
  IF public.cancel_hourly_payout_request(current_setting('test.fa_request')::uuid, 'Retry') IS DISTINCT FROM v_cancelled THEN
    RAISE EXCEPTION 'Cancellation retry changed original evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hourly_payout_requests WHERE id = current_setting('test.fa_request')::uuid) THEN
    RAISE EXCEPTION 'Cancellation removed request history';
  END IF;
END;
$$;

-- Correct an UNPAID attendance row to another date and project, then reapprove.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
SELECT public.revert_attendance_submission(current_setting('test.fa_submission')::uuid);
SELECT public.return_attendance_submission_for_edit(current_setting('test.fa_submission')::uuid, 'Correct project/date');
SELECT public.save_attendance_record(current_setting('test.fa_attendance')::uuid, current_setting('test.fa_owner')::uuid,
  '2026-08-07', 4, current_setting('test.fa_project_other')::uuid, NULL, 'Corrected');
SELECT public.submit_attendance_month(current_setting('test.fa_owner')::uuid, '2026-08-01');
SELECT public.approve_attendance_submission(current_setting('test.fa_submission')::uuid);
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.labor_cost_ledger l
    WHERE l.attendance_id = current_setting('test.fa_attendance')::uuid
      AND l.project_id = current_setting('test.fa_project_other')::uuid AND l.work_date = '2026-08-07'
      AND l.hours = 4 AND l.pay_amount = 400.04 AND l.status = 'accrued') THEN
    RAISE EXCEPTION 'Reapproval retained the old ledger date/project/amount';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_write_batches WHERE id = current_setting('test.fa_failed_batch')::uuid) THEN
    RAISE EXCEPTION 'Failed batch left a committed receipt';
  END IF;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_request jsonb;
BEGIN
  v_request := public.create_hourly_payout_request(current_setting('test.fa_owner')::uuid, 8, 2026);
  PERFORM set_config('test.fa_request_new', v_request ->> 'id', true);
  PERFORM set_config('test.fa_snapshot', (v_request -> 'attendance_snapshot')::text, true);
  IF (v_request ->> 'total_amount')::numeric <> 600.06 THEN RAISE EXCEPTION 'Corrected payout amount is wrong'; END IF;
END;
$$;
-- Inject a stale snapshot in the isolated fixture to verify approval rejects it.
RESET ROLE;
UPDATE public.hourly_payout_requests
SET attendance_snapshot = jsonb_set(attendance_snapshot, '{0,pay_amount}', '999'::jsonb)
WHERE id = current_setting('test.fa_request_new')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.approve_hourly_payout_request(current_setting('test.fa_request_new')::uuid, NULL, true);
    RAISE EXCEPTION 'Stale ledger snapshot was approved' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;
RESET ROLE;
UPDATE public.hourly_payout_requests SET attendance_snapshot = current_setting('test.fa_snapshot')::jsonb
WHERE id = current_setting('test.fa_request_new')::uuid;
-- A changed source month/funding mode must be reported by the discrepancy read
-- model as well as rejected by approval. Modify only this transaction's ledger.
DO $$
DECLARE v_ledger uuid; v_original_month date;
BEGIN
  SELECT (attendance_snapshot -> 0 ->> 'ledger_id')::uuid INTO v_ledger
  FROM public.hourly_payout_requests WHERE id = current_setting('test.fa_request_new')::uuid;
  SELECT posting_month INTO v_original_month FROM public.labor_cost_ledger WHERE id = v_ledger;
  UPDATE public.labor_cost_ledger SET posting_month = '2026-07-01' WHERE id = v_ledger;
  IF NOT EXISTS (SELECT 1 FROM public.get_hourly_payout_discrepancies() d
    WHERE d.request_id = current_setting('test.fa_request_new')::uuid AND d.has_discrepancy) THEN
    RAISE EXCEPTION 'Changed ledger posting month was not reported';
  END IF;
  UPDATE public.labor_cost_ledger SET posting_month = v_original_month WHERE id = v_ledger;
  -- Snapshot funding differs without changing project costs or sponsor constraints.
  UPDATE public.hourly_payout_requests SET attendance_snapshot = jsonb_set(attendance_snapshot, '{0,funding_mode}', '"member_reward"'::jsonb)
  WHERE id = current_setting('test.fa_request_new')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.get_hourly_payout_discrepancies() d
    WHERE d.request_id = current_setting('test.fa_request_new')::uuid AND d.has_discrepancy) THEN
    RAISE EXCEPTION 'Changed ledger funding mode was not reported';
  END IF;
  UPDATE public.hourly_payout_requests SET attendance_snapshot = current_setting('test.fa_snapshot')::jsonb
  WHERE id = current_setting('test.fa_request_new')::uuid;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
SELECT public.approve_hourly_payout_request(current_setting('test.fa_request_new')::uuid, 'Approved fixture', true);
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.cancel_hourly_payout_request(current_setting('test.fa_request_new')::uuid);
    RAISE EXCEPTION 'Owner cancelled an already approved payout' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_admin_auth'), 'role', 'authenticated')::text, true);
SELECT public.mark_hourly_payout_paid(current_setting('test.fa_request_new')::uuid);
DO $$
BEGIN
  BEGIN
    PERFORM public.revert_attendance_submission(current_setting('test.fa_submission')::uuid);
    RAISE EXCEPTION 'Paid month was reopened' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.cancel_hourly_payout_request(current_setting('test.fa_request_new')::uuid);
    RAISE EXCEPTION 'Paid request was cancelled' USING ERRCODE = '23514';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT sum(pay_amount) FROM public.labor_cost_ledger WHERE member_id = current_setting('test.fa_owner')::uuid AND status = 'paid') <> 600.06 THEN
    RAISE EXCEPTION 'Paid ledger totals lost or double counted a row';
  END IF;
  IF has_function_privilege('authenticated', 'public.recalculate_hourly_payout_request(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.build_hourly_attendance_snapshot(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unscoped internal helper remains public';
  END IF;
  IF has_table_privilege('authenticated', 'public.hourly_payout_requests', 'DELETE')
    OR has_table_privilege('authenticated', 'public.attendance_write_batches', 'SELECT') THEN
    RAISE EXCEPTION 'Direct financial delete or private receipt access remains granted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'hourly_payout_cancelled'
    AND details ->> 'request_id' = current_setting('test.fa_request')) THEN RAISE EXCEPTION 'Cancellation audit missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_hourly_payout_discrepancies() d
    WHERE d.request_id = current_setting('test.fa_request_new')::uuid AND d.has_discrepancy) THEN
    RAISE EXCEPTION 'Matching paid ledger incorrectly reported a discrepancy';
  END IF;
END;
$$;

-- Physical evidence must be detached by the workflow before it can be removed.
-- Use the previously cancelled isolated fixture; never a real storage provider.
SELECT set_config('test.fa_invoice_name', 'hourly_payout/' || current_setting('test.fa_request') || '/řádná faktura.pdf', true);
-- Isolated fixture only: emulate Storage API's transaction flag. RLS stays enabled.
SET LOCAL storage.allow_delete_query = 'true';
UPDATE public.hourly_payout_requests SET status = 'invoice_uploaded', invoice_storage_provider = 'supabase',
  invoice_url = 'invoices/' || current_setting('test.fa_invoice_name'), invoice_external_file_id = NULL
WHERE id = current_setting('test.fa_request')::uuid;
INSERT INTO storage.objects(id, bucket_id, name)
VALUES (gen_random_uuid(), 'invoices', current_setting('test.fa_invoice_name'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fa_owner_auth'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_deleted integer;
BEGIN
  IF NOT public.can_mutate_invoice_storage_object(current_setting('test.fa_invoice_name')) THEN
    RAISE EXCEPTION 'Fixture must be allowed by the existing permissive policy';
  END IF;
  IF public.invoice_object_detached_20260905(current_setting('test.fa_invoice_name')) THEN
    RAISE EXCEPTION 'Referenced invoice was considered detached';
  END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'invoices' AND name = current_setting('test.fa_invoice_name');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN RAISE EXCEPTION 'Referenced invoice was physically deleted'; END IF;
END;
$$;
RESET ROLE;
DO $$
DECLARE v_status text;
BEGIN
  FOREACH v_status IN ARRAY ARRAY['approved', 'paid', 'cancelled', 'rejected', 'invoice_uploaded'] LOOP
    UPDATE public.hourly_payout_requests SET status = v_status WHERE id = current_setting('test.fa_request')::uuid;
    IF public.invoice_object_detached_20260905(current_setting('test.fa_invoice_name')) THEN
      RAISE EXCEPTION 'Referenced invoice deletion accepted for status %', v_status;
    END IF;
  END LOOP;
  UPDATE public.hourly_payout_requests SET invoice_url = 'https://example.invalid/storage/v1/object/sign/invoices/hourly_payout/'
    || current_setting('test.fa_request') || '/%C5%99%C3%A1dn%C3%A1%20faktura.pdf?token=test-only'
  WHERE id = current_setting('test.fa_request')::uuid;
  IF public.invoice_object_detached_20260905(current_setting('test.fa_invoice_name')) THEN
    RAISE EXCEPTION 'Encoded historical invoice URL was not protected';
  END IF;
  UPDATE public.hourly_payout_requests SET invoice_url = 'invoices/' || current_setting('test.fa_invoice_name')
  WHERE id = current_setting('test.fa_request')::uuid;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT public.clear_hourly_payout_invoice(current_setting('test.fa_request')::uuid);
DO $$
DECLARE v_deleted integer;
BEGIN
  IF NOT public.invoice_object_detached_20260905(current_setting('test.fa_invoice_name')) THEN
    RAISE EXCEPTION 'Detached scoped invoice cannot be cleaned up';
  END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'invoices' AND name = current_setting('test.fa_invoice_name');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'Detached invoice cleanup did not remove the fixture'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- Required additional two-session staging scenarios (NOT run by this file):
-- 1. First submission vs batch create for one member, no prior submission:
--    A calls batch inside BEGIN and holds it; B calls submit. B waits for A,
--    then either submits all committed hours or sees no batch if A rolls back.
--    Reverse the order: B holds submitted state, A waits then is rejected.
-- 2. Two same-member creates on the same day, each 13h: only one may commit.
-- 3. Identical batch UUID/payload in A+B: B waits, then returns the same IDs.
--    Change B payload/member/actor: it must fail and never return foreign rows.
-- 4. Pending hourly request creation vs month reopening: serialize on member;
--    at most one transition can commit, no active request with a reopened month.
-- 5. Different members, both eligible for project A+B, send fixed payout items
--    in opposite order. Both lock projects by UUID and complete without a cycle;
--    commitments must still not exceed each member's server-calculated reward.
-- 6. Concurrent approval/paid/cancel of one hourly request: a single allowed
--    terminal transition wins; no paid ledger row becomes accrued/reversed.
-- 7. Two members approve/reopen attendance or approve/cancel their hourly payouts
--    with projects A+B and realizations C+D inserted in opposite order. Both
--    acquire all project IDs, then realization IDs, sorted before ledger writes.
-- 8. Invoice clear vs paid/cancel: only an allowed clear may detach; an uncertain
--    response never triggers physical deletion. A still-referenced invoice must
--    remain protected by Storage RLS / the external Edge reference guard.
