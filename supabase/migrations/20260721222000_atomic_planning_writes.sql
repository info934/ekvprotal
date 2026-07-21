create or replace function public.ensure_planning_plan(p_entity_type text, p_entity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_plan_id uuid;
begin
  if p_entity_type = 'project' then
    if not public.can_edit_module('projects') or not public.can_access_project(p_entity_id) then
      raise exception 'Project planning edit access denied';
    end if;
    insert into public.planning_plans (project_id, title, planned_start, planned_end)
    select p.id, concat(p.code, ' - ', p.name), p.start_date, p.completion_date from public.projects p where p.id = p_entity_id
    on conflict (project_id) where project_id is not null do update set title = excluded.title
    returning id into v_plan_id;
  elsif p_entity_type = 'realization' then
    if not public.can_edit_module('realizace') or not public.can_access_realization(p_entity_id) then
      raise exception 'Realization planning edit access denied';
    end if;
    insert into public.planning_plans (realization_id, title, planned_start, planned_end)
    select r.id, r.name, r.start_date, r.planned_end_date from public.realizations r where r.id = p_entity_id
    on conflict (realization_id) where realization_id is not null do update set title = excluded.title
    returning id into v_plan_id;
  else
    raise exception 'Unsupported planning entity type: %', p_entity_type;
  end if;
  if v_plan_id is null then raise exception 'Planning entity not found'; end if;
  return v_plan_id;
end;
$$;

create or replace function public.save_planning_item_with_resources(
  p_plan_id uuid,
  p_item_id uuid,
  p_item jsonb,
  p_member_assignments jsonb default '[]'::jsonb,
  p_subcontractor_assignments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_assignment jsonb;
  v_member_id uuid;
  v_requested_allocation numeric;
  v_overlapping_allocation numeric;
  v_item_type text := coalesce(nullif(p_item ->> 'item_type', ''), 'task');
  v_primary_member_id uuid := nullif(p_item ->> 'member_id', '')::uuid;
begin
  if not public.planning_can_edit_plan(p_plan_id) then raise exception 'Planning edit access denied'; end if;
  if nullif(btrim(p_item ->> 'name'), '') is null then raise exception 'Planning item name is required'; end if;
  select timezone into v_timezone from public.planning_plans where id = p_plan_id for update;
  if not found then raise exception 'Planning plan not found'; end if;

  v_start_at := (nullif(p_item ->> 'start_at', '')::timestamp at time zone coalesce(v_timezone, 'Europe/Prague'));
  v_end_at := case when v_item_type = 'milestone' then v_start_at
    else (nullif(p_item ->> 'end_at', '')::timestamp at time zone coalesce(v_timezone, 'Europe/Prague')) end;
  if v_start_at is null or v_end_at is null or v_end_at < v_start_at then raise exception 'Invalid planning item time range'; end if;

  if p_item_id is null then
    insert into public.planning_items (
      plan_id, parent_id, item_type, name, description, start_date, end_date, start_at, end_at,
      progress, status, member_id, calendar_sync_enabled, sort_order
    ) values (
      p_plan_id, nullif(p_item ->> 'parent_id', '')::uuid, v_item_type, btrim(p_item ->> 'name'), nullif(btrim(p_item ->> 'description'), ''),
      (v_start_at at time zone v_timezone)::date, (v_end_at at time zone v_timezone)::date, v_start_at, v_end_at,
      greatest(0, least(1, coalesce(nullif(p_item ->> 'progress', '')::numeric, 0))),
      coalesce(nullif(p_item ->> 'status', ''), 'planned'), v_primary_member_id,
      v_item_type <> 'phase' and coalesce((p_item ->> 'calendar_sync_enabled')::boolean, false),
      coalesce(nullif(p_item ->> 'sort_order', '')::integer, 0)
    ) returning id into v_id;
  else
    update public.planning_items set
      parent_id = nullif(p_item ->> 'parent_id', '')::uuid,
      item_type = v_item_type,
      name = btrim(p_item ->> 'name'),
      description = nullif(btrim(p_item ->> 'description'), ''),
      start_at = v_start_at,
      end_at = v_end_at,
      progress = greatest(0, least(1, coalesce(nullif(p_item ->> 'progress', '')::numeric, 0))),
      status = coalesce(nullif(p_item ->> 'status', ''), 'planned'),
      member_id = v_primary_member_id,
      calendar_sync_enabled = v_item_type <> 'phase' and coalesce((p_item ->> 'calendar_sync_enabled')::boolean, false),
      sort_order = coalesce(nullif(p_item ->> 'sort_order', '')::integer, 0)
    where id = p_item_id and plan_id = p_plan_id
    returning id into v_id;
    if v_id is null then raise exception 'Planning item not found in plan'; end if;
  end if;

  perform public.replace_planning_item_resources(v_id, v_primary_member_id, p_member_assignments, p_subcontractor_assignments);

  for v_assignment in
    select value from jsonb_array_elements(coalesce(p_member_assignments, '[]'::jsonb))
  loop
    v_member_id := nullif(v_assignment ->> 'member_id', '')::uuid;
    v_requested_allocation := greatest(
      0.01,
      least(100, coalesce(nullif(v_assignment ->> 'allocation_percent', '')::numeric, 100))
    );

    select coalesce(sum(pa.allocation_percent), 0)
      into v_overlapping_allocation
    from public.planning_assignments pa
    join public.planning_items pi on pi.id = pa.item_id
    where pa.member_id = v_member_id
      and pa.item_id <> v_id
      and pi.status <> 'cancelled'
      and tstzrange(pi.start_at, greatest(pi.end_at, pi.start_at + interval '1 minute'), '[)')
          && tstzrange(v_start_at, greatest(v_end_at, v_start_at + interval '1 minute'), '[)');

    if v_overlapping_allocation + v_requested_allocation > 100 then
      raise exception 'Member capacity exceeded: requested % + overlapping % = %',
        v_requested_allocation, v_overlapping_allocation,
        v_requested_allocation + v_overlapping_allocation;
    end if;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.save_planning_item_with_resources(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_planning_item_with_resources(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
