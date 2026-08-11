-- Fixed project rewards reserve money first. Percentage rewards retain their
-- stored shares and are calculated from the residual pool.

create or replace function public.assert_project_reward_allocation(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool numeric := 0;
  v_fixed_total numeric := 0;
  v_percentage_total numeric := 0;
  v_violation record;
begin
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
    coalesce(sum(coalesce(pm.reward_amount, 0)) filter (where pm.reward_type = 'fixed'), 0),
    coalesce(sum(coalesce(pm.reward_percentage, 0)) filter (where pm.reward_type = 'percentage'), 0)
  into v_fixed_total, v_percentage_total
  from public.project_members pm
  where pm.project_id = p_project_id;

  if v_fixed_total > v_pool + 0.01 then
    raise exception 'Fixed project rewards exceed the current team budget by %', round(v_fixed_total - v_pool, 2);
  end if;
  if v_percentage_total > 100.0001 then
    raise exception 'Project percentage rewards cannot exceed 100%% (current total: %)', v_percentage_total;
  end if;

  with member_rewards as (
    select
      pm.member_id,
      m.name as member_name,
      greatest(0,
        case
          when pm.reward_type = 'fixed' then coalesce(pm.reward_amount, 0)
          when pm.reward_type = 'percentage' then greatest(0, v_pool - v_fixed_total) * coalesce(pm.reward_percentage, 0) / 100
          else 0
        end
        - coalesce(costs.amount, 0)
        - coalesce(labor.amount, 0)
      )::numeric as net_reward,
      coalesce(payouts.amount, 0)::numeric as committed_amount
    from public.project_members pm
    left join public.members m on m.id = pm.member_id
    left join lateral (
      select coalesce(sum(pc.amount), 0)::numeric as amount
      from public.project_costs pc
      where pc.project_id = p_project_id
        and pc.member_id = pm.member_id
        and not coalesce(pc.is_attendance_cost, false)
    ) costs on true
    left join lateral (
      select coalesce(sum(l.sponsor_reward_deduction), 0)::numeric as amount
      from public.labor_cost_ledger l
      where l.project_id = p_project_id
        and l.sponsor_member_id = pm.member_id
        and l.status <> 'reversed'
    ) labor on true
    left join lateral (
      select coalesce(sum(pi.amount), 0)::numeric as amount
      from public.payout_items pi
      join public.payouts po on po.id = pi.payout_id
      where pi.project_id = p_project_id
        and po.member_id = pm.member_id
        and po.status in ('pending', 'approved', 'invoice_uploaded', 'paid')
    ) payouts on true
    where pm.project_id = p_project_id
  )
  select * into v_violation
  from member_rewards mr
  where mr.committed_amount > mr.net_reward + 0.01
  order by mr.committed_amount - mr.net_reward desc
  limit 1;

  if found then
    raise exception 'Reward for % would fall below already reserved or paid payouts by %',
      coalesce(v_violation.member_name, v_violation.member_id::text),
      round(v_violation.committed_amount - v_violation.net_reward, 2);
  end if;
end;
$$;

revoke all on function public.assert_project_reward_allocation(uuid) from public, anon, authenticated;
grant execute on function public.assert_project_reward_allocation(uuid) to service_role;

-- Undo only percentages that still exactly match a previously audited
-- automatic rebalance. Later manual edits are intentionally left untouched.
-- The compensation trigger expects an authenticated admin JWT. This migration
-- runs as the database owner, so suspend only that trigger for the audited
-- conversion. The surrounding migration transaction restores it on failure.
alter table public.project_members disable trigger protect_project_member_compensation;

do $$
declare
  v_row record;
begin
  for v_row in
    with event_rows as (
      select
        al.id as audit_id,
        al.created_at,
        (before_row->>'assignment_id')::uuid as assignment_id,
        (before_row->>'reward_percentage')::numeric as percentage_before,
        (after_row->>'reward_percentage')::numeric as percentage_after,
        al.details->>'project_id' as project_id
      from public.audit_logs al
      cross join lateral jsonb_array_elements(coalesce(al.details->'before', '[]'::jsonb)) before_row
      join lateral jsonb_array_elements(coalesce(al.details->'after', '[]'::jsonb)) after_row
        on after_row->>'assignment_id' = before_row->>'assignment_id'
      where al.action = 'project_reward_auto_rebalance'
    ), latest as (
      select distinct on (assignment_id) *
      from event_rows
      order by assignment_id, created_at desc
    )
    select l.*, pm.reward_percentage as current_percentage
    from latest l
    join public.project_members pm on pm.id = l.assignment_id
    where abs(coalesce(pm.reward_percentage, 0) - l.percentage_after) < 0.0000001
      and l.percentage_before between 0 and 100
  loop
    update public.project_members
    set reward_percentage = v_row.percentage_before
    where id = v_row.assignment_id;

    insert into public.audit_logs (user_id, user_email, action, details)
    values (
      null,
      'system@ekvproject.cz',
      'project_reward_fixed_first_conversion',
      jsonb_build_object(
        'project_id', v_row.project_id,
        'assignment_id', v_row.assignment_id,
        'percentage_before', v_row.current_percentage,
        'percentage_after', v_row.percentage_before,
        'source_audit_id', v_row.audit_id,
        'reason', 'Percentage is now a share of the pool remaining after fixed rewards'
      )
    );
  end loop;
end;
$$;

alter table public.project_members enable trigger protect_project_member_compensation;

alter function public.project_financial_summary_admin_internal(uuid)
  rename to project_financial_summary_admin_internal_legacy_20260811;

revoke all on function public.project_financial_summary_admin_internal_legacy_20260811(uuid)
  from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal_legacy_20260811(uuid)
  to service_role;

create function public.project_financial_summary_admin_internal(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_pool numeric := 0;
  v_fixed_total numeric := 0;
  v_percentage_total numeric := 0;
  v_percentage_pool numeric := 0;
  v_member_rewards jsonb := '[]'::jsonb;
begin
  v_summary := public.project_financial_summary_admin_internal_legacy_20260811(p_project_id);
  v_pool := greatest(0, coalesce((v_summary->>'cost_adjusted_team_budget')::numeric, 0));

  select
    coalesce(sum(coalesce(pm.reward_amount, 0)) filter (where pm.reward_type = 'fixed'), 0),
    coalesce(sum(coalesce(pm.reward_percentage, 0)) filter (where pm.reward_type = 'percentage'), 0)
  into v_fixed_total, v_percentage_total
  from public.project_members pm
  where pm.project_id = p_project_id;

  v_percentage_pool := greatest(0, v_pool - v_fixed_total);

  select coalesce(jsonb_agg(jsonb_build_object(
    'member_id', reward_rows.member_id,
    'member_name', reward_rows.member_name,
    'reward_type', reward_rows.reward_type,
    'reward_percentage', reward_rows.reward_percentage,
    'reward_amount', reward_rows.reward_amount,
    'is_hourly', reward_rows.is_hourly,
    'percentage_reward_pool', v_percentage_pool,
    'assigned_costs', reward_rows.assigned_costs + reward_rows.sponsored_labor_costs,
    'sponsored_labor_costs', reward_rows.sponsored_labor_costs,
    'gross_reward', reward_rows.gross_reward,
    'total_reward', reward_rows.total_reward,
    'reserved_amount', reward_rows.reserved_amount,
    'paid_amount', reward_rows.paid_amount,
    'reserved_or_paid_amount', reward_rows.reserved_amount + reward_rows.paid_amount,
    'available_amount', greatest(0, reward_rows.total_reward - reward_rows.reserved_amount - reward_rows.paid_amount)
  ) order by reward_rows.member_name), '[]'::jsonb)
  into v_member_rewards
  from (
    select
      pm.member_id,
      m.name as member_name,
      pm.reward_type,
      coalesce(pm.reward_percentage, 0)::numeric as reward_percentage,
      coalesce(pm.reward_amount, 0)::numeric as reward_amount,
      coalesce(pm.is_hourly, false) as is_hourly,
      coalesce(costs.amount, 0)::numeric as assigned_costs,
      coalesce(labor.amount, 0)::numeric as sponsored_labor_costs,
      case
        when pm.reward_type = 'fixed' then coalesce(pm.reward_amount, 0)
        when pm.reward_type = 'percentage' then v_percentage_pool * coalesce(pm.reward_percentage, 0) / 100
        else 0
      end::numeric as gross_reward,
      greatest(0,
        case
          when pm.reward_type = 'fixed' then coalesce(pm.reward_amount, 0)
          when pm.reward_type = 'percentage' then v_percentage_pool * coalesce(pm.reward_percentage, 0) / 100
          else 0
        end - coalesce(costs.amount, 0) - coalesce(labor.amount, 0)
      )::numeric as total_reward,
      coalesce(payouts.reserved_amount, 0)::numeric as reserved_amount,
      coalesce(payouts.paid_amount, 0)::numeric as paid_amount
    from public.project_members pm
    left join public.members m on m.id = pm.member_id
    left join lateral (
      select coalesce(sum(pc.amount), 0)::numeric as amount
      from public.project_costs pc
      where pc.project_id = p_project_id
        and pc.member_id = pm.member_id
        and not coalesce(pc.is_attendance_cost, false)
    ) costs on true
    left join lateral (
      select coalesce(sum(l.sponsor_reward_deduction), 0)::numeric as amount
      from public.labor_cost_ledger l
      where l.project_id = p_project_id
        and l.sponsor_member_id = pm.member_id
        and l.status <> 'reversed'
    ) labor on true
    left join lateral (
      select
        coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded')), 0)::numeric as reserved_amount,
        coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
      from public.payout_items pi
      join public.payouts po on po.id = pi.payout_id
      where pi.project_id = p_project_id and po.member_id = pm.member_id
    ) payouts on true
    where pm.project_id = p_project_id
  ) reward_rows;

  return v_summary || jsonb_build_object(
    'financial_model_version', 3,
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
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  with project_cost_inputs as (
    select p.id as project_id, p.name as project_name, p.code as project_code, p.status as project_status,
      greatest(0,
        coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100
        - coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100 * coalesce(p.overhead_percentage, 0) / 100
        - coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)
        - coalesce((select sum(pc.amount) from public.project_costs pc where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)
        - coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)
        - coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.project_id = p.id and l.status <> 'reversed'), 0)
      )::numeric as reward_pool
    from public.projects p
  ), fixed_totals as (
    select pm.project_id,
      coalesce(sum(pm.reward_amount) filter (where pm.reward_type = 'fixed'), 0)::numeric as fixed_total
    from public.project_members pm
    group by pm.project_id
  ), reward_base as (
    select pm.member_id, pci.project_id, pci.project_name, pci.project_code, pci.project_status,
      pm.reward_type, coalesce(pm.reward_percentage, 0)::numeric as reward_percentage,
      coalesce(pm.reward_amount, 0)::numeric as reward_fixed_amount, coalesce(pm.is_hourly, false) as is_hourly,
      pci.reward_pool,
      greatest(0, pci.reward_pool - coalesce(ft.fixed_total, 0))::numeric as percentage_reward_pool,
      (coalesce((select sum(pc.amount) from public.project_costs pc
        where pc.project_id = pci.project_id and pc.member_id = pm.member_id and not coalesce(pc.is_attendance_cost, false)), 0)
       + coalesce((select sum(l.sponsor_reward_deduction) from public.labor_cost_ledger l
        where l.project_id = pci.project_id and l.sponsor_member_id = pm.member_id and l.status <> 'reversed'), 0))::numeric as assigned_member_costs
    from public.project_members pm
    join project_cost_inputs pci on pci.project_id = pm.project_id
    left join fixed_totals ft on ft.project_id = pm.project_id
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
      case when rb.reward_type = 'fixed' then rb.reward_fixed_amount
        when rb.reward_type = 'percentage' then rb.percentage_reward_pool * rb.reward_percentage / 100
        else 0 end::numeric as gross_reward,
      coalesce(ps.reserved_or_paid_amount, 0)::numeric as committed_amount,
      coalesce(ps.paid_amount, 0)::numeric as paid_amount
    from reward_base rb left join payout_sums ps on ps.member_id = rb.member_id and ps.project_id = rb.project_id
  )
  select c.member_id, c.project_id, c.project_name, c.project_code, c.project_status,
    c.reward_type, c.reward_percentage, c.reward_fixed_amount, c.is_hourly,
    c.reward_pool,
    greatest(0, c.gross_reward - c.assigned_member_costs),
    c.committed_amount, c.paid_amount,
    greatest(0, c.gross_reward - c.assigned_member_costs - c.committed_amount)
  from calculated c order by c.project_code nulls last, c.project_name;
end;
$$;

revoke all on function public.get_member_project_rewards_private_20260721(uuid) from public, anon, authenticated;
grant execute on function public.get_member_project_rewards_private_20260721(uuid) to service_role;

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
declare
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project compensation assignments';
  end if;

  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;

  v_before := public.project_financial_summary_admin_internal(p_project_id);
  v_result := public.save_project_member_safe_admin_internal(
    p_project_id,
    p_assignment_id,
    p_payload - 'auto_rebalance_percentages'
  );
  perform public.assert_project_reward_allocation(p_project_id);
  v_after := public.project_financial_summary_admin_internal(p_project_id);

  perform public.log_workflow_audit('project_reward_snapshot', jsonb_build_object(
    'project_id', p_project_id,
    'operation', case when p_assignment_id is null then 'create' else 'update' end,
    'table', 'project_members',
    'item_id', coalesce(v_result->>'id', p_assignment_id::text),
    'before', coalesce(v_before->'member_rewards', '[]'::jsonb),
    'after', coalesce(v_after->'member_rewards', '[]'::jsonb),
    'fixed_reward_commitments', v_after->'fixed_reward_commitments',
    'percentage_reward_pool', v_after->'percentage_reward_pool'
  ));

  return v_result;
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;

alter function public.delete_project_member_safe(uuid, uuid)
  rename to delete_project_member_safe_legacy_20260811;

revoke all on function public.delete_project_member_safe_legacy_20260811(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_project_member_safe_legacy_20260811(uuid, uuid)
  to service_role;

create function public.delete_project_member_safe(p_project_id uuid, p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_committed numeric := 0;
  v_before jsonb;
  v_after jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to remove project compensation assignments';
  end if;

  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;

  select pm.member_id into v_member_id
  from public.project_members pm
  where pm.id = p_assignment_id and pm.project_id = p_project_id;
  if v_member_id is null then raise exception 'Project member assignment not found'; end if;

  select coalesce(sum(pi.amount), 0)::numeric into v_committed
  from public.payout_items pi
  join public.payouts po on po.id = pi.payout_id
  where pi.project_id = p_project_id
    and po.member_id = v_member_id
    and po.status in ('pending', 'approved', 'invoice_uploaded', 'paid');

  if v_committed > 0.01 then
    raise exception 'Member cannot be removed while project payouts of % are reserved or paid', round(v_committed, 2);
  end if;

  v_before := public.project_financial_summary_admin_internal(p_project_id);
  perform public.delete_project_member_safe_legacy_20260811(p_project_id, p_assignment_id);
  perform public.assert_project_reward_allocation(p_project_id);
  v_after := public.project_financial_summary_admin_internal(p_project_id);

  perform public.log_workflow_audit('project_reward_snapshot', jsonb_build_object(
    'project_id', p_project_id,
    'operation', 'delete',
    'table', 'project_members',
    'item_id', p_assignment_id,
    'member_id', v_member_id,
    'before', coalesce(v_before->'member_rewards', '[]'::jsonb),
    'after', coalesce(v_after->'member_rewards', '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.delete_project_member_safe(uuid, uuid) from public, anon;
grant execute on function public.delete_project_member_safe(uuid, uuid) to authenticated, service_role;

comment on function public.project_financial_summary_admin_internal(uuid) is
  'Canonical project financial model v3: fixed rewards reserve first, percentages apply to the residual pool, and member payout availability is returned authoritatively.';
