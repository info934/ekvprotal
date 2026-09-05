-- Additive bonuses preserve existing fixed amounts and percentage shares.
BEGIN;
CREATE TABLE public.project_bonuses (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
 member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
 amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount < 1000000000000),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_bonuses_project_member_idx ON public.project_bonuses(project_id, member_id);
CREATE INDEX project_bonuses_member_created_idx ON public.project_bonuses(member_id, created_at DESC);
ALTER TABLE public.project_bonuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_bonuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_bonuses TO authenticated;
GRANT ALL ON public.project_bonuses TO service_role;
CREATE POLICY project_bonuses_read ON public.project_bonuses FOR SELECT TO authenticated
 USING ((select public.get_user_role()) = 'admin' OR member_id = (select public.get_member_id()));

create or replace function public.project_member_reward_state(p_project_id uuid)
returns table (
  assignment_id uuid, member_id uuid, member_name text, reward_type text,
  reward_percentage numeric, reward_amount numeric, is_hourly boolean,
  valid_from date, valid_to date, ended_at timestamptz,
  is_current boolean, included_in_allocation boolean,
  reward_pool numeric, fixed_reward_total numeric, percentage_reward_pool numeric,
  direct_assigned_costs numeric, sponsored_labor_costs numeric, total_deductions numeric,
  gross_reward numeric, net_reward numeric, reserved_amount numeric, paid_amount numeric,
  committed_amount numeric, available_amount numeric
)
language sql stable security definer set search_path = '' as $$
  with pool as (
    select greatest(0,
      coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100
      - coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100 * coalesce(p.overhead_percentage, 0) / 100
      - coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)
      - coalesce((select sum(pc.amount) from public.project_costs pc where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)
      - coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)
      - coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.project_id = p.id and l.status <> 'reversed'), 0)
    )::numeric amount
    from public.projects p where p.id = p_project_id
  ), inputs as (
    select pm.*,
      coalesce(costs.amount, 0)::numeric direct_costs,
      coalesce(labor.amount, 0)::numeric sponsored_costs,
      coalesce(payouts.reserved_amount, 0)::numeric reserved,
      coalesce(payouts.paid_amount, 0)::numeric paid,
      (pm.ended_at is null and pm.valid_from <= current_date
        and (pm.valid_to is null or pm.valid_to >= current_date)) current_now,
      ((pm.ended_at is null and (pm.valid_to is null or pm.valid_to >= current_date))
        or exists (select 1 from public.project_bonuses b where b.project_id = pm.project_id and b.member_id = pm.member_id)
        or coalesce(costs.amount, 0) > 0.01
        or coalesce(labor.amount, 0) > 0.01
        or coalesce(payouts.reserved_amount, 0) + coalesce(payouts.paid_amount, 0) > 0.01
      ) financially_relevant
    from public.project_members pm
    left join lateral (
      select coalesce(sum(pc.amount), 0)::numeric amount
      from public.project_costs pc
      where pc.project_id = p_project_id and pc.member_id = pm.member_id
        and not coalesce(pc.is_attendance_cost, false)
    ) costs on true
    left join lateral (
      select coalesce(sum(l.sponsor_reward_deduction), 0)::numeric amount
      from public.labor_cost_ledger l
      where l.project_id = p_project_id and l.sponsor_member_id = pm.member_id
        and l.status <> 'reversed'
    ) labor on true
    left join lateral (
      select
        coalesce(sum(pi.amount) filter (where po.status in ('pending','approved','invoice_uploaded')), 0)::numeric reserved_amount,
        coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric paid_amount
      from public.payout_items pi join public.payouts po on po.id = pi.payout_id
      where pi.project_id = p_project_id and po.member_id = pm.member_id
    ) payouts on true
    where pm.project_id = p_project_id
  ), fixed as (
    select coalesce(sum(coalesce(i.reward_amount, 0)) filter (
      where i.financially_relevant and i.reward_type = 'fixed'
    ), 0)::numeric amount from inputs i
  ), calculated as (
    select i.*, coalesce(p.amount, 0)::numeric pool_amount,
      coalesce(f.amount, 0)::numeric fixed_amount,
      greatest(0, coalesce(p.amount, 0) - coalesce(f.amount, 0))::numeric percent_pool,
      case
        when not i.financially_relevant then 0
        when i.reward_type = 'fixed' then coalesce(i.reward_amount, 0)
        when i.reward_type = 'percentage' then greatest(0, coalesce(p.amount, 0) - coalesce(f.amount, 0)) * coalesce(i.reward_percentage, 0) / 100
        else 0
      end + coalesce((select sum(b.amount) from public.project_bonuses b where b.project_id = i.project_id and b.member_id = i.member_id), 0)::numeric gross
    from inputs i cross join pool p cross join fixed f
  )
  select c.id, c.member_id, m.name,
    case when c.reward_type in ('fixed','percentage') then c.reward_type
      when exists (select 1 from public.project_bonuses b where b.project_id = p_project_id and b.member_id = c.member_id) then 'fixed'
      else c.reward_type end,
    coalesce(c.reward_percentage, 0)::numeric, coalesce(c.reward_amount, 0)::numeric,
    coalesce(c.is_hourly, false), c.valid_from, c.valid_to, c.ended_at,
    c.current_now, c.financially_relevant, c.pool_amount, c.fixed_amount, c.percent_pool,
    c.direct_costs, c.sponsored_costs, (c.direct_costs + c.sponsored_costs)::numeric,
    c.gross, greatest(0, c.gross - c.direct_costs - c.sponsored_costs)::numeric,
    c.reserved, c.paid, (c.reserved + c.paid)::numeric,
    greatest(0, c.gross - c.direct_costs - c.sponsored_costs - c.reserved - c.paid)::numeric
  from calculated c left join public.members m on m.id = c.member_id;
$$;

create or replace function public.assert_project_reward_allocation(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pool numeric := 0;
  v_gross numeric := 0;
  v_fixed_total numeric := 0;
  v_percentage_total numeric := 0;
  v_violation record;
begin
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;

  select coalesce(max(s.reward_pool), 0), coalesce(max(s.fixed_reward_total), 0),
    coalesce(sum(s.reward_percentage) filter (where s.included_in_allocation and s.reward_type = 'percentage'), 0)
  into v_pool, v_fixed_total, v_percentage_total
  from public.project_member_reward_state(p_project_id) s;

  select coalesce(sum(s.gross_reward), 0) into v_gross from public.project_member_reward_state(p_project_id) s;
  if exists (select 1 from public.project_bonuses where project_id = p_project_id) and v_gross > v_pool + 0.001 then
    raise exception 'Project rewards including bonuses exceed the current team budget';
  end if;
  if v_fixed_total > v_pool + 0.01 then
    raise exception 'Fixed project rewards exceed the current team budget by %', round(v_fixed_total - v_pool, 2);
  end if;
  if v_percentage_total > 100.000001 then
    raise exception 'Project percentage rewards cannot exceed 100%% (current total: %)', round(v_percentage_total, 6);
  end if;

  select s.*, coalesce(b.max_allowed_deficit, 0) as max_allowed_deficit
  into v_violation
  from public.project_member_reward_state(p_project_id) s
  left join public.project_member_reward_guard_baselines b on b.assignment_id = s.assignment_id
  where greatest(0, s.committed_amount - s.net_reward)
    > coalesce(b.max_allowed_deficit, 0) + 0.01
  order by greatest(0, s.committed_amount - s.net_reward) - coalesce(b.max_allowed_deficit, 0) desc
  limit 1;
  if found then
    raise exception 'Net reward for % would worsen the protected reserved or paid payout deficit by %',
      coalesce(v_violation.member_name, v_violation.member_id::text),
      round(greatest(0, v_violation.committed_amount - v_violation.net_reward)
        - v_violation.max_allowed_deficit, 2);
  end if;

  update public.project_member_reward_guard_baselines b
  set max_allowed_deficit = greatest(0, s.committed_amount - s.net_reward),
      updated_at = now()
  from public.project_member_reward_state(p_project_id) s
  where b.assignment_id = s.assignment_id
    and b.project_id = p_project_id
    and greatest(0, s.committed_amount - s.net_reward) < b.max_allowed_deficit - 0.01;
end;
$$;

-- Keep the canonical summary's remaining allocation accurate as well.
ALTER FUNCTION public.project_financial_summary_admin_internal(uuid)
 RENAME TO project_financial_summary_before_bonus_20260905;
REVOKE ALL ON FUNCTION public.project_financial_summary_before_bonus_20260905(uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.project_financial_summary_admin_internal(p_project_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.project_financial_summary_before_bonus_20260905(p_project_id) || jsonb_build_object(
  'unallocated_reward_budget', greatest(0, coalesce((select max(s.reward_pool) - sum(s.gross_reward) from public.project_member_reward_state(p_project_id) s),0)),
  'extra_bonus_total', coalesce((select sum(amount) from public.project_bonuses where project_id = p_project_id),0)
 );
$$;
REVOKE ALL ON FUNCTION public.project_financial_summary_admin_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_financial_summary_admin_internal(uuid) TO service_role;

CREATE FUNCTION public.award_project_bonus(p_id uuid, p_project_id uuid, p_member_id uuid, p_amount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_existing public.project_bonuses; v_row public.project_bonuses;
 v_available numeric; v_user uuid; v_name text;
BEGIN
 IF coalesce(public.get_user_role() <> 'admin', true) THEN
  RAISE EXCEPTION 'Bonus může přidělit pouze administrátor.' USING ERRCODE = '42501';
 END IF;
 IF p_id IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_amount >= 1000000000000
  OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_amount <> round(p_amount, 2)
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 2000 THEN
  RAISE EXCEPTION 'Zadejte kladnou částku s nejvýše dvěma desetinnými místy a důvod (3–2000 znaků).';
 END IF;
 SELECT name INTO v_name FROM public.projects WHERE id = p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Projekt nebyl nalezen.'; END IF;
 SELECT * INTO v_existing FROM public.project_bonuses WHERE id = p_id;
 IF FOUND THEN
  IF v_existing.project_id IS DISTINCT FROM p_project_id OR v_existing.member_id IS DISTINCT FROM p_member_id
    OR v_existing.amount IS DISTINCT FROM p_amount OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
    OR v_existing.created_by IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Tento identifikátor již patří jinému bonusu.';
  END IF;
  RETURN to_jsonb(v_existing);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project_id AND member_id = p_member_id
  AND ended_at IS NULL AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)) THEN
  RAISE EXCEPTION 'Vyberte aktuálního člena projektového týmu.';
 END IF;
 SELECT auth_user_id INTO v_user FROM public.members WHERE id = p_member_id;
 IF v_user IS NULL OR EXISTS (SELECT 1 FROM public.user_account_status WHERE auth_user_id = v_user AND status <> 'active') THEN
  RAISE EXCEPTION 'Příjemce musí mít aktivní účet pro doručení oznámení.';
 END IF;
 -- Gross allocations, not net balances: deducted member costs are not free money.
 SELECT greatest(0, coalesce(max(s.reward_pool) - sum(s.gross_reward),0)) INTO v_available
 FROM public.project_member_reward_state(p_project_id) s;
 IF p_amount > floor(v_available * 100) / 100 THEN
  RAISE EXCEPTION 'Na bonus nezbývá dostatek nerozděleného rozpočtu. Obnovte finanční přehled.';
 END IF;
 INSERT INTO public.project_bonuses(id, project_id, member_id, amount, reason, created_by)
 VALUES (p_id, p_project_id, p_member_id, p_amount, btrim(p_reason), auth.uid()) RETURNING * INTO v_row;
 PERFORM public.assert_project_reward_allocation(p_project_id);
 INSERT INTO public.notifications(user_id, type, title, message)
 VALUES (v_user, 'project_bonus', 'Byl vám přidělen mimořádný bonus',
  format('Projekt %s: bonus %s Kč. Důvod: %s. Bonus je součástí vašeho nároku na odměnu; o výplatu požádejte obvyklým postupem.', v_name, p_amount, btrim(p_reason)));
 PERFORM public.log_workflow_audit('project_bonus_awarded', to_jsonb(v_row));
 RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.award_project_bonus(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_project_bonus(uuid, uuid, uuid, numeric, text) TO authenticated;

-- An assignment with a bonus cannot be reassigned to another identity.
CREATE FUNCTION public.protect_project_bonus_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF (new.member_id IS DISTINCT FROM old.member_id OR new.project_id IS DISTINCT FROM old.project_id)
 AND EXISTS (SELECT 1 FROM public.project_bonuses WHERE project_id = old.project_id AND member_id = old.member_id) THEN
  RAISE EXCEPTION 'Přiřazení s mimořádným bonusem nelze převést na jiného člena nebo projekt.';
 END IF;
 RETURN new;
END;
$$;
CREATE TRIGGER protect_project_bonus_assignment BEFORE UPDATE ON public.project_members
 FOR EACH ROW EXECUTE FUNCTION public.protect_project_bonus_assignment();
REVOKE ALL ON FUNCTION public.protect_project_bonus_assignment() FROM PUBLIC, anon, authenticated;
COMMIT;
