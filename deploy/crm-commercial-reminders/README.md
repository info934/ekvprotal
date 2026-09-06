# CRM offer reminders

The host calls `send-crm-commercial-reminders` every weekday at 09:15 Europe/Prague.
The function sends at most three reminders for a sent offer, waits at least five
days after the original send and seven days between reminders, and records each
attempt in the immutable delivery history.

Install on VM 108:

1. Copy `run.py` to `/opt/ekvportal-jobs/crm-commercial-reminders/run.py`.
2. Create `/etc/ekvportal-crm-reminders/secret.env` with
   `CRM_REMINDER_SECRET=<same secret as the Edge Function>` and permissions 0600.
3. Copy the service and timer to `/etc/systemd/system/`.
4. Run `systemctl daemon-reload` and
   `systemctl enable --now ekvportal-crm-reminders.timer`.

Inspect with `systemctl status ekvportal-crm-reminders.timer` and
`journalctl -u ekvportal-crm-reminders.service`. The secret must never be placed
in the repository, command arguments or logs.
