-- Supplier price history for product catalog imports and repeated scraping.

create table if not exists public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  website_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_suppliers_slug_unique unique (slug)
);

create table if not exists public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.product_suppliers(id) on delete set null,
  source_slug text not null,
  source_name text not null,
  imported_at timestamptz not null default now(),
  item_count integer not null default 0,
  priced_item_count integer not null default 0,
  error_count integer not null default 0,
  status text not null default 'completed',
  source_file text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_import_batches_status_check check (status in ('running', 'completed', 'failed', 'partial'))
);

create table if not exists public.product_supplier_offers (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.commercial_item_catalog(id) on delete cascade,
  supplier_id uuid not null references public.product_suppliers(id) on delete cascade,
  supplier_sku text,
  supplier_product_url text,
  supplier_product_name text,
  supplier_category text,
  availability_note text,
  currency text not null default 'CZK',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  last_price_without_vat numeric(14, 2),
  last_price_raw text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_supplier_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references public.product_supplier_offers(id) on delete cascade,
  import_batch_id uuid references public.product_import_batches(id) on delete set null,
  scraped_at timestamptz not null default now(),
  price_without_vat numeric(14, 2),
  currency text not null default 'CZK',
  availability_note text,
  price_raw text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.commercial_item_catalog
  add column if not exists preferred_supplier_offer_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'commercial_item_catalog'
      and constraint_name = 'commercial_item_catalog_preferred_supplier_offer_id_fkey'
  ) then
    alter table public.commercial_item_catalog
      add constraint commercial_item_catalog_preferred_supplier_offer_id_fkey
      foreign key (preferred_supplier_offer_id)
      references public.product_supplier_offers(id)
      on delete set null;
  end if;
end $$;

alter table public.crm_opportunity_items
  add column if not exists supplier_offer_id uuid references public.product_supplier_offers(id) on delete set null,
  add column if not exists supplier_name text,
  add column if not exists supplier_sku_snapshot text;

alter table public.crm_commercial_document_items
  add column if not exists supplier_offer_id uuid references public.product_supplier_offers(id) on delete set null,
  add column if not exists supplier_name text,
  add column if not exists supplier_sku_snapshot text;

create unique index if not exists idx_product_supplier_offers_supplier_sku_unique
  on public.product_supplier_offers (supplier_id, lower(supplier_sku))
  where supplier_sku is not null and supplier_sku <> '';

create index if not exists idx_product_supplier_offers_catalog_item
  on public.product_supplier_offers (catalog_item_id, supplier_id);

create index if not exists idx_product_supplier_offers_active_price
  on public.product_supplier_offers (catalog_item_id, is_active, last_price_without_vat);

create unique index if not exists idx_product_supplier_price_snapshots_unique
  on public.product_supplier_price_snapshots (supplier_offer_id, scraped_at, coalesce(price_without_vat, -1), coalesce(price_raw, ''));

create index if not exists idx_product_supplier_price_snapshots_offer_time
  on public.product_supplier_price_snapshots (supplier_offer_id, scraped_at desc, created_at desc);

create index if not exists idx_product_import_batches_source_time
  on public.product_import_batches (source_slug, imported_at desc);

create or replace function public.update_product_supplier_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_product_suppliers_updated_at on public.product_suppliers;
create trigger update_product_suppliers_updated_at
before update on public.product_suppliers
for each row execute function public.update_product_supplier_updated_at();

drop trigger if exists update_product_supplier_offers_updated_at on public.product_supplier_offers;
create trigger update_product_supplier_offers_updated_at
before update on public.product_supplier_offers
for each row execute function public.update_product_supplier_updated_at();

create or replace function public.refresh_product_preferred_supplier(p_catalog_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  best_offer record;
begin
  select offer.id, offer.last_price_without_vat, supplier.name as supplier_name, offer.supplier_sku
  into best_offer
  from public.product_supplier_offers offer
  join public.product_suppliers supplier on supplier.id = offer.supplier_id
  where offer.catalog_item_id = p_catalog_item_id
    and offer.is_active = true
    and supplier.is_active = true
    and offer.last_price_without_vat is not null
  order by offer.last_price_without_vat asc, offer.last_seen_at desc nulls last
  limit 1;

  if best_offer.id is null then
    update public.commercial_item_catalog
    set preferred_supplier_offer_id = null,
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{supplier_price_status}', '"missing_current_price"'::jsonb, true)
    where id = p_catalog_item_id;
    return;
  end if;

  update public.commercial_item_catalog
  set preferred_supplier_offer_id = best_offer.id,
      purchase_price = best_offer.last_price_without_vat,
      metadata = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(metadata, '{}'::jsonb), '{preferred_supplier}', to_jsonb(best_offer.supplier_name), true),
          '{preferred_supplier_sku}', to_jsonb(best_offer.supplier_sku), true
        ),
        '{supplier_price_status}', '"current_price_available"'::jsonb, true
      )
  where id = p_catalog_item_id;
end;
$$;

create or replace function public.sync_product_supplier_offer_from_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_catalog_id uuid;
begin
  update public.product_supplier_offers
  set last_seen_at = greatest(coalesce(last_seen_at, new.scraped_at), new.scraped_at),
      last_price_without_vat = new.price_without_vat,
      last_price_raw = new.price_raw,
      availability_note = coalesce(new.availability_note, availability_note),
      currency = coalesce(new.currency, currency),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_snapshot_id', new.id)
  where id = new.supplier_offer_id
  returning catalog_item_id into target_catalog_id;

  if target_catalog_id is not null then
    perform public.refresh_product_preferred_supplier(target_catalog_id);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_product_supplier_offer_after_snapshot on public.product_supplier_price_snapshots;
create trigger sync_product_supplier_offer_after_snapshot
after insert or update on public.product_supplier_price_snapshots
for each row execute function public.sync_product_supplier_offer_from_snapshot();

create or replace function public.fill_crm_item_supplier_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.supplier_offer_id is null and new.catalog_item_id is not null then
    select catalog.preferred_supplier_offer_id
    into new.supplier_offer_id
    from public.commercial_item_catalog catalog
    where catalog.id = new.catalog_item_id;
  end if;

  if new.supplier_offer_id is not null and (new.supplier_name is null or new.supplier_sku_snapshot is null) then
    select supplier.name, offer.supplier_sku
    into new.supplier_name, new.supplier_sku_snapshot
    from public.product_supplier_offers offer
    join public.product_suppliers supplier on supplier.id = offer.supplier_id
    where offer.id = new.supplier_offer_id;
  end if;

  return new;
end;
$$;

drop trigger if exists fill_crm_opportunity_item_supplier_snapshot on public.crm_opportunity_items;
create trigger fill_crm_opportunity_item_supplier_snapshot
before insert or update on public.crm_opportunity_items
for each row execute function public.fill_crm_item_supplier_snapshot();

drop trigger if exists fill_crm_document_item_supplier_snapshot on public.crm_commercial_document_items;
create trigger fill_crm_document_item_supplier_snapshot
before insert or update on public.crm_commercial_document_items
for each row execute function public.fill_crm_item_supplier_snapshot();

alter table public.product_suppliers enable row level security;
alter table public.product_import_batches enable row level security;
alter table public.product_supplier_offers enable row level security;
alter table public.product_supplier_price_snapshots enable row level security;

create policy "Product suppliers read access" on public.product_suppliers for select to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module in ('crm', 'realizace', 'projects', 'settings') and role_permissions.can_read = true)
);
create policy "Product suppliers admin access" on public.product_suppliers for all to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
) with check (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
);

create policy "Product import batches read access" on public.product_import_batches for select to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module in ('crm', 'realizace', 'projects', 'settings') and role_permissions.can_read = true)
);
create policy "Product import batches admin access" on public.product_import_batches for all to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
) with check (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
);

create policy "Product supplier offers read access" on public.product_supplier_offers for select to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module in ('crm', 'realizace', 'projects', 'settings') and role_permissions.can_read = true)
);
create policy "Product supplier offers admin access" on public.product_supplier_offers for all to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
) with check (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
);

create policy "Product supplier price snapshots read access" on public.product_supplier_price_snapshots for select to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module in ('crm', 'realizace', 'projects', 'settings') and role_permissions.can_read = true)
);
create policy "Product supplier price snapshots admin access" on public.product_supplier_price_snapshots for all to authenticated using (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
) with check (
  get_user_role() = 'admin' or exists (select 1 from public.role_permissions where role_permissions.role = get_user_role() and role_permissions.module = 'settings' and role_permissions.can_admin = true)
);

grant select on public.product_suppliers to authenticated;
grant select on public.product_import_batches to authenticated;
grant select on public.product_supplier_offers to authenticated;
grant select on public.product_supplier_price_snapshots to authenticated;
grant all on public.product_suppliers to service_role;
grant all on public.product_import_batches to service_role;
grant all on public.product_supplier_offers to service_role;
grant all on public.product_supplier_price_snapshots to service_role;

drop view if exists public.product_supplier_current_prices;
create view public.product_supplier_current_prices with (security_invoker = true) as
with latest as (
  select distinct on (snapshot.supplier_offer_id)
    snapshot.supplier_offer_id, snapshot.id as snapshot_id, snapshot.import_batch_id, snapshot.scraped_at,
    snapshot.price_without_vat, snapshot.currency, snapshot.availability_note, snapshot.price_raw, snapshot.metadata
  from public.product_supplier_price_snapshots snapshot
  order by snapshot.supplier_offer_id, snapshot.scraped_at desc, snapshot.created_at desc
),
previous as (
  select ranked.supplier_offer_id, ranked.price_without_vat, ranked.scraped_at
  from (
    select snapshot.*, row_number() over (partition by snapshot.supplier_offer_id order by snapshot.scraped_at desc, snapshot.created_at desc) as price_rank
    from public.product_supplier_price_snapshots snapshot
  ) ranked
  where ranked.price_rank = 2
),
offer_counts as (
  select catalog_item_id, count(*) filter (where is_active) as supplier_offer_count
  from public.product_supplier_offers
  group by catalog_item_id
)
select
  offer.catalog_item_id,
  offer.id as supplier_offer_id,
  supplier.id as supplier_id,
  supplier.name as supplier_name,
  supplier.slug as supplier_slug,
  supplier.website_url,
  offer.supplier_sku,
  offer.supplier_product_url,
  offer.supplier_product_name,
  offer.supplier_category,
  coalesce(latest.availability_note, offer.availability_note) as availability_note,
  latest.scraped_at,
  coalesce(latest.price_without_vat, offer.last_price_without_vat) as price_without_vat,
  coalesce(latest.currency, offer.currency) as currency,
  latest.price_raw,
  previous.price_without_vat as previous_price_without_vat,
  case when coalesce(latest.price_without_vat, offer.last_price_without_vat) is not null and previous.price_without_vat is not null then round(coalesce(latest.price_without_vat, offer.last_price_without_vat) - previous.price_without_vat, 2) else null end as price_change_amount,
  case when coalesce(latest.price_without_vat, offer.last_price_without_vat) is not null and previous.price_without_vat is not null and previous.price_without_vat <> 0 then round(((coalesce(latest.price_without_vat, offer.last_price_without_vat) - previous.price_without_vat) / previous.price_without_vat * 100)::numeric, 2) else null end as price_change_percent,
  coalesce(offer_counts.supplier_offer_count, 0) as supplier_offer_count,
  row_number() over (partition by offer.catalog_item_id order by latest.price_without_vat asc nulls last, latest.scraped_at desc nulls last, supplier.name) as price_rank
from public.product_supplier_offers offer
join public.product_suppliers supplier on supplier.id = offer.supplier_id
left join latest on latest.supplier_offer_id = offer.id
left join previous on previous.supplier_offer_id = offer.id
left join offer_counts on offer_counts.catalog_item_id = offer.catalog_item_id
where offer.is_active = true and supplier.is_active = true;

drop view if exists public.product_supplier_price_history;
create view public.product_supplier_price_history with (security_invoker = true) as
select
  offer.catalog_item_id,
  offer.id as supplier_offer_id,
  supplier.id as supplier_id,
  supplier.name as supplier_name,
  supplier.slug as supplier_slug,
  offer.supplier_sku,
  offer.supplier_product_url,
  snapshot.id as snapshot_id,
  snapshot.import_batch_id,
  snapshot.scraped_at,
  snapshot.price_without_vat,
  snapshot.currency,
  snapshot.availability_note,
  snapshot.price_raw,
  snapshot.metadata
from public.product_supplier_price_snapshots snapshot
join public.product_supplier_offers offer on offer.id = snapshot.supplier_offer_id
join public.product_suppliers supplier on supplier.id = offer.supplier_id;

grant select on public.product_supplier_current_prices to authenticated;
grant select on public.product_supplier_price_history to authenticated;

insert into public.product_suppliers (slug, name, website_url, metadata)
values ('krannich-solar', 'Krannich Solar', 'https://shop.krannich-solar.com/', jsonb_build_object('source', 'initial_catalog_backfill'))
on conflict (slug) do update set name = excluded.name, website_url = excluded.website_url, is_active = true, metadata = public.product_suppliers.metadata || excluded.metadata;

with supplier_row as (
  select id from public.product_suppliers where slug = 'krannich-solar'
),
krannich_catalog as (
  select *
  from public.commercial_item_catalog
  where coalesce(metadata->>'supplier', '') = 'Krannich Solar'
     or coalesce(metadata->>'vendor_import', '') = 'krannich_20260704'
     or coalesce(metadata->>'source_url', '') like 'https://shop.krannich-solar.com/%'
),
batch_insert as (
  insert into public.product_import_batches (supplier_id, source_slug, source_name, imported_at, item_count, priced_item_count, status, source_file, metadata)
  select supplier_row.id, 'krannich_20260704_catalog_backfill', 'Krannich Solar catalog backfill', coalesce(max(nullif(krannich_catalog.metadata->>'scraped_at', '')::timestamptz), now()), count(*)::integer, count(*) filter (where krannich_catalog.purchase_price > 0)::integer, 'completed', 'data/vendor-imports/krannich_products_20260704.json', jsonb_build_object('note', 'Backfilled from commercial_item_catalog after initial Krannich import.')
  from supplier_row cross join krannich_catalog
  group by supplier_row.id
  having count(*) > 0
  returning id
),
offer_source as (
  select
    krannich_catalog.id as catalog_item_id,
    supplier_row.id as supplier_id,
    coalesce(nullif(krannich_catalog.metadata->>'supplier_sku', ''), nullif(krannich_catalog.sku, ''), nullif(krannich_catalog.code, '')) as supplier_sku,
    krannich_catalog.metadata->>'source_url' as supplier_product_url,
    krannich_catalog.name as supplier_product_name,
    coalesce(nullif(krannich_catalog.metadata->>'supplier_category', ''), krannich_catalog.category) as supplier_category,
    krannich_catalog.metadata->>'availability_note' as availability_note,
    coalesce(nullif(krannich_catalog.currency, ''), 'CZK') as currency,
    krannich_catalog.purchase_price as price_without_vat,
    krannich_catalog.metadata->>'price_raw' as price_raw,
    coalesce(nullif(krannich_catalog.metadata->>'scraped_at', '')::timestamptz, now()) as scraped_at,
    krannich_catalog.metadata as metadata
  from krannich_catalog cross join supplier_row
  where coalesce(nullif(krannich_catalog.metadata->>'supplier_sku', ''), nullif(krannich_catalog.sku, ''), nullif(krannich_catalog.code, '')) is not null
),
upserted_offers as (
  insert into public.product_supplier_offers (catalog_item_id, supplier_id, supplier_sku, supplier_product_url, supplier_product_name, supplier_category, availability_note, currency, is_active, last_seen_at, last_price_without_vat, last_price_raw, metadata)
  select catalog_item_id, supplier_id, supplier_sku, supplier_product_url, supplier_product_name, supplier_category, availability_note, currency, true, scraped_at, nullif(price_without_vat, 0), price_raw, metadata || jsonb_build_object('matching_strategy', 'supplier_sku_backfill')
  from offer_source
  on conflict (supplier_id, lower(supplier_sku)) where supplier_sku is not null and supplier_sku <> ''
  do update set catalog_item_id = excluded.catalog_item_id, supplier_product_url = excluded.supplier_product_url, supplier_product_name = excluded.supplier_product_name, supplier_category = excluded.supplier_category, availability_note = excluded.availability_note, currency = excluded.currency, is_active = true, last_seen_at = excluded.last_seen_at, last_price_without_vat = excluded.last_price_without_vat, last_price_raw = excluded.last_price_raw, metadata = public.product_supplier_offers.metadata || excluded.metadata
  returning id, supplier_id, supplier_sku
)
insert into public.product_supplier_price_snapshots (supplier_offer_id, import_batch_id, scraped_at, price_without_vat, currency, availability_note, price_raw, metadata)
select offer.id, (select id from batch_insert limit 1), offer_source.scraped_at, nullif(offer_source.price_without_vat, 0), offer_source.currency, offer_source.availability_note, offer_source.price_raw, offer_source.metadata || jsonb_build_object('source', 'catalog_backfill')
from offer_source
join public.product_supplier_offers offer on offer.supplier_id = offer_source.supplier_id and lower(offer.supplier_sku) = lower(offer_source.supplier_sku)
on conflict do nothing;
update public.product_supplier_price_snapshots snapshot
set price_without_vat = offer.last_price_without_vat,
    currency = coalesce(snapshot.currency, offer.currency),
    availability_note = coalesce(snapshot.availability_note, offer.availability_note)
from public.product_supplier_offers offer
where snapshot.supplier_offer_id = offer.id
  and snapshot.price_without_vat is null
  and offer.last_price_without_vat is not null;
insert into public.product_supplier_price_snapshots (supplier_offer_id, scraped_at, price_without_vat, currency, availability_note, price_raw, metadata)
select offer.id,
       coalesce(offer.last_seen_at, now()),
       offer.last_price_without_vat,
       offer.currency,
       offer.availability_note,
       offer.last_price_raw,
       offer.metadata || jsonb_build_object('source', 'offer_baseline_backfill')
from public.product_supplier_offers offer
join public.product_suppliers supplier on supplier.id = offer.supplier_id
where supplier.slug = 'krannich-solar'
  and offer.last_price_without_vat is not null
  and not exists (
    select 1
    from public.product_supplier_price_snapshots snapshot
    where snapshot.supplier_offer_id = offer.id
      and snapshot.scraped_at = coalesce(offer.last_seen_at, now())
      and snapshot.price_without_vat = offer.last_price_without_vat
  );
do $$
declare
  catalog_record record;
begin
  for catalog_record in select distinct catalog_item_id from public.product_supplier_offers loop
    perform public.refresh_product_preferred_supplier(catalog_record.catalog_item_id);
  end loop;
end $$;
