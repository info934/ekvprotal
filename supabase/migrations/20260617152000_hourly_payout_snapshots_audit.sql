ALTER TABLE public.hourly_payout_requests
ADD COLUMN IF NOT EXISTS attendance_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS calculation_hash text,
ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'regular',
ADD COLUMN IF NOT EXISTS parent_request_id uuid REFERENCES public.hourly_payout_requests(id),
ADD COLUMN IF NOT EXISTS snapshot_total_hours numeric,
ADD COLUMN IF NOT EXISTS snapshot_total_amount numeric;

ALTER TABLE public.hourly_payout_requests
DROP CONSTRAINT IF EXISTS hourly_payout_requests_request_type_check;

ALTER TABLE public.hourly_payout_requests
ADD CONSTRAINT hourly_payout_requests_request_type_check
CHECK (request_type IN ('regular', 'supplement', 'correction'));

CREATE INDEX IF NOT EXISTS idx_hourly_payout_requests_request_type
ON public.hourly_payout_requests (request_type);

CREATE INDEX IF NOT EXISTS idx_hourly_payout_requests_parent_request_id
ON public.hourly_payout_requests (parent_request_id);

CREATE OR REPLACE FUNCTION public.log_workflow_audit(
  p_action text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      p_action,
      COALESCE(p_details, '{}'::jsonb)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_workflow_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_details jsonb;
BEGIN
  v_action := TG_TABLE_NAME || '_' || lower(TG_OP);

  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'id', NEW.id,
      'status', to_jsonb(NEW) ->> 'status',
      'new_row', to_jsonb(NEW)
    );
    PERFORM public.log_workflow_audit(v_action, v_details);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_details := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'id', NEW.id,
      'old_status', to_jsonb(OLD) ->> 'status',
      'new_status', to_jsonb(NEW) ->> 'status',
      'old_row', to_jsonb(OLD),
      'new_row', to_jsonb(NEW)
    );
    PERFORM public.log_workflow_audit(v_action, v_details);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_details := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'id', OLD.id,
      'status', to_jsonb(OLD) ->> 'status',
      'old_row', to_jsonb(OLD)
    );
    PERFORM public.log_workflow_audit(v_action, v_details);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_attendance_submissions_workflow ON public.attendance_submissions;
CREATE TRIGGER tr_audit_attendance_submissions_workflow
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_submissions
FOR EACH ROW
EXECUTE FUNCTION public.audit_workflow_table_change();

DROP TRIGGER IF EXISTS tr_audit_hourly_payout_requests_workflow ON public.hourly_payout_requests;
CREATE TRIGGER tr_audit_hourly_payout_requests_workflow
AFTER INSERT OR UPDATE OR DELETE ON public.hourly_payout_requests
FOR EACH ROW
EXECUTE FUNCTION public.audit_workflow_table_change();

DROP TRIGGER IF EXISTS tr_audit_attendance_workflow ON public.attendance;
CREATE TRIGGER tr_audit_attendance_workflow
AFTER INSERT OR UPDATE OR DELETE ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.audit_workflow_table_change();

CREATE OR REPLACE FUNCTION public.build_hourly_attendance_snapshot(
  p_member_id uuid,
  p_month_start date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'attendance_id', a.id,
        'date', a.date,
        'hours', a.hours,
        'project_id', a.project_id,
        'realizace_id', a.realizace_id,
        'target_name', COALESCE(p.name, r.name, 'Nezařazeno'),
        'target_code', p.code,
        'description', a.description
      )
      ORDER BY a.date, COALESCE(p.name, r.name), a.id
    ),
    '[]'::jsonb
  )
  FROM public.attendance a
  LEFT JOIN public.projects p ON p.id = a.project_id
  LEFT JOIN public.realizations r ON r.id = a.realizace_id
  WHERE a.member_id = p_member_id
    AND a.date >= p_month_start
    AND a.date < (p_month_start + interval '1 month')::date;
$$;

DROP FUNCTION IF EXISTS public.create_hourly_payout_request(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.create_hourly_payout_request(
  p_member_id uuid,
  p_payout_month integer,
  p_payout_year integer,
  p_request_type text DEFAULT 'regular',
  p_parent_request_id uuid DEFAULT NULL
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
  v_snapshot jsonb;
  v_hash text;
  v_request public.hourly_payout_requests%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('payouts');

  IF p_payout_month < 1 OR p_payout_month > 12 THEN
    RAISE EXCEPTION 'Invalid payout month';
  END IF;

  IF COALESCE(p_request_type, 'regular') NOT IN ('regular', 'supplement', 'correction') THEN
    RAISE EXCEPTION 'Invalid hourly payout request type';
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

  v_snapshot := public.build_hourly_attendance_snapshot(p_member_id, v_month_start);
  v_hash := md5(v_snapshot::text || ':' || v_total_hours::text || ':' || v_hourly_rate::text);

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
    breakdown,
    attendance_snapshot,
    calculation_hash,
    request_type,
    parent_request_id,
    snapshot_total_hours,
    snapshot_total_amount
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
    v_breakdown,
    v_snapshot,
    v_hash,
    COALESCE(p_request_type, 'regular'),
    p_parent_request_id,
    v_total_hours,
    v_total_hours * v_hourly_rate
  )
  RETURNING * INTO v_request;

  PERFORM public.log_workflow_audit(
    'hourly_payout_request_created_from_snapshot',
    jsonb_build_object(
      'request_id', v_request.id,
      'member_id', p_member_id,
      'payout_month', p_payout_month,
      'payout_year', p_payout_year,
      'request_type', v_request.request_type,
      'total_hours', v_total_hours,
      'total_amount', v_request.total_amount,
      'calculation_hash', v_hash
    )
  );

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
BEGIN
  SELECT *
  INTO v_request
  FROM public.hourly_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hourly payout request not found';
  END IF;

  IF v_request.snapshot_total_hours IS NOT NULL AND v_request.snapshot_total_amount IS NOT NULL THEN
    RETURN v_request;
  END IF;

  UPDATE public.hourly_payout_requests
  SET
    snapshot_total_hours = COALESCE(total_hours, hours),
    snapshot_total_amount = total_amount,
    calculation_hash = COALESCE(calculation_hash, md5(COALESCE(attendance_snapshot, '[]'::jsonb)::text || ':' || COALESCE(total_hours, hours, 0)::text || ':' || COALESCE(hourly_rate, 0)::text)),
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hourly_payout_discrepancies()
RETURNS TABLE (
  request_id uuid,
  current_total_hours numeric,
  snapshot_total_hours numeric,
  current_total_amount numeric,
  snapshot_total_amount numeric,
  has_discrepancy boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_admin_module('payouts') THEN
    RAISE EXCEPTION 'Not allowed to inspect hourly payout discrepancies';
  END IF;

  RETURN QUERY
  WITH current_values AS (
    SELECT
      h.id AS request_id,
      COALESCE(SUM(a.hours), 0)::numeric AS current_hours,
      (COALESCE(SUM(a.hours), 0) * COALESCE(h.hourly_rate, 0))::numeric AS current_amount
    FROM public.hourly_payout_requests h
    LEFT JOIN public.attendance a
      ON a.member_id = h.member_id
      AND h.payout_month IS NOT NULL
      AND h.payout_year IS NOT NULL
      AND a.date >= make_date(h.payout_year, h.payout_month, 1)
      AND a.date < (make_date(h.payout_year, h.payout_month, 1) + interval '1 month')::date
    GROUP BY h.id, h.hourly_rate
  )
  SELECT
    h.id,
    cv.current_hours,
    h.snapshot_total_hours,
    cv.current_amount,
    h.snapshot_total_amount,
    (
      h.snapshot_total_hours IS NOT NULL
      AND (
        abs(COALESCE(cv.current_hours, 0) - COALESCE(h.snapshot_total_hours, 0)) > 0.01
        OR abs(COALESCE(cv.current_amount, 0) - COALESCE(h.snapshot_total_amount, 0)) > 0.01
      )
    ) AS has_discrepancy
  FROM public.hourly_payout_requests h
  JOIN current_values cv ON cv.request_id = h.id
  WHERE h.payout_month IS NOT NULL
    AND h.payout_year IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_workflow_audit(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_hourly_attendance_snapshot(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hourly_payout_discrepancies() TO authenticated;
