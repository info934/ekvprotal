-- Financial privacy boundary:
-- * only admin can read company-wide/project-wide financial amounts;
-- * authenticated members can read only their own compensation and payouts;
-- * project/realization membership never grants access to another person's amounts.

create or replace function public.can_view_project_financials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_user_role() = 'admin', false);
$$;

revoke all on function public.can_view_project_financials() from public, anon;
grant execute on function public.can_view_project_financials() to authenticated, service_role;

create or replace function public.can_view_realization_financials()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_user_role() = 'admin', false);
$$;

revoke all on function public.can_view_realization_financials() from public, anon;
grant execute on function public.can_view_realization_financials() to authenticated, service_role;

-- Keep the existing full summary implementation as a private implementation detail.
alter function public.project_financial_summary(uuid) rename to project_financial_summary_admin_internal;
alter function public.realization_financial_summary(uuid) rename to realization_financial_summary_admin_internal;

revoke all on function public.project_financial_summary_admin_internal(uuid) from public, anon, authenticated;
revoke all on function public.realization_financial_summary_admin_internal(uuid) from public, anon, authenticated;

create function public.project_financial_summary(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read project financial summary';
  end if;
  return public.project_financial_summary_admin_internal(p_project_id);
end;
$$;

create function public.realization_financial_summary(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read realization financial summary';
  end if;
  return public.realization_financial_summary_admin_internal(p_realization_id);
end;
$$;

revoke all on function public.project_financial_summary(uuid) from public, anon;
revoke all on function public.realization_financial_summary(uuid) from public, anon;
grant execute on function public.project_financial_summary(uuid) to authenticated, service_role;
grant execute on function public.realization_financial_summary(uuid) to authenticated, service_role;

-- Full labor summaries contain amounts for multiple people and are admin-only.
alter function public.project_labor_financial_summary(uuid) rename to project_labor_financial_summary_admin_internal;
alter function public.realization_labor_financial_summary(uuid) rename to realization_labor_financial_summary_admin_internal;

revoke all on function public.project_labor_financial_summary_admin_internal(uuid) from public, anon, authenticated;
revoke all on function public.realization_labor_financial_summary_admin_internal(uuid) from public, anon, authenticated;

create function public.project_labor_financial_summary(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read project labor summary';
  end if;
  return public.project_labor_financial_summary_admin_internal(p_project_id);
end;
$$;

create function public.realization_labor_financial_summary(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read realization labor summary';
  end if;
  return public.realization_labor_financial_summary_admin_internal(p_realization_id);
end;
$$;

revoke all on function public.project_labor_financial_summary(uuid) from public, anon;
revoke all on function public.realization_labor_financial_summary(uuid) from public, anon;
grant execute on function public.project_labor_financial_summary(uuid) to authenticated, service_role;
grant execute on function public.realization_labor_financial_summary(uuid) to authenticated, service_role;

-- Raw ledger rows expose the worker's rate and pay. Sponsors receive their own
-- aggregate deduction through reward read models, never another worker's row.
drop policy if exists "Labor ledger visible to finance or participant" on public.labor_cost_ledger;
drop policy if exists "Labor ledger visible to admin or worker" on public.labor_cost_ledger;
create policy "Labor ledger visible to admin or worker"
on public.labor_cost_ledger
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

drop policy if exists "Hourly rates visible to finance or self" on public.member_hourly_rate_history;
drop policy if exists "Hourly rates visible to admin or self" on public.member_hourly_rate_history;
create policy "Hourly rates visible to admin or self"
on public.member_hourly_rate_history
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

drop policy if exists "Hourly rates managed by finance" on public.member_hourly_rate_history;
drop policy if exists "Hourly rates managed by admin" on public.member_hourly_rate_history;
create policy "Hourly rates managed by admin"
on public.member_hourly_rate_history
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

drop policy if exists "Labor assignment audit visible to finance" on public.labor_assignment_audit;
drop policy if exists "Labor assignment audit visible to admin" on public.labor_assignment_audit;
create policy "Labor assignment audit visible to admin"
on public.labor_assignment_audit
for select to authenticated
using (public.get_user_role() = 'admin');

-- Reward configuration is private. A member can read only their own row.
drop policy if exists "Project members read own or project finance" on public.project_members;
drop policy if exists "Project members read own or admin" on public.project_members;
create policy "Project members read own or admin"
on public.project_members
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

drop policy if exists "Realization profit shares read access" on public.realization_profit_shares;
drop policy if exists "Realization profit shares read own or admin" on public.realization_profit_shares;
create policy "Realization profit shares read own or admin"
on public.realization_profit_shares
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

-- Realization operating costs are company-wide amounts. Legacy policies allowed
-- every authenticated user to read and write them.
drop policy if exists "Allow all authenticated to read realizace costs" on public.realizace_costs;
drop policy if exists "Allow authenticated to manage realizace costs" on public.realizace_costs;
drop policy if exists "Realization costs admin access" on public.realizace_costs;
create policy "Realization costs admin access"
on public.realizace_costs
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

drop policy if exists "Realizace extra costs read access" on public.realizace_extra_costs;
drop policy if exists "Realizace extra costs insert access" on public.realizace_extra_costs;
drop policy if exists "Realizace extra costs update access" on public.realizace_extra_costs;
drop policy if exists "Realizace extra costs delete access" on public.realizace_extra_costs;
drop policy if exists "Realization extra costs admin access" on public.realizace_extra_costs;
create policy "Realization extra costs admin access"
on public.realizace_extra_costs
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

-- Payout administrators other than admin may manage workflow through dedicated
-- server functions, but direct reads of another person's amount are forbidden.
drop policy if exists "Enable read for own payouts or payout admins" on public.payouts;
drop policy if exists "Enable read for own payouts or admins" on public.payouts;
create policy "Enable read for own payouts or admins"
on public.payouts
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

drop policy if exists "Enable read for own payout items or payout admins" on public.payout_items;
drop policy if exists "Enable read for own payout items or admins" on public.payout_items;
create policy "Enable read for own payout items or admins"
on public.payout_items
for select to authenticated
using (
  public.get_user_role() = 'admin'
  or exists (
    select 1 from public.payouts p
    where p.id = payout_items.payout_id and p.member_id = public.get_member_id()
  )
);

drop policy if exists "Enable read for own hourly requests or payout admins" on public.hourly_payout_requests;
drop policy if exists "Enable read for own hourly requests or admins" on public.hourly_payout_requests;
create policy "Enable read for own hourly requests or admins"
on public.hourly_payout_requests
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

-- Non-admin users may update their normal profile fields but cannot alter their
-- own hourly rate or role through the REST table endpoint.
create or replace function public.protect_member_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role() <> 'admin' and (
    new.hourly_rate is distinct from old.hourly_rate
    or new.user_role is distinct from old.user_role
    or new.role_id is distinct from old.role_id
  ) then
    raise exception 'Admin role required to change member compensation or role';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_member_financial_columns on public.members;
create trigger protect_member_financial_columns
before update on public.members
for each row execute function public.protect_member_financial_columns();

-- Financial values of projects and realizations cannot be changed by editors.
create or replace function public.protect_scope_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role() = 'admin' then return new; end if;

  if tg_op = 'INSERT' then
    if tg_table_name = 'projects' and (
      coalesce(new.price, 0) <> 0
      or coalesce(new.budget_percentage, 0) <> 0
      or coalesce(new.overhead_percentage, 0) <> 0
    ) then
      raise exception 'Admin role required to set project financial values';
    end if;
    if tg_table_name = 'realizations' and (
      coalesce(new.contract_amount, 0) <> 0
      or coalesce(new.profit_margin_percent, 0) <> 0
      or coalesce(new.overhead_percent, 0) <> 0
    ) then
      raise exception 'Admin role required to set realization financial values';
    end if;
    return new;
  end if;

  if tg_table_name = 'projects' and (
    new.price is distinct from old.price
    or new.budget_percentage is distinct from old.budget_percentage
    or new.overhead_percentage is distinct from old.overhead_percentage
  ) then
    raise exception 'Admin role required to change project financial values';
  end if;

  if tg_table_name = 'realizations' and (
    new.contract_amount is distinct from old.contract_amount
    or new.profit_margin_percent is distinct from old.profit_margin_percent
    or new.overhead_percent is distinct from old.overhead_percent
  ) then
    raise exception 'Admin role required to change realization financial values';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_financial_columns on public.projects;
create trigger protect_project_financial_columns
before insert or update on public.projects
for each row execute function public.protect_scope_financial_columns();

drop trigger if exists protect_realization_financial_columns on public.realizations;
create trigger protect_realization_financial_columns
before insert or update on public.realizations
for each row execute function public.protect_scope_financial_columns();

revoke all on function public.protect_member_financial_columns() from public, anon, authenticated;
revoke all on function public.protect_scope_financial_columns() from public, anon, authenticated;

-- Column privileges close the REST escape hatch. Admin financial reads continue
-- through the guarded SECURITY DEFINER read models above.
revoke select on table public.projects from authenticated;
grant select (
  id, name, code, status, created_at, type, created_by_member_id,
  completion_date, brief, template_id, start_date, shared_drive_link,
  stage_id, location, client_internal_ref, is_priority, location_coordinates,
  brief_editable, investor_id, client_id, crm_opportunity_id
) on public.projects to authenticated;

revoke select on table public.realizations from authenticated;
grant select (
  id, name, location_address, location_gps, type, status, start_date,
  created_at, investor_id, lead_person_id, team_members, updated_at,
  planned_end_date, actual_end_date, linked_project_id, crm_opportunity_id
) on public.realizations to authenticated;
