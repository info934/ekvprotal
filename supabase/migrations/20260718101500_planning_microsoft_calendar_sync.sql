-- Microsoft 365 calendar synchronization for planning items.
-- EKVPortal remains the scheduling source of truth. Financial data is never copied to calendars.

alter table public.members
  add column if not exists microsoft_calendar_email text,
  add column if not exists microsoft_calendar_enabled boolean not null default true;

alter table public.planning_items
  add column if not exists calendar_sync_enabled boolean not null default false;

create table if not exists public.planning_calendar_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.planning_items(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  provider text not null default 'microsoft365' check (provider = 'microsoft365'),
  mailbox_address text not null,
  external_calendar_id text not null default 'calendar',
  external_event_id text,
  external_change_key text,
  web_link text,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'synced', 'error', 'disabled')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planning_calendar_links_member_idx
  on public.planning_calendar_links(member_id, sync_status);
create index if not exists planning_calendar_links_status_idx
  on public.planning_calendar_links(sync_status, updated_at);

create table if not exists public.planning_calendar_sync_queue (
  id bigint generated always as identity primary key,
  item_id uuid,
  operation text not null default 'upsert' check (operation in ('upsert', 'delete')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists planning_calendar_sync_queue_open_uidx
  on public.planning_calendar_sync_queue(item_id)
  where item_id is not null and status in ('pending', 'processing');
create index if not exists planning_calendar_sync_queue_ready_idx
  on public.planning_calendar_sync_queue(status, available_at)
  where status in ('pending', 'failed');

create table if not exists public.planning_calendar_sync_log (
  id bigint generated always as identity primary key,
  plan_id uuid references public.planning_plans(id) on delete set null,
  item_id uuid,
  member_id uuid references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  status text not null check (status in ('success', 'error', 'skipped')),
  mailbox_address text,
  external_event_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists planning_calendar_sync_log_plan_created_idx
  on public.planning_calendar_sync_log(plan_id, created_at desc);
create index if not exists planning_calendar_sync_log_item_created_idx
  on public.planning_calendar_sync_log(item_id, created_at desc);

drop trigger if exists planning_calendar_links_updated_at on public.planning_calendar_links;
create trigger planning_calendar_links_updated_at
before update on public.planning_calendar_links
for each row execute function public.planning_set_updated_at();

drop trigger if exists planning_calendar_sync_queue_updated_at on public.planning_calendar_sync_queue;
create trigger planning_calendar_sync_queue_updated_at
before update on public.planning_calendar_sync_queue
for each row execute function public.planning_set_updated_at();

create or replace function public.enqueue_planning_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.planning_calendar_links%rowtype;
  v_operation text;
  v_item_id uuid;
  v_payload jsonb;
begin
  if tg_op = 'DELETE' then
    v_item_id := old.id;
    select * into v_link from public.planning_calendar_links where item_id = old.id;
    if v_link.external_event_id is null then
      return old;
    end if;
    v_operation := 'delete';
    v_payload := jsonb_build_object(
      'plan_id', old.plan_id,
      'member_id', old.member_id,
      'mailbox_address', v_link.mailbox_address,
      'external_event_id', v_link.external_event_id
    );
  else
    v_item_id := new.id;
    v_operation := case when new.calendar_sync_enabled then 'upsert' else 'delete' end;
    select * into v_link from public.planning_calendar_links where item_id = new.id;
    if not new.calendar_sync_enabled and v_link.external_event_id is null then
      return new;
    end if;
    v_payload := jsonb_build_object('plan_id', new.plan_id, 'member_id', new.member_id);
  end if;

  insert into public.planning_calendar_sync_queue (item_id, operation, status, payload, available_at)
  values (v_item_id, v_operation, 'pending', v_payload, now())
  on conflict (item_id) where item_id is not null and status in ('pending', 'processing')
  do update set
    operation = excluded.operation,
    status = 'pending',
    payload = excluded.payload,
    available_at = now(),
    locked_at = null,
    last_error = null;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists planning_items_enqueue_calendar_sync on public.planning_items;
create trigger planning_items_enqueue_calendar_sync
after insert or update of name, description, start_date, end_date, member_id, status, calendar_sync_enabled
on public.planning_items
for each row execute function public.enqueue_planning_calendar_sync();

drop trigger if exists planning_items_enqueue_calendar_delete on public.planning_items;
create trigger planning_items_enqueue_calendar_delete
before delete on public.planning_items
for each row execute function public.enqueue_planning_calendar_sync();

alter table public.planning_calendar_links enable row level security;
alter table public.planning_calendar_sync_queue enable row level security;
alter table public.planning_calendar_sync_log enable row level security;

create policy "Planning calendar links visible by plan access"
on public.planning_calendar_links for select to authenticated
using (
  exists (
    select 1 from public.planning_items pi
    where pi.id = item_id and public.planning_can_read_plan(pi.plan_id)
  )
);

create policy "Planning calendar logs visible by plan access"
on public.planning_calendar_sync_log for select to authenticated
using (plan_id is not null and public.planning_can_read_plan(plan_id));

revoke all on public.planning_calendar_links from public, anon, authenticated;
revoke all on public.planning_calendar_sync_queue from public, anon, authenticated;
revoke all on public.planning_calendar_sync_log from public, anon, authenticated;
grant select on public.planning_calendar_links to authenticated;
grant select on public.planning_calendar_sync_log to authenticated;

grant all on public.planning_calendar_links to service_role;
grant all on public.planning_calendar_sync_queue to service_role;
grant all on public.planning_calendar_sync_log to service_role;
grant usage, select on sequence public.planning_calendar_sync_queue_id_seq to service_role;
grant usage, select on sequence public.planning_calendar_sync_log_id_seq to service_role;

revoke all on function public.enqueue_planning_calendar_sync() from public, anon, authenticated;
grant execute on function public.enqueue_planning_calendar_sync() to service_role;
