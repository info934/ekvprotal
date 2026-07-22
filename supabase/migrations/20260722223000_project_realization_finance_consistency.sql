-- Keep realization edits, lifecycle and reward allocation consistent and atomic.

alter table public.realizations
  drop constraint if exists realizations_margin_overhead_total_check,
  add constraint realizations_margin_overhead_total_check
    check (coalesce(profit_margin_percent, 0) + coalesce(overhead_percent, 0) <= 100)
    not valid;

alter table public.entity_billing_entries
  drop constraint if exists entity_billing_entries_document_url_http_check,
  add constraint entity_billing_entries_document_url_http_check
    check (document_url is null or document_url ~* '^https?://[^[:space:]]+$')
    not valid;

create or replace function public.update_realization_status(
  p_realization_id uuid,
  p_next_status text,
  p_note text default null
)
returns public.realizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_realization public.realizations;
  v_updated public.realizations;
  v_before_shares jsonb;
  v_allowed_statuses text[] := array[
    'Připravuje se', 'Probíhá', 'Pozastaveno', 'Dokončeno', 'Předáno', 'waiting_for_approval'
  ];
  v_was_closed boolean;
  v_will_be_closed boolean;
begin
  if not public.can_edit_module('realizace') then
    raise exception 'Nemáte oprávnění měnit stav realizace.';
  end if;
  if p_realization_id is null then raise exception 'Realizace není určena.'; end if;
  if p_next_status is null or not p_next_status = any(v_allowed_statuses) then
    raise exception 'Neplatný stav realizace: %', coalesce(p_next_status, '(prázdný)');
  end if;

  select * into v_realization from public.realizations where id = p_realization_id for update;
  if not found then raise exception 'Realizace nebyla nalezena.'; end if;
  if v_realization.status is not distinct from p_next_status then return v_realization; end if;

  v_was_closed := v_realization.status in ('Dokončeno', 'Předáno');
  v_will_be_closed := p_next_status in ('Dokončeno', 'Předáno');
  if v_was_closed and not v_will_be_closed and exists (
    select 1 from public.realization_profit_shares where realizace_id = p_realization_id
  ) then
    if coalesce(public.get_user_role() <> 'admin', true) then
      raise exception 'Pouze administrátor může znovu otevřít realizaci s rozdělenými podíly.';
    end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]'::jsonb)
      into v_before_shares
      from public.realization_profit_shares s where s.realizace_id = p_realization_id;
    delete from public.realization_profit_shares where realizace_id = p_realization_id;
    perform public.log_workflow_audit(
      'realization_profit_shares_cleared_on_reopen',
      jsonb_build_object('realization_id', p_realization_id, 'before', v_before_shares, 'next_status', p_next_status)
    );
  end if;

  update public.realizations
  set status = p_next_status, updated_at = now()
  where id = p_realization_id
  returning * into v_updated;

  perform public.log_workflow_audit(
    'realization_status_update',
    jsonb_build_object(
      'table', 'realizations', 'id', v_updated.id, 'realization_id', v_updated.id,
      'old_status', v_realization.status, 'new_status', v_updated.status, 'note', p_note
    )
  );
  return v_updated;
end;
$$;

revoke all on function public.update_realization_status(uuid, text, text) from public, anon;
grant execute on function public.update_realization_status(uuid, text, text) to authenticated, service_role;

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
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'Invalid realization payload'; end if;
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then raise exception 'Shares payload must be an array'; end if;
  if coalesce((p_payload->>'profit_margin_percent')::numeric, 0)
      + coalesce((p_payload->>'overhead_percent')::numeric, 0) > 100 then
    raise exception 'Profit margin and overhead cannot exceed 100 percent in total';
  end if;

  set constraints validate_realization_reward_allocation deferred;
  set constraints validate_realization_reward_allocation_on_realization deferred;

  if v_id is null then
    insert into public.realizations (
      name, location_address, type, status, start_date, investor_id, lead_person_id, team_members,
      budget, planned_end_date, actual_end_date, contract_amount, expected_total_cost,
      profit_margin_percent, overhead_percent, crm_opportunity_id, updated_at
    ) values (
      nullif(p_payload->>'name', ''), nullif(p_payload->>'location_address', ''), nullif(p_payload->>'type', ''),
      coalesce(nullif(p_status, ''), 'Připravuje se'), nullif(p_payload->>'start_date', '')::date,
      nullif(p_payload->>'investor_id', '')::uuid, nullif(p_payload->>'lead_person_id', '')::uuid,
      array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'team_members', '[]'::jsonb))),
      coalesce((p_payload->>'budget')::numeric, 0), nullif(p_payload->>'planned_end_date', '')::date,
      nullif(p_payload->>'actual_end_date', '')::date, coalesce((p_payload->>'contract_amount')::numeric, 0),
      coalesce((p_payload->>'expected_total_cost')::numeric, 0), coalesce((p_payload->>'profit_margin_percent')::numeric, 0),
      coalesce((p_payload->>'overhead_percent')::numeric, 0), nullif(p_payload->>'crm_opportunity_id', '')::uuid, now()
    ) returning * into v_saved;
    v_id := v_saved.id;
  else
    perform 1 from public.realizations where id = v_id for update;
    if not found then raise exception 'Realization not found'; end if;
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
    where id = v_id returning * into v_saved;
    if p_status is not null and v_saved.status is distinct from p_status then
      v_saved := public.update_realization_status(v_id, p_status, 'atomic_realization_form_update');
    end if;
  end if;

  if coalesce(p_status, v_saved.status) in ('Dokončeno', 'Předáno') then
    perform public.replace_realization_profit_shares(v_id, coalesce(p_shares, '[]'::jsonb));
  elsif exists (select 1 from public.realization_profit_shares where realizace_id = v_id) then
    perform public.replace_realization_profit_shares(v_id, '[]'::jsonb);
  end if;

  select * into v_saved from public.realizations where id = v_id;
  return jsonb_build_object('realization', to_jsonb(v_saved));
end;
$$;

revoke all on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb) to authenticated, service_role;

-- Canonical admin overview: the same labor ledger and reward basis as the detail RPC.
create or replace function public.get_realization_financial_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read realization financial overview';
  end if;
  with manual_costs as (
    select realizace_id, coalesce(sum(amount), 0)::numeric amount from public.realizace_costs group by realizace_id
  ), extras as (
    select realizace_id, coalesce(sum(cost_amount), 0)::numeric cost_amount, coalesce(sum(sale_amount), 0)::numeric sale_amount
    from public.realizace_extra_costs group by realizace_id
  ), labor as (
    select realization_id, coalesce(sum(project_cost_impact), 0)::numeric direct_cost
    from public.labor_cost_ledger where realization_id is not null and status <> 'reversed' group by realization_id
  ), payouts as (
    select i.realization_id,
      coalesce(sum(i.amount) filter (where p.status = 'paid'), 0)::numeric paid,
      coalesce(sum(i.amount) filter (where p.status in ('pending','approved','invoice_uploaded')), 0)::numeric reserved
    from public.payout_items i join public.payouts p on p.id = i.payout_id
    where i.realization_id is not null group by i.realization_id
  ), rows as (
    select r.id, r.name, r.status,
      (coalesce(r.contract_amount, 0) + coalesce(e.sale_amount, 0))::numeric revenue,
      (coalesce(m.amount, 0) + coalesce(e.cost_amount, 0) + coalesce(l.direct_cost, 0))::numeric operational_costs,
      coalesce(p.paid, 0)::numeric paid_payouts, coalesce(p.reserved, 0)::numeric reserved_payouts,
      ((coalesce(r.contract_amount, 0) + coalesce(e.sale_amount, 0)) * coalesce(r.profit_margin_percent, 0) / 100)::numeric profit_amount,
      ((coalesce(r.contract_amount, 0) + coalesce(e.sale_amount, 0)) * coalesce(r.overhead_percent, 0) / 100)::numeric overhead_amount
    from public.realizations r
    left join manual_costs m on m.realizace_id = r.id
    left join extras e on e.realizace_id = r.id
    left join labor l on l.realization_id = r.id
    left join payouts p on p.realization_id = r.id
  ), calculated as (
    select *, (revenue - profit_amount - overhead_amount - operational_costs)::numeric team_budget,
      (operational_costs + paid_payouts)::numeric total_costs,
      greatest(0, revenue - profit_amount - overhead_amount - operational_costs - paid_payouts - reserved_payouts)::numeric available_for_payout
    from rows
  )
  select jsonb_build_object(
    'financial_model_version', 2,
    'total_revenue', coalesce(sum(revenue), 0),
    'total_costs', coalesce(sum(total_costs), 0),
    'total_profit', coalesce(sum(profit_amount), 0),
    'total_overhead', coalesce(sum(overhead_amount), 0),
    'total_distribution', coalesce(sum(team_budget), 0),
    'total_available_for_payout', coalesce(sum(available_for_payout), 0),
    'realization_count', count(*),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'status', status, 'revenue', revenue, 'costs', total_costs,
      'profit', profit_amount, 'overhead', overhead_amount, 'team_budget', team_budget,
      'available_for_payout', available_for_payout
    ) order by name), '[]'::jsonb)
  ) into v_result from calculated;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_realization_financial_overview() from public, anon, authenticated;
grant execute on function public.get_realization_financial_overview() to authenticated, service_role;

comment on function public.save_realization_with_profit_shares(uuid, jsonb, text, jsonb) is
  'Atomic admin save of realization fields, lifecycle status and reward shares.';
comment on function public.get_realization_financial_overview() is
  'Canonical admin aggregate based on realization operational costs and labor_cost_ledger snapshots.';
