insert into public.app_settings (key, value)
values ('planning_company_calendar_id', '')
on conflict (key) do nothing;

comment on column public.planning_calendar_links.target_scope is
  'company links target the configured mailbox and optional explicit calendar id';
