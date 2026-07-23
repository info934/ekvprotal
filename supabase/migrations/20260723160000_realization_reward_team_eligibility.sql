-- A reward is an entitlement of a realization team member.  The UI is only a
-- convenience layer; the database remains the financial boundary.

create or replace function public.ensure_realization_reward_plan_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.realizace_team_members assignment
    where assignment.realizace_id = new.realizace_id
      and assignment.member_id = new.member_id
      and assignment.ended_at is null
  ) then
    raise exception 'Realization reward recipient must be an active realization team member';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_realization_reward_plan_team_member on public.realization_reward_plans;
create trigger ensure_realization_reward_plan_team_member
before insert or update of realizace_id, member_id
on public.realization_reward_plans
for each row
execute function public.ensure_realization_reward_plan_team_member();

-- Active shares are created from the plan at financial close.  Keep that
-- provenance explicit without invalidating historical shares after an
-- assignment itself is later ended.
create or replace function public.ensure_realization_profit_share_has_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.realization_reward_plans plan
    where plan.realizace_id = new.realizace_id
      and plan.member_id = new.member_id
  ) then
    raise exception 'Active realization reward must originate from a realization reward plan';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_realization_profit_share_has_plan on public.realization_profit_shares;
create trigger ensure_realization_profit_share_has_plan
before insert or update of realizace_id, member_id
on public.realization_profit_shares
for each row
execute function public.ensure_realization_profit_share_has_plan();

create or replace function public.validate_payout_request_items(
  p_member_id uuid,
  p_items jsonb,
  p_edit_payout_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_availability jsonb;
  v_item jsonb;
  v_amount numeric;
  v_project_id uuid;
  v_realization_id uuid;
  v_available numeric;
  v_already_requested numeric;
  v_total numeric := 0;
  v_requested_by_scope jsonb := '{}'::jsonb;
  v_scope_key text;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;

  v_availability := public.get_payout_availability(p_member_id, p_edit_payout_id);

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    v_project_id := nullif(v_item->>'project_id', '')::uuid;
    v_realization_id := nullif(v_item->>'realization_id', '')::uuid;

    if v_amount <= 0 then
      raise exception 'Payout item amount must be greater than 0';
    end if;
    if (v_project_id is null and v_realization_id is null)
       or (v_project_id is not null and v_realization_id is not null) then
      raise exception 'Each payout item must reference exactly one project or realization';
    end if;

    if v_project_id is not null then
      v_scope_key := 'project:' || v_project_id::text;
      select (item->>'available_balance')::numeric into v_available
      from jsonb_array_elements(v_availability->'projects') item
      where (item->>'project_id')::uuid = v_project_id;
      if v_available is null then
        raise exception 'Project is not available for payout: %', v_project_id;
      end if;
    else
      v_scope_key := 'realization:' || v_realization_id::text;
      select (item->>'available_share')::numeric into v_available
      from jsonb_array_elements(v_availability->'realizations') item
      where (item->>'id')::uuid = v_realization_id;
      if v_available is null then
        raise exception 'Realization is not available for payout: %', v_realization_id;
      end if;
    end if;

    v_already_requested := coalesce((v_requested_by_scope->>v_scope_key)::numeric, 0);
    if v_already_requested + v_amount > v_available + 0.01 then
      raise exception 'Payout amount % exceeds available balance % for %',
        v_already_requested + v_amount, v_available, v_scope_key;
    end if;

    v_requested_by_scope := jsonb_set(
      v_requested_by_scope,
      array[v_scope_key],
      to_jsonb(v_already_requested + v_amount),
      true
    );
    v_total := v_total + v_amount;
  end loop;

  if v_total <= 0 then
    raise exception 'Payout request total must be greater than 0';
  end if;
  return v_total;
end;
$$;

revoke all on function public.ensure_realization_reward_plan_team_member() from public, anon, authenticated;
revoke all on function public.ensure_realization_profit_share_has_plan() from public, anon, authenticated;
revoke all on function public.validate_payout_request_items(uuid, jsonb, uuid) from public, anon;
grant execute on function public.validate_payout_request_items(uuid, jsonb, uuid) to authenticated, service_role;
