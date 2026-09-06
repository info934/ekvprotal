begin;

alter table public.realizations add column if not exists shared_drive_link text;
alter table public.service_cases add column if not exists shared_drive_link text;

alter table public.document_storage_folders
  drop constraint if exists document_storage_folders_entity_type_check;
alter table public.document_storage_folders
  add constraint document_storage_folders_entity_type_check
  check (entity_type in ('project', 'realizace', 'service', 'product'));

drop policy if exists "Entity users can read storage folders" on public.document_storage_folders;
create policy "Entity users can read storage folders"
on public.document_storage_folders for select to authenticated
using (
  public.get_user_role() = 'admin'
  or (entity_type = 'project' and public.can_access_project(entity_id))
  or (entity_type = 'realizace' and public.can_access_realization(entity_id))
  or (entity_type = 'service' and public.has_permission('service', 'can_read')
      and exists (select 1 from public.service_cases c where c.id = entity_id))
  or (entity_type = 'product' and public.has_permission('crm', 'can_read'))
);

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
language plpgsql security definer set search_path = public
as $$
declare
  v_allowed boolean := false;
  v_row public.document_storage_folders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_entity_type not in ('project', 'realizace', 'service', 'product') then
    raise exception 'Unsupported storage entity type %', p_entity_type;
  end if;

  v_allowed := public.get_user_role() = 'admin'
    or (p_entity_type = 'project' and public.has_permission('projects', 'can_edit') and public.can_access_project(p_entity_id))
    or (p_entity_type = 'realizace' and public.has_permission('realizace', 'can_edit') and public.can_access_realization(p_entity_id))
    or (p_entity_type = 'service' and public.has_permission('service', 'can_edit')
        and exists (select 1 from public.service_cases c where c.id = p_entity_id))
    or (p_entity_type = 'product' and public.has_permission('crm', 'can_edit'));
  if not v_allowed then raise exception 'Not allowed to manage this storage folder'; end if;

  insert into public.document_storage_folders (
    connection_id, entity_type, entity_id, folder_path, external_folder_id,
    external_web_url, status, metadata, updated_at
  ) values (
    p_connection_id, p_entity_type, p_entity_id, p_folder_path, p_external_folder_id,
    p_external_web_url, p_status, coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (connection_id, entity_type, entity_id) do update
  set folder_path = excluded.folder_path,
      external_folder_id = coalesce(public.document_storage_folders.external_folder_id, excluded.external_folder_id),
      external_web_url = coalesce(excluded.external_web_url, public.document_storage_folders.external_web_url),
      status = excluded.status,
      metadata = coalesce(public.document_storage_folders.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.upsert_document_storage_folder(uuid, text, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.upsert_document_storage_folder(uuid, text, uuid, text, text, text, text, jsonb) to authenticated;

update public.document_storage_connections
set config = jsonb_set(
  jsonb_set(
    coalesce(config, '{}'::jsonb),
    '{targets,realizace}',
    coalesce(config #> '{targets,realizace}', '{}'::jsonb) || jsonb_build_object(
      'rootFolderPath', '',
      'realizationFolderName', '',
      'organizeRealizationsByYear', true,
      'activeFolderName', 'Aktivni',
      'completedFolderName', 'Hotovo',
      'completedStatuses', jsonb_build_array('Dokončeno', 'Předáno'),
      'structure', jsonb_build_array(
        '00_Admin', '01_Smlouvy_a_objednavky', '02_Technicka_dokumentace',
        '03_Harmonogram_a_KD', '04_Naklady/Faktury', '05_Fotodokumentace',
        '06_Revize_a_zkousky', '07_Predani', '08_Fakturace', 'Servis'
      ),
      'costInvoiceFolderPath', '04_Naklady/Faktury'
    ), true
  ),
  '{targets,service}',
  (coalesce(config #> '{targets,realizace}', '{}'::jsonb) - 'structure') || jsonb_build_object(
    'rootFolderPath', '',
    'structure', jsonb_build_array(
      '00_Admin', '01_Fotodokumentace', '02_Servisni_protokoly',
      '03_Predavaci_protokoly', '04_Komunikace', '05_Material_a_mereni'
    )
  ), true
), updated_at = now()
where provider = 'sharepoint' and is_default = true;

commit;
