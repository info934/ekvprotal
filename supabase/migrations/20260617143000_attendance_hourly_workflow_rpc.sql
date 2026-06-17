CREATE OR REPLACE FUNCTION public.can_admin_module(p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = p_module
        AND rp.can_admin = true
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_module(p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = p_module
        AND (rp.can_edit = true OR rp.can_admin = true)
    );
$$;

CREATE OR REPLACE FUNCTION public.assert_attendance_month_editable(
  p_member_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status
  INTO v_status
  FROM public.attendance_submissions
  WHERE member_id = p_member_id
    AND month_date = date_trunc('month', p_date)::date
  FOR UPDATE;

  IF v_status IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'Docházku nelze upravit ve stavu %', v_status;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_attendance_record(
  p_record_id uuid DEFAULT NULL,
  p_member_id uuid DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_hours numeric DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_realizace_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_target_member_id uuid;
  v_existing public.attendance%rowtype;
  v_daily_hours numeric;
  v_saved public.attendance%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('attendance');
  v_target_member_id := COALESCE(p_member_id, v_current_member_id);

  IF v_target_member_id IS NULL OR p_date IS NULL OR p_hours IS NULL THEN
    RAISE EXCEPTION 'Missing required attendance fields';
  END IF;

  IF NOT v_can_admin AND (v_target_member_id IS DISTINCT FROM v_current_member_id OR NOT public.can_edit_module('attendance')) THEN
    RAISE EXCEPTION 'Not allowed to save attendance';
  END IF;

  IF p_hours <= 0 OR p_hours > 24 THEN
    RAISE EXCEPTION 'Attendance hours must be between 0 and 24';
  END IF;

  IF (p_project_id IS NULL AND p_realizace_id IS NULL) OR (p_project_id IS NOT NULL AND p_realizace_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Attendance record must reference exactly one project or realization';
  END IF;

  IF p_record_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.attendance
    WHERE id = p_record_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attendance record not found';
    END IF;

    IF NOT v_can_admin AND v_existing.member_id IS DISTINCT FROM v_current_member_id THEN
      RAISE EXCEPTION 'Not allowed to update this attendance record';
    END IF;

    PERFORM public.assert_attendance_month_editable(v_existing.member_id, v_existing.date);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('attendance:' || v_target_member_id::text || ':' || p_date::text));
  PERFORM public.assert_attendance_month_editable(v_target_member_id, p_date);

  SELECT COALESCE(SUM(hours), 0)
  INTO v_daily_hours
  FROM public.attendance
  WHERE member_id = v_target_member_id
    AND date = p_date
    AND (p_record_id IS NULL OR id <> p_record_id);

  IF v_daily_hours + p_hours > 24 THEN
    RAISE EXCEPTION 'Daily attendance total cannot exceed 24 hours';
  END IF;

  IF p_record_id IS NULL THEN
    INSERT INTO public.attendance (member_id, project_id, realizace_id, date, hours, description)
    VALUES (v_target_member_id, p_project_id, p_realizace_id, p_date, p_hours, p_description)
    RETURNING * INTO v_saved;
  ELSE
    UPDATE public.attendance
    SET
      member_id = v_target_member_id,
      project_id = p_project_id,
      realizace_id = p_realizace_id,
      date = p_date,
      hours = p_hours,
      description = p_description
    WHERE id = p_record_id
    RETURNING * INTO v_saved;
  END IF;

  RETURN to_jsonb(v_saved);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_attendance_record(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_record public.attendance%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('attendance');

  SELECT *
  INTO v_record
  FROM public.attendance
  WHERE id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;

  IF NOT v_can_admin AND (v_record.member_id IS DISTINCT FROM v_current_member_id OR NOT public.can_edit_module('attendance')) THEN
    RAISE EXCEPTION 'Not allowed to delete this attendance record';
  END IF;

  PERFORM public.assert_attendance_month_editable(v_record.member_id, v_record.date);

  DELETE FROM public.attendance WHERE id = p_record_id;
  RETURN to_jsonb(v_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_attendance_month(
  p_member_id uuid,
  p_month_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_month date;
  v_total numeric;
  v_submission public.attendance_submissions%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('attendance');
  v_month := date_trunc('month', p_month_date)::date;

  IF NOT v_can_admin AND (p_member_id IS DISTINCT FROM v_current_member_id OR NOT public.can_edit_module('attendance')) THEN
    RAISE EXCEPTION 'Not allowed to submit attendance';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('attendance-submit:' || p_member_id::text || ':' || v_month::text));

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total
  FROM public.attendance
  WHERE member_id = p_member_id
    AND date >= v_month
    AND date < (v_month + interval '1 month')::date;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Cannot submit empty attendance month';
  END IF;

  INSERT INTO public.attendance_submissions (
    member_id,
    month_date,
    status,
    total_hours,
    submitted_at,
    approved_at,
    approver_id,
    notes
  )
  VALUES (p_member_id, v_month, 'submitted', v_total, now(), NULL, NULL, NULL)
  ON CONFLICT (member_id, month_date)
  DO UPDATE SET
    status = 'submitted',
    total_hours = EXCLUDED.total_hours,
    submitted_at = now(),
    approved_at = NULL,
    approver_id = NULL,
    notes = NULL
  WHERE public.attendance_submissions.status IN ('draft', 'rejected', 'submitted')
  RETURNING * INTO v_submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance month cannot be resubmitted from current status';
  END IF;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_attendance_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.attendance_submissions%rowtype;
  v_total numeric;
BEGIN
  IF NOT public.can_admin_module('attendance') THEN
    RAISE EXCEPTION 'Not allowed to approve attendance';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  IF v_submission.status <> 'submitted' THEN
    RAISE EXCEPTION 'Cannot approve attendance with status %', v_submission.status;
  END IF;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total
  FROM public.attendance
  WHERE member_id = v_submission.member_id
    AND date >= v_submission.month_date
    AND date < (v_submission.month_date + interval '1 month')::date;

  UPDATE public.attendance_submissions
  SET
    status = 'approved',
    total_hours = v_total,
    approver_id = auth.uid(),
    approved_at = now()
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_attendance_submission(
  p_submission_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.attendance_submissions%rowtype;
BEGIN
  IF NOT public.can_admin_module('attendance') THEN
    RAISE EXCEPTION 'Not allowed to reject attendance';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  IF v_submission.status <> 'submitted' THEN
    RAISE EXCEPTION 'Cannot reject attendance with status %', v_submission.status;
  END IF;

  UPDATE public.attendance_submissions
  SET status = 'rejected', notes = p_notes, approver_id = auth.uid()
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_attendance_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.attendance_submissions%rowtype;
  v_total numeric;
BEGIN
  IF NOT public.can_admin_module('attendance') THEN
    RAISE EXCEPTION 'Not allowed to revert attendance';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total
  FROM public.attendance
  WHERE member_id = v_submission.member_id
    AND date >= v_submission.month_date
    AND date < (v_submission.month_date + interval '1 month')::date;

  UPDATE public.attendance_submissions
  SET status = 'submitted', total_hours = v_total, approver_id = NULL, approved_at = NULL
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_hourly_payout_request(
  p_member_id uuid,
  p_payout_month integer,
  p_payout_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_month_start date;
  v_total_hours numeric;
  v_hourly_rate numeric;
  v_breakdown jsonb;
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('payouts');

  IF p_payout_month < 1 OR p_payout_month > 12 THEN
    RAISE EXCEPTION 'Invalid payout month';
  END IF;

  IF NOT v_can_admin AND p_member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to create hourly payout for this member';
  END IF;

  v_month_start := make_date(p_payout_year, p_payout_month, 1);
  PERFORM pg_advisory_xact_lock(hashtext('hourly-payout:' || p_member_id::text || ':' || v_month_start::text));

  IF NOT EXISTS (
    SELECT 1
    FROM public.attendance_submissions s
    WHERE s.member_id = p_member_id
      AND s.month_date = v_month_start
      AND s.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Hourly payout can be requested only for an approved attendance month';
  END IF;

  SELECT COALESCE(hourly_rate, 0)
  INTO v_hourly_rate
  FROM public.members
  WHERE id = p_member_id;

  IF COALESCE(v_hourly_rate, 0) <= 0 THEN
    RAISE EXCEPTION 'Member has no hourly rate configured';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total_hours
  FROM public.attendance
  WHERE member_id = p_member_id
    AND date >= v_month_start
    AND date < (v_month_start + interval '1 month')::date;

  IF v_total_hours <= 0 THEN
    RAISE EXCEPTION 'No attendance hours found for payout month';
  END IF;

  WITH grouped AS (
    SELECT
      COALESCE(p.name, r.name, 'Nezařazeno') AS name,
      SUM(a.hours)::numeric AS hours
    FROM public.attendance a
    LEFT JOIN public.projects p ON p.id = a.project_id
    LEFT JOIN public.realizations r ON r.id = a.realizace_id
    WHERE a.member_id = p_member_id
      AND a.date >= v_month_start
      AND a.date < (v_month_start + interval '1 month')::date
    GROUP BY COALESCE(p.name, r.name, 'Nezařazeno')
  )
  SELECT COALESCE(jsonb_object_agg(name, hours), '{}'::jsonb)
  INTO v_breakdown
  FROM grouped;

  INSERT INTO public.hourly_payout_requests (
    member_id,
    project_id,
    hours,
    hourly_rate,
    total_amount,
    status,
    notes,
    payout_month,
    payout_year,
    total_hours,
    breakdown
  )
  VALUES (
    p_member_id,
    NULL,
    v_total_hours,
    v_hourly_rate,
    v_total_hours * v_hourly_rate,
    'pending',
    'Vygenerováno ze schválené docházky za ' || p_payout_month || '/' || p_payout_year,
    p_payout_month,
    p_payout_year,
    v_total_hours,
    v_breakdown
  )
  RETURNING * INTO v_request;

  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_hourly_payout_request(p_request_id uuid)
RETURNS public.hourly_payout_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.hourly_payout_requests%rowtype;
  v_month_start date;
  v_total_hours numeric;
  v_hourly_rate numeric;
  v_breakdown jsonb;
BEGIN
  SELECT *
  INTO v_request
  FROM public.hourly_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hourly payout request not found';
  END IF;

  IF v_request.payout_month IS NULL OR v_request.payout_year IS NULL THEN
    RETURN v_request;
  END IF;

  v_month_start := make_date(v_request.payout_year, v_request.payout_month, 1);

  IF NOT EXISTS (
    SELECT 1
    FROM public.attendance_submissions s
    WHERE s.member_id = v_request.member_id
      AND s.month_date = v_month_start
      AND s.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Hourly payout request requires an approved attendance month';
  END IF;

  SELECT COALESCE(hourly_rate, 0)
  INTO v_hourly_rate
  FROM public.members
  WHERE id = v_request.member_id;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total_hours
  FROM public.attendance
  WHERE member_id = v_request.member_id
    AND date >= v_month_start
    AND date < (v_month_start + interval '1 month')::date;

  WITH grouped AS (
    SELECT
      COALESCE(p.name, r.name, 'Nezařazeno') AS name,
      SUM(a.hours)::numeric AS hours
    FROM public.attendance a
    LEFT JOIN public.projects p ON p.id = a.project_id
    LEFT JOIN public.realizations r ON r.id = a.realizace_id
    WHERE a.member_id = v_request.member_id
      AND a.date >= v_month_start
      AND a.date < (v_month_start + interval '1 month')::date
    GROUP BY COALESCE(p.name, r.name, 'Nezařazeno')
  )
  SELECT COALESCE(jsonb_object_agg(name, hours), '{}'::jsonb)
  INTO v_breakdown
  FROM grouped;

  UPDATE public.hourly_payout_requests
  SET
    hours = v_total_hours,
    total_hours = v_total_hours,
    hourly_rate = v_hourly_rate,
    total_amount = v_total_hours * v_hourly_rate,
    breakdown = v_breakdown,
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_hourly_payout_request(
  p_request_id uuid,
  p_admin_note text DEFAULT NULL,
  p_approved_without_invoice boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  IF NOT public.can_admin_module('payouts') THEN
    RAISE EXCEPTION 'Not allowed to approve hourly payout requests';
  END IF;

  v_request := public.recalculate_hourly_payout_request(p_request_id);

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot approve hourly payout with status %', v_request.status;
  END IF;

  UPDATE public.hourly_payout_requests
  SET
    status = 'approved',
    approved_without_invoice = COALESCE(p_approved_without_invoice, false),
    admin_note = p_admin_note,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_hourly_payout_request(
  p_request_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  IF NOT public.can_admin_module('payouts') THEN
    RAISE EXCEPTION 'Not allowed to reject hourly payout requests';
  END IF;

  SELECT *
  INTO v_request
  FROM public.hourly_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hourly payout request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot reject hourly payout with status %', v_request.status;
  END IF;

  UPDATE public.hourly_payout_requests
  SET
    status = 'rejected',
    rejection_reason = p_rejection_reason,
    rejected_at = now(),
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.upload_hourly_payout_invoice(
  p_request_id uuid,
  p_invoice_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('payouts');

  SELECT *
  INTO v_request
  FROM public.hourly_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hourly payout request not found';
  END IF;

  IF NOT v_can_admin AND v_request.member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to upload invoice for this request';
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'Cannot upload invoice for hourly payout with status %', v_request.status;
  END IF;

  IF COALESCE(v_request.approved_without_invoice, false) THEN
    RAISE EXCEPTION 'This request was approved without invoice';
  END IF;

  UPDATE public.hourly_payout_requests
  SET
    invoice_url = p_invoice_url,
    invoice_uploaded_at = now(),
    status = 'invoice_uploaded',
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN to_jsonb(v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_hourly_payout_paid(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  IF NOT public.can_admin_module('payouts') THEN
    RAISE EXCEPTION 'Not allowed to mark hourly payout requests as paid';
  END IF;

  SELECT *
  INTO v_request
  FROM public.hourly_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hourly payout request not found';
  END IF;

  IF v_request.status = 'invoice_uploaded' THEN
    IF v_request.invoice_url IS NULL THEN
      RAISE EXCEPTION 'Cannot mark hourly payout as paid without invoice';
    END IF;
  ELSIF v_request.status = 'approved' THEN
    IF COALESCE(v_request.approved_without_invoice, false) = false THEN
      RAISE EXCEPTION 'Hourly payout requires invoice before payment';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cannot mark hourly payout with status % as paid', v_request.status;
  END IF;

  UPDATE public.hourly_payout_requests
  SET status = 'paid', paid_at = now(), updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN to_jsonb(v_request);
END;
$$;

DROP POLICY IF EXISTS "Enable all for own submissions or admins" ON public.attendance_submissions;
CREATE POLICY "Attendance submissions read for own records or attendance admins"
ON public.attendance_submissions
FOR SELECT
TO authenticated
USING (
  member_id = public.get_member_id()
  OR public.can_admin_module('attendance')
);

DROP POLICY IF EXISTS "Enable insert for own records" ON public.attendance;
DROP POLICY IF EXISTS "Validate attendance hours insert" ON public.attendance;
DROP POLICY IF EXISTS "Enable update for own records, admins or super_managers" ON public.attendance;
DROP POLICY IF EXISTS "Validate attendance hours update" ON public.attendance;
DROP POLICY IF EXISTS "Enable delete for own records or admins" ON public.attendance;

DROP POLICY IF EXISTS "Enable insert for own records" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable update for own records" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable update for own hourly requests or payout admins" ON public.hourly_payout_requests;

GRANT EXECUTE ON FUNCTION public.can_admin_module(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_module(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_attendance_record(uuid, uuid, date, numeric, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_attendance_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_attendance_month(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_attendance_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_attendance_submission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_attendance_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_hourly_payout_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upload_hourly_payout_invoice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hourly_payout_paid(uuid) TO authenticated;
