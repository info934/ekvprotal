# Rollout finančního workflow a diskrétnosti

## Rozsah

Rollout obsahuje čtyři navazující migrace:

1. `20260712173000_project_labor_funding_workflow.sql`
2. `20260712180000_admin_only_financial_privacy.sql`
3. `20260712181000_private_member_compensation.sql`
4. `20260712182000_financial_rollout_safety.sql`

Pořadí se nesmí měnit. Aplikace a databáze musí být nasazeny v jednom servisním okně.

## Povinná záloha

- Záloha schématu a dat online Supabase před migrací.
- Export minimálně tabulek `members`, `project_members`, `realizace_team_members`,
  `realization_profit_shares`, `attendance`, `attendance_submissions`,
  `hourly_payout_requests`, `payouts` a `payout_items`.
- Zapsat aktuální commit aplikace a poslední aplikovanou migraci.

## Preflight

1. `npm run financial:check`
2. `npm run test:critical`
3. `npm run lint`
4. `npm run build`
5. `supabase migration list --linked`
6. Ověřit, že na produkci neběží schvalování docházky nebo výplaty.

## Datové kontroly před migrací

- Každý hodinový pracovník má kladnou sazbu.
- Neexistují překrývající se intervaly sazeb.
- Schválená docházka má záznamy pouze v jednom měsíčním výkazu.
- Součet procentních podílů realizace nepřesahuje 100 %.
- Vyplacené žádosti mají datum a identitu schvalujícího.

## Nasazení

1. Zapnout krátký maintenance režim pro finanční zápisy.
2. Aplikovat pending migrace na linked Supabase.
3. Spustit `tools/financial-rollout-postcheck.sql` jako administrátor databáze.
4. Nasadit build stejného commitu aplikace.
5. Restartovat frontend kontejner a ověřit health endpoint.
6. Vypnout maintenance režim až po smoke testu.

## Smoke test rolí

### Admin

- Vidí finance projektů a realizací.
- Vidí sazby všech pracovníků.
- Může nastavit způsob financování pracovníka.
- Může atomicky uložit podíly realizace.
- Může schválit výplatu.

### Běžný pracovník

- Vidí pouze vlastní sazbu, vlastní žádosti a vlastní odměny.
- Nevidí částky jiných členů týmu ani firemní/projectové souhrny.
- Nemůže měnit svou sazbu ani finanční parametry projektu.
- Může vytvořit řádnou hodinovou žádost jen ze schváleného ledgeru.

### Projektový manažer / super manager

- Vidí nefinanční projektová data a tým.
- Nevidí globální ani cizí finanční částky.
- Nemůže měnit odměny, sazby ani sponzorované financování.

## Funkční smoke test

1. Schválit testovací docházku bez existující výplaty.
2. Ověřit vytvoření `labor_cost_ledger` se snapshotem sazby.
3. Vytvořit hodinovou žádost a porovnat `total_amount` se součtem `pay_amount` ledgeru.
4. Schválit a označit testovací žádost jako vyplacenou.
5. Ověřit, že vyplacený výkaz nelze vrátit k úpravě.
6. U realizace uložit dva podíly a ověřit auditní událost.
7. Přihlásit se jako neadmin a ověřit odmítnutí přímého REST čtení finančních sloupců.

## Rollback

Migrace mění RLS, funkce a oprávnění sloupců. Rollback nelze bezpečně řešit pouze
vrácením frontendového commitu. Při selhání:

1. Ponechat maintenance režim.
2. Neprovádět nové finanční zápisy.
3. Obnovit databázi z předmigrační zálohy.
4. Nasadit předchozí aplikační commit.
5. Ověřit integritu výplat a docházky před znovuotevřením.

## Známé omezení první verze

- Doplatky a záporné opravy hodinových výplat jsou dočasně blokované. Vyžadují
  samostatný auditovaný korekční ledger, aby se již vyplacené řádky nepřepisovaly.
- CRM skladové pohyby se nemění; pracovní ledger řeší pouze práci a odměny.
