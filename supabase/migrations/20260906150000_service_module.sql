begin;

insert into public.role_permissions (role, module, can_read, can_edit, can_admin)
select ur.role_name, 'service',
  coalesce(source.can_read, false), coalesce(source.can_edit, false), coalesce(source.can_admin, false)
from public.user_roles ur
left join public.role_permissions source
  on source.role = ur.role_name and source.module = 'realizace'
on conflict (role, module) do nothing;

create table public.service_cases (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  title text not null,
  case_kind text not null default 'service' check (case_kind in ('complaint', 'service', 'maintenance', 'inspection')),
  system_type text not null default 'fve' check (system_type in ('fve', 'fve_bess', 'bess', 'other')),
  status text not null default 'new' check (status in ('new', 'triage', 'scheduled', 'in_progress', 'waiting_parts', 'waiting_client', 'resolved', 'closed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  warranty_status text not null default 'unknown' check (warranty_status in ('unknown', 'in_warranty', 'out_of_warranty', 'goodwill')),
  source text not null default 'client' check (source in ('client', 'internal', 'monitoring', 'other')),
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  realizace_id uuid references public.realizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  client_name text not null,
  client_contact_name text,
  client_email text,
  client_phone text,
  installation_address text,
  description text not null,
  equipment_summary text,
  serial_numbers text,
  error_code text,
  remote_diagnostics text,
  resolution_summary text,
  assigned_member_id uuid references public.members(id) on delete set null,
  reported_at timestamptz not null default now(),
  response_due_at timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(title)) between 3 and 200),
  check (char_length(trim(client_name)) between 2 and 200),
  check (char_length(trim(description)) between 3 and 10000),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  visit_number integer not null,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  lead_technician_id uuid references public.members(id) on delete set null,
  technician_ids uuid[] not null default '{}'::uuid[],
  diagnostics text,
  root_cause text,
  work_performed text,
  materials jsonb not null default '[]'::jsonb,
  measurements jsonb not null default '[]'::jsonb,
  safety_checks jsonb not null default '[]'::jsonb,
  recommendations text,
  next_action text,
  client_statement text,
  client_present boolean not null default false,
  gps_coordinates text,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_case_id, visit_number),
  check (jsonb_typeof(materials) = 'array' and jsonb_array_length(materials) <= 200),
  check (jsonb_typeof(measurements) = 'array' and jsonb_array_length(measurements) <= 200),
  check (jsonb_typeof(safety_checks) = 'array' and jsonb_array_length(safety_checks) <= 100),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);

create table public.service_attachments (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  service_visit_id uuid references public.service_visits(id) on delete set null,
  category text not null default 'other' check (category in ('before', 'during', 'after', 'serial_plate', 'document', 'other')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  caption text,
  captured_at timestamptz,
  uploaded_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.service_documents (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  service_visit_id uuid references public.service_visits(id) on delete set null,
  document_type text not null check (document_type in ('service_protocol', 'handover_protocol')),
  number text not null unique,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'sent', 'viewed', 'signed', 'declined', 'cancelled')),
  recipient_name text,
  recipient_email text,
  document_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(document_snapshot) = 'object'),
  storage_path text,
  pdf_sha256 text,
  pdf_size_bytes bigint,
  signing_token_hash text unique,
  signing_expires_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  signer_name text,
  signer_email text,
  signature_data_url text,
  signature_sha256 text,
  signer_ip text,
  signer_user_agent text,
  consent_text text,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pdf_size_bytes is null or pdf_size_bytes between 100 and 10485760)
);

create table public.service_events (
  id uuid primary key default gen_random_uuid(),
  service_case_id uuid not null references public.service_cases(id) on delete cascade,
  service_visit_id uuid references public.service_visits(id) on delete set null,
  service_document_id uuid references public.service_documents(id) on delete set null,
  event_type text not null,
  summary text not null,
  snapshot jsonb not null default '{}'::jsonb,
  actor_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index service_cases_status_priority_idx on public.service_cases(status, priority, reported_at desc);
create index service_cases_assignee_schedule_idx on public.service_cases(assigned_member_id, scheduled_start);
create index service_cases_links_idx on public.service_cases(opportunity_id, realizace_id, project_id);
create index service_visits_case_idx on public.service_visits(service_case_id, visit_number desc);
create index service_attachments_case_idx on public.service_attachments(service_case_id, created_at desc);
create index service_documents_case_idx on public.service_documents(service_case_id, created_at desc);
create index service_events_case_idx on public.service_events(service_case_id, created_at desc);

create trigger update_service_cases_updated_at before update on public.service_cases
for each row execute function public.update_crm_updated_at();
create trigger update_service_visits_updated_at before update on public.service_visits
for each row execute function public.update_crm_updated_at();
create trigger update_service_documents_updated_at before update on public.service_documents
for each row execute function public.update_crm_updated_at();

create or replace function public.audit_service_case_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.service_events(service_case_id, event_type, summary, snapshot, actor_member_id)
  values (new.id, case when tg_op = 'INSERT' then 'case_created' else 'case_updated' end,
    case when tg_op = 'INSERT' then 'Servisní případ vytvořen' else 'Servisní případ aktualizován' end,
    to_jsonb(new), public.get_member_id());
  return new;
end;
$$;

create trigger audit_service_case_change after insert or update on public.service_cases
for each row execute function public.audit_service_case_change();
revoke all on function public.audit_service_case_change() from public, anon, authenticated;

create or replace function public.audit_service_visit_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.service_events(service_case_id, service_visit_id, event_type, summary, snapshot, actor_member_id)
  values (new.service_case_id, new.id,
    case when tg_op = 'INSERT' then 'visit_created' else 'visit_updated' end,
    case when tg_op = 'INSERT' then 'Servisní výjezd vytvořen' else 'Servisní výjezd aktualizován' end,
    to_jsonb(new), public.get_member_id());
  return new;
end;
$$;

create trigger audit_service_visit_change after insert or update on public.service_visits
for each row execute function public.audit_service_visit_change();
revoke all on function public.audit_service_visit_change() from public, anon, authenticated;

create or replace function public.prevent_signed_service_document_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'signed' then raise exception 'Podepsaný dokument je uzamčený'; end if;
  return new;
end;
$$;
create trigger prevent_signed_service_document_changes before update or delete on public.service_documents
for each row execute function public.prevent_signed_service_document_changes();
revoke all on function public.prevent_signed_service_document_changes() from public, anon, authenticated;

insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
values ('service_case', 'SRV', 1, 4, 'YY'), ('service_handover', 'PS', 1, 3, 'YY')
on conflict (document_type) do nothing;

create or replace function public.create_service_case(p_payload jsonb)
returns public.service_cases
language plpgsql security definer set search_path = public as $$
declare
  v_setting public.crm_numbering_settings%rowtype;
  v_number text;
  v_row public.service_cases%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_edit or p.can_admin)
  )) then raise exception 'Service edit permission required'; end if;

  insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
  values ('service_case', 'SRV', 1, 4, 'YY') on conflict (document_type) do nothing;
  select * into v_setting from public.crm_numbering_settings where document_type = 'service_case' for update;
  v_number := concat_ws('-', trim(v_setting.prefix), to_char(current_date, 'YY'), lpad(v_setting.next_number::text, greatest(v_setting.padding, 3), '0'));
  update public.crm_numbering_settings set next_number = v_setting.next_number + 1, updated_at = now()
  where document_type = 'service_case';

  insert into public.service_cases(
    number, title, case_kind, system_type, priority, warranty_status, source,
    opportunity_id, realizace_id, project_id, subject_id,
    client_name, client_contact_name, client_email, client_phone, installation_address,
    description, equipment_summary, serial_numbers, error_code, remote_diagnostics,
    assigned_member_id, response_due_at, scheduled_start, scheduled_end, created_by_member_id
  ) values (
    v_number, trim(p_payload->>'title'), coalesce(nullif(p_payload->>'case_kind',''), 'service'),
    coalesce(nullif(p_payload->>'system_type',''), 'fve'), coalesce(nullif(p_payload->>'priority',''), 'normal'),
    coalesce(nullif(p_payload->>'warranty_status',''), 'unknown'), coalesce(nullif(p_payload->>'source',''), 'client'),
    nullif(p_payload->>'opportunity_id','')::uuid, nullif(p_payload->>'realizace_id','')::uuid,
    nullif(p_payload->>'project_id','')::uuid, nullif(p_payload->>'subject_id','')::uuid,
    trim(p_payload->>'client_name'), nullif(trim(p_payload->>'client_contact_name'),''), lower(nullif(trim(p_payload->>'client_email'),'')),
    nullif(trim(p_payload->>'client_phone'),''), nullif(trim(p_payload->>'installation_address'),''), trim(p_payload->>'description'),
    nullif(trim(p_payload->>'equipment_summary'),''), nullif(trim(p_payload->>'serial_numbers'),''),
    nullif(trim(p_payload->>'error_code'),''), nullif(trim(p_payload->>'remote_diagnostics'),''),
    nullif(p_payload->>'assigned_member_id','')::uuid, nullif(p_payload->>'response_due_at','')::timestamptz,
    nullif(p_payload->>'scheduled_start','')::timestamptz, nullif(p_payload->>'scheduled_end','')::timestamptz,
    public.get_member_id()
  ) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_service_case(jsonb) from public, anon;
grant execute on function public.create_service_case(jsonb) to authenticated, service_role;

create or replace function public.create_service_document(
  p_service_case_id uuid,
  p_service_visit_id uuid,
  p_document_type text,
  p_document_snapshot jsonb
)
returns public.service_documents
language plpgsql security definer set search_path = public as $$
declare
  v_number_type text;
  v_prefix text;
  v_setting public.crm_numbering_settings%rowtype;
  v_number text;
  v_case public.service_cases%rowtype;
  v_row public.service_documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role()
      and p.module = 'service' and (p.can_edit or p.can_admin)
  )) then raise exception 'Service edit permission required'; end if;
  if p_document_type not in ('service_protocol', 'handover_protocol') then raise exception 'Unsupported service document type'; end if;
  select * into v_case from public.service_cases where id = p_service_case_id;
  if not found then raise exception 'Service case not found'; end if;
  if p_service_visit_id is not null and not exists (
    select 1 from public.service_visits v where v.id = p_service_visit_id and v.service_case_id = p_service_case_id
  ) then raise exception 'Service visit does not belong to case'; end if;

  v_number_type := case when p_document_type = 'service_protocol' then 'service_protocol' else 'service_handover' end;
  v_prefix := case when p_document_type = 'service_protocol' then 'SP' else 'PS' end;
  insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
  values (v_number_type, v_prefix, 1, 3, 'YY') on conflict (document_type) do nothing;
  select * into v_setting from public.crm_numbering_settings where document_type = v_number_type for update;
  v_number := concat_ws('-', trim(v_setting.prefix), to_char(current_date, 'YY'), lpad(v_setting.next_number::text, greatest(v_setting.padding, 3), '0'));
  update public.crm_numbering_settings set next_number = v_setting.next_number + 1, updated_at = now()
  where document_type = v_number_type;

  insert into public.service_documents(
    service_case_id, service_visit_id, document_type, number, title, status,
    recipient_name, recipient_email, document_snapshot, created_by_member_id
  ) values (
    p_service_case_id, p_service_visit_id, p_document_type, v_number,
    case when p_document_type = 'service_protocol' then 'Servisní protokol ' else 'Předávací protokol ' end || v_case.number,
    'ready', v_case.client_contact_name, v_case.client_email,
    coalesce(p_document_snapshot, '{}'::jsonb), public.get_member_id()
  ) returning * into v_row;
  insert into public.service_events(service_case_id, service_visit_id, service_document_id, event_type, summary, snapshot, actor_member_id)
  values (p_service_case_id, p_service_visit_id, v_row.id, 'document_created', 'Dokument ' || v_number || ' vytvořen', to_jsonb(v_row), public.get_member_id());
  return v_row;
end;
$$;
revoke all on function public.create_service_document(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.create_service_document(uuid, uuid, text, jsonb) to authenticated, service_role;

alter table public.service_cases enable row level security;
alter table public.service_visits enable row level security;
alter table public.service_attachments enable row level security;
alter table public.service_documents enable row level security;
alter table public.service_events enable row level security;

create policy "Service cases read" on public.service_cases for select to authenticated using (
  public.get_user_role() = 'admin' or assigned_member_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_read or p.can_edit or p.can_admin)
  )
);
create policy "Service cases edit" on public.service_cases for all to authenticated using (
  public.get_user_role() = 'admin' or assigned_member_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
) with check (
  public.get_user_role() = 'admin' or assigned_member_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
);
create policy "Service visits read" on public.service_visits for select to authenticated using (
  exists (select 1 from public.service_cases c where c.id = service_case_id)
);
create policy "Service visits edit" on public.service_visits for all to authenticated using (
  public.get_user_role() = 'admin' or lead_technician_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
) with check (
  public.get_user_role() = 'admin' or lead_technician_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
);
create policy "Service attachments read" on public.service_attachments for select to authenticated using (
  exists (select 1 from public.service_cases c where c.id = service_case_id)
);
create policy "Service attachments edit" on public.service_attachments for all to authenticated using (
  public.get_user_role() = 'admin' or uploaded_by_member_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
) with check (
  public.get_user_role() = 'admin' or uploaded_by_member_id = public.get_member_id() or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
);
create policy "Service documents read" on public.service_documents for select to authenticated using (
  exists (select 1 from public.service_cases c where c.id = service_case_id)
);
create policy "Service documents edit" on public.service_documents for all to authenticated using (
  status not in ('signed', 'sent', 'viewed') and (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  ))
) with check (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  )
);
create policy "Service events read" on public.service_events for select to authenticated using (
  exists (select 1 from public.service_cases c where c.id = service_case_id)
);

revoke all on public.service_cases, public.service_visits, public.service_attachments, public.service_documents, public.service_events from anon;
grant select, insert, update, delete on public.service_cases, public.service_visits, public.service_attachments, public.service_documents to authenticated;
grant select on public.service_events to authenticated;
grant all on public.service_cases, public.service_visits, public.service_attachments, public.service_documents, public.service_events to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('service-photos', 'service-photos', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('service-documents', 'service-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Service photo read" on storage.objects for select to authenticated using (
  bucket_id = 'service-photos' and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
);
create policy "Service photo upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'service-photos'
  and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  and (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and (p.can_edit or p.can_admin)
  ))
);
create policy "Service photo delete" on storage.objects for delete to authenticated using (
  bucket_id = 'service-photos'
  and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  and (public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'service' and p.can_admin
  ))
);
create policy "Service document object read" on storage.objects for select to authenticated using (
  bucket_id = 'service-documents' and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
);

commit;
