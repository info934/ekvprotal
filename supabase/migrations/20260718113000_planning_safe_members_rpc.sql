begin;

create or replace function public.list_planning_members_safe(p_plan_id uuid)
returns table (
  id uuid,
  name text,
  email text,
  microsoft_calendar_email text,
  microsoft_calendar_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.planning_can_read_plan(p_plan_id) then
    raise exception 'Not allowed to read planning members';
  end if;

  return query
  select
    m.id,
    m.name,
    m.email,
    m.microsoft_calendar_email,
    coalesce(m.microsoft_calendar_enabled, true)
  from public.members m
  order by m.name nulls last, m.email nulls last;
end;
$$;

revoke all on function public.list_planning_members_safe(uuid) from public, anon;
grant execute on function public.list_planning_members_safe(uuid) to authenticated, service_role;

comment on function public.list_planning_members_safe(uuid) is
  'Returns only planning assignment and calendar identity fields after verifying access to the requested plan.';

commit;
