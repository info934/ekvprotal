-- Separate planned realization rewards from active financial entitlements.
-- Active rows remain in realization_profit_shares for payout compatibility.

create table if not exists public.realization_reward_plans (
  id uuid primary key default gen_random_uuid(),
  realizace_id uuid not null references public.realizations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  share_type text not null check (share_type in ('percent', 'fixed')),
  share_value numeric not null check (share_value >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (realizace_id, member_id)
);

create index if not exists realization_reward_plans_member_idx
  on public.realization_reward_plans (member_id, realizace_id);

alter table public.realization_reward_plans enable row level security;

drop policy if exists "Realization reward plans admin read" on public.realization_reward_plans;
create policy "Realization reward plans admin read"
on public.realization_reward_plans
for select to authenticated
using (public.get_user_role() = 'admin');

drop policy if exists "Realization reward plans admin write" on public.realization_reward_plans;
create policy "Realization reward plans admin write"
on public.realization_reward_plans
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

revoke all on public.realization_reward_plans from public, anon;
grant select, insert, update, delete on public.realization_reward_plans to authenticated;
grant all on public.realization_reward_plans to service_role;

insert into public.realization_reward_plans (
  realizace_id, member_id, share_type, share_value, note, created_by, updated_by
)
select
  s.realizace_id, s.member_id, s.share_type, s.share_value, s.note, auth.uid(), auth.uid()
from public.realization_profit_shares s
on conflict (realizace_id, member_id) do nothing;

alter table public.realizace_team_members
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references auth.users(id) on delete set null,
  add column if not exists ended_reason text;

create or replace function public.validate_realization_reward_plan_payload(p_shares jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_percent_total numeric;
begin
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then
    raise exception 'Shares payload must be an array';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      x(member_id uuid, share_type text, share_value numeric, note text)
    where x.member_id is null
       or x.share_type not in ('percent', 'fixed')
       or x.share_value is null
       or x.share_value < 0
  ) then
    raise exception 'Invalid realization reward row';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      x(member_id uuid, share_type text, share_value numeric, note text)
    group by x.member_id
    having count(*) > 1
  ) then
    raise exception 'A member can have only one realization reward';
  end if;

  select coalesce(sum(x.share_value) filter (where x.share_type = 'percent'), 0)
  into v_percent_total
  from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
    x(member_id uuid, share_type text, share_value numeric, note text);

  if v_percent_total > 100.0001 then
    raise exception 'Percentage reward total cannot exceed 100 percent';
  end if;
end;
$$;

revoke all on function public.validate_realization_reward_plan_payload(jsonb) from public, anon, authenticated;
grant execute on function public.validate_realization_reward_plan_payload(jsonb) to service_role;

create or replace function public.activate_realization_reward_plan_internal(p_realization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_after jsonb;
begin
  select r.status
  into v_status
  from public.realizations r
  where r.id = p_realization_id
  for update;

  if not found then
    raise exception 'Realization not found';
  end if;
  if v_status not in ('Dokončeno', 'Předáno') then
    raise exception 'Reward plan can be activated only at financial close';
  end if;

  -- Every immediate constraint check sees either an empty set or a valid
  -- prefix of the final allocation, so transaction-wide deferral is not needed.
  delete from public.realization_profit_shares
  where realizace_id = p_realization_id;

  insert into public.realization_profit_shares (
    realizace_id, member_id, share_type, share_value, note
  )
  select
    p.realizace_id, p.member_id, p.share_type, p.share_value, p.note
  from public.realization_reward_plans p
  where p.realizace_id = p_realization_id
  order by
    case when p.share_type = 'fixed' then 0 else 1 end,
    p.share_value,
    p.member_id;

  perform public.assert_realization_reward_allocation(p_realization_id);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at, s.id), '[]'::jsonb)
  into v_after
  from public.realization_profit_shares s
  where s.realizace_id = p_realization_id;

  return v_after;
end;
$$;

revoke all on function public.activate_realization_reward_plan_internal(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_realization_reward_plan_internal(uuid) to service_role;

create or replace function public.replace_realization_reward_plan(
  p_realization_id uuid,
  p_shares jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_before jsonb;
  v_after jsonb;
  v_active jsonb := '[]'::jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change realization reward plan';
  end if;
  perform public.validate_realization_reward_plan_payload(p_shares);

  select r.status
  into v_status
  from public.realizations r
  where r.id = p_realization_id
  for update;
  if not found then raise exception 'Realization not found'; end if;

  if exists (
    select 1
    from public.realizace_team_members a
    where a.realizace_id = p_realization_id
      and a.is_hourly = true
      and a.hourly_funding_mode = 'member_reward'
      and (a.valid_to is null or a.valid_to >= current_date)
      and not exists (
        select 1
        from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
          x(member_id uuid, share_type text, share_value numeric, note text)
        where x.member_id = a.hourly_sponsor_member_id
      )
  ) then
    raise exception 'Reward plan cannot remove a member who funds an active hourly assignment';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
  into v_before
  from public.realization_reward_plans p
  where p.realizace_id = p_realization_id;

  delete from public.realization_reward_plans
  where realizace_id = p_realization_id;

  insert into public.realization_reward_plans (
    realizace_id, member_id, share_type, share_value, note,
    created_by, updated_by
  )
  select
    p_realization_id, x.member_id, x.share_type, x.share_value,
    nullif(x.note, ''), auth.uid(), auth.uid()
  from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
    x(member_id uuid, share_type text, share_value numeric, note text);

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
  into v_after
  from public.realization_reward_plans p
  where p.realizace_id = p_realization_id;

  if v_status in ('Dokončeno', 'Předáno') then
    v_active := public.activate_realization_reward_plan_internal(p_realization_id);
  end if;

  perform public.log_workflow_audit(
    'realization_reward_plan_replaced',
    jsonb_build_object(
      'realization_id', p_realization_id,
      'status', v_status,
      'before', v_before,
      'after', v_after,
      'active_shares', v_active
    )
  );

  return jsonb_build_object(
    'realization_id', p_realization_id,
    'status', v_status,
    'activation_state',
      case when v_status in ('Dokončeno', 'Předáno') then 'active' else 'planned' end,
    'shares', v_after,
    'active_shares', v_active
  );
end;
$$;

revoke all on function public.replace_realization_reward_plan(uuid, jsonb)
  from public, anon;
grant execute on function public.replace_realization_reward_plan(uuid, jsonb)
  to authenticated, service_role;

-- Compatibility RPC: callers now update the plan. Closed realizations also
-- receive the active entitlement in the same transaction.
create or replace function public.replace_realization_profit_shares(
  p_realization_id uuid,
  p_shares jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.replace_realization_reward_plan(p_realization_id, p_shares);
$$;

revoke all on function public.replace_realization_profit_shares(uuid, jsonb)
  from public, anon;
grant execute on function public.replace_realization_profit_shares(uuid, jsonb)
  to authenticated, service_role;

create or replace function public.get_realization_reward_plan(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_planned jsonb;
  v_active jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read realization reward plan';
  end if;

  select r.status into v_status
  from public.realizations r
  where r.id = p_realization_id;
  if not found then raise exception 'Realization not found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'member_id', p.member_id,
    'member_name', m.name,
    'share_type', p.share_type,
    'share_value', p.share_value,
    'note', p.note
  ) order by m.name, p.member_id), '[]'::jsonb)
  into v_planned
  from public.realization_reward_plans p
  left join public.members m on m.id = p.member_id
  where p.realizace_id = p_realization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'member_id', s.member_id,
    'member_name', m.name,
    'share_type', s.share_type,
    'share_value', s.share_value,
    'note', s.note
  ) order by m.name, s.member_id), '[]'::jsonb)
  into v_active
  from public.realization_profit_shares s
  left join public.members m on m.id = s.member_id
  where s.realizace_id = p_realization_id;

  return jsonb_build_object(
    'realization_id', p_realization_id,
    'status', v_status,
    'activation_state',
      case when v_status in ('Dokončeno', 'Předáno') then 'active' else 'planned' end,
    'shares', v_planned,
    'active_shares', v_active
  );
end;
$$;

revoke all on function public.get_realization_reward_plan(uuid) from public, anon;
grant execute on function public.get_realization_reward_plan(uuid)
  to authenticated, service_role;

create or replace function public.realization_financial_preview(
  p_realization_id uuid default null,
  p_overrides jsonb default '{}'::jsonb,
  p_shares jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_status text;
  v_contract numeric := 0;
  v_extra_revenue numeric := 0;
  v_manual_costs numeric := 0;
  v_extra_costs numeric := 0;
  v_direct_labor numeric := 0;
  v_economic_labor numeric := 0;
  v_profit_percent numeric := 0;
  v_overhead_percent numeric := 0;
  v_reserved numeric := 0;
  v_paid_task numeric := 0;
  v_paid_hourly numeric := 0;
  v_total_revenue numeric := 0;
  v_operational_costs numeric := 0;
  v_profit_amount numeric := 0;
  v_overhead_amount numeric := 0;
  v_team_budget numeric := 0;
  v_share_payload jsonb := '[]'::jsonb;
  v_planned jsonb := '[]'::jsonb;
  v_active jsonb := '[]'::jsonb;
  v_sponsor_deductions jsonb := '[]'::jsonb;
  v_percent_total numeric := 0;
  v_allocated_total numeric := 0;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read realization financial preview';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '{}'::jsonb)) <> 'object' then
    raise exception 'Preview overrides must be an object';
  end if;
  if p_shares is not null then
    perform public.validate_realization_reward_plan_payload(p_shares);
  end if;

  if p_realization_id is not null then
    v_base := public.realization_financial_summary_admin_internal(p_realization_id);
    v_status := v_base->>'realization_status';
    v_contract := coalesce((v_base->>'base_contract_amount')::numeric, 0);
    v_extra_revenue := coalesce((v_base->>'extra_revenue')::numeric, 0);
    v_manual_costs := coalesce((v_base->>'manual_costs')::numeric, 0);
    v_extra_costs := coalesce((v_base->>'extra_costs')::numeric, 0);
    v_direct_labor := coalesce((v_base->>'direct_labor_costs')::numeric, 0);
    v_economic_labor := coalesce((v_base->>'economic_labor_costs')::numeric, 0);
    v_profit_percent := coalesce((v_base->>'profit_margin_percent')::numeric, 0);
    v_overhead_percent := coalesce((v_base->>'overhead_percent')::numeric, 0);
    v_reserved := coalesce((v_base->>'reserved_payouts')::numeric, 0);
    v_paid_task := coalesce((v_base->>'paid_task_payouts')::numeric, 0);
    v_paid_hourly := coalesce((v_base->>'paid_hourly_payouts')::numeric, 0);

    select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', p.member_id,
      'member_name', m.name,
      'share_type', p.share_type,
      'share_value', p.share_value,
      'note', p.note
    ) order by m.name, p.member_id), '[]'::jsonb)
    into v_planned
    from public.realization_reward_plans p
    left join public.members m on m.id = p.member_id
    where p.realizace_id = p_realization_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', s.member_id,
      'member_name', m.name,
      'share_type', s.share_type,
      'share_value', s.share_value,
      'note', s.note
    ) order by m.name, s.member_id), '[]'::jsonb)
    into v_active
    from public.realization_profit_shares s
    left join public.members m on m.id = s.member_id
    where s.realizace_id = p_realization_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'sponsor_member_id', x.sponsor_member_id,
      'amount', x.amount
    ) order by x.sponsor_member_id), '[]'::jsonb)
    into v_sponsor_deductions
    from (
      select l.sponsor_member_id, coalesce(sum(l.sponsor_reward_deduction), 0)::numeric amount
      from public.labor_cost_ledger l
      where l.realization_id = p_realization_id
        and l.status <> 'reversed'
        and l.sponsor_member_id is not null
      group by l.sponsor_member_id
    ) x;
  else
    v_base := jsonb_build_object(
      'realization_id', null,
      'realization_name', null,
      'linked_project_id', null
    );
  end if;

  v_status := coalesce(nullif(p_overrides->>'status', ''), v_status, 'Připravuje se');
  v_contract := coalesce((p_overrides->>'contract_amount')::numeric, v_contract);
  v_profit_percent := coalesce((p_overrides->>'profit_margin_percent')::numeric, v_profit_percent);
  v_overhead_percent := coalesce((p_overrides->>'overhead_percent')::numeric, v_overhead_percent);

  if v_profit_percent < 0 or v_overhead_percent < 0
     or v_profit_percent + v_overhead_percent > 100 then
    raise exception 'Profit margin and overhead must be non-negative and total at most 100 percent';
  end if;

  v_total_revenue := v_contract + v_extra_revenue;
  v_operational_costs := v_manual_costs + v_extra_costs + v_direct_labor;
  v_profit_amount := v_total_revenue * v_profit_percent / 100;
  v_overhead_amount := v_total_revenue * v_overhead_percent / 100;
  v_team_budget := v_total_revenue - v_profit_amount - v_overhead_amount - v_operational_costs;

  v_share_payload := case
    when p_shares is not null then p_shares
    when jsonb_array_length(v_planned) > 0 then v_planned
    else v_active
  end;

  select
    coalesce(sum(x.share_value) filter (where x.share_type = 'percent'), 0),
    coalesce(sum(
      case
        when x.share_type = 'fixed' then x.share_value
        else greatest(v_team_budget, 0) * x.share_value / 100
      end
    ), 0)
  into v_percent_total, v_allocated_total
  from jsonb_to_recordset(coalesce(v_share_payload, '[]'::jsonb))
    x(member_id uuid, member_name text, share_type text, share_value numeric, note text);

  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'financial_model_version', 3,
    'realization_status', v_status,
    'base_contract_amount', v_contract,
    'extra_revenue', v_extra_revenue,
    'total_revenue', v_total_revenue,
    'manual_costs', v_manual_costs,
    'extra_costs', v_extra_costs,
    'hourly_costs', v_direct_labor,
    'direct_labor_costs', v_direct_labor,
    'economic_labor_costs', v_economic_labor,
    'operational_costs', v_operational_costs,
    'total_costs', v_operational_costs,
    'costs_before_paid_payouts', v_operational_costs,
    'paid_task_payouts', v_paid_task,
    'paid_hourly_payouts', v_paid_hourly,
    'paid_payout_costs', v_paid_task,
    'paid_payouts', v_paid_task,
    'reserved_payouts', v_reserved,
    'reserved_or_paid_payouts', v_reserved + v_paid_task,
    'costs_after_paid_payouts', v_operational_costs + v_paid_task,
    'profit_margin_percent', v_profit_percent,
    'overhead_percent', v_overhead_percent,
    'profit_amount', v_profit_amount,
    'overhead_amount', v_overhead_amount,
    'team_budget', v_team_budget,
    'team_budget_after_paid_payouts', v_team_budget - v_paid_task,
    'available_for_payout', greatest(0, v_team_budget - v_paid_task - v_reserved),
    'reward_plan_state',
      case when v_status in ('Dokončeno', 'Předáno') then 'active' else 'planned' end,
    'planned_shares', v_planned,
    'active_shares', v_active,
    'member_shares', v_share_payload,
    'sponsor_deductions', v_sponsor_deductions,
    'planned_percent_total', v_percent_total,
    'planned_allocation_total', v_allocated_total,
    'planned_unallocated', greatest(0, v_team_budget - v_allocated_total),
    'planned_excess', greatest(0, v_allocated_total - greatest(v_team_budget, 0)),
    'allocation_valid',
      v_percent_total <= 100.0001
      and v_allocated_total <= greatest(v_team_budget, 0) + 0.01
  );
end;
$$;

revoke all on function public.realization_financial_preview(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.realization_financial_preview(uuid, jsonb, jsonb)
  to authenticated, service_role;

create or replace function public.update_realization_status(
  p_realization_id uuid,
  p_next_status text,
  p_note text default null
)
returns public.realizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_realization public.realizations;
  v_updated public.realizations;
  v_before_shares jsonb := '[]'::jsonb;
  v_allowed_statuses text[] := array[
    'Připravuje se', 'Probíhá', 'Pozastaveno', 'Dokončeno', 'Předáno', 'waiting_for_approval'
  ];
  v_was_closed boolean;
  v_will_be_closed boolean;
begin
  if not public.can_edit_module('realizace') then
    raise exception 'Nemáte oprávnění měnit stav realizace.';
  end if;
  if p_realization_id is null then raise exception 'Realizace není určena.'; end if;
  if p_next_status is null or not p_next_status = any(v_allowed_statuses) then
    raise exception 'Neplatný stav realizace: %', coalesce(p_next_status, '(prázdný)');
  end if;

  select * into v_realization
  from public.realizations
  where id = p_realization_id
  for update;
  if not found then raise exception 'Realizace nebyla nalezena.'; end if;
  if v_realization.status is not distinct from p_next_status then return v_realization; end if;

  v_was_closed := v_realization.status in ('Dokončeno', 'Předáno');
  v_will_be_closed := p_next_status in ('Dokončeno', 'Předáno');

  if (v_was_closed and not v_will_be_closed) or (not v_was_closed and v_will_be_closed) then
    if v_was_closed and not v_will_be_closed
       and coalesce(public.get_user_role() <> 'admin', true) then
      raise exception 'Pouze administrátor může znovu otevřít realizaci s aktivními podíly.';
    end if;

    select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at, s.id), '[]'::jsonb)
    into v_before_shares
    from public.realization_profit_shares s
    where s.realizace_id = p_realization_id;

    delete from public.realization_profit_shares
    where realizace_id = p_realization_id;
  end if;

  update public.realizations
  set status = p_next_status, updated_at = now()
  where id = p_realization_id
  returning * into v_updated;

  if v_will_be_closed and not v_was_closed then
    perform public.activate_realization_reward_plan_internal(p_realization_id);
  end if;

  perform public.log_workflow_audit(
    'realization_status_update',
    jsonb_build_object(
      'table', 'realizations',
      'id', v_updated.id,
      'realization_id', v_updated.id,
      'old_status', v_realization.status,
      'new_status', v_updated.status,
      'note', p_note,
      'previous_active_shares', v_before_shares,
      'reward_plan_retained', true
    )
  );
  return v_updated;
end;
$$;

revoke all on function public.update_realization_status(uuid, text, text)
  from public, anon;
grant execute on function public.update_realization_status(uuid, text, text)
  to authenticated, service_role;

create or replace function public.save_realization_with_profit_shares(
  p_realization_id uuid,
  p_payload jsonb,
  p_status text,
  p_shares jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_realization_id;
  v_saved public.realizations;
  v_previous_status text;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to save realization finances and rewards';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid realization payload';
  end if;
  perform public.validate_realization_reward_plan_payload(p_shares);
  if coalesce((p_payload->>'profit_margin_percent')::numeric, 0)
     + coalesce((p_payload->>'overhead_percent')::numeric, 0) > 100 then
    raise exception 'Profit margin and overhead cannot exceed 100 percent in total';
  end if;

  if v_id is null then
    insert into public.realizations (
      name, location_address, type, status, start_date, investor_id, lead_person_id, team_members,
      budget, planned_end_date, actual_end_date, contract_amount, expected_total_cost,
      profit_margin_percent, overhead_percent, crm_opportunity_id, updated_at
    ) values (
      nullif(p_payload->>'name', ''),
      nullif(p_payload->>'location_address', ''),
      nullif(p_payload->>'type', ''),
      coalesce(nullif(p_status, ''), 'Připravuje se'),
      nullif(p_payload->>'start_date', '')::date,
      nullif(p_payload->>'investor_id', '')::uuid,
      nullif(p_payload->>'lead_person_id', '')::uuid,
      array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'team_members', '[]'::jsonb))),
      coalesce((p_payload->>'budget')::numeric, 0),
      nullif(p_payload->>'planned_end_date', '')::date,
      nullif(p_payload->>'actual_end_date', '')::date,
      coalesce((p_payload->>'contract_amount')::numeric, 0),
      coalesce((p_payload->>'expected_total_cost')::numeric, 0),
      coalesce((p_payload->>'profit_margin_percent')::numeric, 0),
      coalesce((p_payload->>'overhead_percent')::numeric, 0),
      nullif(p_payload->>'crm_opportunity_id', '')::uuid,
      now()
    )
    returning * into v_saved;
    v_id := v_saved.id;
    v_previous_status := null;
  else
    select r.status into v_previous_status
    from public.realizations r
    where r.id = v_id
    for update;
    if not found then raise exception 'Realization not found'; end if;

    -- Remove active entitlements before financial fields change. Planned rows
    -- remain available and the final active set is rebuilt below.
    delete from public.realization_profit_shares
    where realizace_id = v_id;

    update public.realizations
    set
      name = nullif(p_payload->>'name', ''),
      location_address = nullif(p_payload->>'location_address', ''),
      type = nullif(p_payload->>'type', ''),
      status = coalesce(nullif(p_status, ''), status),
      start_date = nullif(p_payload->>'start_date', '')::date,
      investor_id = nullif(p_payload->>'investor_id', '')::uuid,
      lead_person_id = nullif(p_payload->>'lead_person_id', '')::uuid,
      team_members = array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'team_members', '[]'::jsonb))),
      planned_end_date = nullif(p_payload->>'planned_end_date', '')::date,
      actual_end_date = nullif(p_payload->>'actual_end_date', '')::date,
      contract_amount = coalesce((p_payload->>'contract_amount')::numeric, 0),
      profit_margin_percent = coalesce((p_payload->>'profit_margin_percent')::numeric, 0),
      overhead_percent = coalesce((p_payload->>'overhead_percent')::numeric, 0),
      crm_opportunity_id = nullif(p_payload->>'crm_opportunity_id', '')::uuid,
      updated_at = now()
    where id = v_id
    returning * into v_saved;
  end if;

  perform public.replace_realization_reward_plan(v_id, coalesce(p_shares, '[]'::jsonb));

  if v_previous_status is distinct from v_saved.status then
    perform public.log_workflow_audit(
      'realization_status_update',
      jsonb_build_object(
        'table', 'realizations',
        'id', v_id,
        'realization_id', v_id,
        'old_status', v_previous_status,
        'new_status', v_saved.status,
        'note', 'atomic_realization_form_update',
        'reward_plan_retained', true
      )
    );
  end if;

  select * into v_saved
  from public.realizations
  where id = v_id;

  return jsonb_build_object(
    'realization', to_jsonb(v_saved),
    'financial_preview', public.realization_financial_preview(v_id, '{}'::jsonb, null)
  );
end;
$$;

revoke all on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb)
  to authenticated, service_role;

create or replace function public.end_realization_team_assignment(
  p_assignment_id uuid,
  p_valid_to date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.realizace_team_members;
  v_last_work_date date;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to end realization assignment';
  end if;
  if p_valid_to is null then raise exception 'Assignment end date is required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Assignment end reason is required'; end if;

  select * into v_assignment
  from public.realizace_team_members
  where id = p_assignment_id
  for update;
  if not found then raise exception 'Realization assignment not found'; end if;
  if p_valid_to < coalesce(v_assignment.valid_from, p_valid_to) then
    raise exception 'Assignment end date cannot precede its start date';
  end if;

  select max(l.work_date)
  into v_last_work_date
  from public.labor_cost_ledger l
  where l.realization_id = v_assignment.realizace_id
    and l.member_id = v_assignment.member_id
    and l.status <> 'reversed';

  if v_last_work_date is not null and p_valid_to < v_last_work_date then
    raise exception 'Assignment cannot end before posted work on %', v_last_work_date;
  end if;

  update public.realizace_team_members
  set
    valid_to = p_valid_to,
    ended_at = now(),
    ended_by = auth.uid(),
    ended_reason = trim(p_reason),
    updated_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  perform public.log_workflow_audit(
    'realization_team_assignment_ended',
    jsonb_build_object(
      'realization_id', v_assignment.realizace_id,
      'assignment_id', v_assignment.id,
      'member_id', v_assignment.member_id,
      'valid_to', v_assignment.valid_to,
      'reason', v_assignment.ended_reason,
      'last_posted_work_date', v_last_work_date,
      'historical_ledger_retained', true
    )
  );

  return jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'impact', jsonb_build_object(
      'historical_ledger_retained', true,
      'last_posted_work_date', v_last_work_date,
      'future_attendance_allowed', false
    )
  );
end;
$$;

revoke all on function public.end_realization_team_assignment(uuid, date, text)
  from public, anon;
grant execute on function public.end_realization_team_assignment(uuid, date, text)
  to authenticated, service_role;

create or replace function public.validate_labor_funding_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hourly_funding_mode = 'member_reward' then
    if tg_table_name = 'project_members' and not exists (
      select 1
      from public.project_members sponsor
      where sponsor.project_id = new.project_id
        and sponsor.member_id = new.hourly_sponsor_member_id
        and sponsor.reward_type in ('fixed', 'percentage')
    ) then
      raise exception 'Hourly sponsor must be a rewarded member of the same project';
    end if;

    if tg_table_name = 'realizace_team_members' and not exists (
      select 1
      from public.realization_reward_plans sponsor
      where sponsor.realizace_id = new.realizace_id
        and sponsor.member_id = new.hourly_sponsor_member_id
    ) then
      raise exception 'Hourly sponsor must have a planned reward in the same realization';
    end if;
  end if;
  return new;
end;
$$;

comment on table public.realization_reward_plans is
  'Planned realization rewards editable during delivery; activated into realization_profit_shares only at financial close.';
comment on function public.realization_financial_preview(uuid, jsonb, jsonb) is
  'Canonical DB-owned realization financial preview for forms and details, including proposed reward allocation.';
comment on function public.end_realization_team_assignment(uuid, date, text) is
  'Ends assignment validity without deleting historical labor and audit records.';
