CREATE OR REPLACE FUNCTION public.save_overhead_allocation_draft(
  p_month text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_allocation public.overhead_monthly_allocations%rowtype;
  v_item_count integer;
BEGIN
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'finance'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to save overhead allocation drafts';
  END IF;

  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid overhead allocation month: %', COALESCE(p_month, '(null)');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  INSERT INTO public.overhead_monthly_allocations (
    month,
    status,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    p_month,
    'DRAFT',
    p_notes,
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (month) DO UPDATE
  SET updated_by = auth.uid()
  RETURNING * INTO v_allocation;

  SELECT *
  INTO v_allocation
  FROM public.overhead_monthly_allocations
  WHERE id = v_allocation.id
  FOR UPDATE;

  IF v_allocation.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved overhead allocation must be reopened before draft changes';
  END IF;

  WITH parsed_items AS (
    SELECT
      overhead_cost_id,
      project_id,
      amount_allocated,
      percentage_share
    FROM jsonb_to_recordset(p_items) AS item(
      overhead_cost_id uuid,
      project_id uuid,
      amount_allocated numeric,
      percentage_share numeric
    )
    WHERE COALESCE(amount_allocated, 0) > 0
  )
  DELETE FROM public.overhead_allocation_items existing
  WHERE existing.overhead_monthly_allocation_id = v_allocation.id
    AND NOT EXISTS (
      SELECT 1
      FROM parsed_items parsed
      WHERE parsed.overhead_cost_id = existing.overhead_cost_id
        AND parsed.project_id = existing.project_id
    );

  WITH parsed_items AS (
    SELECT
      overhead_cost_id,
      project_id,
      amount_allocated,
      percentage_share
    FROM jsonb_to_recordset(p_items) AS item(
      overhead_cost_id uuid,
      project_id uuid,
      amount_allocated numeric,
      percentage_share numeric
    )
    WHERE COALESCE(amount_allocated, 0) > 0
  )
  INSERT INTO public.overhead_allocation_items (
    overhead_monthly_allocation_id,
    overhead_cost_id,
    project_id,
    amount_allocated,
    percentage_share
  )
  SELECT
    v_allocation.id,
    overhead_cost_id,
    project_id,
    amount_allocated,
    percentage_share
  FROM parsed_items
  ON CONFLICT (overhead_monthly_allocation_id, overhead_cost_id, project_id)
  DO UPDATE SET
    amount_allocated = EXCLUDED.amount_allocated,
    percentage_share = EXCLUDED.percentage_share;

  SELECT COUNT(*)
  INTO v_item_count
  FROM jsonb_to_recordset(p_items) AS item(
    overhead_cost_id uuid,
    project_id uuid,
    amount_allocated numeric,
    percentage_share numeric
  )
  WHERE COALESCE(amount_allocated, 0) > 0;

  UPDATE public.overhead_monthly_allocations
  SET
    notes = COALESCE(p_notes, notes),
    updated_by = auth.uid()
  WHERE id = v_allocation.id
  RETURNING * INTO v_allocation;

  INSERT INTO public.overhead_audit_logs (
    monthly_allocation_id,
    user_id,
    user_email,
    action,
    details
  )
  VALUES (
    v_allocation.id,
    auth.uid(),
    auth.jwt() ->> 'email',
    'Uložen koncept režijní alokace',
    jsonb_build_object('month', p_month, 'itemCount', v_item_count, 'notes', p_notes)
  );

  RETURN to_jsonb(v_allocation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_overhead_allocation_draft(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_overhead_allocation_draft(text, jsonb, text) TO authenticated;
