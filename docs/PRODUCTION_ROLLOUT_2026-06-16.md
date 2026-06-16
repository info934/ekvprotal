# Production Rollout - Financial Backend, CRM Items, Payout Workflow

Date: 2026-06-16
Target branch: `main`
Target commit: `b0ebe43967b8a0614af6f4d38f4fa2914651bb82`
Supabase project ref: `yurysbxxevtuvhrbmloc`
App server from deployment docs: `192.168.1.180`, app checkout `/opt/ekvportal`

## Scope

This rollout integrates:

- backend payout availability and payout workflow RPC functions
- backend financial summary read models
- member project reward read models
- CRM item atomic replace RPC functions
- payout UI improvements for editing/deleting own pending requests
- CRM item snapshot UI
- HTML template sanitization

Do not deploy or import local seed files:

- `supabase/seed.sql`
- `supabase/seed.anonymized.sql`

Do not run `supabase db reset` on production.

## Current Preparation Status

- Commit is pushed to `origin/main`.
- Local checks passed before push:
  - `npm run lint`
  - `npm run build`
  - `supabase migration up --local`
- SSH from the local Codex workspace to `root@192.168.1.180` is not currently authenticated. Server-side steps need to be run manually or after SSH access is fixed.

## Important Migration Note

The repository now contains `supabase/migrations/00000000000000_baseline.sql` as a schema baseline. For the live Supabase project, do not blindly run `supabase db push` unless migration history has been reviewed first.

For this release, apply only the release SQL files listed below to the existing production database.

## Supabase Preflight

Create a production schema backup before applying SQL:

```bash
cd /opt/ekvportal
mkdir -p backups
supabase link --project-ref yurysbxxevtuvhrbmloc
supabase db dump --schema public --file backups/prod_schema_before_20260616.sql
```

Confirm the frontend `.env` on the server still points to production Supabase:

```bash
cd /opt/ekvportal
grep -E '^(APP_PORT|VITE_SUPABASE_URL)=' .env
```

Expected:

```text
APP_PORT=8080
VITE_SUPABASE_URL=https://yurysbxxevtuvhrbmloc.supabase.co
```

## SQL Apply Order

Apply these files in this exact order through the Supabase SQL editor or Supabase CLI.

```text
supabase/migrations/20260513170000_backend_payout_availability.sql
supabase/migrations/20260605214500_financial_summary_read_models.sql
supabase/migrations/20260605223000_member_project_reward_read_models.sql
supabase/migrations/20260605233000_crm_item_atomic_replace.sql
supabase/migrations/20260616234727_allow_owner_delete_pending_payout.sql
```

CLI form, after `supabase link` and auth are ready:

```bash
cd /opt/ekvportal
supabase db query --file supabase/migrations/20260513170000_backend_payout_availability.sql
supabase db query --file supabase/migrations/20260605214500_financial_summary_read_models.sql
supabase db query --file supabase/migrations/20260605223000_member_project_reward_read_models.sql
supabase db query --file supabase/migrations/20260605233000_crm_item_atomic_replace.sql
supabase db query --file supabase/migrations/20260616234727_allow_owner_delete_pending_payout.sql
```

If the CLI on the server does not support `db query --file`, use the Supabase Dashboard SQL editor and paste each file separately.

## SQL Smoke Checks

Run these checks in Supabase SQL editor after applying migrations:

```sql
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'get_payout_availability',
    'create_payout_request',
    'update_payout_request',
    'approve_payout',
    'reject_payout',
    'upload_payout_invoice',
    'mark_payout_paid',
    'delete_payout_request',
    'project_financial_summary',
    'realization_financial_summary',
    'get_member_project_rewards',
    'get_project_order_reward',
    'replace_crm_opportunity_items',
    'replace_crm_document_items'
  )
order by proname;
```

Expected: all listed functions are present.

Also confirm grants are present:

```sql
select routine_name, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and grantee = 'authenticated'
  and routine_name in (
    'get_payout_availability',
    'create_payout_request',
    'update_payout_request',
    'delete_payout_request',
    'project_financial_summary',
    'realization_financial_summary',
    'get_member_project_rewards',
    'replace_crm_opportunity_items',
    'replace_crm_document_items'
  )
order by routine_name;
```

## App Server Deployment

After SQL is applied successfully:

```bash
ssh root@192.168.1.180
cd /opt/ekvportal
git fetch origin main
git status --short --branch
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
docker image prune -f
```

Verify locally on the server:

```bash
curl -I http://127.0.0.1:8080
docker compose logs --tail=100 ekvportal
nginx -t
systemctl status nginx --no-pager
```

Expected `curl` result: HTTP 200 or 304 from the app container/proxy path.

## Browser Smoke Checklist

Run against `https://portal.ekvproject.cz` after deploy:

- Login succeeds.
- `Výplaty` loads without console/RPC errors.
- A user can open their own pending payout request and edit it.
- A user can delete their own pending payout request only before approval.
- Approved/paid payout requests do not expose user edit/delete actions.
- Payout list shows request items with per-item amounts.
- Project detail finance tab loads backend summary values.
- Realization detail finance section loads backend summary values.
- CRM opportunity item edit saves successfully.
- CRM offer/order item edit saves successfully.
- Document template preview/generation still renders sanitized HTML correctly.

## Rollback Notes

Frontend rollback:

```bash
cd /opt/ekvportal
git checkout 57527c7
docker compose up -d --build
```

Database rollback is not a simple down migration because this release creates/replaces functions. Prefer forward-fix for function-level issues. If immediate mitigation is needed, redeploy the previous frontend commit first; the new backend functions can remain present without being called by the previous frontend.

Return to `main` after rollback testing:

```bash
cd /opt/ekvportal
git checkout main
git pull --ff-only origin main
```
