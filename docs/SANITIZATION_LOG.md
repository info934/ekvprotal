# Sanitization Log

Date: 2026-06-05

## Scope

- Local development only.
- Production data and production portal were not modified.
- The existing local `supabase/seed.sql` still contains imported production-like data and remains local-only.

## Changes

### Local Seed Protection

- Added `supabase/seed.sql` and `supabase/seed.*.sql` to `.gitignore`.
- Reason: local database dumps can contain PII and must not be committed.

### Anonymized Seed Helper

- Added `tools/anonymize-seed.mjs`.
- Added npm script:
  - `npm run supabase:anonymize-seed`
- Default behavior:
  - reads `supabase/seed.sql`
  - writes `supabase/seed.anonymized.sql`
  - preserves UUIDs and relational links
  - masks common PII fields in members, subjects, contacts, projects, realizations, engineering subjects, and audit logs
- The generated anonymized seed is also ignored by Git.

Verification:

- Ran `npm run supabase:anonymize-seed`.
- Confirmed member rows keep UUIDs and timestamps while replacing names, emails, phones, notes, companies, bios, and avatar URLs.
- Confirmed audit log `details` values are replaced with `{}`.
- Confirmed ignored seed outputs are not shown in `git status`.

### HTML Template Sanitization

- Added `src/lib/htmlSanitizer.js`.
- Document template HTML is sanitized:
  - when importing/saving templates in `OrderTemplateDialog`
  - when generating commercial document HTML in `documentGenerationService`
  - when previewing templates in `OrderTemplateManager`
- Added direct `dompurify` dependency in `package.json`.

Sanitization blocks high-risk tags and attributes such as:

- `script`
- `iframe`
- `object`
- `embed`
- form controls
- inline event handlers
- `srcdoc`

## Verification Commands

- `npm run supabase:anonymize-seed` passed.
- `npm run lint` passed.
- `npm run build` passed.

