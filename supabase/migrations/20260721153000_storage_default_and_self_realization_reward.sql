create or replace function public.save_default_document_storage_connection(
  p_connection_id uuid,
  p_payload jsonb
)
returns public.document_storage_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.document_storage_connections;
  v_can_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_can_admin := public.get_user_role() = 'admin'
    or exists (
      select 1
      from public.role_permissions rp
      where rp.role = public.get_user_role()
        and rp.module = 'settings'
        and rp.can_admin = true
    );

  if not coalesce(v_can_admin, false) then
    raise exception 'Settings admin permission required';
  end if;

  lock table public.document_storage_connections in share row exclusive mode;

  update public.document_storage_connections
  set is_default = false,
      updated_at = now()
  where is_default = true;

  if p_connection_id is null then
    insert into public.document_storage_connections (
      provider,
      name,
      status,
      is_default,
      config,
      created_at,
      updated_at
    )
    values (
      coalesce(nullif(p_payload->>'provider', ''), 'sharepoint'),
      coalesce(nullif(p_payload->>'name', ''), 'EKV SharePoint'),
      coalesce(nullif(p_payload->>'status', ''), 'active'),
      true,
      coalesce(p_payload->'config', '{}'::jsonb),
      now(),
      now()
    )
    returning * into v_connection;
  else
    update public.document_storage_connections
    set provider = coalesce(nullif(p_payload->>'provider', ''), provider),
        name = coalesce(nullif(p_payload->>'name', ''), name),
        status = coalesce(nullif(p_payload->>'status', ''), status),
        is_default = true,
        config = coalesce(p_payload->'config', config),
        updated_at = now()
    where id = p_connection_id
    returning * into v_connection;

    if v_connection.id is null then
      raise exception 'Storage connection not found';
    end if;
  end if;

  return v_connection;
end;
$$;

revoke all on function public.save_default_document_storage_connection(uuid, jsonb) from public, anon;
grant execute on function public.save_default_document_storage_connection(uuid, jsonb) to authenticated, service_role;

create or replace function public.get_my_realization_reward(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_share_type text;
  v_share_value numeric := 0;
  v_summary jsonb;
  v_labor_summary jsonb;
  v_team_budget numeric := 0;
  v_total_revenue numeric := 0;
  v_grand_total_costs numeric := 0;
  v_gross_reward numeric := 0;
  v_sponsored_deduction numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_member_id := public.get_member_id();
  if v_member_id is null then
    raise exception 'Member profile not found';
  end if;

  select rps.share_type, coalesce(rps.share_value, 0)::numeric
  into v_share_type, v_share_value
  from public.realization_profit_shares rps
  where rps.realizace_id = p_realization_id
    and rps.member_id = v_member_id
  limit 1;

  if v_share_type is null then
    return jsonb_build_object(
      'realization_id', p_realization_id,
      'member_id', v_member_id,
      'has_reward', false,
      'share_type', null,
      'share_value', 0,
      'gross_reward', 0,
      'sponsored_labor_deduction', 0,
      'net_reward', 0
    );
  end if;

  v_summary := public.realization_financial_summary_admin_internal(p_realization_id);
  v_labor_summary := public.realization_labor_financial_summary_admin_internal(p_realization_id);

  v_total_revenue := coalesce((v_summary->>'total_revenue')::numeric, 0);
  v_grand_total_costs :=
    coalesce((v_summary->>'costs_after_paid_payouts')::numeric, 0)
    - coalesce((v_summary->>'paid_hourly_payouts')::numeric, 0)
    + coalesce((v_labor_summary->>'direct_project_cost')::numeric, 0);

  v_team_budget :=
    v_total_revenue
    - (v_total_revenue * coalesce((v_summary->>'profit_margin_percent')::numeric, 0) / 100)
    - (v_total_revenue * coalesce((v_summary->>'overhead_percent')::numeric, 0) / 100)
    - v_grand_total_costs;

  v_gross_reward := case
    when v_share_type = 'fixed' then v_share_value
    when v_share_type = 'percent' then greatest(0, v_team_budget) * (v_share_value / 100)
    else 0
  end;

  select coalesce(sum(lcl.sponsor_reward_deduction), 0)::numeric
  into v_sponsored_deduction
  from public.labor_cost_ledger lcl
  where lcl.realization_id = p_realization_id
    and lcl.sponsor_member_id = v_member_id
    and lcl.status <> 'reversed';

  return jsonb_build_object(
    'realization_id', p_realization_id,
    'member_id', v_member_id,
    'has_reward', true,
    'share_type', v_share_type,
    'share_value', v_share_value,
    'gross_reward', greatest(0, v_gross_reward),
    'sponsored_labor_deduction', greatest(0, coalesce(v_sponsored_deduction, 0)),
    'net_reward', greatest(0, v_gross_reward - coalesce(v_sponsored_deduction, 0))
  );
end;
$$;

revoke all on function public.get_my_realization_reward(uuid) from public, anon;
grant execute on function public.get_my_realization_reward(uuid) to authenticated, service_role;
