-- Keep CRM commercial document headers aligned with the shared CRM item totals payload.
-- OP/NAB/OBJ item rows already store cost and margin snapshots; document headers need
-- the same aggregate fields so PostgREST inserts/updates do not reject the payload.

alter table public.crm_commercial_documents
  add column if not exists gross_subtotal numeric(14, 2) not null default 0,
  add column if not exists total_with_tax numeric(14, 2) not null default 0,
  add column if not exists cost_total numeric(14, 2) not null default 0,
  add column if not exists total_cost numeric(14, 2) not null default 0,
  add column if not exists margin_total numeric(14, 2) not null default 0,
  add column if not exists margin_value numeric(14, 2) not null default 0,
  add column if not exists margin_percent numeric(8, 2) not null default 0;

update public.crm_commercial_documents
set gross_subtotal = coalesce(nullif(gross_subtotal, 0), subtotal + discount_total, subtotal, 0),
    total_with_tax = coalesce(nullif(total_with_tax, 0), total + tax_total, total, 0),
    total_cost = coalesce(nullif(total_cost, 0), cost_total, 0),
    margin_value = coalesce(nullif(margin_value, 0), margin_total, 0)
where gross_subtotal = 0
   or total_with_tax = 0
   or total_cost = 0
   or margin_value = 0;
