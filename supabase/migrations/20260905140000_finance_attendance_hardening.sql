-- EKV 2.0: serialize attendance closure, atomic retry-safe attendance batches,
-- preserve cancelled hourly history, and keep ledger-backed payouts consistent.
-- Existing payout amounts/formulas and historical data are not recalculated.
BEGIN;

-- These SECURITY DEFINER helpers have no caller-scope checks. They are internal
-- implementation details, never public read APIs for another member's pay/time.
REVOKE ALL ON FUNCTION public.recalculate_hourly_payout_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_hourly_attendance_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lock_attendance_member_20260905(p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id();
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated member required' USING ERRCODE = '42501';
  END IF;
  IF p_member_id IS DISTINCT FROM v_actor
    AND NOT coalesce(public.can_admin_module('attendance'), false)
    AND NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Not allowed to access this member workflow' USING ERRCODE = '42501';
  END IF;
  -- One transaction lock per member, shared by record edits, month closure and
  -- hourly requests. It also covers the first month before a submission exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(20260905, pg_catalog.hashtext(p_member_id::text));
END;
$$;
REVOKE ALL ON FUNCTION public.lock_attendance_member_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Immediate reward-allocation triggers lock scope parents for every ledger row.
-- Different members can touch the same scopes: acquire parents consistently
-- before any ledger row is changed, independently of attendance/item ordering.
CREATE FUNCTION public.lock_labor_scopes_20260905(p_project_ids uuid[], p_realization_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.projects p WHERE p.id = ANY(p_project_ids) ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.realizations r WHERE r.id = ANY(p_realization_ids) ORDER BY r.id FOR UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_labor_scopes_20260905(uuid[], uuid[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_attendance_month_editable(p_member_id uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text; v_month date := date_trunc('month', p_date)::date;
BEGIN
  IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Finite attendance date required'; END IF;
  SELECT status INTO v_status FROM public.attendance_submissions
  WHERE member_id = p_member_id AND month_date = v_month FOR UPDATE;
  IF v_status IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'Docházku nelze upravit ve stavu %', v_status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.hourly_payout_requests h
    WHERE h.member_id = p_member_id AND h.payout_month = extract(month FROM v_month)::integer
      AND h.payout_year = extract(year FROM v_month)::integer
      AND h.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')) THEN
    RAISE EXCEPTION 'Docházka má aktivní nebo vyplacenou hodinovou žádost. Nejprve vyřešte žádost.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_attendance_month_editable(uuid, date) FROM PUBLIC, anon, authenticated;

-- Preserve the prior validated writes/permissions and acquire our shared lock
-- before their record/submission locks. Renamed bodies are not external APIs.
ALTER FUNCTION public.save_attendance_record(uuid, uuid, date, numeric, uuid, uuid, text)
  RENAME TO save_attendance_record_private_20260905;
REVOKE ALL ON FUNCTION public.save_attendance_record_private_20260905(uuid, uuid, date, numeric, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.save_attendance_record(
  p_record_id uuid DEFAULT NULL, p_member_id uuid DEFAULT NULL, p_date date DEFAULT NULL,
  p_hours numeric DEFAULT NULL, p_project_id uuid DEFAULT NULL, p_realizace_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old_member uuid; v_member uuid; v_target uuid := coalesce(p_member_id, public.get_member_id());
BEGIN
  IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Finite attendance date required'; END IF;
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 24 OR p_hours::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Attendance hours must be a finite number between 0 and 24';
  END IF;
  IF p_record_id IS NOT NULL THEN SELECT member_id INTO v_old_member FROM public.attendance WHERE id = p_record_id; END IF;
  FOR v_member IN SELECT DISTINCT id FROM unnest(ARRAY[v_target, v_old_member]) id WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM public.lock_attendance_member_20260905(v_member);
  END LOOP;
  IF p_record_id IS NOT NULL AND v_old_member IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attendance WHERE id = p_record_id AND member_id = v_old_member
  ) THEN RAISE EXCEPTION 'Attendance record changed; reload and retry' USING ERRCODE = '40001'; END IF;
  RETURN public.save_attendance_record_private_20260905(p_record_id, p_member_id, p_date, p_hours, p_project_id, p_realizace_id, p_description);
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance_record(uuid, uuid, date, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_record(uuid, uuid, date, numeric, uuid, uuid, text) TO authenticated;

ALTER FUNCTION public.delete_attendance_record(uuid) RENAME TO delete_attendance_record_private_20260905;
REVOKE ALL ON FUNCTION public.delete_attendance_record_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.delete_attendance_record(p_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance WHERE id = p_record_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance record not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  IF NOT EXISTS (SELECT 1 FROM public.attendance WHERE id = p_record_id AND member_id = v_member) THEN
    RAISE EXCEPTION 'Attendance record changed; reload and retry' USING ERRCODE = '40001';
  END IF;
  RETURN public.delete_attendance_record_private_20260905(p_record_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_attendance_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_attendance_record(uuid) TO authenticated;

ALTER FUNCTION public.submit_attendance_month(uuid, date) RENAME TO submit_attendance_month_private_20260905;
REVOKE ALL ON FUNCTION public.submit_attendance_month_private_20260905(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.submit_attendance_month(p_member_id uuid, p_month_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_month_date IS NULL OR NOT isfinite(p_month_date) THEN RAISE EXCEPTION 'Finite attendance month required'; END IF;
  PERFORM public.lock_attendance_member_20260905(p_member_id);
  RETURN public.submit_attendance_month_private_20260905(p_member_id, p_month_date);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_attendance_month(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_attendance_month(uuid, date) TO authenticated;

ALTER FUNCTION public.approve_attendance_submission(uuid) RENAME TO approve_attendance_submission_private_20260905;
REVOKE ALL ON FUNCTION public.approve_attendance_submission_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.approve_attendance_submission(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.approve_attendance_submission_private_20260905(p_submission_id);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_attendance_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_attendance_submission(uuid) TO authenticated;

ALTER FUNCTION public.reject_attendance_submission(uuid, text) RENAME TO reject_attendance_submission_private_20260905;
REVOKE ALL ON FUNCTION public.reject_attendance_submission_private_20260905(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reject_attendance_submission(p_submission_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.reject_attendance_submission_private_20260905(p_submission_id, p_notes);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_attendance_submission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_attendance_submission(uuid, text) TO authenticated;

ALTER FUNCTION public.revert_attendance_submission(uuid) RENAME TO revert_attendance_submission_private_20260905;
REVOKE ALL ON FUNCTION public.revert_attendance_submission_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.revert_attendance_submission(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.revert_attendance_submission_private_20260905(p_submission_id);
END;
$$;
REVOKE ALL ON FUNCTION public.revert_attendance_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_attendance_submission(uuid) TO authenticated;

ALTER FUNCTION public.return_attendance_submission_for_edit(uuid, text) RENAME TO return_attendance_submission_for_edit_private_20260905;
REVOKE ALL ON FUNCTION public.return_attendance_submission_for_edit_private_20260905(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.return_attendance_submission_for_edit(p_submission_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.return_attendance_submission_for_edit_private_20260905(p_submission_id, p_notes);
END;
$$;
REVOKE ALL ON FUNCTION public.return_attendance_submission_for_edit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_attendance_submission_for_edit(uuid, text) TO authenticated;

ALTER FUNCTION public.withdraw_attendance_submission(uuid) RENAME TO withdraw_attendance_submission_private_20260905;
REVOKE ALL ON FUNCTION public.withdraw_attendance_submission_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.withdraw_attendance_submission(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.withdraw_attendance_submission_private_20260905(p_submission_id);
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_attendance_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_attendance_submission(uuid) TO authenticated;

ALTER FUNCTION public.delete_attendance_submission(uuid) RENAME TO delete_attendance_submission_private_20260905;
REVOKE ALL ON FUNCTION public.delete_attendance_submission_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.delete_attendance_submission(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM public.attendance_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance submission not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  RETURN public.delete_attendance_submission_private_20260905(p_submission_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_attendance_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_attendance_submission(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_paid_attendance_submission_reopen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    IF EXISTS (SELECT 1 FROM public.labor_cost_ledger l WHERE l.attendance_submission_id = OLD.id AND l.status = 'paid')
      OR EXISTS (SELECT 1 FROM public.hourly_payout_requests h
        WHERE h.member_id = OLD.member_id AND h.payout_month = extract(month FROM OLD.month_date)::integer
          AND h.payout_year = extract(year FROM OLD.month_date)::integer
          AND h.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')) THEN
      RAISE EXCEPTION 'Docházku nelze znovu otevřít s aktivní nebo vyplacenou hodinovou žádostí. Nevyplacenou žádost nejprve stornujte.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Receipts are private server data. A successful retry returns the exact saved
-- result even when the month was closed afterwards; it performs no new writes.
CREATE TABLE public.attendance_write_batches (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  member_id uuid NOT NULL REFERENCES public.members(id),
  payload jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_write_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_write_batches FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.attendance_write_batches IS 'Private immutable-payload attendance write receipts for safe network retries; accessible only through scoped RPC.';

CREATE FUNCTION public.save_attendance_records(p_records jsonb, p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := public.get_member_id(); v_target uuid; v_member uuid;
  v_item jsonb; v_canonical jsonb := '[]'::jsonb; v_saved jsonb := '[]'::jsonb;
  v_receipt public.attendance_write_batches%rowtype;
  v_date date; v_hours numeric; v_project uuid; v_realization uuid;
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated member required' USING ERRCODE = '42501'; END IF;
  IF p_batch_id IS NULL OR p_records IS NULL OR jsonb_typeof(p_records) <> 'array'
    OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'A stable batch UUID and 1 to 100 attendance records are required'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR v_item ? 'id' OR v_item ? 'record_id' THEN
      RAISE EXCEPTION 'Attendance batch accepts new records only';
    END IF;
    v_member := coalesce(nullif(v_item ->> 'member_id', '')::uuid, v_actor);
    IF v_target IS NULL THEN v_target := v_member; END IF;
    IF v_member IS DISTINCT FROM v_target THEN RAISE EXCEPTION 'An attendance batch must belong to one member'; END IF;
    v_date := nullif(v_item ->> 'date', '')::date;
    v_hours := nullif(v_item ->> 'hours', '')::numeric;
    v_project := nullif(v_item ->> 'project_id', '')::uuid;
    v_realization := coalesce(nullif(v_item ->> 'realization_id', '')::uuid, nullif(v_item ->> 'realizace_id', '')::uuid);
    IF nullif(v_item ->> 'realization_id', '') IS NOT NULL AND nullif(v_item ->> 'realizace_id', '') IS NOT NULL
      AND (v_item ->> 'realization_id')::uuid IS DISTINCT FROM (v_item ->> 'realizace_id')::uuid THEN
      RAISE EXCEPTION 'Conflicting realization identifiers';
    END IF;
    IF v_date IS NULL OR NOT isfinite(v_date) OR v_hours IS NULL OR v_hours <= 0 OR v_hours > 24
      OR v_hours::text IN ('NaN', 'Infinity', '-Infinity') THEN RAISE EXCEPTION 'Invalid attendance date or hours'; END IF;
    IF (v_project IS NULL) = (v_realization IS NULL) THEN RAISE EXCEPTION 'Attendance requires exactly one project or realization'; END IF;
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_object(
      'member_id', v_member, 'date', v_date, 'hours', v_hours, 'project_id', v_project,
      'realizace_id', v_realization, 'description', nullif(btrim(v_item ->> 'description'), '')
    ));
  END LOOP;
  IF NOT coalesce(public.can_admin_module('attendance'), false)
    AND (v_target IS DISTINCT FROM v_actor OR NOT coalesce(public.can_edit_module('attendance'), false)) THEN
    RAISE EXCEPTION 'Not allowed to save attendance' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.attendance_write_batches(id, actor_id, member_id, payload)
  VALUES (p_batch_id, auth.uid(), v_target, v_canonical)
  ON CONFLICT (id) DO NOTHING RETURNING * INTO v_receipt;
  IF NOT FOUND THEN
    SELECT * INTO v_receipt FROM public.attendance_write_batches
    WHERE id = p_batch_id AND actor_id = auth.uid() AND member_id = v_target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Attendance batch identifier is unavailable'; END IF;
    IF v_receipt.payload IS DISTINCT FROM v_canonical THEN RAISE EXCEPTION 'Attendance batch identifier was already used with different data'; END IF;
    IF v_receipt.result IS NULL THEN RAISE EXCEPTION 'Attendance batch result requires reconciliation'; END IF;
    RETURN v_receipt.result;
  END IF;
  PERFORM public.lock_attendance_member_20260905(v_target);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_canonical) LOOP
    v_saved := v_saved || jsonb_build_array(public.save_attendance_record(
      NULL, v_target, (v_item ->> 'date')::date, (v_item ->> 'hours')::numeric,
      (v_item ->> 'project_id')::uuid, (v_item ->> 'realizace_id')::uuid, v_item ->> 'description'
    ));
  END LOOP;
  UPDATE public.attendance_write_batches SET result = v_saved WHERE id = p_batch_id;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance_records(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_records(jsonb, uuid) TO authenticated;

ALTER FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid)
  RENAME TO create_hourly_payout_request_private_20260905;
REVOKE ALL ON FUNCTION public.create_hourly_payout_request_private_20260905(uuid, integer, integer, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.create_hourly_payout_request(
  p_member_id uuid, p_payout_month integer, p_payout_year integer,
  p_request_type text DEFAULT 'regular', p_parent_request_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_payout_month IS NULL OR p_payout_month NOT BETWEEN 1 AND 12
    OR p_payout_year IS NULL OR p_payout_year NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'Invalid payout month/year'; END IF;
  PERFORM public.lock_attendance_member_20260905(p_member_id);
  RETURN public.create_hourly_payout_request_private_20260905(p_member_id, p_payout_month, p_payout_year, p_request_type, p_parent_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid) TO authenticated, service_role;

CREATE FUNCTION public.assert_hourly_snapshot_current_20260905(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request public.hourly_payout_requests%rowtype; v_month date; v_total numeric; v_hours numeric; v_count integer;
BEGIN
  SELECT * INTO v_request FROM public.hourly_payout_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hourly payout request not found'; END IF;
  IF v_request.payout_month IS NOT NULL AND v_request.payout_year IS NOT NULL THEN
    v_month := make_date(v_request.payout_year, v_request.payout_month, 1);
    IF NOT EXISTS (SELECT 1 FROM public.attendance_submissions s
      WHERE s.member_id = v_request.member_id AND s.month_date = v_month AND s.status = 'approved') THEN
      RAISE EXCEPTION 'Hodinová žádost vyžaduje stále schválenou docházku. Nejprve proveďte kontrolu podkladů.';
    END IF;
  END IF;
  IF v_request.total_amount IS NULL OR v_request.total_amount <= 0
    OR v_request.total_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN RAISE EXCEPTION 'Invalid hourly payout amount'; END IF;
  IF v_request.snapshot_total_amount IS NOT NULL AND v_request.snapshot_total_amount IS DISTINCT FROM v_request.total_amount THEN
    RAISE EXCEPTION 'Hourly payout amount differs from its immutable snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_request.attendance_snapshot) i WHERE nullif(i ->> 'ledger_id', '') IS NOT NULL) THEN
    SELECT count(DISTINCT (i ->> 'ledger_id')::uuid) INTO v_count FROM jsonb_array_elements(v_request.attendance_snapshot) i;
    IF v_count <> jsonb_array_length(v_request.attendance_snapshot) THEN RAISE EXCEPTION 'Incomplete or duplicate hourly ledger snapshot'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_request.attendance_snapshot) i
      LEFT JOIN public.labor_cost_ledger l ON l.id = (i ->> 'ledger_id')::uuid
      WHERE l.id IS NULL OR l.member_id IS DISTINCT FROM v_request.member_id
        OR l.posting_month IS DISTINCT FROM v_month OR l.status NOT IN ('accrued', 'payable')
        OR l.attendance_id IS DISTINCT FROM (i ->> 'attendance_id')::uuid
        OR l.work_date IS DISTINCT FROM (i ->> 'date')::date
        OR l.hours IS DISTINCT FROM (i ->> 'hours')::numeric
        OR l.hourly_rate IS DISTINCT FROM (i ->> 'hourly_rate')::numeric
        OR l.pay_amount IS DISTINCT FROM (i ->> 'pay_amount')::numeric
        OR l.currency IS DISTINCT FROM (i ->> 'currency')
        OR l.project_id IS DISTINCT FROM (i ->> 'project_id')::uuid
        OR l.realization_id IS DISTINCT FROM (i ->> 'realization_id')::uuid
        OR l.funding_mode IS DISTINCT FROM (i ->> 'funding_mode')
    ) THEN RAISE EXCEPTION 'Podklady hodinové žádosti se změnily. Žádost nelze schválit ani proplatit bez opravy.'; END IF;
    SELECT sum((i ->> 'pay_amount')::numeric), sum((i ->> 'hours')::numeric)
    INTO v_total, v_hours FROM jsonb_array_elements(v_request.attendance_snapshot) i;
    IF v_total IS DISTINCT FROM v_request.total_amount
      OR v_hours IS DISTINCT FROM coalesce(v_request.total_hours, v_request.hours)
      OR v_hours IS DISTINCT FROM v_request.snapshot_total_hours THEN
      RAISE EXCEPTION 'Hourly ledger snapshot totals do not match the request';
    END IF;
  ELSIF jsonb_array_length(v_request.attendance_snapshot) > 0 THEN
    -- Pre-ledger snapshots keep their historical rate/amount. Verify recorded
    -- time/scope, without revaluing them at today's hourly rate.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_request.attendance_snapshot) i
      LEFT JOIN public.attendance a ON a.id = (i ->> 'attendance_id')::uuid
      WHERE a.id IS NULL OR a.member_id IS DISTINCT FROM v_request.member_id
        OR a.date IS DISTINCT FROM (i ->> 'date')::date OR a.hours IS DISTINCT FROM (i ->> 'hours')::numeric
        OR a.project_id IS DISTINCT FROM (i ->> 'project_id')::uuid
        OR a.realizace_id IS DISTINCT FROM coalesce((i ->> 'realizace_id')::uuid, (i ->> 'realization_id')::uuid)
    ) THEN RAISE EXCEPTION 'Legacy hourly attendance snapshot changed; manual reconciliation required'; END IF;
  END IF;
  -- Legacy records without a detailed snapshot retain their historical amount.
  -- They are not retrospectively recalculated or represented as ledger-verified.
END;
$$;
REVOKE ALL ON FUNCTION public.assert_hourly_snapshot_current_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) RENAME TO approve_hourly_payout_request_private_20260905;
REVOKE ALL ON FUNCTION public.approve_hourly_payout_request_private_20260905(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.approve_hourly_payout_request(p_request_id uuid, p_admin_note text DEFAULT NULL, p_approved_without_invoice boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  IF NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Payout administrator required' USING ERRCODE = '42501';
  END IF;
  SELECT member_id INTO v_member FROM public.hourly_payout_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hourly payout request not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  PERFORM public.assert_hourly_snapshot_current_20260905(p_request_id);
  RETURN public.approve_hourly_payout_request_private_20260905(p_request_id, p_admin_note, p_approved_without_invoice);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) TO authenticated;

ALTER FUNCTION public.mark_hourly_payout_paid(uuid) RENAME TO mark_hourly_payout_paid_private_20260905;
REVOKE ALL ON FUNCTION public.mark_hourly_payout_paid_private_20260905(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.mark_hourly_payout_paid(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid;
BEGIN
  IF NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Payout administrator required' USING ERRCODE = '42501';
  END IF;
  SELECT member_id INTO v_member FROM public.hourly_payout_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hourly payout request not found'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  PERFORM public.assert_hourly_snapshot_current_20260905(p_request_id);
  RETURN public.mark_hourly_payout_paid_private_20260905(p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_hourly_payout_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_hourly_payout_paid(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_hourly_payout_labor_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text; v_eligible text[]; v_projects uuid[]; v_realizations uuid[];
BEGIN
  IF NEW.status IN ('approved', 'invoice_uploaded') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_status := 'payable'; v_eligible := ARRAY['accrued'];
  ELSIF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    v_status := 'paid'; v_eligible := ARRAY['accrued', 'payable'];
  ELSIF NEW.status IN ('rejected', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_status := 'accrued'; v_eligible := ARRAY['payable'];
  ELSE RETURN NEW;
  END IF;
  SELECT array_agg(l.project_id), array_agg(l.realization_id) INTO v_projects, v_realizations
  FROM public.labor_cost_ledger l
  WHERE l.member_id = NEW.member_id
    AND (NEW.payout_month IS NULL OR NEW.payout_year IS NULL
      OR l.posting_month = make_date(NEW.payout_year, NEW.payout_month, 1))
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(NEW.attendance_snapshot, '[]'::jsonb)) i
      WHERE CASE WHEN nullif(i ->> 'ledger_id', '') IS NOT NULL
        THEN l.id = (i ->> 'ledger_id')::uuid
        ELSE l.attendance_id = nullif(i ->> 'attendance_id', '')::uuid END
    );
  PERFORM public.lock_labor_scopes_20260905(v_projects, v_realizations);
  UPDATE public.labor_cost_ledger l SET status = v_status, updated_at = now()
  WHERE l.member_id = NEW.member_id AND l.status = ANY(v_eligible)
    AND (NEW.payout_month IS NULL OR NEW.payout_year IS NULL
      OR l.posting_month = make_date(NEW.payout_year, NEW.payout_month, 1))
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(NEW.attendance_snapshot, '[]'::jsonb)) i
      WHERE CASE WHEN nullif(i ->> 'ledger_id', '') IS NOT NULL
        THEN l.id = (i ->> 'ledger_id')::uuid
        ELSE l.attendance_id = nullif(i ->> 'attendance_id', '')::uuid END
    );
  RETURN NEW;
END;
$$;

ALTER TABLE public.hourly_payout_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
CREATE FUNCTION public.cancel_hourly_payout_request(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := public.get_member_id(); v_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_member uuid; v_request public.hourly_payout_requests%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated member required' USING ERRCODE = '42501'; END IF;
  SELECT member_id INTO v_member FROM public.hourly_payout_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hourly payout request not found'; END IF;
  IF NOT v_admin AND v_member IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Not allowed to cancel this request' USING ERRCODE = '42501'; END IF;
  PERFORM public.lock_attendance_member_20260905(v_member);
  SELECT * INTO v_request FROM public.hourly_payout_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.member_id IS DISTINCT FROM v_member THEN RAISE EXCEPTION 'Hourly payout request changed; reload and retry' USING ERRCODE = '40001'; END IF;
  IF v_request.status = 'cancelled' THEN RETURN to_jsonb(v_request); END IF;
  IF (NOT v_admin AND v_request.status <> 'pending')
    OR (v_admin AND v_request.status NOT IN ('pending', 'approved', 'invoice_uploaded')) THEN
    RAISE EXCEPTION 'This hourly request can no longer be cancelled';
  END IF;
  UPDATE public.hourly_payout_requests SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancellation_reason = coalesce(v_reason, 'Stornováno před vyplacením'), updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_request;
  PERFORM public.log_workflow_audit('hourly_payout_cancelled', jsonb_build_object(
    'request_id', p_request_id, 'member_id', v_member, 'reason', v_request.cancellation_reason, 'invoice_retained', v_request.invoice_url IS NOT NULL
  ));
  RETURN to_jsonb(v_request);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_hourly_payout_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_hourly_payout_request(uuid, text) TO authenticated;
-- Client deletion no longer discards a financial request. Its immutable state
-- snapshots remain available to the member/admin and existing workflow audit.
REVOKE DELETE ON public.hourly_payout_requests FROM PUBLIC, anon, authenticated;

-- Last effective create/update bodies: 20260513170000_backend_payout_availability.
-- Only project lock ordering changes; availability and financial calculations stay intact.
CREATE OR REPLACE FUNCTION public.create_payout_request(
  p_member_id uuid,
  p_request_date date,
  p_reason text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_total numeric;
  v_payout public.payouts%rowtype;
  v_item jsonb;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin AND p_member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to create payout request for this member';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payout:' || p_member_id::text));
  -- Item constraint triggers lock their projects. Acquire every project in the
  -- same order before any item is inserted, including different members' requests.
  PERFORM 1 FROM public.projects p
  WHERE p.id IN (SELECT nullif(i ->> 'project_id', '')::uuid FROM jsonb_array_elements(p_items) i)
  ORDER BY p.id FOR UPDATE;
  v_total := public.validate_payout_request_items(p_member_id, p_items, NULL);

  INSERT INTO public.payouts (member_id, amount, status, request_date, reason)
  VALUES (p_member_id, v_total, 'pending', p_request_date, p_reason)
  RETURNING * INTO v_payout;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.payout_items (payout_id, project_id, realization_id, amount)
    VALUES (
      v_payout.id,
      NULLIF(v_item->>'project_id', '')::uuid,
      NULLIF(v_item->>'realization_id', '')::uuid,
      (v_item->>'amount')::numeric
    );
  END LOOP;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'create_payout_request',
      jsonb_build_object('payout_id', v_payout.id, 'member_id', p_member_id, 'amount', v_total)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payout_request(
  p_payout_id uuid,
  p_member_id uuid,
  p_request_date date,
  p_reason text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_existing public.payouts%rowtype;
  v_total numeric;
  v_item jsonb;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  SELECT *
  INTO v_existing
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF v_existing.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payout requests can be edited';
  END IF;

  IF NOT v_can_admin AND v_existing.member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to update this payout request';
  END IF;

  IF NOT v_can_admin AND p_member_id IS DISTINCT FROM v_existing.member_id THEN
    RAISE EXCEPTION 'Not allowed to change payout request member';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payout:' || p_member_id::text));
  -- Lock both removed and newly added scopes before the DELETE/INSERT triggers.
  PERFORM 1 FROM public.projects p
  WHERE p.id IN (
    SELECT nullif(i ->> 'project_id', '')::uuid FROM jsonb_array_elements(p_items) i
    UNION SELECT pi.project_id FROM public.payout_items pi WHERE pi.payout_id = p_payout_id
  )
  ORDER BY p.id FOR UPDATE;
  v_total := public.validate_payout_request_items(p_member_id, p_items, p_payout_id);

  UPDATE public.payouts
  SET
    member_id = p_member_id,
    request_date = p_request_date,
    reason = p_reason,
    amount = v_total
  WHERE id = p_payout_id
  RETURNING * INTO v_existing;

  DELETE FROM public.payout_items
  WHERE payout_id = p_payout_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.payout_items (payout_id, project_id, realization_id, amount)
    VALUES (
      p_payout_id,
      NULLIF(v_item->>'project_id', '')::uuid,
      NULLIF(v_item->>'realization_id', '')::uuid,
      (v_item->>'amount')::numeric
    );
  END LOOP;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'update_payout_request',
      jsonb_build_object('payout_id', p_payout_id, 'member_id', p_member_id, 'amount', v_total)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_existing);
END;
$$;

-- Last effective lifecycle trigger: 20260812003000_project_member_net_reward_guards.
create or replace function public.validate_project_reward_on_payout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid;
begin
  if new.status is distinct from old.status or new.member_id is distinct from old.member_id then
    for v_project_id in select distinct pi.project_id from public.payout_items pi
      where pi.payout_id = new.id and pi.project_id is not null order by pi.project_id
    loop perform public.assert_project_reward_allocation(v_project_id); end loop;
  end if;
  return new;
end;
$$;

ALTER FUNCTION public.reject_payout(uuid, text) RENAME TO reject_payout_private_20260905;
REVOKE ALL ON FUNCTION public.reject_payout_private_20260905(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reject_payout(p_payout_id uuid, p_admin_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Payout administrator required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_admin_note), '') IS NULL THEN RAISE EXCEPTION 'Uveďte důvod zamítnutí žádosti.'; END IF;
  RETURN public.reject_payout_private_20260905(p_payout_id, btrim(p_admin_note));
END;
$$;
REVOKE ALL ON FUNCTION public.reject_payout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_payout(uuid, text) TO authenticated;

ALTER FUNCTION public.reject_hourly_payout_request(uuid, text) RENAME TO reject_hourly_payout_request_private_20260905;
REVOKE ALL ON FUNCTION public.reject_hourly_payout_request_private_20260905(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reject_hourly_payout_request(p_request_id uuid, p_rejection_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Payout administrator required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_rejection_reason), '') IS NULL THEN RAISE EXCEPTION 'Uveďte důvod zamítnutí žádosti.'; END IF;
  RETURN public.reject_hourly_payout_request_private_20260905(p_request_id, btrim(p_rejection_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.reject_hourly_payout_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_hourly_payout_request(uuid, text) TO authenticated;

-- Reapproved, unpaid attendance corrections must move their ledger scope/date too.
create or replace function public.materialize_attendance_labor_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance record;
  v_rate numeric;
  v_burden numeric;
  v_currency text;
  v_mode text;
  v_sponsor uuid;
  v_sponsor_percent numeric;
  v_pay numeric;
  v_cost numeric;
  v_sponsor_deduction numeric;
  v_project_impact numeric;
  v_projects uuid[];
  v_realizations uuid[];
begin
  if (new.status = 'approved' and old.status is distinct from 'approved')
    or (old.status = 'approved' and new.status <> 'approved') then
    select array_agg(scope.project_id), array_agg(scope.realization_id)
    into v_projects, v_realizations
    from (
      select a.project_id, a.realizace_id as realization_id from public.attendance a
      where new.status = 'approved' and a.member_id = new.member_id
        and a.date >= new.month_date and a.date < (new.month_date + interval '1 month')::date
      union all
      select l.project_id, l.realization_id from public.labor_cost_ledger l
      where l.attendance_submission_id = new.id
    ) scope;
    perform public.lock_labor_scopes_20260905(v_projects, v_realizations);
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for v_attendance in
      select a.*
      from public.attendance a
      where a.member_id = new.member_id
        and a.date >= new.month_date
        and a.date < (new.month_date + interval '1 month')::date
      order by a.id
      for update
    loop
      select rh.hourly_rate, rh.employer_burden_percent, rh.currency
      into v_rate, v_burden, v_currency
      from public.member_hourly_rate_history rh
      where rh.member_id = v_attendance.member_id
        and rh.valid_from <= v_attendance.date
        and (rh.valid_to is null or rh.valid_to >= v_attendance.date)
      order by rh.valid_from desc
      limit 1;

      if v_rate is null then
        select coalesce(m.hourly_rate, 0), 0, 'CZK'
        into v_rate, v_burden, v_currency
        from public.members m where m.id = v_attendance.member_id;
      end if;

      if coalesce(v_rate, 0) <= 0 then
        raise exception 'No valid hourly rate for member % on %', v_attendance.member_id, v_attendance.date;
      end if;

      v_mode := 'direct_project';
      v_sponsor := null;
      v_sponsor_percent := 0;

      if v_attendance.project_id is not null then
        select pm.hourly_funding_mode, pm.hourly_sponsor_member_id, pm.hourly_sponsor_percent
        into v_mode, v_sponsor, v_sponsor_percent
        from public.project_members pm
        where pm.project_id = v_attendance.project_id
          and pm.member_id = v_attendance.member_id
          and pm.is_hourly = true
          and pm.valid_from <= v_attendance.date
          and (pm.valid_to is null or pm.valid_to >= v_attendance.date)
        order by pm.valid_from desc limit 1;
      elsif v_attendance.realizace_id is not null then
        select rtm.hourly_funding_mode, rtm.hourly_sponsor_member_id, rtm.hourly_sponsor_percent
        into v_mode, v_sponsor, v_sponsor_percent
        from public.realizace_team_members rtm
        where rtm.realizace_id = v_attendance.realizace_id
          and rtm.member_id = v_attendance.member_id
          and rtm.is_hourly = true
          and rtm.valid_from <= v_attendance.date
          and (rtm.valid_to is null or rtm.valid_to >= v_attendance.date)
        order by rtm.valid_from desc limit 1;
      end if;

      v_mode := coalesce(v_mode, 'direct_project');
      v_sponsor_percent := case when v_mode = 'member_reward' then coalesce(v_sponsor_percent, 100) else 0 end;
      v_pay := round(v_attendance.hours * v_rate, 2);
      v_cost := round(v_pay * (1 + coalesce(v_burden, 0) / 100), 2);
      v_sponsor_deduction := case when v_mode = 'member_reward' then round(v_cost * v_sponsor_percent / 100, 2) else 0 end;
      v_project_impact := greatest(0, v_cost - v_sponsor_deduction);

      update public.attendance
      set hourly_rate_snapshot = v_rate,
          employer_cost_snapshot = v_cost,
          funding_mode_snapshot = v_mode,
          sponsor_member_id_snapshot = v_sponsor,
          sponsor_percent_snapshot = v_sponsor_percent,
          financial_snapshot_at = now()
      where id = v_attendance.id;

      insert into public.labor_cost_ledger (
        attendance_id, attendance_submission_id, member_id, project_id, realization_id,
        work_date, posting_month, hours, hourly_rate, currency, pay_amount, employer_cost,
        funding_mode, sponsor_member_id, sponsor_percent, sponsor_reward_deduction,
        project_cost_impact, status, created_by
      ) values (
        v_attendance.id, new.id, v_attendance.member_id, v_attendance.project_id, v_attendance.realizace_id,
        v_attendance.date, new.month_date, v_attendance.hours, v_rate, coalesce(v_currency, 'CZK'), v_pay, v_cost,
        v_mode, v_sponsor, v_sponsor_percent, v_sponsor_deduction,
        v_project_impact, 'accrued', auth.uid()
      )
      on conflict (attendance_id, attendance_submission_id, source_version)
      do update set
        member_id = excluded.member_id,
        project_id = excluded.project_id,
        realization_id = excluded.realization_id,
        work_date = excluded.work_date,
        posting_month = excluded.posting_month,
        currency = excluded.currency,
        hours = excluded.hours,
        hourly_rate = excluded.hourly_rate,
        pay_amount = excluded.pay_amount,
        employer_cost = excluded.employer_cost,
        funding_mode = excluded.funding_mode,
        sponsor_member_id = excluded.sponsor_member_id,
        sponsor_percent = excluded.sponsor_percent,
        sponsor_reward_deduction = excluded.sponsor_reward_deduction,
        project_cost_impact = excluded.project_cost_impact,
        status = 'accrued',
        updated_at = now();
    end loop;
  elsif old.status = 'approved' and new.status <> 'approved' then
    update public.labor_cost_ledger
    set status = 'reversed', updated_at = now()
    where attendance_submission_id = new.id and status <> 'paid';
  end if;
  return new;
end;
$$;
-- Compare each payout with its actual recorded source, not an entire month
-- multiplied by the rounded weighted rate (which creates false discrepancies).
CREATE OR REPLACE FUNCTION public.get_hourly_payout_discrepancies()
RETURNS TABLE (
  request_id uuid, current_total_hours numeric, snapshot_total_hours numeric,
  current_total_amount numeric, snapshot_total_amount numeric, has_discrepancy boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_request public.hourly_payout_requests%rowtype;
  v_hours numeric; v_amount numeric; v_invalid boolean; v_ledger boolean;
BEGIN
  IF NOT coalesce(public.can_admin_module('payouts'), false) THEN
    RAISE EXCEPTION 'Not allowed to inspect hourly payout discrepancies' USING ERRCODE = '42501';
  END IF;
  FOR v_request IN SELECT * FROM public.hourly_payout_requests h
    WHERE h.payout_month IS NOT NULL AND h.payout_year IS NOT NULL ORDER BY h.id LOOP
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_request.attendance_snapshot) i
      WHERE nullif(i ->> 'ledger_id', '') IS NOT NULL) INTO v_ledger;
    IF v_ledger THEN
      SELECT sum(l.hours), sum(l.pay_amount),
        coalesce(bool_or(l.id IS NULL OR l.member_id IS DISTINCT FROM v_request.member_id
          OR l.posting_month IS DISTINCT FROM make_date(v_request.payout_year, v_request.payout_month, 1)
          OR l.attendance_id IS DISTINCT FROM (i ->> 'attendance_id')::uuid
          OR l.work_date IS DISTINCT FROM (i ->> 'date')::date
          OR l.hours IS DISTINCT FROM (i ->> 'hours')::numeric
          OR l.hourly_rate IS DISTINCT FROM (i ->> 'hourly_rate')::numeric
          OR l.pay_amount IS DISTINCT FROM (i ->> 'pay_amount')::numeric
          OR l.currency IS DISTINCT FROM (i ->> 'currency')
          OR l.funding_mode IS DISTINCT FROM (i ->> 'funding_mode')
          OR (v_request.status IN ('pending', 'approved', 'invoice_uploaded') AND l.status NOT IN ('accrued', 'payable'))
          OR (v_request.status = 'paid' AND l.status <> 'paid')
          OR l.project_id IS DISTINCT FROM (i ->> 'project_id')::uuid
          OR l.realization_id IS DISTINCT FROM (i ->> 'realization_id')::uuid), false)
          OR count(DISTINCT (i ->> 'ledger_id')::uuid) <> jsonb_array_length(v_request.attendance_snapshot)
      INTO v_hours, v_amount, v_invalid
      FROM jsonb_array_elements(v_request.attendance_snapshot) i
      LEFT JOIN public.labor_cost_ledger l ON l.id = (i ->> 'ledger_id')::uuid;
    ELSIF jsonb_array_length(v_request.attendance_snapshot) > 0 THEN
      SELECT sum(a.hours), sum(a.hours * coalesce(nullif(i ->> 'hourly_rate', '')::numeric, v_request.hourly_rate)),
        coalesce(bool_or(a.id IS NULL OR a.member_id IS DISTINCT FROM v_request.member_id
          OR a.date IS DISTINCT FROM (i ->> 'date')::date OR a.hours IS DISTINCT FROM (i ->> 'hours')::numeric
          OR a.project_id IS DISTINCT FROM (i ->> 'project_id')::uuid
          OR a.realizace_id IS DISTINCT FROM coalesce((i ->> 'realizace_id')::uuid, (i ->> 'realization_id')::uuid)), false)
          OR count(DISTINCT (i ->> 'attendance_id')::uuid) <> jsonb_array_length(v_request.attendance_snapshot)
      INTO v_hours, v_amount, v_invalid
      FROM jsonb_array_elements(v_request.attendance_snapshot) i
      LEFT JOIN public.attendance a ON a.id = (i ->> 'attendance_id')::uuid;
    ELSE
      -- Preserve the old comparison for records created before detailed snapshots.
      SELECT coalesce(sum(a.hours), 0), coalesce(sum(a.hours), 0) * v_request.hourly_rate
      INTO v_hours, v_amount FROM public.attendance a
      WHERE a.member_id = v_request.member_id
        AND a.date >= make_date(v_request.payout_year, v_request.payout_month, 1)
        AND a.date < (make_date(v_request.payout_year, v_request.payout_month, 1) + interval '1 month')::date;
      v_invalid := false;
    END IF;
    request_id := v_request.id;
    current_total_hours := coalesce(v_hours, 0);
    current_total_amount := coalesce(v_amount, 0);
    snapshot_total_hours := v_request.snapshot_total_hours;
    snapshot_total_amount := v_request.snapshot_total_amount;
    has_discrepancy := v_invalid
      OR abs(current_total_hours - coalesce(v_request.snapshot_total_hours, v_request.total_hours, v_request.hours)) > 0.01
      OR abs(current_total_amount - coalesce(v_request.snapshot_total_amount, v_request.total_amount)) > 0.01;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_hourly_payout_discrepancies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hourly_payout_discrepancies() TO authenticated;

-- Do not physically delete financial evidence while a payout still refers to
-- it, regardless of the payout status. Keep existing INSERT/SELECT permissions
-- and add this as an AND condition to every permissive invoice DELETE policy.
CREATE FUNCTION public.invoice_object_detached_20260905(p_object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_encoded_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_access_invoice_storage_object(p_object_name), false) THEN RETURN false; END IF;
  -- Historical public/signed URLs can percent-encode Czech filenames. Compare
  -- both the raw storage name and its UTF-8 URL path, never a decoded user regex.
  SELECT string_agg(CASE WHEN b.value BETWEEN 48 AND 57 OR b.value BETWEEN 65 AND 90
      OR b.value BETWEEN 97 AND 122 OR b.value IN (45, 46, 47, 95, 126)
    THEN chr(b.value) ELSE '%' || upper(lpad(to_hex(b.value), 2, '0')) END, '' ORDER BY b.byte_index)
  INTO v_encoded_name
  FROM (SELECT n AS byte_index, get_byte(convert_to(p_object_name, 'UTF8'), n) AS value
    FROM generate_series(0, octet_length(convert_to(p_object_name, 'UTF8')) - 1) AS bytes(n)) b;
  RETURN NOT EXISTS (
    SELECT 1 FROM (
      SELECT p.invoice_url, p.invoice_external_file_id FROM public.payouts p
      WHERE coalesce(p.invoice_storage_provider, 'supabase') = 'supabase'
      UNION ALL
      SELECT h.invoice_url, h.invoice_external_file_id FROM public.hourly_payout_requests h
      WHERE coalesce(h.invoice_storage_provider, 'supabase') = 'supabase'
    ) source
    WHERE source.invoice_url IS NOT NULL AND (
      source.invoice_url IN (p_object_name, 'invoices/' || p_object_name)
      OR source.invoice_external_file_id IN (p_object_name, 'invoices/' || p_object_name)
      OR regexp_replace(split_part(source.invoice_url, '?', 1), '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/invoices/', '')
        IN (p_object_name, v_encoded_name)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invoice_object_detached_20260905(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_object_detached_20260905(text) TO authenticated;
CREATE POLICY "Referenced payout invoices cannot be deleted"
ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> 'invoices' OR public.invoice_object_detached_20260905(name));

NOTIFY pgrst, 'reload schema';
COMMIT;
