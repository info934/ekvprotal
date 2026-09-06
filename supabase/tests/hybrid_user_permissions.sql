begin;

do $$
declare
  v_admin_auth uuid := 'a1000000-0000-4000-8000-000000000001';
  v_user_auth uuid := 'a1000000-0000-4000-8000-000000000002';
  v_admin_member uuid;
  v_user_member uuid;
  v_permissions json;
  v_denied boolean := false;
begin
  insert into auth.users (id, email)
  values
    (v_admin_auth, 'hybrid-admin@example.invalid'),
    (v_user_auth, 'hybrid-user@example.invalid')
  on conflict (id) do nothing;

  insert into public.members (auth_user_id, name, email, user_role)
  values
    (v_admin_auth, 'Hybrid admin', 'hybrid-admin@example.invalid', 'admin'),
    (v_user_auth, 'Hybrid user', 'hybrid-user@example.invalid', 'user')
  on conflict (auth_user_id) do update set user_role = excluded.user_role;

  select id into v_admin_member from public.members where auth_user_id = v_admin_auth;
  select id into v_user_member from public.members where auth_user_id = v_user_auth;

  insert into public.role_permissions (role, module, can_read, can_edit, can_admin)
  values ('user', 'projects', true, false, false)
  on conflict (role, module) do update set can_read = true, can_edit = false, can_admin = false;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_auth,
    'email', 'hybrid-user@example.invalid',
    'role', 'authenticated'
  )::text, true);

  v_permissions := public.get_permissions('admin');
  if coalesce((v_permissions -> 'projects' ->> 'can_read')::boolean, false) is not true
     or coalesce((v_permissions -> 'projects' ->> 'can_edit')::boolean, false) is not false then
    raise exception 'get_permissions trusted its p_role argument or lost the role baseline';
  end if;

  insert into public.member_permission_overrides (member_id, module, access_level)
  values (v_user_member, 'projects', 'edit')
  on conflict (member_id, module) do update set access_level = excluded.access_level, expires_at = null;

  if public.has_permission('projects', 'can_edit') is not true
     or public.has_permission('projects', 'can_admin') is not false then
    raise exception 'Edit override hierarchy is incorrect';
  end if;

  update public.member_permission_overrides
  set access_level = 'none'
  where member_id = v_user_member and module = 'projects';
  if public.has_permission('projects', 'can_read') is not false then
    raise exception 'Explicit deny did not override the role';
  end if;

  begin
    perform public.set_member_permission_overrides(v_user_member, '[{"module":"projects","access_level":"admin"}]'::jsonb);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then raise exception 'Non-admin changed permission overrides'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_auth,
    'email', 'hybrid-admin@example.invalid',
    'role', 'authenticated'
  )::text, true);
  perform public.set_member_permission_overrides(
    v_user_member,
    '[{"module":"projects","access_level":"admin"},{"module":"finance","access_level":"read"}]'::jsonb
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_auth,
    'email', 'hybrid-user@example.invalid',
    'role', 'authenticated'
  )::text, true);
  if public.has_permission('projects', 'can_admin') is not true
     or public.has_permission('finance', 'can_read') is not true
     or public.has_permission('finance', 'can_edit') is not false then
    raise exception 'Administrator override set was not applied';
  end if;
end;
$$;

rollback;
