-- Require an administrator-reviewed VAT rate and gross contract value before
-- applying AI extraction results. The original extraction remains unchanged;
-- reviewed values are captured in the audit log.

drop function if exists public.apply_contract_extraction(uuid, boolean, boolean);

create or replace function public.apply_contract_extraction(
  p_extraction_id uuid,
  p_update_contract_value boolean default true,
  p_create_billing_milestones boolean default true,
  p_reviewed_contract_value numeric default null,
  p_reviewed_vat_rate numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  v_contract_net := nullif(v_data ->> 'contract_value_excl_vat', '')::numeric;
  v_contract_vat := coalesce(p_reviewed_vat_rate, nullif(v_data ->> 'vat_rate', '')::numeric);
  v_contract_gross := coalesce(p_reviewed_contract_value, nullif(v_data ->> 'contract_value_incl_vat', '')::numeric);

  if v_contract_vat is not null and v_contract_vat not in (0, 12, 21) then
    raise exception 'Reviewed VAT rate must be 0, 12 or 21 percent';
  end if;
  if v_contract_gross is null and v_contract_net is not null and v_contract_vat is not null then
    v_contract_gross := round(v_contract_net * (1 + v_contract_vat / 100), 2);
  end if;
  if p_update_contract_value and coalesce(v_data ->> 'currency', 'CZK') <> 'CZK' then
    raise exception 'Contract value in a foreign currency requires manual conversion';
  end if;
  if p_update_contract_value and coalesce(v_contract_gross, 0) <= 0 then
    raise exception 'Reviewed contract value is required before updating the project';
  end if;
  if p_create_billing_milestones and v_contract_vat is null then
    raise exception 'Reviewed VAT rate is required before creating billing milestones';
  end if;

  if p_update_contract_value then
    if v_job.entity_type = 'project' then
      update public.projects set price = v_contract_gross where id = v_job.project_id;
    else
      update public.realizations set contract_amount = v_contract_gross where id = v_job.realization_id;
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
    'reviewed_contract_value', v_contract_gross,
    'reviewed_vat_rate', v_contract_vat,
    'created_billing_milestones', v_inserted
  ));

  return jsonb_build_object(
    'success', true,
    'milestones_created', v_inserted,
    'contract_value', v_contract_gross,
    'vat_rate', v_contract_vat
  );
end;
$$;

revoke all on function public.apply_contract_extraction(uuid, boolean, boolean, numeric, numeric) from public, anon;
grant execute on function public.apply_contract_extraction(uuid, boolean, boolean, numeric, numeric) to authenticated, service_role;
