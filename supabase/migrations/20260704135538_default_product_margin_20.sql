-- Set default commercial catalog margin to 20% and keep supplier refreshes aligned.

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
      default_unit_price = case
        when best_offer.last_price_without_vat > 0 then round(best_offer.last_price_without_vat / 0.8, 2)
        else default_unit_price
      end,
      metadata = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(metadata, '{}'::jsonb), '{preferred_supplier}', to_jsonb(best_offer.supplier_name), true),
            '{preferred_supplier_sku}', to_jsonb(best_offer.supplier_sku), true
          ),
          '{supplier_price_status}', '"current_price_available"'::jsonb, true
        ),
        '{default_margin_percent}', '20'::jsonb, true
      )
  where id = p_catalog_item_id;
end;
$$;

update public.commercial_item_catalog
set default_unit_price = round(purchase_price / 0.8, 2),
    metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{default_margin_percent}', '20'::jsonb, true),
    updated_at = now()
where purchase_price > 0;
