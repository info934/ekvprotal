begin;

-- SharePoint folder operations: observable, retryable and repairable.
alter table public.document_storage_folders
  drop constraint if exists document_storage_folders_status_check;
alter table public.document_storage_folders
  add constraint document_storage_folders_status_check
  check (status in ('planned', 'processing', 'created', 'degraded', 'error'));
alter table public.document_storage_folders
  add column if not exists desired_folder_path text,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists last_error text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_verified_at timestamptz;
create index if not exists document_storage_folders_retry_idx
  on public.document_storage_folders(next_retry_at)
  where status in ('planned', 'degraded', 'error');

-- User-owned list layouts shared across devices.
create table if not exists public.portal_saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (char_length(module) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 100),
  route text not null check (char_length(route) between 1 and 500),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  sorting jsonb not null default '[]'::jsonb check (jsonb_typeof(sorting) = 'array'),
  columns jsonb not null default '{}'::jsonb check (jsonb_typeof(columns) = 'object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, module, name)
);
create unique index if not exists portal_saved_views_one_default_idx
  on public.portal_saved_views(user_id, module) where is_default;
create index if not exists portal_saved_views_user_module_idx
  on public.portal_saved_views(user_id, module, updated_at desc);
drop trigger if exists update_portal_saved_views_updated_at on public.portal_saved_views;
create trigger update_portal_saved_views_updated_at before update on public.portal_saved_views
for each row execute function public.update_crm_updated_at();
alter table public.portal_saved_views enable row level security;
drop policy if exists "Saved views own access" on public.portal_saved_views;
create policy "Saved views own access" on public.portal_saved_views for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.portal_saved_views from anon;
grant select, insert, update, delete on public.portal_saved_views to authenticated;
grant all on public.portal_saved_views to service_role;

-- Notifications can navigate directly to their source record.
alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists action_url text,
  add column if not exists read_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists notifications_unread_created_idx
  on public.notifications(user_id, created_at desc) where is_read = false;

-- Configurable service SLA and normalized operational costs.
create table if not exists public.service_sla_policies (
  priority text primary key check (priority in ('low', 'normal', 'high', 'critical')),
  response_minutes integer not null check (response_minutes between 15 and 100800),
  resolution_minutes integer not null check (resolution_minutes between 15 and 525600),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.service_sla_policies(priority, response_minutes, resolution_minutes) values
  ('critical', 120, 480),
  ('high', 480, 2880),
  ('normal', 1440, 7200),
  ('low', 2880, 14400)
on conflict (priority) do nothing;

-- E-mail is a first-class source for automatically created service tickets.
alter table public.service_cases drop constraint if exists service_cases_source_check;
alter table public.service_cases add constraint service_cases_source_check
  check (source in ('client', 'email', 'internal', 'monitoring', 'other'));

alter table public.service_cases
  add column if not exists resolution_due_at timestamptz,
  add column if not exists sla_breached_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_client_update_at timestamptz,
  add column if not exists public_status_enabled boolean not null default false;
create index if not exists service_cases_sla_due_idx
  on public.service_cases(response_due_at, resolution_due_at)
  where status not in ('resolved', 'closed', 'cancelled');

create or replace function public.apply_service_sla_deadlines()
returns trigger language plpgsql set search_path = public as $$
declare v_policy public.service_sla_policies%rowtype;
begin
  select * into v_policy from public.service_sla_policies where priority = new.priority and is_active;
  if found then
    if new.response_due_at is null or (tg_op = 'UPDATE' and new.priority is distinct from old.priority) then
      new.response_due_at := coalesce(new.reported_at, now()) + make_interval(mins => v_policy.response_minutes);
    end if;
    if new.resolution_due_at is null or (tg_op = 'UPDATE' and new.priority is distinct from old.priority) then
      new.resolution_due_at := coalesce(new.reported_at, now()) + make_interval(mins => v_policy.resolution_minutes);
    end if;
  end if;
  if new.status in ('resolved', 'closed', 'cancelled') then new.sla_breached_at := null; end if;
  return new;
end;
$$;
drop trigger if exists apply_service_sla_deadlines on public.service_cases;
create trigger apply_service_sla_deadlines before insert or update of priority, reported_at, status
on public.service_cases for each row execute function public.apply_service_sla_deadlines();

alter table public.service_visits
  add column if not exists client_mutation_id uuid,
  add column if not exists offline_synced_at timestamptz,
  add column if not exists client_signature_data_url text,
  add column if not exists client_signed_by text,
  add column if not exists client_signed_at timestamptz;
create unique index if not exists service_visits_client_mutation_idx
  on public.service_visits(client_mutation_id) where client_mutation_id is not null;

alter table public.service_attachments
  add column if not exists client_mutation_id uuid;
create unique index if not exists service_attachments_client_mutation_idx
  on public.service_attachments(client_mutation_id) where client_mutation_id is not null;

create table if not exists public.service_work_entries (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  service_visit_id uuid references public.service_visits(id) on delete cascade,
  entry_type text not null check (entry_type in ('labor', 'travel', 'material', 'other')),
  description text not null check (char_length(trim(description)) between 1 and 500),
  quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit text not null default 'ks' check (char_length(unit) between 1 and 20),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  total_cost numeric(16,2) generated always as (round(quantity * unit_cost, 2)) stored,
  billable boolean not null default true,
  client_mutation_id uuid,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_work_entries_case_idx on public.service_work_entries(service_case_id, created_at desc);
create unique index if not exists service_work_entries_client_mutation_idx
  on public.service_work_entries(client_mutation_id) where client_mutation_id is not null;

create table if not exists public.service_alert_queue (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  recipient_user_id uuid not null,
  alert_type text not null check (alert_type in ('response_due', 'resolution_due', 'sla_breached')),
  scheduled_for timestamptz not null,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique(service_case_id, recipient_user_id, alert_type, scheduled_for)
);
create index if not exists service_alert_queue_due_idx on public.service_alert_queue(scheduled_for) where dispatched_at is null;

create table if not exists public.service_public_links (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_public_links_case_idx on public.service_public_links(service_case_id, created_at desc);

alter table public.service_sla_policies enable row level security;
alter table public.service_work_entries enable row level security;
alter table public.service_public_links enable row level security;
alter table public.service_alert_queue enable row level security;
drop policy if exists "Service SLA read" on public.service_sla_policies;
create policy "Service SLA read" on public.service_sla_policies for select to authenticated using (true);
drop policy if exists "Service SLA admin" on public.service_sla_policies;
create policy "Service SLA admin" on public.service_sla_policies for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
drop policy if exists "Service work follows case" on public.service_work_entries;
create policy "Service work follows case" on public.service_work_entries for all to authenticated
using (exists (select 1 from public.service_cases c where c.id = service_case_id))
with check (exists (select 1 from public.service_cases c where c.id = service_case_id));
drop policy if exists "Service links follow case" on public.service_public_links;
create policy "Service links follow case" on public.service_public_links for all to authenticated
using (exists (select 1 from public.service_cases c where c.id = service_case_id))
with check (exists (select 1 from public.service_cases c where c.id = service_case_id));
drop policy if exists "Service alerts own read" on public.service_alert_queue;
create policy "Service alerts own read" on public.service_alert_queue for select to authenticated using (recipient_user_id = (select auth.uid()));
revoke all on public.service_sla_policies, public.service_work_entries, public.service_public_links, public.service_alert_queue from anon;
grant select on public.service_sla_policies to authenticated;
grant select, insert, update, delete on public.service_work_entries, public.service_public_links to authenticated;
grant select on public.service_alert_queue to authenticated;
grant all on public.service_sla_policies, public.service_work_entries, public.service_public_links, public.service_alert_queue to service_role;

create or replace function public.refresh_service_sla_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if auth.uid() is null or (public.get_user_role() <> 'admin' and not exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'service' and (p.can_read or p.can_edit or p.can_admin)
  )) then raise exception 'Service read permission required'; end if;

  update public.service_cases set sla_breached_at = coalesce(sla_breached_at, now())
  where status not in ('resolved', 'closed', 'cancelled') and sla_breached_at is null
    and coalesce(resolution_due_at, response_due_at) < now();

  insert into public.service_alert_queue(service_case_id, recipient_user_id, alert_type, scheduled_for)
  select c.id, recipients.auth_user_id,
    case when c.sla_breached_at is not null then 'sla_breached'
         when c.response_due_at is not null and c.first_response_at is null then 'response_due'
         else 'resolution_due' end,
    date_trunc('hour', coalesce(c.resolution_due_at, c.response_due_at, now()))
  from public.service_cases c
  join public.members recipients on recipients.auth_user_id is not null
    and (recipients.id = c.assigned_member_id or recipients.user_role = 'admin')
  where c.status not in ('resolved', 'closed', 'cancelled')
    and (c.sla_breached_at is not null
      or (c.first_response_at is null and c.response_due_at between now() and now() + interval '24 hours')
      or c.resolution_due_at between now() and now() + interval '24 hours')
  on conflict do nothing;

  insert into public.notifications(user_id, type, title, message, entity_type, entity_id, action_url, metadata)
  select q.recipient_user_id, 'service_sla',
    case when q.alert_type = 'sla_breached' then 'Servisní případ překročil SLA' else 'Blíží se servisní termín' end,
    c.number || ' · ' || c.title, 'service_case', c.id, '/service/' || c.id::text,
    jsonb_build_object('service_alert_id', q.id, 'alert_type', q.alert_type)
  from public.service_alert_queue q join public.service_cases c on c.id = q.service_case_id
  where q.dispatched_at is null and q.scheduled_for <= now() + interval '24 hours';
  get diagnostics v_count = row_count;
  update public.service_alert_queue set dispatched_at = now()
  where dispatched_at is null and scheduled_for <= now() + interval '24 hours';
  return v_count;
end;
$$;
revoke all on function public.refresh_service_sla_alerts() from public, anon;
grant execute on function public.refresh_service_sla_alerts() to authenticated, service_role;

-- Calendar retry metadata.
alter table public.crm_activities
  add column if not exists calendar_sync_attempt_count integer not null default 0 check (calendar_sync_attempt_count >= 0),
  add column if not exists calendar_next_retry_at timestamptz;
create index if not exists crm_activities_calendar_retry_idx
  on public.crm_activities(calendar_next_retry_at)
  where calendar_sync_enabled = true and calendar_sync_error is not null;

create table if not exists public.crm_attention_alerts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  recipient_user_id uuid not null,
  reason text not null default 'missing_next_step',
  alert_week date not null,
  created_at timestamptz not null default now(),
  unique(opportunity_id, recipient_user_id, reason, alert_week)
);
alter table public.crm_attention_alerts enable row level security;
drop policy if exists "CRM attention own read" on public.crm_attention_alerts;
create policy "CRM attention own read" on public.crm_attention_alerts for select to authenticated using (recipient_user_id = (select auth.uid()));
revoke all on public.crm_attention_alerts from anon;
grant select on public.crm_attention_alerts to authenticated;
grant all on public.crm_attention_alerts to service_role;

create or replace function public.refresh_crm_attention_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if auth.uid() is null or (public.get_user_role() <> 'admin' and not exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm'
      and (p.can_read or p.can_edit or p.can_admin)
  )) then raise exception 'CRM read permission required'; end if;
  with inserted as (
    insert into public.crm_attention_alerts(opportunity_id, recipient_user_id, alert_week)
    select o.id, m.auth_user_id, date_trunc('week', now())::date
    from public.crm_opportunities o join public.members m on m.id = o.owner_member_id and m.auth_user_id is not null
    where o.status = 'open' and coalesce(trim(o.next_step), '') = ''
      and o.updated_at < now() - interval '3 days'
      and not exists (select 1 from public.crm_activities a where a.opportunity_id = o.id and a.status in ('planned', 'in_progress') and coalesce(a.starts_at, a.due_at) >= now())
    on conflict do nothing returning *
  )
  insert into public.notifications(user_id, type, title, message, entity_type, entity_id, action_url, metadata)
  select i.recipient_user_id, 'crm_missing_next_step', 'Obchodní případ nemá další krok',
    o.number || ' · ' || o.title, 'crm_opportunity', o.id, '/crm/opportunities/' || o.id::text,
    jsonb_build_object('crm_attention_alert_id', i.id)
  from inserted i join public.crm_opportunities o on o.id = i.opportunity_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.refresh_crm_attention_alerts() from public, anon;
grant execute on function public.refresh_crm_attention_alerts() to authenticated, service_role;

-- Configurable offer approval.
create table if not exists public.crm_approval_settings (
  singleton boolean primary key default true check (singleton),
  discount_threshold_percent numeric(6,2) not null default 15 check (discount_threshold_percent between 0 and 100),
  margin_floor_percent numeric(6,2) not null default 20 check (margin_floor_percent between -100 and 100),
  updated_at timestamptz not null default now()
);
insert into public.crm_approval_settings(singleton) values (true) on conflict (singleton) do nothing;

alter table public.crm_commercial_documents
  add column if not exists approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'required', 'pending', 'approved', 'rejected')),
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_member_id uuid references public.members(id) on delete set null;

create table if not exists public.crm_offer_approval_requests (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.crm_commercial_documents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  requested_by_member_id uuid references public.members(id) on delete set null,
  decided_by_member_id uuid references public.members(id) on delete set null,
  decision_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists crm_offer_approval_one_pending_idx
  on public.crm_offer_approval_requests(document_id) where status = 'pending';
create index if not exists crm_offer_approval_status_idx on public.crm_offer_approval_requests(status, requested_at desc);

create or replace function public.crm_offer_approval_check(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc public.crm_commercial_documents%rowtype;
  v_settings public.crm_approval_settings%rowtype;
  v_discount numeric := 0;
  v_reasons jsonb := '[]'::jsonb;
begin
  select * into v_doc from public.crm_commercial_documents where id = p_document_id and deleted_at is null;
  if not found or v_doc.type <> 'offer' then return jsonb_build_object('required', false, 'reasons', v_reasons); end if;
  select * into v_settings from public.crm_approval_settings where singleton;
  if coalesce(v_doc.gross_subtotal, 0) > 0 then
    v_discount := round(coalesce(v_doc.discount_total, 0) / v_doc.gross_subtotal * 100, 2);
  end if;
  if v_discount > v_settings.discount_threshold_percent then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'discount', 'value', v_discount, 'limit', v_settings.discount_threshold_percent));
  end if;
  if coalesce(v_doc.margin_percent, 0) < v_settings.margin_floor_percent then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'margin', 'value', coalesce(v_doc.margin_percent, 0), 'limit', v_settings.margin_floor_percent));
  end if;
  return jsonb_build_object('required', jsonb_array_length(v_reasons) > 0, 'reasons', v_reasons,
    'discount_percent', v_discount, 'margin_percent', coalesce(v_doc.margin_percent, 0));
end;
$$;

create or replace function public.submit_crm_offer_for_approval(p_document_id uuid)
returns public.crm_offer_approval_requests language plpgsql security definer set search_path = public as $$
declare v_check jsonb; v_request public.crm_offer_approval_requests%rowtype;
begin
  if auth.uid() is null or not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  v_check := public.crm_offer_approval_check(p_document_id);
  if not coalesce((v_check->>'required')::boolean, false) then
    update public.crm_commercial_documents set approval_status = 'not_required', approval_requested_at = null where id = p_document_id;
    raise exception 'Offer does not require approval';
  end if;
  insert into public.crm_offer_approval_requests(document_id, reasons, requested_by_member_id)
  values (p_document_id, v_check->'reasons', public.get_member_id())
  on conflict (document_id) where status = 'pending' do update set reasons = excluded.reasons, requested_at = now()
  returning * into v_request;
  update public.crm_commercial_documents set approval_status = 'pending', approval_requested_at = now(), approved_at = null, approved_by_member_id = null where id = p_document_id;
  insert into public.notifications(user_id, type, title, message, entity_type, entity_id, action_url)
  select m.auth_user_id, 'crm_offer_approval', 'Nabídka čeká na schválení',
    'Nabídka vyžaduje schválení kvůli slevě nebo marži.', 'crm_offer', p_document_id,
    '/crm/offers/' || p_document_id::text
  from public.members m where m.auth_user_id is not null and m.user_role = 'admin';
  return v_request;
end;
$$;

create or replace function public.refresh_crm_offer_approval_state(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_check jsonb; v_status text;
begin
  if auth.uid() is null or not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  v_check := public.crm_offer_approval_check(p_document_id);
  v_status := case when coalesce((v_check->>'required')::boolean, false) then 'required' else 'not_required' end;
  update public.crm_offer_approval_requests set status = 'cancelled', decided_at = now(), decision_note = 'Nabídka byla po žádosti změněna.'
    where document_id = p_document_id and status = 'pending';
  update public.crm_commercial_documents set approval_status = v_status,
    approval_requested_at = null, approved_at = null, approved_by_member_id = null
    where id = p_document_id and type = 'offer';
  return v_check || jsonb_build_object('approval_status', v_status);
end;
$$;

create or replace function public.decide_crm_offer_approval(p_request_id uuid, p_approve boolean, p_note text default null)
returns public.crm_offer_approval_requests language plpgsql security definer set search_path = public as $$
declare v_request public.crm_offer_approval_requests%rowtype;
begin
  if auth.uid() is null or public.get_user_role() <> 'admin' then raise exception 'CRM admin permission required'; end if;
  update public.crm_offer_approval_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by_member_id = public.get_member_id(), decision_note = nullif(trim(p_note), ''), decided_at = now()
  where id = p_request_id and status = 'pending' returning * into v_request;
  if not found then raise exception 'Pending approval request not found'; end if;
  update public.crm_commercial_documents set approval_status = case when p_approve then 'approved' else 'rejected' end,
    approved_at = case when p_approve then now() else null end,
    approved_by_member_id = case when p_approve then public.get_member_id() else null end
  where id = v_request.document_id;
  return v_request;
end;
$$;

create or replace function public.mark_crm_offer_approval_requirement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_check jsonb;
begin
  if new.type <> 'offer' then return new; end if;
  v_check := public.crm_offer_approval_check(new.id);
  if coalesce((v_check->>'required')::boolean, false) then
    if tg_op = 'INSERT' or new.gross_subtotal is distinct from old.gross_subtotal or new.discount_total is distinct from old.discount_total or new.margin_percent is distinct from old.margin_percent then
      new.approval_status := 'required'; new.approved_at := null; new.approved_by_member_id := null;
    end if;
  else new.approval_status := 'not_required'; new.approved_at := null; new.approved_by_member_id := null;
  end if;
  return new;
end;
$$;
-- The check reads the current stored row, so refresh approval state explicitly after draft saves in the application.

alter table public.crm_approval_settings enable row level security;
alter table public.crm_offer_approval_requests enable row level security;
drop policy if exists "CRM approval settings read" on public.crm_approval_settings;
create policy "CRM approval settings read" on public.crm_approval_settings for select to authenticated using (true);
drop policy if exists "CRM approval settings admin" on public.crm_approval_settings;
create policy "CRM approval settings admin" on public.crm_approval_settings for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
drop policy if exists "CRM approvals read" on public.crm_offer_approval_requests;
create policy "CRM approvals read" on public.crm_offer_approval_requests for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm'
      and (p.can_read or p.can_edit or p.can_admin)
  )
);
drop policy if exists "CRM approvals admin" on public.crm_offer_approval_requests;
create policy "CRM approvals admin" on public.crm_offer_approval_requests for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
revoke all on public.crm_approval_settings, public.crm_offer_approval_requests from anon;
grant select, insert, update on public.crm_approval_settings to authenticated;
grant select, insert, update on public.crm_offer_approval_requests to authenticated;
grant all on public.crm_approval_settings, public.crm_offer_approval_requests to service_role;
revoke all on function public.crm_offer_approval_check(uuid), public.submit_crm_offer_for_approval(uuid), public.refresh_crm_offer_approval_state(uuid), public.decide_crm_offer_approval(uuid, boolean, text) from public, anon;
grant execute on function public.crm_offer_approval_check(uuid), public.submit_crm_offer_for_approval(uuid), public.refresh_crm_offer_approval_state(uuid), public.decide_crm_offer_approval(uuid, boolean, text) to authenticated, service_role;

-- Release switches are additive and allow a dark deployment before the single activation.
create table if not exists public.portal_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);
insert into public.portal_feature_flags(key, enabled, description) values
  ('storage_operations_v2', false, 'Stav, retry a oprava SharePoint složek'),
  ('service_offline_v1', false, 'Offline servisní průvodce'),
  ('service_workflow_v2', false, 'SLA, náklady, plánování a zákaznický odkaz'),
  ('crm_approval_v1', false, 'Schvalování slevy a marže'),
  ('workspace_ux_v2', false, 'Hledání, oznámení a uložené pohledy')
on conflict (key) do nothing;
alter table public.portal_feature_flags enable row level security;
drop policy if exists "Feature flags read" on public.portal_feature_flags;
create policy "Feature flags read" on public.portal_feature_flags for select to authenticated using (true);
drop policy if exists "Feature flags admin" on public.portal_feature_flags;
create policy "Feature flags admin" on public.portal_feature_flags for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
revoke all on public.portal_feature_flags from anon;
grant select, update on public.portal_feature_flags to authenticated;
grant all on public.portal_feature_flags to service_role;

commit;
