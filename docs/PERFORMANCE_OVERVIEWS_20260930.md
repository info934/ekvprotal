# Zrychlení úvodních přehledů portálu

## Rozsah

- `/` (Moje práce): jeden `get_my_work_overview_v2` místo řetězce dotazů,
  opětovného ověřování identity a načítání všech plánovacích položek do klienta.
- `/dashboard`: `get_company_dashboard_v2` vrací přesné součty a omezené seznamy,
  nikoliv úplné tabulky. Grafy stavů dostávají agregace.
- Finanční souhrn používá samostatný `get_company_dashboard_finance_v2`.
  Zachovává dosavadní výpočetní funkce; jeho chyba neschová provozní přehled.
- Harmonogramy a jejich data se načítají až po otevření příslušné záložky.
- Paměťová cache má platnost 30 sekund a nejvýše 8 záznamů. Klíč zahrnuje
  uživatele, člena, roli, efektivní oprávnění, privátní režim a datum.
  Explicitní obnovení obejde cache, včetně harmonogramu po přepnutí záložek.
- Po změně identity nebo oprávnění se předchozí data okamžitě skryjí.
  Požadavky mají 20sekundový limit a při opuštění stránky se ruší.
- Lokální Performance entries `portal:get_*_v2` měří trvání RPC bez částek,
  identifikátorů a obsahu odpovědi. Neodesílají se žádné třetí straně.

## Databáze a bezpečnost

Migrace: `supabase/migrations/20260929190000_portal_overview_read_models.sql`.

Nové funkce jsou SECURITY INVOKER, mají prázdný search_path a zachovávají RLS.
Osobní přehled určuje identitu serverově přes auth.uid/get_member_id; nepřijímá
ID cizího člena. Finanční RPC je pouze pro admina. Privátní souhrn nevrací
finanční hodnoty. Anonymní role nemá právo funkce volat.

Migrace přidává dílčí indexy pro nepřečtená oznámení, otevřené přidělené úkoly
a plánovanou práci. Doplňuje pouze SELECT(code) na realizations; nepovoluje
čtení chráněných finančních sloupců. Nemění částky, výplaty ani přiřazení.

## Ověření

- Produkční build a cílený ESLint prošly.
- Kontrola migrací prošla: 159 verzovaných souborů bez duplicit.
- 23 cílených testů přehledu, cache, oprávnění a sjednocených úkolů prošlo.
- 18 existujících testů izolovaného UI náhledu prošlo.
- Skutečný SQL kód migrace prošel v PGlite (izolovaný PostgreSQL): přesné
  počty, omezené seznamy, deduplikace plánovacích úkolů, RLS, privátní režim,
  zákaz finančních dat pro běžného uživatele a úzká sloupcová oprávnění.
- Nezávislé review: opraveno chybějící oprávnění ke kódu realizace, izolace
  chyby finančního dotazu a obnovení harmonogramu přes odpojení záložky.
  Závěrečné review bez zbývajících závažných nálezů.
- Prohlížeč, izolovaný sestavený náhled: Moje práce, Přehled firmy,
  Harmonogramy, privátní režim a přepnutí admin/pracovník.

SQL test není plný replay produkčního schématu. Skutečné doby SQL a načítání
na produkčních datech je nutné změřit po nasazení; zatím neslibujeme konkrétní
procento zrychlení. Test 401 na /auth/v1/health není měření databázového výkonu.
Build stále hlásí velké samostatné balíky XLSX a plánovacího Ganttu.

## Nasazení

1. Ověřit zálohu a aktuální stav aplikovaných migrací.
2. Aplikovat novou migraci před frontendem. Obnoví i PostgREST schema cache.
3. Pod skutečným přihlášeným adminem i pracovníkem ověřit nové RPC, zejména
   oprávnění na tabulkách. Service-role test není náhradou za uživatelský test.
4. Nasadit frontend a ověřit úvodní stránky, součty, privátní režim a obnovu.
5. Porovnat Network/Performance při prvním otevření a návratu do 30 sekund,
   s VPN i bez ní. Finanční dotaz nesmí blokovat hlavní přehled.

Při rollbacku vrátit frontend; nové read-only funkce mohou zůstat v DB.
V tomto kroku nebyla provedena migrace ani nasazení do produkce.

## Lokální testy

```powershell
node --test tests/workspace.test.mjs tests/unified-tasks.test.mjs tests/overview-performance.test.mjs
node src/preview/test-preview.mjs
node tools/check-supabase-migrations.mjs
node tools/build.mjs
# PGLITE_MODULE nastavte na cestu k @electric-sql/pglite/dist/index.js mimo repo.
node tests/overview-postgres.test.mjs
```

PGlite je volitelná testovací závislost, není přidána do produkčního balíku.
Bez PGLITE_MODULE se SQL test výslovně přeskočí.
