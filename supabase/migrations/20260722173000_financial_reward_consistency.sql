-- Canonical project/realization reward calculations and allocation guards.
-- Paid reward draws reduce the member balance exactly once. Approved labor
-- costs are sourced from labor_cost_ledger snapshots, never current rates.

alter table public.project_members
  drop constraint if exists project_members_reward_values_check,
  add constraint project_members_reward_values_check check (
    coalesce(reward_percentage, 0) between 0 and 100
    and coalesce(reward_amount, 0) >= 0
  );

create unique index if not exists realization_profit_shares_realization_member_uidx
  on public.realization_profit_shares (realizace_id, member_id);

-- The previous polymorphic trigger referenced columns that do not exist on
-- the other table. PostgreSQL resolves NEW fields before boolean short-circuit
-- evaluation, so ordinary non-admin updates could fail at runtime.
create or replace function public.protect_scope_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_is_admin boolean := coalesce(public.get_user_role() = 'admin', false);
begin
  if v_is_admin then return new; end if;

  if tg_table_name = 'projects' then
    if tg_op = 'INSERT' and (
      coalesce(nullif(v_new->>'price', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'budget_percentage', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'overhead_percentage', '')::numeric, 0) <> 0
    ) then
      raise exception 'Admin role required to set project financial values';
    elsif tg_op = 'UPDATE' and (
      v_new->'price' is distinct from v_old->'price'
      or v_new->'budget_percentage' is distinct from v_old->'budget_percentage'
      or v_new->'overhead_percentage' is distinct from v_old->'overhead_percentage'
    ) then
      raise exception 'Admin role required to change project financial values';
    end if;
  elsif tg_table_name = 'realizations' then
    if tg_op = 'INSERT' and (
      coalesce(nullif(v_new->>'contract_amount', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'profit_margin_percent', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'overhead_percent', '')::numeric, 0) <> 0
    ) then
      raise exception 'Admin role required to set realization financial values';
    elsif tg_op = 'UPDATE' and (
      v_new->'contract_amount' is distinct from v_old->'contract_amount'
      or v_new->'profit_margin_percent' is distinct from v_old->'profit_margin_percent'
      or v_new->'overhead_percent' is distinct from v_old->'overhead_percent'
    ) then
      raise exception 'Admin role required to change realization financial values';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_scope_financial_columns() from public, anon, authenticated;

create or replace function public.assert_project_reward_allocation(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool numeric := 0;
  v_percent_total numeric := 0;
  v_desired_total numeric := 0;
begin
  -- Serialize concurrent edits of assignments for one project. Without the
  -- parent-row lock, two individually valid inserts could jointly over-allocate.
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;

  select greatest(0,
    coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100
    - coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100 * coalesce(p.overhead_percentage, 0) / 100
    - coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)
    - coalesce((select sum(pc.amount) from public.project_costs pc where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)
    - coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)
    - coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.project_id = p.id and l.status <> 'reversed'), 0)
  ) into v_pool
  from public.projects p
  where p.id = p_project_id;

  select
    coalesce(sum(coalesce(pm.reward_percentage, 0)) filter (where pm.reward_type = 'percentage'), 0),
    coalesce(sum(case
      when pm.reward_type = 'fixed' then coalesce(pm.reward_amount, 0)
      when pm.reward_type = 'percentage' then v_pool * coalesce(pm.reward_percentage, 0) / 100
      else 0 end), 0)
  into v_percent_total, v_desired_total
  from public.project_members pm
  where pm.project_id = p_project_id;

  if v_percent_total > 100.0001 then
    raise exception 'Project percentage rewards cannot exceed 100%% (current total: %)', v_percent_total;
  end if;
  if v_desired_total > v_pool + 0.01 then
    raise exception 'Project rewards exceed the current team budget by %', round(v_desired_total - v_pool, 2);
  end if;
end;
$$;

create or replace function public.validate_project_reward_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := '{}'::jsonb;
  v_old jsonb := '{}'::jsonb;
  v_project_id uuid;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  v_project_id := nullif(coalesce(
    v_new->>'project_id', v_old->>'project_id',
    case when tg_table_name = 'projects' then coalesce(v_new->>'id', v_old->>'id') end
  ), '')::uuid;
  if v_project_id is null or not exists (select 1 from public.projects where id = v_project_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform public.assert_project_reward_allocation(v_project_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists validate_project_reward_allocation on public.project_members;
create constraint trigger validate_project_reward_allocation
after insert or update or delete on public.project_members
deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

drop trigger if exists validate_project_reward_allocation_on_project on public.projects;
create constraint trigger validate_project_reward_allocation_on_project
after insert or update on public.projects deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

drop trigger if exists validate_project_reward_allocation_on_subcontractor on public.project_subcontractors;
create constraint trigger validate_project_reward_allocation_on_subcontractor
after insert or update or delete on public.project_subcontractors deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

drop trigger if exists validate_project_reward_allocation_on_cost on public.project_costs;
create constraint trigger validate_project_reward_allocation_on_cost
after insert or update or delete on public.project_costs deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

drop trigger if exists validate_project_reward_allocation_on_overhead on public.project_overhead_costs;
create constraint trigger validate_project_reward_allocation_on_overhead
after insert or update or delete on public.project_overhead_costs deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

create or replace function public.assert_realization_reward_allocation(p_realization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool numeric := 0;
  v_percent_total numeric := 0;
  v_desired_total numeric := 0;
begin
  perform 1 from public.realizations where id = p_realization_id for update;
  if not found then raise exception 'Realization not found'; end if;

  select greatest(0,
    coalesce(r.contract_amount, 0)
    + coalesce((select sum(e.sale_amount) from public.realizace_extra_costs e where e.realizace_id = r.id), 0)
    - (coalesce(r.contract_amount, 0) + coalesce((select sum(e.sale_amount) from public.realizace_extra_costs e where e.realizace_id = r.id), 0)) * coalesce(r.profit_margin_percent, 0) / 100
    - (coalesce(r.contract_amount, 0) + coalesce((select sum(e.sale_amount) from public.realizace_extra_costs e where e.realizace_id = r.id), 0)) * coalesce(r.overhead_percent, 0) / 100
    - coalesce((select sum(c.amount) from public.realizace_costs c where c.realizace_id = r.id), 0)
    - coalesce((select sum(e.cost_amount) from public.realizace_extra_costs e where e.realizace_id = r.id), 0)
    - coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.realization_id = r.id and l.status <> 'reversed'), 0)
  ) into v_pool
  from public.realizations r
  where r.id = p_realization_id;

  select
    coalesce(sum(s.share_value) filter (where s.share_type = 'percent'), 0),
    coalesce(sum(case when s.share_type = 'fixed' then s.share_value else v_pool * s.share_value / 100 end), 0)
  into v_percent_total, v_desired_total
  from public.realization_profit_shares s
  where s.realizace_id = p_realization_id;

  if v_percent_total > 100.0001 then
    raise exception 'Percentage realization shares cannot exceed 100%% (current total: %)', v_percent_total;
  end if;
  if v_desired_total > v_pool + 0.01 then
    raise exception 'Realization rewards exceed the current team budget by %', round(v_desired_total - v_pool, 2);
  end if;
end;
$$;

create or replace function public.validate_realization_reward_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := '{}'::jsonb;
  v_old jsonb := '{}'::jsonb;
  v_realization_id uuid;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  v_realization_id := nullif(coalesce(
    v_new->>'realizace_id', v_old->>'realizace_id',
    v_new->>'realization_id', v_old->>'realization_id',
    case when tg_table_name = 'realizations' then coalesce(v_new->>'id', v_old->>'id') end
  ), '')::uuid;
  if v_realization_id is null or not exists (select 1 from public.realizations where id = v_realization_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform public.assert_realization_reward_allocation(v_realization_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists validate_realization_reward_allocation on public.realization_profit_shares;
create constraint trigger validate_realization_reward_allocation
after insert or update or delete on public.realization_profit_shares
deferrable initially immediate
for each row execute function public.validate_realization_reward_allocation();

drop trigger if exists validate_realization_reward_allocation_on_realization on public.realizations;
create constraint trigger validate_realization_reward_allocation_on_realization
after insert or update on public.realizations deferrable initially immediate
for each row execute function public.validate_realization_reward_allocation();

drop trigger if exists validate_realization_reward_allocation_on_cost on public.realizace_costs;
create constraint trigger validate_realization_reward_allocation_on_cost
after insert or update or delete on public.realizace_costs deferrable initially immediate
for each row execute function public.validate_realization_reward_allocation();

drop trigger if exists validate_realization_reward_allocation_on_extra_cost on public.realizace_extra_costs;
create constraint trigger validate_realization_reward_allocation_on_extra_cost
after insert or update or delete on public.realizace_extra_costs deferrable initially immediate
for each row execute function public.validate_realization_reward_allocation();

drop trigger if exists validate_project_reward_allocation_on_labor on public.labor_cost_ledger;
create constraint trigger validate_project_reward_allocation_on_labor
after insert or update or delete on public.labor_cost_ledger deferrable initially immediate
for each row execute function public.validate_project_reward_allocation();

drop trigger if exists validate_realization_reward_allocation_on_labor on public.labor_cost_ledger;
create constraint trigger validate_realization_reward_allocation_on_labor
after insert or update or delete on public.labor_cost_ledger deferrable initially immediate
for each row execute function public.validate_realization_reward_allocation();

-- New attendance rows must have exactly one financial scope. Existing legacy
-- rows are left available for an explicit cleanup before a later VALIDATE.
alter table public.attendance
  drop constraint if exists attendance_exactly_one_financial_scope_check,
  add constraint attendance_exactly_one_financial_scope_check
    check ((project_id is null) <> (realizace_id is null)) not valid;

revoke all on function public.assert_project_reward_allocation(uuid) from public, anon, authenticated;
revoke all on function public.validate_project_reward_allocation() from public, anon, authenticated;
revoke all on function public.assert_realization_reward_allocation(uuid) from public, anon, authenticated;
revoke all on function public.validate_realization_reward_allocation() from public, anon, authenticated;

create or replace function public.get_member_project_rewards_private_20260721(p_member_id uuid default null)
returns table (
  member_id uuid, project_id uuid, project_name text, project_code text, project_status text,
  reward_type text, reward_percentage numeric, reward_fixed_amount numeric, is_hourly boolean,
  team_budget numeric, total_reward numeric, reserved_or_paid_amount numeric,
  paid_amount numeric, available_balance numeric
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  with project_cost_inputs as (
    select p.id as project_id, p.name as project_name, p.code as project_code, p.status as project_status,
      coalesce(p.price, 0)::numeric as price,
      coalesce(p.budget_percentage, 0)::numeric as budget_percentage,
      coalesce(p.overhead_percentage, 0)::numeric as overhead_percentage,
      coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)::numeric as subcontractor_costs,
      coalesce((select sum(pc.amount) from public.project_costs pc where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)::numeric as unassigned_direct_costs,
      coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)::numeric as allocated_overhead_costs,
      coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.project_id = p.id and l.status <> 'reversed'), 0)::numeric as direct_labor_costs
    from public.projects p
  ), reward_base as (
    select pm.member_id, pci.project_id, pci.project_name, pci.project_code, pci.project_status,
      pm.reward_type, coalesce(pm.reward_percentage, 0)::numeric as reward_percentage,
      coalesce(pm.reward_amount, 0)::numeric as reward_fixed_amount, coalesce(pm.is_hourly, false) as is_hourly,
      ((pci.price * pci.budget_percentage / 100)
        - (pci.price * pci.budget_percentage / 100 * pci.overhead_percentage / 100)
        - pci.subcontractor_costs - pci.unassigned_direct_costs - pci.allocated_overhead_costs
        - pci.direct_labor_costs)::numeric as team_budget_before_draws,
      (coalesce((select sum(pc.amount) from public.project_costs pc
        where pc.project_id = pci.project_id and pc.member_id = pm.member_id and not coalesce(pc.is_attendance_cost, false)), 0)
       + coalesce((select sum(l.sponsor_reward_deduction) from public.labor_cost_ledger l
        where l.project_id = pci.project_id and l.sponsor_member_id = pm.member_id and l.status <> 'reversed'), 0))::numeric as assigned_member_costs
    from public.project_members pm
    join project_cost_inputs pci on pci.project_id = pm.project_id
    where p_member_id is null or pm.member_id = p_member_id
  ), payout_sums as (
    select po.member_id, pi.project_id,
      coalesce(sum(pi.amount) filter (where po.status in ('pending','approved','invoice_uploaded','paid')), 0)::numeric as reserved_or_paid_amount,
      coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
    from public.payout_items pi join public.payouts po on po.id = pi.payout_id
    where pi.project_id is not null and (p_member_id is null or po.member_id = p_member_id)
    group by po.member_id, pi.project_id
  ), calculated as (
    select rb.*,
      case when rb.reward_type = 'fixed' then least(rb.reward_fixed_amount, greatest(0, rb.team_budget_before_draws))
        when rb.reward_type = 'percentage' then greatest(0, rb.team_budget_before_draws) * rb.reward_percentage / 100
        else 0 end::numeric as gross_reward,
      coalesce(ps.reserved_or_paid_amount, 0)::numeric as reserved_or_paid_amount,
      coalesce(ps.paid_amount, 0)::numeric as paid_amount
    from reward_base rb left join payout_sums ps on ps.member_id = rb.member_id and ps.project_id = rb.project_id
  )
  select c.member_id, c.project_id, c.project_name, c.project_code, c.project_status,
    c.reward_type, c.reward_percentage, c.reward_fixed_amount, c.is_hourly,
    c.team_budget_before_draws,
    greatest(0, c.gross_reward - c.assigned_member_costs),
    c.reserved_or_paid_amount, c.paid_amount,
    greatest(0, c.gross_reward - c.assigned_member_costs - c.reserved_or_paid_amount)
  from calculated c order by c.project_code nulls last, c.project_name;
end;
$$;

create or replace function public.get_member_realization_rewards_private_20260721(
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
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  with shares as (
    select rps.realizace_id, rps.share_type, rps.share_value
    from public.realization_profit_shares rps where rps.member_id = p_member_id
  ), edit_items as (
    select pi.realization_id, coalesce(sum(pi.amount), 0)::numeric as amount
    from public.payout_items pi
    where p_edit_payout_id is not null and pi.payout_id = p_edit_payout_id and pi.realization_id is not null
    group by pi.realization_id
  ), reserved as (
    select pi.realization_id,
      coalesce(sum(pi.amount) filter (where po.status in ('pending','approved','invoice_uploaded')), 0)::numeric as reserved_amount,
      coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
    from public.payout_items pi join public.payouts po on po.id = pi.payout_id
    where pi.realization_id is not null and po.member_id = p_member_id
      and po.status in ('pending','approved','invoice_uploaded','paid')
      and (p_edit_payout_id is null or po.id <> p_edit_payout_id)
    group by pi.realization_id
  ), calculated as (
    select r.id, r.name, r.status,
      coalesce(r.contract_amount, 0)::numeric as base_contract_amount,
      coalesce(ec.sale_amount, 0)::numeric as extra_revenue,
      (coalesce(mc.amount, 0) + coalesce(ec.cost_amount, 0) + coalesce(labor.direct_project_cost, 0))::numeric as operational_costs,
      (coalesce(r.contract_amount, 0) + coalesce(ec.sale_amount, 0))::numeric as total_revenue,
      coalesce(r.profit_margin_percent, 0)::numeric as profit_margin_percent,
      coalesce(r.overhead_percent, 0)::numeric as overhead_percent,
      s.share_type, coalesce(s.share_value, 0)::numeric as share_value,
      coalesce(labor.sponsored_deduction, 0)::numeric as sponsored_deduction,
      coalesce(res.reserved_amount, 0)::numeric as reserved_payouts,
      coalesce(res.paid_amount, 0)::numeric as paid_amount,
      coalesce(edit.amount, 0)::numeric as edit_amount
    from public.realizations r join shares s on s.realizace_id = r.id
    left join lateral (select coalesce(sum(rc.amount), 0)::numeric amount from public.realizace_costs rc where rc.realizace_id = r.id) mc on true
    left join lateral (select coalesce(sum(rec.cost_amount), 0)::numeric cost_amount, coalesce(sum(rec.sale_amount), 0)::numeric sale_amount from public.realizace_extra_costs rec where rec.realizace_id = r.id) ec on true
    left join lateral (select coalesce(sum(l.project_cost_impact), 0)::numeric direct_project_cost,
      coalesce(sum(l.sponsor_reward_deduction) filter (where l.sponsor_member_id = p_member_id), 0)::numeric sponsored_deduction
      from public.labor_cost_ledger l where l.realization_id = r.id and l.status <> 'reversed') labor on true
    left join reserved res on res.realization_id = r.id
    left join edit_items edit on edit.realization_id = r.id
  ), budgets as (
    select c.*,
      (c.total_revenue * c.profit_margin_percent / 100)::numeric profit_amount,
      (c.total_revenue * c.overhead_percent / 100)::numeric overhead_amount,
      (c.total_revenue - c.total_revenue * c.profit_margin_percent / 100
        - c.total_revenue * c.overhead_percent / 100 - c.operational_costs)::numeric team_budget
    from calculated c
  ), rewards as (
    select b.*, case when b.share_type = 'fixed' then least(b.share_value, greatest(0, b.team_budget))
      when b.share_type = 'percent' then greatest(0, b.team_budget * b.share_value / 100)
      else 0 end::numeric gross_share
    from budgets b
  )
  select rw.id, rw.name, rw.status, rw.base_contract_amount, rw.extra_revenue,
    rw.operational_costs, rw.total_revenue, rw.profit_margin_percent, rw.overhead_percent,
    rw.profit_amount, rw.overhead_amount, rw.team_budget, rw.share_type, rw.share_value,
    rw.gross_share, rw.sponsored_deduction,
    greatest(0, rw.gross_share - rw.sponsored_deduction)::numeric,
    rw.reserved_payouts, rw.paid_amount,
    greatest(0, rw.gross_share - rw.sponsored_deduction - rw.reserved_payouts - rw.paid_amount + rw.edit_amount)::numeric
  from rewards rw order by rw.name;
end;
$$;

revoke all on function public.get_member_project_rewards_private_20260721(uuid) from public, anon, authenticated;
revoke all on function public.get_member_realization_rewards_private_20260721(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_member_project_rewards_private_20260721(uuid) to service_role;
grant execute on function public.get_member_realization_rewards_private_20260721(uuid, uuid) to service_role;

create or replace function public.get_my_realization_reward(p_realization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member_id uuid := public.get_member_id();
  v_row record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_member_id is null then raise exception 'Member profile not found'; end if;

  select * into v_row
  from public.get_member_realization_rewards(v_member_id, null)
  where id = p_realization_id
  limit 1;

  if not found then
    return jsonb_build_object('realization_id', p_realization_id, 'member_id', v_member_id,
      'has_reward', false, 'share_type', null, 'share_value', 0, 'gross_reward', 0,
      'sponsored_labor_deduction', 0, 'net_reward', 0);
  end if;

  return jsonb_build_object('realization_id', p_realization_id, 'member_id', v_member_id,
    'has_reward', true, 'share_type', v_row.share_type, 'share_value', v_row.share_value,
    'gross_reward', v_row.gross_share,
    'sponsored_labor_deduction', v_row.sponsored_labor_deduction,
    'net_reward', v_row.total_share);
end;
$$;

revoke all on function public.get_my_realization_reward(uuid) from public, anon;
grant execute on function public.get_my_realization_reward(uuid) to authenticated, service_role;

create or replace function public.replace_realization_profit_shares(p_realization_id uuid, p_shares jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb; v_after jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then raise exception 'Admin role required to change realization rewards'; end if;
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then raise exception 'Shares payload must be an array'; end if;
  if not exists (select 1 from public.realizations r where r.id = p_realization_id for update) then raise exception 'Realization not found'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb)) x(member_id uuid, share_type text, share_value numeric, note text)
    where x.member_id is null or x.share_type not in ('percent','fixed') or x.share_value is null or x.share_value < 0) then
    raise exception 'Invalid realization reward row';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb)) x(member_id uuid, share_type text, share_value numeric, note text)
    group by x.member_id having count(*) > 1) then raise exception 'A member can have only one realization reward'; end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]'::jsonb) into v_before
  from public.realization_profit_shares s where s.realizace_id = p_realization_id;

  set constraints validate_realization_reward_allocation deferred;
  delete from public.realization_profit_shares where realizace_id = p_realization_id;
  insert into public.realization_profit_shares (realizace_id, member_id, share_type, share_value, note)
  select p_realization_id, x.member_id, x.share_type, x.share_value, nullif(x.note, '')
  from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb)) x(member_id uuid, share_type text, share_value numeric, note text);
  perform public.assert_realization_reward_allocation(p_realization_id);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]'::jsonb) into v_after
  from public.realization_profit_shares s where s.realizace_id = p_realization_id;
  perform public.log_workflow_audit('realization_profit_shares_replaced', jsonb_build_object('realization_id', p_realization_id, 'before', v_before, 'after', v_after));
  return jsonb_build_object('realization_id', p_realization_id, 'shares', v_after);
end;
$$;

revoke all on function public.replace_realization_profit_shares(uuid, jsonb) from public, anon;
grant execute on function public.replace_realization_profit_shares(uuid, jsonb) to authenticated, service_role;

-- Serialize project assignment writes before the internal implementation reads
-- and validates the remaining reward pool. The constraint triggers below are
-- still the final guard for direct table writes and related cost changes.
create or replace function public.save_project_member_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project compensation assignments';
  end if;
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;
  return public.save_project_member_safe_admin_internal(p_project_id, p_assignment_id, p_payload);
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.save_project_subcontractor_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project subcontractor amounts';
  end if;
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;
  return public.save_project_subcontractor_safe_admin_internal(p_project_id, p_assignment_id, p_payload);
end;
$$;

revoke all on function public.save_project_subcontractor_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_subcontractor_safe(uuid, uuid, jsonb) to authenticated, service_role;

comment on function public.get_member_project_rewards_private_20260721(uuid) is
  'Canonical project entitlement: paid/reserved reward draws reduce the member balance once, not the shared reward base.';
comment on function public.get_member_realization_rewards_private_20260721(uuid, uuid) is
  'Canonical realization entitlement using ledger labor cost and single deduction of paid/reserved reward draws.';

create or replace function public.realization_financial_summary_admin_internal(p_realization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean;
  v_is_member boolean;
  v_summary jsonb;
begin
  if p_realization_id is null then raise exception 'realization_id is required'; end if;
  v_can_admin := coalesce(public.get_user_role() = 'admin', false) or exists (
    select 1 from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('realizace','realizations','payouts','finance') and rp.can_admin = true
  );
  v_is_member := exists (select 1 from public.realization_profit_shares s where s.realizace_id = p_realization_id and s.member_id = v_current_member_id)
    or exists (select 1 from public.realizations r where r.id = p_realization_id
      and (r.lead_person_id = v_current_member_id or v_current_member_id = any(coalesce(r.team_members, array[]::uuid[]))));
  if not v_can_admin and not v_is_member then raise exception 'Not allowed to read financial summary for this realization'; end if;

  with manual_costs as (
    select coalesce(sum(c.amount), 0)::numeric amount from public.realizace_costs c where c.realizace_id = p_realization_id
  ), extras as (
    select coalesce(sum(e.cost_amount), 0)::numeric cost_amount, coalesce(sum(e.sale_amount), 0)::numeric sale_amount
    from public.realizace_extra_costs e where e.realizace_id = p_realization_id
  ), labor as (
    select coalesce(sum(l.project_cost_impact), 0)::numeric direct_project_cost,
      coalesce(sum(l.employer_cost), 0)::numeric economic_labor_cost
    from public.labor_cost_ledger l where l.realization_id = p_realization_id and l.status <> 'reversed'
  ), payouts as (
    select
      coalesce(sum(i.amount) filter (where p.status in ('pending','approved','invoice_uploaded')), 0)::numeric reserved_payouts,
      coalesce(sum(i.amount) filter (where p.status = 'paid'), 0)::numeric paid_task_payouts
    from public.payout_items i join public.payouts p on p.id = i.payout_id
    where i.realization_id = p_realization_id
  ), paid_hourly as (
    select coalesce(sum(l.pay_amount), 0)::numeric paid_hourly_payouts
    from public.labor_cost_ledger l
    where l.realization_id = p_realization_id and l.status = 'paid'
  ), shares as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', s.member_id, 'member_name', m.name,
      'share_type', s.share_type, 'share_value', coalesce(s.share_value, 0)
    ) order by m.name), '[]'::jsonb) member_shares
    from public.realization_profit_shares s left join public.members m on m.id = s.member_id
    where s.realizace_id = p_realization_id
  ), base as (
    select r.id, r.name, r.status, r.linked_project_id,
      coalesce(r.contract_amount, 0)::numeric base_contract_amount,
      coalesce(e.sale_amount, 0)::numeric extra_revenue,
      coalesce(mc.amount, 0)::numeric manual_costs,
      coalesce(e.cost_amount, 0)::numeric extra_costs,
      coalesce(l.direct_project_cost, 0)::numeric direct_labor_costs,
      coalesce(l.economic_labor_cost, 0)::numeric economic_labor_costs,
      coalesce(r.profit_margin_percent, 0)::numeric profit_margin_percent,
      coalesce(r.overhead_percent, 0)::numeric overhead_percent,
      coalesce(p.reserved_payouts, 0)::numeric reserved_payouts,
      coalesce(p.paid_task_payouts, 0)::numeric paid_task_payouts,
      coalesce(ph.paid_hourly_payouts, 0)::numeric paid_hourly_payouts,
      coalesce(s.member_shares, '[]'::jsonb) member_shares
    from public.realizations r cross join manual_costs mc cross join extras e cross join labor l
      cross join payouts p cross join paid_hourly ph cross join shares s
    where r.id = p_realization_id
  ), calculated as (
    select b.*,
      (b.base_contract_amount + b.extra_revenue)::numeric total_revenue,
      (b.manual_costs + b.extra_costs + b.direct_labor_costs)::numeric operational_costs
    from base b
  ), budgets as (
    select c.*,
      (c.total_revenue - c.total_revenue * c.profit_margin_percent / 100
        - c.total_revenue * c.overhead_percent / 100 - c.operational_costs)::numeric team_budget
    from calculated c
  )
  select jsonb_build_object(
    'financial_model_version', 2,
    'realization_id', id, 'realization_name', name, 'realization_status', status, 'linked_project_id', linked_project_id,
    'base_contract_amount', base_contract_amount, 'extra_revenue', extra_revenue, 'total_revenue', total_revenue,
    'manual_costs', manual_costs, 'extra_costs', extra_costs,
    'hourly_costs', direct_labor_costs, 'hourly_payout_exposure', economic_labor_costs,
    'direct_labor_costs', direct_labor_costs, 'economic_labor_costs', economic_labor_costs,
    'operational_costs', operational_costs, 'total_costs', operational_costs,
    'costs_before_paid_payouts', operational_costs,
    'paid_task_payouts', paid_task_payouts, 'paid_hourly_payouts', paid_hourly_payouts,
    'paid_payout_costs', paid_task_payouts, 'paid_payouts', paid_task_payouts,
    'reserved_payouts', reserved_payouts,
    'reserved_or_paid_payouts', reserved_payouts + paid_task_payouts,
    'costs_after_paid_payouts', operational_costs + paid_task_payouts,
    'profit_margin_percent', profit_margin_percent, 'overhead_percent', overhead_percent,
    'profit_amount', total_revenue * profit_margin_percent / 100,
    'overhead_amount', total_revenue * overhead_percent / 100,
    'team_budget', team_budget,
    'team_budget_after_paid_payouts', team_budget - paid_task_payouts,
    'available_for_payout', greatest(0, team_budget - paid_task_payouts - reserved_payouts),
    'member_shares', member_shares
  ) into v_summary from budgets;

  if v_summary is null then raise exception 'Realization not found'; end if;
  return v_summary;
end;
$$;

revoke all on function public.realization_financial_summary_admin_internal(uuid) from public, anon, authenticated;
grant execute on function public.realization_financial_summary_admin_internal(uuid) to service_role;

create or replace function public.project_financial_summary_admin_internal(p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean;
  v_is_member boolean;
  v_summary jsonb;
begin
  if p_project_id is null then raise exception 'project_id is required'; end if;
  v_can_admin := coalesce(public.get_user_role() = 'admin', false) or exists (
    select 1 from public.role_permissions rp where rp.role = public.get_user_role()
      and rp.module in ('projects','payouts','finance') and rp.can_admin = true
  );
  v_is_member := exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.member_id = v_current_member_id);
  if not v_can_admin and not v_is_member then raise exception 'Not allowed to read financial summary for this project'; end if;

  with base as (
    select p.id, p.name, p.code, p.status, coalesce(p.price, 0)::numeric price,
      coalesce(p.budget_percentage, 0)::numeric budget_percentage,
      coalesce(p.overhead_percentage, 0)::numeric overhead_percentage
    from public.projects p where p.id = p_project_id
  ), costs as (
    select
      coalesce(sum(c.amount) filter (where not coalesce(c.is_attendance_cost, false)), 0)::numeric direct_costs,
      coalesce(sum(c.amount) filter (where not coalesce(c.is_attendance_cost, false) and c.member_id is null), 0)::numeric unassigned_direct_costs,
      coalesce(sum(c.amount) filter (where not coalesce(c.is_attendance_cost, false) and c.member_id is not null), 0)::numeric assigned_member_costs,
      coalesce(sum(c.amount) filter (where coalesce(c.is_attendance_cost, false)), 0)::numeric legacy_attendance_costs
    from public.project_costs c where c.project_id = p_project_id
  ), subcontractors as (
    select coalesce(sum(s.price), 0)::numeric amount from public.project_subcontractors s where s.project_id = p_project_id
  ), overhead as (
    select coalesce(sum(o.amount), 0)::numeric amount from public.project_overhead_costs o where o.project_id = p_project_id
  ), labor as (
    select coalesce(sum(l.project_cost_impact), 0)::numeric direct_project_cost,
      coalesce(sum(l.employer_cost), 0)::numeric economic_labor_cost
    from public.labor_cost_ledger l where l.project_id = p_project_id and l.status <> 'reversed'
  ), payouts as (
    select
      coalesce(sum(i.amount) filter (where p.status in ('pending','approved','invoice_uploaded')), 0)::numeric reserved,
      coalesce(sum(i.amount) filter (where p.status = 'paid'), 0)::numeric paid
    from public.payout_items i join public.payouts p on p.id = i.payout_id where i.project_id = p_project_id
  ), paid_hourly as (
    select coalesce(sum(l.pay_amount), 0)::numeric amount from public.labor_cost_ledger l
    where l.project_id = p_project_id and l.status = 'paid'
  ), calculated as (
    select b.*, c.direct_costs, c.unassigned_direct_costs, c.assigned_member_costs, c.legacy_attendance_costs,
      s.amount subcontractor_costs, o.amount allocated_overhead_costs,
      l.direct_project_cost direct_labor_costs, l.economic_labor_cost economic_labor_costs,
      p.reserved reserved_payouts, p.paid paid_task_payouts, ph.amount paid_hourly_payouts,
      (b.price * b.budget_percentage / 100)::numeric gross_project_budget,
      (b.price * b.budget_percentage / 100 * b.overhead_percentage / 100)::numeric planned_overhead_amount
    from base b cross join costs c cross join subcontractors s cross join overhead o
      cross join labor l cross join payouts p cross join paid_hourly ph
  ), budgets as (
    select c.*,
      (c.gross_project_budget - c.planned_overhead_amount - c.subcontractor_costs)::numeric planned_team_budget,
      (c.direct_costs + c.subcontractor_costs + c.allocated_overhead_costs + c.direct_labor_costs)::numeric operational_costs,
      (c.gross_project_budget - c.planned_overhead_amount - c.subcontractor_costs
        - c.unassigned_direct_costs - c.allocated_overhead_costs - c.direct_labor_costs)::numeric reward_base_budget
    from calculated c
  ), rewards as (
    select b.id, coalesce(jsonb_agg(jsonb_build_object(
      'member_id', pm.member_id, 'member_name', m.name, 'reward_type', pm.reward_type,
      'reward_percentage', coalesce(pm.reward_percentage, 0), 'reward_amount', coalesce(pm.reward_amount, 0),
      'is_hourly', coalesce(pm.is_hourly, false),
      'assigned_costs', coalesce(mc.amount, 0) + coalesce(ld.amount, 0),
      'sponsored_labor_costs', coalesce(ld.amount, 0),
      'gross_reward', case when pm.reward_type = 'fixed' then least(coalesce(pm.reward_amount, 0), greatest(0, b.reward_base_budget))
        when pm.reward_type = 'percentage' then greatest(0, b.reward_base_budget) * coalesce(pm.reward_percentage, 0) / 100 else 0 end,
      'total_reward', greatest(0, case when pm.reward_type = 'fixed' then least(coalesce(pm.reward_amount, 0), greatest(0, b.reward_base_budget))
        when pm.reward_type = 'percentage' then greatest(0, b.reward_base_budget) * coalesce(pm.reward_percentage, 0) / 100 else 0 end
        - coalesce(mc.amount, 0) - coalesce(ld.amount, 0))
    ) order by m.name) filter (where pm.id is not null), '[]'::jsonb) member_rewards
    from budgets b
    left join public.project_members pm on pm.project_id = b.id
    left join public.members m on m.id = pm.member_id
    left join lateral (select coalesce(sum(pc.amount), 0)::numeric amount from public.project_costs pc
      where pc.project_id = b.id and pc.member_id = pm.member_id and not coalesce(pc.is_attendance_cost, false)) mc on true
    left join lateral (select coalesce(sum(l.sponsor_reward_deduction), 0)::numeric amount from public.labor_cost_ledger l
      where l.project_id = b.id and l.sponsor_member_id = pm.member_id and l.status <> 'reversed') ld on true
    group by b.id, b.reward_base_budget
  )
  select jsonb_build_object(
    'financial_model_version', 2,
    'project_id', b.id, 'project_name', b.name, 'project_code', b.code, 'project_status', b.status,
    'price', b.price, 'budget_percentage', b.budget_percentage, 'overhead_percentage', b.overhead_percentage,
    'gross_project_budget', b.gross_project_budget, 'planned_margin', b.price - b.gross_project_budget,
    'planned_overhead_amount', b.planned_overhead_amount,
    'manual_costs', b.direct_costs, 'attendance_costs', b.legacy_attendance_costs,
    'hourly_payout_exposure', b.economic_labor_costs,
    'direct_labor_costs', b.direct_labor_costs, 'economic_labor_costs', b.economic_labor_costs,
    'direct_costs', b.direct_costs, 'unassigned_direct_costs', b.unassigned_direct_costs,
    'assigned_member_costs', b.assigned_member_costs, 'subcontractor_costs', b.subcontractor_costs,
    'allocated_overhead_costs', b.allocated_overhead_costs, 'operational_costs', b.operational_costs,
    'team_budget', b.planned_team_budget, 'planned_team_budget', b.planned_team_budget,
    'cost_adjusted_team_budget', b.reward_base_budget, 'remaining_after_costs', b.reward_base_budget,
    'costs_before_paid_payouts', b.operational_costs,
    'paid_task_payouts', b.paid_task_payouts, 'paid_hourly_payouts', b.paid_hourly_payouts,
    'paid_payout_costs', b.paid_task_payouts, 'paid_payouts', b.paid_task_payouts,
    'reserved_payouts', b.reserved_payouts,
    'reserved_or_paid_payouts', b.reserved_payouts + b.paid_task_payouts,
    'costs_after_paid_payouts', b.operational_costs + b.paid_task_payouts,
    'team_budget_after_paid_payouts', b.reward_base_budget - b.paid_task_payouts,
    'available_for_payout', greatest(0, b.reward_base_budget - b.paid_task_payouts - b.reserved_payouts),
    'member_rewards', r.member_rewards
  ) into v_summary from budgets b left join rewards r on r.id = b.id;

  if v_summary is null then raise exception 'Project not found'; end if;
  return v_summary;
end;
$$;

revoke all on function public.project_financial_summary_admin_internal(uuid) from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal(uuid) to service_role;
