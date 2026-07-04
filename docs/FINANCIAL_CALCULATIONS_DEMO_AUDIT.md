# Financial Calculations Demo Audit

Datum: 2026-06-21

Prostredi: lokalni Supabase `http://127.0.0.1:54321`, lokalni Vite `http://127.0.0.1:3004`.

Demo ucet:

- Email: `demo.financial.admin@ekv.local`
- Heslo: `Project_2021`
- Role v portalu: `admin`

Seed a kontrolni SQL je v `.codex-financial-demo.sql`. Scenar je idempotentni: svoje `DEMO-FIN` zaznamy smaze a znovu vytvori.

## Spustene kontroly

```bash
npm run financial:check
./node_modules/.bin/supabase migration up --local
docker exec supabase_db_horizons-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/financial-demo.sql
```

Playwright navic overil UI:

- detail projektu, zalozka Finance
- detail realizace, prehled nakladu
- nova zadost o vyplatu
- administrace hodinovych vyplat
- CRM obchodni pripady a nabidka

Vsechny kontroly prosly.

## Demo data

Clenove:

- `DEMO FIN Admin`: procentni projektova odmena, hodinova sazba `900 Kc/h`
- `DEMO FIN Fixni clen`: fixni projektova odmena, hodinova sazba `700 Kc/h`
- `DEMO FIN Hodinovy clen`: hodinova prace, hodinova sazba `800 Kc/h`

Projekt/projekce:

- `DEMO-FIN-001` / `DEMO-FIN Projekt cost-adjusted`
- cena `100 000 Kc`
- projektovy budget `60 %`
- rezijni procento `10 %`
- subdodavka `10 000 Kc`
- manualni primy naklad `15 000 Kc`
- hodinovy projektovy naklad `8 h * 800 Kc = 6 400 Kc`
- alokovana rezije `5 000 Kc`

Realizace:

- `DEMO-FIN Realizace`
- zakladni smlouva `200 000 Kc`
- viceprace prodej `30 000 Kc`
- manualni naklad `20 000 Kc`
- viceprace naklad `10 000 Kc`
- hodinova prace primo na realizaci `6 h * 800 Kc = 4 800 Kc`
- realizace je navazana na projekt `DEMO-FIN-001`, proto bere i projektove hodiny `8 h * 800 Kc = 6 400 Kc`

CRM:

- obchodni pripad `DEMO-FIN CRM kalkulace`
- nabidka `DEMO-FIN-OFFER`

## Projekce: budget a odmeny

Backendovy zdroj: `project_financial_summary`, `get_member_project_rewards`.

Zakladni projektovy budget:

- Hruby budget = `price * budget_percentage / 100`
- Hruby budget = `100 000 * 60 % = 60 000 Kc`
- Planovana rezije = `gross_project_budget * overhead_percentage / 100`
- Planovana rezije = `60 000 * 10 % = 6 000 Kc`
- Tymovy budget = `gross_project_budget - planned_overhead_amount - subcontractor_costs`
- Tymovy budget = `60 000 - 6 000 - 10 000 = 44 000 Kc`
- Planovana marze = `price - gross_project_budget`
- Planovana marze = `100 000 - 60 000 = 40 000 Kc`

Cost-adjusted budget:

- Cost-adjusted budget = `team_budget - direct_costs - allocated_overhead_costs`
- V `direct_costs` jsou rucni projektove naklady bez polozek oznacenych jako dochazka
- Prime rucni naklady = `15 000 Kc`
- Hodinova projektova prace `6 400 Kc` je evidovana jako `attendance_costs` / `hourly_payout_exposure`, ale do cost-adjusted budgetu vstoupi az jako zaplacena hodinova vyplata
- Cost-adjusted budget = `44 000 - 15 000 - 5 000 = 24 000 Kc`

Procentni projektova odmena:

- Zaklad pro odmenu = cost-adjusted budget minus uz zaplacene projektove/hodinove vyplaty
- Vyplatni zaklad = `24 000 - 2 000 = 22 000 Kc`
- Odmena = `max(0, cost_adjusted_team_budget) * reward_percentage / 100`
- Odmena `DEMO FIN Admin` = `22 000 * 50 % = 11 000 Kc`
- Rezervovano/vyplaceno = `2 000 + 5 000 = 7 000 Kc`
- Dostupne k vyplate = `11 000 - 7 000 = 4 000 Kc`

Fixni projektova odmena:

- Fixni odmena se limituje cost-adjusted budgetem
- Nastaveno `30 000 Kc`
- Vysledek = `min(30 000, max(0, 22 000)) = 22 000 Kc`

Vycerpany projekt:

- Pokud je cost-adjusted budget zaporny, procentni odmena je `0 Kc`

Poznamka k hodinove praci v projekci:

- Tabulka `attendance` sama o sobe projektovy financial summary nezvysi.
- Projektovy financial summary ukazuje hodinovou praci z `project_costs.is_attendance_cost = true` jako `attendance_costs` / `hourly_payout_exposure`.
- Do projektoveho cost-adjusted budgetu se tato castka nezapocita hned; budget snizi az zaplacena hodinova vyplata.

## Realizace: rozpočet a podily

Backendovy zdroj: `realization_financial_summary`, `get_payout_availability`.

Vynos:

- Celkovy vynos = `contract_amount + extra_revenue`
- Celkovy vynos = `200 000 + 30 000 = 230 000 Kc`

Naklady:

- Manualni naklady = `20 000 Kc`
- Viceprace naklad = `10 000 Kc`
- Hodinova expozice = prime hodiny realizace + hodiny navazaneho projektu
- Hodinova expozice = `(6 h + 8 h) * 800 = 11 200 Kc`
- Nezaplacene hodinove vyplaty jsou v summary jako `hourly_costs` / `hourly_payout_exposure`, ale do `total_costs` vstoupi az po zaplaceni hodinove vyplaty
- Celkove naklady = `20 000 + 10 000 = 30 000 Kc`

Firemni cast:

- Zisk firmy = `total_revenue * profit_margin_percent / 100`
- Zisk firmy = `230 000 * 15 % = 34 500 Kc`
- Rezije firmy = `total_revenue * overhead_percent / 100`
- Rezije firmy = `230 000 * 5 % = 11 500 Kc`

Tymovy rozpočet realizace:

- Tymovy rozpočet = `total_revenue - profit_amount - overhead_amount - total_costs`
- Tymovy rozpočet = `230 000 - 34 500 - 11 500 - 30 000 = 154 000 Kc`

Procentni podil na realizaci:

- Podil = `max(0, team_budget) * share_value / 100`
- Podil `DEMO FIN Admin` = `154 000 * 25 % = 38 500 Kc`
- Rezervovano = `8 500 Kc`
- Dostupne k zadosti = `38 500 - 8 500 = 30 000 Kc`

Fixni podil na realizaci:

- Fixni podil vraci nastavenou castku `share_value`, limitovanou aktualnim tymovym rozpoctem
- V demo datech je fixni podil `10 000 Kc`

Poznamka k navazane projekci:

- Pokud ma realizace `linked_project_id`, realizacni hodinove naklady zahrnuji i dochazku vykazanou na tento navazany projekt.
- To znamena, ze jedna projektova hodina muze byt videt jako projektova hodinova expozice a zaroven jako hodinova expozice navazane realizace.

## Hodinove mzdy a hodinove vyplaty

Workflow:

1. Zaznam dochazky se uklada pres `save_attendance_record`.
2. Mesic se odesle pres `submit_attendance_month`.
3. Admin mesic schvali pres `approve_attendance_submission`.
4. Hodinova zadost o vyplatu vznikne pres `create_hourly_payout_request`.

Validace:

- Hodiny v jednom zaznamu musi byt `> 0` a `<= 24`.
- Soucet hodin za den nesmi prekrocit `24`.
- Hodinova vyplata jde vytvorit jen pro schvaleny mesic dochazky.
- Clen musi mit nastavenou kladnou `hourly_rate`.

Vypocet hodinove vyplaty:

- Celkove hodiny = suma vsech hodin clena v mesici
- Hodinova sazba = `members.hourly_rate`
- Celkem = `total_hours * hourly_rate`
- Demo: `(8 h projekt + 6 h realizace) * 800 Kc/h = 11 200 Kc`

Snapshot:

- Pri vytvoreni hodinove vyplaty se uklada `attendance_snapshot`.
- Uklada se take `snapshot_total_hours`, `snapshot_total_amount` a `calculation_hash`.
- `recalculate_hourly_payout_request` u snapshotovych zadosti nemeni historicky vypocet, pokud snapshot existuje.
- `get_hourly_payout_discrepancies` umi ukazat rozdil mezi aktualni dochazkou a snapshotem.

## Payout availability

Projektove polozky:

- `get_payout_availability` pouziva `get_projects_with_balance`.
- Dostupnost projektu = `total_reward - reserved_or_paid_amount`.
- Do `reserved_or_paid_amount` se pocitaji stavy `pending`, `approved`, `invoice_uploaded`, `paid`.
- Demo projekt: `11 000 - 7 000 = 4 000 Kc`.

Realizacni polozky:

- Dostupnost realizace = `total_share - reserved_or_paid_amount`.
- Demo realizace: `38 500 - 8 500 = 30 000 Kc`.

Hodinove vyplaty:

- Hodinove mzdy nejsou polozky v `payout_items`.
- Jdou pres samostatnou tabulku `hourly_payout_requests` a samostatny workflow schvalovani.

## CRM polozky, slevy a DPH

Polozky:

- 2 ks x `1 000 Kc`, sleva `0 %`, DPH `21 %`
- 1 ks x `500 Kc`, sleva `10 %`, DPH `12 %`

Vysledek:

- Pred slevou bez DPH: `2 500 Kc`
- Sleva bez DPH: `50 Kc`
- Bez DPH po sleve: `2 450 Kc`
- DPH: `474 Kc`
- Celkem s DPH v UI: `2 924 Kc`

Vzorec:

- Radek pred slevou = `quantity * unit_price`
- Radek po sleve = `round(quantity * unit_price * (1 - discount_percent / 100), 2)`
- Sleva = `subtotal - total`
- DPH = suma `line_total * vat_rate / 100`

## UI overeni

Playwright overil:

- Detail projektu, zalozka Finance:
  - tymovy budget `44 000 Kc`
  - hodinovy projektovy naklad `6 400 Kc`
  - zůstatek po nakladech `24 000 Kc`
  - pripsana rezije `5 000 Kc`
- Detail realizace:
  - smlouva/prijmy `230 000 Kc`
  - zisk firmy `34 500 Kc`
  - rezije firmy `11 500 Kc`
  - hodinova expozice `11 200 Kc`
  - celkove naklady `30 000 Kc`
  - tymovy rozpočet `154 000 Kc`
- Nova zadost o vyplatu pro `DEMO FIN Admin`:
  - projekt dostupny `4 000 Kc`
  - realizace dostupna `30 000 Kc`
- Administrace hodinovych vyplat:
  - `DEMO FIN Hodinovy clen`
  - `14,0 h`
  - `800 Kc/h`
  - `11 200 Kc`
- CRM:
  - obchodni pripad `DEMO-FIN CRM kalkulace` ma hodnotu `2 450 Kc`
  - nabidka `DEMO-FIN-OFFER` ma DPH `474 Kc` a celkem s DPH `2 924 Kc`
