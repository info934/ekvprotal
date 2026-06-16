-- Centralize member project reward calculations.
-- This replaces older frontend/materialized-view reward math with a live backend
-- read model that uses the same project budget inputs as project summaries.

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
      COALESCE((
        SELECT SUM(ps.price)
        FROM public.project_subcontractors ps
        WHERE ps.project_id = p.id
      ), 0)::numeric AS subcontractor_costs
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
        WHEN rb.reward_type = 'fixed' THEN rb.reward_fixed_amount
        WHEN rb.reward_type = 'percentage' THEN rb.team_budget * (rb.reward_percentage / 100)
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
    c.calculated_reward - c.reserved_or_paid_amount AS available_balance
  FROM calculated c
  ORDER BY c.project_code NULLS LAST, c.project_name;
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
    rewards.reserved_or_paid_amount AS paid_amount,
    rewards.available_balance,
    rewards.project_status
  FROM public.get_member_project_rewards(p_member_id) rewards
  WHERE rewards.available_balance > 0.01
    AND rewards.reward_type IN ('fixed', 'percentage');
$$;

CREATE OR REPLACE FUNCTION public.get_user_financials(p_member_id uuid)
RETURNS TABLE (
  total_reward numeric,
  available_to_payout numeric,
  total_paid numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(rewards.total_reward), 0)::numeric AS total_reward,
    COALESCE(SUM(rewards.available_balance) FILTER (
      WHERE rewards.project_status IN ('delivered', 'closed')
    ), 0)::numeric AS available_to_payout,
    COALESCE(SUM(rewards.paid_amount), 0)::numeric AS total_paid
  FROM public.get_member_project_rewards(p_member_id) rewards
  WHERE rewards.reward_type IN ('fixed', 'percentage');
$$;

CREATE OR REPLACE FUNCTION public.get_project_order_reward(p_token text)
RETURNS TABLE (
  order_id uuid,
  project_id uuid,
  member_id uuid,
  reward_amount numeric,
  team_budget numeric,
  reward_type text,
  reward_percentage numeric,
  reward_fixed_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH order_base AS (
    SELECT
      po.id AS order_id,
      po.project_id,
      po.member_id,
      pm.reward_type,
      COALESCE(pm.reward_percentage, 0)::numeric AS reward_percentage,
      COALESCE(pm.reward_amount, 0)::numeric AS reward_fixed_amount,
      (
        (COALESCE(p.price, 0)::numeric * (COALESCE(p.budget_percentage, 0)::numeric / 100))
        - (COALESCE(p.price, 0)::numeric * (COALESCE(p.budget_percentage, 0)::numeric / 100) * (COALESCE(p.overhead_percentage, 0)::numeric / 100))
        - COALESCE((
            SELECT SUM(ps.price)
            FROM public.project_subcontractors ps
            WHERE ps.project_id = p.id
          ), 0)::numeric
      )::numeric AS team_budget
    FROM public.project_orders po
    JOIN public.project_members pm
      ON pm.project_id = po.project_id
     AND pm.member_id = po.member_id
    JOIN public.projects p ON p.id = po.project_id
    WHERE po.unique_token = p_token
    LIMIT 1
  )
  SELECT
    ob.order_id,
    ob.project_id,
    ob.member_id,
    CASE
      WHEN ob.reward_type = 'fixed' THEN ob.reward_fixed_amount
      WHEN ob.reward_type = 'percentage' THEN ob.team_budget * (ob.reward_percentage / 100)
      ELSE 0
    END::numeric AS reward_amount,
    ob.team_budget,
    ob.reward_type,
    ob.reward_percentage,
    ob.reward_fixed_amount
  FROM order_base ob;
$$;

REVOKE ALL ON FUNCTION public.get_member_project_rewards(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_projects_with_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_projects_with_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_projects_with_balance(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_user_financials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_financials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_financials(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_project_order_reward(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_order_reward(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_project_order_reward(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_order_reward(text) TO service_role;
