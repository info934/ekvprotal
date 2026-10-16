-- Read-only structural check. Authenticated UI smoke tests are still required.
begin transaction read only;
do $$
declare
  v_function text;
  v_role text;
begin
  if not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_types'
      and column_name = 'code_prefix' and is_nullable = 'NO') then
    raise exception 'project_types.code_prefix is missing or nullable';
  end if;
  if not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_opportunities'
      and column_name = 'project_type') then
    raise exception 'crm_opportunities.project_type is missing';
  end if;
  if not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_opportunities'
      and column_name = 'subject_id' and is_nullable = 'YES') then
    raise exception 'CRM client is still required by the database';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.projects'::regclass
    and tgname = 'assign_project_code' and not tgisinternal and tgenabled in ('O', 'A')
    and tgfoid = 'public.assign_project_code()'::regprocedure) then
    raise exception 'Project numbering trigger is missing or disabled';
  end if;
  if not exists(select 1 from pg_class
    where oid = 'public.job_number_sequences'::regclass and relrowsecurity) then
    raise exception 'Numbering counters lack row-level security';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.job_number_sequences', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Role % has direct access to numbering counters', v_role;
    end if;
    foreach v_function in array array[
      'public.project_code_prefix(text)', 'public.next_job_sequence(text,integer,text)',
      'public.assign_project_code()'
    ] loop
      if has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'Role % can execute internal helper %', v_role, v_function;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'public.save_project_type(text,text,uuid)', 'public.preview_project_code(text)',
    'public.preview_crm_opportunity_number(text)', 'public.create_crm_opportunity_simple(jsonb)'
  ] loop
    if not has_function_privilege('authenticated', v_function, 'EXECUTE')
      or has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'Unexpected RPC permissions: %', v_function;
    end if;
    if not exists(select 1 from pg_proc where oid = v_function::regprocedure
      and prosecdef and 'search_path=public' = any(proconfig)) then
      raise exception 'RPC lacks pinned security-definer configuration: %', v_function;
    end if;
  end loop;
  if position('relispopulated' in pg_get_functiondef('public.refresh_user_rewards()'::regprocedure)) = 0 then
    raise exception 'Reward refresh does not check population state';
  end if;
end;
$$;
select 'Structural checks passed. Reload PostgREST, record this migration and test the authenticated UI.' as result;
rollback;
