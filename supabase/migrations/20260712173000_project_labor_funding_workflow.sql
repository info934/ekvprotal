-- Project/realization labor funding workflow.
-- Existing attendance remains direct-project funded. New assignments can fund hourly labor
-- from a specific team member reward without reducing the common team pool twice.

alter table public.project_members
  add column if not exists valid_from date not null default current_date,
  add column if not exists valid_to date,
  add column if not exists hourly_funding_mode text not null default 'direct_project',
  add column if not exists hourly_sponsor_member_id uuid references public.members(id) on delete restrict,
  add column if not exists hourly_sponsor_percent numeric not null default 100;

alter table public.project_members
  drop constraint if exists project_members_valid_period_check,
  add constraint project_members_valid_period_check check (valid_to is null or valid_to >= valid_from),
  drop constraint if exists project_members_hourly_funding_mode_check,
  add constraint project_members_hourly_funding_mode_check check (hourly_funding_mode in ('direct_project', 'member_reward')),
  drop constraint if exists project_members_hourly_sponsor_percent_check,
  add constraint project_members_hourly_sponsor_percent_check check (hourly_sponsor_percent between 0 and 100),
  drop constraint if exists project_members_hourly_sponsor_required_check,
  add constraint project_members_hourly_sponsor_required_check check (
    (hourly_funding_mode = 'direct_project' and hourly_sponsor_member_id is null)
    or (hourly_funding_mode = 'member_reward' and hourly_sponsor_member_id is not null and is_hourly = true)
  ),
  drop constraint if exists project_members_no_self_sponsor_check,
  add constraint project_members_no_self_sponsor_check check (hourly_sponsor_member_id is null or hourly_sponsor_member_id <> member_id);

alter table public.realizace_team_members
  add column if not exists is_hourly boolean not null default false,
  add column if not exists valid_from date not null default current_date,
  add column if not exists valid_to date,
  add column if not exists hourly_funding_mode text not null default 'direct_project',
  add column if not exists hourly_sponsor_member_id uuid references public.members(id) on delete restrict,
  add column if not exists hourly_sponsor_percent numeric not null default 100;

alter table public.realizace_team_members
  drop constraint if exists realizace_team_members_valid_period_check,
  add constraint realizace_team_members_valid_period_check check (valid_to is null or valid_to >= valid_from),
  drop constraint if exists realizace_team_members_hourly_funding_mode_check,
  add constraint realizace_team_members_hourly_funding_mode_check check (hourly_funding_mode in ('direct_project', 'member_reward')),
  drop constraint if exists realizace_team_members_hourly_sponsor_percent_check,
  add constraint realizace_team_members_hourly_sponsor_percent_check check (hourly_sponsor_percent between 0 and 100),
  drop constraint if exists realizace_team_members_hourly_sponsor_required_check,
  add constraint realizace_team_members_hourly_sponsor_required_check check (
    (hourly_funding_mode = 'direct_project' and hourly_sponsor_member_id is null)
    or (hourly_funding_mode = 'member_reward' and hourly_sponsor_member_id is not null and is_hourly = true)
  ),
  drop constraint if exists realizace_team_members_no_self_sponsor_check,
  add constraint realizace_team_members_no_self_sponsor_check check (hourly_sponsor_member_id is null or hourly_sponsor_member_id <> member_id);

create table if not exists public.member_hourly_rate_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  hourly_rate numeric(12,2) not null check (hourly_rate >= 0),
  employer_burden_percent numeric(7,4) not null default 0 check (employer_burden_percent between 0 and 200),
  currency text not null default 'CZK' check (char_length(currency) = 3),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint member_hourly_rate_history_valid_period_check check (valid_to is null or valid_to >= valid_from),
  unique (member_id, valid_from)
);

insert into public.member_hourly_rate_history (member_id, hourly_rate, currency, valid_from)
select m.id, m.hourly_rate, 'CZK', date '1900-01-01'
from public.members m
where coalesce(m.hourly_rate, 0) > 0
on conflict (member_id, valid_from) do nothing;

create or replace function public.sync_member_hourly_rate_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hourly_rate is not distinct from old.hourly_rate then return new; end if;

  update public.member_hourly_rate_history
  set valid_to = current_date - 1
  where member_id = new.id
    and valid_to is null
    and valid_from < current_date;

  insert into public.member_hourly_rate_history (
    member_id, hourly_rate, currency, valid_from, created_by
  ) values (
    new.id, coalesce(new.hourly_rate, 0), 'CZK', current_date, auth.uid()
  )
  on conflict (member_id, valid_from)
  do update set hourly_rate = excluded.hourly_rate, created_by = excluded.created_by;

  return new;
end;
$$;

drop trigger if exists sync_member_hourly_rate_history on public.members;
create trigger sync_member_hourly_rate_history
after update of hourly_rate on public.members
for each row execute function public.sync_member_hourly_rate_history();

create table if not exists public.labor_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('project', 'realization')),
  assignment_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text
);

create index if not exists idx_labor_assignment_audit_assignment
on public.labor_assignment_audit(scope_type, assignment_id, changed_at desc);

create or replace function public.audit_labor_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  insert into public.labor_assignment_audit (
    scope_type, assignment_id, action, old_data, new_data, changed_by, changed_by_email
  ) values (
    case when tg_table_name = 'project_members' then 'project' else 'realization' end,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op), v_old, v_new, auth.uid(), auth.jwt()->>'email'
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_project_labor_assignment on public.project_members;
create trigger audit_project_labor_assignment
after insert or update or delete on public.project_members
for each row execute function public.audit_labor_assignment_change();

drop trigger if exists audit_realization_labor_assignment on public.realizace_team_members;
create trigger audit_realization_labor_assignment
after insert or update or delete on public.realizace_team_members
for each row execute function public.audit_labor_assignment_change();

alter table public.attendance
  add column if not exists hourly_rate_snapshot numeric(12,2),
  add column if not exists employer_cost_snapshot numeric(14,2),
  add column if not exists funding_mode_snapshot text,
  add column if not exists sponsor_member_id_snapshot uuid references public.members(id) on delete restrict,
  add column if not exists sponsor_percent_snapshot numeric(7,4),
  add column if not exists financial_snapshot_at timestamptz;

alter table public.attendance
  drop constraint if exists attendance_funding_mode_snapshot_check,
  add constraint attendance_funding_mode_snapshot_check check (funding_mode_snapshot is null or funding_mode_snapshot in ('direct_project', 'member_reward')),
  drop constraint if exists attendance_sponsor_percent_snapshot_check,
  add constraint attendance_sponsor_percent_snapshot_check check (sponsor_percent_snapshot is null or sponsor_percent_snapshot between 0 and 100);

create table if not exists public.labor_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id) on delete restrict,
  attendance_submission_id uuid not null references public.attendance_submissions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  realization_id uuid references public.realizations(id) on delete restrict,
  work_date date not null,
  posting_month date not null,
  hours numeric(10,2) not null check (hours > 0 and hours <= 24),
  hourly_rate numeric(12,2) not null check (hourly_rate >= 0),
  currency text not null default 'CZK' check (char_length(currency) = 3),
  pay_amount numeric(14,2) not null check (pay_amount >= 0),
  employer_cost numeric(14,2) not null check (employer_cost >= 0),
  funding_mode text not null check (funding_mode in ('direct_project', 'member_reward')),
  sponsor_member_id uuid references public.members(id) on delete restrict,
  sponsor_percent numeric(7,4) not null default 0 check (sponsor_percent between 0 and 100),
  sponsor_reward_deduction numeric(14,2) not null default 0 check (sponsor_reward_deduction >= 0),
  project_cost_impact numeric(14,2) not null default 0 check (project_cost_impact >= 0),
  status text not null default 'accrued' check (status in ('accrued', 'payable', 'paid', 'reversed')),
  source_version integer not null default 1,
  reversal_of_id uuid references public.labor_cost_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint labor_cost_ledger_scope_check check ((project_id is not null)::integer + (realization_id is not null)::integer = 1),
  constraint labor_cost_ledger_sponsor_check check (
    (funding_mode = 'direct_project' and sponsor_member_id is null and sponsor_reward_deduction = 0)
    or (funding_mode = 'member_reward' and sponsor_member_id is not null)
  ),
  unique (attendance_id, attendance_submission_id, source_version)
);

create index if not exists idx_labor_cost_ledger_project_month on public.labor_cost_ledger(project_id, posting_month) where status <> 'reversed';
create index if not exists idx_labor_cost_ledger_realization_month on public.labor_cost_ledger(realization_id, posting_month) where status <> 'reversed';
create index if not exists idx_labor_cost_ledger_sponsor on public.labor_cost_ledger(sponsor_member_id, project_id, realization_id) where status <> 'reversed';
create index if not exists idx_member_hourly_rate_history_lookup on public.member_hourly_rate_history(member_id, valid_from, valid_to);

-- Historical rows predate funding assignments. Classify them conservatively as direct-project
-- so the new read model replaces, rather than duplicates, the legacy hourly cost.
with approved_attendance as (
  select
    a.*,
    s.id as submission_id,
    s.month_date,
    coalesce(rate.hourly_rate, m.hourly_rate, 0)::numeric as effective_rate,
    coalesce(rate.employer_burden_percent, 0)::numeric as burden_percent,
    coalesce(rate.currency, 'CZK') as currency,
    case
      when exists (
        select 1 from public.hourly_payout_requests h
        cross join lateral jsonb_array_elements(coalesce(h.attendance_snapshot, '[]'::jsonb)) item
        where nullif(item->>'attendance_id', '')::uuid = a.id and h.status = 'paid'
      ) then 'paid'
      when exists (
        select 1 from public.hourly_payout_requests h
        cross join lateral jsonb_array_elements(coalesce(h.attendance_snapshot, '[]'::jsonb)) item
        where nullif(item->>'attendance_id', '')::uuid = a.id and h.status in ('approved', 'invoice_uploaded')
      ) then 'payable'
      else 'accrued'
    end as ledger_status
  from public.attendance a
  join public.attendance_submissions s
    on s.member_id = a.member_id
    and a.date >= s.month_date
    and a.date < (s.month_date + interval '1 month')::date
    and s.status = 'approved'
  join public.members m on m.id = a.member_id
  left join lateral (
    select rh.hourly_rate, rh.employer_burden_percent, rh.currency
    from public.member_hourly_rate_history rh
    where rh.member_id = a.member_id
      and rh.valid_from <= a.date
      and (rh.valid_to is null or rh.valid_to >= a.date)
    order by rh.valid_from desc limit 1
  ) rate on true
  where a.project_id is not null or a.realizace_id is not null
)
insert into public.labor_cost_ledger (
  attendance_id, attendance_submission_id, member_id, project_id, realization_id,
  work_date, posting_month, hours, hourly_rate, currency, pay_amount, employer_cost,
  funding_mode, sponsor_percent, sponsor_reward_deduction, project_cost_impact, status
)
select
  aa.id, aa.submission_id, aa.member_id, aa.project_id, aa.realizace_id,
  aa.date, aa.month_date, aa.hours, aa.effective_rate, aa.currency,
  round(aa.hours * aa.effective_rate, 2),
  round(aa.hours * aa.effective_rate * (1 + aa.burden_percent / 100), 2),
  'direct_project', 0, 0,
  round(aa.hours * aa.effective_rate * (1 + aa.burden_percent / 100), 2),
  aa.ledger_status
from approved_attendance aa
where aa.effective_rate > 0
on conflict (attendance_id, attendance_submission_id, source_version) do nothing;

update public.attendance a
set hourly_rate_snapshot = l.hourly_rate,
    employer_cost_snapshot = l.employer_cost,
    funding_mode_snapshot = l.funding_mode,
    sponsor_member_id_snapshot = l.sponsor_member_id,
    sponsor_percent_snapshot = l.sponsor_percent,
    financial_snapshot_at = coalesce(a.financial_snapshot_at, l.created_at)
from public.labor_cost_ledger l
where l.attendance_id = a.id and l.source_version = 1;

create or replace function public.validate_labor_funding_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hourly_funding_mode = 'member_reward' then
    if tg_table_name = 'project_members' and not exists (
      select 1 from public.project_members sponsor
      where sponsor.project_id = new.project_id
        and sponsor.member_id = new.hourly_sponsor_member_id
        and sponsor.reward_type in ('fixed', 'percentage')
    ) then
      raise exception 'Hourly sponsor must be a rewarded member of the same project';
    end if;

    if tg_table_name = 'realizace_team_members' and not exists (
      select 1 from public.realization_profit_shares sponsor
      where sponsor.realizace_id = new.realizace_id
        and sponsor.member_id = new.hourly_sponsor_member_id
    ) then
      raise exception 'Hourly sponsor must have a reward share in the same realization';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_project_labor_funding_assignment on public.project_members;
create trigger validate_project_labor_funding_assignment
before insert or update of hourly_funding_mode, hourly_sponsor_member_id, hourly_sponsor_percent, is_hourly
on public.project_members for each row execute function public.validate_labor_funding_assignment();

drop trigger if exists validate_realization_labor_funding_assignment on public.realizace_team_members;
create trigger validate_realization_labor_funding_assignment
before insert or update of hourly_funding_mode, hourly_sponsor_member_id, hourly_sponsor_percent, is_hourly
on public.realizace_team_members for each row execute function public.validate_labor_funding_assignment();

create or replace function public.materialize_attendance_labor_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance record;
  v_rate numeric;
  v_burden numeric;
  v_currency text;
  v_mode text;
  v_sponsor uuid;
  v_sponsor_percent numeric;
  v_pay numeric;
  v_cost numeric;
  v_sponsor_deduction numeric;
  v_project_impact numeric;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for v_attendance in
      select a.*
      from public.attendance a
      where a.member_id = new.member_id
        and a.date >= new.month_date
        and a.date < (new.month_date + interval '1 month')::date
      for update
    loop
      select rh.hourly_rate, rh.employer_burden_percent, rh.currency
      into v_rate, v_burden, v_currency
      from public.member_hourly_rate_history rh
      where rh.member_id = v_attendance.member_id
        and rh.valid_from <= v_attendance.date
        and (rh.valid_to is null or rh.valid_to >= v_attendance.date)
      order by rh.valid_from desc
      limit 1;

      if v_rate is null then
        select coalesce(m.hourly_rate, 0), 0, 'CZK'
        into v_rate, v_burden, v_currency
        from public.members m where m.id = v_attendance.member_id;
      end if;

      if coalesce(v_rate, 0) <= 0 then
        raise exception 'No valid hourly rate for member % on %', v_attendance.member_id, v_attendance.date;
      end if;

      v_mode := 'direct_project';
      v_sponsor := null;
      v_sponsor_percent := 0;

      if v_attendance.project_id is not null then
        select pm.hourly_funding_mode, pm.hourly_sponsor_member_id, pm.hourly_sponsor_percent
        into v_mode, v_sponsor, v_sponsor_percent
        from public.project_members pm
        where pm.project_id = v_attendance.project_id
          and pm.member_id = v_attendance.member_id
          and pm.is_hourly = true
          and pm.valid_from <= v_attendance.date
          and (pm.valid_to is null or pm.valid_to >= v_attendance.date)
        order by pm.valid_from desc limit 1;
      elsif v_attendance.realizace_id is not null then
        select rtm.hourly_funding_mode, rtm.hourly_sponsor_member_id, rtm.hourly_sponsor_percent
        into v_mode, v_sponsor, v_sponsor_percent
        from public.realizace_team_members rtm
        where rtm.realizace_id = v_attendance.realizace_id
          and rtm.member_id = v_attendance.member_id
          and rtm.is_hourly = true
          and rtm.valid_from <= v_attendance.date
          and (rtm.valid_to is null or rtm.valid_to >= v_attendance.date)
        order by rtm.valid_from desc limit 1;
      end if;

      v_mode := coalesce(v_mode, 'direct_project');
      v_sponsor_percent := case when v_mode = 'member_reward' then coalesce(v_sponsor_percent, 100) else 0 end;
      v_pay := round(v_attendance.hours * v_rate, 2);
      v_cost := round(v_pay * (1 + coalesce(v_burden, 0) / 100), 2);
      v_sponsor_deduction := case when v_mode = 'member_reward' then round(v_cost * v_sponsor_percent / 100, 2) else 0 end;
      v_project_impact := greatest(0, v_cost - v_sponsor_deduction);

      update public.attendance
      set hourly_rate_snapshot = v_rate,
          employer_cost_snapshot = v_cost,
          funding_mode_snapshot = v_mode,
          sponsor_member_id_snapshot = v_sponsor,
          sponsor_percent_snapshot = v_sponsor_percent,
          financial_snapshot_at = now()
      where id = v_attendance.id;

      insert into public.labor_cost_ledger (
        attendance_id, attendance_submission_id, member_id, project_id, realization_id,
        work_date, posting_month, hours, hourly_rate, currency, pay_amount, employer_cost,
        funding_mode, sponsor_member_id, sponsor_percent, sponsor_reward_deduction,
        project_cost_impact, status, created_by
      ) values (
        v_attendance.id, new.id, v_attendance.member_id, v_attendance.project_id, v_attendance.realizace_id,
        v_attendance.date, new.month_date, v_attendance.hours, v_rate, coalesce(v_currency, 'CZK'), v_pay, v_cost,
        v_mode, v_sponsor, v_sponsor_percent, v_sponsor_deduction,
        v_project_impact, 'accrued', auth.uid()
      )
      on conflict (attendance_id, attendance_submission_id, source_version)
      do update set
        hours = excluded.hours,
        hourly_rate = excluded.hourly_rate,
        pay_amount = excluded.pay_amount,
        employer_cost = excluded.employer_cost,
        funding_mode = excluded.funding_mode,
        sponsor_member_id = excluded.sponsor_member_id,
        sponsor_percent = excluded.sponsor_percent,
        sponsor_reward_deduction = excluded.sponsor_reward_deduction,
        project_cost_impact = excluded.project_cost_impact,
        status = 'accrued',
        updated_at = now();
    end loop;
  elsif old.status = 'approved' and new.status <> 'approved' then
    update public.labor_cost_ledger
    set status = 'reversed', updated_at = now()
    where attendance_submission_id = new.id and status <> 'paid';
  end if;
  return new;
end;
$$;

drop trigger if exists materialize_attendance_labor_costs on public.attendance_submissions;
create trigger materialize_attendance_labor_costs
after update of status on public.attendance_submissions
for each row execute function public.materialize_attendance_labor_costs();

create or replace function public.sync_hourly_payout_labor_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved', 'invoice_uploaded') and old.status is distinct from new.status then
    update public.labor_cost_ledger l
    set status = 'payable', updated_at = now()
    where l.attendance_id in (
      select nullif(item->>'attendance_id', '')::uuid
      from jsonb_array_elements(coalesce(new.attendance_snapshot, '[]'::jsonb)) item
    ) and l.status = 'accrued';
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    update public.labor_cost_ledger l
    set status = 'paid', updated_at = now()
    where l.attendance_id in (
      select nullif(item->>'attendance_id', '')::uuid
      from jsonb_array_elements(coalesce(new.attendance_snapshot, '[]'::jsonb)) item
    ) and l.status in ('accrued', 'payable');
  elsif new.status in ('rejected', 'cancelled') and old.status is distinct from new.status then
    update public.labor_cost_ledger l
    set status = 'accrued', updated_at = now()
    where l.attendance_id in (
      select nullif(item->>'attendance_id', '')::uuid
      from jsonb_array_elements(coalesce(new.attendance_snapshot, '[]'::jsonb)) item
    ) and l.status = 'payable';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_hourly_payout_labor_ledger on public.hourly_payout_requests;
create trigger sync_hourly_payout_labor_ledger
after update of status on public.hourly_payout_requests
for each row execute function public.sync_hourly_payout_labor_ledger();

create or replace function public.project_labor_financial_summary(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Not allowed to read project labor financials';
  end if;
  select jsonb_build_object(
    'project_id', p_project_id,
    'total_employer_cost', coalesce(sum(employer_cost) filter (where status <> 'reversed'), 0),
    'direct_project_cost', coalesce(sum(project_cost_impact) filter (where status <> 'reversed'), 0),
    'sponsored_reward_deductions', coalesce(sum(sponsor_reward_deduction) filter (where status <> 'reversed'), 0),
    'accrued_amount', coalesce(sum(employer_cost) filter (where status = 'accrued'), 0),
    'payable_amount', coalesce(sum(employer_cost) filter (where status = 'payable'), 0),
    'paid_amount', coalesce(sum(employer_cost) filter (where status = 'paid'), 0),
    'sponsor_deductions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sponsor_member_id', grouped.sponsor_member_id,
        'sponsor_name', grouped.sponsor_name,
        'amount', grouped.amount
      ) order by grouped.sponsor_name)
      from (
        select sponsored.sponsor_member_id, sponsored_member.name as sponsor_name,
          sum(sponsored.sponsor_reward_deduction)::numeric as amount
        from public.labor_cost_ledger sponsored
        left join public.members sponsored_member on sponsored_member.id = sponsored.sponsor_member_id
        where sponsored.project_id = p_project_id
          and sponsored.sponsor_member_id is not null
          and sponsored.status <> 'reversed'
        group by sponsored.sponsor_member_id, sponsored_member.name
      ) grouped
    ), '[]'::jsonb)
  ) into v_result
  from public.labor_cost_ledger l
  where l.project_id = p_project_id;
  return coalesce(v_result, jsonb_build_object('project_id', p_project_id));
end;
$$;

create or replace function public.member_labor_reward_deduction(p_project_id uuid, p_member_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.sponsor_reward_deduction), 0)::numeric
  from public.labor_cost_ledger l
  where l.project_id = p_project_id
    and l.sponsor_member_id = p_member_id
    and l.status <> 'reversed'
    and (public.can_view_project_financials() or p_member_id = public.get_member_id());
$$;

create or replace function public.realization_labor_financial_summary(p_realization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.can_admin_module('realizace') or public.can_read_module('realizace')) then
    raise exception 'Not allowed to read realization labor financials';
  end if;
  select jsonb_build_object(
    'realization_id', p_realization_id,
    'total_employer_cost', coalesce(sum(employer_cost) filter (where status <> 'reversed'), 0),
    'direct_project_cost', coalesce(sum(project_cost_impact) filter (where status <> 'reversed'), 0),
    'sponsored_reward_deductions', coalesce(sum(sponsor_reward_deduction) filter (where status <> 'reversed'), 0),
    'accrued_amount', coalesce(sum(employer_cost) filter (where status = 'accrued'), 0),
    'payable_amount', coalesce(sum(employer_cost) filter (where status = 'payable'), 0),
    'paid_amount', coalesce(sum(employer_cost) filter (where status = 'paid'), 0),
    'sponsor_deductions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sponsor_member_id', grouped.sponsor_member_id,
        'sponsor_name', grouped.sponsor_name,
        'amount', grouped.amount
      ) order by grouped.sponsor_name)
      from (
        select sponsored.sponsor_member_id, sponsored_member.name as sponsor_name,
          sum(sponsored.sponsor_reward_deduction)::numeric as amount
        from public.labor_cost_ledger sponsored
        left join public.members sponsored_member on sponsored_member.id = sponsored.sponsor_member_id
        where sponsored.realization_id = p_realization_id
          and sponsored.sponsor_member_id is not null
          and sponsored.status <> 'reversed'
        group by sponsored.sponsor_member_id, sponsored_member.name
      ) grouped
    ), '[]'::jsonb)
  ) into v_result
  from public.labor_cost_ledger l
  where l.realization_id = p_realization_id;
  return coalesce(v_result, jsonb_build_object('realization_id', p_realization_id));
end;
$$;

alter table public.member_hourly_rate_history enable row level security;
alter table public.labor_cost_ledger enable row level security;
alter table public.labor_assignment_audit enable row level security;

drop policy if exists "Hourly rates visible to finance or self" on public.member_hourly_rate_history;
create policy "Hourly rates visible to finance or self" on public.member_hourly_rate_history
for select to authenticated using (public.can_view_project_financials() or member_id = public.get_member_id());

drop policy if exists "Hourly rates managed by finance" on public.member_hourly_rate_history;
create policy "Hourly rates managed by finance" on public.member_hourly_rate_history
for all to authenticated using (public.can_manage_project_financials()) with check (public.can_manage_project_financials());

drop policy if exists "Labor ledger visible to finance or participant" on public.labor_cost_ledger;
create policy "Labor ledger visible to finance or participant" on public.labor_cost_ledger
for select to authenticated using (
  public.can_view_project_financials()
  or member_id = public.get_member_id()
  or sponsor_member_id = public.get_member_id()
);

drop policy if exists "Labor assignment audit visible to finance" on public.labor_assignment_audit;
create policy "Labor assignment audit visible to finance" on public.labor_assignment_audit
for select to authenticated using (public.can_view_project_financials());

grant select, insert, update, delete on public.member_hourly_rate_history to authenticated;
grant select on public.labor_cost_ledger to authenticated;
grant select on public.labor_assignment_audit to authenticated;
grant all on public.member_hourly_rate_history, public.labor_cost_ledger, public.labor_assignment_audit to service_role;

revoke all on function public.validate_labor_funding_assignment() from public, anon, authenticated;
revoke all on function public.sync_member_hourly_rate_history() from public, anon, authenticated;
revoke all on function public.audit_labor_assignment_change() from public, anon, authenticated;
revoke all on function public.materialize_attendance_labor_costs() from public, anon, authenticated;
revoke all on function public.sync_hourly_payout_labor_ledger() from public, anon, authenticated;
revoke all on function public.project_labor_financial_summary(uuid) from public, anon;
revoke all on function public.realization_labor_financial_summary(uuid) from public, anon;
revoke all on function public.member_labor_reward_deduction(uuid, uuid) from public, anon;
grant execute on function public.project_labor_financial_summary(uuid) to authenticated, service_role;
grant execute on function public.realization_labor_financial_summary(uuid) to authenticated, service_role;
grant execute on function public.member_labor_reward_deduction(uuid, uuid) to authenticated, service_role;

-- Extend the safe project-member writer with funding and effective-date fields.
create or replace function public.save_project_member_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.project_members;
begin
  if not public.can_manage_project_financials() then raise exception 'Not allowed to save project member'; end if;
  if p_project_id is null then raise exception 'project_id is required'; end if;

  if p_assignment_id is null then
    insert into public.project_members (
      project_id, member_id, reward_percentage, reward_amount, reward_type, is_hourly,
      valid_from, valid_to, hourly_funding_mode, hourly_sponsor_member_id, hourly_sponsor_percent
    ) values (
      p_project_id,
      nullif(p_payload->>'member_id', '')::uuid,
      nullif(p_payload->>'reward_percentage', '')::numeric,
      nullif(p_payload->>'reward_amount', '')::numeric,
      nullif(p_payload->>'reward_type', ''),
      coalesce((p_payload->>'is_hourly')::boolean, false),
      coalesce(nullif(p_payload->>'valid_from', '')::date, current_date),
      nullif(p_payload->>'valid_to', '')::date,
      coalesce(nullif(p_payload->>'hourly_funding_mode', ''), 'direct_project'),
      nullif(p_payload->>'hourly_sponsor_member_id', '')::uuid,
      coalesce(nullif(p_payload->>'hourly_sponsor_percent', '')::numeric, 100)
    ) returning * into v_row;
  else
    update public.project_members pm set
      member_id = case when p_payload ? 'member_id' then nullif(p_payload->>'member_id', '')::uuid else pm.member_id end,
      reward_percentage = case when p_payload ? 'reward_percentage' then nullif(p_payload->>'reward_percentage', '')::numeric else pm.reward_percentage end,
      reward_amount = case when p_payload ? 'reward_amount' then nullif(p_payload->>'reward_amount', '')::numeric else pm.reward_amount end,
      reward_type = case when p_payload ? 'reward_type' then nullif(p_payload->>'reward_type', '') else pm.reward_type end,
      is_hourly = case when p_payload ? 'is_hourly' then coalesce((p_payload->>'is_hourly')::boolean, false) else pm.is_hourly end,
      valid_from = case when p_payload ? 'valid_from' then coalesce(nullif(p_payload->>'valid_from', '')::date, pm.valid_from) else pm.valid_from end,
      valid_to = case when p_payload ? 'valid_to' then nullif(p_payload->>'valid_to', '')::date else pm.valid_to end,
      hourly_funding_mode = case when p_payload ? 'hourly_funding_mode' then coalesce(nullif(p_payload->>'hourly_funding_mode', ''), 'direct_project') else pm.hourly_funding_mode end,
      hourly_sponsor_member_id = case when p_payload ? 'hourly_sponsor_member_id' then nullif(p_payload->>'hourly_sponsor_member_id', '')::uuid else pm.hourly_sponsor_member_id end,
      hourly_sponsor_percent = case when p_payload ? 'hourly_sponsor_percent' then coalesce(nullif(p_payload->>'hourly_sponsor_percent', '')::numeric, 100) else pm.hourly_sponsor_percent end
    where pm.id = p_assignment_id and pm.project_id = p_project_id
    returning * into v_row;
    if v_row.id is null then raise exception 'Project member assignment not found'; end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;

-- Preserve the original result shape while exposing funding metadata inside the member JSON.
create or replace function public.list_project_members_safe(p_project_id uuid)
returns table (
  id uuid, project_id uuid, member_id uuid, reward_percentage numeric, reward_amount numeric,
  reward_type text, is_hourly boolean, member jsonb
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_can_view_finance boolean := public.can_view_project_financials();
  v_current_member_id uuid := public.get_member_id();
begin
  if not public.can_access_project(p_project_id) then raise exception 'Not allowed to read this project team'; end if;
  return query
  select pm.id, pm.project_id, pm.member_id,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_percentage else null::numeric end,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_amount else null::numeric end,
    case when v_can_view_finance or pm.member_id = v_current_member_id then pm.reward_type else null::text end,
    coalesce(pm.is_hourly, false),
    case when m.id is null then null::jsonb else jsonb_build_object(
      'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
      'role', case when mr.id is null then null::jsonb else jsonb_build_object('id', mr.id, 'name', mr.name) end,
      'valid_from', pm.valid_from, 'valid_to', pm.valid_to,
      'hourly_funding_mode', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_funding_mode else null end,
      'hourly_sponsor_member_id', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_sponsor_member_id else null end,
      'hourly_sponsor_percent', case when v_can_view_finance or pm.member_id = v_current_member_id then pm.hourly_sponsor_percent else null end,
      'hourly_sponsor_name', case when v_can_view_finance or pm.member_id = v_current_member_id then sponsor.name else null end
    ) end
  from public.project_members pm
  left join public.members m on m.id = pm.member_id
  left join public.member_roles mr on mr.id = m.role_id
  left join public.members sponsor on sponsor.id = pm.hourly_sponsor_member_id
  where pm.project_id = p_project_id order by m.name;
end;
$$;

revoke all on function public.list_project_members_safe(uuid) from public, anon;
grant execute on function public.list_project_members_safe(uuid) to authenticated, service_role;

-- Authoritative project reward read model with accrued direct labor and sponsored deductions.
create or replace function public.get_member_project_rewards(p_member_id uuid default null)
returns table (
  member_id uuid, project_id uuid, project_name text, project_code text, project_status text,
  reward_type text, reward_percentage numeric, reward_fixed_amount numeric, is_hourly boolean,
  team_budget numeric, total_reward numeric, reserved_or_paid_amount numeric,
  paid_amount numeric, available_balance numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_current_member_id uuid;
  v_can_admin boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_current_member_id := public.get_member_id();
  v_can_admin := coalesce(public.get_user_role() = 'admin', false);
  if p_member_id is null and not v_can_admin then
    if v_current_member_id is null then raise exception 'Member profile not found'; end if;
    p_member_id := v_current_member_id;
  end if;
  if p_member_id is not null and p_member_id <> v_current_member_id and not v_can_admin then
    raise exception 'Not allowed to read project rewards for this member';
  end if;

  return query
  with project_cost_inputs as (
    select p.id as project_id, p.name as project_name, p.code as project_code, p.status as project_status,
      coalesce(p.price, 0)::numeric as price,
      coalesce(p.budget_percentage, 0)::numeric as budget_percentage,
      coalesce(p.overhead_percentage, 0)::numeric as overhead_percentage,
      coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)::numeric as subcontractor_costs,
      coalesce((select sum(pc.amount) from public.project_costs pc
        where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)::numeric as unassigned_direct_costs,
      coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)::numeric as allocated_overhead_costs,
      coalesce((select sum(pi.amount) from public.payout_items pi join public.payouts po on po.id = pi.payout_id
        where pi.project_id = p.id and po.status = 'paid'), 0)::numeric as paid_task_payouts,
      coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l
        where l.project_id = p.id and l.status <> 'reversed'), 0)::numeric as direct_labor_costs
    from public.projects p
  ),
  reward_base as (
    select pm.member_id, pci.project_id, pci.project_name, pci.project_code, pci.project_status,
      pm.reward_type, coalesce(pm.reward_percentage, 0)::numeric as reward_percentage,
      coalesce(pm.reward_amount, 0)::numeric as reward_fixed_amount,
      coalesce(pm.is_hourly, false) as is_hourly,
      ((pci.price * (pci.budget_percentage / 100))
        - (pci.price * (pci.budget_percentage / 100) * (pci.overhead_percentage / 100))
        - pci.subcontractor_costs - pci.unassigned_direct_costs - pci.allocated_overhead_costs
        - pci.paid_task_payouts - pci.direct_labor_costs)::numeric as team_budget,
      (
        coalesce((select sum(pc.amount) from public.project_costs pc
          where pc.project_id = pci.project_id and pc.member_id = pm.member_id
            and not coalesce(pc.is_attendance_cost, false)), 0)
        + coalesce((select sum(l.sponsor_reward_deduction) from public.labor_cost_ledger l
          where l.project_id = pci.project_id and l.sponsor_member_id = pm.member_id
            and l.status <> 'reversed'), 0)
      )::numeric as assigned_member_costs
    from public.project_members pm
    join project_cost_inputs pci on pci.project_id = pm.project_id
    where p_member_id is null or pm.member_id = p_member_id
  ),
  payout_sums as (
    select po.member_id, pi.project_id,
      coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded', 'paid')), 0)::numeric as reserved_or_paid_amount,
      coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
    from public.payout_items pi join public.payouts po on po.id = pi.payout_id
    where pi.project_id is not null and (p_member_id is null or po.member_id = p_member_id)
    group by po.member_id, pi.project_id
  ),
  calculated as (
    select rb.*,
      case when rb.reward_type = 'fixed' then least(rb.reward_fixed_amount, greatest(0, rb.team_budget))
        when rb.reward_type = 'percentage' then greatest(0, rb.team_budget) * (rb.reward_percentage / 100)
        else 0 end::numeric as gross_reward,
      coalesce(ps.reserved_or_paid_amount, 0)::numeric as reserved_or_paid_amount,
      coalesce(ps.paid_amount, 0)::numeric as paid_amount
    from reward_base rb left join payout_sums ps on ps.member_id = rb.member_id and ps.project_id = rb.project_id
  )
  select c.member_id, c.project_id, c.project_name, c.project_code, c.project_status,
    c.reward_type, c.reward_percentage, c.reward_fixed_amount, c.is_hourly, c.team_budget,
    greatest(0, c.gross_reward - c.assigned_member_costs) as total_reward,
    c.reserved_or_paid_amount, c.paid_amount,
    greatest(0, c.gross_reward - c.assigned_member_costs - c.reserved_or_paid_amount) as available_balance
  from calculated c order by c.project_code nulls last, c.project_name;
end;
$$;

revoke all on function public.get_member_project_rewards(uuid) from public, anon;
grant execute on function public.get_member_project_rewards(uuid) to authenticated, service_role;

create or replace function public.get_member_realization_rewards(
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
language plpgsql stable security definer set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.get_user_role() = 'admin', false);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_can_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read realization rewards for this member';
  end if;

  return query
  with shares as (
    select rps.realizace_id, rps.share_type, rps.share_value
    from public.realization_profit_shares rps where rps.member_id = p_member_id
  ),
  edit_items as (
    select pi.realization_id, coalesce(sum(pi.amount), 0)::numeric as amount
    from public.payout_items pi
    where p_edit_payout_id is not null and pi.payout_id = p_edit_payout_id and pi.realization_id is not null
    group by pi.realization_id
  ),
  reserved as (
    select pi.realization_id,
      coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded')), 0)::numeric as reserved_amount,
      coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_amount
    from public.payout_items pi join public.payouts po on po.id = pi.payout_id
    where pi.realization_id is not null and po.member_id = p_member_id
      and po.status in ('pending', 'approved', 'invoice_uploaded', 'paid')
      and (p_edit_payout_id is null or po.id <> p_edit_payout_id)
    group by pi.realization_id
  ),
  calculated as (
    select r.id, r.name, r.status,
      coalesce(r.contract_amount, 0)::numeric as base_contract_amount,
      coalesce(ec.sale_amount, 0)::numeric as extra_revenue,
      (coalesce(mc.amount, 0) + coalesce(ec.cost_amount, 0))::numeric as operational_costs,
      (coalesce(r.contract_amount, 0) + coalesce(ec.sale_amount, 0))::numeric as total_revenue,
      coalesce(r.profit_margin_percent, 0)::numeric as profit_margin_percent,
      coalesce(r.overhead_percent, 0)::numeric as overhead_percent,
      s.share_type, coalesce(s.share_value, 0)::numeric as share_value,
      coalesce(labor.direct_project_cost, 0)::numeric as direct_labor_cost,
      coalesce(labor.sponsored_deduction, 0)::numeric as sponsored_deduction,
      coalesce(res.reserved_amount, 0)::numeric as reserved_payouts,
      coalesce(res.paid_amount, 0)::numeric as paid_amount,
      coalesce(edit.amount, 0)::numeric as edit_amount
    from public.realizations r
    join shares s on s.realizace_id = r.id
    left join lateral (select coalesce(sum(amount), 0)::numeric as amount from public.realizace_costs where realizace_id = r.id) mc on true
    left join lateral (select coalesce(sum(cost_amount), 0)::numeric as cost_amount, coalesce(sum(sale_amount), 0)::numeric as sale_amount from public.realizace_extra_costs where realizace_id = r.id) ec on true
    left join lateral (
      select coalesce(sum(project_cost_impact), 0)::numeric as direct_project_cost,
        coalesce(sum(sponsor_reward_deduction) filter (where sponsor_member_id = p_member_id), 0)::numeric as sponsored_deduction
      from public.labor_cost_ledger where realization_id = r.id and status <> 'reversed'
    ) labor on true
    left join reserved res on res.realization_id = r.id
    left join edit_items edit on edit.realization_id = r.id
  ),
  budgets as (
    select c.*,
      (c.total_revenue * c.profit_margin_percent / 100)::numeric as profit_amount,
      (c.total_revenue * c.overhead_percent / 100)::numeric as overhead_amount,
      (c.total_revenue - (c.total_revenue * c.profit_margin_percent / 100)
        - (c.total_revenue * c.overhead_percent / 100) - c.operational_costs
        - c.direct_labor_cost - c.paid_amount)::numeric as team_budget
    from calculated c
  ),
  rewards as (
    select b.*,
      case when b.share_type = 'fixed' then least(b.share_value, greatest(0, b.team_budget))
        when b.share_type = 'percent' then greatest(0, b.team_budget * b.share_value / 100)
        else 0 end::numeric as gross_share
    from budgets b
  )
  select rw.id, rw.name, rw.status, rw.base_contract_amount, rw.extra_revenue,
    rw.operational_costs, rw.total_revenue, rw.profit_margin_percent, rw.overhead_percent,
    rw.profit_amount, rw.overhead_amount, rw.team_budget, rw.share_type, rw.share_value,
    rw.gross_share, rw.sponsored_deduction,
    greatest(0, rw.gross_share - rw.sponsored_deduction)::numeric as total_share,
    rw.reserved_payouts, rw.paid_amount,
    greatest(0, rw.gross_share - rw.sponsored_deduction - rw.reserved_payouts - rw.paid_amount + rw.edit_amount)::numeric as available_share
  from rewards rw order by rw.name;
end;
$$;

create or replace function public.get_payout_availability(p_member_id uuid, p_edit_payout_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.get_user_role() = 'admin', false);
  v_projects jsonb;
  v_realizations jsonb;
begin
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_can_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read payout availability for this member';
  end if;

  with edit_project_items as (
    select pi.project_id, coalesce(sum(pi.amount), 0)::numeric as amount
    from public.payout_items pi
    where p_edit_payout_id is not null and pi.payout_id = p_edit_payout_id and pi.project_id is not null
    group by pi.project_id
  )
  select coalesce(jsonb_agg(
    to_jsonb(p) || jsonb_build_object(
      'available_balance', coalesce(p.available_balance, 0) + coalesce(edit.amount, 0),
      'reserved_payouts', greatest(0, coalesce(p.reserved_or_paid_amount, 0) - coalesce(p.paid_amount, 0)),
      'paid_payouts', coalesce(p.paid_amount, 0)
    ) order by p.project_code
  ), '[]'::jsonb) into v_projects
  from public.get_member_project_rewards(p_member_id) p
  left join edit_project_items edit on edit.project_id = p.project_id
  where coalesce(p.available_balance, 0) + coalesce(edit.amount, 0) > 0.01
    and p.reward_type in ('fixed', 'percentage');

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status,
      'base_contract_amount', r.base_contract_amount, 'extra_revenue', r.extra_revenue,
      'operational_costs', r.operational_costs, 'total_costs', r.operational_costs,
      'total_revenue', r.total_revenue, 'profit_margin_percent', r.profit_margin_percent,
      'overhead_percent', r.overhead_percent, 'profit_amount', r.profit_amount,
      'overhead_amount', r.overhead_amount, 'team_budget', r.team_budget,
      'share_type', r.share_type, 'share_value', r.share_value,
      'gross_share', r.gross_share, 'sponsored_labor_deduction', r.sponsored_labor_deduction,
      'total_share', r.total_share, 'reserved_payouts', r.reserved_payouts,
      'paid_amount', r.paid_amount, 'reserved_or_paid_amount', r.reserved_payouts + r.paid_amount,
      'available_share', r.available_share,
      'availability_reason', case
        when r.team_budget <= 0 then 'Týmový rozpočet je nulový nebo záporný'
        when r.total_share <= 0 and r.sponsored_labor_deduction > 0 then 'Odměna byla vyčerpána prací týmu'
        when r.total_share <= 0 then 'Podíl vychází na 0 Kč'
        when r.available_share > 0 then 'Dostupné k žádosti'
        else 'Podíl je už rezervovaný nebo vyplacený' end
    ) order by r.name
  ), '[]'::jsonb) into v_realizations
  from public.get_member_realization_rewards(p_member_id, p_edit_payout_id) r
  where r.available_share > 0.01;

  return jsonb_build_object('projects', v_projects, 'realizations', v_realizations);
end;
$$;

revoke all on function public.get_member_realization_rewards(uuid, uuid) from public, anon;
revoke all on function public.get_payout_availability(uuid, uuid) from public, anon;
grant execute on function public.get_member_realization_rewards(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_payout_availability(uuid, uuid) to authenticated, service_role;
