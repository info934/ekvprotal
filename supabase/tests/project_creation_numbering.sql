-- Disposable local/test DB only, after 20261014090000. Never run on production:
-- this regression intentionally makes the reward view unpopulated temporarily.
-- All fixtures, counters and the view state are rolled back.
begin;
refresh materialized view public.mv_user_project_rewards with no data;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_prefix text := 'QA' || left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_type text := 'Numbering regression ' || v_prefix;
  v_other_type text := 'Shared prefix ' || v_prefix;
  v_first jsonb;
  v_second jsonb;
  v_op jsonb;
  v_expected text;
  v_next text;
  v_failed boolean;
  v_year integer := extract(year from current_date);
begin
  v_prefix := upper(v_prefix);
  insert into auth.users(id, email) values(v_user, v_user::text || '@numbering-test.invalid');
  insert into public.members(name, auth_user_id, user_role) values('Numbering regression', v_user, 'admin')
    on conflict(auth_user_id) do update set user_role = 'admin';
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform public.save_project_type(v_type, v_prefix);
  perform public.save_project_type(v_other_type, v_prefix);
  v_expected := v_prefix || '-' || to_char(current_date, 'YY') || '-001';
  if public.preview_project_code(v_type) <> v_expected or public.preview_project_code(v_type) <> v_expected then
    raise exception 'Preview consumed a project number';
  end if;
  v_first := public.save_project_safe(null, jsonb_build_object('name', 'Minimal project', 'type', v_type), null);
  if v_first->>'code' <> v_expected or v_first->>'investor_id' is not null then raise exception 'Minimal project creation failed'; end if;
  if not (select relispopulated from pg_class where oid = 'public.mv_user_project_rewards'::regclass) then
    raise exception 'First project insert did not populate rewards';
  end if;
  v_second := public.save_project_safe(null, jsonb_build_object('name', 'Second open form', 'type', v_other_type), null);
  if v_second->>'code' <> replace(v_expected, '-001', '-002') then raise exception 'Shared prefix generated a duplicate'; end if;
  perform public.save_project_safe(null, jsonb_build_object('name', 'Manual project', 'code', replace(v_expected, '-001', '-999'), 'type', v_type), null);
  v_next := public.preview_project_code(v_type);
  if v_next <> replace(v_expected, '-001', '-1000') then raise exception 'Manual project or sequence width not respected'; end if;
  v_second := public.save_project_safe(null, jsonb_build_object('name', 'After manual', 'type', v_type), null);
  if v_second->>'code' <> v_next then raise exception 'Actual number differs from current sequence'; end if;
  v_failed := false;
  begin
    perform public.save_project_safe(null, jsonb_build_object('name', 'Duplicate', 'code', v_first->>'code'), null);
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'Duplicate manual code accepted'; end if;
  v_second := public.save_project_safe((v_first->>'id')::uuid, jsonb_build_object('name', 'Edited', 'type', v_other_type), null);
  if v_second->>'code' <> v_first->>'code' then raise exception 'Edit renumbered existing project'; end if;
  insert into public.job_number_sequences(kind, prefix, year, last_number) values('project', v_prefix, v_year - 1, 5000);
  if public.preview_project_code(v_type) <> replace(v_expected, '-001', '-1001') then raise exception 'Previous year affected current series'; end if;
  if public.next_job_sequence(v_prefix, v_year + 1, 'project') <> 1 then raise exception 'New year did not start a fresh sequence'; end if;

  v_expected := public.preview_crm_opportunity_number(v_type);
  v_op := public.create_crm_opportunity_simple(jsonb_build_object('title', 'Minimal OP', 'project_type', v_type));
  if v_op->>'number' <> v_expected or v_op->>'subject_id' is not null or v_op->>'project_type' <> v_type then
    raise exception 'Minimal typed opportunity failed';
  end if;
  v_next := public.preview_crm_opportunity_number(v_type);
  v_failed := false;
  begin
    perform public.create_crm_opportunity_simple(jsonb_build_object('title', 'Failed OP', 'project_type', v_type, 'probability', 101));
  exception when check_violation then v_failed := true;
  end;
  if not v_failed or public.preview_crm_opportunity_number(v_type) <> v_next then raise exception 'Failed OP consumed a number'; end if;
  v_op := public.create_crm_opportunity_simple(jsonb_build_object('title', 'Second OP', 'project_type', v_other_type));
  if v_op->>'number' <> v_next then raise exception 'OP shared prefix not respected'; end if;

  insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
    values('opportunity', 'QAOP', 999, 3, 'YY') on conflict(document_type)
    do update set prefix = 'QAOP', next_number = 999, padding = 3, year_format = 'YY';
  insert into public.crm_opportunities(title, number) values('Imported OP', 'QAOP-' || to_char(current_date, 'YY') || '-999');
  v_expected := 'QAOP-' || to_char(current_date, 'YY') || '-1000';
  if public.preview_crm_opportunity_number(null) <> v_expected then raise exception 'Legacy preview did not skip imported number'; end if;
  v_op := public.create_crm_opportunity_simple(jsonb_build_object('title', 'Untyped minimal OP'));
  if v_op->>'number' <> v_expected then raise exception 'Legacy series truncated sequence or ignored settings'; end if;
  if (select next_number from public.crm_numbering_settings where document_type = 'opportunity') <> 1001 then raise exception 'Legacy series not advanced atomically'; end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  v_failed := false;
  begin
    perform public.save_project_type('Unauthorized', 'NO');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Anonymous type creation accepted'; end if;
  v_failed := false;
  begin
    perform public.create_crm_opportunity_simple(jsonb_build_object('title', 'Unauthorized'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'Anonymous OP creation accepted'; end if;
end;
$$;
rollback;
