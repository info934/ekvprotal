-- Enforce member-level net entitlement and preserve assignment history.

alter table public.project_members
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references auth.users(id) on delete set null;

alter table public.labor_assignment_audit
  add column if not exists correlation_id uuid,
  add column if not exists audit_layer text not null default 'row_change';

create index if not exists idx_labor_assignment_audit_correlation
  on public.labor_assignment_audit(correlation_id) where correlation_id is not null;

create or replace function public.audit_labor_assignment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_correlation text := nullif(current_setting('app.reward_audit_correlation', true), '');
begin
  insert into public.labor_assignment_audit (
    scope_type, assignment_id, action, old_data, new_data, changed_by,
    changed_by_email, correlation_id, audit_layer
  ) values (
    case when tg_table_name = 'project_members' then 'project' else 'realization' end,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op), v_old, v_new, auth.uid(), auth.jwt()->>'email',
    case when v_correlation is null then null else v_correlation::uuid end,
    'row_change'
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Single authoritative calculation used by validation and read models.
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
      end::numeric gross
    from inputs i cross join pool p cross join fixed f
  )
  select c.id, c.member_id, m.name, c.reward_type,
    coalesce(c.reward_percentage, 0)::numeric, coalesce(c.reward_amount, 0)::numeric,
    coalesce(c.is_hourly, false), c.valid_from, c.valid_to, c.ended_at,
    c.current_now, c.financially_relevant, c.pool_amount, c.fixed_amount, c.percent_pool,
    c.direct_costs, c.sponsored_costs, (c.direct_costs + c.sponsored_costs)::numeric,
    c.gross, greatest(0, c.gross - c.direct_costs - c.sponsored_costs)::numeric,
    c.reserved, c.paid, (c.reserved + c.paid)::numeric,
    greatest(0, c.gross - c.direct_costs - c.sponsored_costs - c.reserved - c.paid)::numeric
  from calculated c left join public.members m on m.id = c.member_id;
$$;

revoke all on function public.project_member_reward_state(uuid) from public, anon, authenticated;
grant execute on function public.project_member_reward_state(uuid) to service_role;

-- Historical projects may already contain payouts above today's calculated
-- entitlement. Preserve that evidence without allowing the deficit to grow.
-- Every improvement ratchets the permitted legacy deficit down permanently;
-- new assignments have no grandfathered deficit.
create table if not exists public.project_member_reward_guard_baselines (
  assignment_id uuid primary key references public.project_members(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  max_allowed_deficit numeric not null default 0 check (max_allowed_deficit >= 0),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_member_reward_guard_project
  on public.project_member_reward_guard_baselines(project_id, member_id);

alter table public.project_member_reward_guard_baselines enable row level security;
revoke all on table public.project_member_reward_guard_baselines from public, anon, authenticated;
grant all on table public.project_member_reward_guard_baselines to service_role;

insert into public.project_member_reward_guard_baselines (
  assignment_id, project_id, member_id, max_allowed_deficit
)
select s.assignment_id, p.id, s.member_id,
  greatest(0, s.committed_amount - s.net_reward)
from public.projects p
cross join lateral public.project_member_reward_state(p.id) s
where s.committed_amount > s.net_reward + 0.01
on conflict (assignment_id) do nothing;

alter function public.project_financial_summary_admin_internal(uuid)
  rename to project_financial_summary_admin_internal_legacy_20260812_net;

revoke all on function public.project_financial_summary_admin_internal_legacy_20260812_net(uuid)
  from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal_legacy_20260812_net(uuid)
  to service_role;

create function public.project_financial_summary_admin_internal(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_summary jsonb;
  v_member_rewards jsonb := '[]'::jsonb;
  v_fixed_total numeric := 0;
  v_percentage_total numeric := 0;
  v_percentage_pool numeric := 0;
begin
  v_summary := public.project_financial_summary_admin_internal_legacy_20260812_net(p_project_id);
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id', s.assignment_id,
      'member_id', s.member_id,
      'member_name', s.member_name,
      'reward_type', s.reward_type,
      'reward_percentage', s.reward_percentage,
      'reward_amount', s.reward_amount,
      'is_hourly', s.is_hourly,
      'valid_from', s.valid_from,
      'valid_to', s.valid_to,
      'ended_at', s.ended_at,
      'is_current', s.is_current,
      'percentage_reward_pool', s.percentage_reward_pool,
      'direct_assigned_costs', s.direct_assigned_costs,
      'sponsored_labor_costs', s.sponsored_labor_costs,
      'total_deductions', s.total_deductions,
      'assigned_costs', s.total_deductions,
      'gross_reward', s.gross_reward,
      'total_reward', s.net_reward,
      'reserved_amount', s.reserved_amount,
      'paid_amount', s.paid_amount,
      'reserved_or_paid_amount', s.committed_amount,
      'available_amount', s.available_amount
    ) order by s.member_name) filter (where s.included_in_allocation), '[]'::jsonb),
    coalesce(max(s.fixed_reward_total), 0),
    coalesce(sum(s.reward_percentage) filter (where s.included_in_allocation and s.reward_type = 'percentage'), 0),
    coalesce(max(s.percentage_reward_pool), 0)
  into v_member_rewards, v_fixed_total, v_percentage_total, v_percentage_pool
  from public.project_member_reward_state(p_project_id) s;

  return v_summary || jsonb_build_object(
    'financial_model_version', 4,
    'fixed_reward_commitments', v_fixed_total,
    'percentage_reward_pool', v_percentage_pool,
    'percentage_reward_total', v_percentage_total,
    'unallocated_reward_budget', greatest(0, v_percentage_pool * (100 - least(100, v_percentage_total)) / 100),
    'member_rewards', v_member_rewards
  );
end;
$$;

revoke all on function public.project_financial_summary_admin_internal(uuid) from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal(uuid) to service_role;

create or replace function public.get_member_project_rewards_private_20260721(p_member_id uuid default null)
returns table (
  member_id uuid, project_id uuid, project_name text, project_code text, project_status text,
  reward_type text, reward_percentage numeric, reward_fixed_amount numeric, is_hourly boolean,
  team_budget numeric, total_reward numeric, reserved_or_paid_amount numeric,
  paid_amount numeric, available_balance numeric
)
language sql stable security definer set search_path = '' as $$
  select s.member_id, p.id, p.name, p.code, p.status,
    s.reward_type, s.reward_percentage, s.reward_amount, s.is_hourly,
    s.reward_pool, s.net_reward, s.committed_amount, s.paid_amount, s.available_amount
  from public.projects p
  cross join lateral public.project_member_reward_state(p.id) s
  where s.included_in_allocation and (p_member_id is null or s.member_id = p_member_id)
  order by p.code nulls last, p.name;
$$;

revoke all on function public.get_member_project_rewards_private_20260721(uuid) from public, anon, authenticated;
grant execute on function public.get_member_project_rewards_private_20260721(uuid) to service_role;

create or replace function public.assert_project_reward_allocation(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pool numeric := 0;
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

revoke all on function public.assert_project_reward_allocation(uuid) from public, anon, authenticated;
grant execute on function public.assert_project_reward_allocation(uuid) to service_role;

create or replace function public.save_project_member_safe_admin_internal(
  p_project_id uuid, p_assignment_id uuid default null, p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.project_members;
  v_assignment_id uuid := p_assignment_id;
  v_member_id uuid := nullif(p_payload->>'member_id', '')::uuid;
  v_reactivate boolean := false;
begin
  if p_project_id is null then raise exception 'project_id is required'; end if;
  if v_assignment_id is null and v_member_id is not null then
    select pm.id, (pm.ended_at is not null or (pm.valid_to is not null and pm.valid_to < current_date))
    into v_assignment_id, v_reactivate
    from public.project_members pm where pm.project_id = p_project_id and pm.member_id = v_member_id;
    if found and not v_reactivate then raise exception 'Member is already assigned to this project'; end if;
  end if;

  if v_assignment_id is null then
    insert into public.project_members (
      project_id, member_id, reward_percentage, reward_amount, reward_type, is_hourly,
      valid_from, valid_to, hourly_funding_mode, hourly_sponsor_member_id,
      hourly_sponsor_percent, ended_at, ended_by
    ) values (
      p_project_id, v_member_id, round(nullif(p_payload->>'reward_percentage', '')::numeric, 6),
      nullif(p_payload->>'reward_amount', '')::numeric, nullif(p_payload->>'reward_type', ''),
      coalesce((p_payload->>'is_hourly')::boolean, false),
      coalesce(nullif(p_payload->>'valid_from', '')::date, current_date),
      nullif(p_payload->>'valid_to', '')::date,
      coalesce(nullif(p_payload->>'hourly_funding_mode', ''), 'direct_project'),
      nullif(p_payload->>'hourly_sponsor_member_id', '')::uuid,
      coalesce(nullif(p_payload->>'hourly_sponsor_percent', '')::numeric, 100), null, null
    ) returning * into v_row;
  else
    update public.project_members pm set
      member_id = case when p_payload ? 'member_id' then v_member_id else pm.member_id end,
      reward_percentage = case when p_payload ? 'reward_percentage' then round(nullif(p_payload->>'reward_percentage', '')::numeric, 6) else pm.reward_percentage end,
      reward_amount = case when p_payload ? 'reward_amount' then nullif(p_payload->>'reward_amount', '')::numeric else pm.reward_amount end,
      reward_type = case when p_payload ? 'reward_type' then nullif(p_payload->>'reward_type', '') else pm.reward_type end,
      is_hourly = case when p_payload ? 'is_hourly' then coalesce((p_payload->>'is_hourly')::boolean, false) else pm.is_hourly end,
      valid_from = case when p_payload ? 'valid_from' then coalesce(nullif(p_payload->>'valid_from', '')::date, pm.valid_from) else pm.valid_from end,
      valid_to = case when v_reactivate then nullif(p_payload->>'valid_to', '')::date when p_payload ? 'valid_to' then nullif(p_payload->>'valid_to', '')::date else pm.valid_to end,
      hourly_funding_mode = case when p_payload ? 'hourly_funding_mode' then coalesce(nullif(p_payload->>'hourly_funding_mode', ''), 'direct_project') else pm.hourly_funding_mode end,
      hourly_sponsor_member_id = case when p_payload ? 'hourly_sponsor_member_id' then nullif(p_payload->>'hourly_sponsor_member_id', '')::uuid else pm.hourly_sponsor_member_id end,
      hourly_sponsor_percent = case when p_payload ? 'hourly_sponsor_percent' then coalesce(nullif(p_payload->>'hourly_sponsor_percent', '')::numeric, 100) else pm.hourly_sponsor_percent end,
      ended_at = case when v_reactivate then null else pm.ended_at end,
      ended_by = case when v_reactivate then null else pm.ended_by end
    where pm.id = v_assignment_id and pm.project_id = p_project_id returning * into v_row;
    if v_row.id is null then raise exception 'Project member assignment not found'; end if;
  end if;
  return to_jsonb(v_row) || jsonb_build_object('reactivated', v_reactivate);
end;
$$;

revoke all on function public.save_project_member_safe_admin_internal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_project_member_safe_admin_internal(uuid, uuid, jsonb) to service_role;

create or replace function public.save_project_member_safe(
  p_project_id uuid, p_assignment_id uuid default null, p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb; v_after jsonb; v_result jsonb;
  v_correlation uuid := gen_random_uuid();
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project compensation assignments';
  end if;
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  perform set_config('app.reward_audit_correlation', v_correlation::text, true);
  v_before := public.project_financial_summary_admin_internal(p_project_id);
  v_result := public.save_project_member_safe_admin_internal(
    p_project_id, p_assignment_id, p_payload - 'auto_rebalance_percentages'
  );
  perform public.assert_project_reward_allocation(p_project_id);
  v_after := public.project_financial_summary_admin_internal(p_project_id);
  perform public.log_workflow_audit('project_reward_snapshot', jsonb_build_object(
    'correlation_id', v_correlation, 'audit_layer', 'workflow_summary',
    'project_id', p_project_id,
    'operation', case when coalesce((v_result->>'reactivated')::boolean, false) then 'reactivate' when p_assignment_id is null then 'create' else 'update' end,
    'table', 'project_members', 'item_id', v_result->>'id',
    'before', coalesce(v_before->'member_rewards', '[]'::jsonb),
    'after', coalesce(v_after->'member_rewards', '[]'::jsonb)
  ));
  return v_result;
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.delete_project_member_safe(p_project_id uuid, p_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_member_id uuid; v_before jsonb; v_after jsonb; v_impact jsonb;
  v_correlation uuid := gen_random_uuid();
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to end project compensation assignments';
  end if;
  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  select pm.member_id into v_member_id from public.project_members pm
  where pm.id = p_assignment_id and pm.project_id = p_project_id and pm.ended_at is null;
  if v_member_id is null then raise exception 'Active project member assignment not found'; end if;
  select jsonb_build_object(
    'net_reward', s.net_reward, 'reserved_amount', s.reserved_amount,
    'paid_amount', s.paid_amount, 'direct_assigned_costs', s.direct_assigned_costs,
    'sponsored_labor_costs', s.sponsored_labor_costs
  ) into v_impact from public.project_member_reward_state(p_project_id) s
  where s.assignment_id = p_assignment_id;

  perform set_config('app.reward_audit_correlation', v_correlation::text, true);
  v_before := public.project_financial_summary_admin_internal(p_project_id);
  update public.project_members set ended_at = now(), ended_by = auth.uid(),
    valid_to = case
      when valid_to is null or valid_to > current_date then greatest(valid_from, current_date)
      else valid_to
    end
  where id = p_assignment_id and project_id = p_project_id;
  perform public.assert_project_reward_allocation(p_project_id);
  v_after := public.project_financial_summary_admin_internal(p_project_id);
  perform public.log_workflow_audit('project_reward_snapshot', jsonb_build_object(
    'correlation_id', v_correlation, 'audit_layer', 'workflow_summary',
    'project_id', p_project_id, 'operation', 'end_assignment',
    'table', 'project_members', 'item_id', p_assignment_id, 'member_id', v_member_id,
    'financial_impact', coalesce(v_impact, '{}'::jsonb),
    'before', coalesce(v_before->'member_rewards', '[]'::jsonb),
    'after', coalesce(v_after->'member_rewards', '[]'::jsonb)
  ));
  return;
end;
$$;

revoke all on function public.delete_project_member_safe(uuid, uuid) from public, anon;
grant execute on function public.delete_project_member_safe(uuid, uuid) to authenticated, service_role;

create or replace function public.list_project_members_safe(p_project_id uuid)
returns table (
  id uuid, project_id uuid, member_id uuid, reward_percentage numeric, reward_amount numeric,
  reward_type text, is_hourly boolean, member jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_can_view_finance boolean := public.can_view_project_financials();
  v_current_member_id uuid := public.get_member_id();
begin
  if not public.can_access_project(p_project_id) then raise exception 'Not allowed to read this project team'; end if;
  return query select pm.id, pm.project_id, pm.member_id,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_percentage else null::numeric end,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_amount else null::numeric end,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_type else null::text end,
    coalesce(pm.is_hourly, false),
    jsonb_build_object(
      'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
      'role', case when mr.id is null then null::jsonb else jsonb_build_object('id', mr.id, 'name', mr.name) end,
      'valid_from', pm.valid_from, 'valid_to', pm.valid_to,
      'hourly_funding_mode', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_funding_mode else null end,
      'hourly_sponsor_member_id', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_sponsor_member_id else null end,
      'hourly_sponsor_percent', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_sponsor_percent else null end,
      'hourly_sponsor_name', case when v_can_view_finance or pm.member_id = v_current_member_id then sponsor.name else null end
    )
  from public.project_members pm join public.members m on m.id = pm.member_id
  left join public.member_roles mr on mr.id = m.role_id
  left join public.members sponsor on sponsor.id = pm.hourly_sponsor_member_id
  where pm.project_id = p_project_id and pm.ended_at is null
    and (pm.valid_to is null or pm.valid_to >= current_date)
  order by m.name;
end;
$$;

revoke all on function public.list_project_members_safe(uuid) from public, anon;
grant execute on function public.list_project_members_safe(uuid) to authenticated, service_role;

create or replace function public.validate_project_reward_on_payout_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' and new.project_id is not null then perform public.assert_project_reward_allocation(new.project_id); end if;
  if tg_op <> 'INSERT' and old.project_id is not null
    and (tg_op = 'DELETE' or old.project_id is distinct from new.project_id) then
    perform public.assert_project_reward_allocation(old.project_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists validate_project_reward_on_payout_item on public.payout_items;
create constraint trigger validate_project_reward_on_payout_item
after insert or update or delete on public.payout_items
deferrable initially immediate for each row execute function public.validate_project_reward_on_payout_item();

create or replace function public.validate_project_reward_on_payout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid;
begin
  if new.status is distinct from old.status or new.member_id is distinct from old.member_id then
    for v_project_id in select distinct pi.project_id from public.payout_items pi
      where pi.payout_id = new.id and pi.project_id is not null
    loop perform public.assert_project_reward_allocation(v_project_id); end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_project_reward_on_payout on public.payouts;
create constraint trigger validate_project_reward_on_payout
after update of status, member_id on public.payouts
deferrable initially immediate for each row execute function public.validate_project_reward_on_payout();

revoke all on function public.validate_project_reward_on_payout_item() from public, anon, authenticated;
revoke all on function public.validate_project_reward_on_payout() from public, anon, authenticated;

-- A direct DELETE or identity rewrite would orphan member-level payout history
-- before the AFTER constraint trigger could discover it. Force callers through
-- the safe end-assignment workflow instead.
create or replace function public.protect_project_member_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_has_financial_history boolean := false;
begin
  if tg_op = 'DELETE' then
    -- Allow only an actual parent-project cascade. Ordinary assignment removal
    -- must call delete_project_member_safe(), which records ended_at.
    if not exists (select 1 from public.projects p where p.id = old.project_id) then return old; end if;
    raise exception 'Project member assignments must be ended, not deleted';
  end if;

  if new.member_id is distinct from old.member_id then
    select
      exists (
        select 1 from public.payout_items pi join public.payouts po on po.id = pi.payout_id
        where pi.project_id = old.project_id and po.member_id = old.member_id
          and po.status in ('pending','approved','invoice_uploaded','paid')
      ) or exists (
        select 1 from public.project_costs pc
        where pc.project_id = old.project_id and pc.member_id = old.member_id
          and not coalesce(pc.is_attendance_cost, false)
      ) or exists (
        select 1 from public.labor_cost_ledger l
        where l.project_id = old.project_id and l.sponsor_member_id = old.member_id
          and l.status <> 'reversed'
      ) into v_has_financial_history;
    if v_has_financial_history then
      raise exception 'Member identity cannot be changed after financial history exists; end the assignment and create another one';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_member_history on public.project_members;
create trigger protect_project_member_history
before update of member_id or delete on public.project_members
for each row execute function public.protect_project_member_history();

revoke all on function public.protect_project_member_history() from public, anon, authenticated;

-- Six-decimal normalization preserving the rounded per-project total.
alter table public.project_members disable trigger protect_project_member_compensation;
set constraints validate_project_reward_allocation deferred;
with ordered as (
  select pm.id, pm.project_id, pm.reward_percentage,
    row_number() over (partition by pm.project_id order by pm.id) rn,
    count(*) over (partition by pm.project_id) cnt,
    round(sum(coalesce(pm.reward_percentage, 0)) over (partition by pm.project_id), 6) target_total,
    round(coalesce(pm.reward_percentage, 0), 6) rounded_value
  from public.project_members pm where pm.reward_type = 'percentage'
), adjusted as (
  select o.*, case when o.rn = o.cnt then
    o.rounded_value + (o.target_total - sum(o.rounded_value) over (partition by o.project_id))
    else o.rounded_value end normalized_value
  from ordered o
)
update public.project_members pm set reward_percentage = a.normalized_value
from adjusted a where pm.id = a.id and pm.reward_percentage is distinct from a.normalized_value;
set constraints validate_project_reward_allocation immediate;
alter table public.project_members enable trigger protect_project_member_compensation;

comment on function public.project_member_reward_state(uuid) is
  'Canonical fixed-first member entitlement net of direct and sponsored deductions and protected against committed payouts.';
comment on function public.project_financial_summary_admin_internal(uuid) is
  'Canonical project financial model v4 using the same member-level net entitlement for UI, payouts, and validation.';
comment on function public.delete_project_member_safe(uuid, uuid) is
  'Ends assignment validity without deleting financial history, payout links, or audit evidence.';
comment on table public.project_member_reward_guard_baselines is
  'Migration-time legacy payout deficits. Deficits may only decrease; new member reward deficits remain forbidden.';
