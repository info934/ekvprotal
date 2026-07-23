-- Custom constraint triggers are not addressable by name through SET CONSTRAINTS.
-- Defer the current RPC transaction instead, then retain the explicit budget assertion.

create or replace function public.replace_realization_profit_shares(
  p_realization_id uuid,
  p_shares jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change realization rewards';
  end if;
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then
    raise exception 'Shares payload must be an array';
  end if;
  if not exists (
    select 1
    from public.realizations r
    where r.id = p_realization_id
    for update
  ) then
    raise exception 'Realization not found';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      x(member_id uuid, share_type text, share_value numeric, note text)
    where x.member_id is null
       or x.share_type not in ('percent', 'fixed')
       or x.share_value is null
       or x.share_value < 0
  ) then
    raise exception 'Invalid realization reward row';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      x(member_id uuid, share_type text, share_value numeric, note text)
    group by x.member_id
    having count(*) > 1
  ) then
    raise exception 'A member can have only one realization reward';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]'::jsonb)
  into v_before
  from public.realization_profit_shares s
  where s.realizace_id = p_realization_id;

  set constraints all deferred;

  delete from public.realization_profit_shares
  where realizace_id = p_realization_id;

  insert into public.realization_profit_shares (
    realizace_id,
    member_id,
    share_type,
    share_value,
    note
  )
  select
    p_realization_id,
    x.member_id,
    x.share_type,
    x.share_value,
    nullif(x.note, '')
  from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
    x(member_id uuid, share_type text, share_value numeric, note text);

  perform public.assert_realization_reward_allocation(p_realization_id);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]'::jsonb)
  into v_after
  from public.realization_profit_shares s
  where s.realizace_id = p_realization_id;

  perform public.log_workflow_audit(
    'realization_profit_shares_replaced',
    jsonb_build_object(
      'realization_id', p_realization_id,
      'before', v_before,
      'after', v_after
    )
  );

  return jsonb_build_object(
    'realization_id', p_realization_id,
    'shares', v_after
  );
end;
$$;

create or replace function public.save_realization_with_profit_shares(
  p_realization_id uuid,
  p_payload jsonb,
  p_status text,
  p_shares jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_realization_id;
  v_saved public.realizations;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to save realization finances and rewards';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid realization payload';
  end if;
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then
    raise exception 'Shares payload must be an array';
  end if;
  if coalesce((p_payload->>'profit_margin_percent')::numeric, 0)
      + coalesce((p_payload->>'overhead_percent')::numeric, 0) > 100 then
    raise exception 'Profit margin and overhead cannot exceed 100 percent in total';
  end if;

  set constraints all deferred;

  if v_id is null then
    insert into public.realizations (
      name, location_address, type, status, start_date, investor_id, lead_person_id, team_members,
      budget, planned_end_date, actual_end_date, contract_amount, expected_total_cost,
      profit_margin_percent, overhead_percent, crm_opportunity_id, updated_at
    ) values (
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
    ) returning * into v_saved;
    v_id := v_saved.id;
  else
    perform 1 from public.realizations where id = v_id for update;
    if not found then
      raise exception 'Realization not found';
    end if;

    update public.realizations set
      name = nullif(p_payload->>'name', ''),
      location_address = nullif(p_payload->>'location_address', ''),
      type = nullif(p_payload->>'type', ''),
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

    if p_status is not null and v_saved.status is distinct from p_status then
      v_saved := public.update_realization_status(v_id, p_status, 'atomic_realization_form_update');
    end if;
  end if;

  if coalesce(p_status, v_saved.status) in ('Dokončeno', 'Předáno') then
    perform public.replace_realization_profit_shares(v_id, coalesce(p_shares, '[]'::jsonb));
  elsif exists (
    select 1
    from public.realization_profit_shares
    where realizace_id = v_id
  ) then
    perform public.replace_realization_profit_shares(v_id, '[]'::jsonb);
  end if;

  select * into v_saved
  from public.realizations
  where id = v_id;

  return jsonb_build_object('realization', to_jsonb(v_saved));
end;
$$;

revoke all on function public.replace_realization_profit_shares(uuid, jsonb) from public, anon;
grant execute on function public.replace_realization_profit_shares(uuid, jsonb) to authenticated, service_role;

revoke all on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb) to authenticated, service_role;
