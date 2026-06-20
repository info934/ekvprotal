# EKVPortal Freeze State - 2026-06-20

## Goal

Prepare a production-ready baseline before starting the SharePoint document-storage integration.

Freeze means:

- no known P0/P1 workflow blocker remains open
- CRM, products, documents, payouts, attendance, projects, realizations, settings and public order routes have smoke coverage
- `npm run lint`, `npm run build` and `npm run backend:check` pass on the release candidate
- production VM 108 is checked against the intended Git commit before rollout

## Current Baseline

- Repo: `/root/ekvportal`
- Branch: `main`
- Remote: `git@github.com:info934/ekvprotal.git`
- Freeze focus: stabilize existing modules, especially CRM and product catalog, before adding SharePoint behavior
- SharePoint status: data model and settings UI exist; `document-storage` Edge Function still returns `501` for external providers until Microsoft Graph client is implemented

## Verification Status

Local checks run on 2026-06-20:

- `npm run lint`: passed
- `npm run build`: passed
- `npm run backend:check`: passed
- `curl -I http://127.0.0.1:3000/crm`: HTTP 200 from Vite dev server

Browser smoke status:

- Playwright login/navigation reached protected routes, but the app stayed on the auth loader.
- Browser console shows Supabase client `TypeError: Failed to fetch` on protected routes.
- Supabase CLI reports local stack running at `http://127.0.0.1:54321`.
- Local ignored `.env.local` currently points `VITE_SUPABASE_URL` to `http://192.168.1.193:54321`, not the running local stack.
- Treat this as an environment/auth smoke blocker to resolve before declaring the freeze complete.

## Module Review Matrix

| Module | Key workflows | Freeze checks |
| --- | --- | --- |
| Dashboard | KPIs, portal status, summary cards | loads without RPC errors, values match visible module state, mobile layout has no overlap |
| Projekce | list, create/edit, detail, finance, templates | status workflow, finance RPCs, project document upload, CRM link |
| Realizace | list, detail, orders, team, costs, finance | realization read models, order workflow, cost invoices, status transitions |
| CRM | dashboard, opportunities, stages, activities, offers, orders | `/crm`, `/crm/opportunities`, opportunity detail, create/edit, lost reason, document generation |
| Produkty | catalog, product form, stock movements, datasheets | SKU/code uniqueness behavior, active/archive filters, stock status, datasheet storage metadata |
| Subjekty | address book, subject detail, ARES, CRM reuse | no duplicate CRM company table, subject select creates usable records |
| Dokumenty | project documents, external storage metadata | Supabase fallback works, external provider warning is clear, download/open behavior is stable |
| Výplaty | task-based payouts, hourly payouts, admin workflow | availability RPC, approval transitions, invoice upload, paid marking, audit log |
| Docházka | records, monthly submission, admin approval | RPC-only mutations, submitted month lock, approved month supports hourly payout |
| Finance/režie | overhead costs, allocations, reports | admin-only routes, calculations, export/report views |
| Nastavení | users, permissions, dictionaries, CRM, storage | admin guards, settings persistence, storage provider config |
| Public order routes | `/order/:token`, `/sub-order/:token` | unauthenticated access still works, token pages do not depend on private shell |

## CRM Freeze Acceptance

- `/crm` first screen shows pipeline, risks, documents and product readiness.
- `/crm/opportunities` keeps table-oriented opportunity review.
- Opportunity detail still supports stage changes, lost reason, project/realization creation, offer/order creation and document export.
- Opportunity items still save through `replace_crm_opportunity_items`; fallback remains only for older DBs.
- Products remain the single catalog source for CRM items, offers and orders.
- `/products` now exposes freeze checks for missing code, missing active price, missing manufactured-product datasheets and expired active products.
- `/crm/offers` and `/crm/orders` now expose freeze checks for draft/sent documents, expired open documents, empty documents and total document value.

## SharePoint Handoff

Start SharePoint only after this file is updated with:

- release candidate commit
- passing check results
- production VM 108 status
- known non-blocking issues

The first SharePoint slice should implement Microsoft Graph inside `supabase/functions/document-storage/index.ts` for `ensureFolder`, `uploadFile` and `downloadUrl`, using existing `document_storage_connections` and `document_storage_folders`.
