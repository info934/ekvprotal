# Manual Supabase SQL

Files in this directory are not migrations and must never be executed as a
batch. They are retained for investigation, recovery, or historical context.

## Rules

- Production changes belong in `supabase/migrations` as a new timestamped,
  idempotent SQL file.
- Never move a manual file back into migrations without rewriting and reviewing
  every statement against the current production schema.
- Never use these files to infer whether production already contains a change.
  Inspect the linked database first.
- Files under `legacy` predate the reproducible migration workflow and are
  review-only.
