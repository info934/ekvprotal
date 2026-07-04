-- Register BayWa r.e. Solar Distribution as an active product supplier source.
-- Product price imports from this source use the shared supplier-offer/snapshot model.

insert into public.product_suppliers (slug, name, website_url, is_active, metadata)
values (
  'baywa-re',
  'BayWa r.e. Solar Distribution',
  'https://solar-distribution.baywa-re.cz/cz/',
  true,
  jsonb_build_object(
    'source', 'manual_supplier_registration',
    'login_hint', 'uses_same_account_as_krannich_per_owner',
    'supported_categories', jsonb_build_array('Panely', 'Stridace', 'Baterie', 'Konstrukce', 'Wallbox', 'Prislusenstvi'),
    'import_format', 'normalized_supplier_price_export_v1',
    'matching_policy', 'exact supplier SKU/EAN/MPN first; unclear cross-shop matches require manual review'
  )
)
on conflict (slug) do update
set name = excluded.name,
    website_url = excluded.website_url,
    is_active = true,
    metadata = coalesce(public.product_suppliers.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();