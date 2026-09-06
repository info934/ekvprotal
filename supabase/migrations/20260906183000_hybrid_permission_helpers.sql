-- Keep every legacy RLS policy and RPC that calls can_*_module aligned with
-- the effective role + per-user override calculated by has_permission().

create or replace function public.can_read_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_module, 'can_read');
$$;

create or replace function public.can_edit_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_module, 'can_edit');
$$;

create or replace function public.can_admin_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(p_module, 'can_admin');
$$;

revoke all on function public.can_read_module(text) from public, anon;
revoke all on function public.can_edit_module(text) from public, anon;
revoke all on function public.can_admin_module(text) from public, anon;
grant execute on function public.can_read_module(text) to authenticated, service_role;
grant execute on function public.can_edit_module(text) to authenticated, service_role;
grant execute on function public.can_admin_module(text) to authenticated, service_role;
