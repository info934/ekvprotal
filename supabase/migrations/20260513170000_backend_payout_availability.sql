-- Move payout availability and payout request writes behind backend RPCs.
-- The UI may still show preview calculations, but these functions are the
-- authoritative gate for creating/updating payout requests.

CREATE OR REPLACE FUNCTION public.get_payout_availability(
  p_member_id uuid,
  p_edit_payout_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_projects jsonb;
  v_realizations jsonb;
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

  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'member_id is required';
  END IF;

  IF NOT v_can_admin AND p_member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to read payout availability for this member';
  END IF;

  WITH edit_project_items AS (
    SELECT
      pi.project_id,
      COALESCE(SUM(pi.amount), 0)::numeric AS amount
    FROM public.payout_items pi
    WHERE p_edit_payout_id IS NOT NULL
      AND pi.payout_id = p_edit_payout_id
      AND pi.project_id IS NOT NULL
    GROUP BY pi.project_id
  )
  SELECT COALESCE(jsonb_agg(
    to_jsonb(p)
    || jsonb_build_object(
      'available_balance',
      COALESCE(p.available_balance, 0) + COALESCE(epi.amount, 0)
    )
    ORDER BY p.project_code
  ), '[]'::jsonb)
  INTO v_projects
  FROM public.get_projects_with_balance(p_member_id) p
  LEFT JOIN edit_project_items epi ON epi.project_id = p.project_id;

  WITH shares AS (
    SELECT realizace_id, share_type, share_value
    FROM public.realization_profit_shares
    WHERE member_id = p_member_id
  ),
  manual_costs AS (
    SELECT realizace_id, COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.realizace_costs
    GROUP BY realizace_id
  ),
  extra_costs AS (
    SELECT
      realizace_id,
      COALESCE(SUM(cost_amount), 0)::numeric AS cost_amount,
      COALESCE(SUM(sale_amount), 0)::numeric AS sale_amount
    FROM public.realizace_extra_costs
    GROUP BY realizace_id
  ),
  direct_attendance AS (
    SELECT
      a.realizace_id,
      COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.attendance a
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE a.realizace_id IS NOT NULL
    GROUP BY a.realizace_id
  ),
  linked_project_attendance AS (
    SELECT
      r.id AS realization_id,
      COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.realizations r
    JOIN public.attendance a ON a.project_id = r.linked_project_id
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE r.linked_project_id IS NOT NULL
    GROUP BY r.id
  ),
  reserved AS (
    SELECT
      pi.realization_id,
      COALESCE(SUM(pi.amount), 0)::numeric AS amount
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.realization_id IS NOT NULL
      AND po.member_id = p_member_id
      AND po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')
      AND (p_edit_payout_id IS NULL OR po.id <> p_edit_payout_id)
    GROUP BY pi.realization_id
  ),
  calculated AS (
    SELECT
      r.id,
      r.name,
      r.status,
      COALESCE(r.contract_amount, 0)::numeric AS base_contract_amount,
      COALESCE(ec.sale_amount, 0)::numeric AS extra_revenue,
      COALESCE(mc.amount, 0)::numeric AS manual_costs,
      (COALESCE(da.amount, 0) + COALESCE(lpa.amount, 0))::numeric AS hourly_costs,
      COALESCE(ec.cost_amount, 0)::numeric AS extra_costs,
      (COALESCE(mc.amount, 0) + COALESCE(da.amount, 0) + COALESCE(lpa.amount, 0) + COALESCE(ec.cost_amount, 0))::numeric AS total_costs,
      (COALESCE(r.contract_amount, 0) + COALESCE(ec.sale_amount, 0))::numeric AS total_revenue,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent,
      s.share_type,
      COALESCE(s.share_value, 0)::numeric AS share_value,
      COALESCE(res.amount, 0)::numeric AS reserved_or_paid_amount
    FROM public.realizations r
    LEFT JOIN shares s ON s.realizace_id = r.id
    LEFT JOIN manual_costs mc ON mc.realizace_id = r.id
    LEFT JOIN extra_costs ec ON ec.realizace_id = r.id
    LEFT JOIN direct_attendance da ON da.realizace_id = r.id
    LEFT JOIN linked_project_attendance lpa ON lpa.realization_id = r.id
    LEFT JOIN reserved res ON res.realization_id = r.id
    WHERE v_can_admin OR s.realizace_id IS NOT NULL
  ),
  budgets AS (
    SELECT
      c.*,
      (c.total_revenue * (c.profit_margin_percent / 100))::numeric AS profit_amount,
      (c.total_revenue * (c.overhead_percent / 100))::numeric AS overhead_amount,
      (
        c.total_revenue
        - (c.total_revenue * (c.profit_margin_percent / 100))
        - (c.total_revenue * (c.overhead_percent / 100))
        - c.total_costs
      )::numeric AS team_budget
    FROM calculated c
  ),
  shares_calculated AS (
    SELECT
      b.*,
      CASE
        WHEN b.share_type = 'fixed' THEN b.share_value
        WHEN b.share_type = 'percent' THEN GREATEST(0, b.team_budget * (b.share_value / 100))
        ELSE 0
      END::numeric AS total_share
    FROM budgets b
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'status', status,
      'base_contract_amount', base_contract_amount,
      'extra_revenue', extra_revenue,
      'manual_costs', manual_costs,
      'hourly_costs', hourly_costs,
      'extra_costs', extra_costs,
      'total_costs', total_costs,
      'total_revenue', total_revenue,
      'profit_margin_percent', profit_margin_percent,
      'overhead_percent', overhead_percent,
      'profit_amount', profit_amount,
      'overhead_amount', overhead_amount,
      'team_budget', team_budget,
      'share_type', share_type,
      'share_value', share_value,
      'total_share', total_share,
      'paid_amount', reserved_or_paid_amount,
      'reserved_or_paid_amount', reserved_or_paid_amount,
      'available_share', GREATEST(0, total_share - reserved_or_paid_amount),
      'availability_reason',
        CASE
          WHEN share_type IS NULL THEN 'Není nastaven podíl'
          WHEN team_budget <= 0 THEN 'Týmový rozpočet je nulový nebo záporný'
          WHEN total_share <= 0 THEN 'Podíl vychází na 0 Kč'
          WHEN reserved_or_paid_amount >= total_share THEN 'Podíl je už rezervovaný nebo vyplacený'
          WHEN GREATEST(0, total_share - reserved_or_paid_amount) > 0 THEN 'Dostupné k žádosti'
          ELSE 'Není dostupný zůstatek'
        END
    )
    ORDER BY name
  ), '[]'::jsonb)
  INTO v_realizations
  FROM shares_calculated;

  RETURN jsonb_build_object(
    'projects', v_projects,
    'realizations', v_realizations
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_payout_request_items(
  p_member_id uuid,
  p_items jsonb,
  p_edit_payout_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_availability jsonb;
  v_item jsonb;
  v_amount numeric;
  v_project_id uuid;
  v_realization_id uuid;
  v_available numeric;
  v_total numeric := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;

  v_availability := public.get_payout_availability(p_member_id, p_edit_payout_id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_amount := COALESCE((v_item->>'amount')::numeric, 0);
    v_project_id := NULLIF(v_item->>'project_id', '')::uuid;
    v_realization_id := NULLIF(v_item->>'realization_id', '')::uuid;

    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Payout item amount must be greater than 0';
    END IF;

    IF (v_project_id IS NULL AND v_realization_id IS NULL)
       OR (v_project_id IS NOT NULL AND v_realization_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Each payout item must reference exactly one project or realization';
    END IF;

    IF v_project_id IS NOT NULL THEN
      SELECT (item->>'available_balance')::numeric
      INTO v_available
      FROM jsonb_array_elements(v_availability->'projects') item
      WHERE (item->>'project_id')::uuid = v_project_id;

      IF v_available IS NULL THEN
        RAISE EXCEPTION 'Project is not available for payout: %', v_project_id;
      END IF;

      IF v_amount > v_available THEN
        RAISE EXCEPTION 'Project payout amount % exceeds available balance %', v_amount, v_available;
      END IF;
    ELSE
      SELECT (item->>'available_share')::numeric
      INTO v_available
      FROM jsonb_array_elements(v_availability->'realizations') item
      WHERE (item->>'id')::uuid = v_realization_id;

      IF v_available IS NULL THEN
        RAISE EXCEPTION 'Realization is not available for payout: %', v_realization_id;
      END IF;

      IF v_amount > v_available THEN
        RAISE EXCEPTION 'Realization payout amount % exceeds available share %', v_amount, v_available;
      END IF;
    END IF;

    v_total := v_total + v_amount;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Payout request total must be greater than 0';
  END IF;

  RETURN v_total;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.approve_payout(
  p_payout_id uuid,
  p_admin_note text DEFAULT NULL,
  p_approved_without_invoice boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
  v_variable_symbol text;
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

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to approve payout requests';
  END IF;

  SELECT *
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF v_payout.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot approve payout with status %. Must be pending.', v_payout.status;
  END IF;

  v_variable_symbol := COALESCE(
    v_payout.variable_symbol,
    LPAD(FLOOR(random() * 10000000000)::bigint::text, 10, '0')
  );

  UPDATE public.payouts
  SET
    status = 'approved',
    approved_by = v_current_member_id,
    approved_at = now(),
    admin_note = p_admin_note,
    approved_without_invoice = p_approved_without_invoice,
    variable_symbol = v_variable_symbol
  WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      CASE WHEN p_approved_without_invoice THEN 'payout_approved_without_invoice' ELSE 'payout_approved_with_invoice' END,
      jsonb_build_object(
        'payout_id', p_payout_id,
        'admin_note', p_admin_note,
        'approved_without_invoice', p_approved_without_invoice
      )
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payout(
  p_payout_id uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
BEGIN
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to reject payout requests';
  END IF;

  SELECT *
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF v_payout.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot reject payout with status %. Must be pending.', v_payout.status;
  END IF;

  UPDATE public.payouts
  SET
    status = 'rejected',
    admin_note = COALESCE(p_admin_note, admin_note)
  WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_rejected',
      jsonb_build_object('payout_id', p_payout_id, 'admin_note', p_admin_note)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.upload_payout_invoice(
  p_payout_id uuid,
  p_invoice_url text,
  p_invoice_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
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
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF NOT v_can_admin AND v_payout.member_id IS DISTINCT FROM v_current_member_id THEN
    RAISE EXCEPTION 'Not allowed to upload invoice for this payout request';
  END IF;

  IF v_payout.status <> 'approved' THEN
    RAISE EXCEPTION 'Cannot upload invoice for payout with status %. Must be approved.', v_payout.status;
  END IF;

  UPDATE public.payouts
  SET
    invoice_url = p_invoice_url,
    invoice_name = p_invoice_name,
    invoice_uploaded_at = now(),
    status = 'invoice_uploaded'
  WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_workflow_invoice_upload',
      jsonb_build_object('payout_id', p_payout_id, 'invoice_name', p_invoice_name)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payout_paid(
  p_payout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
BEGIN
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to mark payout requests as paid';
  END IF;

  SELECT *
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF v_payout.status = 'invoice_uploaded' THEN
    IF v_payout.invoice_url IS NULL THEN
      RAISE EXCEPTION 'Cannot confirm payment without uploaded invoice';
    END IF;
  ELSIF v_payout.status = 'approved' THEN
    IF COALESCE(v_payout.approved_without_invoice, false) = false THEN
      RAISE EXCEPTION 'Payout requires an uploaded invoice before payment';
    END IF;
  ELSE
    RAISE EXCEPTION 'Cannot mark payout with status % as paid.', v_payout.status;
  END IF;

  UPDATE public.payouts
  SET
    status = 'paid',
    paid_at = now()
  WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_workflow_mark_paid',
      jsonb_build_object('payout_id', p_payout_id)
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_payout_request(
  p_payout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
BEGIN
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to delete payout requests';
  END IF;

  SELECT *
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  DELETE FROM public.payout_items WHERE payout_id = p_payout_id;
  DELETE FROM public.payouts WHERE id = p_payout_id;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_deleted',
      jsonb_build_object(
        'payout_id', p_payout_id,
        'member_id', v_payout.member_id,
        'amount', v_payout.amount,
        'status', v_payout.status
      )
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_realization_financial_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_read boolean;
  v_result jsonb;
BEGIN
  v_can_read := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module IN ('realizace', 'projects', 'finance', 'reports')
        AND (rp.can_read = true OR rp.can_edit = true OR rp.can_admin = true)
    );

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'Not allowed to read realization financial overview';
  END IF;

  WITH manual_costs AS (
    SELECT realizace_id, COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.realizace_costs
    GROUP BY realizace_id
  ),
  extra_costs AS (
    SELECT
      realizace_id,
      COALESCE(SUM(cost_amount), 0)::numeric AS cost_amount,
      COALESCE(SUM(sale_amount), 0)::numeric AS sale_amount
    FROM public.realizace_extra_costs
    GROUP BY realizace_id
  ),
  direct_attendance AS (
    SELECT
      a.realizace_id,
      COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.attendance a
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE a.realizace_id IS NOT NULL
    GROUP BY a.realizace_id
  ),
  linked_project_attendance AS (
    SELECT
      r.id AS realization_id,
      COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.realizations r
    JOIN public.attendance a ON a.project_id = r.linked_project_id
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE r.linked_project_id IS NOT NULL
    GROUP BY r.id
  ),
  calculated AS (
    SELECT
      r.id,
      (COALESCE(r.contract_amount, 0) + COALESCE(ec.sale_amount, 0))::numeric AS total_revenue,
      (COALESCE(mc.amount, 0) + COALESCE(ec.cost_amount, 0) + COALESCE(da.amount, 0) + COALESCE(lpa.amount, 0))::numeric AS total_costs,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent
    FROM public.realizations r
    LEFT JOIN manual_costs mc ON mc.realizace_id = r.id
    LEFT JOIN extra_costs ec ON ec.realizace_id = r.id
    LEFT JOIN direct_attendance da ON da.realizace_id = r.id
    LEFT JOIN linked_project_attendance lpa ON lpa.realization_id = r.id
  ),
  budgets AS (
    SELECT
      id,
      total_revenue,
      total_costs,
      (total_revenue * (profit_margin_percent / 100))::numeric AS profit_amount,
      (total_revenue * (overhead_percent / 100))::numeric AS overhead_amount,
      (
        total_revenue
        - (total_revenue * (profit_margin_percent / 100))
        - (total_revenue * (overhead_percent / 100))
        - total_costs
      )::numeric AS team_budget
    FROM calculated
  )
  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(total_revenue), 0),
    'total_costs', COALESCE(SUM(total_costs), 0),
    'total_profit', COALESCE(SUM(profit_amount), 0),
    'total_overhead', COALESCE(SUM(overhead_amount), 0),
    'total_distribution', COALESCE(SUM(team_budget), 0),
    'realization_count', COALESCE(COUNT(*), 0)
  )
  INTO v_result
  FROM budgets;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_overhead_allocation_status(
  p_allocation_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_allocation public.overhead_monthly_allocations%rowtype;
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
    RAISE EXCEPTION 'Not allowed to change overhead allocation status';
  END IF;

  IF p_status NOT IN ('DRAFT', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Unsupported overhead allocation status %. Use dedicated approve/reopen functions for accounting transitions.', p_status;
  END IF;

  SELECT *
  INTO v_allocation
  FROM public.overhead_monthly_allocations
  WHERE id = p_allocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overhead allocation not found';
  END IF;

  IF v_allocation.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved overhead allocation must be reopened before status changes';
  END IF;

  UPDATE public.overhead_monthly_allocations
  SET
    status = p_status,
    notes = p_notes,
    updated_by = auth.uid()
  WHERE id = p_allocation_id
  RETURNING * INTO v_allocation;

  INSERT INTO public.overhead_audit_logs (
    monthly_allocation_id,
    user_id,
    user_email,
    action,
    details
  )
  VALUES (
    p_allocation_id,
    auth.uid(),
    auth.jwt() ->> 'email',
    COALESCE(p_action, 'Změna stavu režijní alokace'),
    jsonb_build_object('newStatus', p_status, 'notes', p_notes)
  );

  RETURN to_jsonb(v_allocation);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_overhead_allocation(
  p_allocation_id uuid,
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
    RAISE EXCEPTION 'Not allowed to approve overhead allocations';
  END IF;

  SELECT *
  INTO v_allocation
  FROM public.overhead_monthly_allocations
  WHERE id = p_allocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overhead allocation not found';
  END IF;

  IF v_allocation.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Cannot approve overhead allocation with status %. Must be PENDING_APPROVAL.', v_allocation.status;
  END IF;

  DELETE FROM public.project_overhead_costs poc
  USING public.overhead_allocation_items item
  WHERE poc.overhead_allocation_item_id = item.id
    AND item.overhead_monthly_allocation_id = p_allocation_id;

  INSERT INTO public.project_overhead_costs (
    project_id,
    overhead_allocation_item_id,
    amount,
    month
  )
  SELECT
    item.project_id,
    item.id,
    item.amount_allocated,
    v_allocation.month
  FROM public.overhead_allocation_items item
  WHERE item.overhead_monthly_allocation_id = p_allocation_id
    AND COALESCE(item.amount_allocated, 0) > 0;

  UPDATE public.overhead_monthly_allocations
  SET
    status = 'APPROVED',
    notes = p_notes,
    updated_by = auth.uid()
  WHERE id = p_allocation_id
  RETURNING * INTO v_allocation;

  INSERT INTO public.overhead_audit_logs (
    monthly_allocation_id,
    user_id,
    user_email,
    action,
    details
  )
  VALUES (
    p_allocation_id,
    auth.uid(),
    auth.jwt() ->> 'email',
    'Schváleno a zaúčtováno',
    jsonb_build_object('newStatus', 'APPROVED', 'notes', p_notes)
  );

  RETURN to_jsonb(v_allocation);
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_overhead_allocation(
  p_allocation_id uuid,
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
    RAISE EXCEPTION 'Not allowed to reopen overhead allocations';
  END IF;

  SELECT *
  INTO v_allocation
  FROM public.overhead_monthly_allocations
  WHERE id = p_allocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overhead allocation not found';
  END IF;

  DELETE FROM public.project_overhead_costs poc
  USING public.overhead_allocation_items item
  WHERE poc.overhead_allocation_item_id = item.id
    AND item.overhead_monthly_allocation_id = p_allocation_id;

  UPDATE public.overhead_monthly_allocations
  SET
    status = 'DRAFT',
    notes = p_notes,
    updated_by = auth.uid()
  WHERE id = p_allocation_id
  RETURNING * INTO v_allocation;

  INSERT INTO public.overhead_audit_logs (
    monthly_allocation_id,
    user_id,
    user_email,
    action,
    details
  )
  VALUES (
    p_allocation_id,
    auth.uid(),
    auth.jwt() ->> 'email',
    'Znovuotevřeno a zaúčtování zrušeno',
    jsonb_build_object('newStatus', 'DRAFT', 'notes', p_notes)
  );

  RETURN to_jsonb(v_allocation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_payout_availability(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_payout_request_items(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_payout_request(uuid, date, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_payout_request(uuid, uuid, date, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_payout(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_payout(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upload_payout_invoice(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_payout_paid(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_payout_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_realization_financial_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_overhead_allocation_status(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_overhead_allocation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_overhead_allocation(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_payout_availability(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_request(uuid, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_payout_request(uuid, uuid, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payout(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upload_payout_invoice(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payout_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_realization_financial_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_overhead_allocation_status(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_overhead_allocation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_overhead_allocation(uuid, text) TO authenticated;
