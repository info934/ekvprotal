# EKVPortal smoke-test checklist

Date: 2026-05-12

Use this checklist after UI or workflow changes before deployment. Test with at least one admin user
and one regular employee user where role-specific behavior is involved.

## General

- App loads without console errors after login.
- Main navigation opens Dashboard, CRM, Projects, Realizace, Attendance, Payouts, Settings.
- Role-restricted pages are hidden or blocked for users without permission.
- Data tables load, empty states are readable, and basic search/filter controls do not break layout.
- Create/edit dialogs can be opened and closed without losing the current page state unexpectedly.

## CRM

- Contacts/subjects list loads and can be filtered.
- A subject detail opens from the CRM list.
- Contact fields render with correct Czech labels and diacritics.
- Offer/order document templates are visible in CRM settings.
- Template placeholder help is visible and does not overflow on mobile width.
- Generating a commercial document still produces an output with item/product rows.

## Payouts

- Employee payout overview loads for a regular employee.
- Task payout history shows totals, statuses, and empty states correctly.
- Employee hourly payout request page loads attendance-derived rows.
- Employee can prepare a payout request without layout shifts or broken currency/date formatting.
- Admin hourly payout requests table loads pending and historical requests.
- Admin approve/reject actions remain visible and status badges update after action.
- Invoice upload/open controls are still available where the workflow expects them.

## Attendance

- Monthly attendance table loads for the current month.
- Global attendance view loads for an admin.
- Submitting or editing attendance keeps project/member selectors usable.
- Attendance rows used by hourly payout requests match the selected month and user.

## Projects

- Projects list loads with search/filter controls.
- Project detail opens from the list.
- Creating or editing a project keeps required fields, subject linkage, and status controls intact.
- Project contacts section loads and accepts existing CRM contacts.
- Project financial widgets do not show `NaN`, `undefined`, or raw database values.

## Realizace

- Realizace list loads and detail opens.
- Financial summary and financial table render without broken totals.
- Team and subcontractor sections load.
- Extra costs can be opened and closed.
- Order generation flow still opens from a realization detail.

## Subjects

- Subjects list loads and filtering works.
- Subject detail opens and shows linked projects/documents where available.
- Creating or editing a subject preserves required fields and ARES-related controls.

## Deployment Readiness

- `npm run lint` passes.
- `npm run build` passes.
- Required environment variables are present in the target environment.
- Supabase auth redirect URLs include the target deployment URL.
- No local secrets, SSH keys, screenshots, or generated helper folders are staged for commit.
