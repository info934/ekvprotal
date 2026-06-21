-- Separate payout reservations from paid payout costs.
-- Reservations block duplicate payout requests, but only paid payouts affect
-- project/realization financial cost results.

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
        AND rp.module IN ('projects', 'payouts', 'finance')
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
  payout_sums AS (
    SELECT
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded')), 0)::numeric AS reserved_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_task_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')), 0)::numeric AS reserved_or_paid_payouts
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.project_id = p_project_id
  ),
  paid_hourly AS (
    SELECT COALESCE(SUM(COALESCE((entry.value->>'hours')::numeric, 0) * COALESCE(h.hourly_rate, 0)), 0)::numeric AS paid_hourly_payouts
    FROM public.hourly_payout_requests h
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.attendance_snapshot, '[]'::jsonb)) entry(value)
    WHERE h.status = 'paid'
      AND NULLIF(entry.value->>'project_id', '')::uuid = p_project_id
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
      COALESCE(pay.reserved_payouts, 0)::numeric AS reserved_payouts,
      COALESCE(pay.paid_task_payouts, 0)::numeric AS paid_task_payouts,
      COALESCE(ph.paid_hourly_payouts, 0)::numeric AS paid_hourly_payouts,
      COALESCE(pay.reserved_or_paid_payouts, 0)::numeric + COALESCE(ph.paid_hourly_payouts, 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(m.member_rewards, '[]'::jsonb) AS member_rewards
    FROM project_base pb
    CROSS JOIN costs c
    CROSS JOIN subcontractors s
    CROSS JOIN overhead_costs oc
    CROSS JOIN payout_sums pay
    CROSS JOIN paid_hourly ph
    CROSS JOIN members m
  ),
  budgets AS (
    SELECT
      c.*,
      (gross_project_budget - planned_overhead_amount - subcontractor_costs)::numeric AS planned_team_budget,
      (direct_costs + subcontractor_costs + allocated_overhead_costs)::numeric AS operational_costs,
      (paid_task_payouts + paid_hourly_payouts)::numeric AS paid_payout_costs
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
    'operational_costs', operational_costs,
    'team_budget', planned_team_budget,
    'planned_team_budget', planned_team_budget,
    'cost_adjusted_team_budget', planned_team_budget - direct_costs - allocated_overhead_costs,
    'remaining_after_costs', planned_team_budget - direct_costs - allocated_overhead_costs,
    'costs_before_paid_payouts', operational_costs,
    'paid_task_payouts', paid_task_payouts,
    'paid_hourly_payouts', paid_hourly_payouts,
    'paid_payout_costs', paid_payout_costs,
    'paid_payouts', paid_task_payouts,
    'reserved_payouts', reserved_payouts,
    'reserved_or_paid_payouts', reserved_or_paid_payouts,
    'costs_after_paid_payouts', operational_costs + paid_payout_costs,
    'team_budget_after_paid_payouts', planned_team_budget - direct_costs - allocated_overhead_costs - paid_payout_costs,
    'available_for_payout', GREATEST(0, planned_team_budget - direct_costs - allocated_overhead_costs - paid_payout_costs - reserved_payouts),
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

CREATE OR REPLACE FUNCTION public.realization_financial_summary(p_realization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_is_realization_member boolean;
  v_summary jsonb;
BEGIN
  IF p_realization_id IS NULL THEN
    RAISE EXCEPTION 'realization_id is required';
  END IF;

  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module IN ('realizace', 'realizations', 'payouts', 'finance')
        AND rp.can_admin = true
    );

  v_is_realization_member := EXISTS (
    SELECT 1
    FROM public.realization_profit_shares rps
    WHERE rps.realizace_id = p_realization_id
      AND rps.member_id = v_current_member_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.realizations r
    WHERE r.id = p_realization_id
      AND (
        r.lead_person_id = v_current_member_id
        OR v_current_member_id = ANY(COALESCE(r.team_members, ARRAY[]::uuid[]))
      )
  );

  IF NOT v_can_admin AND NOT v_is_realization_member THEN
    RAISE EXCEPTION 'Not allowed to read financial summary for this realization';
  END IF;

  WITH manual_costs AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.realizace_costs
    WHERE realizace_id = p_realization_id
  ),
  extra_costs AS (
    SELECT
      COALESCE(SUM(cost_amount), 0)::numeric AS cost_amount,
      COALESCE(SUM(sale_amount), 0)::numeric AS sale_amount
    FROM public.realizace_extra_costs
    WHERE realizace_id = p_realization_id
  ),
  attendance_exposure AS (
    SELECT COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.attendance a
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE a.realizace_id = p_realization_id
  ),
  linked_project_attendance_exposure AS (
    SELECT COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.realizations r
    JOIN public.attendance a ON a.project_id = r.linked_project_id
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE r.id = p_realization_id
      AND r.linked_project_id IS NOT NULL
  ),
  payout_sums AS (
    SELECT
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded')), 0)::numeric AS reserved_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_task_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')), 0)::numeric AS reserved_or_paid_payouts
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.realization_id = p_realization_id
  ),
  paid_hourly AS (
    SELECT COALESCE(SUM(COALESCE((entry.value->>'hours')::numeric, 0) * COALESCE(h.hourly_rate, 0)), 0)::numeric AS paid_hourly_payouts
    FROM public.hourly_payout_requests h
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.attendance_snapshot, '[]'::jsonb)) entry(value)
    WHERE h.status = 'paid'
      AND NULLIF(entry.value->>'realizace_id', '')::uuid = p_realization_id
  ),
  shares AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'member_id', rps.member_id,
        'member_name', m.name,
        'share_type', rps.share_type,
        'share_value', COALESCE(rps.share_value, 0)
      )
      ORDER BY m.name
    ), '[]'::jsonb) AS member_shares
    FROM public.realization_profit_shares rps
    LEFT JOIN public.members m ON m.id = rps.member_id
    WHERE rps.realizace_id = p_realization_id
  ),
  calculated AS (
    SELECT
      r.id,
      r.name,
      r.status,
      r.linked_project_id,
      COALESCE(r.contract_amount, 0)::numeric AS base_contract_amount,
      COALESCE(ec.sale_amount, 0)::numeric AS extra_revenue,
      COALESCE(mc.amount, 0)::numeric AS manual_costs,
      (COALESCE(ae.amount, 0) + COALESCE(lpae.amount, 0))::numeric AS hourly_costs,
      (COALESCE(ae.amount, 0) + COALESCE(lpae.amount, 0))::numeric AS hourly_payout_exposure,
      COALESCE(ec.cost_amount, 0)::numeric AS extra_costs,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent,
      COALESCE(pay.reserved_payouts, 0)::numeric AS reserved_payouts,
      COALESCE(pay.paid_task_payouts, 0)::numeric AS paid_task_payouts,
      COALESCE(ph.paid_hourly_payouts, 0)::numeric AS paid_hourly_payouts,
      COALESCE(pay.reserved_or_paid_payouts, 0)::numeric + COALESCE(ph.paid_hourly_payouts, 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(s.member_shares, '[]'::jsonb) AS member_shares
    FROM public.realizations r
    CROSS JOIN manual_costs mc
    CROSS JOIN extra_costs ec
    CROSS JOIN attendance_exposure ae
    CROSS JOIN linked_project_attendance_exposure lpae
    CROSS JOIN payout_sums pay
    CROSS JOIN paid_hourly ph
    CROSS JOIN shares s
    WHERE r.id = p_realization_id
  ),
  budgets AS (
    SELECT
      c.*,
      (c.base_contract_amount + c.extra_revenue)::numeric AS total_revenue,
      (c.manual_costs + c.extra_costs)::numeric AS operational_costs,
      (c.paid_task_payouts + c.paid_hourly_payouts)::numeric AS paid_payout_costs
    FROM calculated c
  )
  SELECT jsonb_build_object(
    'realization_id', id,
    'realization_name', name,
    'realization_status', status,
    'linked_project_id', linked_project_id,
    'base_contract_amount', base_contract_amount,
    'extra_revenue', extra_revenue,
    'total_revenue', total_revenue,
    'manual_costs', manual_costs,
    'hourly_costs', hourly_costs,
    'hourly_payout_exposure', hourly_payout_exposure,
    'extra_costs', extra_costs,
    'operational_costs', operational_costs,
    'total_costs', operational_costs,
    'costs_before_paid_payouts', operational_costs,
    'paid_task_payouts', paid_task_payouts,
    'paid_hourly_payouts', paid_hourly_payouts,
    'paid_payout_costs', paid_payout_costs,
    'paid_payouts', paid_task_payouts,
    'reserved_payouts', reserved_payouts,
    'reserved_or_paid_payouts', reserved_or_paid_payouts,
    'costs_after_paid_payouts', operational_costs + paid_payout_costs,
    'profit_margin_percent', profit_margin_percent,
    'overhead_percent', overhead_percent,
    'profit_amount', total_revenue * (profit_margin_percent / 100),
    'overhead_amount', total_revenue * (overhead_percent / 100),
    'team_budget',
      total_revenue
      - (total_revenue * (profit_margin_percent / 100))
      - (total_revenue * (overhead_percent / 100))
      - operational_costs,
    'team_budget_after_paid_payouts',
      total_revenue
      - (total_revenue * (profit_margin_percent / 100))
      - (total_revenue * (overhead_percent / 100))
      - operational_costs
      - paid_payout_costs,
    'available_for_payout',
      GREATEST(
        0,
        total_revenue
        - (total_revenue * (profit_margin_percent / 100))
        - (total_revenue * (overhead_percent / 100))
        - operational_costs
        - paid_payout_costs
        - reserved_payouts
      ),
    'member_shares', member_shares
  )
  INTO v_summary
  FROM budgets;

  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Realization not found';
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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
    IF v_current_member_id IS NULL THEN
      RAISE EXCEPTION 'Member profile not found';
    END IF;
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
      COALESCE((SELECT SUM(poc.amount) FROM public.project_overhead_costs poc WHERE poc.project_id = p.id), 0)::numeric AS allocated_overhead_costs,
      COALESCE((
        SELECT SUM(pi.amount)
        FROM public.payout_items pi
        JOIN public.payouts po ON po.id = pi.payout_id
        WHERE pi.project_id = p.id
          AND po.status = 'paid'
      ), 0)::numeric AS paid_task_payouts,
      COALESCE((
        SELECT SUM(COALESCE((entry.value->>'hours')::numeric, 0) * COALESCE(h.hourly_rate, 0))
        FROM public.hourly_payout_requests h
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.attendance_snapshot, '[]'::jsonb)) entry(value)
        WHERE h.status = 'paid'
          AND NULLIF(entry.value->>'project_id', '')::uuid = p.id
      ), 0)::numeric AS paid_hourly_payouts
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
        - pci.direct_costs
        - pci.allocated_overhead_costs
        - pci.paid_task_payouts
        - pci.paid_hourly_payouts
      )::numeric AS team_budget
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
        WHEN rb.reward_type = 'fixed' THEN LEAST(rb.reward_fixed_amount, GREATEST(0, rb.team_budget))
        WHEN rb.reward_type = 'percentage' THEN GREATEST(0, rb.team_budget) * (rb.reward_percentage / 100)
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
    c.team_budget,
    c.calculated_reward AS total_reward,
    c.reserved_or_paid_amount,
    c.paid_amount,
    GREATEST(0, c.calculated_reward - c.reserved_or_paid_amount) AS available_balance
  FROM calculated c
  ORDER BY c.project_code NULLS LAST, c.project_name;
END;
$$;

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
    SELECT pi.project_id, COALESCE(SUM(pi.amount), 0)::numeric AS amount
    FROM public.payout_items pi
    WHERE p_edit_payout_id IS NOT NULL
      AND pi.payout_id = p_edit_payout_id
      AND pi.project_id IS NOT NULL
    GROUP BY pi.project_id
  )
  SELECT COALESCE(jsonb_agg(
    to_jsonb(p)
    || jsonb_build_object(
      'available_balance', COALESCE(p.available_balance, 0) + COALESCE(epi.amount, 0),
      'reserved_payouts', GREATEST(0, COALESCE(p.reserved_or_paid_amount, 0) - COALESCE(p.paid_amount, 0)),
      'paid_payouts', COALESCE(p.paid_amount, 0)
    )
    ORDER BY p.project_code
  ), '[]'::jsonb)
  INTO v_projects
  FROM public.get_member_project_rewards(p_member_id) p
  LEFT JOIN edit_project_items epi ON epi.project_id = p.project_id
  WHERE p.available_balance > 0.01
    AND p.reward_type IN ('fixed', 'percentage');

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
    SELECT realizace_id, COALESCE(SUM(cost_amount), 0)::numeric AS cost_amount, COALESCE(SUM(sale_amount), 0)::numeric AS sale_amount
    FROM public.realizace_extra_costs
    GROUP BY realizace_id
  ),
  paid_hourly AS (
    SELECT
      NULLIF(entry.value->>'realizace_id', '')::uuid AS realization_id,
      COALESCE(SUM(COALESCE((entry.value->>'hours')::numeric, 0) * COALESCE(h.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.hourly_payout_requests h
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.attendance_snapshot, '[]'::jsonb)) entry(value)
    WHERE h.status = 'paid'
      AND NULLIF(entry.value->>'realizace_id', '') IS NOT NULL
    GROUP BY NULLIF(entry.value->>'realizace_id', '')::uuid
  ),
  reserved AS (
    SELECT
      pi.realization_id,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded')), 0)::numeric AS reserved_amount,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_amount
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
      COALESCE(ec.cost_amount, 0)::numeric AS extra_costs,
      (COALESCE(mc.amount, 0) + COALESCE(ec.cost_amount, 0))::numeric AS operational_costs,
      (COALESCE(r.contract_amount, 0) + COALESCE(ec.sale_amount, 0))::numeric AS total_revenue,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent,
      s.share_type,
      COALESCE(s.share_value, 0)::numeric AS share_value,
      COALESCE(res.reserved_amount, 0)::numeric AS reserved_payouts,
      COALESCE(res.paid_amount, 0)::numeric AS paid_task_payouts,
      COALESCE(ph.amount, 0)::numeric AS paid_hourly_payouts
    FROM public.realizations r
    LEFT JOIN shares s ON s.realizace_id = r.id
    LEFT JOIN manual_costs mc ON mc.realizace_id = r.id
    LEFT JOIN extra_costs ec ON ec.realizace_id = r.id
    LEFT JOIN reserved res ON res.realization_id = r.id
    LEFT JOIN paid_hourly ph ON ph.realization_id = r.id
    WHERE v_can_admin OR s.realizace_id IS NOT NULL
  ),
  budgets AS (
    SELECT
      c.*,
      (c.total_revenue * (c.profit_margin_percent / 100))::numeric AS profit_amount,
      (c.total_revenue * (c.overhead_percent / 100))::numeric AS overhead_amount,
      (c.paid_task_payouts + c.paid_hourly_payouts)::numeric AS paid_payout_costs,
      (
        c.total_revenue
        - (c.total_revenue * (c.profit_margin_percent / 100))
        - (c.total_revenue * (c.overhead_percent / 100))
        - c.operational_costs
        - c.paid_task_payouts
        - c.paid_hourly_payouts
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
      'extra_costs', extra_costs,
      'operational_costs', operational_costs,
      'total_costs', operational_costs,
      'total_revenue', total_revenue,
      'profit_margin_percent', profit_margin_percent,
      'overhead_percent', overhead_percent,
      'profit_amount', profit_amount,
      'overhead_amount', overhead_amount,
      'team_budget', team_budget,
      'share_type', share_type,
      'share_value', share_value,
      'total_share', total_share,
      'reserved_payouts', reserved_payouts,
      'paid_task_payouts', paid_task_payouts,
      'paid_hourly_payouts', paid_hourly_payouts,
      'paid_payout_costs', paid_payout_costs,
      'paid_amount', paid_task_payouts,
      'reserved_or_paid_amount', reserved_payouts + paid_task_payouts,
      'available_share', GREATEST(0, total_share - reserved_payouts - paid_task_payouts),
      'availability_reason',
        CASE
          WHEN share_type IS NULL THEN 'Není nastaven podíl'
          WHEN team_budget <= 0 THEN 'Týmový rozpočet je nulový nebo záporný'
          WHEN total_share <= 0 THEN 'Podíl vychází na 0 Kč'
          WHEN reserved_payouts + paid_task_payouts >= total_share THEN 'Podíl je už rezervovaný nebo vyplacený'
          WHEN GREATEST(0, total_share - reserved_payouts - paid_task_payouts) > 0 THEN 'Dostupné k žádosti'
          ELSE 'Není dostupný zůstatek'
        END
    )
    ORDER BY name
  ), '[]'::jsonb)
  INTO v_realizations
  FROM shares_calculated;

  RETURN jsonb_build_object('projects', v_projects, 'realizations', v_realizations);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_projects_with_balance(p_member_id uuid)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  project_code text,
  total_reward numeric,
  paid_amount numeric,
  available_balance numeric,
  project_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rewards.project_id,
    rewards.project_name,
    rewards.project_code,
    rewards.total_reward,
    rewards.paid_amount,
    rewards.available_balance,
    rewards.project_status
  FROM public.get_member_project_rewards(p_member_id) rewards
  WHERE rewards.available_balance > 0.01
    AND rewards.reward_type IN ('fixed', 'percentage');
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
    SELECT realizace_id, COALESCE(SUM(cost_amount), 0)::numeric AS cost_amount, COALESCE(SUM(sale_amount), 0)::numeric AS sale_amount
    FROM public.realizace_extra_costs
    GROUP BY realizace_id
  ),
  paid_hourly AS (
    SELECT
      NULLIF(entry.value->>'realizace_id', '')::uuid AS realization_id,
      COALESCE(SUM(COALESCE((entry.value->>'hours')::numeric, 0) * COALESCE(h.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.hourly_payout_requests h
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.attendance_snapshot, '[]'::jsonb)) entry(value)
    WHERE h.status = 'paid'
      AND NULLIF(entry.value->>'realizace_id', '') IS NOT NULL
    GROUP BY NULLIF(entry.value->>'realizace_id', '')::uuid
  ),
  paid_task AS (
    SELECT pi.realization_id, COALESCE(SUM(pi.amount), 0)::numeric AS amount
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.realization_id IS NOT NULL
      AND po.status = 'paid'
    GROUP BY pi.realization_id
  ),
  calculated AS (
    SELECT
      r.id,
      (COALESCE(r.contract_amount, 0) + COALESCE(ec.sale_amount, 0))::numeric AS total_revenue,
      (COALESCE(mc.amount, 0) + COALESCE(ec.cost_amount, 0))::numeric AS operational_costs,
      (COALESCE(pt.amount, 0) + COALESCE(ph.amount, 0))::numeric AS paid_payout_costs,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent
    FROM public.realizations r
    LEFT JOIN manual_costs mc ON mc.realizace_id = r.id
    LEFT JOIN extra_costs ec ON ec.realizace_id = r.id
    LEFT JOIN paid_task pt ON pt.realization_id = r.id
    LEFT JOIN paid_hourly ph ON ph.realization_id = r.id
  ),
  budgets AS (
    SELECT
      id,
      total_revenue,
      operational_costs,
      paid_payout_costs,
      (total_revenue * (profit_margin_percent / 100))::numeric AS profit_amount,
      (total_revenue * (overhead_percent / 100))::numeric AS overhead_amount,
      (
        total_revenue
        - (total_revenue * (profit_margin_percent / 100))
        - (total_revenue * (overhead_percent / 100))
        - operational_costs
        - paid_payout_costs
      )::numeric AS team_budget
    FROM calculated
  )
  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(total_revenue), 0),
    'total_costs', COALESCE(SUM(operational_costs + paid_payout_costs), 0),
    'total_operational_costs', COALESCE(SUM(operational_costs), 0),
    'total_paid_payout_costs', COALESCE(SUM(paid_payout_costs), 0),
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
  SET status = 'approved',
      approved_without_invoice = COALESCE(p_approved_without_invoice, false),
      admin_note = p_admin_note,
      approved_at = now(),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  PERFORM public.log_workflow_audit(
    'hourly_payout_approved',
    jsonb_build_object('request_id', p_request_id, 'member_id', v_request.member_id, 'amount', v_request.total_amount, 'approved_without_invoice', v_request.approved_without_invoice)
  );

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
  SET status = 'rejected',
      rejection_reason = p_rejection_reason,
      rejected_at = now(),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  PERFORM public.log_workflow_audit(
    'hourly_payout_rejected',
    jsonb_build_object('request_id', p_request_id, 'member_id', v_request.member_id, 'amount', v_request.total_amount, 'reason', p_rejection_reason)
  );

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

  PERFORM public.log_workflow_audit(
    'hourly_payout_paid',
    jsonb_build_object('request_id', p_request_id, 'member_id', v_request.member_id, 'amount', v_request.total_amount, 'paid_at', v_request.paid_at)
  );

  RETURN to_jsonb(v_request);
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.realization_financial_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_projects_with_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_availability(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_realization_financial_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_hourly_payout_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_hourly_payout_paid(uuid) TO authenticated;
