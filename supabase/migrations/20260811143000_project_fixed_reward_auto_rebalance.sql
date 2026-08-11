-- Reserve fixed project rewards first and proportionally rebalance existing
-- percentage assignments when the caller explicitly requests it.

create or replace function public.save_project_member_safe(
  p_project_id uuid,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_existing public.project_members;
  v_reward_type text;
  v_reward_amount numeric := 0;
  v_pool numeric := 0;
  v_existing_fixed_total numeric := 0;
  v_percentage_total numeric := 0;
  v_target_percentage_total numeric := 0;
  v_scale numeric := 1;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_auto_rebalance boolean := coalesce((p_payload->>'auto_rebalance_percentages')::boolean, false);
begin
  if coalesce(public.get_user_role() <> 'admin', true) then
    raise exception 'Admin role required to change project compensation assignments';
  end if;

  perform 1 from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;

  if p_assignment_id is not null then
    select * into v_existing
    from public.project_members pm
    where pm.id = p_assignment_id and pm.project_id = p_project_id;
    if not found then raise exception 'Project member assignment not found'; end if;
  end if;

  v_reward_type := case
    when p_payload ? 'reward_type' then nullif(p_payload->>'reward_type', '')
    else v_existing.reward_type
  end;
  v_reward_amount := case
    when p_payload ? 'reward_amount' then coalesce(nullif(p_payload->>'reward_amount', '')::numeric, 0)
    else coalesce(v_existing.reward_amount, 0)
  end;

  if v_auto_rebalance and v_reward_type = 'fixed' and v_reward_amount > 0 then
    select greatest(0,
      coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100
      - coalesce(p.price, 0) * coalesce(p.budget_percentage, 0) / 100 * coalesce(p.overhead_percentage, 0) / 100
      - coalesce((select sum(ps.price) from public.project_subcontractors ps where ps.project_id = p.id), 0)
      - coalesce((select sum(pc.amount) from public.project_costs pc where pc.project_id = p.id and pc.member_id is null and not coalesce(pc.is_attendance_cost, false)), 0)
      - coalesce((select sum(poc.amount) from public.project_overhead_costs poc where poc.project_id = p.id), 0)
      - coalesce((select sum(l.project_cost_impact) from public.labor_cost_ledger l where l.project_id = p.id and l.status <> 'reversed'), 0)
    ) into v_pool
    from public.projects p
    where p.id = p_project_id;

    select
      coalesce(sum(pm.reward_amount) filter (where pm.reward_type = 'fixed'), 0),
      coalesce(sum(pm.reward_percentage) filter (where pm.reward_type = 'percentage'), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'assignment_id', pm.id,
        'member_id', pm.member_id,
        'member_name', m.name,
        'reward_percentage', pm.reward_percentage
      ) order by m.name) filter (where pm.reward_type = 'percentage'), '[]'::jsonb)
    into v_existing_fixed_total, v_percentage_total, v_before
    from public.project_members pm
    left join public.members m on m.id = pm.member_id
    where pm.project_id = p_project_id
      and (p_assignment_id is null or pm.id <> p_assignment_id);

    -- Keep the complete pre-change percentage state in the audit, including an
    -- edited assignment that may be converted from percentage to fixed.
    select coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id', pm.id,
      'member_id', pm.member_id,
      'member_name', m.name,
      'reward_percentage', pm.reward_percentage
    ) order by m.name), '[]'::jsonb)
    into v_before
    from public.project_members pm
    left join public.members m on m.id = pm.member_id
    where pm.project_id = p_project_id and pm.reward_type = 'percentage';

    if v_existing_fixed_total + v_reward_amount > v_pool + 0.01 then
      raise exception 'Fixed project rewards exceed the current team budget by %',
        round(v_existing_fixed_total + v_reward_amount - v_pool, 2);
    end if;

    v_target_percentage_total := case
      when v_pool > 0 then greatest(0, (v_pool - v_existing_fixed_total - v_reward_amount) / v_pool * 100)
      else 0
    end;

    if v_percentage_total > v_target_percentage_total + 0.00000001 then
      v_scale := case when v_percentage_total > 0 then v_target_percentage_total / v_percentage_total else 1 end;

      if exists (
        select 1
        from public.project_members pm
        left join lateral (
          select coalesce(sum(pi.amount), 0)::numeric amount
          from public.payout_items pi
          join public.payouts po on po.id = pi.payout_id
          where pi.project_id = p_project_id
            and po.member_id = pm.member_id
            and po.status in ('pending', 'approved', 'invoice_uploaded', 'paid')
        ) committed on true
        where pm.project_id = p_project_id
          and pm.reward_type = 'percentage'
          and (p_assignment_id is null or pm.id <> p_assignment_id)
          and v_pool * pm.reward_percentage * v_scale / 100 + 0.01 < committed.amount
      ) then
        raise exception 'Automatic reward rebalance would reduce a member below already committed payouts';
      end if;

      update public.project_members pm
      set reward_percentage = pm.reward_percentage * v_scale
      where pm.project_id = p_project_id
        and pm.reward_type = 'percentage'
        and (p_assignment_id is null or pm.id <> p_assignment_id);

    else
      v_after := v_before;
    end if;
  end if;

  v_result := public.save_project_member_safe_admin_internal(
    p_project_id,
    p_assignment_id,
    p_payload - 'auto_rebalance_percentages'
  );

  perform public.assert_project_reward_allocation(p_project_id);

  if v_auto_rebalance and v_scale < 1 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id', pm.id,
      'member_id', pm.member_id,
      'member_name', m.name,
      'reward_percentage', pm.reward_percentage
    ) order by m.name), '[]'::jsonb)
    into v_after
    from public.project_members pm
    left join public.members m on m.id = pm.member_id
    where pm.project_id = p_project_id and pm.reward_type = 'percentage';

    insert into public.audit_logs (user_id, user_email, action, details)
    values (
      auth.uid(),
      coalesce(auth.jwt()->>'email', ''),
      'project_reward_auto_rebalance',
      jsonb_build_object(
        'project_id', p_project_id,
        'saved_assignment_id', v_result->>'id',
        'fixed_reward_amount', v_reward_amount,
        'reward_pool', v_pool,
        'percentage_total_before', v_percentage_total,
        'percentage_total_after', v_target_percentage_total,
        'scale_factor', v_scale,
        'before', v_before,
        'after', v_after
      )
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_project_member_safe(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_member_safe(uuid, uuid, jsonb) to authenticated, service_role;
