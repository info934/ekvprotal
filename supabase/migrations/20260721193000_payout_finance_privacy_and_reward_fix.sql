-- Harden payout reward read models so self-service payout screens expose only
-- the member's own entitlement, not company-wide project/realization finances.

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
  v_can_admin := coalesce(public.can_admin_module('payouts'), false);

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
        - pci.paid_task_payouts - pci.direct_labor_costs)::numeric as team_budget_before_payouts,
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
      case when rb.reward_type = 'fixed' then least(rb.reward_fixed_amount, greatest(0, rb.team_budget_before_payouts))
        when rb.reward_type = 'percentage' then greatest(0, rb.team_budget_before_payouts) * (rb.reward_percentage / 100)
        else 0 end::numeric as gross_reward,
      coalesce(ps.reserved_or_paid_amount, 0)::numeric as reserved_or_paid_amount,
      coalesce(ps.paid_amount, 0)::numeric as paid_amount
    from reward_base rb left join payout_sums ps on ps.member_id = rb.member_id and ps.project_id = rb.project_id
  )
  select c.member_id, c.project_id, c.project_name, c.project_code, c.project_status,
    c.reward_type,
    case when v_can_admin then c.reward_percentage else null::numeric end,
    case when v_can_admin then c.reward_fixed_amount else null::numeric end,
    c.is_hourly,
    case when v_can_admin then c.team_budget_before_payouts else null::numeric end,
    greatest(0, c.gross_reward - c.assigned_member_costs) as total_reward,
    c.reserved_or_paid_amount, c.paid_amount,
    greatest(0, c.gross_reward - c.assigned_member_costs - c.reserved_or_paid_amount) as available_balance
  from calculated c order by c.project_code nulls last, c.project_name;
end;
$$;

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
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_edit_payout_member_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_can_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read realization rewards for this member';
  end if;
  if p_edit_payout_id is not null then
    select member_id into v_edit_payout_member_id
    from public.payouts
    where id = p_edit_payout_id;

    if v_edit_payout_member_id is null then
      raise exception 'Edited payout request not found';
    end if;

    if v_edit_payout_member_id <> p_member_id then
      raise exception 'Edited payout request does not belong to requested member';
    end if;
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
      coalesce(global_paid.paid_task_payouts, 0)::numeric as paid_task_payouts,
      coalesce(res.reserved_amount, 0)::numeric as reserved_payouts,
      coalesce(res.paid_amount, 0)::numeric as paid_amount,
      coalesce(edit.amount, 0)::numeric as edit_amount
    from public.realizations r
    join shares s on s.realizace_id = r.id
    left join lateral (
      select coalesce(sum(rc.amount), 0)::numeric as amount
      from public.realizace_costs rc where rc.realizace_id = r.id
    ) mc on true
    left join lateral (
      select coalesce(sum(rec.cost_amount), 0)::numeric as cost_amount,
        coalesce(sum(rec.sale_amount), 0)::numeric as sale_amount
      from public.realizace_extra_costs rec where rec.realizace_id = r.id
    ) ec on true
    left join lateral (
      select coalesce(sum(lcl.project_cost_impact), 0)::numeric as direct_project_cost,
        coalesce(sum(lcl.sponsor_reward_deduction) filter (where lcl.sponsor_member_id = p_member_id), 0)::numeric as sponsored_deduction
      from public.labor_cost_ledger lcl
      where lcl.realization_id = r.id and lcl.status <> 'reversed'
    ) labor on true
    left join lateral (
      select coalesce(sum(pi.amount), 0)::numeric as paid_task_payouts
      from public.payout_items pi
      join public.payouts po on po.id = pi.payout_id
      where pi.realization_id = r.id
        and po.status = 'paid'
    ) global_paid on true
    left join reserved res on res.realization_id = r.id
    left join edit_items edit on edit.realization_id = r.id
  ),
  budgets as (
    select c.*,
      (c.total_revenue * c.profit_margin_percent / 100)::numeric as profit_amount,
      (c.total_revenue * c.overhead_percent / 100)::numeric as overhead_amount,
      (c.total_revenue - (c.total_revenue * c.profit_margin_percent / 100)
        - (c.total_revenue * c.overhead_percent / 100) - c.operational_costs
        - c.direct_labor_cost - c.paid_task_payouts)::numeric as team_budget_before_payouts
    from calculated c
  ),
  rewards as (
    select b.*,
      case when b.share_type = 'fixed' then least(b.share_value, greatest(0, b.team_budget_before_payouts))
        when b.share_type = 'percent' then greatest(0, b.team_budget_before_payouts * b.share_value / 100)
        else 0 end::numeric as gross_share
    from budgets b
  )
  select rw.id, rw.name, rw.status,
    case when v_can_admin then rw.base_contract_amount else null::numeric end,
    case when v_can_admin then rw.extra_revenue else null::numeric end,
    case when v_can_admin then rw.operational_costs else null::numeric end,
    case when v_can_admin then rw.total_revenue else null::numeric end,
    case when v_can_admin then rw.profit_margin_percent else null::numeric end,
    case when v_can_admin then rw.overhead_percent else null::numeric end,
    case when v_can_admin then rw.profit_amount else null::numeric end,
    case when v_can_admin then rw.overhead_amount else null::numeric end,
    case when v_can_admin then rw.team_budget_before_payouts else null::numeric end,
    rw.share_type,
    case when v_can_admin then rw.share_value else null::numeric end,
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
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_edit_payout_member_id uuid;
  v_projects jsonb;
  v_realizations jsonb;
begin
  if p_member_id is null then raise exception 'member_id is required'; end if;
  if not v_can_admin and p_member_id <> v_current_member_id then
    raise exception 'Not allowed to read payout availability for this member';
  end if;
  if p_edit_payout_id is not null then
    select member_id into v_edit_payout_member_id
    from public.payouts
    where id = p_edit_payout_id;

    if v_edit_payout_member_id is null then
      raise exception 'Edited payout request not found';
    end if;

    if v_edit_payout_member_id <> p_member_id then
      raise exception 'Edited payout request does not belong to requested member';
    end if;
  end if;

  with edit_project_items as (
    select pi.project_id, coalesce(sum(pi.amount), 0)::numeric as amount
    from public.payout_items pi
    where p_edit_payout_id is not null and pi.payout_id = p_edit_payout_id and pi.project_id is not null
    group by pi.project_id
  ), rows_with_billing as (
    select p.*, coalesce(edit.amount, 0)::numeric as edit_amount,
      public.billing_funding_snapshot('project', p.project_id) as billing
    from public.get_member_project_rewards(p_member_id) p
    left join edit_project_items edit on edit.project_id = p.project_id
    where coalesce(p.available_balance, 0) + coalesce(edit.amount, 0) > 0.01
      and p.reward_type in ('fixed', 'percentage')
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'project_id', p.project_id,
      'project_name', p.project_name,
      'project_code', p.project_code,
      'project_status', p.project_status,
      'reward_type', p.reward_type,
      'available_balance', coalesce(p.available_balance, 0) + p.edit_amount,
      'total_reward', p.total_reward,
      'reserved_payouts', greatest(0, coalesce(p.reserved_or_paid_amount, 0) - coalesce(p.paid_amount, 0)),
      'paid_payouts', coalesce(p.paid_amount, 0),
      'billing_configured', coalesce((p.billing->>'configured')::boolean, false),
      'billing_status', p.billing->>'status',
      'billing_warning', coalesce((p.billing->>'warning')::boolean, true),
      'billing_warning_message', p.billing->>'warning_message',
      'payment_coverage_percent', coalesce((p.billing->>'payment_coverage_percent')::numeric, 0),
      'recommended_available_balance', case
        when not coalesce((p.billing->>'configured')::boolean, false)
          then coalesce(p.available_balance, 0) + p.edit_amount
        else least(
          coalesce(p.available_balance, 0) + p.edit_amount,
          greatest(0,
            coalesce(p.total_reward, 0) * coalesce((p.billing->>'payment_coverage_percent')::numeric, 0) / 100
            - greatest(0, coalesce(p.reserved_or_paid_amount, 0) - p.edit_amount)
          )
        ) end
    ) order by p.project_code
  ), '[]'::jsonb) into v_projects
  from rows_with_billing p;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'status', r.status,
      'share_type', r.share_type,
      'gross_share', r.gross_share,
      'sponsored_labor_deduction', r.sponsored_labor_deduction,
      'total_share', r.total_share,
      'reserved_payouts', r.reserved_payouts,
      'paid_amount', r.paid_amount,
      'reserved_or_paid_amount', r.reserved_payouts + r.paid_amount,
      'available_share', r.available_share,
      'base_contract_amount', case when v_can_admin then r.base_contract_amount else null end,
      'extra_revenue', case when v_can_admin then r.extra_revenue else null end,
      'operational_costs', case when v_can_admin then r.operational_costs else null end,
      'total_costs', case when v_can_admin then r.operational_costs else null end,
      'total_revenue', case when v_can_admin then r.total_revenue else null end,
      'profit_margin_percent', case when v_can_admin then r.profit_margin_percent else null end,
      'overhead_percent', case when v_can_admin then r.overhead_percent else null end,
      'profit_amount', case when v_can_admin then r.profit_amount else null end,
      'overhead_amount', case when v_can_admin then r.overhead_amount else null end,
      'team_budget', case when v_can_admin then r.team_budget else null end,
      'billing_configured', coalesce((billing.snapshot->>'configured')::boolean, false),
      'billing_status', billing.snapshot->>'status',
      'billing_warning', coalesce((billing.snapshot->>'warning')::boolean, true),
      'billing_warning_message', billing.snapshot->>'warning_message',
      'payment_coverage_percent', coalesce((billing.snapshot->>'payment_coverage_percent')::numeric, 0),
      'recommended_available_share', case
        when not coalesce((billing.snapshot->>'configured')::boolean, false) then r.available_share
        else least(r.available_share, greatest(0,
          r.total_share * coalesce((billing.snapshot->>'payment_coverage_percent')::numeric, 0) / 100
          - r.reserved_payouts - r.paid_amount
        )) end,
      'availability_reason', case
        when r.total_share <= 0 and r.sponsored_labor_deduction > 0 then 'Odměna byla vyčerpána prací týmu'
        when r.total_share <= 0 then 'Podíl vychází na 0 Kč'
        when r.available_share > 0 then 'Dostupné k žádosti'
        else 'Podíl je už rezervovaný nebo vyplacený' end
    ) order by r.name
  ), '[]'::jsonb) into v_realizations
  from public.get_member_realization_rewards(p_member_id, p_edit_payout_id) r
  cross join lateral (select public.billing_funding_snapshot('realization', r.id) as snapshot) billing
  where r.available_share > 0.01;

  return jsonb_build_object('projects', v_projects, 'realizations', v_realizations);
end;
$$;

-- Team assignment funding links are private: admins can inspect all rows, a
-- worker can see only their own assignment. Legacy policy allowed every
-- authenticated user to read every realization team row.
drop policy if exists "Enable read for authenticated users" on public.realizace_team_members;
drop policy if exists "Realization team members read own or admin" on public.realizace_team_members;
create policy "Realization team members read own or admin"
on public.realizace_team_members
for select to authenticated
using (
  (select public.can_admin_module('realizace'))
  or (select public.can_admin_module('payouts'))
  or member_id = (select public.get_member_id())
);

create or replace function public.upload_payout_invoice(
  p_payout_id uuid,
  p_invoice_url text,
  p_invoice_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid;
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
  v_invoice_url text := nullif(trim(coalesce(p_invoice_url, '')), '');
  v_invoice_name text := nullif(trim(coalesce(p_invoice_name, '')), '');
begin
  v_current_member_id := public.get_member_id();
  v_can_admin := coalesce(public.can_admin_module('payouts'), false);

  select *
  into v_payout
  from public.payouts
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'Payout request not found';
  end if;

  if not v_can_admin and v_payout.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to upload invoice for this payout request';
  end if;

  if v_payout.status <> 'approved' then
    raise exception 'Cannot upload invoice for payout with status %. Must be approved.', v_payout.status;
  end if;

  if v_invoice_url is null or v_invoice_name is null then
    raise exception 'Invoice URL and name are required';
  end if;

  if length(v_invoice_url) > 2048
     or v_invoice_url ~ '[[:cntrl:]]'
     or v_invoice_url like '%..%'
     or (
       v_invoice_url !~ '^invoices/[A-Za-z0-9._~!$&''()*+,;=:@%/-]+$'
       and v_invoice_url !~ '^https://[^/]+/storage/v1/object/(public|sign)/invoices/[A-Za-z0-9._~!$&''()*+,;=:@%/?-]+$'
       and v_invoice_url !~ '^https://ekvproject\.sharepoint\.com/[A-Za-z0-9._~!$&''()*+,;=:@%/?-]+$'
     ) then
    raise exception 'Invalid invoice document location';
  end if;

  update public.payouts
  set
    invoice_url = v_invoice_url,
    invoice_name = v_invoice_name,
    invoice_uploaded_at = now(),
    status = 'invoice_uploaded'
  where id = p_payout_id
  returning * into v_payout;

  begin
    insert into public.audit_logs (user_id, user_email, action, details)
    values (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_workflow_invoice_upload',
      jsonb_build_object('payout_id', p_payout_id, 'invoice_name', v_invoice_name)
    );
  exception when undefined_table or insufficient_privilege then
    null;
  end;

  return to_jsonb(v_payout);
end;
$$;

revoke all on function public.get_member_project_rewards(uuid) from public, anon;
revoke all on function public.get_member_realization_rewards(uuid, uuid) from public, anon;
revoke all on function public.get_payout_availability(uuid, uuid) from public, anon;
revoke all on function public.upload_payout_invoice(uuid, text, text) from public, anon;
grant execute on function public.get_member_project_rewards(uuid) to authenticated, service_role;
grant execute on function public.get_member_realization_rewards(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_payout_availability(uuid, uuid) to authenticated, service_role;
grant execute on function public.upload_payout_invoice(uuid, text, text) to authenticated, service_role;
