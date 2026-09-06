-- Hybrid authorization: role defaults with audited per-member overrides.
begin;

-- Keep one canonical super-manager role before overrides are introduced.
insert into public.user_roles (role_name)
values ('super_manager')
on conflict (role_name) do nothing;

insert into public.role_permissions (role, module, can_read, can_edit, can_admin)
select
  'super_manager',
  module,
  bool_or(can_read),
  bool_or(can_edit),
  bool_or(can_admin)
from public.role_permissions
where role in ('super_manager', 'supermanager')
group by module
on conflict (role, module) do update set
  can_read = public.role_permissions.can_read or excluded.can_read,
  can_edit = public.role_permissions.can_edit or excluded.can_edit,
  can_admin = public.role_permissions.can_admin or excluded.can_admin;

update public.members set user_role = 'super_manager' where user_role = 'supermanager';
delete from public.role_permissions where role = 'supermanager';
delete from public.user_roles where role_name = 'supermanager';

-- Make the administrator template truthful in the role matrix.
insert into public.role_permissions (role, module, can_read, can_edit, can_admin)
values ('admin', 'service', true, true, true)
on conflict (role, module) do update set
  can_read = true,
  can_edit = true,
  can_admin = true;

create table if not exists public.member_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  module text not null,
  access_level text not null,
  expires_at timestamptz,
  created_by uuid references public.members(id) on delete set null,
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_permission_overrides_member_module_key unique (member_id, module),
  constraint member_permission_overrides_module_check check (
    module = any (array[
      'dashboard','projects','tasks','attendance','documents','crm','subjects',
      'engineering','members','payouts','finance','reports','settings','realizace','service'
    ])
  ),
  constraint member_permission_overrides_level_check check (access_level = any (array['none','read','edit','admin']))
);

create index if not exists member_permission_overrides_active_member_idx
  on public.member_permission_overrides (member_id, module)
  where expires_at is null;

alter table public.member_permission_overrides enable row level security;

create or replace function public.permission_level_rank(p_level text)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(coalesce(p_level, ''))
    when 'can_read' then 1 when 'read' then 1
    when 'can_edit' then 2 when 'edit' then 2
    when 'can_admin' then 3 when 'admin' then 3
    else 0
  end::smallint;
$$;

create or replace function public.has_permission(p_module text, p_level text default 'can_read')
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_role text;
  v_override text;
  v_required smallint := public.permission_level_rank(p_level);
  v_role_rank smallint := 0;
begin
  v_member_id := public.get_member_id();
  if v_member_id is null or v_required = 0 then return false; end if;

  select m.user_role into v_role from public.members m where m.id = v_member_id;
  if v_role = 'admin' then return true; end if;

  select o.access_level into v_override
  from public.member_permission_overrides o
  where o.member_id = v_member_id
    and o.module = p_module
    and (o.expires_at is null or o.expires_at > now());

  if v_override is not null then
    return public.permission_level_rank(v_override) >= v_required;
  end if;

  select case
    when rp.can_admin then 3
    when rp.can_edit then 2
    when rp.can_read then 1
    else 0
  end into v_role_rank
  from public.role_permissions rp
  where rp.role = v_role and rp.module = p_module;

  return coalesce(v_role_rank, 0) >= v_required;
end;
$$;

create or replace function public.get_permissions(p_role text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.get_member_id();
  v_role text := public.get_user_role();
  v_permissions json;
begin
  if v_member_id is null or v_role is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  with modules(module) as (
    select unnest(array[
      'dashboard','projects','tasks','attendance','documents','crm','subjects',
      'engineering','members','payouts','finance','reports','settings','realizace','service'
    ]::text[])
  ), effective as (
    select
      modules.module,
      case
        when v_role = 'admin' then 3
        when o.access_level is not null then public.permission_level_rank(o.access_level)
        when rp.can_admin then 3
        when rp.can_edit then 2
        when rp.can_read then 1
        else 0
      end as rank
    from modules
    left join public.role_permissions rp
      on rp.role = v_role and rp.module = modules.module
    left join public.member_permission_overrides o
      on o.member_id = v_member_id
      and o.module = modules.module
      and (o.expires_at is null or o.expires_at > now())
  )
  select json_object_agg(module, json_build_object(
    'can_read', rank >= 1,
    'can_edit', rank >= 2,
    'can_admin', rank >= 3
  )) into v_permissions
  from effective;

  return coalesce(v_permissions, '{}'::json);
end;
$$;

create or replace function public.get_member_permission_settings(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  if p_member_id <> public.get_member_id()
     and not public.has_permission('settings', 'can_admin') then
    raise exception 'Permission denied.' using errcode = '42501';
  end if;

  select m.user_role into v_role from public.members m where m.id = p_member_id;
  if v_role is null then raise exception 'Member not found.' using errcode = 'P0002'; end if;

  with modules(module, position) as (
    select * from unnest(array[
      'dashboard','projects','tasks','attendance','documents','crm','subjects',
      'engineering','members','payouts','finance','reports','settings','realizace','service'
    ]::text[]) with ordinality
  ), levels as (
    select
      modules.module,
      modules.position,
      case
        when v_role = 'admin' or rp.can_admin then 'admin'
        when rp.can_edit then 'edit'
        when rp.can_read then 'read'
        else 'none'
      end as role_level,
      case when o.expires_at is null or o.expires_at > now() then o.access_level end as override_level,
      o.expires_at
    from modules
    left join public.role_permissions rp on rp.role = v_role and rp.module = modules.module
    left join public.member_permission_overrides o on o.member_id = p_member_id and o.module = modules.module
  )
  select jsonb_build_object(
    'member_id', p_member_id,
    'role', v_role,
    'is_locked', v_role = 'admin',
    'permissions', jsonb_agg(jsonb_build_object(
      'module', module,
      'role_level', role_level,
      'override_level', override_level,
      'effective_level', coalesce(override_level, role_level),
      'expires_at', expires_at
    ) order by position)
  ) into v_result
  from levels;

  return v_result;
end;
$$;

create or replace function public.set_member_permission_overrides(p_member_id uuid, p_overrides jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_actor_member_id uuid := public.get_member_id();
  v_count integer;
begin
  if not public.has_permission('settings', 'can_admin') then
    raise exception 'Permission denied.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'Overrides must be an array.' using errcode = '22023';
  end if;

  select m.user_role into v_target_role from public.members m where m.id = p_member_id for update;
  if v_target_role is null then raise exception 'Member not found.' using errcode = 'P0002'; end if;
  if v_target_role = 'admin' then
    raise exception 'Administrator permissions are fixed.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item
    where coalesce(item->>'module', '') <> all (array[
      'dashboard','projects','tasks','attendance','documents','crm','subjects',
      'engineering','members','payouts','finance','reports','settings','realizace','service'
    ])
       or coalesce(item->>'access_level', '') <> all (array['none','read','edit','admin'])
  ) then
    raise exception 'Invalid permission override.' using errcode = '22023';
  end if;

  delete from public.member_permission_overrides where member_id = p_member_id;

  insert into public.member_permission_overrides (
    member_id, module, access_level, expires_at, created_by, updated_by
  )
  select
    p_member_id,
    item->>'module',
    item->>'access_level',
    nullif(item->>'expires_at', '')::timestamptz,
    v_actor_member_id,
    v_actor_member_id
  from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item;

  get diagnostics v_count = row_count;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(),
    nullif(auth.jwt() ->> 'email', ''),
    'admin_update_member_permissions',
    jsonb_build_object('member_id', p_member_id, 'role', v_target_role, 'overrides', p_overrides)
  );

  return jsonb_build_object('member_id', p_member_id, 'override_count', v_count);
end;
$$;

drop policy if exists "Member permission overrides read" on public.member_permission_overrides;
drop policy if exists "Member permission overrides manage" on public.member_permission_overrides;
create policy "Member permission overrides read"
on public.member_permission_overrides for select to authenticated
using (member_id = public.get_member_id() or public.has_permission('settings', 'can_admin'));
create policy "Member permission overrides manage"
on public.member_permission_overrides for all to authenticated
using (public.has_permission('settings', 'can_admin'))
with check (public.has_permission('settings', 'can_admin'));

-- Role templates can also be maintained by a delegated settings administrator.
drop policy if exists "Role permissions insert for admins" on public.role_permissions;
drop policy if exists "Role permissions update for admins" on public.role_permissions;
drop policy if exists "Role permissions delete for admins" on public.role_permissions;
create policy "Role permissions insert for admins" on public.role_permissions
for insert to authenticated with check (public.has_permission('settings', 'can_admin'));
create policy "Role permissions update for admins" on public.role_permissions
for update to authenticated using (public.has_permission('settings', 'can_admin'))
with check (public.has_permission('settings', 'can_admin'));
create policy "Role permissions delete for admins" on public.role_permissions
for delete to authenticated using (public.has_permission('settings', 'can_admin'));

-- The newest service module now uses the same effective permission source in RLS.
alter policy "Service cases read" on public.service_cases
  using (public.has_permission('service', 'can_read'));
alter policy "Service cases edit" on public.service_cases
  using (public.has_permission('service', 'can_edit'))
  with check (public.has_permission('service', 'can_edit'));
alter policy "Service visits read" on public.service_visits
  using (public.has_permission('service', 'can_read'));
alter policy "Service visits edit" on public.service_visits
  using (public.has_permission('service', 'can_edit'))
  with check (public.has_permission('service', 'can_edit'));
alter policy "Service attachments read" on public.service_attachments
  using (public.has_permission('service', 'can_read'));
alter policy "Service attachments edit" on public.service_attachments
  using (public.has_permission('service', 'can_edit'))
  with check (public.has_permission('service', 'can_edit'));
alter policy "Service documents read" on public.service_documents
  using (public.has_permission('service', 'can_read'));
alter policy "Service documents edit" on public.service_documents
  using (status not in ('signed', 'sent', 'viewed') and public.has_permission('service', 'can_edit'))
  with check (public.has_permission('service', 'can_edit'));
alter policy "Service events read" on public.service_events
  using (public.has_permission('service', 'can_read'));
alter policy "Service tickets read" on public.service_tickets
  using (public.has_permission('service', 'can_read'));
alter policy "Service tickets edit" on public.service_tickets
  using (public.has_permission('service', 'can_edit'))
  with check (public.has_permission('service', 'can_edit'));
alter policy "Service ticket attachments read" on public.service_ticket_attachments
  using (public.has_permission('service', 'can_read'));
alter policy "Service inbox state admin read" on public.service_inbox_state
  using (public.has_permission('service', 'can_admin'));
alter policy "Service photo read" on storage.objects
  using (
    bucket_id = 'service-photos'
    and public.has_permission('service', 'can_read')
    and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  );
alter policy "Service photo upload" on storage.objects
  with check (
    bucket_id = 'service-photos'
    and public.has_permission('service', 'can_edit')
    and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  );
alter policy "Service photo delete" on storage.objects
  using (
    bucket_id = 'service-photos'
    and public.has_permission('service', 'can_admin')
    and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  );
alter policy "Service document object read" on storage.objects
  using (
    bucket_id = 'service-documents'
    and public.has_permission('service', 'can_read')
    and exists (select 1 from public.service_cases c where c.id::text = (storage.foldername(name))[1])
  );

grant select on public.member_permission_overrides to authenticated;
grant all on public.member_permission_overrides to service_role;
revoke all on function public.get_member_permission_settings(uuid) from public, anon;
revoke all on function public.set_member_permission_overrides(uuid, jsonb) from public, anon;
grant execute on function public.has_permission(text, text) to authenticated, service_role;
grant execute on function public.get_member_permission_settings(uuid) to authenticated, service_role;
grant execute on function public.set_member_permission_overrides(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'member_permission_overrides'
     ) then
    alter publication supabase_realtime add table public.member_permission_overrides;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
