-- Split directory data from compensation data. The legacy members.hourly_rate
-- column is kept temporarily for compatibility, but is no longer selectable
-- through the authenticated REST role.

create table if not exists public.member_compensation_private (
  member_id uuid primary key references public.members(id) on delete cascade,
  hourly_rate numeric(12,2) not null default 0 check (hourly_rate >= 0),
  employer_burden_percent numeric(7,4) not null default 0 check (employer_burden_percent between 0 and 200),
  currency text not null default 'CZK' check (char_length(currency) = 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.member_compensation_private (member_id, hourly_rate)
select id, coalesce(hourly_rate, 0)
from public.members
on conflict (member_id) do update
set hourly_rate = excluded.hourly_rate;

alter table public.member_compensation_private enable row level security;

drop policy if exists "Member compensation visible to admin or self" on public.member_compensation_private;
create policy "Member compensation visible to admin or self"
on public.member_compensation_private
for select to authenticated
using (public.get_user_role() = 'admin' or member_id = public.get_member_id());

drop policy if exists "Member compensation managed by admin" on public.member_compensation_private;
create policy "Member compensation managed by admin"
on public.member_compensation_private
for all to authenticated
using (public.get_user_role() = 'admin')
with check (public.get_user_role() = 'admin');

grant select, insert, update, delete on public.member_compensation_private to authenticated;
grant all on public.member_compensation_private to service_role;

create or replace function public.sync_member_compensation_private()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_compensation_private (
    member_id, hourly_rate, updated_at, updated_by
  ) values (
    new.id, coalesce(new.hourly_rate, 0), now(), auth.uid()
  )
  on conflict (member_id) do update
  set hourly_rate = excluded.hourly_rate,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  return new;
end;
$$;

drop trigger if exists sync_member_compensation_private on public.members;
create trigger sync_member_compensation_private
after insert or update of hourly_rate on public.members
for each row execute function public.sync_member_compensation_private();

create or replace function public.get_member_compensation(p_member_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_target_member_id uuid := coalesce(p_member_id, public.get_member_id());
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_target_member_id is null then raise exception 'Member profile not found'; end if;
  if public.get_user_role() <> 'admin' and v_target_member_id <> v_current_member_id then
    raise exception 'Not allowed to read another member compensation';
  end if;

  select jsonb_build_object(
    'member_id', c.member_id,
    'hourly_rate', c.hourly_rate,
    'employer_burden_percent', c.employer_burden_percent,
    'currency', c.currency,
    'updated_at', c.updated_at
  ) into v_result
  from public.member_compensation_private c
  where c.member_id = v_target_member_id;

  return coalesce(v_result, jsonb_build_object(
    'member_id', v_target_member_id,
    'hourly_rate', 0,
    'employer_burden_percent', 0,
    'currency', 'CZK'
  ));
end;
$$;

create or replace function public.list_member_compensations_admin()
returns table (
  member_id uuid,
  hourly_rate numeric,
  employer_burden_percent numeric,
  currency text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to list member compensations';
  end if;
  return query
  select c.member_id, c.hourly_rate, c.employer_burden_percent, c.currency, c.updated_at
  from public.member_compensation_private c;
end;
$$;

revoke all on function public.get_member_compensation(uuid) from public, anon;
revoke all on function public.list_member_compensations_admin() from public, anon;
grant execute on function public.get_member_compensation(uuid) to authenticated, service_role;
grant execute on function public.list_member_compensations_admin() to authenticated, service_role;
revoke all on function public.sync_member_compensation_private() from public, anon, authenticated;

-- Remove table-level SELECT and re-grant only directory/profile columns. The
-- compensation column remains available solely through the scoped RPC above.
revoke select on table public.members from authenticated;
grant select (
  id, name, role_id, email, phone, created_at, auth_user_id,
  attendance_enabled, user_role, internal_note, languages, company,
  job_title, department, bio, avatar_url, language, notification_preferences
) on public.members to authenticated;

