-- Planned billing milestones and verifiable customer invoice documents.
-- Existing invoice rows remain editable without a mandatory attachment; new rows require one once issued.

create table if not exists public.entity_billing_milestones (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('project', 'realization')),
  project_id uuid references public.projects(id) on delete cascade,
  realization_id uuid references public.realizations(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  name text not null,
  status text not null default 'planned'
    check (status in ('planned', 'ready', 'invoiced', 'partially_paid', 'completed', 'overdue', 'cancelled')),
  performance_date date,
  planned_issue_date date,
  due_date date,
  amount_excl_vat numeric(14,2) not null default 0 check (amount_excl_vat >= 0),
  vat_rate numeric(5,2) not null default 21 check (vat_rate in (0, 12, 21)),
  amount_incl_vat numeric(14,2) generated always as (round(amount_excl_vat * (1 + vat_rate / 100), 2)) stored,
  percent_of_contract numeric(7,3) check (percent_of_contract is null or (percent_of_contract >= 0 and percent_of_contract <= 100)),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_billing_milestones_target_check check (
    (entity_type = 'project' and project_id is not null and realization_id is null)
    or (entity_type = 'realization' and realization_id is not null and project_id is null)
  ),
  constraint entity_billing_milestones_dates_check check (
    due_date is null or planned_issue_date is null or due_date >= planned_issue_date
  )
);

create unique index if not exists uq_billing_milestone_project_number
  on public.entity_billing_milestones (project_id, installment_number)
  where project_id is not null and status <> 'cancelled';
create unique index if not exists uq_billing_milestone_realization_number
  on public.entity_billing_milestones (realization_id, installment_number)
  where realization_id is not null and status <> 'cancelled';
create index if not exists idx_billing_milestone_project_dates
  on public.entity_billing_milestones (project_id, planned_issue_date, performance_date)
  where project_id is not null;
create index if not exists idx_billing_milestone_realization_dates
  on public.entity_billing_milestones (realization_id, planned_issue_date, performance_date)
  where realization_id is not null;

alter table public.entity_billing_entries
  add column if not exists milestone_id uuid references public.entity_billing_milestones(id) on delete set null,
  add column if not exists performance_date date,
  add column if not exists document_file_name text,
  add column if not exists document_uploaded_at timestamptz,
  add column if not exists document_required boolean not null default true;

-- Do not retroactively block legacy rows that were created before attachment validation existed.
update public.entity_billing_entries
set document_required = false
where document_required = true
  and created_at < '2026-07-18 00:00:00+00'::timestamptz;

create unique index if not exists uq_entity_billing_entries_milestone
  on public.entity_billing_entries (milestone_id)
  where milestone_id is not null and status <> 'cancelled';

create or replace function public.touch_entity_billing_milestone()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.name := nullif(btrim(new.name), '');
  if new.name is null then raise exception 'Billing milestone name is required'; end if;
  if new.planned_issue_date is not null and new.due_date is not null and new.due_date < new.planned_issue_date then
    raise exception 'Billing milestone due date cannot precede the planned issue date';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_entity_billing_milestone on public.entity_billing_milestones;
create trigger trg_touch_entity_billing_milestone
before insert or update on public.entity_billing_milestones
for each row execute function public.touch_entity_billing_milestone();

create or replace function public.touch_entity_billing_entry()
returns trigger language plpgsql set search_path = public as $$
declare
  v_gross numeric(14,2);
  v_milestone public.entity_billing_milestones%rowtype;
begin
  new.updated_at := now();
  v_gross := round(new.amount_excl_vat * (1 + new.vat_rate / 100), 2);

  if new.milestone_id is not null then
    select * into v_milestone from public.entity_billing_milestones where id = new.milestone_id;
    if not found then raise exception 'Billing milestone not found'; end if;
    if v_milestone.entity_type <> new.entity_type
       or v_milestone.project_id is distinct from new.project_id
       or v_milestone.realization_id is distinct from new.realization_id then
      raise exception 'Invoice and billing milestone must belong to the same project or realization';
    end if;
  end if;

  if new.invoice_kind <> 'credit_note' and new.paid_amount > v_gross then
    raise exception 'Paid amount cannot exceed invoice total';
  end if;

  if new.status = 'partially_paid' and (new.paid_amount <= 0 or new.paid_amount >= v_gross) then
    raise exception 'Partially paid invoice requires a payment greater than zero and lower than invoice total';
  end if;

  if new.status not in ('draft', 'cancelled') then
    if nullif(btrim(new.invoice_number), '') is null then raise exception 'Issued invoice number is required'; end if;
    if new.performance_date is null then raise exception 'Issued invoice performance date is required'; end if;
    if new.issue_date is null then raise exception 'Issued invoice issue date is required'; end if;
    if new.due_date is null then raise exception 'Issued invoice due date is required'; end if;
    if new.document_required and nullif(btrim(new.document_url), '') is null then
      raise exception 'Issued invoice document is required';
    end if;
  end if;

  if new.document_url is not null and new.document_uploaded_at is null then
    new.document_uploaded_at := now();
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

create or replace function public.sync_billing_milestone_from_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_milestone_id uuid := coalesce(new.milestone_id, old.milestone_id);
  v_status text;
begin
  if v_milestone_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.status = 'cancelled') then
    update public.entity_billing_milestones
    set status = case when coalesce(performance_date, planned_issue_date) <= current_date then 'ready' else 'planned' end
    where id = v_milestone_id and status <> 'cancelled';
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_status := case new.status
    when 'paid' then 'completed'
    when 'partially_paid' then 'partially_paid'
    when 'overdue' then 'overdue'
    when 'issued' then 'invoiced'
    else null end;
  if v_status is not null then
    update public.entity_billing_milestones set status = v_status where id = v_milestone_id and status <> 'cancelled';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_billing_milestone_from_entry on public.entity_billing_entries;
create trigger trg_sync_billing_milestone_from_entry
after insert or update or delete on public.entity_billing_entries
for each row execute function public.sync_billing_milestone_from_entry();

create or replace function public.audit_entity_billing_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(), auth.jwt()->>'email',
    case when tg_op = 'INSERT' then 'billing_milestone_created'
         when tg_op = 'UPDATE' then 'billing_milestone_updated'
         else 'billing_milestone_deleted' end,
    jsonb_build_object(
      'entity_type', coalesce(new.entity_type, old.entity_type),
      'project_id', coalesce(new.project_id, old.project_id),
      'realization_id', coalesce(new.realization_id, old.realization_id),
      'billing_milestone_id', coalesce(new.id, old.id),
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_entity_billing_milestone on public.entity_billing_milestones;
create trigger trg_audit_entity_billing_milestone
after insert or update or delete on public.entity_billing_milestones
for each row execute function public.audit_entity_billing_milestone();

alter table public.entity_billing_milestones enable row level security;
drop policy if exists "Billing milestones visible to admins" on public.entity_billing_milestones;
create policy "Billing milestones visible to admins" on public.entity_billing_milestones
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));
drop policy if exists "Billing milestones managed by admins" on public.entity_billing_milestones;
create policy "Billing milestones managed by admins" on public.entity_billing_milestones
for all to authenticated
using (coalesce(public.get_user_role() = 'admin', false))
with check (coalesce(public.get_user_role() = 'admin', false));

revoke all on public.entity_billing_milestones from public, anon;
grant select, insert, update, delete on public.entity_billing_milestones to authenticated;
grant all on public.entity_billing_milestones to service_role;

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
  v_plan_count integer := 0;
  v_planned numeric := 0;
  v_missing_documents integer := 0;
  v_overdue_milestones integer := 0;
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
      filter (where status <> 'cancelled'), 0),
    count(*) filter (where status not in ('draft', 'cancelled') and nullif(btrim(document_url), '') is null)
  into v_count, v_invoiced, v_paid, v_missing_documents
  from public.entity_billing_entries
  where (p_entity_type = 'project' and project_id = p_entity_id)
     or (p_entity_type = 'realization' and realization_id = p_entity_id);

  select count(*) filter (where status <> 'cancelled'),
    coalesce(sum(amount_incl_vat) filter (where status <> 'cancelled'), 0),
    count(*) filter (
      where status not in ('invoiced', 'partially_paid', 'completed', 'cancelled')
        and coalesce(planned_issue_date, performance_date) < current_date
    )
  into v_plan_count, v_planned, v_overdue_milestones
  from public.entity_billing_milestones
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
    'configured', v_count > 0 or v_plan_count > 0,
    'entry_count', v_count,
    'plan_count', v_plan_count,
    'contract_amount', v_contract,
    'planned_amount', v_planned,
    'plan_variance', v_planned - v_contract,
    'invoiced_amount', v_invoiced,
    'paid_amount', v_paid,
    'outstanding_amount', greatest(0, v_invoiced - v_paid),
    'remaining_to_invoice', greatest(0, v_contract - v_invoiced),
    'invoice_coverage_percent', case when v_contract > 0 then least(100, greatest(0, v_invoiced / v_contract * 100)) else 0 end,
    'payment_coverage_percent', case when v_contract > 0 then least(100, greatest(0, v_paid / v_contract * 100)) else 0 end,
    'missing_document_count', v_missing_documents,
    'overdue_milestone_count', v_overdue_milestones,
    'status', v_status,
    'warning', v_status <> 'fully_paid' or v_missing_documents > 0 or v_overdue_milestones > 0,
    'warning_message', concat_ws(' ',
      case v_status
        when 'not_configured' then 'Fakturace zakázky zatím není evidována.'
        when 'not_invoiced' then 'Zakázka zatím nebyla vyfakturována.'
        when 'partially_invoiced' then 'Zakázka je vyfakturována pouze částečně.'
        when 'invoiced_unpaid' then 'Vystavené faktury zatím nejsou uhrazené.'
        when 'partially_paid' then 'Zakázka zatím není plně uhrazená.'
        else null end,
      case when v_missing_documents > 0 then format('%s faktur nemá přiložený doklad.', v_missing_documents) end,
      case when v_overdue_milestones > 0 then format('%s fakturačních etap je po plánovaném termínu.', v_overdue_milestones) end
    )
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
  return v_result || jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.issue_date desc nulls last, e.created_at desc)
      from public.entity_billing_entries e
      where (p_entity_type = 'project' and e.project_id = p_entity_id)
         or (p_entity_type = 'realization' and e.realization_id = p_entity_id)
    ), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.installment_number, m.planned_issue_date nulls last)
      from public.entity_billing_milestones m
      where (p_entity_type = 'project' and m.project_id = p_entity_id)
         or (p_entity_type = 'realization' and m.realization_id = p_entity_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_entity_billing_summary(text, uuid) from public, anon;
grant execute on function public.get_entity_billing_summary(text, uuid) to authenticated, service_role;
