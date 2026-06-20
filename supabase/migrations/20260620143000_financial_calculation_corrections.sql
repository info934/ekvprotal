-- Correct CRM discount totals and project payout availability calculations.

CREATE OR REPLACE FUNCTION public.replace_crm_opportunity_items(
  p_opportunity_id uuid,
  p_items jsonb,
  p_sync_documents boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
  v_document_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_edit_crm() THEN
    RAISE EXCEPTION 'CRM edit permission required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_opportunities WHERE id = p_opportunity_id) THEN
    RAISE EXCEPTION 'CRM opportunity % not found', p_opportunity_id;
  END IF;

  DROP TABLE IF EXISTS pg_temp.crm_rpc_items;
  CREATE TEMP TABLE crm_rpc_items ON COMMIT DROP AS
  SELECT
    row_number() OVER () AS row_number,
    NULLIF(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) AS catalog_item_id,
    NULLIF(BTRIM(item.code), '') AS code,
    COALESCE(NULLIF(BTRIM(item.name), ''), 'Položka') AS name,
    NULLIF(BTRIM(item.description), '') AS description,
    COALESCE(item.quantity, 0)::numeric AS quantity,
    COALESCE(NULLIF(BTRIM(item.unit), ''), 'ks') AS unit,
    COALESCE(item.unit_price, 0)::numeric AS unit_price,
    LEAST(100, GREATEST(0, COALESCE(item.discount_percent, 0)))::numeric AS discount_percent,
    COALESCE(item.vat_rate, 0)::numeric AS vat_rate,
    NULLIF(BTRIM(item.product_sku), '') AS product_sku,
    NULLIF(BTRIM(item.product_type), '') AS product_type,
    item.stock_available_snapshot::numeric AS stock_available_snapshot,
    item.catalog_price_snapshot::numeric AS catalog_price_snapshot,
    COALESCE(item.sort_order, row_number() OVER () * 10)::integer AS sort_order
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  DELETE FROM public.crm_opportunity_items
  WHERE opportunity_id = p_opportunity_id;

  INSERT INTO public.crm_opportunity_items (
    opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, discount_percent, vat_rate, line_total, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  )
  SELECT
    p_opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, discount_percent, vat_rate,
    ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  FROM crm_rpc_items
  ORDER BY sort_order, row_number;

  SELECT
    COALESCE(SUM(ROUND(quantity * unit_price, 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price, 2) - ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  INTO v_subtotal, v_discount_total, v_total, v_tax_total
  FROM crm_rpc_items;

  v_subtotal := ROUND(v_subtotal, 2);
  v_discount_total := ROUND(v_discount_total, 2);
  v_total := ROUND(v_total, 2);
  v_tax_total := ROUND(v_tax_total, 2);

  UPDATE public.crm_opportunities
  SET value = v_total,
      updated_at = now()
  WHERE id = p_opportunity_id;

  IF p_sync_documents THEN
    SELECT COALESCE(array_agg(id), '{}')
    INTO v_document_ids
    FROM public.crm_commercial_documents
    WHERE opportunity_id = p_opportunity_id
      AND COALESCE(sync_items, true) = true;

    DELETE FROM public.crm_commercial_document_items
    WHERE document_id = ANY(v_document_ids);

    INSERT INTO public.crm_commercial_document_items (
      document_id, catalog_item_id, code, name, description, quantity, unit,
      unit_price, discount_percent, vat_rate, line_total, sort_order,
      product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
    )
    SELECT
      document_id, item.catalog_item_id, item.code, item.name, item.description,
      item.quantity, item.unit, item.unit_price, item.discount_percent,
      item.vat_rate,
      ROUND(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2),
      item.sort_order, item.product_sku, item.product_type,
      item.stock_available_snapshot, item.catalog_price_snapshot
    FROM unnest(v_document_ids) AS document_id
    CROSS JOIN crm_rpc_items item
    ORDER BY document_id, item.sort_order, item.row_number;

    UPDATE public.crm_commercial_documents
    SET subtotal = v_subtotal,
        discount_total = v_discount_total,
        tax_total = v_tax_total,
        total = v_total,
        updated_at = now()
    WHERE id = ANY(v_document_ids);
  END IF;

  RETURN jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'item_count', (SELECT COUNT(*) FROM crm_rpc_items),
    'document_count', COALESCE(array_length(v_document_ids, 1), 0),
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_crm_document_items(
  p_document_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_edit_crm() THEN
    RAISE EXCEPTION 'CRM edit permission required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_commercial_documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'CRM commercial document % not found', p_document_id;
  END IF;

  DROP TABLE IF EXISTS pg_temp.crm_rpc_items;
  CREATE TEMP TABLE crm_rpc_items ON COMMIT DROP AS
  SELECT
    row_number() OVER () AS row_number,
    NULLIF(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) AS catalog_item_id,
    NULLIF(BTRIM(item.code), '') AS code,
    COALESCE(NULLIF(BTRIM(item.name), ''), 'Položka') AS name,
    NULLIF(BTRIM(item.description), '') AS description,
    COALESCE(item.quantity, 0)::numeric AS quantity,
    COALESCE(NULLIF(BTRIM(item.unit), ''), 'ks') AS unit,
    COALESCE(item.unit_price, 0)::numeric AS unit_price,
    LEAST(100, GREATEST(0, COALESCE(item.discount_percent, 0)))::numeric AS discount_percent,
    COALESCE(item.vat_rate, 0)::numeric AS vat_rate,
    NULLIF(BTRIM(item.product_sku), '') AS product_sku,
    NULLIF(BTRIM(item.product_type), '') AS product_type,
    item.stock_available_snapshot::numeric AS stock_available_snapshot,
    item.catalog_price_snapshot::numeric AS catalog_price_snapshot,
    COALESCE(item.sort_order, row_number() OVER () * 10)::integer AS sort_order
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  DELETE FROM public.crm_commercial_document_items
  WHERE document_id = p_document_id;

  INSERT INTO public.crm_commercial_document_items (
    document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, discount_percent, vat_rate, line_total, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  )
  SELECT
    p_document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, discount_percent, vat_rate,
    ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  FROM crm_rpc_items
  ORDER BY sort_order, row_number;

  SELECT
    COALESCE(SUM(ROUND(quantity * unit_price, 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price, 2) - ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  INTO v_subtotal, v_discount_total, v_total, v_tax_total
  FROM crm_rpc_items;

  v_subtotal := ROUND(v_subtotal, 2);
  v_discount_total := ROUND(v_discount_total, 2);
  v_total := ROUND(v_total, 2);
  v_tax_total := ROUND(v_tax_total, 2);

  UPDATE public.crm_commercial_documents
  SET subtotal = v_subtotal,
      discount_total = v_discount_total,
      tax_total = v_tax_total,
      total = v_total,
      updated_at = now()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'item_count', (SELECT COUNT(*) FROM crm_rpc_items),
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.project_financial_summary(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_is_project_member boolean;
  v_summary jsonb;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'projects'
        AND rp.can_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  v_is_project_member := EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.member_id = v_current_member_id
  );

  IF NOT v_can_admin AND NOT v_is_project_member THEN
    RAISE EXCEPTION 'Not allowed to read financial summary for this project';
  END IF;

  WITH project_base AS (
    SELECT
      p.id,
      p.name,
      p.code,
      p.status,
      COALESCE(p.price, 0)::numeric AS price,
      COALESCE(p.budget_percentage, 0)::numeric AS budget_percentage,
      COALESCE(p.overhead_percentage, 0)::numeric AS overhead_percentage
    FROM public.projects p
    WHERE p.id = p_project_id
  ),
  costs AS (
    SELECT
      COALESCE(SUM(pc.amount), 0)::numeric AS direct_costs,
      COALESCE(SUM(pc.amount) FILTER (WHERE COALESCE(pc.is_attendance_cost, false)), 0)::numeric AS attendance_costs,
      COALESCE(SUM(pc.amount) FILTER (WHERE NOT COALESCE(pc.is_attendance_cost, false)), 0)::numeric AS manual_costs
    FROM public.project_costs pc
    WHERE pc.project_id = p_project_id
  ),
  subcontractors AS (
    SELECT COALESCE(SUM(ps.price), 0)::numeric AS subcontractor_costs
    FROM public.project_subcontractors ps
    WHERE ps.project_id = p_project_id
  ),
  overhead_costs AS (
    SELECT COALESCE(SUM(poc.amount), 0)::numeric AS allocated_overhead_costs
    FROM public.project_overhead_costs poc
    WHERE poc.project_id = p_project_id
  ),
  payouts AS (
    SELECT
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')), 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_payouts
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.project_id = p_project_id
  ),
  members AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'member_id', pm.member_id,
        'member_name', m.name,
        'reward_type', pm.reward_type,
        'reward_percentage', COALESCE(pm.reward_percentage, 0),
        'reward_amount', COALESCE(pm.reward_amount, 0),
        'is_hourly', COALESCE(pm.is_hourly, false)
      )
      ORDER BY m.name
    ), '[]'::jsonb) AS member_rewards
    FROM public.project_members pm
    LEFT JOIN public.members m ON m.id = pm.member_id
    WHERE pm.project_id = p_project_id
  ),
  calculated AS (
    SELECT
      pb.*,
      (pb.price * (pb.budget_percentage / 100))::numeric AS gross_project_budget,
      (pb.price * (pb.budget_percentage / 100) * (pb.overhead_percentage / 100))::numeric AS planned_overhead_amount,
      COALESCE(c.direct_costs, 0)::numeric AS direct_costs,
      COALESCE(c.manual_costs, 0)::numeric AS manual_costs,
      COALESCE(c.attendance_costs, 0)::numeric AS attendance_costs,
      COALESCE(s.subcontractor_costs, 0)::numeric AS subcontractor_costs,
      COALESCE(oc.allocated_overhead_costs, 0)::numeric AS allocated_overhead_costs,
      COALESCE(pay.reserved_or_paid_payouts, 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(pay.paid_payouts, 0)::numeric AS paid_payouts,
      COALESCE(m.member_rewards, '[]'::jsonb) AS member_rewards
    FROM project_base pb
    CROSS JOIN costs c
    CROSS JOIN subcontractors s
    CROSS JOIN overhead_costs oc
    CROSS JOIN payouts pay
    CROSS JOIN members m
  ),
  budgets AS (
    SELECT
      c.*,
      (gross_project_budget - planned_overhead_amount - subcontractor_costs)::numeric AS team_budget,
      (gross_project_budget - planned_overhead_amount - subcontractor_costs - direct_costs - allocated_overhead_costs)::numeric AS remaining_after_costs
    FROM calculated c
  )
  SELECT jsonb_build_object(
    'project_id', id,
    'project_name', name,
    'project_code', code,
    'project_status', status,
    'price', price,
    'budget_percentage', budget_percentage,
    'overhead_percentage', overhead_percentage,
    'gross_project_budget', gross_project_budget,
    'planned_margin', price - gross_project_budget,
    'planned_overhead_amount', planned_overhead_amount,
    'manual_costs', manual_costs,
    'attendance_costs', attendance_costs,
    'direct_costs', direct_costs,
    'subcontractor_costs', subcontractor_costs,
    'allocated_overhead_costs', allocated_overhead_costs,
    'operational_costs', direct_costs + subcontractor_costs + allocated_overhead_costs,
    'team_budget', team_budget,
    'cost_adjusted_team_budget', remaining_after_costs,
    'remaining_after_costs', remaining_after_costs,
    'reserved_or_paid_payouts', reserved_or_paid_payouts,
    'paid_payouts', paid_payouts,
    'member_rewards', member_rewards
  )
  INTO v_summary
  FROM budgets;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  RETURN v_summary;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_project_rewards(p_member_id uuid DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  project_id uuid,
  project_name text,
  project_code text,
  project_status text,
  reward_type text,
  reward_percentage numeric,
  reward_fixed_amount numeric,
  is_hourly boolean,
  team_budget numeric,
  total_reward numeric,
  reserved_or_paid_amount numeric,
  paid_amount numeric,
  available_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module IN ('members', 'projects', 'payouts')
        AND rp.can_admin = true
    );

  IF p_member_id IS NULL AND NOT v_can_admin THEN
    p_member_id := v_current_member_id;
  END IF;

  IF p_member_id IS NOT NULL
    AND p_member_id <> v_current_member_id
    AND NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to read project rewards for this member';
  END IF;

  RETURN QUERY
  WITH project_cost_inputs AS (
    SELECT
      p.id AS project_id,
      p.name AS project_name,
      p.code AS project_code,
      p.status AS project_status,
      COALESCE(p.price, 0)::numeric AS price,
      COALESCE(p.budget_percentage, 0)::numeric AS budget_percentage,
      COALESCE(p.overhead_percentage, 0)::numeric AS overhead_percentage,
      COALESCE((SELECT SUM(ps.price) FROM public.project_subcontractors ps WHERE ps.project_id = p.id), 0)::numeric AS subcontractor_costs,
      COALESCE((SELECT SUM(pc.amount) FROM public.project_costs pc WHERE pc.project_id = p.id), 0)::numeric AS direct_costs,
      COALESCE((SELECT SUM(poc.amount) FROM public.project_overhead_costs poc WHERE poc.project_id = p.id), 0)::numeric AS allocated_overhead_costs
    FROM public.projects p
  ),
  reward_base AS (
    SELECT
      pm.member_id,
      pci.project_id,
      pci.project_name,
      pci.project_code,
      pci.project_status,
      pm.reward_type,
      COALESCE(pm.reward_percentage, 0)::numeric AS reward_percentage,
      COALESCE(pm.reward_amount, 0)::numeric AS reward_fixed_amount,
      COALESCE(pm.is_hourly, false) AS is_hourly,
      (
        (pci.price * (pci.budget_percentage / 100))
        - (pci.price * (pci.budget_percentage / 100) * (pci.overhead_percentage / 100))
        - pci.subcontractor_costs
      )::numeric AS planned_team_budget,
      (
        (pci.price * (pci.budget_percentage / 100))
        - (pci.price * (pci.budget_percentage / 100) * (pci.overhead_percentage / 100))
        - pci.subcontractor_costs
        - pci.direct_costs
        - pci.allocated_overhead_costs
      )::numeric AS cost_adjusted_team_budget
    FROM public.project_members pm
    JOIN project_cost_inputs pci ON pci.project_id = pm.project_id
    WHERE p_member_id IS NULL OR pm.member_id = p_member_id
  ),
  payout_sums AS (
    SELECT
      po.member_id,
      pi.project_id,
      COALESCE(SUM(pi.amount) FILTER (
        WHERE po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')
      ), 0)::numeric AS reserved_or_paid_amount,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_amount
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.project_id IS NOT NULL
      AND (p_member_id IS NULL OR po.member_id = p_member_id)
    GROUP BY po.member_id, pi.project_id
  ),
  calculated AS (
    SELECT
      rb.*,
      CASE
        WHEN rb.reward_type = 'fixed' THEN LEAST(rb.reward_fixed_amount, GREATEST(0, rb.cost_adjusted_team_budget))
        WHEN rb.reward_type = 'percentage' THEN GREATEST(0, rb.cost_adjusted_team_budget) * (rb.reward_percentage / 100)
        ELSE 0
      END::numeric AS calculated_reward,
      COALESCE(ps.reserved_or_paid_amount, 0)::numeric AS reserved_or_paid_amount,
      COALESCE(ps.paid_amount, 0)::numeric AS paid_amount
    FROM reward_base rb
    LEFT JOIN payout_sums ps
      ON ps.member_id = rb.member_id
     AND ps.project_id = rb.project_id
  )
  SELECT
    c.member_id,
    c.project_id,
    c.project_name,
    c.project_code,
    c.project_status,
    c.reward_type,
    c.reward_percentage,
    c.reward_fixed_amount,
    c.is_hourly,
    c.planned_team_budget AS team_budget,
    c.calculated_reward AS total_reward,
    c.reserved_or_paid_amount,
    c.paid_amount,
    GREATEST(0, c.calculated_reward - c.reserved_or_paid_amount) AS available_balance
  FROM calculated c
  ORDER BY c.project_code NULLS LAST, c.project_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_crm_opportunity_items(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_crm_document_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO service_role;
