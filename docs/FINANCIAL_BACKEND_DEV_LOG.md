# Financial Backend Dev Log

Date: 2026-06-05

## Local Environment State

- Local Supabase is running from repository migrations.
- Local frontend `.env.local` points to local Supabase on `http://192.168.1.193:54321`.
- Production `public` data was dumped read-only into `supabase/seed.sql` and imported into local Supabase.
- `supabase/seed.sql` contains production data and must not be committed or deployed without anonymization.
- Local Auth is not included in the production public data dump. A local-only auth user was created for testing.
  - Credentials are intentionally omitted from the repository.

## Changes Made

### Migration Idempotency

- Updated `supabase/migrations/20260511162500_split_broad_rls_policies.sql`.
- Added missing `DROP POLICY IF EXISTS` statements before recreated RLS policies.
- Reason: local reset/start previously failed when a partially applied migration left policies behind.

### Production Data Import For Local Development

- Dumped production `public` data into `supabase/seed.sql`.
- Added a seed prelude that truncates all `public` tables before inserting dump rows.
- Reason: baseline/migrations insert default records, and raw production seed then hit duplicate keys.
- Local import now completes with `supabase db reset --local`.

### Financial Read Models

- Added `supabase/migrations/20260605214500_financial_summary_read_models.sql`.
- New read-only RPC functions:
  - `project_financial_summary(p_project_id uuid)`
  - `realization_financial_summary(p_realization_id uuid)`
- Both functions are `SECURITY DEFINER`, enforce authenticated project/realization visibility, and return JSON financial summaries.

Project summary includes:

- gross project budget
- planned overhead
- manual/attendance/direct costs
- subcontractor costs
- allocated overhead costs
- operational costs
- team budget
- remaining amount after costs
- reserved/paid payout totals
- member reward configuration

Realization summary includes:

- base contract amount
- extra revenue
- manual/hourly/extra costs
- total revenue and total costs
- profit and overhead amounts
- team budget
- reserved/paid payout totals
- member share configuration

### Frontend Read Model Wiring

- Updated `src/components/ProjectDetail.jsx`.
- The project finance tab now calls `project_financial_summary(p_project_id)` and maps the backend response into the existing UI financial shape.
- Existing frontend project calculations remain as a fallback when the RPC is unavailable in a development environment.
- Team reward totals are still derived from the loaded member assignments, using the backend team budget.

- Updated `src/components/RealizaceDetail.jsx`.
- Realization detail now calls `realization_financial_summary(p_realization_id)` for authoritative revenue, manual costs, hourly costs, extra costs, total costs, and team budget inputs.
- Existing frontend realization calculations remain as a fallback when the RPC is unavailable.
- Manual cost deletion now refreshes the whole realization data set so the backend summary cannot remain stale after a delete.

### Member Project Reward Read Models

- Added `supabase/migrations/20260605223000_member_project_reward_read_models.sql`.
- New read-only RPC functions:
  - `get_member_project_rewards(p_member_id uuid default null)`
  - `get_project_order_reward(p_token text)`
- Replaced older `get_projects_with_balance(p_member_id)` implementation so payout availability for projects uses the new live member reward calculation.
- Replaced older `get_user_financials(p_member_id)` implementation so dashboard/user financials are derived from the same live reward rows instead of `mv_user_project_rewards`.

Member reward rows include:

- project identity and status
- reward type/percentage/fixed amount
- backend team budget
- total member reward
- reserved or paid payout amount
- paid amount
- available balance

### Member Reward Frontend Wiring

- Updated `src/components/Projects.jsx`.
  - Member-visible project reward badges now call `get_member_project_rewards`.
- Updated `src/components/Members.jsx`.
  - Member list financial aggregates now call `get_member_project_rewards`.
- Updated `src/components/MemberDetail.jsx`.
  - Project reward, paid amount, and remaining balance now prefer `get_member_project_rewards`.
- Updated `src/components/OrderPage.jsx`.
  - Public order reward display now calls token-scoped `get_project_order_reward`.
- Updated `src/components/AssignMemberDialog.jsx` and `src/components/ProjectDetail.jsx`.
  - The member assignment dialog can use backend `teamBudget` from project detail for percentage reward previews.

## Verification

### Local Reset

`supabase db reset --local` completed after applying:

- `20260513170000_backend_payout_availability.sql`
- `20260605214500_financial_summary_read_models.sql`

### Authenticated RPC Smoke Tests

Tested with local Auth token for `pavel.kopacka@ekvproject.cz`.

`get_payout_availability` returned:

- 28 projects
- 11 realizations

`project_financial_summary` returned a project summary for `FVE-0001`:

- team budget: `152837.6`
- operational costs: `106600`
- member rewards: `5`

`realization_financial_summary` returned a realization summary for `FVE - RESORT COTTO PLZENEC 2025`:

- total revenue: `533644`
- total costs: `300354.76`
- team budget: `46513.84`
- member shares: `0`

### Frontend Smoke Test

Tested local frontend on `http://localhost:3002`:

- login as local test user completed
- project detail finance tab loaded `Celkový budget` and `Budget na tým`
- project finance tab included allocated overhead section
- realization detail loaded `Smlouva (Příjmy)`, `Celkem náklady`, and `Týmový rozpočet`

### Build And Lint

- `npm run build` passed.
- `npm run lint` passed.

After adding member project reward read models:

- `supabase db reset --local` passed and applied `20260605223000_member_project_reward_read_models.sql`.
- Local auth test user was recreated after reset.
- Authenticated REST smoke test passed:
  - `get_member_project_rewards`: `33` rows for the local test member
  - `get_projects_with_balance`: `28` rows
  - `get_user_financials`: returned total reward, available amount, and paid amount
- Anonymous REST smoke test for `get_project_order_reward` was reachable. Current imported seed has no `project_orders` row that also matches `project_members`, so it returned `0` rows for available seed tokens.
- `npm run lint` passed.
- `npm run build` passed.
- Browser smoke for projects/members/member detail is partially blocked by the Playwright session remaining on the auth loading screen after local service restarts. Direct Auth REST and all new RPC calls passed, so this is tracked as a local browser-session verification limitation, not a backend migration failure.

## Production Rollout Notes

Apply only migration files, not local seed data:

1. Review and commit SQL migrations.
2. Exclude or anonymize `supabase/seed.sql` before commit.
3. Apply migrations to production Supabase with the Supabase CLI or dashboard SQL editor.
4. Recommended order:
   - Existing payout/overhead backend migration: `20260513170000_backend_payout_availability.sql`
   - New read-model migration: `20260605214500_financial_summary_read_models.sql`
5. After production apply, smoke-test:
   - `get_payout_availability(member_id, null)`
   - `project_financial_summary(project_id)`
   - `realization_financial_summary(realization_id)`
6. Only after successful RPC smoke tests should frontend changes be deployed.

## Remaining Work

- Add database test cases for payout over-request and edit mode.
- Add database test cases for overhead approval/reopen duplicate prevention.
- Decide whether local auth seed helper should be formalized for development only.
- Add stable browser E2E fixtures that clear stale Supabase localStorage after local DB resets.
