# Realizace security rollout

Datum: 2026-06-17

## Obsah baliku

- Nova migrace `20260617170000_secure_realization_read_models.sql`.
- Bezpecne RPC:
  - `list_realizations_safe()`
  - `get_realization_safe(uuid)`
  - `can_access_realization(uuid)`
  - `can_view_realization_financials()`
- Zprisnene RLS pro `realizations`:
  - SELECT jen admin/super_manager, editor realizaci, vedouci/clen tymu, clen s podilem, uzivatel s vlastni dochazkou, nebo clen navazaneho projektu.
  - INSERT/UPDATE jen role s edit opravnenim `realizace`.
  - DELETE jen role s admin opravnenim `realizace`.
- Frontend Realizace list/detail uz necita financni sloupce primo z tabulky.
- Hodinova zalozka Realizace necita `hourly_rate` pro role bez financni viditelnosti.
- Null-safe vyhledavani v Projektech a Realizacich.

## Overeni provedene lokalne

- `npm run lint`
- `npm run backend:check`
- `./node_modules/.bin/supabase migration up`
- `npm run build`

## Rollout poznamky

Tato zmena obsahuje databazovou migraci. Na produkci aplikovat pres review konkretniho SQL souboru:

```bash
supabase db query --linked --file supabase/migrations/20260617170000_secure_realization_read_models.sql
```

Po aplikaci overit:

```sql
select policyname
from pg_policies
where schemaname = 'public'
  and tablename = 'realizations'
order by policyname;
```

Ocekavane nove policy:

- `Realizations delete for realization admins`
- `Realizations insert for realization editors`
- `Realizations read for assigned users or realization editors`
- `Realizations update for realization editors`

## Role smoke

- Admin/super_manager vidi finance v seznamu a detailu Realizace.
- Bezny uzivatel nevidi `contract_amount`, `budget`, `actual_costs`, `expected_total_cost` v odpovedi list/detail RPC.
- Bezny uzivatel vidi jen realizace, kde je vedouci, clen tymu, ma profit share, vlastni dochazku, nebo je clenem navazaneho projektu.
- Bezny uzivatel bez finance role nema v hourly zalozce nactene `members.hourly_rate`.
