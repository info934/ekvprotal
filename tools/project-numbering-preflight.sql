-- Read-only preflight; run as the migration administrator on the verified DB.
begin transaction read only;
select current_database() as database, current_user as connected_as,
       inet_server_addr() as server_address, inet_server_port() as server_port;

do $$
declare
  v_object text;
  v_column record;
begin
  foreach v_object in array array[
    'public.projects', 'public.project_types', 'public.crm_opportunities',
    'public.crm_numbering_settings', 'public.members', 'auth.users',
    'public.mv_user_project_rewards'
  ] loop
    if to_regclass(v_object) is null then
      raise exception 'Missing prerequisite relation: %', v_object;
    end if;
  end loop;
  foreach v_object in array array[
    'auth.uid()', 'public.refresh_user_rewards()',
    'public.save_project_safe(uuid,jsonb,text)', 'public.can_edit_module(text)',
    'public.can_edit_crm()', 'public.get_member_id()'
  ] loop
    if to_regprocedure(v_object) is null then
      raise exception 'Missing prerequisite function: %', v_object;
    end if;
  end loop;
  foreach v_object in array array['anon', 'authenticated'] loop
    if not exists(select 1 from pg_roles where rolname = v_object) then
      raise exception 'Missing Supabase role: %', v_object;
    end if;
  end loop;
  for v_column in
    select * from (values
      ('projects', 'id'), ('projects', 'code'), ('projects', 'type'),
      ('project_types', 'id'), ('project_types', 'name'),
      ('crm_numbering_settings', 'document_type'), ('crm_numbering_settings', 'prefix'),
      ('crm_numbering_settings', 'next_number'), ('crm_numbering_settings', 'padding'),
      ('crm_numbering_settings', 'year_format'), ('crm_numbering_settings', 'updated_at'),
      ('crm_opportunities', 'number'), ('crm_opportunities', 'title'),
      ('crm_opportunities', 'subject_id'), ('crm_opportunities', 'project_id'),
      ('crm_opportunities', 'owner_member_id'), ('crm_opportunities', 'stage'),
      ('crm_opportunities', 'status'), ('crm_opportunities', 'priority'),
      ('crm_opportunities', 'value'), ('crm_opportunities', 'probability'),
      ('crm_opportunities', 'expected_close_date'), ('crm_opportunities', 'next_step'),
      ('crm_opportunities', 'description'), ('crm_opportunities', 'lost_reason'),
      ('crm_opportunities', 'lost_at'), ('crm_opportunities', 'template_id'),
      ('crm_opportunities', 'business_type'), ('crm_opportunities', 'category'),
      ('crm_opportunities', 'custom_fields')
    ) required_columns(table_name, column_name)
  loop
    if not exists(select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_column.table_name
        and c.column_name = v_column.column_name) then
      raise exception 'Missing prerequisite column: %.%', v_column.table_name, v_column.column_name;
    end if;
  end loop;
  if not exists(select 1 from pg_index
    where indrelid = 'public.mv_user_project_rewards'::regclass
      and indisunique and indisvalid and indpred is null and indexprs is null) then
    raise exception 'Reward materialized view lacks a valid full unique index for concurrent refresh';
  end if;
end;
$$;

select relispopulated as rewards_populated
from pg_class where oid = 'public.mv_user_project_rewards'::regclass;
select to_regclass('supabase_migrations.schema_migrations') as migration_history;
select 'Prerequisite checks passed; separately verify backup and migration history.' as result;
rollback;
