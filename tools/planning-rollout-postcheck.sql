-- Planning board production post-check. Every assertion must pass.

do $$
declare
  required_table text;
  required_function text;
begin
  foreach required_table in array array[
    'planning_plans',
    'planning_locations',
    'planning_items',
    'planning_dependencies',
    'planning_assignments',
    'planning_travel_segments',
    'planning_accommodations',
    'planning_accommodation_guests',
    'planning_baselines',
    'planning_change_log',
    'planning_calendar_links',
    'planning_calendar_sync_queue',
    'planning_calendar_sync_log'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing planning table: %', required_table;
    end if;
  end loop;

  foreach required_function in array array[
    'planning_can_read_plan',
    'planning_can_edit_plan',
    'ensure_planning_plan',
    'list_planning_plans_safe',
    'sync_project_task_to_planning',
    'sync_planning_item_to_project_task'
  ] loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = required_function
    ) then
      raise exception 'Missing planning function: %', required_function;
    end if;
  end loop;

  if exists (
    select 1 from public.planning_plans
    where (project_id is null) = (realization_id is null)
  ) then
    raise exception 'A planning plan is not bound to exactly one entity';
  end if;

  if exists (
    select 1
    from public.projects p
    left join public.planning_plans pp on pp.project_id = p.id
    where pp.id is null
  ) then
    raise exception 'At least one project is missing its planning plan';
  end if;

  if exists (
    select 1
    from public.realizations r
    left join public.planning_plans pp on pp.realization_id = r.id
    where pp.id is null
  ) then
    raise exception 'At least one realization is missing its planning plan';
  end if;

  if exists (
    select 1
    from public.planning_items child
    join public.planning_items parent on parent.id = child.parent_id
    where child.plan_id <> parent.plan_id
  ) then
    raise exception 'Cross-plan item hierarchy detected';
  end if;

  if exists (
    select 1
    from public.planning_dependencies pd
    join public.planning_items predecessor on predecessor.id = pd.predecessor_id
    join public.planning_items successor on successor.id = pd.successor_id
    where pd.plan_id <> predecessor.plan_id
       or pd.plan_id <> successor.plan_id
  ) then
    raise exception 'Cross-plan dependency detected';
  end if;

  if exists (
    select 1 from public.planning_items
    where end_date < start_date
       or (item_type = 'milestone' and end_date <> start_date)
  ) then
    raise exception 'Invalid planning item dates detected';
  end if;

  if exists (
    select 1
    from public.project_tasks pt
    join public.planning_items pi on pi.legacy_project_task_id = pt.id
    join public.planning_plans pp on pp.id = pi.plan_id
    where pp.project_id <> pt.project_id
  ) then
    raise exception 'Project task is linked to a plan of another project';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'planning_%'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ) then
    raise exception 'At least one planning table has RLS disabled';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'planning_items' and column_name = 'calendar_sync_enabled'
  ) then
    raise exception 'planning_items.calendar_sync_enabled is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'microsoft_calendar_email'
  ) then
    raise exception 'members.microsoft_calendar_email is missing';
  end if;
end $$;

select
  (select count(*) from public.planning_plans where project_id is not null) as project_plans,
  (select count(*) from public.planning_plans where realization_id is not null) as realization_plans,
  (select count(*) from public.planning_items) as planning_items,
  (select count(*) from public.planning_items where item_type = 'milestone') as milestones,
  (select count(*) from public.planning_dependencies) as dependencies,
  (select count(*) from public.planning_travel_segments) as travel_segments,
  (select count(*) from public.planning_accommodations) as accommodations,
  (select count(*) from public.planning_calendar_links where sync_status = 'synced') as outlook_synced,
  (select count(*) from public.planning_calendar_links where sync_status = 'error') as outlook_errors,
  (select count(*) from public.planning_calendar_sync_queue where status in ('pending', 'failed')) as calendar_queue_open;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename like 'planning_%'
order by tablename, policyname;
