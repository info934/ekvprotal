# Portal operations release — 2026-09-06

## Release

- Source commit: `37a44135fb28be501763bd066c41152f433586e3`
- Release ID: `ekvportal-2.0-20260906T124736Z`
- Release archive SHA-256: `39561acaf1249408377249e07e17a9b2b3189944eb7f2c4c613bd3315c9f0953`
- Production image: `sha256:50601d10ec69161c224b19817969909198b333d6ab5ce908baa0f2111e7bcfe4`
- Active path: `/opt/ekvportal-releases/ekvportal-2.0-20260906T124736Z`
- Supabase migration: `20260906213000_portal_operations_upgrade.sql`

## Activated capabilities

- Reliable SharePoint operation status, retries and folder repair.
- Installable PWA and idempotent offline service visits with compressed photos.
- Mobile service wizard, SLA policies, technician planning, normalized costs and CRM offer conversion.
- Customer-safe service status links and documents.
- CRM activity retry, stale-opportunity attention, configurable commercial offer approval.
- Grouped global search, richer notifications, My Work links and cross-device saved views.

All release flags were activated together after smoke testing: `storage_operations_v2`, `service_offline_v1`, `service_workflow_v2`, `crm_approval_v1`, and `workspace_ux_v2`.

## Backups and rollback

- Database backup: `output/backups/supabase-yurysbxxevtuvhrbmloc-20260906T124212Z.tar.gz`
- Database backup SHA-256: `f13be15b73c363c7385a87d6cbfb53aeec920906ed3a6dc5c37df72863ac84e1`
- Server backup: `/opt/ekvportal-backups/20260906T124212Z/release.tar.gz`
- Server backup SHA-256: `79f1dad8106564cfa5335fba0dfc47031aaef4155c8a6e4a341e2b8d08892cf6`
- Previous release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T092357Z`
- Rollback image: `ekvportal:rollback-20260906T124212Z`

The database migration is additive. A frontend rollback switches `/opt/ekvportal` to the previous release, retags the rollback image as `ekvportal:latest`, and recreates the compose service with the existing `.env`.

## Validation

- Production build passed locally and inside the production Docker build.
- 201 workflow tests passed.
- Portal operations upgrade tests passed: offline idempotency, retry handling, customer-data separation and offer-send blocking.
- Critical route, security/RLS, UI and migration checks passed.
- Visual checks passed at 390 × 844, 768 × 1024 and desktop width.
- Candidate image passed HTTP checks for `/`, `/manifest.webmanifest`, `/sw.js` and the public service-status SPA route.
- Production container became healthy and had no error/fatal/panic log entries after activation.
- The server receives HTTP 200 through `https://portal.ekvproject.cz/`.

The public certificate is still reported as untrusted by the Windows client (`ERR_CERT_AUTHORITY_INVALID`). HTTPS/DNS remediation was explicitly outside this release scope and remains a separate infrastructure task.
