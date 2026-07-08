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
  WHERE public.attendance_submissions.status IN ('draft', 'rejected', 'returned', 'submitted')
  RETURNING * INTO v_submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance month cannot be resubmitted from current status';
  END IF;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.return_attendance_submission_for_edit(
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
  v_total numeric;
BEGIN
  IF NOT public.can_admin_module('attendance') THEN
    RAISE EXCEPTION 'Not allowed to return attendance for edit';
  END IF;

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  IF v_submission.status = 'approved' THEN
    RAISE EXCEPTION 'Approved attendance cannot be returned for edit';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total
  FROM public.attendance
  WHERE member_id = v_submission.member_id
    AND date >= v_submission.month_date
    AND date < (v_submission.month_date + interval '1 month')::date;

  UPDATE public.attendance_submissions
  SET
    status = 'returned',
    total_hours = v_total,
    notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    approver_id = auth.uid(),
    approved_at = NULL
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_attendance_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_submission public.attendance_submissions%rowtype;
  v_total numeric;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('attendance');

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  IF NOT v_can_admin AND (v_submission.member_id IS DISTINCT FROM v_current_member_id OR NOT public.can_edit_module('attendance')) THEN
    RAISE EXCEPTION 'Not allowed to withdraw this attendance submission';
  END IF;

  IF v_submission.status = 'approved' THEN
    RAISE EXCEPTION 'Approved attendance cannot be withdrawn';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
  INTO v_total
  FROM public.attendance
  WHERE member_id = v_submission.member_id
    AND date >= v_submission.month_date
    AND date < (v_submission.month_date + interval '1 month')::date;

  UPDATE public.attendance_submissions
  SET
    status = 'draft',
    total_hours = v_total,
    submitted_at = NULL,
    approved_at = NULL,
    approver_id = NULL,
    notes = NULL
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  RETURN to_jsonb(v_submission);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_attendance_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_submission public.attendance_submissions%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('attendance');

  SELECT *
  INTO v_submission
  FROM public.attendance_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance submission not found';
  END IF;

  IF NOT v_can_admin AND (v_submission.member_id IS DISTINCT FROM v_current_member_id OR NOT public.can_edit_module('attendance')) THEN
    RAISE EXCEPTION 'Not allowed to delete this attendance submission';
  END IF;

  IF v_submission.status = 'approved' THEN
    RAISE EXCEPTION 'Approved attendance submission cannot be deleted';
  END IF;

  DELETE FROM public.attendance_submissions
  WHERE id = p_submission_id;

  RETURN to_jsonb(v_submission);
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_attendance_submission_for_edit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_attendance_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_attendance_submission(uuid) TO authenticated;
