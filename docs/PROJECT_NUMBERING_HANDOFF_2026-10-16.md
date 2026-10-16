# Předání: vytváření projektů, číslování a logo

Toto vydání obsahuje kompletní změny aplikace a jednu dopřednou databázovou
migraci. Zachovává existující data a čísla; neobsahuje export produkčních dat,
hesla ani klíče. Databázová migrace dosud nebyla na produkci provedena a nový
frontend dosud nebyl aktivován.

## Obsah vydání

- Dodané logo EKV Project v přihlášení, navigaci a dalších vstupních stránkách.
- Oprava prvního přepočtu `mv_user_project_rewards`: nepopulovaný materializovaný
  pohled se poprvé obnoví bez `CONCURRENTLY`, další obnovy zůstávají souběžné.
- Automatická čísla podle prefixu typu a roku, např. `FVE-26-001` a
  `OP-FVE-26-001`. Projekty a OP mají oddělené řady; typy se stejným prefixem
  sdílejí řadu v rámci příslušného druhu dokladu. Náhled číslo nespotřebovává;
  konečné číslo přiděluje databáze při uložení, takže se může od náhledu lišit.
- Správa prefixů v číselníku i přímo při založení projektu/OP. Existující typy
  dostanou výchozí prefix `PR`; konkrétní prefixy nastaví správce v aplikaci.
  OP bez typu respektuje dosavadní nastavení číslování OP.
- Jednodušší založení: stačí název, klient a rozpočtová hodnota mohou být
  doplněny později. Ruční kód projektu zůstává volitelný. Další údaje jsou
  ve sbalených sekcích. Existující obchodní pravidla (např. důvod prohry OP)
  zůstávají platná.
- Testy frontendové validace, preview workflow a databázového chování.

## Cílové prostředí a převzetí kódu

Stav ověřený při přípravě 14. 10. 2026; před nasazením znovu zkontrolovat:

- Frontend: `root@192.168.1.180`, `/opt/ekvportal` je odkaz na aktivní vydání.
- Produkční API: `https://portal.ekvproject.cz/supabase`. Nginx na webovém
  serveru předává API přes `127.0.0.1:18000`; při ověření tunel přicházel
  ze serveru `192.168.1.209`. Databáze neběží na webovém serveru.
- Původní cloud `yurysbxxevtuvhrbmloc.supabase.co` je pozastavený. Nepoužívat
  jej ani starý lokální `supabase link` pro tuto migraci.
- Aktivní vydání bylo `/opt/ekvportal-releases/payout-privacy-20261006-v1`,
  image `ekvportal:payout-privacy-20261006-v1`, frontend na portu `18080`.

Větev pro předání je `codex/project-numbering-migration`. Změny převzít do
aktuálního produkčního zdrojového kódu pomocí merge/cherry-pick a vyřešit
případné konflikty. Nenahrazovat celý produkční adresář starším checkoutem:
produkce obsahovala novější změny oprávnění navigace, pracovních štítků,
ochrany odměn a odkazu na finanční nastavení projektu. Zachovat je při sloučení.

Na webovém serveru je také připravené, neaktivované vydání
`/opt/ekvportal-releases/project-numbering-20261014-v1`, image
`ekvportal:project-numbering-20261014-v1`, kontejner
`ekvportal-project-numbering-candidate` na `127.0.0.1:18081`.
Vzniklo sloučením tehdejšího skutečného produkčního kódu s těmito změnami;
build i HTTP kontroly prošly. Soubor `PROJECT-NUMBERING-RELEASE.json` v tom
adresáři popisuje přípravu. Před jeho případným použitím ověřit, že mezitím
nevznikly další produkční změny. Kandidát nenahrazuje aplikaci SQL migrace.

## 1. Záloha a kontrola databáze

Správce potřebuje administrátorské připojení k aktuálnímu self-hosted
PostgreSQL. Veřejný frontendový anon klíč k migraci nestačí. Připojení předat
bezpečně mimo Git, např. pomocí chráněného `PGSERVICE`/`.pgpass` nebo existujícího
správcovského přístupu ke kontejneru. Níže `PGSERVICE=ekv-production` znamená
již nakonfigurovanou a ověřenou službu pro správnou databázi.

Před změnou pořídit ověřenou zálohu databáze, včetně
`supabase_migrations.schema_migrations`, a uložit ji mimo repozitář. Počítat
s krátkým servisním oknem: DDL migrace potřebuje zámky tabulek. Pozastavit
souběžné zápisy projektu/CRM během nasazení a dokončit rozpracované transakce.

Z kořene převzatého repozitáře na stroji s `psql`:

```bash
PGSERVICE=ekv-production psql -X -v ON_ERROR_STOP=1 \
  -f tools/project-numbering-preflight.sql
```

Preflight je pouze čtecí. Vypíše identitu spojení a kontroluje potřebné tabulky,
sloupce, funkce, role a unikátní index materializovaného pohledu. Pokud skončí
chybou, nejprve porovnat skutečné schéma; nepouštět automaticky historické migrace.
Ověřit také dosavadní historii verze `20261014090000` a její případné předchozí
provedení. Již aplikovanou migraci nepřepisovat ani znovu nepouštět naslepo.

## 2. Aplikace přesně jedné migrace

```bash
PGSERVICE=ekv-production psql -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261014090000_project_creation_numbering.sql
PGSERVICE=ekv-production psql -X -v ON_ERROR_STOP=1 \
  -f tools/project-numbering-postcheck.sql
PGSERVICE=ekv-production psql -X -v ON_ERROR_STOP=1 \
  -c "NOTIFY pgrst, 'reload schema';"
```

Migrace má vlastní `BEGIN`/`COMMIT`; nepřidávat `psql --single-transaction`.
Při chybě příkaz přeruší provádění a necommitovaná transakce se vrátí zpět.
Postcheck kontroluje strukturu a oprávnění, nevytváří obchodní data. Samotný
pohled může zůstat nepopulovaný až do první běžné obnovy; to je očekávané.

Po úspěšné aplikaci zaznamenat **pouze verzi `20261014090000`** do používané
migrační evidence běžným postupem správce pro tento self-hosted stack.
Pokud se používá `supabase_migrations.schema_migrations`, nejprve ověřit její
skutečnou strukturu a zachovat stejný formát metadat jako ostatní nasazení.
Historické migrace se s produkcí neshodují jedna ku jedné: nepouštět plošné
`supabase db push`, reset, baseline ani hromadnou opravu historie.

## 3. Build a přepnutí frontendu

Po sloučení s aktuálním produkčním kódem a úspěšné migraci:

1. Vytvořit nové vydání podle zavedeného postupu serveru. Zachovat aktivní
   `.env` bezpečně na serveru; příklad v `.env.deploy.example` neobsahuje klíč.
   `VITE_SUPABASE_URL` musí být `https://portal.ekvproject.cz/supabase` a anon
   klíč musí patřit k tomuto self-hosted backendu. Nikdy nevkládat service-role
   klíč do Vite proměnných. Vite prostředí se vkládá do aplikace při buildu.
2. Nainstalovat závislosti z lockfile (`npm ci`), spustit níže uvedené kontroly
   a `npm run build`, případně stejný build provést přes stávající Dockerfile.
3. Spustit kandidátní image na samostatném lokálním portu, ověřit HTML,
   `/projects/new`, `/crm/opportunities/new`, JS/CSS a
   `/branding/ekv-project-logo.png`. Preview fixtures nejsou produkční backend.
4. Přepnout produkční image a odkaz na nové vydání stávajícím postupem správce.
   Zachovat aktuální Nginx API proxy, porty a přístupová omezení. Zkontrolovat
   stav kontejneru a provést přihlášený test přes skutečné produkční API.

## 4. Kontrola chování po nasazení

- V číselníku nastavit požadovaný prefix typu, např. FVE → `FVE`.
- Se skutečným oprávněným uživatelem založit jednoznačně pojmenovaný kontrolní
  projekt jen s názvem a typem. Musí se uložit bez chyby `CONCURRENTLY`, dostat
  kód příslušné řady a ihned se objevit v seznamu. Kontrolní data následně
  vyřešit běžným postupem aplikace podle pravidel firmy.
- Založit OP bez klienta s typem FVE: číslo odpovídá `OP-FVE-YY-NNN` při
  základním prefixu OP. Přidat nový typ/prefix přímo ve formuláři a ověřit
  aktualizaci náhledu. Zkontrolovat OP bez typu i převod OP na projekt.
- Ověřit růst řady, odmítnutí duplicitního ručního kódu a zachování kódu při
  editaci staršího projektu. Zkontrolovat logo a mobilní formulář.
- Ověřit, že uživatel bez oprávnění nemůže ukládat typy ani vytvářet OP.

SQL regresi `supabase/tests/project_creation_numbering.sql` spouštět **pouze
v jednorázové testovací databázi** po migraci. Záměrně používá `WITH NO DATA`
a testovací uživatele; do produkce nepatří, přestože končí rollbackem.

## Ověření před předáním

- 224 Node testů a 18 preview kontrol prošlo.
- Cílený ESLint, kontrola migrací, finanční, bezpečnostní a UI invarianty prošly.
- Produkční build prošel lokálně i v připraveném serverovém kandidátu.
- Databázová chyba byla reprodukována na PostgreSQL enginu PGlite; po aplikaci
  migrace prošla SQL regrese včetně oprávnění, neúspěšných insertů, řad nad 999
  a zachování starých čísel. Není to ověření skutečné produkční databáze ani
  zátěžový test dvou souběžných připojení.
- Browser workflow ověřilo desktop i mobilní formuláře, změnu typu/prefixu,
  založení projektu a OP a okamžité zobrazení OP v seznamu.

Příkazy pro opakování kontrol v převzatém checkoutu:

```bash
node --test tests/*.test.mjs
node src/preview/test-preview.mjs
node tools/check-supabase-migrations.mjs
node tools/check-financial-calculations.mjs
node tools/check-critical-invariants.mjs
node tools/check-security-invariants.mjs
node tools/check-ui-invariants.mjs
npm run build
```

## Návrat při problému

Před přepnutím si zaznamenat skutečnou aktivní image, cestu vydání a konfiguraci.
Při problému frontendu vrátit předchozí image a odkaz obvyklým postupem serveru.
Nové sloupce/RPC mohou zůstat v databázi, ale ověřit chování staršího klienta;
ten nemusí vytvářet OP bez klienta ani pracovat s novými typy. Neodstraňovat
nové čítače, typy ani již vytvořené záznamy. Migrace nemá automatický down skript.
Při databázovém problému zastavit zápisy a připravit cílenou opravu; obnova celé
zálohy by ztratila změny vzniklé po jejím pořízení a vyžaduje rozhodnutí správce.
