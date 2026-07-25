# Supabase Migration Maintenance

## Current State

Audit date: 2026-07-25

- Active migration files: 117
- Naming: all active files use a 14-digit timestamp and snake_case suffix
- Duplicate timestamps: none
- Duplicate SQL contents: none
- Review-only legacy files: `supabase/manual/legacy`
- Production: linked online Supabase remains the source of truth

The active directory is now machine-checkable. Run:

```powershell
pnpm migrations:check
```

## Why The History Is Not Fully Squashed

Older production deployments combined manual SQL, baseline exports, and
timestamped migrations. A destructive squash would make the folder shorter but
could lose seed behavior, obscure audit history, or cause already-applied SQL to
run again.

The safe policy is:

- retain the current baseline,
- keep already published timestamped migrations immutable,
- add only new forward migrations,
- quarantine non-migration SQL outside the active directory,
- reconcile recent migration metadata only after verifying the exact live
  schema change.

## Onboarding Checklist

1. Read `supabase/README.md`.
2. Run `pnpm migrations:check`.
3. Never run a broad linked `db push` without a reviewed migration comparison.
4. Treat `supabase/manual/legacy` as documentation, not executable setup.
5. For production, back up migration metadata and apply one reviewed migration
   at a time.
6. Record migration version, verification result, application commit, and
   deployment commit in the rollout report.

## Future Cleanup

A true migration squash should be done only as a dedicated maintenance release:

1. create a schema-only dump from production,
2. define a separate reviewed seed strategy,
3. restore both into an empty Supabase environment,
4. run application smoke and RLS tests,
5. freeze old migrations in an archive tag,
6. switch production history only after a tested rollback plan exists.

Until that exercise succeeds, the existing baseline and forward migration chain
are safer than a cosmetic rewrite.
