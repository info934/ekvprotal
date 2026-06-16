# CRM and Products Test Log

Date: 2026-06-05

## Scope

- Tested only local development data and local Supabase.
- Production database and production portal were not modified.
- Dummy data was intentionally left in the local database for future debugging.
- Local app URL: `http://192.168.1.193:3003/`

## Dummy Data Created

### SQL Seeded Test Set

Marker: `CODEx CRM TEST 20260605203237`

- Subject: `177b88da-5422-43c9-b984-38ccf3e0674c`
- Service product: `f76a2f95-8983-4ac6-94c8-585191881010`
- Manufactured product: `1d61b164-6a51-436c-8ab5-3a8c3ac34447`
- Opportunity: `f3b0f0f8-a73d-45a1-a5b6-0aa0c4fa32e1`
- Offer document: `2016af9a-b2bd-47cc-b72b-b62467a13cbe`
- Order document: `27b80388-f1c6-43a8-b415-1568f32c4ffa`

Created coverage:

- CRM subject with contact fields.
- Two catalog items: service and manufactured product.
- Product stock movements: receipt, reservation, issue.
- CRM opportunity with two line items.
- Offer document with two line items.
- Order document with two line items.
- CRM activity and note.

Verified values:

- Product stock status for `1d61b164-6a51-436c-8ab5-3a8c3ac34447`:
  - stock: `9`
  - reserved: `3`
  - available: `6`
- Opportunity `CODEx-OP-203237`:
  - stored value: `81875`
  - item total: `81875`
- Offer `CODEx-NAB-203237`:
  - status: `sent`
  - item count: `2`
  - item total: `81875`
- Order `CODEx-OBJ-203237`:
  - status: `accepted`
  - item count: `2`
  - item total: `81875`

### Authenticated REST Test Set

Marker: `CODEx REST E2E 20260605203949`

- Subject: `ecade20b-0a56-4fab-b241-fe7b61a9a1a9`
- Manufactured product: `7e029df3-2e93-45b9-9d49-33666899b937`
- Service product: `e0523d8a-321d-4fa6-b93a-2fd37513170d`
- Opportunity: `bc86c2d3-e59e-4191-9a8d-09abd78402f8`
- Offer document: `c27b421a-4bf8-4e93-857c-af09cb9c1ffc`
- Order document: `8869267f-0266-428d-807f-f1bf4f7a2146`

Created coverage through authenticated REST:

- Subject insert.
- Product insert for service and manufactured item.
- Stock movement insert for receipt and reservation.
- Opportunity insert and update.
- Opportunity item inserts.
- Offer and order document inserts.
- Offer and order item inserts.
- CRM activity insert.
- Product PATCH update.

Verified values:

- Opportunity item count: `2`
- Opportunity value: `35220`
- Product stock for `7e029df3-2e93-45b9-9d49-33666899b937`:
  - stock: `7`
  - reserved: `2`
  - available: `5`
- Product usage:
  - opportunity rows: `1`
  - document rows: `2`
- Product update check:
  - `default_unit_price` updated to `10100`
  - metadata flag `rest_update_checked` stored as `true`

## Frontend-Equivalent Query Verification

Authenticated nested REST selects were used to mirror the data shape consumed by CRM and product pages.

Verified counts:

- CRM rows found for dummy markers: `2`
- CRM opportunity items: `4`
- Commercial documents: `4`
- Commercial document items: `8`
- Products found for dummy markers: `4`

The result included both SQL-created and REST-created products and services.

## Browser E2E Notes

Playwright was used against the local Vite app. Login and route navigation are reachable, and a product edit/detail route loaded for:

- `http://localhost:3003/products/1d61b164-6a51-436c-8ab5-3a8c3ac34447/edit`

Observed limitation:

- After local Supabase resets and Vite restarts, Playwright sometimes stays on auth/module loading screens such as `Nacitam portal`, `Overujeme relaci`, or `Nacitam modul`.
- Earlier console output also showed a transient dynamic import `ERR_NETWORK_CHANGED` during dev-server changes.
- Because of that local browser-session instability, browser list-view visibility of all dummy CRM/product rows remains inconclusive.
- Authenticated REST and frontend-equivalent nested selects passed, so backend data, RLS access, and query shapes are verified.

## Finding

PostgREST batch inserts require all objects in a batch to have the same JSON keys. One initial batch insert for `crm_opportunity_items` failed because one row omitted a nullable key that another row included.

Resolution used in the test:

- Include the nullable key explicitly with `null` in every batch object.

Recommendation:

- Frontend and import code should normalize batch payloads before insert so every object has the same keys.

## Follow-Up Improvement Implemented

Implemented after the test:

- Added shared frontend helper `src/lib/crmItemPayloads.js`.
- CRM opportunity items and commercial document items now use the same payload builder.
- Batch payloads always include the same nullable snapshot keys:
  - `product_sku`
  - `product_type`
  - `stock_available_snapshot`
  - `catalog_price_snapshot`
- Product selection in CRM and commercial documents now loads product `sku`, `product_type`, and current availability from `product_stock_status`.
- Selected catalog products store price and availability snapshots into CRM/document item rows.
- Existing duplicate local line-total and totals calculations in CRM document screens were replaced by the shared helper.

Follow-up smoke check:

- Payload key consistency check passed.
- Snapshot field presence check passed for opportunity and document item payloads.

## Backend Atomic Save Improvement

Implemented after the first frontend payload fix:

- Added migration `supabase/migrations/20260605233000_crm_item_atomic_replace.sql`.
- Added backend permission helper:
  - `can_edit_crm()`
- Added transactional RPC functions:
  - `replace_crm_opportunity_items(p_opportunity_id, p_items, p_sync_documents)`
  - `replace_crm_document_items(p_document_id, p_items)`

Behavior:

- Replaces all items for one CRM opportunity or commercial document in one database function call.
- Recalculates line totals, tax total, document totals, and opportunity value in the database.
- Keeps nullable product snapshot fields explicit.
- Synchronizes CRM opportunity items to all linked commercial documents where `sync_items = true`.
- Uses existing CRM role permission rules before writing.

Frontend wiring:

- `src/components/CRM.jsx` now uses `replace_crm_opportunity_items` for opportunity item edits.
- `src/components/CRMCommercialDocuments.jsx` now uses:
  - `replace_crm_opportunity_items` for synchronized document edits.
  - `replace_crm_document_items` for independent document item edits.
- Both frontend paths keep a fallback to the previous direct delete/insert flow if the RPC migration is not available yet.

Local migration application:

- Applied locally with `supabase migration up --local`.
- No `db reset` was used, so local dummy data was kept.

Backend smoke checks:

- `replace_crm_opportunity_items` passed on dummy opportunity `bc86c2d3-e59e-4191-9a8d-09abd78402f8`.
  - total: `35220`
  - item count: `2`
  - synchronized document count: `2`
  - each synchronized document has `2` items
  - snapshot fields present
- `replace_crm_document_items` passed on dummy document `c27b421a-4bf8-4e93-857c-af09cb9c1ffc`.
  - total: `35220`
  - item count: `2`
  - snapshot fields present

## CRM Product Snapshot UI Improvement

Implemented after the atomic backend save:

- Added shared UI component `src/components/CrmItemSnapshotBadges.jsx`.
- CRM opportunity product rows now display:
  - product type badge (`Služba` or `Sklad`)
  - stock availability snapshot for manufactured products
  - catalog price snapshot
  - visual warning when item quantity is greater than the saved stock snapshot
- CRM offer/order item rows now display the same snapshot badges.
- Product catalog dropdowns in CRM and commercial documents now show the same product metadata before selecting an item.

REST verification:

- Dummy opportunity `bc86c2d3-e59e-4191-9a8d-09abd78402f8` has `2` item rows with visible badge data.
- Service row:
  - `product_type`: `service`
  - `catalog_price_snapshot`: `1450`
- Manufactured product row:
  - `product_type`: `manufactured`
  - `stock_available_snapshot`: `5`
  - `catalog_price_snapshot`: `9900`

E2E note:

- A Playwright smoke run was attempted through the testing workflow.
- It was blocked before opening the app because the wrapper attempted to fetch `@playwright/cli` from npm and hit DNS `EAI_AGAIN`.
- Lint, build, and authenticated REST verification passed.

## Verification Commands

- `npm run lint` passed.
- `npm run build` passed.
