-- Preserve cancellation between project tasks and the planning board.
-- project_tasks.status is text; no destructive constraint replacement is required.
begin;

insert into public.task_statuses (name) values ('Zrušeno') on conflict (name) do nothing;

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
      when lower(coalesce(new.status, '')) in ('zrušeno', 'zruseno', 'cancelled', 'canceled') then 'cancelled'
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
    when new.status = 'cancelled' then 'Zrušeno'
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


-- Backfill only linked cancellations. Suppress reverse sync to preserve all
-- planning fields (including progress, times, hierarchy and assignments).
select set_config('app.planning_sync', '1', true);
update public.project_tasks task
set status = 'Zrušeno'
from public.planning_items item
where item.legacy_project_task_id = task.id
  and item.status = 'cancelled'
  and task.status is distinct from 'Zrušeno';
select set_config('app.planning_sync', '0', true);

commit;
