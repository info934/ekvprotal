-- Canonical, audited admin-only updates for project and realization financial inputs.

create or replace function public.protect_scope_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_is_admin boolean := coalesce(public.get_user_role() = 'admin', false)
    or coalesce(auth.role() = 'service_role', false);
begin
  if v_is_admin then return new; end if;

  if tg_table_name = 'projects' then
    if tg_op = 'INSERT' and (
      coalesce(nullif(v_new->>'price', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'budget_percentage', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'overhead_percentage', '')::numeric, 0) <> 0
    ) then raise exception 'Admin role required to set project financial values';
    elsif tg_op = 'UPDATE' and (
      v_new->'price' is distinct from v_old->'price'
      or v_new->'budget_percentage' is distinct from v_old->'budget_percentage'
      or v_new->'overhead_percentage' is distinct from v_old->'overhead_percentage'
    ) then raise exception 'Admin role required to change project financial values';
    end if;
  elsif tg_table_name = 'realizations' then
    if tg_op = 'INSERT' and (
      coalesce(nullif(v_new->>'contract_amount', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'budget', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'expected_total_cost', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'actual_costs', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'profit_margin_percent', '')::numeric, 0) <> 0
      or coalesce(nullif(v_new->>'overhead_percent', '')::numeric, 0) <> 0
    ) then raise exception 'Admin role required to set realization financial values';
    elsif tg_op = 'UPDATE' and (
      v_new->'contract_amount' is distinct from v_old->'contract_amount'
      or v_new->'budget' is distinct from v_old->'budget'
      or v_new->'expected_total_cost' is distinct from v_old->'expected_total_cost'
      or v_new->'actual_costs' is distinct from v_old->'actual_costs'
      or v_new->'profit_margin_percent' is distinct from v_old->'profit_margin_percent'
      or v_new->'overhead_percent' is distinct from v_old->'overhead_percent'
    ) then raise exception 'Admin role required to change realization financial values';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_scope_financial_columns() from public, anon, authenticated;

create or replace function public.update_project_financial_settings(p_project_id uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_old public.projects%rowtype; v_new public.projects%rowtype;
begin
  if public.get_user_role() <> 'admin' then raise exception 'Admin role required'; end if;
  select * into v_old from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if not (p_values ?& array['price','budget_percentage','overhead_percentage']) then raise exception 'All financial settings are required'; end if;
  if (p_values->>'price')::numeric <= 0
    or (p_values->>'budget_percentage')::numeric not between 0 and 100
    or (p_values->>'overhead_percentage')::numeric not between 0 and 100 then
    raise exception 'Invalid project financial settings';
  end if;
  update public.projects set
    price = (p_values->>'price')::numeric,
    budget_percentage = (p_values->>'budget_percentage')::numeric,
    overhead_percentage = (p_values->>'overhead_percentage')::numeric
  where id = p_project_id returning * into v_new;
  insert into public.audit_logs(user_id, user_email, action, details) values (
    auth.uid(), auth.jwt()->>'email', 'project_financial_settings_updated',
    jsonb_build_object('project_id', p_project_id, 'old', jsonb_build_object('price',v_old.price,'budget_percentage',v_old.budget_percentage,'overhead_percentage',v_old.overhead_percentage), 'new', jsonb_build_object('price',v_new.price,'budget_percentage',v_new.budget_percentage,'overhead_percentage',v_new.overhead_percentage))
  );
  return jsonb_build_object('price',v_new.price,'budget_percentage',v_new.budget_percentage,'overhead_percentage',v_new.overhead_percentage);
end;
$$;

create or replace function public.update_realization_financial_settings(p_realization_id uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_old public.realizations%rowtype; v_new public.realizations%rowtype; v_margin numeric; v_overhead numeric;
begin
  if public.get_user_role() <> 'admin' then raise exception 'Admin role required'; end if;
  select * into v_old from public.realizations where id = p_realization_id for update;
  if not found then raise exception 'Realization not found'; end if;
  if not (p_values ?& array['contract_amount','profit_margin_percent','overhead_percent']) then raise exception 'All financial settings are required'; end if;
  v_margin := (p_values->>'profit_margin_percent')::numeric;
  v_overhead := (p_values->>'overhead_percent')::numeric;
  if (p_values->>'contract_amount')::numeric <= 0 or v_margin not between 0 and 100
    or v_overhead not between 0 and 100 or v_margin + v_overhead > 100 then
    raise exception 'Invalid realization financial settings';
  end if;
  update public.realizations set
    contract_amount = (p_values->>'contract_amount')::numeric,
    profit_margin_percent = v_margin,
    overhead_percent = v_overhead
  where id = p_realization_id returning * into v_new;
  insert into public.audit_logs(user_id, user_email, action, details) values (
    auth.uid(), auth.jwt()->>'email', 'realization_financial_settings_updated',
    jsonb_build_object('realization_id', p_realization_id, 'old', jsonb_build_object('contract_amount',v_old.contract_amount,'profit_margin_percent',v_old.profit_margin_percent,'overhead_percent',v_old.overhead_percent), 'new', jsonb_build_object('contract_amount',v_new.contract_amount,'profit_margin_percent',v_new.profit_margin_percent,'overhead_percent',v_new.overhead_percent))
  );
  return jsonb_build_object('contract_amount',v_new.contract_amount,'profit_margin_percent',v_new.profit_margin_percent,'overhead_percent',v_new.overhead_percent);
end;
$$;

revoke all on function public.update_project_financial_settings(uuid, jsonb) from public, anon;
revoke all on function public.update_realization_financial_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_project_financial_settings(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_realization_financial_settings(uuid, jsonb) to authenticated, service_role;
