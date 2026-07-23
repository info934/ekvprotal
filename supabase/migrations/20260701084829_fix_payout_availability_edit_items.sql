-- Fix payout closing/editing when the current payout fully consumes a project reward.
-- The previous filter excluded projects with current available_balance = 0 before adding back
-- the edited payout amount, so mark_payout_paid could reject valid invoice_uploaded payouts.

CREATE OR REPLACE FUNCTION public.get_payout_availability(p_member_id uuid, p_edit_payout_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE COALESCE(p.available_balance, 0) + COALESCE(epi.amount, 0) > 0.01
    AND p.reward_type IN ('fixed', 'percentage');

  WITH shares AS (
    SELECT realizace_id, share_type, share_value
    FROM public.realization_profit_shares
    WHERE member_id = p_member_id
  ),
  edit_realization_items AS (
    SELECT pi.realization_id, COALESCE(SUM(pi.amount), 0)::numeric AS amount
    FROM public.payout_items pi
    WHERE p_edit_payout_id IS NOT NULL
      AND pi.payout_id = p_edit_payout_id
      AND pi.realization_id IS NOT NULL
    GROUP BY pi.realization_id
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
      COALESCE(ph.amount, 0)::numeric AS paid_hourly_payouts,
      COALESCE(eri.amount, 0)::numeric AS edit_amount
    FROM public.realizations r
    LEFT JOIN shares s ON s.realizace_id = r.id
    LEFT JOIN manual_costs mc ON mc.realizace_id = r.id
    LEFT JOIN extra_costs ec ON ec.realizace_id = r.id
    LEFT JOIN reserved res ON res.realization_id = r.id
    LEFT JOIN paid_hourly ph ON ph.realization_id = r.id
    LEFT JOIN edit_realization_items eri ON eri.realization_id = r.id
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
        WHEN b.share_type = 'fixed' THEN LEAST(b.share_value, GREATEST(0, b.team_budget))
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
      'available_share', GREATEST(0, total_share - reserved_payouts - paid_task_payouts + edit_amount),
      'availability_reason',
        CASE
          WHEN share_type IS NULL THEN 'Není nastaven podíl'
          WHEN team_budget <= 0 THEN 'Týmový rozpočet je nulový nebo záporný'
          WHEN total_share <= 0 THEN 'Podíl vychází na 0 Kč'
          WHEN reserved_payouts + paid_task_payouts >= total_share THEN 'Podíl je už rezervovaný nebo vyplacený'
          WHEN GREATEST(0, total_share - reserved_payouts - paid_task_payouts + edit_amount) > 0 THEN 'Dostupné k žádosti'
          ELSE 'Není dostupný zůstatek'
        END
    )
    ORDER BY name
  ), '[]'::jsonb)
  INTO v_realizations
  FROM shares_calculated;

  RETURN jsonb_build_object('projects', v_projects, 'realizations', v_realizations);
END;
$function$;
