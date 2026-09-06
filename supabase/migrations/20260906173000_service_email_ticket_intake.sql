begin;

alter table public.service_cases drop constraint if exists service_cases_source_check;
alter table public.service_cases add constraint service_cases_source_check
  check (source in ('client', 'email', 'internal', 'monitoring', 'other'));

create table public.service_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  status text not null default 'new' check (status in ('new', 'triage', 'converted', 'closed', 'spam')),
  source text not null default 'email' check (source in ('email', 'manual')),
  provider text not null default 'microsoft_graph',
  provider_message_id text,
  internet_message_id text,
  mailbox_address text not null,
  sender_name text,
  sender_email text not null,
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'),
  cc_recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(cc_recipients) = 'array'),
  subject text not null,
  body_text text not null default '',
  body_html text,
  received_at timestamptz not null,
  attachment_count integer not null default 0 check (attachment_count between 0 and 100),
  suggested_subject_id uuid references public.subjects(id) on delete set null,
  suggested_opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  suggested_realizace_id uuid references public.realizations(id) on delete set null,
  suggested_project_id uuid references public.projects(id) on delete set null,
  service_case_id uuid references public.service_cases(id) on delete set null,
  converted_at timestamptz,
  converted_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_tickets_provider_message_unique unique (provider, mailbox_address, provider_message_id),
  check (char_length(trim(subject)) between 1 and 500),
  check (char_length(trim(sender_email)) between 3 and 254),
  check (char_length(body_text) <= 1000000),
  check (body_html is null or char_length(body_html) <= 2000000)
);

create table public.service_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  service_ticket_id uuid not null references public.service_tickets(id) on delete cascade,
  service_case_id uuid references public.service_cases(id) on delete set null,
  provider_attachment_id text,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  is_inline boolean not null default false,
  content_id text,
  created_at timestamptz not null default now(),
  constraint service_ticket_attachment_provider_unique unique (service_ticket_id, provider_attachment_id)
);

create table public.service_inbox_state (
  mailbox_address text primary key,
  last_synced_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index service_tickets_status_received_idx on public.service_tickets(status, received_at desc);
create index service_tickets_sender_idx on public.service_tickets(lower(sender_email), received_at desc);
create index service_tickets_case_idx on public.service_tickets(service_case_id) where service_case_id is not null;
create index service_ticket_attachments_ticket_idx on public.service_ticket_attachments(service_ticket_id, created_at);
create index service_ticket_attachments_case_idx on public.service_ticket_attachments(service_case_id) where service_case_id is not null;

create trigger update_service_tickets_updated_at before update on public.service_tickets
for each row execute function public.update_crm_updated_at();
create trigger update_service_inbox_state_updated_at before update on public.service_inbox_state
for each row execute function public.update_crm_updated_at();

insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
values ('service_ticket', 'TKT', 1, 5, 'YY')
on conflict (document_type) do nothing;

insert into public.app_settings(key, value) values
  ('service_inbox_enabled', 'true'),
  ('service_inbox_mailbox', 'service@ekvproject.cz'),
  ('service_inbox_poll_minutes', '5'),
  ('service_inbox_function_url', 'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/service-email-intake')
on conflict (key) do nothing;

create or replace function public.create_service_ticket_from_email(p_payload jsonb)
returns public.service_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_setting public.crm_numbering_settings%rowtype;
  v_number text;
  v_row public.service_tickets%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
  values ('service_ticket', 'TKT', 1, 5, 'YY') on conflict (document_type) do nothing;
  select * into v_setting from public.crm_numbering_settings where document_type = 'service_ticket' for update;
  v_number := concat_ws('-', trim(v_setting.prefix), to_char(current_date, 'YY'), lpad(v_setting.next_number::text, greatest(v_setting.padding, 3), '0'));
  update public.crm_numbering_settings set next_number = v_setting.next_number + 1, updated_at = now()
  where document_type = 'service_ticket';

  insert into public.service_tickets(
    number, provider, provider_message_id, internet_message_id, mailbox_address,
    sender_name, sender_email, recipients, cc_recipients, subject, body_text, body_html,
    received_at, attachment_count, suggested_subject_id, suggested_opportunity_id,
    suggested_realizace_id, suggested_project_id
  ) values (
    v_number,
    coalesce(nullif(p_payload->>'provider', ''), 'microsoft_graph'),
    nullif(p_payload->>'provider_message_id', ''), nullif(p_payload->>'internet_message_id', ''),
    lower(trim(p_payload->>'mailbox_address')), nullif(trim(p_payload->>'sender_name'), ''),
    lower(trim(p_payload->>'sender_email')), coalesce(p_payload->'recipients', '[]'::jsonb),
    coalesce(p_payload->'cc_recipients', '[]'::jsonb), left(coalesce(nullif(trim(p_payload->>'subject'), ''), '(bez předmětu)'), 500),
    left(coalesce(p_payload->>'body_text', ''), 1000000), nullif(left(coalesce(p_payload->>'body_html', ''), 2000000), ''),
    coalesce(nullif(p_payload->>'received_at', '')::timestamptz, now()),
    least(greatest(coalesce((p_payload->>'attachment_count')::integer, 0), 0), 100),
    nullif(p_payload->>'suggested_subject_id', '')::uuid,
    nullif(p_payload->>'suggested_opportunity_id', '')::uuid,
    nullif(p_payload->>'suggested_realizace_id', '')::uuid,
    nullif(p_payload->>'suggested_project_id', '')::uuid
  ) returning * into v_row;

  insert into public.notifications(user_id, type, title, message)
  select distinct m.auth_user_id, 'service_ticket', 'Nový servisní e-mail',
    v_row.number || ' · ' || left(v_row.subject, 180)
  from public.members m
  left join public.role_permissions p on p.role = m.user_role and p.module = 'service'
  where m.auth_user_id is not null and m.is_active = true
    and (m.user_role = 'admin' or p.can_admin or p.can_edit);

  return v_row;
end;
$$;
revoke all on function public.create_service_ticket_from_email(jsonb) from public, anon, authenticated;
grant execute on function public.create_service_ticket_from_email(jsonb) to service_role;

create or replace function public.convert_service_ticket(p_ticket_id uuid, p_payload jsonb default '{}'::jsonb)
returns public.service_cases
language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.service_tickets%rowtype;
  v_payload jsonb;
  v_case public.service_cases%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_edit or p.can_admin)
  )) then raise exception 'Service edit permission required'; end if;

  select * into v_ticket from public.service_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Service ticket not found'; end if;
  if v_ticket.status = 'converted' and v_ticket.service_case_id is not null then
    select * into v_case from public.service_cases where id = v_ticket.service_case_id;
    return v_case;
  end if;
  if v_ticket.status in ('spam', 'closed') then raise exception 'Closed ticket cannot be converted'; end if;

  v_payload := jsonb_build_object(
    'title', left(v_ticket.subject, 200),
    'case_kind', 'complaint',
    'system_type', 'fve',
    'priority', 'normal',
    'warranty_status', 'unknown',
    'source', 'email',
    'subject_id', coalesce(v_ticket.suggested_subject_id::text, ''),
    'opportunity_id', coalesce(v_ticket.suggested_opportunity_id::text, ''),
    'realizace_id', coalesce(v_ticket.suggested_realizace_id::text, ''),
    'project_id', coalesce(v_ticket.suggested_project_id::text, ''),
    'client_name', coalesce(nullif(v_ticket.sender_name, ''), v_ticket.sender_email),
    'client_contact_name', nullif(v_ticket.sender_name, ''),
    'client_email', v_ticket.sender_email,
    'description', coalesce(nullif(v_ticket.body_text, ''), v_ticket.subject)
  ) || coalesce(p_payload, '{}'::jsonb);

  v_case := public.create_service_case(v_payload);
  update public.service_tickets set status = 'converted', service_case_id = v_case.id,
    converted_at = now(), converted_by_member_id = public.get_member_id()
  where id = v_ticket.id;
  update public.service_ticket_attachments set service_case_id = v_case.id
  where service_ticket_id = v_ticket.id;
  insert into public.service_events(service_case_id, event_type, summary, snapshot, actor_member_id)
  values (v_case.id, 'ticket_converted', 'Vytvořeno z příchozího e-mailu ' || v_ticket.number,
    jsonb_build_object('service_ticket_id', v_ticket.id, 'ticket_number', v_ticket.number,
      'sender_email', v_ticket.sender_email, 'internet_message_id', v_ticket.internet_message_id),
    public.get_member_id());
  return v_case;
end;
$$;
revoke all on function public.convert_service_ticket(uuid, jsonb) from public, anon;
grant execute on function public.convert_service_ticket(uuid, jsonb) to authenticated, service_role;

alter table public.service_tickets enable row level security;
alter table public.service_ticket_attachments enable row level security;
alter table public.service_inbox_state enable row level security;

create policy "Service tickets read" on public.service_tickets for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_read or p.can_edit or p.can_admin)
  )
);
create policy "Service tickets edit" on public.service_tickets for update to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_edit or p.can_admin)
  )
) with check (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_edit or p.can_admin)
  )
);
create policy "Service ticket attachments read" on public.service_ticket_attachments for select to authenticated using (
  exists (select 1 from public.service_tickets t where t.id = service_ticket_id)
);
create policy "Service inbox state admin read" on public.service_inbox_state for select to authenticated using (
  public.get_user_role() = 'admin'
);

revoke all on public.service_tickets, public.service_ticket_attachments, public.service_inbox_state from anon;
grant select, update on public.service_tickets to authenticated;
grant select on public.service_ticket_attachments to authenticated;
grant select on public.service_inbox_state to authenticated;
grant all on public.service_tickets, public.service_ticket_attachments, public.service_inbox_state to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-inbox', 'service-inbox', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Service inbox object read" on storage.objects for select to authenticated using (
  bucket_id = 'service-inbox' and exists (
    select 1 from public.service_ticket_attachments a
    join public.service_tickets t on t.id = a.service_ticket_id
    where a.storage_path = name
  )
);

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_email_intake_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'service_email_intake_cron_secret',
      'Authenticates the internal five-minute service mailbox synchronization job.');
  end if;
end;
$$;

create or replace function public.verify_service_email_intake_secret(p_secret text)
returns boolean language sql security definer set search_path = public, vault as $$
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets
    where name = 'service_email_intake_cron_secret'
      and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_service_email_intake_secret(text) from public, anon, authenticated;
grant execute on function public.verify_service_email_intake_secret(text) to service_role;

create or replace function public.invoke_service_email_intake()
returns bigint language plpgsql security definer set search_path = public, vault, net as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select value into v_url from public.app_settings where key = 'service_inbox_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'service_email_intake_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'Service inbox scheduler is not configured';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-service-inbox-secret', v_secret),
    body := jsonb_build_object('action', 'sync')
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.invoke_service_email_intake() from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'service-email-intake-every-5-minutes';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'service-email-intake-every-5-minutes',
    '*/5 * * * *',
    'select public.invoke_service_email_intake();'
  );
end;
$$;

commit;
