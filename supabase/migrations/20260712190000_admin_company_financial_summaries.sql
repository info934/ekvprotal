-- Restore admin dashboard summaries after revoking direct financial column reads.

create or replace function public.get_company_financials()
returns table (
  realized_profit numeric,
  potential_profit numeric,
  total_overhead numeric,
  total_project_value numeric,
  unallocated_budget numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read company financials';
  end if;

  return query
  with project_finances as (
    select
      p.id,
      p.status,
      coalesce(p.price, 0) as price,
      coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100.0) as total_budget,
      coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100.0)
        * (coalesce(p.overhead_percentage, 0) / 100.0) as overhead_amount,
      coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0) as subcontractor_costs,
      coalesce((
        select sum(case
          when pm.reward_type = 'fixed' then coalesce(pm.reward_amount, 0)
          when pm.reward_type = 'percentage' then greatest(0,
            (coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100.0))
            - (coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100.0)
              * (coalesce(p.overhead_percentage, 0) / 100.0))
            - coalesce((select sum(ps_inner.price) from public.project_subcontractors ps_inner where ps_inner.project_id = p.id), 0)
          ) * (coalesce(pm.reward_percentage, 0) / 100.0)
          else 0
        end)
        from public.project_members pm where pm.project_id = p.id
      ), 0) as member_rewards
    from public.projects p
  )
  select
    coalesce(sum(case when pf.status in ('delivered', 'closed') then pf.price - pf.total_budget else 0 end), 0),
    coalesce(sum(case when pf.status not in ('delivered', 'closed') then pf.price - pf.total_budget else 0 end), 0),
    coalesce(sum(pf.overhead_amount), 0),
    coalesce(sum(pf.price), 0),
    coalesce(sum(pf.total_budget - pf.overhead_amount - pf.subcontractor_costs - pf.member_rewards), 0)
  from project_finances pf;
end;
$$;

create or replace function public.get_overhead_summary()
returns table (
  total_allocated_overhead numeric,
  total_accounted_overhead numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read overhead summary';
  end if;

  return query
  select
    coalesce((
      select sum(coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100.0)
        * (coalesce(p.overhead_percentage, 0) / 100.0))
      from public.projects p
    ), 0),
    coalesce((select sum(poc.amount) from public.project_overhead_costs poc), 0);
end;
$$;

revoke all on function public.get_company_financials() from public, anon;
revoke all on function public.get_overhead_summary() from public, anon;
grant execute on function public.get_company_financials() to authenticated, service_role;
grant execute on function public.get_overhead_summary() to authenticated, service_role;
