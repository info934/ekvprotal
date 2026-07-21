-- Make SharePoint mappings and external file ownership server-authoritative.

create table if not exists public.document_storage_files (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.document_storage_connections(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,
  external_file_id text not null,
  external_parent_id text,
  file_name text not null,
  external_web_url text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (connection_id, external_file_id)
);

create index if not exists document_storage_files_entity_idx
  on public.document_storage_files(entity_type, entity_id, created_at desc);
create index if not exists document_storage_files_owner_idx
  on public.document_storage_files(owner_type, owner_id, created_at desc);

-- Preserve access to external files uploaded before the registry existed.
insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, external_parent_id, file_name, external_web_url, metadata
)
select
  d.storage_connection_id, 'project', d.project_id, 'document', d.id,
  d.external_file_id, d.external_parent_id, coalesce(d.file_name, d.name),
  d.external_web_url, coalesce(d.storage_metadata, '{}'::jsonb)
from public.documents d
where d.project_id is not null
  and d.storage_connection_id is not null
  and d.external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  c.invoice_storage_connection_id, 'project', c.project_id, 'project_cost', c.id,
  c.invoice_external_file_id, coalesce(c.invoice_name, 'faktura'),
  c.invoice_external_web_url, coalesce(c.invoice_storage_metadata, '{}'::jsonb)
from public.project_costs c
where c.invoice_storage_connection_id is not null
  and c.invoice_external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  c.invoice_storage_connection_id, 'invoice', c.id, 'project', c.project_id,
  c.invoice_storage_metadata ->> 'centralLinkFileId',
  concat('Odkaz - ', coalesce(c.invoice_name, 'faktura'), '.url'),
  c.invoice_storage_metadata ->> 'centralLinkWebUrl',
  jsonb_build_object('documentKind', 'project_cost_invoice_shortcut')
from public.project_costs c
where c.invoice_storage_connection_id is not null
  and nullif(c.invoice_storage_metadata ->> 'centralLinkFileId', '') is not null
on conflict (connection_id, external_file_id) do nothing;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  c.invoice_storage_connection_id, 'invoice', c.id, 'realizace', c.realizace_id,
  c.invoice_external_file_id, coalesce(c.invoice_name, 'faktura'),
  c.invoice_external_web_url, coalesce(c.invoice_storage_metadata, '{}'::jsonb)
from public.realizace_costs c
where c.invoice_storage_connection_id is not null
  and c.invoice_external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  p.datasheet_storage_connection_id, 'product', p.id, 'product_datasheet', p.id,
  p.datasheet_external_file_id, coalesce(p.datasheet_file_name, p.name),
  p.datasheet_external_web_url, coalesce(p.datasheet_storage_metadata, '{}'::jsonb)
from public.commercial_item_catalog p
where p.datasheet_storage_connection_id is not null
  and p.datasheet_external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

alter table public.document_storage_files enable row level security;
revoke all on public.document_storage_files from public, anon, authenticated;
grant all on public.document_storage_files to service_role;

drop policy if exists "Document editors can manage storage folders" on public.document_storage_folders;
drop policy if exists "Document readers can read storage folders" on public.document_storage_folders;

create policy "Entity users can read storage folders"
on public.document_storage_folders
for select
to authenticated
using (
  public.get_user_role() = 'admin'
  or (entity_type = 'project' and public.can_access_project(entity_id))
  or (entity_type = 'realizace' and public.can_access_realization(entity_id))
  or (
    entity_type = 'product'
    and exists (
      select 1 from public.role_permissions rp
      where rp.role = public.get_user_role()
        and rp.module = 'crm'
        and rp.can_read = true
    )
  )
);

revoke insert, update, delete on public.document_storage_folders from authenticated;
grant select on public.document_storage_folders to authenticated;

create or replace function public.upsert_document_storage_folder(
  p_connection_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_folder_path text,
  p_external_folder_id text default null,
  p_external_web_url text default null,
  p_status text default 'created',
  p_metadata jsonb default '{}'::jsonb
)
returns public.document_storage_folders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean := false;
  v_row public.document_storage_folders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_entity_type not in ('project', 'realizace', 'product') then
    raise exception 'Unsupported storage entity type %', p_entity_type;
  end if;

  v_allowed := public.get_user_role() = 'admin'
    or (
      p_entity_type = 'project'
      and public.can_edit_module('projects')
      and public.can_access_project(p_entity_id)
    )
    or (
      p_entity_type = 'realizace'
      and public.can_edit_module('realizace')
      and public.can_access_realization(p_entity_id)
    )
    or (
      p_entity_type = 'product'
      and public.can_edit_crm()
    );
  if not v_allowed then
    raise exception 'Not allowed to manage this storage folder';
  end if;

  insert into public.document_storage_folders (
    connection_id, entity_type, entity_id, folder_path, external_folder_id,
    external_web_url, status, metadata, updated_at
  ) values (
    p_connection_id, p_entity_type, p_entity_id, p_folder_path, p_external_folder_id,
    p_external_web_url, p_status, coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (connection_id, entity_type, entity_id) do update
  set folder_path = case
        when public.document_storage_folders.external_folder_id is not null
          then public.document_storage_folders.folder_path
        else excluded.folder_path
      end,
      external_folder_id = coalesce(public.document_storage_folders.external_folder_id, excluded.external_folder_id),
      external_web_url = coalesce(public.document_storage_folders.external_web_url, excluded.external_web_url),
      status = excluded.status,
      metadata = coalesce(public.document_storage_folders.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_document_storage_folder(uuid, text, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.upsert_document_storage_folder(uuid, text, uuid, text, text, text, text, jsonb) to authenticated;

-- Financial files must never rely on a permanently public URL.
update storage.buckets
set public = false
where id in ('project-files', 'invoices');
