-- Keep catalog KPIs and filter facets server-side so the products page does
-- not need to download the complete catalog just to render its header.
create or replace function public.get_product_catalog_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with catalog as (
    select
      item.id,
      item.category,
      item.product_type,
      item.default_unit_price,
      item.purchase_price,
      item.stock_min_qty,
      item.is_active,
      item.archived_at,
      nullif(trim(coalesce(
        item.metadata ->> 'brand',
        item.metadata ->> 'manufacturer',
        item.metadata ->> 'vyrobce'
      )), '') as brand
    from public.commercial_item_catalog item
  ),
  totals as (
    select
      count(*)::bigint as total_count,
      count(*) filter (where is_active and archived_at is null)::bigint as active_count,
      count(*) filter (where product_type = 'manufactured')::bigint as manufactured_count,
      coalesce(sum(default_unit_price) filter (where is_active and archived_at is null), 0)::numeric as sale_value,
      coalesce(sum(default_unit_price - coalesce(purchase_price, 0)) filter (where is_active and archived_at is null), 0)::numeric as margin_value
    from catalog
  ),
  low_stock as (
    select count(*)::bigint as low_stock_count
    from catalog
    join public.product_stock_status stock on stock.catalog_item_id = catalog.id
    where catalog.product_type = 'manufactured'
      and coalesce(catalog.stock_min_qty, 0) > 0
      and coalesce(stock.available_qty, 0) <= catalog.stock_min_qty
  ),
  tracked as (
    select count(distinct prices.catalog_item_id)::bigint as tracked_prices_count
    from public.product_supplier_current_prices prices
    where prices.price_without_vat is not null
  ),
  categories as (
    select coalesce(jsonb_agg(category order by category), '[]'::jsonb) as values
    from (select distinct category from catalog where nullif(trim(category), '') is not null) value_list
  ),
  brands as (
    select coalesce(jsonb_agg(brand order by brand), '[]'::jsonb) as values
    from (select distinct brand from catalog where brand is not null) value_list
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', totals.total_count,
      'active', totals.active_count,
      'manufactured', totals.manufactured_count,
      'lowStock', low_stock.low_stock_count,
      'saleValue', totals.sale_value,
      'marginValue', totals.margin_value,
      'trackedPrices', tracked.tracked_prices_count
    ),
    'categories', categories.values,
    'brands', brands.values
  )
  from totals
  cross join low_stock
  cross join tracked
  cross join categories
  cross join brands;
$$;

revoke all on function public.get_product_catalog_overview() from public;
grant execute on function public.get_product_catalog_overview() to authenticated;

