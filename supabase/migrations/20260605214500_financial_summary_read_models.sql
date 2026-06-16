-- Add backend-owned financial read models for project and realization detail screens.
-- These functions do not mutate data. They centralize calculation inputs so UI,
-- reports, and future payout validation can share one backend source of truth.

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
    'planned_overhead_amount', planned_overhead_amount,
    'manual_costs', manual_costs,
    'attendance_costs', attendance_costs,
    'direct_costs', direct_costs,
    'subcontractor_costs', subcontractor_costs,
    'allocated_overhead_costs', allocated_overhead_costs,
    'operational_costs', direct_costs + subcontractor_costs + allocated_overhead_costs,
    'team_budget', gross_project_budget - planned_overhead_amount - subcontractor_costs,
    'remaining_after_costs', gross_project_budget - planned_overhead_amount - subcontractor_costs - direct_costs - allocated_overhead_costs,
    'reserved_or_paid_payouts', reserved_or_paid_payouts,
    'paid_payouts', paid_payouts,
    'member_rewards', member_rewards
  )
  INTO v_summary
  FROM calculated;

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
        AND rp.module IN ('realizace', 'realizations', 'payouts')
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
  direct_attendance AS (
    SELECT COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.attendance a
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE a.realizace_id = p_realization_id
  ),
  linked_project_attendance AS (
    SELECT COALESCE(SUM(COALESCE(a.hours, 0) * COALESCE(m.hourly_rate, 0)), 0)::numeric AS amount
    FROM public.realizations r
    JOIN public.attendance a ON a.project_id = r.linked_project_id
    LEFT JOIN public.members m ON m.id = a.member_id
    WHERE r.id = p_realization_id
      AND r.linked_project_id IS NOT NULL
  ),
  payouts AS (
    SELECT
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status IN ('pending', 'approved', 'invoice_uploaded', 'paid')), 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(SUM(pi.amount) FILTER (WHERE po.status = 'paid'), 0)::numeric AS paid_payouts
    FROM public.payout_items pi
    JOIN public.payouts po ON po.id = pi.payout_id
    WHERE pi.realization_id = p_realization_id
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
      (COALESCE(da.amount, 0) + COALESCE(lpa.amount, 0))::numeric AS hourly_costs,
      COALESCE(ec.cost_amount, 0)::numeric AS extra_costs,
      COALESCE(r.profit_margin_percent, 0)::numeric AS profit_margin_percent,
      COALESCE(r.overhead_percent, 0)::numeric AS overhead_percent,
      COALESCE(pay.reserved_or_paid_payouts, 0)::numeric AS reserved_or_paid_payouts,
      COALESCE(pay.paid_payouts, 0)::numeric AS paid_payouts,
      COALESCE(s.member_shares, '[]'::jsonb) AS member_shares
    FROM public.realizations r
    CROSS JOIN manual_costs mc
    CROSS JOIN extra_costs ec
    CROSS JOIN direct_attendance da
    CROSS JOIN linked_project_attendance lpa
    CROSS JOIN payouts pay
    CROSS JOIN shares s
    WHERE r.id = p_realization_id
  ),
  budgets AS (
    SELECT
      c.*,
      (c.base_contract_amount + c.extra_revenue)::numeric AS total_revenue,
      (c.manual_costs + c.hourly_costs + c.extra_costs)::numeric AS total_costs
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
    'extra_costs', extra_costs,
    'total_costs', total_costs,
    'profit_margin_percent', profit_margin_percent,
    'overhead_percent', overhead_percent,
    'profit_amount', total_revenue * (profit_margin_percent / 100),
    'overhead_amount', total_revenue * (overhead_percent / 100),
    'team_budget',
      total_revenue
      - (total_revenue * (profit_margin_percent / 100))
      - (total_revenue * (overhead_percent / 100))
      - total_costs,
    'reserved_or_paid_payouts', reserved_or_paid_payouts,
    'paid_payouts', paid_payouts,
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

REVOKE ALL ON FUNCTION public.project_financial_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.realization_financial_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.realization_financial_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.realization_financial_summary(uuid) TO service_role;
