# Supabase Local Development

This project is being moved toward a reproducible Supabase workflow. Production currently remains the source of truth because the live Supabase project reports no migrations.

## Prerequisites

- Docker Desktop
- Supabase CLI
- Node.js 20.19.1 for the frontend

## Start Local Supabase

```powershell
supabase start
supabase status
```

Copy the local API URL and anon key from `supabase status` into `.env.local`.

## Frontend Local Env

```powershell
Copy-Item .env.local.example .env.local
```

Then edit `.env.local`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key-from-supabase-status>
```

## Production Baseline Export

Run only when authenticated to Supabase CLI and intentionally exporting schema:

```powershell
supabase link --project-ref yurysbxxevtuvhrbmloc
supabase db dump --schema public --file supabase/migrations/00000000000000_baseline.sql
```

For local seed data, prefer anonymized data:

```powershell
supabase db dump --data-only --schema public --file supabase/seed.sql
```

Before committing, inspect `supabase/seed.sql` and remove sensitive production data.

## Edge Functions Gap

Production has these functions now captured in this repository as a baseline:

- `manage-users`
- `send-message-to-member`
- `send-email`
- `send-payout-email`
- `send-admin-payout-notification`
- `send-payout-notification`

Local backend work still requires matching secrets, especially `RESEND_API_KEY`, `FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `VITE_SITE_URL`.
