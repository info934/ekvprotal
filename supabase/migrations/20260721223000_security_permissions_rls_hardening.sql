-- Security hardening: fail closed for anonymous users, narrow public token
-- workflows, and keep financial administration restricted to global admins.

create or replace function public.get_user_role()
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_user_role text;
begin
  if auth.uid() is null then return null; end if;
  select m.user_role into v_user_role
  from public.members m where m.auth_user_id = auth.uid() limit 1;
  return v_user_role;
end;
$$;

revoke all on function public.get_user_role() from public, anon;
grant execute on function public.get_user_role() to authenticated, service_role;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'can_read_module', 'can_edit_module', 'can_admin_module',
      'can_access_project', 'can_access_realization',
      'can_view_project_financials', 'can_view_realization_financials',
      'list_projects_safe', 'get_project_safe', 'get_user_projects',
      'list_realizations_safe', 'get_realization_safe',
      'get_project_order_reward', 'get_realization_financial_overview'
    ])
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end;
$$;

drop policy if exists "Enable read access for all users" on public.project_orders;
revoke all on table public.project_orders from anon;

create or replace function public.get_public_project_order(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order public.project_orders%rowtype; v_payload jsonb;
begin
  if nullif(trim(p_token), '') is null then raise exception 'Invalid order token'; end if;
  select po.* into v_order from public.project_orders po
  where po.unique_token = trim(p_token) limit 1;
  if not found then return null; end if;
  if v_order.status = 'pending' and v_order.expires_at <= now() then
    update public.project_orders set status = 'expired'
    where id = v_order.id and status = 'pending';
    v_order.status := 'expired';
  end if;
  select jsonb_build_object(
    'id', v_order.id, 'status', v_order.status,
    'expires_at', v_order.expires_at, 'completion_date', v_order.completion_date,
    'project_id', v_order.project_id, 'member_id', v_order.member_id,
    'projects', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code, 'brief', p.brief),
    'members', jsonb_build_object('id', m.id, 'name', m.name),
    'reward_amount', coalesce(r.reward_amount, 0)
  ) into v_payload
  from public.projects p
  join public.members m on m.id = v_order.member_id
  left join lateral (
    select por.reward_amount from public.get_project_order_reward(trim(p_token)) por limit 1
  ) r on true
  where p.id = v_order.project_id;
  return v_payload;
end;
$$;

create or replace function public.respond_public_project_order(p_token text, p_response text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text := lower(trim(coalesce(p_response, ''))); v_order public.project_orders%rowtype;
begin
  if v_status not in ('confirmed', 'rejected') then raise exception 'Unsupported order response'; end if;
  select po.* into v_order from public.project_orders po
  where po.unique_token = trim(p_token) for update;
  if not found then raise exception 'Order was not found'; end if;
  if v_order.status <> 'pending' then raise exception 'Order is no longer pending'; end if;
  if v_order.expires_at <= now() then
    update public.project_orders set status = 'expired' where id = v_order.id;
    return jsonb_build_object('id', v_order.id, 'status', 'expired');
  end if;
  update public.project_orders set status = v_status where id = v_order.id;
  return jsonb_build_object('id', v_order.id, 'status', v_status);
end;
$$;

revoke all on function public.get_public_project_order(text) from public;
revoke all on function public.respond_public_project_order(text, text) from public;
grant execute on function public.get_public_project_order(text) to anon, authenticated, service_role;
grant execute on function public.respond_public_project_order(text, text) to anon, authenticated, service_role;

revoke all on table public.subcontractor_orders from anon;
revoke all on table public.project_subcontractors from anon;

create or replace function public.get_public_subcontractor_order(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order public.subcontractor_orders%rowtype;
begin
  if nullif(trim(p_token), '') is null then return null; end if;
  select so.* into v_order from public.subcontractor_orders so
  where so.unique_token = trim(p_token) limit 1;
  if not found then return null; end if;
  if v_order.status = 'pending' and v_order.expires_at <= now() then
    update public.subcontractor_orders set status = 'expired'
    where id = v_order.id and status = 'pending';
    v_order.status := 'expired';
  end if;
  return (
    select jsonb_build_object(
      'id', v_order.id, 'project_id', v_order.project_id,
      'subject_id', v_order.subject_id, 'status', v_order.status,
      'expires_at', v_order.expires_at,
      'projects', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code),
      'subjects', jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address,
        'city', s.city, 'postal_code', s.postal_code, 'ico', s.ico, 'dic', s.dic),
      'project_subcontractor_details', jsonb_build_object(
        'scope_of_work', ps.scope_of_work, 'price', ps.price)
    )
    from public.projects p
    join public.subjects s on s.id = v_order.subject_id
    left join public.project_subcontractors ps
      on ps.project_id = v_order.project_id and ps.subject_id = v_order.subject_id
    where p.id = v_order.project_id
  );
end;
$$;

create or replace function public.respond_public_subcontractor_order(p_token text, p_response text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text := lower(trim(coalesce(p_response, ''))); v_order public.subcontractor_orders%rowtype;
begin
  if v_status not in ('confirmed', 'rejected') then raise exception 'Unsupported order response'; end if;
  select so.* into v_order from public.subcontractor_orders so
  where so.unique_token = trim(p_token) for update;
  if not found then raise exception 'Order was not found'; end if;
  if v_order.status <> 'pending' then raise exception 'Order is no longer pending'; end if;
  if v_order.expires_at <= now() then
    update public.subcontractor_orders set status = 'expired' where id = v_order.id;
    return jsonb_build_object('id', v_order.id, 'status', 'expired');
  end if;
  update public.subcontractor_orders set status = v_status where id = v_order.id;
  if v_status = 'confirmed' then
    update public.project_subcontractors set status = 'Objednáno'
    where project_id = v_order.project_id and subject_id = v_order.subject_id;
  end if;
  return jsonb_build_object('id', v_order.id, 'status', v_status);
end;
$$;

revoke all on function public.get_public_subcontractor_order(text) from public;
revoke all on function public.respond_public_subcontractor_order(text, text) from public;
grant execute on function public.get_public_subcontractor_order(text) to anon, authenticated, service_role;
grant execute on function public.respond_public_subcontractor_order(text, text) to anon, authenticated, service_role;

drop policy if exists "Enable all for authenticated users on order_templates" on public.order_templates;
drop policy if exists "Order templates read for authenticated users" on public.order_templates;
drop policy if exists "Order templates write for global admins" on public.order_templates;
create policy "Order templates read for authenticated users"
on public.order_templates for select to authenticated using (true);
create policy "Order templates write for global admins"
on public.order_templates for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
revoke all on table public.order_templates from anon;

drop policy if exists "Enable read for authenticated users on realizace_financials" on public.realizace_financials;
drop policy if exists "Realizace financials insert for admins or editors" on public.realizace_financials;
drop policy if exists "Realizace financials update for admins or editors" on public.realizace_financials;
drop policy if exists "Realizace financials delete for admins" on public.realizace_financials;
create policy "Realizace financials global admin access"
on public.realizace_financials for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');

drop policy if exists "Enable read for authenticated users on realizace_overhead" on public.realizace_overhead;
drop policy if exists "Realizace overhead insert for admins or editors" on public.realizace_overhead;
drop policy if exists "Realizace overhead update for admins or editors" on public.realizace_overhead;
drop policy if exists "Realizace overhead delete for admins" on public.realizace_overhead;
create policy "Realizace overhead global admin access"
on public.realizace_overhead for all to authenticated
using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');

-- Separate payout workflow administration from company-wide reward visibility.
-- The existing calculation remains private; this wrapper enforces self/global-admin scope.
alter function public.get_member_project_rewards(uuid)
  rename to get_member_project_rewards_private_20260721;

create function public.get_member_project_rewards(p_member_id uuid default null)
returns table (
  member_id uuid, project_id uuid, project_name text, project_code text, project_status text,
  reward_type text, reward_percentage numeric, reward_fixed_amount numeric, is_hourly boolean,
  team_budget numeric, total_reward numeric, reserved_or_paid_amount numeric,
  paid_amount numeric, available_balance numeric
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_is_global_admin boolean := public.get_user_role() = 'admin';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_id is null and not v_is_global_admin then p_member_id := v_current_member_id; end if;
  if not v_is_global_admin and p_member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to read project rewards for this member';
  end if;
  return query select * from public.get_member_project_rewards_private_20260721(p_member_id);
end;
$$;

alter function public.get_member_realization_rewards(uuid, uuid)
  rename to get_member_realization_rewards_private_20260721;

create function public.get_member_realization_rewards(
  p_member_id uuid,
  p_edit_payout_id uuid default null
)
returns table (
  id uuid, name text, status text, base_contract_amount numeric, extra_revenue numeric,
  operational_costs numeric, total_revenue numeric, profit_margin_percent numeric,
  overhead_percent numeric, profit_amount numeric, overhead_amount numeric, team_budget numeric,
  share_type text, share_value numeric, gross_share numeric, sponsored_labor_deduction numeric,
  total_share numeric, reserved_payouts numeric, paid_amount numeric, available_share numeric
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_is_global_admin boolean := public.get_user_role() = 'admin';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_is_global_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read realization rewards for this member';
  end if;
  return query
    select * from public.get_member_realization_rewards_private_20260721(p_member_id, p_edit_payout_id);
end;
$$;

revoke all on function public.get_member_project_rewards_private_20260721(uuid) from public, anon, authenticated;
revoke all on function public.get_member_realization_rewards_private_20260721(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_member_project_rewards_private_20260721(uuid) to service_role;
grant execute on function public.get_member_realization_rewards_private_20260721(uuid, uuid) to service_role;
revoke all on function public.get_member_project_rewards(uuid) from public, anon;
revoke all on function public.get_member_realization_rewards(uuid, uuid) from public, anon;
grant execute on function public.get_member_project_rewards(uuid) to authenticated, service_role;
grant execute on function public.get_member_realization_rewards(uuid, uuid) to authenticated, service_role;

drop policy if exists "Enable update for project members or admins" on public.documents;
create policy "Enable update for project members or admins"
on public.documents for update to authenticated
using (public.get_user_role() = 'admin' or exists (
  select 1 from public.project_members pm
  where pm.project_id = documents.project_id and pm.member_id = public.get_member_id()
))
with check (public.get_user_role() = 'admin' or exists (
  select 1 from public.project_members pm
  where pm.project_id = documents.project_id and pm.member_id = public.get_member_id()
));

drop policy if exists "Enable update for project members or admins" on public.project_costs;
create policy "Enable update for project members or admins"
on public.project_costs for update to authenticated
using (public.get_user_role() = 'admin' or exists (
  select 1 from public.project_members pm
  where pm.project_id = project_costs.project_id and pm.member_id = public.get_member_id()
))
with check (public.get_user_role() = 'admin' or exists (
  select 1 from public.project_members pm
  where pm.project_id = project_costs.project_id and pm.member_id = public.get_member_id()
));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
