-- Unified planning board for projections and realizations.
-- Plans remain entity-specific; the portfolio UI only aggregates their safe summaries.

create table if not exists public.planning_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  realization_id uuid references public.realizations(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  timezone text not null default 'Europe/Prague',
  planned_start date,
  planned_end date,
  baseline_version integer not null default 0 check (baseline_version >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_plans_single_entity check (
    (project_id is not null and realization_id is null)
    or (project_id is null and realization_id is not null)
  ),
  constraint planning_plans_valid_dates check (
    planned_end is null or planned_start is null or planned_end >= planned_start
  )
);

create unique index if not exists planning_plans_project_uidx
  on public.planning_plans(project_id) where project_id is not null;
create unique index if not exists planning_plans_realization_uidx
  on public.planning_plans(realization_id) where realization_id is not null;

create table if not exists public.planning_locations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  name text not null,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  source text not null default 'manual' check (source in ('manual', 'project', 'realization', 'routing_api')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_locations_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint planning_locations_longitude_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.planning_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  parent_id uuid references public.planning_items(id) on delete cascade,
  legacy_project_task_id uuid unique references public.project_tasks(id) on delete set null,
  item_type text not null default 'task' check (item_type in ('phase', 'task', 'milestone')),
  name text not null,
  description text,
  start_date date not null,
  end_date date not null,
  progress numeric(5,4) not null default 0 check (progress between 0 and 1),
  status text not null default 'planned' check (status in ('planned', 'ready', 'in_progress', 'blocked', 'done', 'cancelled')),
  member_id uuid references public.members(id) on delete set null,
  location_id uuid references public.planning_locations(id) on delete set null,
  sort_order integer not null default 0,
  color text,
  constraint_type text check (constraint_type is null or constraint_type in ('start_no_earlier', 'finish_no_later', 'must_start', 'must_finish')),
  constraint_date date,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_items_valid_dates check (end_date >= start_date),
  constraint planning_items_milestone_dates check (item_type <> 'milestone' or end_date = start_date)
);

create index if not exists planning_items_plan_dates_idx on public.planning_items(plan_id, start_date, end_date);
create index if not exists planning_items_member_dates_idx on public.planning_items(member_id, start_date, end_date) where member_id is not null;
create index if not exists planning_items_parent_idx on public.planning_items(parent_id) where parent_id is not null;

create or replace function public.planning_validate_item_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_plan uuid;
  v_cycle boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  select plan_id into v_parent_plan from public.planning_items where id = new.parent_id;
  if v_parent_plan is null or v_parent_plan <> new.plan_id then
    raise exception 'Planning parent item must belong to the same plan';
  end if;

  with recursive ancestors(item_id, parent_id) as (
    select pi.id, pi.parent_id from public.planning_items pi where pi.id = new.parent_id
    union
    select pi.id, pi.parent_id
    from public.planning_items pi
    join ancestors a on pi.id = a.parent_id
  )
  select exists(select 1 from ancestors where item_id = new.id) into v_cycle;

  if v_cycle then
    raise exception 'Planning hierarchy would create a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists planning_items_validate_parent on public.planning_items;
create trigger planning_items_validate_parent before insert or update of parent_id, plan_id on public.planning_items
for each row execute function public.planning_validate_item_parent();

create table if not exists public.planning_dependencies (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  predecessor_id uuid not null references public.planning_items(id) on delete cascade,
  successor_id uuid not null references public.planning_items(id) on delete cascade,
  dependency_type text not null default 'fs' check (dependency_type in ('fs', 'ss', 'ff', 'sf')),
  lag_days integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint planning_dependencies_distinct_items check (predecessor_id <> successor_id),
  constraint planning_dependencies_unique unique (predecessor_id, successor_id, dependency_type)
);

create index if not exists planning_dependencies_plan_idx on public.planning_dependencies(plan_id);

create or replace function public.planning_validate_dependency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_predecessor_plan uuid;
  v_successor_plan uuid;
  v_cycle boolean;
begin
  select plan_id into v_predecessor_plan from public.planning_items where id = new.predecessor_id;
  select plan_id into v_successor_plan from public.planning_items where id = new.successor_id;

  if v_predecessor_plan is null or v_successor_plan is null
     or v_predecessor_plan <> new.plan_id or v_successor_plan <> new.plan_id then
    raise exception 'Planning dependency items must belong to the same plan';
  end if;

  with recursive reachable(item_id) as (
    select new.successor_id
    union
    select pd.successor_id
    from public.planning_dependencies pd
    join reachable r on pd.predecessor_id = r.item_id
    where (tg_op <> 'UPDATE' or pd.id <> new.id)
  )
  select exists(select 1 from reachable where item_id = new.predecessor_id) into v_cycle;

  if v_cycle then
    raise exception 'Planning dependency would create a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists planning_dependencies_validate on public.planning_dependencies;
create trigger planning_dependencies_validate before insert or update on public.planning_dependencies
for each row execute function public.planning_validate_dependency();

create table if not exists public.planning_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.planning_items(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  role text,
  allocation_percent numeric(5,2) not null default 100 check (allocation_percent > 0 and allocation_percent <= 100),
  planned_hours numeric(10,2) check (planned_hours is null or planned_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_assignments_unique unique (item_id, member_id)
);

create index if not exists planning_assignments_member_idx on public.planning_assignments(member_id, item_id);

create table if not exists public.planning_travel_segments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  item_id uuid references public.planning_items(id) on delete set null,
  travel_date date not null,
  origin_label text not null,
  destination_label text not null,
  travel_mode text not null default 'car' check (travel_mode in ('car', 'public_transport', 'walk', 'other')),
  route_provider text not null default 'manual' check (route_provider in ('manual', 'mapy', 'google', 'openrouteservice')),
  distance_m integer check (distance_m is null or distance_m >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  departure_at timestamptz,
  arrival_at timestamptz,
  overnight_recommended boolean not null default false,
  overnight_required boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  route_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_travel_valid_times check (arrival_at is null or departure_at is null or arrival_at >= departure_at)
);

create index if not exists planning_travel_plan_date_idx on public.planning_travel_segments(plan_id, travel_date);

create table if not exists public.planning_accommodations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  item_id uuid references public.planning_items(id) on delete set null,
  hotel_name text not null,
  address text,
  check_in date not null,
  check_out date not null,
  status text not null default 'proposal' check (status in ('proposal', 'approval', 'booked', 'completed', 'cancelled')),
  booking_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_accommodations_valid_dates check (check_out > check_in)
);

create index if not exists planning_accommodations_plan_dates_idx on public.planning_accommodations(plan_id, check_in, check_out);

create table if not exists public.planning_accommodation_guests (
  accommodation_id uuid not null references public.planning_accommodations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (accommodation_id, member_id)
);

create table if not exists public.planning_baselines (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  version integer not null,
  label text not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint planning_baselines_unique unique (plan_id, version)
);

create table if not exists public.planning_change_log (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.planning_plans(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists planning_change_log_plan_created_idx on public.planning_change_log(plan_id, created_at desc);

create or replace function public.planning_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists planning_plans_updated_at on public.planning_plans;
create trigger planning_plans_updated_at before update on public.planning_plans
for each row execute function public.planning_set_updated_at();
drop trigger if exists planning_locations_updated_at on public.planning_locations;
create trigger planning_locations_updated_at before update on public.planning_locations
for each row execute function public.planning_set_updated_at();
drop trigger if exists planning_items_updated_at on public.planning_items;
create trigger planning_items_updated_at before update on public.planning_items
for each row execute function public.planning_set_updated_at();
drop trigger if exists planning_assignments_updated_at on public.planning_assignments;
create trigger planning_assignments_updated_at before update on public.planning_assignments
for each row execute function public.planning_set_updated_at();
drop trigger if exists planning_travel_updated_at on public.planning_travel_segments;
create trigger planning_travel_updated_at before update on public.planning_travel_segments
for each row execute function public.planning_set_updated_at();
drop trigger if exists planning_accommodations_updated_at on public.planning_accommodations;
create trigger planning_accommodations_updated_at before update on public.planning_accommodations
for each row execute function public.planning_set_updated_at();

create or replace function public.planning_can_read_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.planning_plans pp
    where pp.id = p_plan_id
      and (
        (pp.project_id is not null and public.can_access_project(pp.project_id))
        or (pp.realization_id is not null and public.can_access_realization(pp.realization_id))
      )
  );
$$;

create or replace function public.planning_can_edit_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.planning_plans pp
    where pp.id = p_plan_id
      and (
        public.get_user_role() = 'admin'
        or (pp.project_id is not null and public.can_edit_module('projects') and public.can_access_project(pp.project_id))
        or (pp.realization_id is not null and public.can_edit_module('realizace') and public.can_access_realization(pp.realization_id))
      )
  );
$$;

create or replace function public.planning_audit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_entity_id uuid;
begin
  v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

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

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists planning_items_audit on public.planning_items;
create trigger planning_items_audit after insert or update or delete on public.planning_items
for each row execute function public.planning_audit_change();
drop trigger if exists planning_dependencies_audit on public.planning_dependencies;
create trigger planning_dependencies_audit after insert or update or delete on public.planning_dependencies
for each row execute function public.planning_audit_change();
drop trigger if exists planning_travel_audit on public.planning_travel_segments;
create trigger planning_travel_audit after insert or update or delete on public.planning_travel_segments
for each row execute function public.planning_audit_change();
drop trigger if exists planning_accommodations_audit on public.planning_accommodations;
create trigger planning_accommodations_audit after insert or update or delete on public.planning_accommodations
for each row execute function public.planning_audit_change();

create or replace function public.ensure_planning_plan(p_entity_type text, p_entity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if p_entity_type = 'project' then
    if not public.can_access_project(p_entity_id) then
      raise exception 'Project planning access denied';
    end if;

    insert into public.planning_plans (project_id, title, planned_start, planned_end)
    select p.id, concat(p.code, ' - ', p.name), p.start_date, p.completion_date
    from public.projects p where p.id = p_entity_id
    on conflict (project_id) where project_id is not null do update set title = excluded.title
    returning id into v_plan_id;
  elsif p_entity_type = 'realization' then
    if not public.can_access_realization(p_entity_id) then
      raise exception 'Realization planning access denied';
    end if;

    insert into public.planning_plans (realization_id, title, planned_start, planned_end)
    select r.id, r.name, r.start_date, r.planned_end_date
    from public.realizations r where r.id = p_entity_id
    on conflict (realization_id) where realization_id is not null do update set title = excluded.title
    returning id into v_plan_id;
  else
    raise exception 'Unsupported planning entity type: %', p_entity_type;
  end if;

  if v_plan_id is null then
    raise exception 'Planning entity not found';
  end if;

  return v_plan_id;
end;
$$;

create or replace function public.list_planning_plans_safe(p_entity_type text default null)
returns table (
  plan_id uuid,
  entity_type text,
  entity_id uuid,
  code text,
  title text,
  plan_status text,
  planned_start date,
  planned_end date,
  location text,
  item_count bigint,
  milestone_count bigint,
  late_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pp.id,
    case when pp.project_id is not null then 'project' else 'realization' end,
    coalesce(pp.project_id, pp.realization_id),
    coalesce(p.code, 'REALIZACE'),
    pp.title,
    pp.status,
    pp.planned_start,
    pp.planned_end,
    coalesce(p.location, r.location_address),
    count(pi.id),
    count(pi.id) filter (where pi.item_type = 'milestone'),
    count(pi.id) filter (where pi.status not in ('done', 'cancelled') and pi.end_date < current_date)
  from public.planning_plans pp
  left join public.projects p on p.id = pp.project_id
  left join public.realizations r on r.id = pp.realization_id
  left join public.planning_items pi on pi.plan_id = pp.id
  where (p_entity_type is null or p_entity_type = case when pp.project_id is not null then 'project' else 'realization' end)
    and public.planning_can_read_plan(pp.id)
  group by pp.id, p.code, p.location, r.location_address
  order by pp.planned_start nulls last, pp.title;
$$;

-- Seed plans for current entities and preserve existing project tasks.
insert into public.planning_plans (project_id, title, planned_start, planned_end, created_by)
select p.id, concat(p.code, ' - ', p.name), p.start_date, p.completion_date, null
from public.projects p
on conflict (project_id) where project_id is not null do nothing;

insert into public.planning_plans (realization_id, title, planned_start, planned_end, created_by)
select r.id, r.name, r.start_date, r.planned_end_date, null
from public.realizations r
on conflict (realization_id) where realization_id is not null do nothing;

insert into public.planning_items (
  plan_id, legacy_project_task_id, item_type, name, description, start_date, end_date,
  progress, status, member_id, created_by
)
select
  pp.id,
  pt.id,
  'task',
  pt.name,
  pt.description,
  pt.start_date,
  pt.end_date,
  case when lower(coalesce(pt.status, '')) in ('hotovo', 'done', 'completed') then 1 else 0 end,
  case
    when lower(coalesce(pt.status, '')) in ('hotovo', 'done', 'completed') then 'done'
    when lower(coalesce(pt.status, '')) in ('v reseni', 'v řešení', 'in_progress') then 'in_progress'
    else 'planned'
  end,
  pt.member_id,
  null
from public.project_tasks pt
join public.planning_plans pp on pp.project_id = pt.project_id
where pt.start_date is not null and pt.end_date is not null
on conflict (legacy_project_task_id) do nothing;

create or replace function public.sync_project_task_to_planning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if current_setting('app.planning_sync', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform set_config('app.planning_sync', '1', true);

  if tg_op = 'DELETE' then
    delete from public.planning_items where legacy_project_task_id = old.id;
    perform set_config('app.planning_sync', '0', true);
    return old;
  end if;

  select id into v_plan_id from public.planning_plans where project_id = new.project_id;
  if v_plan_id is null then
    insert into public.planning_plans (project_id, title, planned_start, planned_end, created_by)
    select p.id, concat(p.code, ' - ', p.name), p.start_date, p.completion_date, auth.uid()
    from public.projects p where p.id = new.project_id
    on conflict (project_id) where project_id is not null do update set title = excluded.title
    returning id into v_plan_id;
  end if;

  insert into public.planning_items (
    plan_id, legacy_project_task_id, item_type, name, description, start_date, end_date,
    progress, status, member_id, created_by
  ) values (
    v_plan_id, new.id, 'task', new.name, new.description, new.start_date, new.end_date,
    case when lower(coalesce(new.status, '')) in ('hotovo', 'done', 'completed') then 1 else 0 end,
    case
      when lower(coalesce(new.status, '')) in ('hotovo', 'done', 'completed') then 'done'
      when lower(coalesce(new.status, '')) in ('v reseni', 'v řešení', 'in_progress') then 'in_progress'
      else 'planned'
    end,
    new.member_id,
    auth.uid()
  )
  on conflict (legacy_project_task_id) do update set
    plan_id = excluded.plan_id,
    name = excluded.name,
    description = excluded.description,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    progress = excluded.progress,
    status = excluded.status,
    member_id = excluded.member_id;

  perform set_config('app.planning_sync', '0', true);
  return new;
end;
$$;

create or replace function public.sync_planning_item_to_project_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_task_id uuid;
  v_status text;
begin
  if current_setting('app.planning_sync', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform set_config('app.planning_sync', '1', true);

  if tg_op = 'DELETE' then
    if old.legacy_project_task_id is not null then
      delete from public.project_tasks where id = old.legacy_project_task_id;
    end if;
    perform set_config('app.planning_sync', '0', true);
    return old;
  end if;

  select project_id into v_project_id from public.planning_plans where id = new.plan_id;
  if v_project_id is null or new.item_type <> 'task' then
    perform set_config('app.planning_sync', '0', true);
    return new;
  end if;

  v_status := case
    when new.status = 'done' then 'Hotovo'
    when new.status in ('in_progress', 'blocked') then 'V řešení'
    else 'Nové'
  end;

  if new.legacy_project_task_id is null then
    insert into public.project_tasks (project_id, name, start_date, end_date, member_id, status, description)
    values (v_project_id, new.name, new.start_date, new.end_date, new.member_id, v_status, new.description)
    returning id into v_task_id;

    update public.planning_items set legacy_project_task_id = v_task_id where id = new.id;
  else
    update public.project_tasks set
      project_id = v_project_id,
      name = new.name,
      start_date = new.start_date,
      end_date = new.end_date,
      member_id = new.member_id,
      status = v_status,
      description = new.description
    where id = new.legacy_project_task_id;
  end if;

  perform set_config('app.planning_sync', '0', true);
  return new;
end;
$$;

drop trigger if exists project_tasks_sync_planning on public.project_tasks;
create trigger project_tasks_sync_planning after insert or update or delete on public.project_tasks
for each row execute function public.sync_project_task_to_planning();

drop trigger if exists planning_items_sync_project_tasks on public.planning_items;
create trigger planning_items_sync_project_tasks after insert or update or delete on public.planning_items
for each row execute function public.sync_planning_item_to_project_task();

create or replace function public.planning_seed_entity_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'projects' then
    insert into public.planning_plans (project_id, title, planned_start, planned_end, created_by)
    values (new.id, concat(new.code, ' - ', new.name), new.start_date, new.completion_date, auth.uid())
    on conflict (project_id) where project_id is not null do nothing;
  else
    insert into public.planning_plans (realization_id, title, planned_start, planned_end, created_by)
    values (new.id, new.name, new.start_date, new.planned_end_date, auth.uid())
    on conflict (realization_id) where realization_id is not null do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_seed_planning_plan on public.projects;
create trigger projects_seed_planning_plan after insert on public.projects
for each row execute function public.planning_seed_entity_plan();
drop trigger if exists realizations_seed_planning_plan on public.realizations;
create trigger realizations_seed_planning_plan after insert on public.realizations
for each row execute function public.planning_seed_entity_plan();

alter table public.planning_plans enable row level security;
alter table public.planning_locations enable row level security;
alter table public.planning_items enable row level security;
alter table public.planning_dependencies enable row level security;
alter table public.planning_assignments enable row level security;
alter table public.planning_travel_segments enable row level security;
alter table public.planning_accommodations enable row level security;
alter table public.planning_accommodation_guests enable row level security;
alter table public.planning_baselines enable row level security;
alter table public.planning_change_log enable row level security;

create policy "Planning plans visible by entity access" on public.planning_plans
for select to authenticated using (public.planning_can_read_plan(id));
create policy "Planning plans editable by entity editors" on public.planning_plans
for all to authenticated using (public.planning_can_edit_plan(id))
with check (
  public.get_user_role() = 'admin'
  or (project_id is not null and public.can_edit_module('projects') and public.can_access_project(project_id))
  or (realization_id is not null and public.can_edit_module('realizace') and public.can_access_realization(realization_id))
);

create policy "Planning locations visible by plan access" on public.planning_locations
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning locations editable by plan editors" on public.planning_locations
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning items visible by plan access" on public.planning_items
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning items editable by plan editors" on public.planning_items
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning dependencies visible by plan access" on public.planning_dependencies
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning dependencies editable by plan editors" on public.planning_dependencies
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning assignments visible by item plan access" on public.planning_assignments
for select to authenticated using (
  exists (select 1 from public.planning_items pi where pi.id = item_id and public.planning_can_read_plan(pi.plan_id))
);
create policy "Planning assignments editable by item plan editors" on public.planning_assignments
for all to authenticated using (
  exists (select 1 from public.planning_items pi where pi.id = item_id and public.planning_can_edit_plan(pi.plan_id))
) with check (
  exists (select 1 from public.planning_items pi where pi.id = item_id and public.planning_can_edit_plan(pi.plan_id))
);

create policy "Planning travel visible by plan access" on public.planning_travel_segments
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning travel editable by plan editors" on public.planning_travel_segments
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning accommodations visible by plan access" on public.planning_accommodations
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning accommodations editable by plan editors" on public.planning_accommodations
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning accommodation guests visible by plan access" on public.planning_accommodation_guests
for select to authenticated using (
  exists (select 1 from public.planning_accommodations pa where pa.id = accommodation_id and public.planning_can_read_plan(pa.plan_id))
);
create policy "Planning accommodation guests editable by plan editors" on public.planning_accommodation_guests
for all to authenticated using (
  exists (select 1 from public.planning_accommodations pa where pa.id = accommodation_id and public.planning_can_edit_plan(pa.plan_id))
) with check (
  exists (select 1 from public.planning_accommodations pa where pa.id = accommodation_id and public.planning_can_edit_plan(pa.plan_id))
);

create policy "Planning baselines visible by plan access" on public.planning_baselines
for select to authenticated using (public.planning_can_read_plan(plan_id));
create policy "Planning baselines editable by plan editors" on public.planning_baselines
for all to authenticated using (public.planning_can_edit_plan(plan_id)) with check (public.planning_can_edit_plan(plan_id));

create policy "Planning change log visible by plan access" on public.planning_change_log
for select to authenticated using (public.planning_can_read_plan(plan_id));

revoke all on function public.planning_can_read_plan(uuid) from public, anon;
revoke all on function public.planning_can_edit_plan(uuid) from public, anon;
revoke all on function public.ensure_planning_plan(text, uuid) from public, anon;
revoke all on function public.list_planning_plans_safe(text) from public, anon;
grant execute on function public.planning_can_read_plan(uuid) to authenticated;
grant execute on function public.planning_can_edit_plan(uuid) to authenticated;
grant execute on function public.ensure_planning_plan(text, uuid) to authenticated;
grant execute on function public.list_planning_plans_safe(text) to authenticated;

grant select, insert, update, delete on public.planning_plans to authenticated;
grant select, insert, update, delete on public.planning_locations to authenticated;
grant select, insert, update, delete on public.planning_items to authenticated;
grant select, insert, update, delete on public.planning_dependencies to authenticated;
grant select, insert, update, delete on public.planning_assignments to authenticated;
grant select, insert, update, delete on public.planning_travel_segments to authenticated;
grant select, insert, update, delete on public.planning_accommodations to authenticated;
grant select, insert, update, delete on public.planning_accommodation_guests to authenticated;
grant select, insert, update, delete on public.planning_baselines to authenticated;
grant select on public.planning_change_log to authenticated;
grant usage, select on sequence public.planning_change_log_id_seq to authenticated;

grant all on public.planning_plans, public.planning_locations, public.planning_items,
  public.planning_dependencies, public.planning_assignments, public.planning_travel_segments,
  public.planning_accommodations, public.planning_accommodation_guests,
  public.planning_baselines, public.planning_change_log to service_role;
