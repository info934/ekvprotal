begin;

create table if not exists public.meeting_note_documents (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.meeting_notes(id) on delete restrict,
  note_version integer not null check (note_version > 0),
  file_name text not null check (length(btrim(file_name)) between 1 and 240),
  storage_provider text not null,
  storage_connection_id uuid null references public.document_storage_connections(id) on delete set null,
  storage_path text not null,
  external_file_id text null,
  external_web_url text null,
  status text not null default 'generated' check (status in ('generated','sent','delivery_error')),
  recipients text[] not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by uuid not null references auth.users(id),
  sent_at timestamptz null,
  last_error text null,
  updated_at timestamptz not null default now(),
  unique (note_id, note_version)
);
create index if not exists meeting_note_documents_note_idx on public.meeting_note_documents(note_id, note_version desc);
alter table public.meeting_note_documents enable row level security;
revoke all on public.meeting_note_documents from public, anon, authenticated;
grant select on public.meeting_note_documents to authenticated;
grant all on public.meeting_note_documents to service_role;
drop policy if exists meeting_note_documents_read on public.meeting_note_documents;
create policy meeting_note_documents_read on public.meeting_note_documents for select to authenticated using (
  exists (select 1 from public.meeting_notes n where n.id=note_id and public.planning_can_read_plan(n.plan_id))
);

create or replace function public.can_edit_meeting_note(p_note_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1 from public.meeting_notes n where n.id=p_note_id and public.planning_can_edit_plan(n.plan_id)
  );
$$;

create or replace function public.upsert_meeting_note_document(
  p_note_id uuid, p_note_version integer, p_file_name text, p_storage_provider text,
  p_storage_connection_id uuid, p_storage_path text, p_external_file_id text, p_external_web_url text
) returns public.meeting_note_documents
language plpgsql security definer set search_path=public as $$
declare v_note public.meeting_notes; v_row public.meeting_note_documents;
begin
  select * into v_note from public.meeting_notes where id=p_note_id;
  if not found or not public.planning_can_edit_plan(v_note.plan_id) then
    raise exception 'Nemáte oprávnění vytvořit dokument zápisu.' using errcode='42501';
  end if;
  if v_note.version<>p_note_version then raise exception 'Zápis byl mezitím změněn. Vytvořte PDF znovu.' using errcode='40001'; end if;
  insert into public.meeting_note_documents(note_id,note_version,file_name,storage_provider,storage_connection_id,storage_path,external_file_id,external_web_url,generated_by)
  values(p_note_id,p_note_version,btrim(p_file_name),p_storage_provider,p_storage_connection_id,p_storage_path,p_external_file_id,p_external_web_url,auth.uid())
  on conflict(note_id,note_version) do update set
    file_name=excluded.file_name, storage_provider=excluded.storage_provider, storage_connection_id=excluded.storage_connection_id,
    storage_path=excluded.storage_path, external_file_id=excluded.external_file_id, external_web_url=excluded.external_web_url,
    status='generated', recipients='{}', sent_at=null, last_error=null, generated_at=now(), generated_by=auth.uid(), updated_at=now()
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.can_edit_meeting_note(uuid) from public, anon;
grant execute on function public.can_edit_meeting_note(uuid) to authenticated, service_role;
revoke all on function public.upsert_meeting_note_document(uuid,integer,text,text,uuid,text,text,text) from public, anon;
grant execute on function public.upsert_meeting_note_document(uuid,integer,text,text,uuid,text,text,text) to authenticated;

update public.document_storage_connections set config=jsonb_set(
  jsonb_set(coalesce(config,'{}'::jsonb),'{targets,project,structure}',
    coalesce(config#>'{targets,project,structure}','[]'::jsonb) || '"02_Dokumentace/03_Zapisy_KD"'::jsonb,true),
  '{targets,realizace,structure}',
    coalesce(config#>'{targets,realizace,structure}','[]'::jsonb) || '"03_Harmonogram_a_KD/01_Zapisy_KD"'::jsonb,true)
where provider='sharepoint' and is_default=true;

commit;
