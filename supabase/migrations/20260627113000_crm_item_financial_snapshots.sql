alter table public.crm_opportunity_items
  add column if not exists unit_cost numeric(14, 2) not null default 0,
  add column if not exists purchase_price_snapshot numeric(14, 2) not null default 0,
  add column if not exists margin_total numeric(14, 2) not null default 0,
  add column if not exists margin_percent numeric(8, 2) not null default 0;

alter table public.crm_commercial_document_items
  add column if not exists unit_cost numeric(14, 2) not null default 0,
  add column if not exists purchase_price_snapshot numeric(14, 2) not null default 0,
  add column if not exists margin_total numeric(14, 2) not null default 0,
  add column if not exists margin_percent numeric(8, 2) not null default 0;

update public.crm_opportunity_items
set
  unit_cost = coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0),
  purchase_price_snapshot = coalesce(nullif(purchase_price_snapshot, 0), unit_cost, 0),
  margin_total = round((coalesce(line_total, 0) - (coalesce(quantity, 0) * coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0)))::numeric, 2),
  margin_percent = case
    when coalesce(line_total, 0) > 0 then round(((coalesce(line_total, 0) - (coalesce(quantity, 0) * coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0))) / coalesce(line_total, 0) * 100)::numeric, 2)
    else 0
  end;

update public.crm_commercial_document_items
set
  unit_cost = coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0),
  purchase_price_snapshot = coalesce(nullif(purchase_price_snapshot, 0), unit_cost, 0),
  margin_total = round((coalesce(line_total, 0) - (coalesce(quantity, 0) * coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0)))::numeric, 2),
  margin_percent = case
    when coalesce(line_total, 0) > 0 then round(((coalesce(line_total, 0) - (coalesce(quantity, 0) * coalesce(nullif(unit_cost, 0), purchase_price_snapshot, 0))) / coalesce(line_total, 0) * 100)::numeric, 2)
    else 0
  end;
