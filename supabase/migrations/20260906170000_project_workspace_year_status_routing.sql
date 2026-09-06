begin;

-- Keep project workspaces predictable and configurable:
-- EKVPortal / Projekty / <year> / Aktivni|Hotovo / <code - name>.
-- Existing mappings keep the same Graph item id and are moved on the next
-- workspace synchronization or project status change.
update public.document_storage_connections
set config = jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{targets,project}',
      coalesce(config #> '{targets,project}', '{}'::jsonb) || jsonb_build_object(
        'projectFolderName', coalesce(nullif(config #>> '{targets,project,projectFolderName}', ''), 'Projekty'),
        'organizeProjectsByYear', coalesce((config #>> '{targets,project,organizeProjectsByYear}')::boolean, true),
        'activeFolderName', coalesce(nullif(config #>> '{targets,project,activeFolderName}', ''), 'Aktivni'),
        'completedFolderName', coalesce(nullif(config #>> '{targets,project,completedFolderName}', ''), 'Hotovo'),
        'completedStatuses', case
          when jsonb_typeof(config #> '{targets,project,completedStatuses}') = 'array'
               and jsonb_array_length(config #> '{targets,project,completedStatuses}') > 0
            then config #> '{targets,project,completedStatuses}'
          else jsonb_build_array('closed')
        end
      ),
      true
    ),
    updated_at = now()
where provider = 'sharepoint';

commit;
