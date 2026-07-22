-- Keep project profitability and payout coverage on a net-of-VAT basis.
-- Cash receivables remain gross because they represent actual bank payments.

create or replace function public.billing_funding_snapshot(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_contract_net numeric := 0;
  v_count integer := 0;
  v_invoiced_net numeric := 0;
  v_invoiced_gross numeric := 0;
  v_paid_net_equivalent numeric := 0;
  v_paid_gross numeric := 0;
  v_status text;
  v_plan_count integer := 0;
  v_planned_net numeric := 0;
  v_planned_gross numeric := 0;
  v_missing_documents integer := 0;
  v_overdue_milestones integer := 0;
begin
  if p_entity_type = 'project' then
    select coalesce(price, 0)
    into v_contract_net
    from public.projects
    where id = p_entity_id;
  elsif p_entity_type = 'realization' then
    select coalesce(r.contract_amount, 0) + coalesce((
      select sum(ec.sale_amount)
      from public.realizace_extra_costs ec
      where ec.realizace_id = r.id
    ), 0)
    into v_contract_net
    from public.realizations r
    where r.id = p_entity_id;
  else
    raise exception 'Unsupported billing entity type';
  end if;

  select
    count(*),
    coalesce(sum(
      case when invoice_kind = 'credit_note' then -amount_excl_vat else amount_excl_vat end
    ) filter (where status not in ('draft', 'cancelled')), 0),
    coalesce(sum(
      case when invoice_kind = 'credit_note' then -amount_incl_vat else amount_incl_vat end
    ) filter (where status not in ('draft', 'cancelled')), 0),
    coalesce(sum(
      (case when invoice_kind = 'credit_note' then -1 else 1 end)
      * least(greatest(paid_amount, 0), amount_incl_vat)
      * amount_excl_vat / nullif(amount_incl_vat, 0)
    ) filter (where status <> 'cancelled'), 0),
    coalesce(sum(
      case when invoice_kind = 'credit_note' then -paid_amount else paid_amount end
    ) filter (where status <> 'cancelled'), 0),
    count(*) filter (
      where status not in ('draft', 'cancelled')
        and nullif(btrim(document_url), '') is null
    )
  into v_count, v_invoiced_net, v_invoiced_gross, v_paid_net_equivalent, v_paid_gross, v_missing_documents
  from public.entity_billing_entries
  where (p_entity_type = 'project' and project_id = p_entity_id)
     or (p_entity_type = 'realization' and realization_id = p_entity_id);

  select
    count(*) filter (where status <> 'cancelled'),
    coalesce(sum(amount_excl_vat) filter (where status <> 'cancelled'), 0),
    coalesce(sum(amount_incl_vat) filter (where status <> 'cancelled'), 0),
    count(*) filter (
      where status not in ('invoiced', 'partially_paid', 'completed', 'cancelled')
        and coalesce(planned_issue_date, performance_date) < current_date
    )
  into v_plan_count, v_planned_net, v_planned_gross, v_overdue_milestones
  from public.entity_billing_milestones
  where (p_entity_type = 'project' and project_id = p_entity_id)
     or (p_entity_type = 'realization' and realization_id = p_entity_id);

  v_status := case
    when v_count = 0 and v_plan_count = 0 then 'not_configured'
    when v_invoiced_net <= 0 then 'not_invoiced'
    when v_contract_net > 0 and v_invoiced_net < v_contract_net then 'partially_invoiced'
    when v_paid_net_equivalent <= 0 then 'invoiced_unpaid'
    when v_contract_net > 0 and v_paid_net_equivalent < v_contract_net then 'partially_paid'
    else 'fully_paid'
  end;

  return jsonb_build_object(
    'configured', v_count > 0 or v_plan_count > 0,
    'entry_count', v_count,
    'plan_count', v_plan_count,
    -- Legacy keys remain net so existing payout consumers stay compatible.
    'contract_amount', v_contract_net,
    'planned_amount', v_planned_net,
    'plan_variance', v_planned_net - v_contract_net,
    'invoiced_amount', v_invoiced_net,
    'paid_amount', v_paid_gross,
    'outstanding_amount', greatest(0, v_invoiced_gross - v_paid_gross),
    'remaining_to_invoice', greatest(0, v_contract_net - v_invoiced_net),
    'contract_amount_excl_vat', v_contract_net,
    'planned_amount_excl_vat', v_planned_net,
    'planned_amount_incl_vat', v_planned_gross,
    'invoiced_amount_excl_vat', v_invoiced_net,
    'invoiced_amount_incl_vat', v_invoiced_gross,
    'paid_amount_excl_vat_equivalent', greatest(0, v_paid_net_equivalent),
    'paid_amount_incl_vat', v_paid_gross,
    'outstanding_amount_incl_vat', greatest(0, v_invoiced_gross - v_paid_gross),
    'remaining_to_invoice_excl_vat', greatest(0, v_contract_net - v_invoiced_net),
    'invoice_coverage_percent', case when v_contract_net > 0 then least(100, greatest(0, v_invoiced_net / v_contract_net * 100)) else 0 end,
    'payment_coverage_percent', case when v_contract_net > 0 then least(100, greatest(0, v_paid_net_equivalent / v_contract_net * 100)) else 0 end,
    'invoice_payment_percent', case when v_invoiced_gross > 0 then least(100, greatest(0, v_paid_gross / v_invoiced_gross * 100)) else 0 end,
    'missing_document_count', v_missing_documents,
    'overdue_milestone_count', v_overdue_milestones,
    'status', v_status,
    'warning', v_status <> 'fully_paid' or v_missing_documents > 0 or v_overdue_milestones > 0,
    'warning_message', concat_ws(' ',
      case v_status
        when 'not_configured' then 'Fakturace zakázky zatím není evidována.'
        when 'not_invoiced' then 'Zakázka zatím nebyla vyfakturována.'
        when 'partially_invoiced' then 'Zakázka je vyfakturována pouze částečně.'
        when 'invoiced_unpaid' then 'Vystavené faktury zatím nejsou uhrazené.'
        when 'partially_paid' then 'Zakázka zatím není plně uhrazená.'
        else null end,
      case when v_missing_documents > 0 then format('%s faktur nemá přiložený doklad.', v_missing_documents) end,
      case when v_overdue_milestones > 0 then format('%s fakturačních etap je po plánovaném termínu.', v_overdue_milestones) end
    )
  );
end;
$$;

revoke all on function public.billing_funding_snapshot(text, uuid) from public, anon, authenticated;
grant execute on function public.billing_funding_snapshot(text, uuid) to service_role;

-- AI-reviewed project and realization values use the same canonical net basis.
create or replace function public.apply_contract_extraction(
  p_extraction_id uuid,
  p_update_contract_value boolean default true,
  p_create_billing_milestones boolean default true,
  p_reviewed_contract_value numeric default null,
  p_reviewed_vat_rate numeric default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.contract_extraction_jobs%rowtype;
  v_data jsonb;
  v_contract_gross numeric;
  v_contract_net numeric;
  v_contract_vat numeric;
  v_inserted integer := 0;
  v_next_number integer := 1;
  v_row public.contract_extraction_milestones%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'Admin access required'; end if;

  select * into v_job from public.contract_extraction_jobs where id = p_extraction_id for update;
  if not found then raise exception 'Contract extraction not found'; end if;
  if v_job.status <> 'review' then raise exception 'Only a reviewed proposal can be applied'; end if;

  v_data := v_job.extracted_data;
  v_contract_vat := coalesce(p_reviewed_vat_rate, nullif(v_data ->> 'vat_rate', '')::numeric);
  v_contract_net := coalesce(p_reviewed_contract_value, nullif(v_data ->> 'contract_value_excl_vat', '')::numeric);
  v_contract_gross := nullif(v_data ->> 'contract_value_incl_vat', '')::numeric;

  if v_contract_vat is not null and v_contract_vat not in (0, 12, 21) then
    raise exception 'Reviewed VAT rate must be 0, 12 or 21 percent';
  end if;
  if v_contract_net is null and v_contract_gross is not null and v_contract_vat is not null then
    v_contract_net := round(v_contract_gross / (1 + v_contract_vat / 100), 2);
  end if;
  if v_contract_gross is null and v_contract_net is not null and v_contract_vat is not null then
    v_contract_gross := round(v_contract_net * (1 + v_contract_vat / 100), 2);
  end if;
  if p_update_contract_value and coalesce(v_data ->> 'currency', 'CZK') <> 'CZK' then
    raise exception 'Contract value in a foreign currency requires manual conversion';
  end if;
  if p_update_contract_value and coalesce(v_contract_net, 0) <= 0 then
    raise exception 'Reviewed net contract value is required before updating the project';
  end if;
  if p_create_billing_milestones and v_contract_vat is null then
    raise exception 'Reviewed VAT rate is required before creating billing milestones';
  end if;

  if p_update_contract_value then
    if v_job.entity_type = 'project' then
      update public.projects set price = v_contract_net where id = v_job.project_id;
    else
      update public.realizations set contract_amount = v_contract_net where id = v_job.realization_id;
    end if;
  end if;

  if p_create_billing_milestones then
    select coalesce(max(installment_number), 0) + 1 into v_next_number
    from public.entity_billing_milestones
    where (v_job.entity_type = 'project' and project_id = v_job.project_id)
       or (v_job.entity_type = 'realization' and realization_id = v_job.realization_id);

    for v_row in
      select * from public.contract_extraction_milestones
      where extraction_id = p_extraction_id and accepted = true
        and (amount_excl_vat is not null or percent_of_contract is not null)
      order by sequence_number
    loop
      if v_row.amount_excl_vat is null then
        raise exception 'Accepted billing milestone % is missing an amount', v_row.sequence_number;
      end if;
      insert into public.entity_billing_milestones (
        entity_type, project_id, realization_id, installment_number, name, status,
        performance_date, planned_issue_date, due_date, amount_excl_vat, vat_rate,
        percent_of_contract, note
      ) values (
        v_job.entity_type, v_job.project_id, v_job.realization_id, v_next_number + v_inserted,
        v_row.name, 'planned', v_row.performance_date, v_row.planned_issue_date,
        coalesce(v_row.due_date, case when v_row.planned_issue_date is not null and v_row.due_days is not null
          then v_row.planned_issue_date + v_row.due_days else null end),
        v_row.amount_excl_vat, coalesce(v_row.vat_rate, v_contract_vat),
        v_row.percent_of_contract,
        concat_ws(E'\n', v_row.condition_text, case when v_row.evidence is not null then 'Zdroj ve smlouvě: ' || v_row.evidence end)
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  update public.contract_extraction_jobs
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now()
  where id = p_extraction_id;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (auth.uid(), auth.jwt() ->> 'email', 'contract_extraction_applied', jsonb_build_object(
    'extraction_id', p_extraction_id,
    'entity_type', v_job.entity_type,
    'project_id', v_job.project_id,
    'realization_id', v_job.realization_id,
    'updated_contract_value', p_update_contract_value,
    'reviewed_contract_value_excl_vat', v_contract_net,
    'reviewed_contract_value_incl_vat', v_contract_gross,
    'reviewed_vat_rate', v_contract_vat,
    'created_billing_milestones', v_inserted
  ));

  return jsonb_build_object(
    'success', true,
    'milestones_created', v_inserted,
    'contract_value_excl_vat', v_contract_net,
    'contract_value_incl_vat', v_contract_gross,
    'vat_rate', v_contract_vat
  );
end;
$$;

revoke all on function public.apply_contract_extraction(uuid, boolean, boolean, numeric, numeric) from public, anon;
grant execute on function public.apply_contract_extraction(uuid, boolean, boolean, numeric, numeric) to authenticated, service_role;

comment on column public.projects.price is 'Canonical project contract value excluding VAT.';
comment on column public.project_costs.amount is 'Project cost amount excluding VAT.';
comment on column public.project_subcontractors.price is 'Subcontractor cost amount excluding VAT.';
comment on column public.realizations.contract_amount is 'Canonical realization contract value excluding VAT.';
comment on column public.realizace_costs.amount is 'Realization cost amount excluding VAT.';
comment on column public.realizace_extra_costs.cost_amount is 'Extra realization cost amount excluding VAT.';
comment on column public.realizace_extra_costs.sale_amount is 'Extra realization sale amount excluding VAT.';
comment on column public.overhead_costs.amount is 'Overhead cost amount excluding VAT.';
comment on column public.project_overhead_costs.amount is 'Allocated project overhead amount excluding VAT.';
