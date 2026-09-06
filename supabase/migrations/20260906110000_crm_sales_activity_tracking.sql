begin;

alter table public.crm_activities
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists location text,
  add column if not exists attendees jsonb not null default '[]'::jsonb,
  add column if not exists outcome text,
  add column if not exists meeting_minutes text,
  add column if not exists next_step text,
  add column if not exists calendar_sync_enabled boolean not null default false,
  add column if not exists external_mailbox text,
  add column if not exists external_event_id text,
  add column if not exists external_web_link text,
  add column if not exists calendar_synced_at timestamptz,
  add column if not exists calendar_sync_error text,
  add column if not exists created_by_member_id uuid references public.members(id) on delete set null;

update public.crm_activities
set starts_at = due_at,
    ends_at = case when due_at is not null then due_at + interval '30 minutes' end
where starts_at is null and due_at is not null;

update public.crm_activities set type = 'note'
where type not in ('call', 'meeting', 'email', 'task', 'note');
update public.crm_activities set status = case when status = 'done' then 'completed' else 'planned' end
where status not in ('planned', 'in_progress', 'completed', 'cancelled');

alter table public.crm_activities
  drop constraint if exists crm_activities_type_check;
alter table public.crm_activities
  add constraint crm_activities_type_check
  check (type in ('call', 'meeting', 'email', 'task', 'note'));

alter table public.crm_activities
  drop constraint if exists crm_activities_status_check;
alter table public.crm_activities
  add constraint crm_activities_status_check
  check (status in ('planned', 'in_progress', 'completed', 'cancelled'));

alter table public.crm_activities
  drop constraint if exists crm_activities_time_check;
alter table public.crm_activities
  add constraint crm_activities_time_check
  check (ends_at is null or starts_at is null or ends_at > starts_at);

alter table public.crm_activities
  drop constraint if exists crm_activities_attendees_check;
alter table public.crm_activities
  add constraint crm_activities_attendees_check
  check (jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) <= 50);

create index if not exists idx_crm_activities_starts_at
  on public.crm_activities(starts_at);
create index if not exists idx_crm_activities_member_starts
  on public.crm_activities(assigned_member_id, starts_at desc);

create table if not exists public.crm_activity_events (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  event_type text not null,
  snapshot jsonb not null default '{}'::jsonb,
  actor_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_activity_events_activity_created
  on public.crm_activity_events(activity_id, created_at desc);

create or replace function public.audit_crm_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_activity_id uuid;
  v_snapshot jsonb;
begin
  v_actor := public.get_member_id();
  if tg_op = 'DELETE' then
    v_activity_id := old.id;
    v_snapshot := to_jsonb(old);
  else
    v_activity_id := new.id;
    v_snapshot := to_jsonb(new);
  end if;
  insert into public.crm_activity_events(activity_id, event_type, snapshot, actor_member_id)
  values (
    v_activity_id,
    case when tg_op = 'INSERT' then 'created' when tg_op = 'UPDATE' then 'updated' else 'deleted' end,
    v_snapshot,
    v_actor
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_crm_activity_change on public.crm_activities;
create trigger audit_crm_activity_change
after insert or update or delete on public.crm_activities
for each row execute function public.audit_crm_activity_change();

revoke all on function public.audit_crm_activity_change() from public, anon, authenticated;

create table if not exists public.crm_sales_goals (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  period_start date not null,
  activity_target integer not null default 0 check (activity_target >= 0),
  meeting_target integer not null default 0 check (meeting_target >= 0),
  offer_target integer not null default 0 check (offer_target >= 0),
  accepted_offer_target integer not null default 0 check (accepted_offer_target >= 0),
  revenue_target numeric(14,2) not null default 0 check (revenue_target >= 0),
  notes text,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, period_start),
  check (period_start = date_trunc('month', period_start)::date)
);

drop trigger if exists update_crm_sales_goals_updated_at on public.crm_sales_goals;
create trigger update_crm_sales_goals_updated_at
before update on public.crm_sales_goals
for each row execute function public.update_crm_updated_at();

create table if not exists public.crm_opportunity_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  business_type text not null default 'general',
  default_stage text not null default 'lead',
  default_priority text not null default 'medium',
  default_probability integer not null default 10 check (default_probability between 0 and 100),
  default_category text,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  item_presets jsonb not null default '[]'::jsonb check (jsonb_typeof(item_presets) = 'array'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_crm_opportunity_templates_updated_at on public.crm_opportunity_templates;
create trigger update_crm_opportunity_templates_updated_at
before update on public.crm_opportunity_templates
for each row execute function public.update_crm_updated_at();

alter table public.crm_opportunities
  add column if not exists template_id uuid references public.crm_opportunity_templates(id) on delete set null;

insert into public.crm_opportunity_templates (
  name, description, business_type, default_stage, default_priority,
  default_probability, default_category, custom_fields, checklist
)
values (
  'FVE – standardní obchodní případ',
  'Výchozí šablona EKV pro kvalifikaci, návrh a uzavření FVE zakázky.',
  'fve', 'lead', 'medium', 10, 'FVE',
  jsonb_build_object(
    'invoice_mode', 'po etapach',
    'installation_address', '',
    'parcel_number', '',
    'system_power_kwp', null,
    'panel_count', null,
    'inverter_type', '',
    'battery_capacity_kwh', null,
    'subsidy_status', 'neresi se',
    'documentation_status', 'chybi'
  ),
  jsonb_build_array(
    'Ověřit kontakt a adresu instalace',
    'Doplnit spotřebu a technické parametry',
    'Prověřit možnosti dotace',
    'Naplánovat technickou prohlídku',
    'Připravit a odeslat nabídku',
    'Zapsat výsledek jednání a další krok'
  )
)
on conflict (name) do nothing;

create or replace function public.initialize_crm_opportunity_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checklist jsonb;
begin
  if new.template_id is null then return new; end if;
  select t.checklist into v_checklist
  from public.crm_opportunity_templates t
  where t.id = new.template_id and t.is_active;
  if v_checklist is null then return new; end if;

  insert into public.crm_activities (
    opportunity_id, subject_id, project_id, assigned_member_id, created_by_member_id,
    type, status, title, starts_at, due_at
  )
  select new.id, new.subject_id, new.project_id, new.owner_member_id, public.get_member_id(),
    'task', 'planned', item.title,
    now() + ((item.position - 1)::integer * interval '1 day'),
    now() + ((item.position - 1)::integer * interval '1 day')
  from jsonb_array_elements_text(v_checklist) with ordinality as item(title, position)
  where nullif(trim(item.title), '') is not null;
  return new;
end;
$$;

drop trigger if exists initialize_crm_opportunity_template on public.crm_opportunities;
create trigger initialize_crm_opportunity_template
after insert on public.crm_opportunities
for each row execute function public.initialize_crm_opportunity_template();

revoke all on function public.initialize_crm_opportunity_template() from public, anon, authenticated;

alter table public.crm_activity_events enable row level security;
alter table public.crm_sales_goals enable row level security;
alter table public.crm_opportunity_templates enable row level security;

drop policy if exists "CRM activity events read access" on public.crm_activity_events;
create policy "CRM activity events read access" on public.crm_activity_events
for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm'
      and (p.can_read or p.can_edit or p.can_admin)
  )
);

drop policy if exists "CRM sales goals read access" on public.crm_sales_goals;
create policy "CRM sales goals read access" on public.crm_sales_goals
for select to authenticated using (
  member_id = public.get_member_id()
  or public.get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  )
);

drop policy if exists "CRM sales goals admin access" on public.crm_sales_goals;
create policy "CRM sales goals admin access" on public.crm_sales_goals
for all to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  )
) with check (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  )
);

drop policy if exists "CRM opportunity templates read access" on public.crm_opportunity_templates;
create policy "CRM opportunity templates read access" on public.crm_opportunity_templates
for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm'
      and (p.can_read or p.can_edit or p.can_admin)
  )
);

drop policy if exists "CRM opportunity templates admin access" on public.crm_opportunity_templates;
create policy "CRM opportunity templates admin access" on public.crm_opportunity_templates
for all to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  )
) with check (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  )
);

revoke all on public.crm_activity_events, public.crm_sales_goals, public.crm_opportunity_templates from anon;
grant select on public.crm_activity_events to authenticated;
grant select, insert, update, delete on public.crm_sales_goals to authenticated;
grant select, insert, update, delete on public.crm_opportunity_templates to authenticated;
grant all on public.crm_activity_events, public.crm_sales_goals, public.crm_opportunity_templates to service_role;

create or replace function public.get_crm_sales_performance(p_from date, p_to date)
returns table (
  member_id uuid,
  member_name text,
  activities_count bigint,
  completed_activities_count bigint,
  meetings_count bigint,
  completed_meetings_count bigint,
  offers_count bigint,
  accepted_offers_count bigint,
  accepted_revenue numeric,
  activity_target integer,
  meeting_target integer,
  offer_target integer,
  accepted_offer_target integer,
  revenue_target numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (
    public.get_user_role() = 'admin'
    or exists (
      select 1 from public.role_permissions p
      where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
    )
  ) then raise exception 'CRM admin permission required'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid reporting period';
  end if;

  return query
  with activity_stats as (
    select a.assigned_member_id,
      count(*) as activities_count,
      count(*) filter (where a.status = 'completed') as completed_activities_count,
      count(*) filter (where a.type = 'meeting') as meetings_count,
      count(*) filter (where a.type = 'meeting' and a.status = 'completed') as completed_meetings_count
    from public.crm_activities a
    where coalesce(a.starts_at, a.due_at, a.created_at) >= p_from::timestamptz
      and coalesce(a.starts_at, a.due_at, a.created_at) < (p_to + 1)::timestamptz
    group by a.assigned_member_id
  ), offer_stats as (
    select o.owner_member_id,
      count(d.id) filter (
        where d.type = 'offer'
          and d.created_at >= p_from::timestamptz and d.created_at < (p_to + 1)::timestamptz
      ) as offers_count,
      count(d.id) filter (
        where d.type = 'offer' and d.status = 'accepted'
          and d.accepted_at >= p_from::timestamptz and d.accepted_at < (p_to + 1)::timestamptz
      ) as accepted_offers_count,
      coalesce(sum(d.total) filter (
        where d.type = 'offer' and d.status = 'accepted'
          and d.accepted_at >= p_from::timestamptz and d.accepted_at < (p_to + 1)::timestamptz
      ), 0) as accepted_revenue
    from public.crm_opportunities o
    join public.crm_commercial_documents d on d.opportunity_id = o.id
    where d.deleted_at is null
      and (
        (d.created_at >= p_from::timestamptz and d.created_at < (p_to + 1)::timestamptz)
        or (d.accepted_at >= p_from::timestamptz and d.accepted_at < (p_to + 1)::timestamptz)
      )
    group by o.owner_member_id
  ), period_goal as (
    select g.* from public.crm_sales_goals g
    where g.period_start = date_trunc('month', p_from)::date
  )
  select m.id, m.name,
    coalesce(a.activities_count, 0), coalesce(a.completed_activities_count, 0),
    coalesce(a.meetings_count, 0), coalesce(a.completed_meetings_count, 0),
    coalesce(os.offers_count, 0), coalesce(os.accepted_offers_count, 0),
    coalesce(os.accepted_revenue, 0),
    coalesce(g.activity_target, 0), coalesce(g.meeting_target, 0),
    coalesce(g.offer_target, 0), coalesce(g.accepted_offer_target, 0),
    coalesce(g.revenue_target, 0)
  from public.members m
  left join activity_stats a on a.assigned_member_id = m.id
  left join offer_stats os on os.owner_member_id = m.id
  left join period_goal g on g.member_id = m.id
  where m.auth_user_id is not null
    and (
      m.user_role = 'admin'
      or exists (
        select 1 from public.role_permissions rp
        where rp.role = m.user_role and rp.module = 'crm'
          and (rp.can_read or rp.can_edit or rp.can_admin)
      )
    )
    and not exists (
      select 1 from public.user_account_status uas
      where uas.auth_user_id = m.auth_user_id and uas.status <> 'active'
    )
  order by m.name;
end;
$$;

revoke all on function public.get_crm_sales_performance(date, date) from public, anon;
grant execute on function public.get_crm_sales_performance(date, date) to authenticated, service_role;

commit;
