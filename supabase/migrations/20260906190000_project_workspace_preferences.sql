begin;

create table if not exists public.project_workspace_preferences (
  project_id uuid primary key references public.projects(id) on delete cascade,
  create_folder boolean not null default true,
  folder_name text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_workspace_preferences_folder_name_length
    check (folder_name is null or char_length(folder_name) between 1 and 90),
  constraint project_workspace_preferences_folder_name_controls
    check (folder_name is null or folder_name !~ '[[:cntrl:]]')
);

comment on table public.project_workspace_preferences is
  'Per-project choice whether to provision a managed document workspace and its editable descriptive folder name.';
comment on column public.project_workspace_preferences.folder_name is
  'Editable descriptive part of the folder name. The project code is always added as a stable prefix.';

alter table public.project_workspace_preferences enable row level security;
revoke all on public.project_workspace_preferences from public, anon, authenticated;
grant select on public.project_workspace_preferences to authenticated;
grant all on public.project_workspace_preferences to service_role;

drop policy if exists "Project users can read workspace preferences" on public.project_workspace_preferences;
create policy "Project users can read workspace preferences"
on public.project_workspace_preferences
for select
to authenticated
using (public.can_access_project(project_id));

create or replace function public.save_project_workspace_preference(
  p_project_id uuid,
  p_create_folder boolean,
  p_folder_name text default null
)
returns public.project_workspace_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_folder_name, '')), '');
  v_row public.project_workspace_preferences%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_project_id is null
     or not public.can_edit_module('projects')
     or not public.can_access_project(p_project_id) then
    raise exception 'Not allowed to configure this project workspace' using errcode = '42501';
  end if;
  if v_name is not null and char_length(v_name) > 90 then
    raise exception 'Folder name can contain at most 90 characters' using errcode = '22001';
  end if;
  if v_name is not null and v_name ~ '[[:cntrl:]]' then
    raise exception 'Folder name contains unsupported characters' using errcode = '22023';
  end if;

  insert into public.project_workspace_preferences (
    project_id, create_folder, folder_name, created_by, updated_at
  ) values (
    p_project_id, coalesce(p_create_folder, true), v_name, auth.uid(), now()
  )
  on conflict (project_id) do update
  set create_folder = excluded.create_folder,
      folder_name = excluded.folder_name,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_project_workspace_preference(uuid, boolean, text) from public, anon;
grant execute on function public.save_project_workspace_preference(uuid, boolean, text) to authenticated, service_role;

commit;
