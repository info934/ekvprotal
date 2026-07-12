-- Rollout safety for labor payouts and realization reward writes.

alter table public.labor_cost_ledger
  add column if not exists economic_project_cost numeric(14,2)
  generated always as (employer_cost) stored;

comment on column public.labor_cost_ledger.economic_project_cost is
  'Full economic labor cost. project_cost_impact is only the residual common-pool impact after sponsor deductions.';

create or replace function public.prevent_paid_attendance_submission_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' and new.status is distinct from 'approved' and exists (
    select 1
    from public.labor_cost_ledger l
    where l.attendance_submission_id = old.id
      and l.status = 'paid'
  ) then
    raise exception 'Paid attendance cannot be reopened. Create an audited correction instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_paid_attendance_submission_reopen on public.attendance_submissions;
create trigger prevent_paid_attendance_submission_reopen
before update of status on public.attendance_submissions
for each row execute function public.prevent_paid_attendance_submission_reopen();

revoke all on function public.prevent_paid_attendance_submission_reopen() from public, anon, authenticated;

create or replace function public.create_hourly_payout_request(
  p_member_id uuid,
  p_payout_month integer,
  p_payout_year integer,
  p_request_type text default 'regular',
  p_parent_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_is_admin boolean := coalesce(public.get_user_role() = 'admin', false);
  v_month_start date;
  v_total_hours numeric;
  v_total_amount numeric;
  v_weighted_rate numeric;
  v_breakdown jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_request public.hourly_payout_requests%rowtype;
begin
  if p_payout_month not between 1 and 12 then
    raise exception 'Invalid payout month';
  end if;
  if coalesce(p_request_type, 'regular') <> 'regular' then
    raise exception 'Supplements and corrections require the audited ledger correction workflow';
  end if;
  if not v_is_admin and p_member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to create hourly payout for this member';
  end if;

  v_month_start := make_date(p_payout_year, p_payout_month, 1);
  perform pg_advisory_xact_lock(hashtext('hourly-payout:' || p_member_id::text || ':' || v_month_start::text));

  if exists (
    select 1 from public.hourly_payout_requests h
    where h.member_id = p_member_id
      and h.payout_month = p_payout_month
      and h.payout_year = p_payout_year
      and coalesce(h.request_type, 'regular') = 'regular'
      and h.status in ('pending', 'approved', 'invoice_uploaded', 'paid')
  ) then
    raise exception 'Regular hourly payout already exists for this member and month';
  end if;

  if not exists (
    select 1 from public.attendance_submissions s
    where s.member_id = p_member_id
      and s.month_date = v_month_start
      and s.status = 'approved'
  ) then
    raise exception 'Hourly payout can be requested only for an approved attendance month';
  end if;

  select coalesce(sum(l.hours), 0), coalesce(sum(l.pay_amount), 0)
  into v_total_hours, v_total_amount
  from public.labor_cost_ledger l
  where l.member_id = p_member_id
    and l.posting_month = v_month_start
    and l.status = 'accrued';

  if v_total_hours <= 0 or v_total_amount <= 0 then
    raise exception 'No accrued labor ledger entries found for payout month';
  end if;

  v_weighted_rate := round(v_total_amount / nullif(v_total_hours, 0), 2);

  select coalesce(jsonb_object_agg(scope_name, scope_hours), '{}'::jsonb)
  into v_breakdown
  from (
    select coalesce(p.name, r.name, 'Nezařazeno') scope_name, sum(l.hours)::numeric scope_hours
    from public.labor_cost_ledger l
    left join public.projects p on p.id = l.project_id
    left join public.realizations r on r.id = l.realization_id
    where l.member_id = p_member_id
      and l.posting_month = v_month_start
      and l.status = 'accrued'
    group by coalesce(p.name, r.name, 'Nezařazeno')
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ledger_id', l.id,
    'attendance_id', l.attendance_id,
    'date', l.work_date,
    'hours', l.hours,
    'hourly_rate', l.hourly_rate,
    'pay_amount', l.pay_amount,
    'currency', l.currency,
    'project_id', l.project_id,
    'realization_id', l.realization_id,
    'funding_mode', l.funding_mode
  ) order by l.work_date, l.attendance_id), '[]'::jsonb)
  into v_snapshot
  from public.labor_cost_ledger l
  where l.member_id = p_member_id
    and l.posting_month = v_month_start
    and l.status = 'accrued';

  v_hash := md5(v_snapshot::text || ':' || v_total_hours::text || ':' || v_total_amount::text);

  insert into public.hourly_payout_requests (
    member_id, project_id, hours, hourly_rate, total_amount, status, notes,
    payout_month, payout_year, total_hours, breakdown, attendance_snapshot,
    calculation_hash, request_type, parent_request_id, snapshot_total_hours,
    snapshot_total_amount
  ) values (
    p_member_id, null, v_total_hours, v_weighted_rate, v_total_amount, 'pending',
    'Vygenerováno ze schváleného pracovního ledgeru za ' || p_payout_month || '/' || p_payout_year,
    p_payout_month, p_payout_year, v_total_hours, v_breakdown, v_snapshot,
    v_hash, 'regular', null, v_total_hours, v_total_amount
  ) returning * into v_request;

  perform public.log_workflow_audit(
    'hourly_payout_request_created_from_labor_ledger',
    jsonb_build_object(
      'request_id', v_request.id,
      'member_id', p_member_id,
      'posting_month', v_month_start,
      'total_hours', v_total_hours,
      'total_amount', v_total_amount,
      'calculation_hash', v_hash
    )
  );

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.create_hourly_payout_request(uuid, integer, integer, text, uuid) from public, anon;
grant execute on function public.create_hourly_payout_request(uuid, integer, integer, text, uuid) to authenticated, service_role;

create or replace function public.replace_realization_profit_shares(
  p_realization_id uuid,
  p_shares jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  if not exists (select 1 from public.realizations r where r.id = p_realization_id for update) then
    raise exception 'Realization not found';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      as x(member_id uuid, share_type text, share_value numeric, note text)
    where x.member_id is null
      or x.share_type not in ('percent', 'fixed')
      or x.share_value is null
      or x.share_value < 0
  ) then
    raise exception 'Invalid realization reward row';
  end if;
  if (
    select coalesce(sum(x.share_value), 0)
    from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
      as x(member_id uuid, share_type text, share_value numeric, note text)
    where x.share_type = 'percent'
  ) > 100 then
    raise exception 'Percentage reward total cannot exceed 100 percent';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rps) order by rps.created_at), '[]'::jsonb)
  into v_before
  from public.realization_profit_shares rps
  where rps.realizace_id = p_realization_id;

  delete from public.realization_profit_shares where realizace_id = p_realization_id;
  insert into public.realization_profit_shares (realizace_id, member_id, share_type, share_value, note)
  select p_realization_id, x.member_id, x.share_type, x.share_value, nullif(x.note, '')
  from jsonb_to_recordset(coalesce(p_shares, '[]'::jsonb))
    as x(member_id uuid, share_type text, share_value numeric, note text);

  select coalesce(jsonb_agg(to_jsonb(rps) order by rps.created_at), '[]'::jsonb)
  into v_after
  from public.realization_profit_shares rps
  where rps.realizace_id = p_realization_id;

  perform public.log_workflow_audit(
    'realization_profit_shares_replaced',
    jsonb_build_object('realization_id', p_realization_id, 'before', v_before, 'after', v_after)
  );
  return jsonb_build_object('realization_id', p_realization_id, 'shares', v_after);
end;
$$;

revoke all on function public.replace_realization_profit_shares(uuid, jsonb) from public, anon;
grant execute on function public.replace_realization_profit_shares(uuid, jsonb) to authenticated, service_role;

-- Existing editor policies are too broad for compensation data. Reads remain
-- admin-or-self; all direct writes are admin-only and the UI uses the atomic RPC.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'realization_profit_shares'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.realization_profit_shares', p.policyname);
  end loop;
end $$;

create policy "Realization profit shares admin write"
on public.realization_profit_shares
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

create or replace function public.protect_labor_assignment_financial_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if public.get_user_role() = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce((v_new->>'is_hourly')::boolean, false)
      or nullif(v_new->>'hourly_sponsor_member_id', '') is not null
      or coalesce((v_new->>'hourly_sponsor_percent')::numeric, 0) <> 0
      or (tg_table_name = 'project_members' and (
        nullif(v_new->>'reward_type', '') is not null
        or coalesce((v_new->>'reward_percentage')::numeric, 0) <> 0
        or coalesce((v_new->>'reward_amount')::numeric, 0) <> 0
      ))
    then raise exception 'Admin role required to configure compensation'; end if;
  elsif coalesce((v_new->>'is_hourly')::boolean, false) is distinct from coalesce((v_old->>'is_hourly')::boolean, false)
    or v_new->>'hourly_funding_mode' is distinct from v_old->>'hourly_funding_mode'
    or v_new->>'hourly_sponsor_member_id' is distinct from v_old->>'hourly_sponsor_member_id'
    or v_new->>'hourly_sponsor_percent' is distinct from v_old->>'hourly_sponsor_percent'
    or (tg_table_name = 'project_members' and (
      v_new->>'reward_type' is distinct from v_old->>'reward_type'
      or v_new->>'reward_percentage' is distinct from v_old->>'reward_percentage'
      or v_new->>'reward_amount' is distinct from v_old->>'reward_amount'
    ))
  then raise exception 'Admin role required to configure compensation';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_project_member_compensation on public.project_members;
create trigger protect_project_member_compensation
before insert or update on public.project_members
for each row execute function public.protect_labor_assignment_financial_fields();

drop trigger if exists protect_realization_member_compensation on public.realizace_team_members;
create trigger protect_realization_member_compensation
before insert or update on public.realizace_team_members
for each row execute function public.protect_labor_assignment_financial_fields();

revoke all on function public.protect_labor_assignment_financial_fields() from public, anon, authenticated;

-- Keep general project editing available while filtering financial values from
-- the RPC response. Team compensation and subcontractor amounts are admin-only.
alter function public.save_project_safe(uuid, jsonb, text) rename to save_project_safe_internal;
revoke all on function public.save_project_safe_internal(uuid, jsonb, text) from public, anon, authenticated;

create function public.save_project_safe(
  p_project_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_next_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  v_result := public.save_project_safe_internal(p_project_id, p_payload, p_next_status);
  if public.get_user_role() <> 'admin' then
    v_result := v_result - array['price', 'budget_percentage', 'overhead_percentage'];
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_project_safe(uuid, jsonb, text) from public, anon;
grant execute on function public.save_project_safe(uuid, jsonb, text) to authenticated, service_role;

alter function public.save_project_member_safe(uuid, uuid, jsonb) rename to save_project_member_safe_admin_internal;
revoke all on function public.save_project_member_safe_admin_internal(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.save_project_member_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project compensation assignments';
  end if;
  return public.save_project_member_safe_admin_internal(p_project_id, p_assignment_id, p_payload);
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;

alter function public.save_project_subcontractor_safe(uuid, uuid, jsonb) rename to save_project_subcontractor_safe_admin_internal;
revoke all on function public.save_project_subcontractor_safe_admin_internal(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.save_project_subcontractor_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project subcontractor amounts';
  end if;
  return public.save_project_subcontractor_safe_admin_internal(p_project_id, p_assignment_id, p_payload);
end;
$$;

revoke all on function public.save_project_subcontractor_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_subcontractor_safe(uuid, uuid, jsonb) to authenticated, service_role;

revoke select on table public.project_subcontractors from authenticated;
grant select (id, project_id, scope_of_work, status, created_at, subject_id)
on public.project_subcontractors to authenticated;

create or replace function public.list_subject_project_subcontractors_admin(p_subject_id uuid)
returns table (
  id uuid,
  project_id uuid,
  subject_id uuid,
  scope_of_work text,
  status text,
  price numeric,
  projects jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to read subcontractor amounts';
  end if;
  return query
  select ps.id, ps.project_id, ps.subject_id, ps.scope_of_work, ps.status, ps.price,
    jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code)
  from public.project_subcontractors ps
  join public.projects p on p.id = ps.project_id
  where ps.subject_id = p_subject_id
  order by p.code, p.name;
end;
$$;

revoke all on function public.list_subject_project_subcontractors_admin(uuid) from public, anon;
grant execute on function public.list_subject_project_subcontractors_admin(uuid) to authenticated, service_role;
