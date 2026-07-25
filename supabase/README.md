# Supabase Development And Migrations

The online Supabase project is the production database. This repository keeps a
schema baseline, timestamped forward migrations, Edge Functions, and optional
local seed data.

## Directory Layout

- `migrations/` - executable, ordered schema changes only.
- `functions/` - Supabase Edge Functions.
- `manual/` - review-only SQL that is never part of automated migration runs.
- `seed.sql` - optional local seed data; it must not contain production secrets
  or personal data.
- `config.toml` - local Supabase configuration.

## Migration Rules

Every active migration must:

1. use `YYYYMMDDHHMMSS_snake_case.sql`,
2. have a unique timestamp,
3. be forward-only and safe for the current production schema,
4. use idempotent guards where practical,
5. preserve existing financial and audit data,
6. never be renamed or edited after it has been applied.

Run the repository guard before review or deployment:

```powershell
pnpm migrations:check
```

Manual snippets, diagnostics, and superseded SQL belong in `manual/`, not in
`migrations/`.

## Historical Migration Drift

The project predates the current migration workflow. Production migration
metadata and older local files therefore do not match one-to-one. The
`00000000000000_baseline.sql` file captures the historical schema, while later
timestamped files describe forward changes.

Do not resolve historical drift by blindly running `supabase db push` or by
marking every local migration as applied. Some historical files contain schema
or seed operations that production already received through older manual
rollouts.

For a production change:

1. Back up `supabase_migrations.schema_migrations`.
2. Run `supabase migration list --linked`.
3. Inspect the exact pending SQL file.
4. Verify the affected production objects and data.
5. Apply only that reviewed file:

   ```powershell
   supabase db query --linked --file supabase/migrations/<migration>.sql
   ```

6. Verify the resulting schema and behavior.
7. If the SQL was applied outside the normal migration command, repair only its
   exact version:

   ```powershell
   supabase migration repair --linked --status applied <version>
   ```

8. Re-run `supabase migration list --linked` and keep the rollout evidence.

Never repair migration history merely to make the list look clean.

## Local Development

Prerequisites:

- Docker Desktop
- Supabase CLI
- the Node.js version used by the frontend

Start the local stack:

```powershell
supabase start
supabase status
```

Copy `.env.local.example` to `.env.local` and use the local API URL and anon
key reported by `supabase status`.

## Baseline And Seed Export

Refreshing the baseline is an exceptional operation, not a normal migration:

```powershell
supabase link --project-ref <project-ref>
supabase db dump --schema public --file supabase/migrations/00000000000000_baseline.sql
```

Export local seed data separately:

```powershell
supabase db dump --data-only --schema public --file supabase/seed.sql
```

Inspect and anonymize seed data before committing it.

## Edge Functions

Local and production functions require their own server-side secrets. Examples
include mail-provider keys, Microsoft/Google integration credentials,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `VITE_SITE_URL`. Service
role keys must never be exposed to frontend code.
