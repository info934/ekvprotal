begin;

-- Legacy realizations predate the editable business code. Keep every existing
-- business reference unchanged and assign only missing values a deterministic
-- fallback derived from the immutable realization UUID.
update public.realizations
set
  code = 'R-' || upper(left(replace(id::text, '-', ''), 8)),
  updated_at = now()
where nullif(btrim(code), '') is null;

drop function if exists public.list_realizations_safe();

create function public.list_realizations_safe()
returns table (
  id uuid,
  code text,
  name text,
  status text,
  type text,
  start_date date,
  planned_end_date date,
  actual_end_date date,
  created_at timestamptz,
  team_members uuid[],
  contract_amount numeric,
  expected_total_cost numeric,
  actual_costs numeric,
  budget numeric,
  investor jsonb,
  lead_person jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_view_finance boolean := public.can_view_realization_financials();
begin
  return query
  select
    r.id,
    r.code,
    r.name,
    r.status,
    r.type,
    r.start_date,
    r.planned_end_date,
    r.actual_end_date,
    r.created_at,
    r.team_members,
    case when v_can_view_finance then r.contract_amount else null::numeric end,
    case when v_can_view_finance then r.expected_total_cost else null::numeric end,
    case when v_can_view_finance then r.actual_costs else null::numeric end,
    case when v_can_view_finance then r.budget else null::numeric end,
    case when s.id is null then null::jsonb else jsonb_build_object('id', s.id, 'name', s.name) end,
    case when m.id is null then null::jsonb else jsonb_build_object('id', m.id, 'name', m.name) end
  from public.realizations r
  left join public.subjects s on s.id = r.investor_id
  left join public.members m on m.id = r.lead_person_id
  where public.can_access_realization(r.id)
  order by r.created_at desc;
end;
$$;

revoke all on function public.list_realizations_safe() from public, anon;
grant execute on function public.list_realizations_safe() to authenticated, service_role;

create or replace function public.get_realization_safe(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_view_finance boolean := public.can_view_realization_financials();
  v_result jsonb;
begin
  if p_realization_id is null then
    raise exception 'realization_id is required';
  end if;

  if not public.can_access_realization(p_realization_id) then
    raise exception 'Not allowed to read this realization';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'name', r.name,
    'location_address', r.location_address,
    'location_gps', r.location_gps,
    'type', r.type,
    'status', r.status,
    'start_date', r.start_date,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'planned_end_date', r.planned_end_date,
    'actual_end_date', r.actual_end_date,
    'investor_id', r.investor_id,
    'lead_person_id', r.lead_person_id,
    'team_members', coalesce(to_jsonb(r.team_members), '[]'::jsonb),
    'linked_project_id', r.linked_project_id,
    'crm_opportunity_id', r.crm_opportunity_id,
    'contract_amount', case when v_can_view_finance then r.contract_amount else null::numeric end,
    'expected_total_cost', case when v_can_view_finance then r.expected_total_cost else null::numeric end,
    'actual_costs', case when v_can_view_finance then r.actual_costs else null::numeric end,
    'budget', case when v_can_view_finance then r.budget else null::numeric end,
    'profit_margin_percent', case when v_can_view_finance then r.profit_margin_percent else null::numeric end,
    'profit_share_percent', case when v_can_view_finance then r.profit_share_percent else null::numeric end,
    'overhead_percent', case when v_can_view_finance then r.overhead_percent else null::numeric end,
    'investor', case when s.id is null then null::jsonb else jsonb_build_object('id', s.id, 'name', s.name) end,
    'lead_person', case when m.id is null then null::jsonb else jsonb_build_object('id', m.id, 'name', m.name) end
  )
  into v_result
  from public.realizations r
  left join public.subjects s on s.id = r.investor_id
  left join public.members m on m.id = r.lead_person_id
  where r.id = p_realization_id;

  if v_result is null then
    raise exception 'Realization not found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_realization_safe(uuid) from public, anon;
grant execute on function public.get_realization_safe(uuid) to authenticated, service_role;

create or replace function public.save_realization_with_profit_shares(
  p_realization_id uuid,
  p_payload jsonb,
  p_status text,
  p_shares jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_realization_id;
  v_saved public.realizations;
  v_previous_status text;
  v_code text := nullif(btrim(coalesce(p_payload->>'code', '')), '');
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to save realization finances and rewards';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid realization payload';
  end if;
  if v_code is null then
    raise exception 'Realization code is required';
  end if;
  if exists (
    select 1
    from public.realizations r
    where lower(btrim(r.code)) = lower(v_code)
      and (v_id is null or r.id <> v_id)
  ) then
    raise exception 'Realization code already exists';
  end if;
  perform public.validate_realization_reward_plan_payload(p_shares);
  if coalesce((p_payload->>'profit_margin_percent')::numeric, 0)
     + coalesce((p_payload->>'overhead_percent')::numeric, 0) > 100 then
    raise exception 'Profit margin and overhead cannot exceed 100 percent in total';
  end if;

  if v_id is null then
    insert into public.realizations (
      code, name, location_address, type, status, start_date, investor_id, lead_person_id, team_members,
      budget, planned_end_date, actual_end_date, contract_amount, expected_total_cost,
      profit_margin_percent, overhead_percent, crm_opportunity_id, updated_at
    ) values (
      v_code,
      nullif(p_payload->>'name', ''),
      nullif(p_payload->>'location_address', ''),
      nullif(p_payload->>'type', ''),
      coalesce(nullif(p_status, ''), 'Připravuje se'),
      nullif(p_payload->>'start_date', '')::date,
      nullif(p_payload->>'investor_id', '')::uuid,
      nullif(p_payload->>'lead_person_id', '')::uuid,
      array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'team_members', '[]'::jsonb))),
      coalesce((p_payload->>'budget')::numeric, 0),
      nullif(p_payload->>'planned_end_date', '')::date,
      nullif(p_payload->>'actual_end_date', '')::date,
      coalesce((p_payload->>'contract_amount')::numeric, 0),
      coalesce((p_payload->>'expected_total_cost')::numeric, 0),
      coalesce((p_payload->>'profit_margin_percent')::numeric, 0),
      coalesce((p_payload->>'overhead_percent')::numeric, 0),
      nullif(p_payload->>'crm_opportunity_id', '')::uuid,
      now()
    )
    returning * into v_saved;
    v_id := v_saved.id;
    v_previous_status := null;
  else
    select r.status into v_previous_status
    from public.realizations r
    where r.id = v_id
    for update;
    if not found then raise exception 'Realization not found'; end if;

    delete from public.realization_profit_shares
    where realizace_id = v_id;

    update public.realizations
    set
      code = v_code,
      name = nullif(p_payload->>'name', ''),
      location_address = nullif(p_payload->>'location_address', ''),
      type = nullif(p_payload->>'type', ''),
      status = coalesce(nullif(p_status, ''), status),
      start_date = nullif(p_payload->>'start_date', '')::date,
      investor_id = nullif(p_payload->>'investor_id', '')::uuid,
      lead_person_id = nullif(p_payload->>'lead_person_id', '')::uuid,
      team_members = array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'team_members', '[]'::jsonb))),
      planned_end_date = nullif(p_payload->>'planned_end_date', '')::date,
      actual_end_date = nullif(p_payload->>'actual_end_date', '')::date,
      contract_amount = coalesce((p_payload->>'contract_amount')::numeric, 0),
      profit_margin_percent = coalesce((p_payload->>'profit_margin_percent')::numeric, 0),
      overhead_percent = coalesce((p_payload->>'overhead_percent')::numeric, 0),
      crm_opportunity_id = nullif(p_payload->>'crm_opportunity_id', '')::uuid,
      updated_at = now()
    where id = v_id
    returning * into v_saved;
  end if;

  perform public.replace_realization_reward_plan(v_id, coalesce(p_shares, '[]'::jsonb));

  if v_previous_status is distinct from v_saved.status then
    perform public.log_workflow_audit(
      'realization_status_update',
      jsonb_build_object(
        'table', 'realizations',
        'id', v_id,
        'realization_id', v_id,
        'old_status', v_previous_status,
        'new_status', v_saved.status,
        'note', 'atomic_realization_form_update',
        'reward_plan_retained', true
      )
    );
  end if;

  select * into v_saved
  from public.realizations
  where id = v_id;

  return jsonb_build_object(
    'realization', to_jsonb(v_saved),
    'financial_preview', public.realization_financial_preview(v_id, '{}'::jsonb, null)
  );
end;
$$;

revoke all on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb)
  to authenticated, service_role;

commit;
