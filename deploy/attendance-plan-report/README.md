# Monthly attendance plan email

- Recipient: `info@ekvproject.cz` (fixed in the server-side report module).
- Delivery: last calendar day at 18:00 Europe/Prague, covering the next month.
- First regular delivery after installation: 2026-09-30 18:00 CEST, October plans.
- The timer checks hourly, but the Edge function skips outside the monthly window.
- A grace window until 18:00 on the first day allows recovery after an outage.
- Includes active employee profiles, legacy members with attendance enabled and
  anyone with a stored plan in the report month. Missing plans are explicitly listed.
- Contains HTML summary, detailed schedule and UTF-8 semicolon-separated CSV.
- Planned absence is not leave approval; planned hours are not payroll inputs.

## Deployment

Edge function: `send-attendance-plan-report`, custom header authentication using
`ATTENDANCE_PLAN_REPORT_SECRET`. JWT verification is disabled only for this
server-to-server endpoint. No client-side code receives this secret.

Host: existing web VM `192.168.1.180`.

- `/opt/ekvportal-jobs/attendance-plan-report/run.py`
- `/etc/ekvportal-attendance-report/secret.env` (root-only, directory 0700/file 0600)
- `/etc/systemd/system/ekvportal-attendance-report.service`
- `/etc/systemd/system/ekvportal-attendance-report.timer`

The function reuses the existing Resend configuration and `workflow_email_deliveries`.
No new database migration or frontend deployment is required.

## Operations

Inspect with `systemctl status ekvportal-attendance-report.timer` and
`journalctl -u ekvportal-attendance-report.service`.
Pause using `systemctl disable --now ekvportal-attendance-report.timer`.

Each regular month uses one persisted delivery key. Confirmed delivery never
resends. A definite provider rejection can retry; an ambiguous provider response
remains pending and requires checking Resend before any further send. Do not delete
pending delivery evidence or invent another key to bypass it.

Demo uses only synthetic data and a separate stable ID. The explicitly requested
demo `demo-20260905-monthly-plan` was accepted by the provider on 2026-09-05 at
13:55:21 UTC, message ID `14b7c33c-bc5b-4f3d-af11-0fc1db92c77e`.
Provider acceptance is not proof of inbox delivery or opening.

Tests: `node --test tests/attendance-plan-report*.test.mjs` and
`node tools/test-security-stabilization.mjs` cover scheduling, completeness,
escaping, authorization, CSV attachments and idempotent delivery.
