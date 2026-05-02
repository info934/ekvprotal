# Backend Baseline

Date: 2026-05-01

This document captures the current Supabase backend shape so future work can move from ad hoc dashboard changes to reviewed migrations and reproducible environments.

## Production Project

- Project ref: `yurysbxxevtuvhrbmloc`
- Region: `eu-central-1`
- Database host: `db.yurysbxxevtuvhrbmloc.supabase.co`
- Postgres engine: `17`
- Supabase branching attempt: unavailable on the current plan, requires Pro or higher.

## Current Inventory

- Public tables: 67
- Public views: 2
- Public routines: 28
- RLS policies: 206
- Constraints: 186
- Supabase migrations reported by connector: 0

The "0 migrations" result means production schema is not currently reconstructible from the repository. Treat the live database as the source of truth until a full SQL baseline is exported with Supabase CLI or `pg_dump`.

## Public Tables

`app_settings`, `attendance`, `attendance_submissions`, `audit_logs`, `doc_structures`, `document_types`, `documents`, `engineering_activities`, `engineering_subjects`, `hourly_payout_requests`, `hourly_payouts`, `legal_forms`, `member_certifications`, `member_roles`, `members`, `notifications`, `order_statuses`, `order_templates`, `overhead_allocation_items`, `overhead_audit_logs`, `overhead_costs`, `overhead_monthly_allocations`, `payout_items`, `payouts`, `priority_levels`, `project_comments`, `project_contacts`, `project_costs`, `project_links`, `project_members`, `project_orders`, `project_overhead_costs`, `project_stages`, `project_subcontractors`, `project_tags`, `project_tasks`, `project_templates`, `project_templates_custom`, `project_to_tags`, `project_types`, `projection_statuses`, `projects`, `realizace_costs`, `realizace_extra_costs`, `realizace_financials`, `realizace_orders`, `realizace_overhead`, `realizace_team_members`, `realization_profit_shares`, `realization_statuses`, `realization_types`, `realizations`, `reports`, `risk_levels`, `role_permissions`, `salary_payouts`, `subcontractor_orders`, `subcontractor_orders_deprecated`, `subcontractor_statuses_deprecated`, `subcontractors_deprecated`, `subject_types`, `subjects`, `task_statuses`, `template_engineering_activities`, `template_tasks`, `units`, `user_roles`.

## Public Views

- `v_project_budget_summary`
- `v_project_costs_summary`

## Public Routines

`get_company_financials`, `get_member_id`, `get_overhead_summary`, `get_permissions`, `get_projects_with_balance`, `get_realizace_financials`, `get_realizace_overhead_summary`, `get_realizations_with_balance`, `get_user_activities`, `get_user_financials`, `get_user_id_by_email`, `get_user_projects`, `get_user_role`, `handle_new_user`, `notify_admin_payout_change`, `notify_member_hourly_payout_change`, `refresh_user_rewards`, `setup_project_rls`, `sync_realizace_team_members_to_array`, `trigger_refresh_user_rewards`, `update_hourly_payout_requests_updated_at`, `update_monthly_allocations_updated_at`, `update_overhead_costs_updated_at`, `update_payout_total_amount`, `update_project_templates_custom_updated_at`, `update_realizace_orders_updated_at`, `update_realizations_updated_at`, `update_subjects_updated_at`.

## Edge Functions

Functions present in production:

- `manage-users`
- `send-message-to-member`
- `send-email`
- `send-payout-email`
- `send-admin-payout-notification`
- `send-payout-notification`

Functions present in this repository:

- `manage-users`
- `send-message-to-member`
- `send-email`
- `send-payout-email`
- `send-admin-payout-notification`
- `send-payout-notification`
- `send-scheduled-reports`

The production Edge Function source has been copied into the repository as a baseline. Secrets are not included and must be configured locally or in Supabase secrets.

## Known Backend Risks

- Production schema is not represented by migrations in the repo.
- RLS policies contain repeated/overlapping rules across several tables.
- Deprecated tables still exist in production: `subcontractor_orders_deprecated`, `subcontractor_statuses_deprecated`, `subcontractors_deprecated`.
- Critical financial behavior depends on both frontend calculations and database routines.
- Supabase development branches cannot be used on the current plan. Organization `EKVPortal` is on the `free` plan.

## Required Next Step

Install Supabase CLI and Docker Desktop, then create a real baseline:

```powershell
supabase link --project-ref yurysbxxevtuvhrbmloc
supabase db dump --schema public --file supabase/migrations/00000000000000_baseline.sql
supabase db dump --data-only --schema public --file supabase/seed.sql
```

Do not commit production data in `supabase/seed.sql`. Use an anonymized seed for local work.
