-- Fix production lint findings discovered immediately after the security rollout.

begin;

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
      'subjects', jsonb_build_object(
        'id', s.id, 'name', s.name, 'address', s.address,
        'city', null, 'postal_code', null, 'ico', s.ico, 'dic', s.dic
      ),
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

do $repair$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_member_realization_rewards_private_20260721'
    and pg_get_function_identity_arguments(p.oid) = 'p_member_id uuid, p_edit_payout_id uuid';

  if v_definition is null then
    raise exception 'Private realization reward function was not found';
  end if;

  v_repaired := regexp_replace(
    v_definition,
    'from public\.payouts\s+where id = p_edit_payout_id',
    E'from public.payouts po\n    where po.id = p_edit_payout_id'
  );

  if v_repaired = v_definition then
    raise exception 'Expected ambiguous payout lookup was not found';
  end if;

  execute v_repaired;
end;
$repair$;

commit;
