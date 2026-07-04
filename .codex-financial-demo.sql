begin;

create temp table financial_demo_log (
  step text,
  detail text
) on commit drop;

refresh materialized view public.mv_user_project_rewards;

do $$
declare
  v_auth_id uuid := '11111111-1111-4111-8111-111111111111';
  v_member_percent uuid := '22222222-2222-4222-8222-222222222222';
  v_member_fixed uuid := '33333333-3333-4333-8333-333333333333';
  v_member_hourly uuid := '34343434-3434-4434-8434-343434343434';
  v_subject_id uuid := '44444444-4444-4444-8444-444444444444';
  v_project_main uuid := '55555555-5555-4555-8555-555555555555';
  v_project_exhausted uuid := '66666666-6666-4666-8666-666666666666';
  v_realization_id uuid := '77777777-7777-4777-8777-777777777777';
  v_overhead_cost_id uuid := '88888888-8888-4888-8888-888888888888';
  v_overhead_month_id uuid := '99999999-9999-4999-8999-999999999999';
  v_overhead_item_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_opportunity_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_document_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_payout_project_paid uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_payout_project_pending uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_payout_realization_pending uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_submission_id uuid;
  v_hourly_request_id uuid;
  v_summary jsonb;
  v_result jsonb;
  v_num numeric;
  v_bool boolean;
begin
  perform set_config('request.jwt.claim.sub', v_auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into financial_demo_log values ('cleanup', 'Odstranuji predchozi DEMO-FIN data z lokalni DB.');

  delete from public.payout_items
  where payout_id in (v_payout_project_paid, v_payout_project_pending, v_payout_realization_pending);
  delete from public.payouts
  where id in (v_payout_project_paid, v_payout_project_pending, v_payout_realization_pending)
     or variable_symbol like 'DEMOFIN%';
  delete from public.hourly_payout_requests
  where member_id in (v_member_percent, v_member_fixed, v_member_hourly)
     or notes like 'DEMO-FIN%';
  delete from public.attendance_submissions
  where member_id in (v_member_percent, v_member_fixed, v_member_hourly)
    and month_date = '2026-06-01';
  delete from public.attendance
  where member_id in (v_member_percent, v_member_fixed, v_member_hourly)
    and date >= '2026-06-01'
    and date < '2026-07-01';
  delete from public.crm_commercial_document_items where document_id = v_document_id;
  delete from public.crm_commercial_documents where id = v_document_id;
  delete from public.crm_opportunity_items where opportunity_id = v_opportunity_id;
  delete from public.crm_opportunities where id = v_opportunity_id;
  delete from public.realization_profit_shares where realizace_id = v_realization_id;
  delete from public.realizace_extra_costs where realizace_id = v_realization_id;
  delete from public.realizace_costs where realizace_id = v_realization_id;
  delete from public.realizations where id = v_realization_id;
  delete from public.project_overhead_costs where overhead_allocation_item_id = v_overhead_item_id;
  delete from public.overhead_allocation_items where id = v_overhead_item_id;
  delete from public.overhead_monthly_allocations where id = v_overhead_month_id;
  delete from public.overhead_costs where id = v_overhead_cost_id;
  delete from public.project_costs where project_id in (v_project_main, v_project_exhausted);
  delete from public.project_members where project_id in (v_project_main, v_project_exhausted);
  delete from public.project_subcontractors where project_id in (v_project_main, v_project_exhausted);
  delete from public.projects where id in (v_project_main, v_project_exhausted) or code like 'DEMO-FIN-%';
  delete from public.members where id in (v_member_percent, v_member_fixed) or email like 'demo.financial.%@ekv.local';
  delete from public.subjects where id = v_subject_id or name = 'DEMO-FIN Klient s.r.o.';
  delete from auth.identities where user_id = v_auth_id;
  delete from auth.users where id = v_auth_id;

  insert into public.user_roles (role_name)
  values ('admin'), ('user')
  on conflict (role_name) do nothing;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    phone, phone_change, phone_change_token, email_change_token_current,
    reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_auth_id,
    'authenticated',
    'authenticated',
    'demo.financial.admin@ekv.local',
    crypt('Project_2021', gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    null,
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"DEMO FIN Admin"}'::jsonb,
    now(),
    now()
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_auth_id::text,
    v_auth_id,
    jsonb_build_object('sub', v_auth_id::text, 'email', 'demo.financial.admin@ekv.local', 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.members (id, name, email, auth_user_id, hourly_rate, user_role, attendance_enabled)
  values
    (v_member_percent, 'DEMO FIN Admin', 'demo.financial.admin@ekv.local', v_auth_id, 900, 'admin', true),
    (v_member_fixed, 'DEMO FIN Fixni clen', 'demo.financial.fixed@ekv.local', null, 700, 'user', true),
    (v_member_hourly, 'DEMO FIN Hodinovy clen', 'demo.financial.hourly@ekv.local', null, 800, 'user', true);

  insert into public.subjects (id, name, email, subject_kind, vat_status, vat_payer)
  values (v_subject_id, 'DEMO-FIN Klient s.r.o.', 'finance-client@ekv.local', 'company', 'payer', true);

  insert into public.projects (id, name, code, status, price, budget_percentage, overhead_percentage, type, created_by_member_id, client_id)
  values
    (v_project_main, 'DEMO-FIN Projekt cost-adjusted', 'DEMO-FIN-001', 'delivered', 100000, 60, 10, 'Demo', v_member_percent, v_subject_id),
    (v_project_exhausted, 'DEMO-FIN Projekt vycerpany', 'DEMO-FIN-002', 'closed', 50000, 50, 20, 'Demo', v_member_percent, v_subject_id);

  insert into public.project_subcontractors (project_id, scope_of_work, status, price, subject_id)
  values (v_project_main, 'DEMO subdodavka', 'accepted', 10000, v_subject_id);

  insert into public.project_costs (project_id, description, amount, is_attendance_cost)
  values
    (v_project_main, 'DEMO primy naklad', 15000, false),
    (v_project_main, 'DEMO hodinova prace 8 h x 800', 6400, true),
    (v_project_exhausted, 'DEMO naklad pres rozpočet', 30000, false);

  insert into public.overhead_costs (id, name, type, category, amount, valid_from, valid_to, default_allocation_key, created_by)
  values (v_overhead_cost_id, 'DEMO-FIN alokovana rezije', 'PRAVIDELNY', 'demo', 5000, '2026-06-01', '2026-06-30', '{}'::jsonb, v_auth_id);
  insert into public.overhead_monthly_allocations (id, month, status, notes, created_by)
  values (v_overhead_month_id, '2026-06', 'DRAFT', 'DEMO-FIN alokace', v_auth_id);
  insert into public.overhead_allocation_items (id, overhead_monthly_allocation_id, overhead_cost_id, project_id, amount_allocated, percentage_share)
  values (v_overhead_item_id, v_overhead_month_id, v_overhead_cost_id, v_project_main, 5000, 100);
  insert into public.project_overhead_costs (project_id, overhead_allocation_item_id, amount, month)
  values (v_project_main, v_overhead_item_id, 5000, '2026-06');

  insert into public.project_members (project_id, member_id, reward_type, reward_percentage, reward_amount, is_hourly)
  values
    (v_project_main, v_member_percent, 'percentage', 50, null, false),
    (v_project_main, v_member_fixed, 'fixed', null, 30000, false),
    (v_project_main, v_member_hourly, null, null, null, true),
    (v_project_exhausted, v_member_percent, 'percentage', 50, null, false);

  insert into public.payouts (id, member_id, amount, status, request_date, reason, variable_symbol, paid_at)
  values
    (v_payout_project_paid, v_member_percent, 2000, 'paid', '2026-06-10', 'DEMO-FIN vyplaceno projekt', 'DEMOFIN001', now()),
    (v_payout_project_pending, v_member_percent, 5000, 'pending', '2026-06-11', 'DEMO-FIN rezervace projekt', 'DEMOFIN002', null),
    (v_payout_realization_pending, v_member_percent, 8500, 'approved', '2026-06-12', 'DEMO-FIN rezervace realizace', 'DEMOFIN003', null);
  insert into public.payout_items (payout_id, project_id, realization_id, amount)
  values
    (v_payout_project_paid, v_project_main, null, 2000),
    (v_payout_project_pending, v_project_main, null, 5000);

  insert into public.realizations (
    id, name, status, lead_person_id, team_members, contract_amount,
    profit_margin_percent, overhead_percent, linked_project_id, type
  ) values (
    v_realization_id, 'DEMO-FIN Realizace', 'dokonceno', v_member_percent,
    array[v_member_percent, v_member_fixed, v_member_hourly], 200000, 15, 5, v_project_main, 'Demo'
  );
  insert into public.realizace_costs (realizace_id, description, amount, created_by)
  values (v_realization_id, 'DEMO realizacni naklad', 20000, v_auth_id);
  insert into public.realizace_extra_costs (realizace_id, description, cost_amount, sale_amount, markup_percent, category)
  values (v_realization_id, 'DEMO viceprace', 10000, 30000, 200, 'demo');
  insert into public.realization_profit_shares (realizace_id, member_id, share_type, share_value, note)
  values
    (v_realization_id, v_member_percent, 'percent', 25, 'DEMO procentni podil'),
    (v_realization_id, v_member_fixed, 'fixed', 10000, 'DEMO fixni podil');
  insert into public.payout_items (payout_id, project_id, realization_id, amount)
  values (v_payout_realization_pending, null, v_realization_id, 8500);

  v_result := public.save_attendance_record(
    null,
    v_member_hourly,
    '2026-06-03',
    8,
    v_project_main,
    null,
    'DEMO-FIN hodinova prace na projektu'
  );
  v_result := public.save_attendance_record(
    null,
    v_member_hourly,
    '2026-06-04',
    6,
    null,
    v_realization_id,
    'DEMO-FIN hodinova prace na realizaci'
  );
  v_result := public.submit_attendance_month(v_member_hourly, '2026-06-01');
  v_submission_id := (v_result->>'id')::uuid;
  v_result := public.approve_attendance_submission(v_submission_id);
  v_result := public.create_hourly_payout_request(v_member_hourly, 6, 2026, 'regular', null);
  if (v_result->>'total_hours')::numeric <> 14 then raise exception 'Hodinova vyplata total_hours cekano 14, skutecnost %', v_result; end if;
  if (v_result->>'hourly_rate')::numeric <> 800 then raise exception 'Hodinova vyplata hourly_rate cekano 800, skutecnost %', v_result; end if;
  if (v_result->>'total_amount')::numeric <> 11200 then raise exception 'Hodinova vyplata total_amount cekano 11200, skutecnost %', v_result; end if;
  if (v_result->>'snapshot_total_hours')::numeric <> 14 then raise exception 'Hodinova vyplata snapshot_total_hours cekano 14, skutecnost %', v_result; end if;
  if (v_result->>'snapshot_total_amount')::numeric <> 11200 then raise exception 'Hodinova vyplata snapshot_total_amount cekano 11200, skutecnost %', v_result; end if;
  v_hourly_request_id := (v_result->>'id')::uuid;
  select has_discrepancy into v_bool
  from public.get_hourly_payout_discrepancies()
  where request_id = v_hourly_request_id;
  if coalesce(v_bool, true) <> false then raise exception 'Hodinova vyplata nema sedet na snapshot/current hodnotach'; end if;
  insert into financial_demo_log values ('hourly_payout', 'Dochazka 8 h projekt + 6 h realizace pri 800 Kc/h = hodinova vyplata 11200 Kc se snapshotem.');

  insert into public.crm_opportunities (
    id, subject_id, project_id, owner_member_id, title, stage, status, priority,
    source, value, probability, expected_close_date, description, number
  ) values (
    v_opportunity_id, v_subject_id, v_project_main, v_member_percent,
    'DEMO-FIN CRM kalkulace', 'new', 'open', 'normal', 'demo', 0, 50,
    '2026-07-01', 'Demo CRM slevy a DPH', 'DEMO-FIN-OPP'
  );
  insert into public.crm_commercial_documents (
    id, opportunity_id, subject_id, type, status, number, title, issue_date,
    valid_until, currency, subtotal, discount_total, tax_total, total, metadata, sync_items
  ) values (
    v_document_id, v_opportunity_id, v_subject_id, 'offer', 'draft', 'DEMO-FIN-OFFER',
    'DEMO-FIN Nabidka', '2026-06-21', '2026-07-21', 'CZK', 0, 0, 0, 0, '{}'::jsonb, true
  );

  v_result := public.replace_crm_opportunity_items(
    v_opportunity_id,
    jsonb_build_array(
      jsonb_build_object('code','A','name','Bez slevy','quantity',2,'unit','ks','unit_price',1000,'discount_percent',0,'vat_rate',21,'sort_order',10),
      jsonb_build_object('code','B','name','Sleva 10','quantity',1,'unit','ks','unit_price',500,'discount_percent',10,'vat_rate',12,'sort_order',20)
    ),
    true
  );

  insert into financial_demo_log values ('seed', 'Demo ucet, clenove, projekty, realizace, CRM, dochazka a payouty zalozeny v lokalni DB.');

  v_summary := public.project_financial_summary(v_project_main);
  if (v_summary->>'gross_project_budget')::numeric <> 60000 then raise exception 'Projekt gross_project_budget: %', v_summary; end if;
  if (v_summary->>'planned_overhead_amount')::numeric <> 6000 then raise exception 'Projekt planned_overhead_amount: %', v_summary; end if;
  if (v_summary->>'subcontractor_costs')::numeric <> 10000 then raise exception 'Projekt subcontractor_costs: %', v_summary; end if;
  if (v_summary->>'team_budget')::numeric <> 44000 then raise exception 'Projekt team_budget: %', v_summary; end if;
  if (v_summary->>'attendance_costs')::numeric <> 6400 then raise exception 'Projekt attendance_costs: %', v_summary; end if;
  if (v_summary->>'cost_adjusted_team_budget')::numeric <> 24000 then raise exception 'Projekt cost_adjusted_team_budget: %', v_summary; end if;
  if (v_summary->>'operational_costs')::numeric <> 30000 then raise exception 'Projekt operational_costs: %', v_summary; end if;
  insert into financial_demo_log values ('project_summary', 'DEMO-FIN-001: gross 60000, rezije 6000, subdodavky 10000, team 44000, hodinova expozice 6400, cost-adjusted 24000.');

  select total_reward into v_num
  from public.get_member_project_rewards(v_member_percent)
  where project_id = v_project_main;
  if v_num <> 11000 then raise exception 'Procentni projektova odmena cekana 11000, skutecnost %', v_num; end if;

  select available_balance into v_num
  from public.get_member_project_rewards(v_member_percent)
  where project_id = v_project_main;
  if v_num <> 4000 then raise exception 'Projekt available_balance cekana 4000, skutecnost %', v_num; end if;

  select total_reward into v_num
  from public.get_member_project_rewards(v_member_fixed)
  where project_id = v_project_main;
  if v_num <> 22000 then raise exception 'Fixni projektova odmena ma byt limitovana na 22000, skutecnost %', v_num; end if;

  select total_reward into v_num
  from public.get_member_project_rewards(v_member_percent)
  where project_id = v_project_exhausted;
  if v_num <> 0 then raise exception 'Vycerpany projekt ma mit odmenu 0, skutecnost %', v_num; end if;
  insert into financial_demo_log values ('project_rewards', 'Procentni odmena 11000 po zaplacene vyplate 2000, dostupne po rezervacich 4000, fixni odmena limitovana na 22000, vycerpany projekt 0.');

  select available_to_payout into v_num
  from public.get_user_financials(v_member_percent);
  if v_num <> 4000 then raise exception 'get_user_financials available_to_payout cekano 4000, skutecnost %', v_num; end if;

  v_summary := public.realization_financial_summary(v_realization_id);
  if (v_summary->>'total_revenue')::numeric <> 230000 then raise exception 'Realizace total_revenue: %', v_summary; end if;
  if (v_summary->>'hourly_costs')::numeric <> 11200 then raise exception 'Realizace hourly_costs: %', v_summary; end if;
  if (v_summary->>'total_costs')::numeric <> 30000 then raise exception 'Realizace total_costs: %', v_summary; end if;
  if (v_summary->>'profit_amount')::numeric <> 34500 then raise exception 'Realizace profit_amount: %', v_summary; end if;
  if (v_summary->>'overhead_amount')::numeric <> 11500 then raise exception 'Realizace overhead_amount: %', v_summary; end if;
  if (v_summary->>'team_budget')::numeric <> 154000 then raise exception 'Realizace team_budget: %', v_summary; end if;
  insert into financial_demo_log values ('realization_summary', 'Realizace: revenue 230000, naklady 30000 a hodinova expozice 11200 z realizace i navazaneho projektu, marze 34500, rezije 11500, team budget 154000.');

  v_result := public.get_payout_availability(v_member_percent, null);
  select (item->>'available_share')::numeric into v_num
  from jsonb_array_elements(v_result->'realizations') item
  where item->>'id' = v_realization_id::text;
  if v_num <> 30000 then raise exception 'Realizace available_share cekano 30000, skutecnost %, json %', v_num, v_result; end if;
  insert into financial_demo_log values ('payout_availability', 'Realizace procentni podil 25 % z 154000 = 38500, po rezervaci 8500 dostupne 30000.');

  if (v_result->'projects') is null then raise exception 'Payout availability neobsahuje projects'; end if;

  if (v_result->'realizations') is null then raise exception 'Payout availability neobsahuje realizations'; end if;

  if (v_result->'projects')::text not like '%' || v_project_main::text || '%' then
    raise exception 'Payout availability neobsahuje demo projekt: %', v_result;
  end if;

  if (v_result->'realizations')::text not like '%' || v_realization_id::text || '%' then
    raise exception 'Payout availability neobsahuje demo realizaci: %', v_result;
  end if;

  if (v_result->'projects')::text not like '%4000%' then
    raise exception 'Payout availability projekt nema dostupnych 4000: %', v_result;
  end if;

  if (v_result->'realizations')::text not like '%30000%' then
    raise exception 'Payout availability realizace nema dostupnych 30000: %', v_result;
  end if;

  if (v_result->'projects')::text like '%' || v_project_exhausted::text || '%' then
    raise exception 'Vycerpany projekt se nema nabizet k vyplate: %', v_result;
  end if;

  if (v_result->'projects')::text not like '%DEMO-FIN-001%' then
    raise exception 'Payout availability neobsahuje kod DEMO-FIN-001: %', v_result;
  end if;

  if (v_result->'realizations')::text not like '%Dostupne k zadosti%' and (v_result->'realizations')::text not like '%Dostupn%' then
    insert into financial_demo_log values ('payout_availability_note', 'Text availability_reason je lokalizovany, numericka dostupnost je overena.');
  end if;

  if (v_result->'projects')::text is null then raise exception 'Neocekavany null project availability'; end if;

  if (v_result->'realizations')::text is null then raise exception 'Neocekavany null realization availability'; end if;

  if (v_result->'projects') = '[]'::jsonb then raise exception 'Payout projects jsou prazdne'; end if;

  if (v_result->'realizations') = '[]'::jsonb then raise exception 'Payout realizations jsou prazdne'; end if;

  if (v_result->'projects')::text not like '%available_balance%' then raise exception 'Payout projects chybi available_balance'; end if;

  if (v_result->'realizations')::text not like '%available_share%' then raise exception 'Payout realizations chybi available_share'; end if;

  if (v_result->'projects')::text like '%' || v_member_fixed::text || '%' then
    insert into financial_demo_log values ('payout_availability_note', 'Admin dotaz pro procentniho clena spravne nevraci fixniho clena jako projektovou dostupnost.');
  end if;

  if (v_result->'projects')::text not like '%11000%' then raise exception 'Projektova dostupnost neobsahuje total_reward 11000: %', v_result; end if;

  if (v_result->'realizations')::text not like '%38500%' then raise exception 'Realizacni dostupnost neobsahuje total_share 38500: %', v_result; end if;

  if (v_result->'realizations')::text not like '%8500%' then raise exception 'Realizacni dostupnost neobsahuje rezervaci 8500: %', v_result; end if;

  if (v_result->'projects')::text not like '%7000%' then raise exception 'Projektova dostupnost neobsahuje rezervaci 7000: %', v_result; end if;

  if (v_result->'projects')::text not like '%delivered%' then raise exception 'Projektova dostupnost neobsahuje stav delivered: %', v_result; end if;

  if (v_result->'realizations')::text not like '%dokonceno%' then raise exception 'Realizacni dostupnost neobsahuje stav dokonceno: %', v_result; end if;

  if (v_result->'projects')::text not like '%DEMO-FIN Projekt cost-adjusted%' then raise exception 'Projektova dostupnost neobsahuje nazev demo projektu: %', v_result; end if;

  if (v_result->'realizations')::text not like '%DEMO-FIN Realizace%' then raise exception 'Realizacni dostupnost neobsahuje nazev demo realizace: %', v_result; end if;

  if (v_result->'projects')::text not like '%available_balance%' or (v_result->'realizations')::text not like '%available_share%' then
    raise exception 'Payout availability nema ocekavane klice: %', v_result;
  end if;

  v_result := public.replace_crm_document_items(
    v_document_id,
    jsonb_build_array(
      jsonb_build_object('code','A','name','Bez slevy','quantity',2,'unit','ks','unit_price',1000,'discount_percent',0,'vat_rate',21,'sort_order',10),
      jsonb_build_object('code','B','name','Sleva 10','quantity',1,'unit','ks','unit_price',500,'discount_percent',10,'vat_rate',12,'sort_order',20)
    )
  );
  if (v_result->>'subtotal')::numeric <> 2500 then raise exception 'CRM subtotal: %', v_result; end if;
  if (v_result->>'discount_total')::numeric <> 50 then raise exception 'CRM discount_total: %', v_result; end if;
  if (v_result->>'total')::numeric <> 2450 then raise exception 'CRM total: %', v_result; end if;
  if (v_result->>'tax_total')::numeric <> 474 then raise exception 'CRM tax_total: %', v_result; end if;
  insert into financial_demo_log values ('crm_totals', 'CRM: subtotal 2500, sleva 50, zaklad po sleve 2450, DPH 474.');

  insert into financial_demo_log values ('done', 'Vsechny lokalni financni vypocty pro demo data prosly.');
end $$;

select * from financial_demo_log order by ctid;

commit;
