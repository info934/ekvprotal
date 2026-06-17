# Attendance and Hourly Payout Rollout Log - 2026-06-17

## Scope

This rollout hardens the attendance approval flow and hourly payout workflow.

Included changes:
- Project/realization projection dashboard cleanup and extracted projection helpers.
- Attendance write operations moved from direct table writes to RPC functions.
- Attendance submission approval/rejection/revert moved to RPC functions.
- Hourly payout request creation moved to server-side calculation from approved attendance.
- Hourly payout approve/reject/invoice-upload/paid transitions moved to RPC functions.
- Direct RLS insert/update paths for sensitive workflow tables removed.
- Hourly payout requests now store an immutable attendance calculation snapshot.
- Workflow tables now emit server-side audit logs.
- Admin hourly payout view can flag snapshot/current-attendance discrepancies.

Not included:
- No global unique constraint for payout month. A member may still have multiple payout requests in a month, including hourly and task-based requests.
- No broad redesign of attendance or payout UI.
- No production migration was applied from this session.

## Changed Files

Frontend:
- `src/components/Attendance.jsx`
- `src/components/AttendanceSubmissionsOptimized.jsx`
- `src/components/GlobalAttendanceOptimized.jsx`
- `src/components/HourlyPayoutRequest.jsx`
- `src/components/HourlyPayoutRequestsAdmin.jsx`
- `src/components/InvoiceUpload.jsx`
- `src/components/Projects.jsx`
- `src/components/Realizace.jsx`

New frontend/domain helpers:
- `src/domain/projectProjections.js`
- `src/domain/realizationProjections.js`
- `src/lib/attendanceWorkflowService.js`
- `src/lib/hourlyPayoutWorkflowService.js`

Database:
- `supabase/migrations/20260617143000_attendance_hourly_workflow_rpc.sql`
- `supabase/migrations/20260617152000_hourly_payout_snapshots_audit.sql`

## Database Behavior

New attendance RPC functions:
- `save_attendance_record`
- `delete_attendance_record`
- `submit_attendance_month`
- `approve_attendance_submission`
- `reject_attendance_submission`
- `revert_attendance_submission`

New hourly payout RPC functions:
- `create_hourly_payout_request`
- `approve_hourly_payout_request`
- `reject_hourly_payout_request`
- `upload_hourly_payout_invoice`
- `mark_hourly_payout_paid`

Important rules:
- Attendance saves are server-validated.
- A member/day cannot exceed 24 hours.
- Attendance cannot be edited/deleted when the month is `submitted` or `approved`.
- Hourly payout requests are created from approved attendance only.
- Hourly payout totals, rate, amount, and breakdown are calculated server-side.
- Hourly payout workflow transitions are server-validated.
- Hourly payout requests keep `attendance_snapshot`, `calculation_hash`, `snapshot_total_hours`, and `snapshot_total_amount`.
- Hourly payout requests can be classified as `regular`, `supplement`, or `correction`.

## RLS Changes

The migration removes direct insert/update/delete paths that previously allowed clients to mutate sensitive workflow state:
- `attendance` direct insert/update/delete policies are dropped.
- `attendance_submissions` broad all-operation owner/admin policy is replaced by read-only select policy.
- `hourly_payout_requests` direct owner insert/update policies are dropped.

The application now relies on `SECURITY DEFINER` RPC functions for workflow mutations.

## Verification Already Run Locally

Commands:

```bash
npm run lint
npm run build
npm run backend:check
./node_modules/.bin/supabase migration up
./node_modules/.bin/supabase db query "select proname from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace where nspname = 'public' and proname in ('save_attendance_record','submit_attendance_month','approve_attendance_submission','create_hourly_payout_request','mark_hourly_payout_paid') order by proname;"
```

Results:
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run backend:check`: passed.
- Local Supabase migration application: passed.
- RPC existence query: passed.

Notes:
- `supabase migration up` emitted notices only:
  - long policy name was truncated by PostgreSQL.
  - some `DROP POLICY IF EXISTS` targets did not exist locally.

## Rollout Plan

1. Commit these changes together as one workflow-hardening change.
2. Deploy database migration before or together with frontend release.
3. Confirm production migration applied successfully.
4. Deploy frontend build.
5. Smoke test with one normal hourly worker and one payout/attendance admin.

Required smoke tests:
- User creates attendance record.
- User cannot exceed 24h in one day.
- User submits attendance month.
- Submitted month cannot be edited.
- Admin approves attendance month.
- User creates hourly payout request from approved month.
- User can choose hourly request type: regular, supplement, correction.
- User cannot create hourly payout request from unapproved month.
- Admin approves hourly payout request.
- Admin sees discrepancy warning if current attendance differs from stored payout snapshot.
- User uploads invoice unless approved without invoice.
- Admin marks hourly payout paid.
- Task-based payout flow still works.

## Rollback Plan

Preferred rollback:
1. Revert frontend commit.
2. Apply a follow-up DB migration that restores previous direct policies only if production must be unblocked quickly.
3. Do not manually edit workflow rows unless there is a production incident and the change is recorded.

Risk-aware rollback notes:
- The new migration creates/replaces functions and drops broad policies. Rolling back frontend without restoring policies will break workflow mutations.
- Restoring broad policies reopens the original risk: client-authoritative attendance submissions and hourly payout state.
- If rollback is needed, prefer a narrow compatibility migration that temporarily allows only the exact old UI actions needed for business continuity.

## Open Follow-Ups

Recommended next changes:
- Add automated SQL tests for RLS/RPC abuse cases.
- Add Playwright smoke test for attendance approval to hourly payout.
- Add a detail drawer for the immutable attendance snapshot rows used by each hourly payout request.
- Decide whether supplement/correction requests require mandatory reason text and optional parent request.

## Important Product Decision

Do not add a blanket unique constraint on `(member_id, payout_month, payout_year)`.

The business requirement allows multiple requests in a month, including hourly and task-based requests. If duplicate protection is needed later, implement it as a more specific workflow rule, for example:
- prevent duplicate hourly request for the exact same approved attendance snapshot, or
- allow supplemental hourly requests only with explicit admin/member reason and delta calculation.
