# EKVPortal - conversation and implementation summary

Date: 2026-05-11  
Branch: `baseline-freeze-crm-documents`  
Environment: local Windows workspace, Vite React app, online Supabase project.

## Scope

This document summarizes the recent Codex work session and the current implementation baseline.
Sensitive values that appeared during the conversation, including database passwords, API tokens,
login passwords, and SSH private keys, are intentionally omitted.

## Main topics covered

### Supabase and database cleanup

- Connected the app to the existing online Supabase database.
- Reviewed Supabase security/lint warnings.
- Added and applied RLS/security cleanup migrations.
- Removed duplicate and overlapping permissive RLS policies.
- Added missing indexes reported by Supabase advisor.
- Verified that `supabase db lint --level warning` reports no schema errors.
- Verified that duplicate same-table/same-command/same-role RLS policy overlaps are removed.

Relevant migration files:

- `supabase/migrations/20260511154500_fix_project_realization_rls_advisors.sql`
- `supabase/migrations/20260511161000_deduplicate_exact_rls_policies.sql`
- `supabase/migrations/20260511162500_split_broad_rls_policies.sql`
- `supabase/migrations/20260511164500_reduce_dictionary_and_workflow_rls_overlap.sql`
- `supabase/migrations/20260511170500_cleanup_core_workflow_rls_policies.sql`
- `supabase/migrations/20260511172000_merge_remaining_rls_policy_pairs.sql`

### CRM and document generation

- Improved CRM document template handling.
- Added support for template placeholders and generated product/item tables.
- Added CRM settings guidance for document templates and placeholder usage.
- Prepared the CRM area for offers, orders, and document generation flows.

Relevant files:

- `src/components/SettingsCRM.jsx`
- `src/lib/documentGenerationService.js`

### Payouts module redesign

- Reviewed the payouts module and identified inconsistency between task-based payouts and hourly payout requests.
- Introduced a shared payout UI layer for consistent metrics, panels, status badges, empty states, and formatting.
- Redesigned task payout history table.
- Redesigned employee hourly payout request page.
- Redesigned admin hourly payout approval table.
- Fixed broken Czech diacritics in the redesigned payout components.
- Kept the existing approval, invoice upload, paid/rejected workflow logic intact.

Relevant files:

- `src/components/payouts/PayoutShared.jsx`
- `src/components/Payouts.jsx`
- `src/components/PayoutTable.jsx`
- `src/components/HourlyPayoutRequest.jsx`
- `src/components/HourlyPayoutRequestsAdmin.jsx`

### Deployment and runtime notes

- The app is currently developed locally through Vite.
- The target server discussed was Debian 12 VM 108 with Docker Compose or Node + Nginx as possible deployment paths.
- Current database remains online Supabase.
- Secrets must be provided through environment variables or server secret management, not committed to git.

## Verification performed

- Production build was run successfully with:

```bash
npm run build
```

- Supabase schema lint was run successfully against the online database:

```bash
supabase db lint --level warning
```

- The local Vite server on port `3003` was checked and returned the app HTML through `curl.exe`.

## Git hygiene notes

The following local artifacts should not be committed unless explicitly reviewed:

- `.deploy-secrets/`
- `ssh-keys/`
- local screenshots such as `crm-new-check.png`
- local helper/generated folders such as `fa_portal/`
- local dev-server log files
- local credential or private key files

## Recommended next steps

1. Manually test the redesigned payouts module in the browser as an authenticated admin and regular employee.
2. Create a small smoke-test checklist for CRM, payouts, attendance, projects, realizations, and subjects.
3. Keep future work split by branch: CRM polish, payouts cleanup, document generation, and deployment.
4. Before deploying to VM, confirm all required environment variables and Supabase redirect URLs.
5. Do not store production credentials in source control.
