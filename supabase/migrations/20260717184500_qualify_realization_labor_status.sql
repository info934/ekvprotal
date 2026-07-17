-- Qualify labor ledger columns inside a RETURNS TABLE function.
-- The output column `status` is also a PL/pgSQL variable, so an unqualified
-- ledger `status` reference is ambiguous on PostgreSQL 17.

create or replace function public.get_member_realization_rewards(
  p_member_id uuid,
  p_edit_payout_id uuid default null
)
returns table (
  id uuid, name text, status text, base_contract_amount numeric, extra_revenue numeric,
  operational_costs numeric, total_revenue numeric, profit_margin_percent numeric,
  overhead_percent numeric, profit_amount numeric, overhead_amount numeric, team_budget numeric,
  share_type text, share_value numeric, gross_share numeric, sponsored_labor_deduction numeric,
  total_share numeric, reserved_payouts numeric, paid_amount numeric, available_share numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.get_user_role() = 'admin', false);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_can_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read realization rewards for this member';
  end if;

  return query
  with shares as (
    select rps.realizace_id, rps.share_type, rps.share_value
    from public.realization_profit_shares rps where rps.member_id = p_member_id
  ),
  edit_items as (
    select pi.realization_id, coalesce(sum(pi.amount), 0)::numeric as amount
    from public.payout_items pi
    where p_edit_payout_id is not null and pi.payout_id = p_edit_payout_id and pi.realization_id is not null
    group by pi.realization_id
  ),
  reserved as (
    select pi.realization_id,
      coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded')), 0)::numeric as reserved_amount,
      coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
    from public.payout_items pi join public.payouts po on po.id = pi.payout_id
    where pi.realization_id is not null and po.member_id = p_member_id
      and po.status in ('pending', 'approved', 'invoice_uploaded', 'paid')
      and (p_edit_payout_id is null or po.id <> p_edit_payout_id)
    group by pi.realization_id
  ),
  calculated as (
    select r.id, r.name, r.status,
      coalesce(r.contract_amount, 0)::numeric as base_contract_amount,
      coalesce(ec.sale_amount, 0)::numeric as extra_revenue,
      (coalesce(mc.amount, 0) + coalesce(ec.cost_amount, 0))::numeric as operational_costs,
      (coalesce(r.contract_amount, 0) + coalesce(ec.sale_amount, 0))::numeric as total_revenue,
      coalesce(r.profit_margin_percent, 0)::numeric as profit_margin_percent,
      coalesce(r.overhead_percent, 0)::numeric as overhead_percent,
      s.share_type, coalesce(s.share_value, 0)::numeric as share_value,
      coalesce(labor.direct_project_cost, 0)::numeric as direct_labor_cost,
      coalesce(labor.sponsored_deduction, 0)::numeric as sponsored_deduction,
      coalesce(res.reserved_amount, 0)::numeric as reserved_payouts,
      coalesce(res.paid_amount, 0)::numeric as paid_amount,
      coalesce(edit.amount, 0)::numeric as edit_amount
    from public.realizations r
    join shares s on s.realizace_id = r.id
    left join lateral (
      select coalesce(sum(rc.amount), 0)::numeric as amount
      from public.realizace_costs rc where rc.realizace_id = r.id
    ) mc on true
    left join lateral (
      select coalesce(sum(rec.cost_amount), 0)::numeric as cost_amount,
        coalesce(sum(rec.sale_amount), 0)::numeric as sale_amount
      from public.realizace_extra_costs rec where rec.realizace_id = r.id
    ) ec on true
    left join lateral (
      select coalesce(sum(lcl.project_cost_impact), 0)::numeric as direct_project_cost,
        coalesce(sum(lcl.sponsor_reward_deduction) filter (where lcl.sponsor_member_id = p_member_id), 0)::numeric as sponsored_deduction
      from public.labor_cost_ledger lcl
      where lcl.realization_id = r.id and lcl.status <> 'reversed'
    ) labor on true
    left join reserved res on res.realization_id = r.id
    left join edit_items edit on edit.realization_id = r.id
  ),
  budgets as (
    select c.*,
      (c.total_revenue * c.profit_margin_percent / 100)::numeric as profit_amount,
      (c.total_revenue * c.overhead_percent / 100)::numeric as overhead_amount,
      (c.total_revenue - (c.total_revenue * c.profit_margin_percent / 100)
        - (c.total_revenue * c.overhead_percent / 100) - c.operational_costs
        - c.direct_labor_cost - c.paid_amount)::numeric as team_budget
    from calculated c
  ),
  rewards as (
    select b.*,
      case when b.share_type = 'fixed' then least(b.share_value, greatest(0, b.team_budget))
        when b.share_type = 'percent' then greatest(0, b.team_budget * b.share_value / 100)
        else 0 end::numeric as gross_share
    from budgets b
  )
  select rw.id, rw.name, rw.status, rw.base_contract_amount, rw.extra_revenue,
    rw.operational_costs, rw.total_revenue, rw.profit_margin_percent, rw.overhead_percent,
    rw.profit_amount, rw.overhead_amount, rw.team_budget, rw.share_type, rw.share_value,
    rw.gross_share, rw.sponsored_deduction,
    greatest(0, rw.gross_share - rw.sponsored_deduction)::numeric as total_share,
    rw.reserved_payouts, rw.paid_amount,
    greatest(0, rw.gross_share - rw.sponsored_deduction - rw.reserved_payouts - rw.paid_amount + rw.edit_amount)::numeric as available_share
  from rewards rw order by rw.name;
end;
$$;

revoke all on function public.get_member_realization_rewards(uuid, uuid) from public, anon;
grant execute on function public.get_member_realization_rewards(uuid, uuid) to authenticated, service_role;
