# Isolated UI preview

Run `npm run preview:ui`, or `node node_modules/vite/bin/vite.js --config vite.preview.config.mjs` when npm is not on PATH. Open `http://127.0.0.1:4174/`. The server binds to loopback only.

This renders the real `src/App.jsx` and feature components. Only the backend module and auth provider are replaced through the separate Vite config. `vite.config.js`, the production entry and production authorization remain unchanged. Environment files are not loaded. A visible **Ukázková data** toolbar identifies the preview and switches between administrator and worker views.

Fixtures default to 5 September 2026. Use `?previewRole=member&previewDate=2026-09-05` to choose the initial role and date. The clock advances normally from the selected morning. Sample project: `/projects/26090500-0000-4000-8000-000000000301`.

The adapter supports list/detail queries, search, joins, counts, pagination, task edits, attendance entries and selected status changes entirely in browser memory. Reset restores fixtures. Email, document storage, authentication and unsupported RPC operations return an explicit unavailable error. Browser CSP and the preview fetch guard block external requests.

The employee center (`/employee`, administrator management `/employees/26090500-0000-4000-8000-000000000002`) has explicit active profiles, issued equipment, verified/pending records and requests. The employee RPC simulation supports profile activation, asset assignment/return, document verification and request creation/approval/rejection/fulfillment/own cancellation, with an append-only actor history. Identical creation retries for requests, assets and records reuse the supplied stable ID without changing timestamps; conflicting payloads are rejected. Worker queries expose only their own records under an active profile; administrator queries expose all employee records. These bounded role checks support UI testing; they do not verify database RLS, concurrency, transactions or production security.

Canonical project/realization finance fixtures are calculated from the local jobs, cost rows, reward assignments and payout items. `get_entity_billing_summary` supplies the overview billing stages. `get_realization_reward_plan` supplies form team shares. Member financial screens can use compensation, rewards and the existing `get_payout_availability` response (`projects`, `realizations`). The legacy balance RPCs are also supported. No invoice, payout or employee request is submitted to a server.

Run `node src/preview/test-preview.mjs` for query and source isolation checks. The production bundle marker check is skipped when `dist/` is absent; repeat after a normal production build. `npm run preview:ui:build` writes a separate, clearly labeled preview build to `build/ui-preview/`; never deploy it as the production portal.

For local browser tests, `window.__EKV_PREVIEW__` exposes `getRole()`, `setRole('admin' | 'member')` and `resetData()`.
