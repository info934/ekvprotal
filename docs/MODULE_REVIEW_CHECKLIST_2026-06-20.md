# EKVPortal Module Review Checklist - 2026-06-20

Use this checklist during the freeze pass. Mark a module complete only after code review, browser smoke and backend/storage impact are understood.

## Review Rules

- Review one module at a time and record blockers immediately.
- Fix P0/P1 issues before moving to SharePoint work.
- Keep Supabase migrations explicit; do not run broad `db push` against production.
- Do not duplicate CRM companies outside `subjects`.
- Keep SharePoint work out of the freeze branch except for readiness documentation and existing fallback validation.

## Required Local Checks

```bash
npm run lint
npm run build
npm run backend:check
```

## Browser Smoke Routes

- `/dashboard`
- `/projects`
- `/projects/new`
- `/realizace`
- `/realizace/new`
- `/crm`
- `/crm/opportunities`
- `/crm/offers`
- `/crm/orders`
- `/products`
- `/products/new`
- `/subjects`
- `/documents`
- `/payouts`
- `/payouts/new`
- `/payouts/hourly-admin`
- `/attendance`
- `/settings`
- `/settings/crm`
- `/settings/storage`
- `/order/:token`
- `/sub-order/:token`

## Production Preflight

Before deployment to VM 108:

```bash
git status --short --branch
git log --oneline --decorate -5
ssh root@192.168.1.180
cd /opt/ekvportal
git status --short --branch
docker compose ps
curl -I http://127.0.0.1:8080
docker compose logs --tail=100 ekvportal
```

Record the result in `docs/FREEZE_STATE_2026-06-20.md`.
