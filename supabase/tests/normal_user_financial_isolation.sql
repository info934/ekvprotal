-- Safe to execute against a migrated environment: all fixtures and changes roll back.
-- Verifies that a normal employee cannot read another employee's compensation,
-- attendance, payouts, bonuses, reward allocation, or project financial inputs.
begin;

do $$
declare
  v_admin_auth uuid := gen_random_uuid();
  v_owner_auth uuid := gen_random_uuid();
  v_other_auth uuid := gen_random_uuid();
  v_admin uuid;
  v_owner uuid;
  v_other uuid;
  v_project uuid := gen_random_uuid();
  v_attendance uuid := gen_random_uuid();
  v_submission uuid := gen_random_uuid();
  v_payout uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values
    (v_admin_auth, v_admin_auth || '@example.invalid'),
    (v_owner_auth, v_owner_auth || '@example.invalid'),
    (v_other_auth, v_other_auth || '@example.invalid');

  insert into public.members(auth_user_id, name, email, user_role, hourly_rate, internal_note) values
    (v_admin_auth, 'Privacy test admin', v_admin_auth || '@example.invalid', 'admin', 900, 'Admin note'),
    (v_owner_auth, 'Privacy test owner', v_owner_auth || '@example.invalid', 'user', 777, 'Private owner note'),
    (v_other_auth, 'Privacy test other', v_other_auth || '@example.invalid', 'user', 410, 'Private other note')
  on conflict(auth_user_id) do update
  set user_role = excluded.user_role,
      hourly_rate = excluded.hourly_rate,
      internal_note = excluded.internal_note;

  select id into v_admin from public.members where auth_user_id = v_admin_auth;
  select id into v_owner from public.members where auth_user_id = v_owner_auth;
  select id into v_other from public.members where auth_user_id = v_other_auth;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);
  insert into public.role_permissions(role, module, can_read, can_edit, can_admin) values
    ('user', 'projects', true, false, false),
    ('user', 'members', true, false, false),
    ('user', 'attendance', true, true, false),
    ('user', 'payouts', true, true, false),
    ('user', 'finance', false, false, false)
  on conflict(role, module) do update
  set can_read = excluded.can_read,
      can_edit = excluded.can_edit,
      can_admin = excluded.can_admin;

  insert into public.projects(id, name, code, status, price, budget_percentage, overhead_percentage, created_by_member_id)
  values(v_project, 'Shared privacy test project', 'PRIV-' || left(v_project::text, 8), 'V řešení', 100000, 80, 10, v_admin);

  perform public.save_project_member_safe(v_project, null, jsonb_build_object(
    'member_id', v_owner, 'reward_type', 'percentage', 'reward_percentage', 20
  ));
  perform public.save_project_member_safe(v_project, null, jsonb_build_object(
    'member_id', v_other, 'reward_type', 'percentage', 'reward_percentage', 10
  ));

  insert into public.member_hourly_rate_history(member_id, hourly_rate, currency, valid_from)
  values(v_owner, 777, 'CZK', date '2026-09-01')
  on conflict(member_id, valid_from) do update set hourly_rate = excluded.hourly_rate;

  insert into public.attendance(id, member_id, project_id, date, hours, description)
  values(v_attendance, v_owner, v_project, date '2026-09-02', 8, 'Private attendance fixture');
  insert into public.attendance_submissions(id, member_id, month_date, status, total_hours)
  values(v_submission, v_owner, date '2026-09-01', 'draft', 8);
  insert into public.attendance_plans(id, member_id, date, start_minute, end_minute, break_minutes, kind, note, created_by)
  values(gen_random_uuid(), v_owner, date '2026-09-03', 480, 960, 30, 'work', 'Private plan fixture', v_admin_auth);

  insert into public.payouts(id, member_id, amount, status, request_date, reason)
  values(v_payout, v_owner, 2500, 'pending', current_date, 'Private payout fixture');
  insert into public.payout_items(payout_id, project_id, amount)
  values(v_payout, v_project, 2500);
  insert into public.hourly_payout_requests(
    member_id, project_id, hours, hourly_rate, total_amount, status,
    payout_month, payout_year, total_hours, snapshot_total_hours, snapshot_total_amount,
    attendance_snapshot
  ) values(
    v_owner, v_project, 8, 777, 6216, 'pending', 9, 2026, 8, 8, 6216,
    jsonb_build_array(jsonb_build_object('attendance_id', v_attendance, 'hours', 8, 'hourly_rate', 777, 'pay_amount', 6216))
  );
  insert into public.labor_cost_ledger(
    attendance_id, attendance_submission_id, member_id, project_id,
    work_date, posting_month, hours, hourly_rate, pay_amount, employer_cost,
    funding_mode, sponsor_percent, sponsor_reward_deduction, project_cost_impact, status, created_by
  ) values(
    v_attendance, v_submission, v_owner, v_project,
    date '2026-09-02', date '2026-09-01', 8, 777, 6216, 6216,
    'direct_project', 0, 0, 6216, 'accrued', v_admin_auth
  );
  perform public.award_project_bonus(gen_random_uuid(), v_project, v_owner, 1000, 'Private bonus fixture');

  insert into public.member_permission_overrides(member_id, module, access_level, created_by)
  values(v_other, 'payouts', 'none', v_admin);

  perform set_config('test.privacy_other_auth', v_other_auth::text, true);
  perform set_config('test.privacy_owner', v_owner::text, true);
  perform set_config('test.privacy_other', v_other::text, true);
  perform set_config('test.privacy_project', v_project::text, true);
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('test.privacy_other_auth'), 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_owner uuid := current_setting('test.privacy_owner')::uuid;
  v_project uuid := current_setting('test.privacy_project')::uuid;
  v_denied boolean;
  v_project_safe jsonb;
begin
  if public.can_read_module('payouts')
     or public.can_edit_module('payouts')
     or public.can_admin_module('payouts') then
    raise exception 'Per-user payout denial is ignored by legacy permission helpers';
  end if;

  -- Both employees share a project and are exposed only through the safe team model.
  if (select count(*) from public.list_project_members_safe(v_project)) <> 2 then
    raise exception 'Shared-project team fixture is incomplete';
  end if;

  -- Sensitive columns must remain inaccessible even when the directory row is visible.
  if has_column_privilege('authenticated', 'public.members', 'hourly_rate', 'select') then
    raise exception 'Authenticated role can select members.hourly_rate';
  end if;
  if has_column_privilege('authenticated', 'public.projects', 'price', 'select')
     or has_column_privilege('authenticated', 'public.projects', 'budget_percentage', 'select')
     or has_column_privilege('authenticated', 'public.projects', 'overhead_percentage', 'select') then
    raise exception 'Authenticated role can directly select project financial columns';
  end if;
  if has_column_privilege('authenticated', 'public.realizations', 'contract_amount', 'select')
     or has_column_privilege('authenticated', 'public.realizations', 'profit_margin_percent', 'select')
     or has_column_privilege('authenticated', 'public.realizations', 'overhead_percent', 'select') then
    raise exception 'Authenticated role can directly select realization financial columns';
  end if;

  -- RLS isolation for another employee's operational and financial records.
  if exists(select 1 from public.member_compensation_private where member_id = v_owner)
     or exists(select 1 from public.member_hourly_rate_history where member_id = v_owner)
     or exists(select 1 from public.attendance where member_id = v_owner)
     or exists(select 1 from public.attendance_submissions where member_id = v_owner)
     or exists(select 1 from public.attendance_plans where member_id = v_owner)
     or exists(select 1 from public.payouts where member_id = v_owner)
     or exists(select 1 from public.hourly_payout_requests where member_id = v_owner)
     or exists(select 1 from public.labor_cost_ledger where member_id = v_owner)
     or exists(select 1 from public.project_bonuses where member_id = v_owner)
     or exists(select 1 from public.project_members where member_id = v_owner) then
    raise exception 'Normal user can read another employee private or financial row';
  end if;
  if exists(
    select 1 from public.payout_items i
    join public.payouts p on p.id = i.payout_id
    where p.member_id = v_owner
  ) then
    raise exception 'Normal user can read another employee payout items';
  end if;

  -- Safe project/team read models may show names, but no colleague reward or project budget.
  if exists(
    select 1 from public.list_project_members_safe(v_project) m
    where m.member_id = v_owner
      and (m.reward_percentage is not null or m.reward_amount is not null or m.reward_type is not null)
  ) then
    raise exception 'Safe team model leaked another employee reward allocation';
  end if;
  v_project_safe := public.get_project_safe(v_project);
  if v_project_safe -> 'price' <> 'null'::jsonb
     or v_project_safe -> 'budget_percentage' <> 'null'::jsonb
     or v_project_safe -> 'overhead_percentage' <> 'null'::jsonb then
    raise exception 'Safe project model leaked project financial inputs';
  end if;

  -- SECURITY DEFINER functions must reject a forged target member id.
  v_denied := false;
  begin perform public.get_member_compensation(v_owner); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Foreign compensation RPC was allowed'; end if;

  v_denied := false;
  begin perform 1 from public.get_member_project_rewards(v_owner); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Foreign project reward RPC was allowed'; end if;

  v_denied := false;
  begin perform 1 from public.get_member_realization_rewards(v_owner, null); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Foreign realization reward RPC was allowed'; end if;

  v_denied := false;
  begin perform public.get_payout_availability(v_owner, null); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Foreign payout availability RPC was allowed'; end if;

  v_denied := false;
  begin perform 1 from public.get_hourly_payout_discrepancies(); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Normal user could inspect company payout discrepancies'; end if;

  v_denied := false;
  begin perform public.project_financial_summary(v_project); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Normal user could read project financial summary'; end if;

  v_denied := false;
  begin perform public.project_labor_financial_summary(v_project); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'Normal user could read project labor financial summary'; end if;

  if coalesce(has_function_privilege('authenticated', 'public.project_financial_summary_admin_internal(uuid)', 'execute'), false)
     or coalesce(has_function_privilege('authenticated', 'public.project_labor_financial_summary_admin_internal(uuid)', 'execute'), false)
     or coalesce(has_function_privilege('authenticated', 'public.realization_financial_summary_admin_internal(uuid)', 'execute'), false)
     or coalesce(has_function_privilege('authenticated', 'public.realization_labor_financial_summary_admin_internal(uuid)', 'execute'), false) then
    raise exception 'Authenticated role can execute a private financial implementation';
  end if;
end;
$$;

rollback;
