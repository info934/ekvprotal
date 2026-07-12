-- Backfill historical financial metadata and prevent inconsistent future writes.

with item_totals as (
  select
    d.id as document_id,
    coalesce(sum(round(i.quantity * i.unit_price, 2)), 0)::numeric as gross_subtotal,
    coalesce(sum(round(i.quantity * i.unit_price * (i.discount_percent / 100), 2)), 0)::numeric as discount_total,
    coalesce(sum(i.line_total), 0)::numeric as total,
    coalesce(sum(round(i.line_total * (i.vat_rate / 100), 2)), 0)::numeric as tax_total,
    coalesce(sum(round(i.quantity * coalesce(i.unit_cost, i.purchase_price_snapshot, 0), 2)), 0)::numeric as cost_total,
    coalesce(sum(i.margin_total), 0)::numeric as margin_total,
    coalesce(sum(i.commission_total), 0)::numeric as commission_total,
    coalesce(sum(i.profit_after_commission), 0)::numeric as profit_after_commission
  from public.crm_commercial_documents d
  left join public.crm_commercial_document_items i on i.document_id = d.id
  group by d.id
)
update public.crm_commercial_documents d
set gross_subtotal = round(t.gross_subtotal, 2),
    subtotal = round(t.gross_subtotal, 2),
    discount_total = round(t.discount_total, 2),
    tax_total = round(t.tax_total, 2),
    total = round(t.total, 2),
    total_with_tax = round(t.total + t.tax_total, 2),
    cost_total = round(t.cost_total, 2),
    total_cost = round(t.cost_total, 2),
    margin_total = round(t.margin_total, 2),
    margin_value = round(t.margin_total, 2),
    margin_percent = case when t.total > 0 then round((t.margin_total / t.total * 100)::numeric, 2) else 0 end,
    commission_total = round(t.commission_total, 2),
    profit_after_commission = round(t.profit_after_commission, 2),
    profit_after_commission_percent = case when t.total > 0 then round((t.profit_after_commission / t.total * 100)::numeric, 2) else 0 end
from item_totals t
where d.id = t.document_id;

-- Legacy paid rows predate the explicit workflow timestamps and invoice override flag.
update public.payouts
set paid_at = coalesce(paid_at, invoice_uploaded_at, approved_at, request_date::timestamptz)
where status = 'paid'
  and paid_at is null;

update public.payouts
set approved_without_invoice = true
where status = 'paid'
  and invoice_url is null
  and coalesce(approved_without_invoice, false) = false;

alter table public.crm_commercial_document_items
  drop constraint if exists crm_document_items_financial_values_check,
  add constraint crm_document_items_financial_values_check check (
    quantity >= 0
    and unit_price >= 0
    and coalesce(unit_cost, 0) >= 0
    and discount_percent between 0 and 100
    and vat_rate in (0, 12, 21)
    and coalesce(commission_percent, 0) between 0 and 100
  );

alter table public.crm_opportunity_items
  drop constraint if exists crm_opportunity_items_financial_values_check,
  add constraint crm_opportunity_items_financial_values_check check (
    quantity >= 0
    and unit_price >= 0
    and coalesce(unit_cost, 0) >= 0
    and discount_percent between 0 and 100
    and vat_rate in (0, 12, 21)
    and coalesce(commission_percent, 0) between 0 and 100
  );

alter table public.projects
  drop constraint if exists projects_financial_percentages_check,
  add constraint projects_financial_percentages_check check (
    coalesce(price, 0) >= 0
    and coalesce(budget_percentage, 0) between 0 and 100
    and coalesce(overhead_percentage, 0) between 0 and 100
  );

alter table public.realizations
  drop constraint if exists realizations_financial_percentages_check,
  add constraint realizations_financial_percentages_check check (
    coalesce(contract_amount, 0) >= 0
    and coalesce(profit_margin_percent, 0) >= 0
    and coalesce(overhead_percent, 0) >= 0
    and coalesce(profit_margin_percent, 0) + coalesce(overhead_percent, 0) <= 100
  );

alter table public.payouts
  drop constraint if exists payouts_paid_metadata_check,
  add constraint payouts_paid_metadata_check check (
    status <> 'paid'
    or (
      paid_at is not null
      and (coalesce(approved_without_invoice, false) or invoice_url is not null)
    )
  );

alter table public.realization_profit_shares
  drop constraint if exists realization_profit_shares_percent_value_check,
  add constraint realization_profit_shares_percent_value_check check (
    share_type <> 'percent' or share_value <= 100
  );

create or replace function public.validate_realization_percentage_share_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_realization_id uuid := coalesce(new.realizace_id, old.realizace_id);
  v_percent_total numeric;
begin
  select coalesce(sum(share_value), 0)
  into v_percent_total
  from public.realization_profit_shares
  where realizace_id = v_realization_id
    and share_type = 'percent';

  if v_percent_total > 100 then
    raise exception 'Percentage realization shares cannot exceed 100%% (current total: %)', v_percent_total;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_realization_percentage_share_total on public.realization_profit_shares;
create constraint trigger validate_realization_percentage_share_total
after insert or update or delete on public.realization_profit_shares
deferrable initially immediate
for each row execute function public.validate_realization_percentage_share_total();

revoke all on function public.validate_realization_percentage_share_total() from public, anon, authenticated;
