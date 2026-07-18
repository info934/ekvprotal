-- Publish planning items to one company-wide Microsoft 365 shared calendar.
-- Personal employee mailboxes remain dedicated to free/busy checks.

alter table public.planning_calendar_links
  add column if not exists target_scope text not null default 'personal'
    check (target_scope in ('personal', 'company'));

create index if not exists planning_calendar_links_scope_status_idx
  on public.planning_calendar_links(target_scope, sync_status, updated_at desc);

insert into public.app_settings (key, value)
values
  ('planning_company_calendar_mailbox', ''),
  ('planning_company_calendar_name', 'EKV Plánování')
on conflict (key) do nothing;

-- Time changes must enqueue the same synchronization as date changes.
drop trigger if exists planning_items_enqueue_calendar_sync on public.planning_items;
create trigger planning_items_enqueue_calendar_sync
after insert or update of name, description, start_date, end_date, start_at, end_at, member_id, status, calendar_sync_enabled
on public.planning_items
for each row execute function public.enqueue_planning_calendar_sync();

comment on column public.planning_calendar_links.target_scope is
  'personal = legacy employee calendar event, company = shared EKV planning calendar event';
