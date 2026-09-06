begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_row public.project_workspace_preferences;
begin
  insert into auth.users(id, email) values
    (v_admin, v_admin || '@example.invalid'),
    (v_user, v_user || '@example.invalid');
  insert into public.members(auth_user_id, name, email, user_role) values
    (v_admin, 'Workspace admin', v_admin || '@example.invalid', 'admin'),
    (v_user, 'Workspace user', v_user || '@example.invalid', 'user')
  on conflict (auth_user_id) do update
  set name = excluded.name, email = excluded.email, user_role = excluded.user_role;
  insert into public.role_permissions(role, module, can_read, can_edit, can_admin)
  values ('user', 'projects', false, false, false)
  on conflict (role, module) do update
  set can_read = false, can_edit = false, can_admin = false;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into public.projects(id, name, code, status, price, budget_percentage, overhead_percentage)
  values (v_project, 'Workspace fixture', 'OP-26-900', 'active', 10000, 100, 0);

  v_row := public.save_project_workspace_preference(v_project, false, 'FVE hala A');
  if v_row.create_folder is not false or v_row.folder_name <> 'FVE hala A' then
    raise exception 'Workspace preference was not saved';
  end if;
  v_row := public.save_project_workspace_preference(v_project, true, '  Novy nazev  ');
  if v_row.create_folder is not true or v_row.folder_name <> 'Novy nazev' then
    raise exception 'Workspace preference update was not normalized';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.save_project_workspace_preference(v_project, false, null);
    raise exception 'Unprivileged preference write accepted' using errcode = '23514';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
