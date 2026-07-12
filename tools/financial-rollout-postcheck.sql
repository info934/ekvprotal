-- Run after the four 20260712 financial migrations. Every assertion must pass.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'labor_cost_ledger') then
    raise exception 'labor_cost_ledger is missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'member_compensation_private') then
    raise exception 'member_compensation_private is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'labor_cost_ledger' and column_name = 'economic_project_cost') then
    raise exception 'economic_project_cost is missing';
  end if;
  if exists (
    select 1 from public.labor_cost_ledger
    where abs(economic_project_cost - employer_cost) > 0.01
  ) then
    raise exception 'economic labor cost does not reconcile to employer cost';
  end if;
  if exists (
    select 1 from public.labor_cost_ledger
    where funding_mode = 'member_reward'
      and abs((project_cost_impact + sponsor_reward_deduction) - employer_cost) > 0.02
  ) then
    raise exception 'sponsored labor funding does not reconcile';
  end if;
  if exists (
    select realizace_id
    from public.realization_profit_shares
    where share_type = 'percent'
    group by realizace_id
    having sum(share_value) > 100.0001
  ) then
    raise exception 'realization percentage shares exceed 100 percent';
  end if;
  if exists (
    select 1 from public.hourly_payout_requests h
    where h.status = 'paid'
      and (h.paid_at is null or h.total_amount is null or h.total_amount <= 0)
  ) then
    raise exception 'paid hourly payout metadata is incomplete';
  end if;
end $$;

select
  (select count(*) from public.member_compensation_private) as private_compensation_rows,
  (select count(*) from public.labor_cost_ledger where status <> 'reversed') as active_labor_rows,
  (select coalesce(sum(pay_amount), 0) from public.labor_cost_ledger where status <> 'reversed') as labor_pay_total,
  (select coalesce(sum(economic_project_cost), 0) from public.labor_cost_ledger where status <> 'reversed') as economic_labor_cost_total,
  (select coalesce(sum(project_cost_impact), 0) from public.labor_cost_ledger where status <> 'reversed') as common_pool_impact_total,
  (select coalesce(sum(sponsor_reward_deduction), 0) from public.labor_cost_ledger where status <> 'reversed') as sponsor_deduction_total;

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'member_compensation_private', 'labor_cost_ledger', 'project_members',
    'realization_profit_shares', 'payouts', 'payout_items',
    'hourly_payout_requests', 'realizace_costs', 'realizace_extra_costs'
  )
order by tablename, policyname;
