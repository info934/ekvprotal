# Vendor Product Price Imports

This folder stores exports and generated SQL for supplier product price imports.

## Supplier model

Products stay canonical in `commercial_item_catalog`. Supplier-specific products and prices are stored in:

- `product_suppliers`
- `product_supplier_offers`
- `product_supplier_price_snapshots`
- `product_import_batches`

The app always prefers the lowest active supplier price as `commercial_item_catalog.purchase_price`, but CRM OP/NAB/OBJ items keep supplier price snapshots so old offers do not change after future scraping.

## BayWa r.e. Solar Distribution

Source URL: `https://solar-distribution.baywa-re.cz/cz/`

Login is expected to use the same account as the Krannich import, but credentials must not be stored in this repository.

Recommended export naming:

- `data/vendor-imports/baywa_products_YYYYMMDD.csv`
- `data/vendor-imports/baywa_products_YYYYMMDD.json`
- generated SQL: `data/vendor-imports/baywa_products_YYYYMMDD_import.sql`

Expected columns are flexible. Preferred normalized columns:

```csv
supplier_sku;name;description;category;brand;price_czk_without_vat;price_raw;unit;availability;detail_url;image_url;scraped_at;ean;mpn;catalog_sku
```

`catalog_sku` is optional but recommended when BayWa SKU differs from the canonical portal product SKU. Without it, the importer only matches safely by exact `sku`, `code`, `ean`, or `mpn`; unclear cross-shop matches must be reviewed manually.

Generate SQL:

```powershell
node tools/import-supplier-price-export.mjs `
  --input data/vendor-imports/baywa_products_YYYYMMDD.csv `
  --supplier baywa-re `
  --name "BayWa r.e. Solar Distribution" `
  --website "https://solar-distribution.baywa-re.cz/cz/" `
  --out data/vendor-imports/baywa_products_YYYYMMDD_import.sql
```

Apply SQL after review:

```powershell
$env:SUPABASE_ACCESS_TOKEN='<token>'
.\node_modules\supabase\bin\supabase.exe db query --linked --file .\data\vendor-imports\baywa_products_YYYYMMDD_import.sql --output table
```

Verification:

```sql
select supplier_name, count(*) as rows, min(price_without_vat), max(price_without_vat)
from product_supplier_current_prices
group by supplier_name
order by supplier_name;
```