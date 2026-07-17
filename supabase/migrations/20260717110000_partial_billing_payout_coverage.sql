-- Partial customer billing and cash-coverage warnings for project payouts.
-- Billing remains advisory for legacy records; accounting reward limits are unchanged.

create table if not exists public.entity_billing_entries (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('project', 'realization')),
  project_id uuid references public.projects(id) on delete cascade,
  realization_id uuid references public.realizations(id) on delete cascade,
  invoice_number text,
  invoice_kind text not null default 'partial'
    check (invoice_kind in ('advance', 'partial', 'final', 'credit_note')),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'overdue')),
  issue_date date,
  due_date date,
  paid_date date,
  amount_excl_vat numeric(14,2) not null default 0 check (amount_excl_vat >= 0),
  vat_rate numeric(5,2) not null default 21 check (vat_rate >= 0 and vat_rate <= 100),
  amount_incl_vat numeric(14,2) generated always as (round(amount_excl_vat * (1 + vat_rate / 100), 2)) stored,
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  currency text not null default 'CZK' check (char_length(currency) = 3),
  note text,
  document_url text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_billing_entries_target_check check (
    (entity_type = 'project' and project_id is not null and realization_id is null)
    or (entity_type = 'realization' and realization_id is not null and project_id is null)
  )
);

create index if not exists idx_entity_billing_entries_project
  on public.entity_billing_entries (project_id, status, issue_date desc)
  where project_id is not null;
create index if not exists idx_entity_billing_entries_realization
  on public.entity_billing_entries (realization_id, status, issue_date desc)
  where realization_id is not null;
create unique index if not exists uq_entity_billing_project_invoice_number
  on public.entity_billing_entries (project_id, lower(invoice_number))
  where project_id is not null and invoice_number is not null and status <> 'cancelled';
create unique index if not exists uq_entity_billing_realization_invoice_number
  on public.entity_billing_entries (realization_id, lower(invoice_number))
  where realization_id is not null and invoice_number is not null and status <> 'cancelled';

create or replace function public.touch_entity_billing_entry()
returns trigger language plpgsql set search_path = public as $$
declare
  v_gross numeric(14,2);
begin
  new.updated_at := now();
  v_gross := round(new.amount_excl_vat * (1 + new.vat_rate / 100), 2);

  if new.invoice_kind <> 'credit_note' and new.paid_amount > v_gross then
    raise exception 'Paid amount cannot exceed invoice total';
  end if;

  if new.status = 'partially_paid' and (new.paid_amount <= 0 or new.paid_amount >= v_gross) then
    raise exception 'Partially paid invoice requires a payment greater than zero and lower than invoice total';
  end if;

  if new.status = 'paid' then
    new.paid_amount := v_gross;
    if new.paid_date is null then new.paid_date := current_date; end if;
  elsif new.paid_amount = 0 then
    new.paid_date := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_entity_billing_entry on public.entity_billing_entries;
create trigger trg_touch_entity_billing_entry
before insert or update on public.entity_billing_entries
for each row execute function public.touch_entity_billing_entry();

create or replace function public.audit_entity_billing_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(),
    auth.jwt()->>'email',
    case when tg_op = 'INSERT' then 'billing_entry_created'
         when tg_op = 'UPDATE' then 'billing_entry_updated'
         else 'billing_entry_deleted' end,
    jsonb_build_object(
      'entity_type', coalesce(new.entity_type, old.entity_type),
      'project_id', coalesce(new.project_id, old.project_id),
      'realization_id', coalesce(new.realization_id, old.realization_id),
      'billing_entry_id', coalesce(new.id, old.id),
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_entity_billing_entry on public.entity_billing_entries;
create trigger trg_audit_entity_billing_entry
after insert or update or delete on public.entity_billing_entries
for each row execute function public.audit_entity_billing_entry();

alter table public.entity_billing_entries enable row level security;
drop policy if exists "Billing entries visible to admins" on public.entity_billing_entries;
create policy "Billing entries visible to admins" on public.entity_billing_entries
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));
drop policy if exists "Billing entries managed by admins" on public.entity_billing_entries;
create policy "Billing entries managed by admins" on public.entity_billing_entries
for all to authenticated
using (coalesce(public.get_user_role() = 'admin', false))
with check (coalesce(public.get_user_role() = 'admin', false));

revoke all on public.entity_billing_entries from public, anon;
grant select, insert, update, delete on public.entity_billing_entries to authenticated;
grant all on public.entity_billing_entries to service_role;

create or replace function public.billing_funding_snapshot(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_contract numeric := 0;
  v_count integer := 0;
  v_invoiced numeric := 0;
  v_paid numeric := 0;
  v_status text;
begin
  if p_entity_type = 'project' then
    select coalesce(price, 0) into v_contract from public.projects where id = p_entity_id;
  elsif p_entity_type = 'realization' then
    select coalesce(r.contract_amount, 0) + coalesce((
      select sum(ec.sale_amount) from public.realizace_extra_costs ec where ec.realizace_id = r.id
    ), 0) into v_contract from public.realizations r where r.id = p_entity_id;
  else
    raise exception 'Unsupported billing entity type';
  end if;

  select count(*),
    coalesce(sum(case when invoice_kind = 'credit_note' then -amount_incl_vat else amount_incl_vat end)
      filter (where status not in ('draft', 'cancelled')), 0),
    coalesce(sum(case when invoice_kind = 'credit_note' then -paid_amount else paid_amount end)
      filter (where status <> 'cancelled'), 0)
  into v_count, v_invoiced, v_paid
  from public.entity_billing_entries
  where (p_entity_type = 'project' and project_id = p_entity_id)
     or (p_entity_type = 'realization' and realization_id = p_entity_id);

  v_status := case
    when v_count = 0 then 'not_configured'
    when v_invoiced <= 0 then 'not_invoiced'
    when v_contract > 0 and v_invoiced < v_contract then 'partially_invoiced'
    when v_paid <= 0 then 'invoiced_unpaid'
    when v_contract > 0 and v_paid < v_contract then 'partially_paid'
    else 'fully_paid'
  end;

  return jsonb_build_object(
    'configured', v_count > 0,
    'entry_count', v_count,
    'contract_amount', v_contract,
    'invoiced_amount', v_invoiced,
    'paid_amount', v_paid,
    'outstanding_amount', greatest(0, v_invoiced - v_paid),
    'remaining_to_invoice', greatest(0, v_contract - v_invoiced),
    'invoice_coverage_percent', case when v_contract > 0 then least(100, greatest(0, v_invoiced / v_contract * 100)) else 0 end,
    'payment_coverage_percent', case when v_contract > 0 then least(100, greatest(0, v_paid / v_contract * 100)) else 0 end,
    'status', v_status,
    'warning', v_status <> 'fully_paid',
    'warning_message', case v_status
      when 'not_configured' then 'Fakturace zakázky zatím není evidována.'
      when 'not_invoiced' then 'Zakázka zatím nebyla vyfakturována.'
      when 'partially_invoiced' then 'Zakázka je vyfakturována pouze částečně.'
      when 'invoiced_unpaid' then 'Vystavené faktury zatím nejsou uhrazené.'
      when 'partially_paid' then 'Zakázka zatím není plně uhrazená.'
      else null end
  );
end;
$$;

revoke all on function public.billing_funding_snapshot(text, uuid) from public, anon, authenticated;
grant execute on function public.billing_funding_snapshot(text, uuid) to service_role;

create or replace function public.get_entity_billing_summary(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'Admin access required'; end if;
  v_result := public.billing_funding_snapshot(p_entity_type, p_entity_id);
  return v_result || jsonb_build_object('entries', coalesce((
    select jsonb_agg(to_jsonb(e) order by e.issue_date desc nulls last, e.created_at desc)
    from public.entity_billing_entries e
    where (p_entity_type = 'project' and e.project_id = p_entity_id)
       or (p_entity_type = 'realization' and e.realization_id = p_entity_id)
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.get_entity_billing_summary(text, uuid) from public, anon;
grant execute on function public.get_entity_billing_summary(text, uuid) to authenticated, service_role;

-- Keep the existing entitlement calculation, and add an advisory cash-covered limit.
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
  ), rows_with_billing as (
    select p.*, coalesce(edit.amount, 0)::numeric as edit_amount,
      public.billing_funding_snapshot('project', p.project_id) as billing
    from public.get_member_project_rewards(p_member_id) p
    left join edit_project_items edit on edit.project_id = p.project_id
    where coalesce(p.available_balance, 0) + coalesce(edit.amount, 0) > 0.01
      and p.reward_type in ('fixed', 'percentage')
  )
  select coalesce(jsonb_agg(
    (to_jsonb(p) - 'billing' - 'edit_amount') || jsonb_build_object(
      'available_balance', coalesce(p.available_balance, 0) + p.edit_amount,
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
        when r.team_budget <= 0 then 'Týmový rozpočet je nulový nebo záporný'
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

revoke all on function public.get_payout_availability(uuid, uuid) from public, anon;
grant execute on function public.get_payout_availability(uuid, uuid) to authenticated, service_role;
