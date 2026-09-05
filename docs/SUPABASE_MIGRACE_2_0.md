# Supabase – migrační balíček EKV Portal 2.0

Balíček připravuje backend pro frontend 2.0. Obsahuje 127 lokálních migračních souborů, z toho pět nových níže, konfiguraci Supabase, katalogové kontroly, čtyři SQL testy a zdroje Edge funkcí včetně `_shared`. Neobsahuje export provozních dat, přihlašovací údaje ani databázovou zálohu. **Nové migrace ani jejich integrační SQL testy dosud nebyly spuštěny.**

Všechny příkazy spouštějte **z kořene rozbaleného balíčku**, kde jsou adresáře `supabase`, `checks` a `docs`. Nasazení provádí jeden operátor; při první chybě zastavte. Nejprve postup ověřte na izolované testovací kopii skutečného schématu, teprve poté jej zopakujte pro produkční projekt.

## 1. Ověřený stav k 5. 9. 2026

Přihlášení, propojení CLI a read-only `00_preflight.sql` proběhly úspěšně přímo proti Supabase Cloud projektu **`yurysbxxevtuvhrbmloc`**. Nejnovější evidovaná migrace je `20260812150000`. Podrobné výsledky obsahuje [protokol živého preflightu z 5. 9. 2026](SUPABASE_LIVE_PREFLIGHT_20260905.md).

| Porovnání | Počet |
| --- | ---: |
| Lokální migrační soubory | 127 |
| Verze v produkční historii | 67 |
| Společné verze | 60 |
| Verze pouze v produkční historii | 7 |
| Starší verze pouze lokálně | 62 |
| Nové migrace 2.0 pouze lokálně | 5 |

Jde o známý historický nesoulad po ručních SQL nasazeních a baseline exportech, nikoli o důkaz, že produkci chybí všech 62 starších změn. Repo jej popisuje v `supabase/README.md` v části „Historical Migration Drift“ a v `docs/SUPABASE_MIGRATION_MAINTENANCE.md`; dokončený squash doložen není.

**Pro tento projekt nepoužívejte plošný `db push`, ani jeho dry-run jako podklad k automatickému dorovnání historie.** Nepoužívejte `--include-all`, `db reset` ani hromadné `migration repair`. Starou historii neoznačujte za aplikovanou jen proto, aby seznam souhlasil. Níže je postup pro jednu přesně ověřenou novou migraci, převzatý z pravidel tohoto repozitáře.

## 2. CLI a opakování read-only kontroly

Ověřená verze Supabase CLI je **2.109.1**. V pracovním repozitáři funguje vstup `node node_modules/supabase/dist/supabase.js`. Ukázky níže používají běžný příkaz `supabase`; pokud není v PATH, nahraďte jej tímto Node vstupem s cestou ke skutečně instalovanému CLI. Samostatný DB balíček `node_modules` neobsahuje. Pracovní adresář ponechte v kořeni rozbaleného balíčku.

V tomto pracovním prostředí již přihlášení a link fungují; neopakujte je zbytečně. Na jiném počítači se přihlaste přes `supabase login` a v nově rozbaleném balíčku propojte ověřený projekt. Níže uvedený krok `link` přeskočte, pokud je aktuální adresář již správně propojen. Pro staging použijte jeho vlastní project ref. Hodnota `project_id` v přiloženém `config.toml` označuje lokální konfiguraci, nikoli produkční cíl. Hesla a tokeny nevkládejte do příkazů ani protokolu.

```powershell
$ekvProjectRef = 'yurysbxxevtuvhrbmloc' # Produkce; pro staging doplnte jeho vlastni ref.
supabase link --project-ref $ekvProjectRef
if ($LASTEXITCODE -ne 0) { throw 'Propojeni projektu selhalo.' }
supabase migration list --linked
if ($LASTEXITCODE -ne 0) { throw 'Historii migraci se nepodarilo nacist.' }
supabase db query --linked --file checks/00_preflight.sql
if ($LASTEXITCODE -ne 0) { throw 'Preflight selhal.' }
```

`db query --linked --file` v ověřeném prostředí provádí kontroly bez `psql` a bez zadávání databázového hesla. Vrací však pouze **poslední SELECT** souboru. Předchozí kontroly `DO` přesto při nesplnění podmínky selžou; výpis závěrečné věty nezobrazuje výsledky všech předchozích katalogových dotazů. Vlastníci funkcí a indexy proto byly 5. 9. 2026 zvlášť přečteny a ověřeny samostatnými read-only dotazy. Při opakování nasazení je znovu vyhodnoťte jednotlivě nebo přes SQL Editor správného projektu.

Úspěšný preflight potvrzuje katalogové předpoklady. **Nepotvrzuje provedení nových migrací, shodu celé historické implementace ani runtime chování RLS, finančních výpočtů a souběhu.**

## 3. Pouze jedna ověřená migrace a její přesná evidence

Před zápisem zajistěte zálohu schématu, dat a `supabase_migrations.schema_migrations` s ověřeným obnovením do odděleného prostředí. Ověřte konkrétní SQL a jeho účinky na izolovaném stagingu, včetně příslušných funkčních testů. Pět nových souborů aplikujte jednotlivě v tomto pořadí:

| Soubor v `supabase/migrations/` | Změna |
| --- | --- |
| `20260905100000_active_account_authorization.sql` | Aktivní účet, identita a omezení RLS |
| `20260905110000_crm_atomic_workflows.sql` | Atomické CRM operace |
| `20260905120000_planning_status_alignment.sql` | Synchronizace zrušených úkolů a plánování |
| `20260905130000_employee_workspace.sql` | Zaměstnanci, majetek, smlouvy/ověření a žádosti |
| `20260905140000_finance_attendance_hardening.sql` | Souběh docházky a výplat, dávky, storno a ochrana faktur |

Příklad **pouze první migrace**, až po splnění předchozích podmínek a opětovném ověření cíle:

```powershell
supabase db query --linked --file supabase/migrations/20260905100000_active_account_authorization.sql
if ($LASTEXITCODE -ne 0) { throw 'Migrace selhala; neprovadejte evidenci ani dalsi migraci.' }
```

**Nyní samostatně ověřte výsledek této migrace**: skutečné objekty, ACL/RLS a požadované chování. U první migrace zejména přístup aktivního administrátora, odmítnutí deaktivovaného účtu a absenci rekurze RLS. `db query` sám nezapíše verzi do migrační historie. Teprve po potvrzeném výsledku zaznamenejte výhradně tuto konkrétní verzi:

```powershell
supabase migration repair --linked --status applied 20260905100000
if ($LASTEXITCODE -ne 0) { throw 'Evidence selhala; zkontrolujte stav bez opakovani SQL.' }
supabase migration list --linked
if ($LASTEXITCODE -ne 0) { throw 'Historii migraci se nepodarilo nacist.' }
```

Zaznamenejte verzi souboru, ověřený výsledek, cíl a revizi aplikace. Až poté přejděte na následující soubor a jeho odpovídající verzi. **Nepouštějte pětici ve smyčce a neopravujte automaticky historii starších 62 nebo sedmi vzdálených verzí.**

Migrace CRM a docházky přejmenovávají původní funkce na privátní helpery. **Nespouštějte je ručně znovu** a nepřepisujte už evidované soubory. Každá z pěti migrací má vlastní `BEGIN`/`COMMIT`; nepřidávejte společnou obalovou transakci.

Pokud se spojení přeruší nebo selže zápis historie po dokončeném SQL, je výsledek nejistý: ověřte skutečný stav a historii před dalším krokem. Znovuspuštění přejmenovávací migrace může selhat nebo poškodit návaznosti. Předchozí dokončené migrace při chybě dalšího souboru zůstávají aplikované; pokračujte až po vyjasnění stavu cílenou opravou dopředu.

Po ověření a přesném zaevidování všech pěti migrací:

```powershell
supabase db query --linked --file checks/99_postflight.sql
if ($LASTEXITCODE -ne 0) { throw 'Postflight selhal.' }
supabase db query --linked --file checks/00_preflight.sql
if ($LASTEXITCODE -ne 0) { throw 'Nesouhlasi prejmenovane funkce nebo puvodni vazby.' }
```

Postflight je opět pouze katalogová kontrola, v CLI se stejným omezením posledního SELECT. Nenahrazuje skutečné testy RLS, financí, souběhu ani externích integrací.

## 4. Znovu nasadit 11 Edge funkcí

Samotná změna `_shared` neaktualizuje nasazené funkce. Z téhož balíčku znovu nasaďte následujících 11 funkcí. Zachovejte původní `supabase/config.toml`: `manage-users` a `google-drive-esign` mají `verify_jwt = false` kvůli stávajícím reset/OAuth vstupům a vlastní autorizaci; ostatních devět má `verify_jwt = true`. Nepřidávejte hromadný přepínač `--no-verify-jwt` a neměňte produkční integrační secrets ani Auth nastavení podle lokálních ukázek.

```powershell
$ekvFunctions = @(
  'send-email', 'send-message-to-member', 'send-payout-notification',
  'send-admin-payout-notification', 'send-attendance-notification', 'send-payout-email',
  'manage-users', 'google-drive-esign', 'analyze-contract', 'document-storage',
  'planning-calendar'
)
foreach ($ekvFunction in $ekvFunctions) {
  supabase functions deploy $ekvFunction --project-ref $ekvProjectRef
  if ($LASTEXITCODE -ne 0) { throw "Selhalo nasazeni funkce $ekvFunction; dalsi kroky zastaveny." }
}
```

Ostatní přibalené funkce poskytují úplné zdroje; kvůli této změně je automaticky nepřenasazujte. Ověřte stav všech jedenácti nasazení a zachování jejich konfigurace.

## 5. Ověření a návaznost frontendu

Čtyři soubory v `supabase/tests/` (`active_account_authorization.sql`, `crm_atomic_workflows.sql`, `employee_workspace.sql`, `finance_attendance_hardening.sql`) jsou **pouze pro izolovanou migrovanou testovací databázi**. Přestože končí `ROLLBACK`, vytvářejí identity, záznamy a dočasně i triggery; na produkci je nespouštějte. Postup spuštění, samostatné scénáře souběhu, kontrola plánování a ověření přes skutečné API jsou v [podrobném rollout návodu](EKVPORTAL_2_0_BACKEND_ROLLOUT.md).

Porovnejte původní a nové finanční výsledky na stejných datech, otestujte aktivního/deaktivovaného uživatele, vlastní/cizí zaměstnaneckou evidenci, CRM zápisy, uzávěrku docházky a výplaty. Zachovejte historické částky, doklady, audity i potvrzení docházkových dávek. Při opravě nemažte HR tabulky ani finanční historii; preferujte cílenou opravnou migraci. Obnovení staré zálohy přímo přes živou DB by zahodilo novější data.

**Produkční frontend 2.0 nasazujte až po migracích, redeployi Edge funkcí a úspěšném ověření backendu.** Starší frontend nemusí být kompatibilní s novými pravidly mazání hodinových žádostí a ukládání docházky. UI náhled s ukázkovými daty není dokladem funkčního backendu.

Oficiální popis CLI a standardního nasazení pro prostředí s plně sladěnou historií: [Supabase – Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations). Plošné nasazení ani příklady resetu z obecného návodu nepřenášejte na tento projekt s ověřeným historickým nesouladem; zde platí výše uvedené jednotlivé ověření a přesná evidence každé nové verze.
