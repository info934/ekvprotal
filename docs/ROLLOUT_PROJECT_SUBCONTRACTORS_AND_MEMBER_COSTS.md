# Rollout: subdodavatelé a odečty ostatních nákladů z odměn

## Shrnutí změny

Tento rollout upravuje projektové finance ve dvou oblastech:

- Správa subdodavatelů v detailu projektu dovoluje upravit již přiřazeného subdodavatele, změnit subjekt a vytvořit nový subjekt typu `Subdodavatel` přímo z dialogu přiřazení.
- Ostatní projektové náklady mohou být volitelně přiřazené konkrétnímu členovi týmu. Přiřazený náklad snižuje čistou odměnu daného člena. Nepřiřazený náklad zůstává společným projektovým nákladem a snižuje společný týmový budget.

## Databázové změny

Spustit migrace v pořadí:

1. `supabase/migrations/20260626120000_project_subcontractors_status_read_model.sql`
2. `supabase/migrations/20260626123000_project_cost_member_deductions.sql`

Migrace doplňují:

- `list_project_subcontractors_safe` vrací `status`, aby editace nepřepisovala stav defaultem.
- `project_costs.member_id` s FK na `members(id)` a indexy.
- aktualizované RPC `project_financial_summary` a `get_member_project_rewards`.
- úpravu `delete_project_member_safe`, která před odebráním člena přepne jeho přiřazené náklady zpět na nepřiřazené.

## Dopad na výpočty

- `direct_costs` zůstává celkový součet ostatních nákladů pro účetní pohled.
- `unassigned_direct_costs` snižuje společný týmový budget.
- `assigned_member_costs` se odečítá až z odměn konkrétních členů.
- Výplaty používají `get_member_project_rewards`, takže dostupný zůstatek člena respektuje i přiřazené náklady.

## UI změny

- Detail projektu > Tým > Subdodavatelé:
  - lze editovat existující přiřazení,
  - lze vytvořit nový subjekt subdodavatele přímo v dialogu.
- Detail projektu > Finance > Ostatní náklady:
  - pole `Odečíst z odměny`,
  - volba `Nepřiřazeno - odečíst ze společného budgetu`,
  - výběr konkrétního člena týmu.
- Historie projektu:
  - zobrazuje přepočet odměn po změnách týmu, subdodavatelů a ostatních nákladů.

## Ověření před nasazením

Lokálně proběhlo:

- `npm run lint`
- `npm run build`
- aplikace migrací na lokální Supabase DB
- rollback DB smoke test:
  - dočasný přiřazený náklad `1234 Kč` snížil `total_reward` a `available_balance` vybraného člena přesně o `1234 Kč`,
  - `project_financial_summary` vrátil `assigned_member_costs = 1234` a `unassigned_direct_costs = 0`,
  - transakce byla vrácena přes `ROLLBACK`.

Browser E2E přes Playwright bylo v tomto prostředí blokované DNS chybou `EAI_AGAIN registry.npmjs.org` při pokusu helperu stáhnout `@playwright/cli`.

## Rollback

Krátkodobý rollback aplikace:

- vrátit commit s UI a RPC změnami,
- znovu nasadit předchozí build.

Databázový rollback:

- `project_costs.member_id` lze ponechat bez dopadu, pokud aplikace pole nepoužívá.
- Pro návrat starého výpočtu obnovit předchozí definice RPC:
  - `project_financial_summary(uuid)`
  - `get_member_project_rewards(uuid)`
  - `delete_project_member_safe(uuid, uuid)`
  - `list_project_subcontractors_safe(uuid)`

## Post-deploy kontrola

1. Otevřít detail projektu s týmem a finančním oprávněním.
2. Upravit existujícího subdodavatele a ověřit, že stav zůstává zachovaný.
3. Vytvořit nový subdodavatelský subjekt z dialogu přiřazení.
4. Přidat ostatní náklad bez člena a ověřit pokles společného budgetu.
5. Přidat ostatní náklad přiřazený členovi a ověřit pokles jeho čisté odměny.
6. Otevřít historii projektu a zkontrolovat záznam přepočtu odměn.
