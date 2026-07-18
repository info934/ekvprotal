begin;

alter table public.planning_items
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz;

update public.planning_items pi
set
  start_at = (pi.start_date + time '08:00') at time zone coalesce(pp.timezone, 'Europe/Prague'),
  end_at = case
    when pi.item_type = 'milestone' then (pi.start_date + time '08:00') at time zone coalesce(pp.timezone, 'Europe/Prague')
    else (pi.end_date + time '17:00') at time zone coalesce(pp.timezone, 'Europe/Prague')
  end
from public.planning_plans pp
where pp.id = pi.plan_id
  and (pi.start_at is null or pi.end_at is null);

create or replace function public.planning_sync_item_times()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_timezone text;
  v_start_time time;
  v_end_time time;
begin
  select coalesce(pp.timezone, 'Europe/Prague') into v_timezone
  from public.planning_plans pp
  where pp.id = new.plan_id;

  v_timezone := coalesce(v_timezone, 'Europe/Prague');

  if tg_op = 'INSERT' then
    new.start_at := coalesce(new.start_at, (new.start_date + time '08:00') at time zone v_timezone);
    new.end_at := coalesce(
      new.end_at,
      case
        when new.item_type = 'milestone' then new.start_at
        else (new.end_date + time '17:00') at time zone v_timezone
      end
    );
  else
    if new.start_at is distinct from old.start_at then
      new.start_date := (new.start_at at time zone v_timezone)::date;
    elsif new.start_date is distinct from old.start_date then
      v_start_time := (old.start_at at time zone v_timezone)::time;
      new.start_at := (new.start_date + coalesce(v_start_time, time '08:00')) at time zone v_timezone;
    end if;

    if new.end_at is distinct from old.end_at then
      new.end_date := (new.end_at at time zone v_timezone)::date;
    elsif new.end_date is distinct from old.end_date then
      v_end_time := (old.end_at at time zone v_timezone)::time;
      new.end_at := (new.end_date + coalesce(v_end_time, time '17:00')) at time zone v_timezone;
    end if;
  end if;

  if new.item_type = 'milestone' then
    new.end_at := new.start_at;
    new.end_date := new.start_date;
  end if;

  if new.end_at < new.start_at then
    raise exception 'Planning item end must not precede its start';
  end if;

  return new;
end;
$$;

drop trigger if exists planning_items_sync_times on public.planning_items;
create trigger planning_items_sync_times
before insert or update of plan_id, item_type, start_date, end_date, start_at, end_at
on public.planning_items
for each row execute function public.planning_sync_item_times();

alter table public.planning_items
  alter column start_at set not null,
  alter column end_at set not null;

create index if not exists planning_items_plan_times_idx
  on public.planning_items(plan_id, start_at, end_at);

insert into public.planning_assignments (item_id, member_id, role, allocation_percent)
select pi.id, pi.member_id, 'Hlavní řešitel', 100
from public.planning_items pi
where pi.member_id is not null
on conflict (item_id, member_id) do nothing;

create table if not exists public.planning_subcontractor_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.planning_items(id) on delete cascade,
  project_subcontractor_id uuid not null references public.project_subcontractors(id) on delete cascade,
  role text,
  allocation_percent numeric(5,2) not null default 100 check (allocation_percent > 0 and allocation_percent <= 100),
  planned_hours numeric(10,2) check (planned_hours is null or planned_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_subcontractor_assignments_unique unique (item_id, project_subcontractor_id)
);

create index if not exists planning_subcontractor_assignments_item_idx
  on public.planning_subcontractor_assignments(item_id);

create or replace function public.planning_validate_subcontractor_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan_project_id uuid;
  v_subcontractor_project_id uuid;
begin
  select pp.project_id into v_plan_project_id
  from public.planning_items pi
  join public.planning_plans pp on pp.id = pi.plan_id
  where pi.id = new.item_id;

  select ps.project_id into v_subcontractor_project_id
  from public.project_subcontractors ps
  where ps.id = new.project_subcontractor_id;

  if v_plan_project_id is null or v_subcontractor_project_id is distinct from v_plan_project_id then
    raise exception 'Subcontractor assignment must belong to the planned project';
  end if;

  return new;
end;
$$;

drop trigger if exists planning_subcontractor_assignment_validate on public.planning_subcontractor_assignments;
create trigger planning_subcontractor_assignment_validate
before insert or update on public.planning_subcontractor_assignments
for each row execute function public.planning_validate_subcontractor_assignment();

drop trigger if exists planning_subcontractor_assignment_updated_at on public.planning_subcontractor_assignments;
create trigger planning_subcontractor_assignment_updated_at
before update on public.planning_subcontractor_assignments
for each row execute function public.planning_set_updated_at();

create or replace function public.planning_validate_logistics_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item_plan_id uuid;
begin
  if new.item_id is null then
    return new;
  end if;

  select pi.plan_id into v_item_plan_id from public.planning_items pi where pi.id = new.item_id;
  if v_item_plan_id is distinct from new.plan_id then
    raise exception 'Linked planning activity must belong to the same plan';
  end if;

  return new;
end;
$$;

drop trigger if exists planning_travel_validate_item on public.planning_travel_segments;
create trigger planning_travel_validate_item
before insert or update of plan_id, item_id on public.planning_travel_segments
for each row execute function public.planning_validate_logistics_item();

drop trigger if exists planning_accommodation_validate_item on public.planning_accommodations;
create trigger planning_accommodation_validate_item
before insert or update of plan_id, item_id on public.planning_accommodations
for each row execute function public.planning_validate_logistics_item();

create or replace function public.planning_member_is_assignable(p_plan_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_user_role() = 'admin'
    or p_member_id = public.get_member_id()
    or exists (
      select 1
      from public.planning_plans pp
      where pp.id = p_plan_id
        and (
          (pp.project_id is not null and exists (
            select 1 from public.project_members pm
            where pm.project_id = pp.project_id and pm.member_id = p_member_id
          ))
          or (pp.realization_id is not null and exists (
            select 1 from public.realizace_team_members rtm
            where rtm.realizace_id = pp.realization_id and rtm.member_id = p_member_id
          ))
        )
    )
    or exists (
      select 1
      from public.planning_assignments pa
      join public.planning_items pi on pi.id = pa.item_id
      where pi.plan_id = p_plan_id and pa.member_id = p_member_id
    );
$$;

create or replace function public.list_planning_members_safe(p_plan_id uuid)
returns table (
  id uuid,
  name text,
  email text,
  microsoft_calendar_email text,
  microsoft_calendar_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.planning_can_read_plan(p_plan_id) then
    raise exception 'Not allowed to read planning members';
  end if;

  return query
  select
    m.id,
    m.name,
    m.email,
    m.microsoft_calendar_email,
    coalesce(m.microsoft_calendar_enabled, true)
  from public.members m
  left join public.user_account_status uas on uas.auth_user_id = m.auth_user_id
  where coalesce(uas.status, 'active') = 'active'
    and public.planning_member_is_assignable(p_plan_id, m.id)
  order by m.name nulls last, m.email nulls last;
end;
$$;

create or replace function public.list_planning_subcontractors_safe(p_plan_id uuid)
returns table (
  id uuid,
  subject_id uuid,
  name text,
  scope_of_work text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  if not public.planning_can_read_plan(p_plan_id) then
    raise exception 'Not allowed to read planning subcontractors';
  end if;

  select pp.project_id into v_project_id from public.planning_plans pp where pp.id = p_plan_id;
  if v_project_id is null then
    return;
  end if;

  return query
  select ps.id, ps.subject_id, s.name, ps.scope_of_work, ps.status
  from public.project_subcontractors ps
  left join public.subjects s on s.id = ps.subject_id
  where ps.project_id = v_project_id
    and coalesce(ps.status, 'pending') <> 'cancelled'
  order by s.name nulls last, ps.scope_of_work nulls last;
end;
$$;

create or replace function public.replace_planning_item_resources(
  p_item_id uuid,
  p_primary_member_id uuid,
  p_member_assignments jsonb default '[]'::jsonb,
  p_subcontractor_assignments jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_assignment jsonb;
  v_member_id uuid;
begin
  select pi.plan_id into v_plan_id from public.planning_items pi where pi.id = p_item_id;
  if v_plan_id is null or not public.planning_can_edit_plan(v_plan_id) then
    raise exception 'Planning item resource assignment denied';
  end if;

  delete from public.planning_assignments where item_id = p_item_id;
  for v_assignment in select value from jsonb_array_elements(coalesce(p_member_assignments, '[]'::jsonb)) loop
    v_member_id := nullif(v_assignment ->> 'member_id', '')::uuid;
    if v_member_id is null or not public.planning_member_is_assignable(v_plan_id, v_member_id) then
      raise exception 'Member is not assignable to this plan';
    end if;
    insert into public.planning_assignments (item_id, member_id, role, allocation_percent, planned_hours)
    values (
      p_item_id,
      v_member_id,
      nullif(trim(v_assignment ->> 'role'), ''),
      greatest(0.01, least(100, coalesce(nullif(v_assignment ->> 'allocation_percent', '')::numeric, 100))),
      nullif(v_assignment ->> 'planned_hours', '')::numeric
    );
  end loop;

  if p_primary_member_id is not null
     and not exists (select 1 from public.planning_assignments where item_id = p_item_id and member_id = p_primary_member_id) then
    raise exception 'Primary member must be one of the assigned resources';
  end if;

  delete from public.planning_subcontractor_assignments where item_id = p_item_id;
  for v_assignment in select value from jsonb_array_elements(coalesce(p_subcontractor_assignments, '[]'::jsonb)) loop
    insert into public.planning_subcontractor_assignments (
      item_id, project_subcontractor_id, role, allocation_percent, planned_hours
    ) values (
      p_item_id,
      nullif(v_assignment ->> 'project_subcontractor_id', '')::uuid,
      nullif(trim(v_assignment ->> 'role'), ''),
      greatest(0.01, least(100, coalesce(nullif(v_assignment ->> 'allocation_percent', '')::numeric, 100))),
      nullif(v_assignment ->> 'planned_hours', '')::numeric
    );
  end loop;

  update public.planning_items
  set member_id = coalesce(
    p_primary_member_id,
    (select pa.member_id from public.planning_assignments pa where pa.item_id = p_item_id order by pa.created_at limit 1)
  )
  where id = p_item_id;
end;
$$;

create or replace function public.replace_planning_accommodation_guests(
  p_accommodation_id uuid,
  p_member_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_member_id uuid;
begin
  select pa.plan_id into v_plan_id
  from public.planning_accommodations pa
  where pa.id = p_accommodation_id;

  if v_plan_id is null or not public.planning_can_edit_plan(v_plan_id) then
    raise exception 'Planning accommodation guest assignment denied';
  end if;

  delete from public.planning_accommodation_guests where accommodation_id = p_accommodation_id;
  foreach v_member_id in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if not public.planning_member_is_assignable(v_plan_id, v_member_id) then
      raise exception 'Accommodation guest is not assignable to this plan';
    end if;
    insert into public.planning_accommodation_guests (accommodation_id, member_id)
    values (p_accommodation_id, v_member_id)
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.planning_audit_related_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_entity_id uuid;
  v_item_id uuid;
  v_accommodation_id uuid;
begin
  if tg_table_name in ('planning_assignments', 'planning_subcontractor_assignments') then
    v_item_id := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
    select pi.plan_id into v_plan_id from public.planning_items pi where pi.id = v_item_id;
    v_entity_id := v_item_id;
  elsif tg_table_name = 'planning_accommodation_guests' then
    v_accommodation_id := case when tg_op = 'DELETE' then old.accommodation_id else new.accommodation_id end;
    select pa.plan_id into v_plan_id from public.planning_accommodations pa where pa.id = v_accommodation_id;
    v_entity_id := v_accommodation_id;
  elsif tg_table_name = 'planning_baselines' then
    v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
    v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;

  if v_plan_id is not null then
    insert into public.planning_change_log (
      plan_id, entity_type, entity_id, action, actor_user_id, actor_email, before_data, after_data
    ) values (
      v_plan_id,
      tg_table_name,
      v_entity_id,
      lower(tg_op),
      auth.uid(),
      auth.jwt() ->> 'email',
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists planning_assignments_audit on public.planning_assignments;
create trigger planning_assignments_audit after insert or update or delete on public.planning_assignments
for each row execute function public.planning_audit_related_change();

drop trigger if exists planning_subcontractor_assignments_audit on public.planning_subcontractor_assignments;
create trigger planning_subcontractor_assignments_audit after insert or update or delete on public.planning_subcontractor_assignments
for each row execute function public.planning_audit_related_change();

drop trigger if exists planning_accommodation_guests_audit on public.planning_accommodation_guests;
create trigger planning_accommodation_guests_audit after insert or update or delete on public.planning_accommodation_guests
for each row execute function public.planning_audit_related_change();

drop trigger if exists planning_baselines_audit on public.planning_baselines;
create trigger planning_baselines_audit after insert or update or delete on public.planning_baselines
for each row execute function public.planning_audit_related_change();

alter table public.planning_subcontractor_assignments enable row level security;

drop policy if exists "Planning subcontractor assignments visible by plan access" on public.planning_subcontractor_assignments;
create policy "Planning subcontractor assignments visible by plan access"
on public.planning_subcontractor_assignments for select to authenticated
using (exists (
  select 1 from public.planning_items pi
  where pi.id = item_id and public.planning_can_read_plan(pi.plan_id)
));

drop policy if exists "Planning subcontractor assignments editable by plan editors" on public.planning_subcontractor_assignments;
create policy "Planning subcontractor assignments editable by plan editors"
on public.planning_subcontractor_assignments for all to authenticated
using (exists (
  select 1 from public.planning_items pi
  where pi.id = item_id and public.planning_can_edit_plan(pi.plan_id)
))
with check (exists (
  select 1 from public.planning_items pi
  where pi.id = item_id and public.planning_can_edit_plan(pi.plan_id)
));

revoke all on function public.planning_member_is_assignable(uuid, uuid) from public, anon;
revoke all on function public.list_planning_members_safe(uuid) from public, anon;
revoke all on function public.list_planning_subcontractors_safe(uuid) from public, anon;
revoke all on function public.replace_planning_item_resources(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.replace_planning_accommodation_guests(uuid, uuid[]) from public, anon;

grant execute on function public.list_planning_members_safe(uuid) to authenticated, service_role;
grant execute on function public.list_planning_subcontractors_safe(uuid) to authenticated, service_role;
grant execute on function public.replace_planning_item_resources(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.replace_planning_accommodation_guests(uuid, uuid[]) to authenticated, service_role;

grant select, insert, update, delete on public.planning_subcontractor_assignments to authenticated;
grant all on public.planning_subcontractor_assignments to service_role;

comment on function public.list_planning_members_safe(uuid) is
  'Returns active members eligible for the requested project or realization plan, including current assignments.';
comment on table public.planning_subcontractor_assignments is
  'Capacity assignments of project subcontractors to planning activities.';

commit;
