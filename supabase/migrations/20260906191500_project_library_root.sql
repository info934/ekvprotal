begin;

-- The configured drive is the dedicated "Shared Documents - Projects"
-- SharePoint library. Place new managed project folders directly in that
-- library instead of nesting them under EKVPortal/Projekty.
update public.document_storage_connections
set config = jsonb_set(
      jsonb_set(
        coalesce(config, '{}'::jsonb),
        '{targets,project,rootFolderPath}',
        '""'::jsonb,
        true
      ),
      '{targets,project,projectFolderName}',
      '""'::jsonb,
      true
    ),
    updated_at = now()
where provider = 'sharepoint'
  and is_default = true;

commit;
