begin;

-- Keep the existing column-level financial privacy grants intact.
grant select (code) on public.realizations to authenticated;

-- Read-only overviews execute as the caller so existing RLS remains authoritative.
create index if not exists idx_notifications_unread_user
  on public.notifications(user_id) where is_read = false;
create index if not exists idx_planning_items_open_member_end
  on public.planning_items(member_id, end_date, id)
  where item_type = 'task' and status not in ('done', 'cancelled');
create index if not exists idx_attendance_plans_work_member_date
  on public.attendance_plans(member_id, date)
  where cancelled = false and kind in ('work', 'home_office');

create or replace function public.get_my_work_overview_v2(p_today date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_member uuid := public.get_member_id();
  v_user uuid := auth.uid();
  v_role text := public.get_user_role();
  v_tasks boolean := public.has_permission('tasks', 'can_read');
  v_projects boolean := public.has_permission('projects', 'can_read');
  v_realizations boolean := public.has_permission('realizace', 'can_read');
  v_attendance boolean := public.has_permission('attendance', 'can_read');
  v_approve_attendance boolean := v_attendance and v_role in ('admin','super_manager') and public.has_permission('attendance','can_admin');
  v_approve_payouts boolean := public.has_permission('payouts','can_read') and public.has_permission('payouts','can_admin');
  v_result jsonb;
begin
  if v_user is null or v_member is null then
    raise exception 'Authentication and linked member required' using errcode = '42501';
  end if;
  p_today := coalesce(p_today, (now() at time zone 'Europe/Prague')::date);
  with visible_plans as materialized (
    select pp.id, pp.title, pp.project_id, pp.realization_id,
      coalesce(p.code, r.code) as code
    from public.planning_plans pp
    left join public.projects p on p.id = pp.project_id
    left join public.realizations r on r.id = pp.realization_id
    where v_tasks and ((v_projects and pp.project_id is not null) or (v_realizations and pp.realization_id is not null))
  ), own_tasks as materialized (
    select 'plan:' || i.id as id, i.name,
      case i.status when 'planned' then 'Nové' when 'ready' then 'Připraveno'
        when 'in_progress' then 'V řešení' when 'blocked' then 'Blokováno' else i.status end as status,
      i.end_date, jsonb_build_object('name', p.title, 'code', p.code) as project,
      case when p.project_id is not null then '/projects/' || p.project_id else '/realizace/' || p.realization_id end
        || '?planItem=' || i.id || '#plan' as path
    from public.planning_items i join visible_plans p on p.id = i.plan_id
    where i.item_type = 'task' and i.status not in ('done','cancelled')
      and (i.member_id = v_member or exists (
        select 1 from public.planning_assignments a where a.item_id = i.id and a.member_id = v_member
      ))
    union all
    select 'project:' || t.id, t.name, t.status, t.end_date,
      jsonb_build_object('name', p.name, 'code', p.code),
      '/projects/' || t.project_id || '?task=' || t.id || '#tasks'
    from public.project_tasks t left join public.projects p on p.id = t.project_id
    where v_tasks and v_projects and t.member_id = v_member
      and lower(coalesce(t.status,'')) not in ('hotovo','zrušeno','done','completed','cancelled','canceled')
      -- A linked planning task supersedes its legacy row even when closed or reassigned.
      and not exists (select 1 from public.planning_items i join visible_plans pp on pp.id = i.plan_id
        where i.legacy_project_task_id = t.id and i.item_type = 'task')
  ), jobs as (
    (select p.id, p.name, p.code, p.status, 'Projekce' as kind,
      '/projects/' || p.id as path, p.completion_date as date
    from public.projects p where v_projects
      and coalesce(p.status,'') not in ('delivered','closed','completed','cancelled','archived')
    order by p.completion_date nulls last, p.id limit 4)
    union all
    (select r.id, r.name, r.code, r.status, 'Realizace', '/realizace/' || r.id, r.planned_end_date
    from public.realizations r where v_realizations
      and coalesce(r.status,'') not in ('Dokončeno','Předáno','Zrušeno','completed','cancelled','archived')
    order by r.planned_end_date nulls last, r.id limit 3)
  ), approvals as (
    select 'Docházka ke schválení' as label, count(*) as count, '/attendance?tab=approvals' as path, 'attendance' as icon
    from public.attendance_submissions where v_approve_attendance and status = 'submitted' having v_approve_attendance
    union all
    select 'Žádosti o výplatu', count(*), '/payouts?status=pending', 'payout'
    from public.payouts where v_approve_payouts and status = 'pending' having v_approve_payouts
    union all
    select 'Hodinové výplaty', count(*), '/payouts/hourly-admin', 'payout'
    from public.hourly_payout_requests where v_approve_payouts and status = 'pending' having v_approve_payouts
    union all
    select 'Zaměstnanecké žádosti', count(*), '/members?view=requests', 'employee'
    from public.employee_requests where v_role = 'admin' and status = 'pending' having v_role = 'admin'
  )
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.end_date nulls last,t.id) from (select * from own_tasks order by end_date nulls last,id limit 6) t),'[]'::jsonb),
    'openCount', (select count(*) from own_tasks),
    'overdueCount', (select count(*) from own_tasks where end_date < p_today),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.kind,j.date nulls last,j.id) from jobs j),'[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(to_jsonb(a) order by a.path) from approvals a),'[]'::jsonb),
    'approvalCount', (select coalesce(sum(count),0) from approvals),
    'notificationCount', (select count(*) from public.notifications where user_id = v_user and is_read = false),
    'reminders', case when v_attendance
      and exists(select 1 from public.attendance_plans where member_id = v_member and date = p_today and cancelled = false and kind in ('work','home_office'))
      and not exists(select 1 from public.attendance where member_id = v_member and date = p_today)
      then jsonb_build_array(jsonb_build_object('path','/attendance','label','Dnes máte plánovanou práci, docházka zatím není zapsaná.')) else '[]'::jsonb end,
    'error',''
  ) into v_result;
  return v_result;
end;
$$;

-- Match the existing Czech/English dashboard status rules in one SQL expression.
create or replace function public.dashboard_status_key_v2(p_status text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(btrim(coalesce(p_status,''))), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz');
$$;
create or replace function public.dashboard_status_open_v2(p_status text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select public.dashboard_status_key_v2(p_status) <> all(array[
    'done','completed','complete','finished','closed','archived','cancelled','canceled','paid',
    'rejected','hotovo','dokonceno','uzavreno','zruseno','storno','stornovano','archivovano','zamitnuto'
  ]);
$$;
create or replace function public.dashboard_status_visible_v2(p_status text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select public.dashboard_status_key_v2(p_status) <> all(array[
    'cancelled','canceled','archived','deleted','zruseno','storno','stornovano','archivovano'
  ]);
$$;

create or replace function public.get_company_dashboard_v2(p_private boolean default false, p_today date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_fin boolean := public.get_user_role() = 'admin' and not coalesce(p_private,true);
  v_projects boolean := public.has_permission('projects','can_read');
  v_realizations boolean := public.has_permission('realizace','can_read');
  v_tasks boolean := public.has_permission('tasks','can_read');
  v_crm boolean := public.has_permission('crm','can_read');
  v_engineering boolean := public.has_permission('engineering','can_read');
  v_payouts boolean := public.has_permission('payouts','can_admin');
  v_attendance boolean := public.has_permission('attendance','can_admin');
  v_documents boolean := public.has_permission('documents','can_read');
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_permission('dashboard','can_read') then
    raise exception 'Dashboard access denied' using errcode = '42501';
  end if;
  p_today := coalesce(p_today,(now() at time zone 'Europe/Prague')::date);
  with projects as materialized (
    select p.id,p.status,case when v_fin then p.price else null end as price
    from public.list_projects_safe() p where v_projects and public.dashboard_status_visible_v2(p.status)
  ), realizations as materialized (
    select r.id,r.status,case when v_fin then r.contract_amount else null end as contract_amount
    from public.list_realizations_safe() r where v_realizations and public.dashboard_status_visible_v2(r.status)
  ), tasks as materialized (
    select t.id,t.name,t.status,t.end_date,jsonb_build_object('name',p.name) as project
    from public.project_tasks t left join public.projects p on p.id=t.project_id
    where v_tasks and public.dashboard_status_visible_v2(t.status)
  ), engineering as materialized (
    select e.id,e.subject,e.status,e.end_date,jsonb_build_object('name',p.name) as projects
    from public.engineering_activities e left join public.projects p on p.id=e.project_id
    where v_engineering and public.dashboard_status_visible_v2(e.status)
  ), opportunities as materialized (
    select o.id,o.number,o.title,o.stage,o.status,o.expected_close_date,
      case when v_fin then o.value else null end as value,case when v_fin then o.probability else null end as probability,
      jsonb_build_object('name',s.name) as subject,
      public.dashboard_status_open_v2(o.status) and public.dashboard_status_key_v2(o.stage) not in ('won','lost') as is_open
    from public.crm_opportunities o left join public.subjects s on s.id=o.subject_id
    where v_crm and o.deleted_at is null and o.archived_at is null and o.cancelled_at is null and public.dashboard_status_visible_v2(o.status)
  ), commercial as materialized (
    select d.type,case when v_fin then d.total else null end as total
    from public.crm_commercial_documents d where v_crm
      and d.deleted_at is null and d.archived_at is null and d.cancelled_at is null and public.dashboard_status_visible_v2(d.status)
  ), payouts as materialized (
    select p.id,p.status,p.request_date,case when v_fin then p.amount else null end as amount,jsonb_build_object('name',m.name) as member
    from public.payouts p left join public.members m on m.id=p.member_id where v_payouts and p.status='pending'
  ), attendance as materialized (
    select a.id,a.status,a.total_hours,a.month_date,a.submitted_at,jsonb_build_object('name',m.name) as member
    from public.attendance_submissions a left join public.members m on m.id=a.member_id where v_attendance and a.status='submitted'
  ), stages as (
    select coalesce(nullif(lower(stage),''),'lead') as stage,count(*) as count,coalesce(sum(value),0) as value
    from opportunities where is_open group by 1
  ), statuses as (
    select 'projects' as kind,status,count(*) as count from projects group by status
    union all select 'tasks',status,count(*) from tasks group by status
    union all select 'engineering',status,count(*) from engineering group by status
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'projectCount',(select count(*) from projects),'activeProjectCount',(select count(*) from projects where public.dashboard_status_open_v2(status)),
      'activeRealizationCount',(select count(*) from realizations where public.dashboard_status_open_v2(status)),
      'openTaskCount',(select count(*) from tasks where public.dashboard_status_open_v2(status)),
      'overdueTaskCount',(select count(*) from tasks where public.dashboard_status_open_v2(status) and end_date<p_today),
      'activeEngineeringCount',(select count(*) from engineering where public.dashboard_status_open_v2(status)),
      'overdueEngineeringCount',(select count(*) from engineering where public.dashboard_status_open_v2(status) and end_date<p_today),
      'openOpportunityCount',(select count(*) from opportunities where is_open),
      'pipelineValue',(select coalesce(sum(value),0) from opportunities where is_open),
      'weightedPipeline',(select coalesce(sum(value*coalesce(probability,0)/100.0),0) from opportunities where is_open),
      'offerCount',(select count(*) from commercial where type='offer'),'orderCount',(select count(*) from commercial where type='order'),
      'offersValue',(select coalesce(sum(total),0) from commercial where type='offer'),'ordersValue',(select coalesce(sum(total),0) from commercial where type='order'),
      'activeProjectsValue',(select coalesce(sum(price),0) from projects where public.dashboard_status_open_v2(status)),
      'activeRealizationsValue',(select coalesce(sum(contract_amount),0) from realizations where public.dashboard_status_open_v2(status)),
      'allRealizationsValue',(select coalesce(sum(contract_amount),0) from realizations),
      'wonValue',(select coalesce(sum(value),0) from opportunities where lower(stage)='won'),
      'pendingApprovals',(select count(*) from payouts)+(select count(*) from attendance),
      'attentionCount',(select count(*) from payouts)+(select count(*) from attendance)
        +(select count(*) from tasks where public.dashboard_status_open_v2(status) and end_date<p_today)
        +(select count(*) from engineering where public.dashboard_status_open_v2(status) and end_date<p_today)
        +(select count(*) from opportunities where is_open and expected_close_date<p_today),
      'activeProductCount',(select count(*) from public.commercial_item_catalog where v_crm and is_active=true and archived_at is null),
      'documentCount',(select count(*) from public.documents where v_documents)
    ),
    'payoutCount',(select count(*) from payouts),'attendanceCount',(select count(*) from attendance),
    'payouts',coalesce((select jsonb_agg(to_jsonb(t) order by t.request_date,t.id) from (select * from payouts order by request_date,id limit 5)t),'[]'::jsonb),
    'attendanceSubmissions',coalesce((select jsonb_agg(to_jsonb(t) order by t.submitted_at,t.id) from (select * from attendance order by submitted_at,id limit 5)t),'[]'::jsonb),
    'overdueTasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.end_date,t.id) from (select * from tasks where public.dashboard_status_open_v2(status) and end_date<p_today order by end_date,id limit 3)t),'[]'::jsonb),
    'overdueEngineering',coalesce((select jsonb_agg(to_jsonb(t) order by t.end_date,t.id) from (select * from engineering where public.dashboard_status_open_v2(status) and end_date<p_today order by end_date,id limit 3)t),'[]'::jsonb),
    'activeEngineering',coalesce((select jsonb_agg(to_jsonb(t) order by t.end_date nulls last,t.id) from (select * from engineering where public.dashboard_status_open_v2(status) order by end_date nulls last,id limit 6)t),'[]'::jsonb),
    'topOpportunities',coalesce((select jsonb_agg(to_jsonb(t) order by t.value desc nulls last,t.id) from (select * from opportunities where is_open order by value desc nulls last,id limit 10)t),'[]'::jsonb),
    'upcomingOpportunities',coalesce((select jsonb_agg(to_jsonb(t) order by t.expected_close_date,t.id) from (select * from opportunities where is_open and expected_close_date is not null order by expected_close_date,id limit 2)t),'[]'::jsonb),
    'stageSummary',coalesce((select jsonb_agg(to_jsonb(s) order by s.value desc,s.stage) from stages s),'[]'::jsonb),
    'statusCounts',coalesce((select jsonb_agg(to_jsonb(s) order by s.kind,s.status) from statuses s),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Kept separate so expensive financial calculations never delay operational data.
create or replace function public.get_company_dashboard_finance_v2()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or public.get_user_role() is distinct from 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  return (select jsonb_build_object('realizedProfit',round(f.realized_profit),'potentialProfit',round(f.potential_profit),
    'totalProjectValue',round(f.total_project_value),'unallocatedBudget',round(f.unallocated_budget),
    'overheadAllocated',round(o.total_allocated_overhead),'overheadAccounted',round(o.total_accounted_overhead))
    from public.get_company_financials() f cross join public.get_overhead_summary() o);
end;
$$;

revoke all on function public.get_my_work_overview_v2(date) from public,anon;
revoke all on function public.get_company_dashboard_v2(boolean,date) from public,anon;
revoke all on function public.get_company_dashboard_finance_v2() from public,anon;
grant execute on function public.get_my_work_overview_v2(date) to authenticated;
grant execute on function public.get_company_dashboard_v2(boolean,date) to authenticated;
grant execute on function public.get_company_dashboard_finance_v2() to authenticated;

notify pgrst, 'reload schema';
commit;
