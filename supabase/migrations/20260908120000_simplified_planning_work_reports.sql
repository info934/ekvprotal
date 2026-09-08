begin;

alter table public.projects add column if not exists complexity_level text default 'standard';
alter table public.projects add column if not exists estimated_work_days integer;
alter table public.realizations add column if not exists complexity_level text default 'standard';
alter table public.realizations add column if not exists estimated_work_days integer;
alter table public.project_tasks add column if not exists priority text default 'normal';
alter table public.project_tasks add column if not exists estimated_hours numeric(8,2);
alter table public.planning_items add column if not exists priority text default 'normal';
alter table public.planning_items add column if not exists estimated_hours numeric(8,2);

alter table public.projects drop constraint if exists projects_complexity_level_check;
alter table public.projects add constraint projects_complexity_level_check
  check (complexity_level is null or complexity_level in ('simple', 'standard', 'complex', 'custom'));
alter table public.projects drop constraint if exists projects_estimated_work_days_check;
alter table public.projects add constraint projects_estimated_work_days_check
  check (estimated_work_days is null or estimated_work_days > 0);
alter table public.realizations drop constraint if exists realizations_complexity_level_check;
alter table public.realizations add constraint realizations_complexity_level_check
  check (complexity_level is null or complexity_level in ('simple', 'standard', 'complex', 'custom'));
alter table public.realizations drop constraint if exists realizations_estimated_work_days_check;
alter table public.realizations add constraint realizations_estimated_work_days_check
  check (estimated_work_days is null or estimated_work_days > 0);
alter table public.project_tasks drop constraint if exists project_tasks_priority_check;
alter table public.project_tasks add constraint project_tasks_priority_check
  check (priority in ('low', 'normal', 'high', 'critical'));
alter table public.project_tasks drop constraint if exists project_tasks_estimated_hours_check;
alter table public.project_tasks add constraint project_tasks_estimated_hours_check
  check (estimated_hours is null or estimated_hours > 0);
alter table public.planning_items drop constraint if exists planning_items_priority_check;
alter table public.planning_items add constraint planning_items_priority_check
  check (priority in ('low', 'normal', 'high', 'critical'));
alter table public.planning_items drop constraint if exists planning_items_estimated_hours_check;
alter table public.planning_items add constraint planning_items_estimated_hours_check
  check (estimated_hours is null or estimated_hours > 0);

create index if not exists planning_items_open_priority_idx
  on public.planning_items(plan_id, priority, end_date)
  where item_type = 'task' and status not in ('done', 'cancelled');

create table if not exists public.work_report_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('portfolio_weekly', 'member_reminder', 'member_digest', 'test')),
  recipient_email text not null,
  member_id uuid references public.members(id) on delete set null,
  period_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_type, recipient_email, period_key)
);
create index if not exists work_report_jobs_retry_idx
  on public.work_report_jobs(status, next_attempt_at, scheduled_for);

alter table public.work_report_jobs enable row level security;
drop policy if exists "Work report jobs admin read" on public.work_report_jobs;
create policy "Work report jobs admin read" on public.work_report_jobs
  for select to authenticated using (public.get_user_role() = 'admin');
revoke all on public.work_report_jobs from anon, authenticated;
grant select on public.work_report_jobs to authenticated;
grant all on public.work_report_jobs to service_role;

insert into public.app_settings(key, value) values
  ('work_reports_enabled', 'true'),
  ('work_report_main_email', 'info@ekvproject.cz'),
  ('work_report_ai_provider', 'inherit'),
  ('work_report_ai_model', 'gemini-2.5-flash'),
  ('work_report_function_url', 'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/send-work-reports')
on conflict (key) do nothing;

insert into public.portal_feature_flags(key, enabled, description) values
  ('planning_simplified_v1', false, 'Jednoduché plánování projekce a realizace'),
  ('work_reports_v1', false, 'Pravidelné provozní a osobní pracovní reporty')
on conflict (key) do update set description = excluded.description;

create or replace function public.sync_project_task_to_planning()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan_id uuid;
begin
  if current_setting('app.planning_sync', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  perform set_config('app.planning_sync', '1', true);
  if tg_op = 'DELETE' then
    delete from public.planning_items where legacy_project_task_id = old.id;
    perform set_config('app.planning_sync', '0', true); return old;
  end if;
  select id into v_plan_id from public.planning_plans where project_id = new.project_id;
  if v_plan_id is null then
    insert into public.planning_plans(project_id,title,planned_start,planned_end,created_by)
    select p.id, concat(p.code,' - ',p.name), p.start_date, p.completion_date, auth.uid()
    from public.projects p where p.id = new.project_id
    on conflict (project_id) where project_id is not null do update set title=excluded.title
    returning id into v_plan_id;
  end if;
  insert into public.planning_items(plan_id,legacy_project_task_id,item_type,name,description,start_date,end_date,
    progress,status,member_id,priority,estimated_hours,created_by)
  values(v_plan_id,new.id,'task',new.name,new.description,new.start_date,new.end_date,
    case when lower(coalesce(new.status,'')) in ('hotovo','done','completed') then 1 else 0 end,
    case when lower(coalesce(new.status,'')) in ('zrušeno','zruseno','cancelled','canceled') then 'cancelled'
      when lower(coalesce(new.status,'')) in ('hotovo','done','completed') then 'done'
      when lower(coalesce(new.status,'')) in ('blokováno','blokovano','blocked') then 'blocked'
      when lower(coalesce(new.status,'')) in ('v reseni','v řešení','in_progress') then 'in_progress' else 'planned' end,
    new.member_id,coalesce(new.priority,'normal'),new.estimated_hours,auth.uid())
  on conflict (legacy_project_task_id) do update set plan_id=excluded.plan_id,name=excluded.name,
    description=excluded.description,start_date=excluded.start_date,end_date=excluded.end_date,
    progress=excluded.progress,status=excluded.status,member_id=excluded.member_id,
    priority=excluded.priority,estimated_hours=excluded.estimated_hours;
  perform set_config('app.planning_sync', '0', true); return new;
exception when others then perform set_config('app.planning_sync', '0', true); raise;
end; $$;

create or replace function public.sync_planning_item_to_project_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_task_id uuid; v_status text;
begin
  if current_setting('app.planning_sync', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  perform set_config('app.planning_sync', '1', true);
  if tg_op = 'DELETE' then
    if old.legacy_project_task_id is not null then delete from public.project_tasks where id=old.legacy_project_task_id; end if;
    perform set_config('app.planning_sync', '0', true); return old;
  end if;
  select project_id into v_project_id from public.planning_plans where id=new.plan_id;
  if v_project_id is null or new.item_type <> 'task' then perform set_config('app.planning_sync','0',true); return new; end if;
  v_status := case when new.status='cancelled' then 'Zrušeno' when new.status='done' then 'Hotovo'
    when new.status='blocked' then 'Blokováno' when new.status='in_progress' then 'V řešení' else 'Nové' end;
  if new.legacy_project_task_id is null then
    insert into public.project_tasks(project_id,name,start_date,end_date,member_id,status,description,priority,estimated_hours)
    values(v_project_id,new.name,new.start_date,new.end_date,new.member_id,v_status,new.description,new.priority,new.estimated_hours)
    returning id into v_task_id;
    update public.planning_items set legacy_project_task_id=v_task_id where id=new.id;
  else
    update public.project_tasks set project_id=v_project_id,name=new.name,start_date=new.start_date,end_date=new.end_date,
      member_id=new.member_id,status=v_status,description=new.description,priority=new.priority,estimated_hours=new.estimated_hours
    where id=new.legacy_project_task_id;
  end if;
  perform set_config('app.planning_sync','0',true); return new;
exception when others then perform set_config('app.planning_sync','0',true); raise;
end; $$;

create or replace function public.save_planning_item_with_resources(
  p_plan_id uuid,p_item_id uuid,p_item jsonb,p_member_assignments jsonb default '[]'::jsonb,
  p_subcontractor_assignments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_timezone text; v_start_at timestamptz; v_end_at timestamptz; v_assignment jsonb;
  v_member_id uuid; v_requested_allocation numeric; v_overlapping_allocation numeric;
  v_item_type text:=coalesce(nullif(p_item->>'item_type',''),'task');
  v_primary_member_id uuid:=nullif(p_item->>'member_id','')::uuid;
begin
  if not public.planning_can_edit_plan(p_plan_id) then raise exception 'Planning edit access denied'; end if;
  if nullif(btrim(p_item->>'name'),'') is null then raise exception 'Planning item name is required'; end if;
  select timezone into v_timezone from public.planning_plans where id=p_plan_id for update;
  if not found then raise exception 'Planning plan not found'; end if;
  v_start_at := (nullif(p_item->>'start_at','')::timestamp at time zone coalesce(v_timezone,'Europe/Prague'));
  v_end_at := case when v_item_type='milestone' then v_start_at else
    (nullif(p_item->>'end_at','')::timestamp at time zone coalesce(v_timezone,'Europe/Prague')) end;
  if v_start_at is null or v_end_at is null or v_end_at<v_start_at then raise exception 'Invalid planning item time range'; end if;
  if p_item_id is null then
    insert into public.planning_items(plan_id,parent_id,item_type,name,description,start_date,end_date,start_at,end_at,
      progress,status,member_id,calendar_sync_enabled,sort_order,priority,estimated_hours)
    values(p_plan_id,nullif(p_item->>'parent_id','')::uuid,v_item_type,btrim(p_item->>'name'),nullif(btrim(p_item->>'description'),''),
      (v_start_at at time zone v_timezone)::date,(v_end_at at time zone v_timezone)::date,v_start_at,v_end_at,
      greatest(0,least(1,coalesce(nullif(p_item->>'progress','')::numeric,0))),coalesce(nullif(p_item->>'status',''),'planned'),
      v_primary_member_id,v_item_type<>'phase' and coalesce((p_item->>'calendar_sync_enabled')::boolean,false),
      coalesce(nullif(p_item->>'sort_order','')::integer,0),coalesce(nullif(p_item->>'priority',''),'normal'),
      nullif(p_item->>'estimated_hours','')::numeric) returning id into v_id;
  else
    update public.planning_items set parent_id=nullif(p_item->>'parent_id','')::uuid,item_type=v_item_type,
      name=btrim(p_item->>'name'),description=nullif(btrim(p_item->>'description'),''),start_at=v_start_at,end_at=v_end_at,
      progress=greatest(0,least(1,coalesce(nullif(p_item->>'progress','')::numeric,0))),
      status=coalesce(nullif(p_item->>'status',''),'planned'),member_id=v_primary_member_id,
      calendar_sync_enabled=v_item_type<>'phase' and coalesce((p_item->>'calendar_sync_enabled')::boolean,false),
      sort_order=coalesce(nullif(p_item->>'sort_order','')::integer,0),priority=coalesce(nullif(p_item->>'priority',''),'normal'),
      estimated_hours=nullif(p_item->>'estimated_hours','')::numeric
    where id=p_item_id and plan_id=p_plan_id returning id into v_id;
    if v_id is null then raise exception 'Planning item not found in plan'; end if;
  end if;
  perform public.replace_planning_item_resources(v_id,v_primary_member_id,p_member_assignments,p_subcontractor_assignments);
  for v_assignment in select value from jsonb_array_elements(coalesce(p_member_assignments,'[]'::jsonb)) loop
    v_member_id:=nullif(v_assignment->>'member_id','')::uuid;
    v_requested_allocation:=greatest(0.01,least(100,coalesce(nullif(v_assignment->>'allocation_percent','')::numeric,100)));
    select coalesce(sum(pa.allocation_percent),0) into v_overlapping_allocation from public.planning_assignments pa
      join public.planning_items pi on pi.id=pa.item_id where pa.member_id=v_member_id and pa.item_id<>v_id
      and pi.status<>'cancelled' and tstzrange(pi.start_at,greatest(pi.end_at,pi.start_at+interval '1 minute'),'[)')
      && tstzrange(v_start_at,greatest(v_end_at,v_start_at+interval '1 minute'),'[)');
    if v_overlapping_allocation+v_requested_allocation>100 then raise exception 'Member capacity exceeded'; end if;
  end loop;
  return v_id;
end; $$;

create or replace function public.quick_update_planning_item(p_item_id uuid, p_changes jsonb)
returns public.planning_items language plpgsql security definer set search_path=public as $$
declare v_item public.planning_items; v_status text; v_member uuid; v_due date; v_start date;
begin
  select * into v_item from public.planning_items where id=p_item_id for update;
  if not found or not public.planning_can_edit_plan(v_item.plan_id) then raise exception 'Planning edit access denied'; end if;
  v_status:=coalesce(nullif(p_changes->>'status',''),v_item.status);
  if v_status not in ('planned','ready','in_progress','blocked','done','cancelled') then raise exception 'Invalid status'; end if;
  v_member:=case when p_changes ? 'member_id' then nullif(p_changes->>'member_id','')::uuid else v_item.member_id end;
  v_due:=case when p_changes ? 'end_date' then nullif(p_changes->>'end_date','')::date else v_item.end_date end;
  v_start:=case when p_changes ? 'start_date' then nullif(p_changes->>'start_date','')::date else v_item.start_date end;
  if v_due<v_start then raise exception 'End date cannot precede start date'; end if;
  update public.planning_items set status=v_status,progress=case when v_status='done' then 1 when v_item.status='done' then 0 else progress end,
    member_id=v_member,start_date=v_start,end_date=v_due,
    start_at=case when p_changes ? 'start_date' then (v_start::text||' 08:00')::timestamp at time zone 'Europe/Prague' else start_at end,
    end_at=case when p_changes ? 'end_date' then (v_due::text||' 17:00')::timestamp at time zone 'Europe/Prague' else end_at end
  where id=p_item_id returning * into v_item;
  if p_changes ? 'member_id' then
    delete from public.planning_assignments where item_id=p_item_id;
    if v_member is not null then insert into public.planning_assignments(item_id,member_id,allocation_percent,planned_hours)
      values(p_item_id,v_member,100,v_item.estimated_hours); end if;
  end if;
  return v_item;
end; $$;
revoke all on function public.quick_update_planning_item(uuid,jsonb) from public,anon;
grant execute on function public.quick_update_planning_item(uuid,jsonb) to authenticated;

create or replace function public.update_entity_planning_estimate(
  p_entity_type text, p_entity_id uuid, p_complexity_level text, p_estimated_work_days integer
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_complexity_level not in ('simple','standard','complex','custom') or p_estimated_work_days <= 0 then
    raise exception 'Invalid planning estimate';
  end if;
  if p_entity_type='project' then
    if not public.can_edit_module('projects') or not public.can_access_project(p_entity_id) then raise exception 'Project edit access denied'; end if;
    update public.projects set complexity_level=p_complexity_level,estimated_work_days=p_estimated_work_days where id=p_entity_id;
  elsif p_entity_type='realization' then
    if not public.can_edit_module('realizace') or not public.can_access_realization(p_entity_id) then raise exception 'Realization edit access denied'; end if;
    update public.realizations set complexity_level=p_complexity_level,estimated_work_days=p_estimated_work_days where id=p_entity_id;
  else raise exception 'Unsupported planning entity type'; end if;
end $$;
revoke all on function public.update_entity_planning_estimate(text,uuid,text,integer) from public,anon;
grant execute on function public.update_entity_planning_estimate(text,uuid,text,integer) to authenticated;

create or replace function public.get_entity_planning_estimate_safe(p_entity_type text,p_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if p_entity_type='project' and public.can_access_project(p_entity_id) then
    select jsonb_build_object('complexity_level',complexity_level,'estimated_work_days',estimated_work_days) into v_result from public.projects where id=p_entity_id;
  elsif p_entity_type='realization' and public.can_access_realization(p_entity_id) then
    select jsonb_build_object('complexity_level',complexity_level,'estimated_work_days',estimated_work_days) into v_result from public.realizations where id=p_entity_id;
  else raise exception 'Planning estimate access denied'; end if;
  return coalesce(v_result,'{}'::jsonb);
end $$;
revoke all on function public.get_entity_planning_estimate_safe(text,uuid) from public,anon;
grant execute on function public.get_entity_planning_estimate_safe(text,uuid) to authenticated;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='work_reports_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'work_reports_cron_secret','Authenticates scheduled work reports.');
  end if;
end $$;
create or replace function public.verify_work_reports_secret(p_secret text)
returns boolean language sql security definer set search_path=public,vault as $$
  select p_secret is not null and exists(select 1 from vault.decrypted_secrets where name='work_reports_cron_secret' and decrypted_secret=p_secret);
$$;
revoke all on function public.verify_work_reports_secret(text) from public,anon,authenticated;
grant execute on function public.verify_work_reports_secret(text) to service_role;

create or replace function public.invoke_work_reports()
returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare v_url text; v_secret text; v_request_id bigint;
begin
  select value into v_url from public.app_settings where key='work_report_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='work_reports_cron_secret';
  if coalesce(v_url,'')='' or coalesce(v_secret,'')='' then raise exception 'Work report scheduler is not configured'; end if;
  select net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-work-report-secret',v_secret),
    body:=jsonb_build_object('action','scheduled')) into v_request_id;
  return v_request_id;
end $$;
revoke all on function public.invoke_work_reports() from public,anon,authenticated,service_role;

do $$ declare v_job record; begin
  for v_job in select jobid from cron.job where jobname in ('work-reports-morning-prague','work-reports-friday-prague') loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('work-reports-morning-prague','0,15,30,45 5,6 * * 1,3','select public.invoke_work_reports();');
  perform cron.schedule('work-reports-friday-prague','0,15,30,45 12,13 * * 5','select public.invoke_work_reports();');
end $$;

commit;
