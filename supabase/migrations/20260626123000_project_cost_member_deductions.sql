ALTER TABLE public.project_costs
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_costs_member_id ON public.project_costs (member_id);
CREATE INDEX IF NOT EXISTS idx_project_costs_project_member_id ON public.project_costs (project_id, member_id);

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
      COALESCE(SUM(pc.amount) FILTER (WHERE NOT COALESCE(pc.is_attendance_cost, false)), 0)::numeric AS direct_costs,
      COALESCE(SUM(pc.amount) FILTER (WHERE NOT COALESCE(pc.is_attendance_cost, false) AND pc.member_id IS NULL), 0)::numeric AS unassigned_direct_costs,
      COALESCE(SUM(pc.amount) FILTER (WHERE NOT COALESCE(pc.is_attendance_cost, false) AND pc.member_id IS NOT NULL), 0)::numeric AS assigned_member_costs,
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
  calculated AS (
    SELECT
      pb.*,
      (pb.price * (pb.budget_percentage / 100))::numeric AS gross_project_budget,
      (pb.price * (pb.budget_percentage / 100) * (pb.overhead_percentage / 100))::numeric AS planned_overhead_amount,
      COALESCE(c.direct_costs, 0)::numeric AS direct_costs,
      COALESCE(c.unassigned_direct_costs, 0)::numeric AS unassigned_direct_costs,
      COALESCE(c.assigned_member_costs, 0)::numeric AS assigned_member_costs,
      COALESCE(c.manual_costs, 0)::numeric AS manual_costs,
      COALESCE(c.attendance_costs, 0)::numeric AS attendance_costs,
      COALESCE(s.subcontractor_costs, 0)::numeric AS subcontractor_costs,
      COALESCE(oc.allocated_overhead_costs, 0)::numeric AS allocated_overhead_costs,
      COALESCE(pay.reserved_payouts, 0)::numeric AS reserved_payouts,
      COALESCE(pay.paid_task_payouts, 0)::numeric AS paid_task_payouts,
      COALESCE(ph.paid_hourly_payouts, 0)::numeric AS paid_hourly_payouts,
      COALESCE(pay.reserved_or_paid_payouts, 0)::numeric + COALESCE(ph.paid_hourly_payouts, 0)::numeric AS reserved_or_paid_payouts
    FROM project_base pb
    CROSS JOIN costs c
    CROSS JOIN subcontractors s
    CROSS JOIN overhead_costs oc
    CROSS JOIN payout_sums pay
    CROSS JOIN paid_hourly ph
  ),
  budgets AS (
    SELECT
      c.*,
      (gross_project_budget - planned_overhead_amount - subcontractor_costs)::numeric AS planned_team_budget,
      (direct_costs + subcontractor_costs + allocated_overhead_costs)::numeric AS operational_costs,
      (paid_task_payouts + paid_hourly_payouts)::numeric AS paid_payout_costs
    FROM calculated c
  ),
  member_rewards AS (
    SELECT
      b.id,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', pm.member_id,
            'member_name', m.name,
            'reward_type', pm.reward_type,
            'reward_percentage', COALESCE(pm.reward_percentage, 0),
            'reward_amount', COALESCE(pm.reward_amount, 0),
            'is_hourly', COALESCE(pm.is_hourly, false),
            'assigned_costs', COALESCE(member_costs.amount, 0),
            'gross_reward',
              CASE
                WHEN pm.reward_type = 'fixed' THEN LEAST(COALESCE(pm.reward_amount, 0), GREATEST(0, b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs))
                WHEN pm.reward_type = 'percentage' THEN GREATEST(0, b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs) * (COALESCE(pm.reward_percentage, 0) / 100)
                ELSE 0
              END,
            'total_reward',
              GREATEST(0,
                CASE
                  WHEN pm.reward_type = 'fixed' THEN LEAST(COALESCE(pm.reward_amount, 0), GREATEST(0, b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs))
                  WHEN pm.reward_type = 'percentage' THEN GREATEST(0, b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs) * (COALESCE(pm.reward_percentage, 0) / 100)
                  ELSE 0
                END - COALESCE(member_costs.amount, 0)
              )
          )
          ORDER BY m.name
        )
        FROM public.project_members pm
        LEFT JOIN public.members m ON m.id = pm.member_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(pc.amount), 0)::numeric AS amount
          FROM public.project_costs pc
          WHERE pc.project_id = b.id
            AND pc.member_id = pm.member_id
            AND NOT COALESCE(pc.is_attendance_cost, false)
        ) member_costs ON true
        WHERE pm.project_id = b.id
      ), '[]'::jsonb) AS member_rewards
    FROM budgets b
  )
  SELECT jsonb_build_object(
    'project_id', b.id,
    'project_name', b.name,
    'project_code', b.code,
    'project_status', b.status,
    'price', b.price,
    'budget_percentage', b.budget_percentage,
    'overhead_percentage', b.overhead_percentage,
    'gross_project_budget', b.gross_project_budget,
    'planned_margin', b.price - b.gross_project_budget,
    'planned_overhead_amount', b.planned_overhead_amount,
    'manual_costs', b.manual_costs,
    'attendance_costs', b.attendance_costs,
    'hourly_payout_exposure', b.attendance_costs,
    'direct_costs', b.direct_costs,
    'unassigned_direct_costs', b.unassigned_direct_costs,
    'assigned_member_costs', b.assigned_member_costs,
    'subcontractor_costs', b.subcontractor_costs,
    'allocated_overhead_costs', b.allocated_overhead_costs,
    'operational_costs', b.operational_costs,
    'team_budget', b.planned_team_budget,
    'planned_team_budget', b.planned_team_budget,
    'cost_adjusted_team_budget', b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs,
    'remaining_after_costs', b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs,
    'costs_before_paid_payouts', b.operational_costs,
    'paid_task_payouts', b.paid_task_payouts,
    'paid_hourly_payouts', b.paid_hourly_payouts,
    'paid_payout_costs', b.paid_payout_costs,
    'paid_payouts', b.paid_task_payouts,
    'reserved_payouts', b.reserved_payouts,
    'reserved_or_paid_payouts', b.reserved_or_paid_payouts,
    'costs_after_paid_payouts', b.operational_costs + b.paid_payout_costs,
    'team_budget_after_paid_payouts', b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs,
    'available_for_payout', GREATEST(0, b.planned_team_budget - b.unassigned_direct_costs - b.allocated_overhead_costs - b.paid_payout_costs - b.reserved_payouts),
    'member_rewards', COALESCE(mr.member_rewards, '[]'::jsonb)
  )
  INTO v_summary
  FROM budgets b
  LEFT JOIN member_rewards mr ON mr.id = b.id;

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
      COALESCE((
        SELECT SUM(pc.amount)
        FROM public.project_costs pc
        WHERE pc.project_id = p.id
          AND pc.member_id IS NULL
          AND NOT COALESCE(pc.is_attendance_cost, false)
      ), 0)::numeric AS unassigned_direct_costs,
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
        - pci.unassigned_direct_costs
        - pci.allocated_overhead_costs
        - pci.paid_task_payouts
        - pci.paid_hourly_payouts
      )::numeric AS team_budget,
      COALESCE((
        SELECT SUM(pc.amount)
        FROM public.project_costs pc
        WHERE pc.project_id = pci.project_id
          AND pc.member_id = pm.member_id
          AND NOT COALESCE(pc.is_attendance_cost, false)
      ), 0)::numeric AS assigned_member_costs
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
      END::numeric AS gross_reward,
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
    GREATEST(0, c.gross_reward - c.assigned_member_costs) AS total_reward,
    c.reserved_or_paid_amount,
    c.paid_amount,
    GREATEST(0, c.gross_reward - c.assigned_member_costs - c.reserved_or_paid_amount) AS available_balance
  FROM calculated c
  ORDER BY c.project_code NULLS LAST, c.project_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.project_financial_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_project_member_safe(p_project_id uuid, p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to delete project member';
  END IF;

  SELECT pm.member_id
  INTO v_member_id
  FROM public.project_members pm
  WHERE pm.id = p_assignment_id
    AND pm.project_id = p_project_id;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.project_costs
    SET member_id = NULL
    WHERE project_id = p_project_id
      AND member_id = v_member_id;
  END IF;

  DELETE FROM public.project_members
  WHERE id = p_assignment_id
    AND project_id = p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project_member_safe(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_project_member_safe(uuid, uuid) TO authenticated;
