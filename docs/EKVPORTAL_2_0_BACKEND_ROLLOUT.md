# EKV Portal 2.0 – nasazení backendu

Stav dokumentu: 5. 9. 2026. Popisuje připravené změny v repozitáři a plán jejich ověření. Při přípravě tohoto dokumentu nebyly spuštěny migrace, SQL integrační testy, nasazení Edge funkcí ani produkční operace. Níže uvedené příkazy SQL testů jsou určeny obsluze testovacího prostředí; jejich úspěch zatím není potvrzen.

Rozsah: blokování deaktivovaných účtů, atomické CRM operace, synchronizace zrušených úkolů, nová zaměstnanecká karta a ochrana souběžných změn docházky/výplat a jejich dokladů. Finanční vzorce a historické částky zůstávají zachovány. Zaměstnanecké žádosti zatím schvaluje pouze aktivní administrátor s rolí `admin`; role vedoucích se tímto nerozšiřují.

## 1. Předpoklady a pořadí migrací

Nejprve porovnat historii nasazených migrací s celým repozitářem. Následujících pět souborů je přírůstkem nad dosavadním schématem, nikoli samostatnou instalací. Vyžadují předchozí migrace identity a `user_account_status`, CRM včetně finančních výpočtů, číslování a snapshotů dokumentů, produktových sestav, plánování, docházky a pracovního ledgeru. Zvlášť ověřit dostupnost identity z `20260725110000_resolve_current_member_identity.sql` a existujících finančních CRM funkcí. Použít standardní evidovaný migrační proces projektu, který aktualizuje historii migrací; nespouštět již evidovanou migraci znovu ručně.

| Pořadí | Soubor v `supabase/migrations/` | Účinek a závislosti |
| --- | --- | --- |
| 1 | `20260905100000_active_account_authorization.sql` | Upravuje `get_member_id`, `get_user_role`, `get_permissions`. Přidává restriktivní AND podmínku aktivního účtu k existujícím veřejným RLS tabulkám a `storage.objects`, kromě `user_account_status`. Zachovává dosavadní granty a kompatibilitu účtů bez explicitního stavového řádku. |
| 2 | `20260905110000_crm_atomic_workflows.sql` | Atomické vytvoření, přesun/kopie a uložení CRM dokumentů, produktových sestav a editovaných polí příležitosti. Původní finanční implementaci přejmenovává na neveřejný helper `replace_crm_opportunity_items_financial_v1`; obaluje ji zámkem a kontrolou oprávnění. Proto migraci neopakovat mimo migrační historii. |
| 3 | `20260905120000_planning_status_alignment.sql` | Přidává stav úkolu `Zrušeno`, upravuje dvě existující synchronizační trigger funkce a převádí stav již propojených zrušených položek plánování. Backfill potlačuje zpětnou synchronizaci, aby neměnil další pole plánování. |
| 4 | `20260905130000_employee_workspace.sql` | Přidává pět soukromých zaměstnaneckých tabulek, RLS, audit a šest zapisovacích RPC. Závisí na aktivní identitě z migrace 1; nové tabulky mají vlastní restriktivní podmínku aktivního účtu. Nikoho automaticky neoznačuje za zaměstnance. |
| 5 | `20260905140000_finance_attendance_hardening.sql` | Sjednocuje zámky docházky a hodinových žádostí, přidává atomickou dávku s potvrzením pro opakování, storno hodinové žádosti a kontrolu jejího snapshotu. Uzavírá přímý přístup k interním helperům, řadí projektové zámky výplat, opravuje zdrojové pole ledgeru při nevyplacené opravě a výpočet kontrolních rozdílů. Vyžaduje původní attendance workflow, ledger a projektové finanční guardy včetně `20260812003000_project_member_net_reward_guards.sql`. |

Všech pět migrací obsahuje vlastní transakci. Úspěšně dokončené předchozí migrace zůstávají platné, pokud další selže. Nevkládat jejich soubory do dalšího ručně přidaného `BEGIN`/`COMMIT` a při chybě nepokračovat dalším nasazovacím krokem.

Před aplikací na stagingu ověřit vlastníky a ACL existujících identity helperů a skutečné RLS nastavení. Jejich `SECURITY DEFINER` musí mít oprávnění číst identitu a stav bez rekurze přes vlastní RLS; repozitář používá vlastníka `postgres`. Tabulka `user_account_status` je z hromadné restriktivní politiky úmyslně vynechána. Nové zaměstnanecké politiky čtou profil, jehož vlastní politika neodkazuje zpět do ostatních zaměstnaneckých tabulek.

Nejde o globální PostgREST pre-request hook: žádný takový hook ani globální konfigurace se nemění. Ochrana se týká identity helperů, RPC, které je používají, uvedených RLS tabulek a upravených Edge vstupů. Historické `SECURITY DEFINER` funkce, které identitu vůbec nekontrolují, nelze pouze touto migrací prohlásit za prověřené. Existující důvěryhodné cesty se `service_role` nepředstavují běžný uživatelský přístup a nesmějí se dostat do frontendové konfigurace.

## 2. Závislosti frontendů na RPC

Nový produkční frontend nasadit až po migracích a ověření dostupnosti RPC přes skutečné staging API. Kontrolovat i PostgREST schema cache. Následující tabulka uvádí nové nebo změněné závislosti; signatury dosavadních finančních a výplatových RPC zůstávají zachovány, jejich vybrané implementace se zpřísňují migrací 5.

| Frontend / datová vrstva | RPC | Požadovaná migrace / chování |
| --- | --- | --- |
| `src/contexts/SupabaseAuthContext.jsx` | `get_user_role()`, `get_permissions(p_role)`, existující `get_current_member_identity()` | Migrace 1 upravuje první dvě funkce a jejich společný helper `get_member_id()`, který používá i existující identita. Deaktivovaný účet musí být odmítnut i s dosud platným JWT; obnovení tokenu znovu načítá oprávnění. |
| `src/components/CRM.jsx` | `replace_crm_opportunity_items(p_opportunity_id, p_items, p_sync_documents)` | Migrace 2: stávající veřejné jméno, nově zamčená a autorizovaná obálka původního finančního výpočtu. |
| `src/components/CRM.jsx`, `src/components/CRMCommercialDocuments.jsx` | `create_crm_commercial_document_atomic(p_opportunity_id, p_type, p_new_opportunity, p_notes)` | Migrace 2: příležitost, číslo, hlavička a položky dokumentu v jedné transakci. |
| `src/components/CRMCommercialDocuments.jsx` | `save_crm_commercial_document_draft(p_document_id, p_document, p_items, p_sync_items)` | Migrace 2: zamčené uložení a konzistentní snapshot dokumentu. |
| `src/components/CRMCommercialDocuments.jsx` | `relate_crm_commercial_document_atomic(p_document_id, p_target_opportunity_id, p_action, p_item_mode, p_items)` | Migrace 2: přesun/kopie a volba zdroje položek v jedné transakci. |
| `src/components/ProductSetManager.jsx` | `save_product_set_atomic(p_set_id, p_set, p_items)` | Migrace 2: hlavička a položky sestavy společně, včetně validace konečného kladného množství. |
| `src/lib/crmOpportunityDraft.js` → CRM | `save_crm_opportunity_fields_atomic(p_opportunity_id, p_fields, p_expected_fields, p_custom_fields)` | Migrace 2: pouze změněná pole, porovnání očekávaných hodnot, konflikt `40001`; ostatní vlastní pole se zachovají. |
| `src/lib/planningService.js` | Existující `save_planning_item_with_resources` | Migrace 3 nepřidává RPC ani nemění jeho signaturu. Zajišťuje následnou obousměrnou synchronizaci stavů přes existující triggery. |
| `src/lib/employeeWorkspaceData.js` → zaměstnanecká karta | Šest RPC níže | Migrace 4; čtení používá přímo nové tabulky pod RLS. |
| `src/lib/attendanceWorkflowService.js`, `src/lib/attendanceMutations.js` | `save_attendance_records(p_records, p_batch_id)` | Migrace 5: celý nový výkaz/dávka v jedné transakci se stabilním UUID; používá se i pro vytvoření jediného řádku. |
| Docházka, globální docházka a schvalování | Stávající `save_attendance_record`, `delete_attendance_record`, `submit_attendance_month`, `approve_attendance_submission`, `reject_attendance_submission`, `revert_attendance_submission`, `return_attendance_submission_for_edit`, `withdraw_attendance_submission`, `delete_attendance_submission` | Migrace 5 zachovává parametry a návratové JSON řádky; společný zámek člena se získá před zámkem řádku nebo měsíce. |
| Hodinové žádosti / výplaty | `cancel_hourly_payout_request(p_request_id, p_reason)` | Migrace 5: storno zachová řádek, snapshot i audit; nahrazuje klientské mazání. Přímý `DELETE` je odebrán. |
| Schvalování a proplacení | Stávající `create_hourly_payout_request`, `approve_hourly_payout_request`, `mark_hourly_payout_paid`, `get_hourly_payout_discrepancies` | Migrace 5: uzavřený měsíc a ledgerový snapshot musí dál odpovídat. Kontrolní TABLE RPC má stejné sloupce, součet používá přesná `ledger_id`, nikoli zaokrouhlenou váženou sazbu násobenou celým měsícem. |
| Zamítnutí výplat | Stávající `reject_payout(p_payout_id, p_admin_note)`, `reject_hourly_payout_request(p_request_id, p_rejection_reason)` | Migrace 5: server vyžaduje neprázdný důvod. |

Zaměstnanecká RPC vracejí uložený řádek jako JSON:

Při založení majetku nebo záznamu klient generuje stabilní UUID v `p_asset.id` / `p_record.id`; `p_asset_id` / `p_record_id` zůstává `null`. Opakování se stejným zaměstnancem a normalizovaným obsahem vrátí původní řádek. Stejné ID s jiným obsahem nebo zaměstnancem je odmítnuto. Úpravy existujícího záznamu dál používají `p_asset_id` / `p_record_id`. Integrační SQL sada obsahuje také scénáře souběžného vytvoření, které je nutné provést ve stagingu.

| RPC a pojmenované argumenty | Oprávnění a účinek |
| --- | --- |
| `set_employee_profile(p_member_id, p_employment_status, p_note)` | Aktivní admin explicitně vytvoří/změní profil `active` / `inactive`. Nemění `members.user_role`, přihlášení ani `user_account_status`. |
| `save_employee_asset(p_member_id, p_asset, p_asset_id)` | Aktivní admin založí předání nebo upraví stále vydaný majetek. Vrácený záznam nelze touto cestou znovu otevřít či přiřadit jinému členovi. |
| `return_employee_asset(p_asset_id, p_returned_on, p_note)` | Aktivní admin uzavře vydání přechodem `issued` → `returned`. |
| `save_employee_record(p_member_id, p_record, p_record_id)` | Aktivní admin zapisuje metadata smlouvy, ověření či školení. `verified_by` / `verified_at` určuje server. |
| `create_employee_request(p_request)` | Vlastní aktivní zaměstnanec vytvoří `pending` žádost. Člen a stav se neurčují klientem. Stabilní UUID v `p_request.id` dovoluje bezpečně opakovat stejný obsah po síťové chybě; cizí ID ani změněný obsah stejného ID nejsou přijaty. |
| `transition_employee_request(p_request_id, p_status, p_note)` | Vlastník s aktivním profilem smí pouze vlastní `pending` → `cancelled`. Aktivní admin smí `pending` → `approved` / `rejected` a `approved` → `fulfilled`. Zamítnutí vyžaduje důvod. Řádek se zamyká `FOR UPDATE`; rozhodnutí a splnění mají vlastní čas a aktéra. |

Čtení používá `employee_profiles`, `employee_asset_assignments`, `employee_records`, `employee_requests` a `employee_request_events`. Frontendový join žádosti na člena je explicitně `member:members!employee_requests_member_id_members_fkey(id,name,job_title)`; tento pojmenovaný FK je součástí migrace 4. Aktéři jsou ID z `members`, nikoli předpokládaná shodná ID z `auth.users`.

Běžní klienti mají k novým tabulkám pouze `SELECT` omezený RLS; zápis probíhá výhradně přes autorizovaná RPC. Admin čte všechny zaměstnanecké záznamy, běžný uživatel pouze vlastní a jen při aktivním zaměstnaneckém profilu. `anon` nemá přístup k těmto tabulkám ani veřejným zaměstnaneckým RPC. Přímé zápisy jsou odebrány i roli `service_role`. Události přechodů se přidávají serverovým triggerem; aktualizaci a smazání historie blokuje trigger i aplikační oprávnění.

Docházková dávka `save_attendance_records` přijímá 1 až 100 nových řádků jednoho člena: `member_id`, `date`, `hours`, právě jedno `project_id` nebo `realization_id`/`realizace_id` a volitelné `description`. `p_batch_id` je povinné UUID držené po dobu otevřeného formuláře i po síťové chybě. Stejný aktér, cílový člen a normalizovaný obsah vrátí původní výsledek; jiné údaje se stejným ID server odmítne. Editace existujícího řádku dál používá `save_attendance_record` s `p_record_id`. Tabulka potvrzení `attendance_write_batches` má zapnuté RLS a žádné přímé klientské granty.

`submitted` a `approved` měsíce nelze upravovat ani administrátorem. Aktivní nebo vyplacená hodinová žádost navíc blokuje znovuotevření měsíce; nejprve se musí provozně vyřešit nevyplacená žádost. Práva docházky nadále určuje `can_admin_module('attendance')` / `can_edit_module('attendance')`, nikoli samotný název role `super_manager`. Storno hodinové žádosti dovoluje vlastníkovi pouze `pending`, administrátorovi výplat `pending`, `approved` nebo `invoice_uploaded`. Zamítnuté a vyplacené žádosti zůstávají v historii. Opakování již provedeného storna vrátí původní řádek bez nové události; dokument faktury se nemaže.

Migrace 5 nepřepočítává staré mzdy. U ledgerových žádostí kontroluje přesné zdrojové řádky a částky; u starších detailních snapshotů porovnává zaznamenané řádky docházky a ponechává původní sazbu. Historické záznamy bez detailního snapshotu zůstávají ve stávajícím režimu a nelze je označovat za nově ověřené vůči ledgeru. Interní `recalculate_hourly_payout_request`, `build_hourly_attendance_snapshot` a nově přejmenovaná těla `*_private_20260905` nejsou přímá frontendová API.

Odebrání faktury vyžaduje nejprve potvrzené `clear_payout_invoice` / `clear_hourly_payout_invoice` a až potom úklid fyzického souboru. Hodinová faktura musí být ve stavu `invoice_uploaded`; stornované, zamítnuté a vyplacené doklady zůstávají v historii. Migrace 5 přidává restriktivní DELETE politiku na `storage.objects`, která chrání soubor stále odkazovaný úkolovou či hodinovou výplatou; nerozšiřuje INSERT/SELECT ani původní oprávnění k odstranění. `document-storage` používá `_shared/invoiceDeletionGuard.ts` a před externím DELETE ověřuje obě tabulky podle uloženého ID souboru/připojení a URL. Selhání ověření se zamítne. Po potvrzeném odpojení a selhání úklidu UI ukáže upozornění, znovu nevolá změnové RPC a nezničí odkaz na živý doklad.

Databáze a externí úložiště nejsou jedna transakce. Kontrola reference v Edge neudržuje databázový zámek po dobu Microsoft Graph DELETE; souběžné nové připojení téhož externího ID proto musí být součástí stagingového ověření a správy zbylých souborů. Současný rozsah nepřidává úklidový job. Staré soubory v kořeni Supabase bucketu mohou po odpojení ztratit vlastnický odkaz potřebný pro stávající cleanup politiku: výsledek je zachovaný soubor a upozornění, ne opakování finanční změny; správce jej uklidí kontrolovaně. Otevřené staré klienty, kteří mazali soubor před DB změnou, při rollout aktualizovat.

## 3. Edge funkce, které je nutné znovu nasadit

Seznam vychází z importů v `supabase/functions/`, nikoli z názvů funkcí. `_shared/authorize.ts` nově importuje `_shared/accountStatus.ts`. Změna souboru `_shared` sama o sobě neaktualizuje již nasazené balíčky; znovu nasadit všech těchto **11** spotřebitelů ze stejné ověřené revize:

| Edge funkce | Změněná závislost |
| --- | --- |
| `send-email` | `authorize` → `accountStatus` |
| `send-message-to-member` | `authorize` → `accountStatus` |
| `send-payout-notification` | `authorize` → `accountStatus` |
| `send-admin-payout-notification` | `authorize` → `accountStatus`, `emailDelivery` |
| `send-attendance-notification` | `authorize` → `accountStatus`, `emailDelivery` |
| `send-payout-email` | `authorize` → `accountStatus`, `emailDelivery` |
| `manage-users` | Přímý `accountStatus`; také blokování/odblokování účtu v Auth |
| `google-drive-esign` | Přímý `accountStatus`, včetně kontroly vlastníka OAuth callbacku |
| `analyze-contract` | Přímý `accountStatus` |
| `document-storage` | Přímý `accountStatus` |
| `planning-calendar` | Přímý `accountStatus` |

`send-scheduled-reports` uvedené změněné helpery neimportuje a kvůli tomuto importnímu grafu redeploy nepotřebuje. `emailDelivery` se týká pouze tří výše označených funkcí; nelze jeho záruky automaticky vztáhnout na každý odesílač e-mailu v projektu.

Zachovat nastavení `supabase/config.toml`: `verify_jwt = false` pro `manage-users` a `google-drive-esign` umožňuje jejich stávající veřejné reset/OAuth vstupy; privilegované akce mají vlastní ověření identity a aktivního účtu. Ostatních devět výše uvedených funkcí má `verify_jwt = true`. Neměnit tento režim hromadným přepínačem při deployi. Nenahrazovat existující OAuth, e-mailové ani jiné integrační nastavení ukázkovými hodnotami.

Při deaktivaci `manage-users` nejprve uloží zákaz v DB a následně blokuje Auth účet. Selhání Auth kroku ponechá zákaz DB a vrátí chybu; operátor musí dokončit synchronizaci stavu. Při aktivaci se nejprve odblokuje Auth a až potom DB. Chyba při načtení stavu účtu neudělí přístup.

## 4. Stagingové testy – připravený postup, neprovedeno

Použít samostatnou, již migrovanou a obnovitelnou testovací kopii Supabase bez provozních uživatelů a napojených produkčních příjemců e-mailů. SQL sady vyžadují připojení s testovacími právy `postgres`, zakládají fixture identity a přepínají lokální roli/JWT claims. Končí `ROLLBACK`. CRM test dočasně vytváří trigger na skutečné testované tabulce; proto tyto sady nespouštět na produkci ani souběžně s běžným stagingovým provozem.

Obsluha předem nakonfiguruje lokální libpq service alias `ekvportal_staging_test` pro tuto izolovanou databázi. Alias je příklad; není to existující potvrzené připojení. Hesla a tokeny nepatří do příkazů, dokumentu ani logů. Z kořene repozitáře spustit v PowerShellu jednotlivě, vždy zastavit při nenulovém výsledku:

```powershell
psql "service=ekvportal_staging_test" -X -v ON_ERROR_STOP=1 -f supabase/tests/active_account_authorization.sql
if ($LASTEXITCODE -ne 0) { throw 'Selhal test aktivního účtu.' }

psql "service=ekvportal_staging_test" -X -v ON_ERROR_STOP=1 -f supabase/tests/crm_atomic_workflows.sql
if ($LASTEXITCODE -ne 0) { throw 'Selhal test CRM transakcí.' }

psql "service=ekvportal_staging_test" -X -v ON_ERROR_STOP=1 -f supabase/tests/employee_workspace.sql
if ($LASTEXITCODE -ne 0) { throw 'Selhal test zaměstnanecké karty.' }

psql "service=ekvportal_staging_test" -X -v ON_ERROR_STOP=1 -f supabase/tests/finance_attendance_hardening.sql
if ($LASTEXITCODE -ne 0) { throw 'Selhal test docházky a finančních uzávěrek.' }
```

Tyto sady obsahují následující kontroly; jejich samotná existence není výsledkem provedení:

| Sada | Scénáře |
| --- | --- |
| `active_account_authorization.sql` | Aktivní admin, účet bez explicitního stavového řádku s jednoznačným e-mailem, deaktivovaný admin se starým JWT, identity/permission RPC, RLS čtení i zápis, anonymní přístup a reaktivace. |
| `crm_atomic_workflows.sql` | Vytvoření s finančním výsledkem a snapshotem, kopie podle cílové příležitosti, rollback hlaviček/položek/číslování po vynucené chybě, nepřesouvání finalizovaného dokumentu, atomické sestavy a neplatná množství, konflikty běžných i vlastních polí bez částečného zápisu, neveřejná původní finanční funkce, zákaz anon a deaktivovaného účtu. |
| `employee_workspace.sql` | Explicitní profil, vlastní/cizí/neexistující profil, zákaz přímých zápisů a vlastního schválení, podvržený vlastník, opakování stejného ID, neplatná částka/URL, storno, povinný důvod zamítnutí, schválení/splnění a zastaralý přechod, audit a zákaz jeho smazání, vrácení majetku, neaktivní zaměstnanec, deaktivovaný admin a ACL. |
| `finance_attendance_hardening.sql` | Atomická dávka a rollback při překročení 24 hodin, bezpečné opakování i po uzavření měsíce, zákaz cizího zápisu, zamčení uzavřeného měsíce, zachování storna a auditu, zákaz přímého mazání a interního čtení cizí mzdy, oprava projektu/data v nevyplaceném ledgeru, odmítnutí změněného snapshotu, součet dvou sazeb bez falešného nesouladu a neměnnost vyplaceného měsíce. |

Pro plánovací migraci není v repozitáři samostatný SQL testovací soubor. Na izolovaných datech doplnit a zaznamenat ruční kontrolu: `project_tasks.status = 'Zrušeno'` vytvoří/aktualizuje propojené `planning_items.status = 'cancelled'`; opačná změna nastaví `Zrušeno`, nikoli `Nové`; `Hotovo` / `done` a rozpracované stavy dál fungují. U předmigračního propojeného zrušeného záznamu porovnat před/po všechna ostatní pole plánování, hierarchii a přiřazení zdrojů. Ověřit, že se nevyvolá nekonečná trigger rekurze a že zrušené úkoly nevstupují do aktivního postupu projektu.

SQL sady běží v jedné session. Skutečný souběh ověřit dvěma nezávislými stagingovými spojeními: souběžné schválení/zamítnutí téže `pending` žádosti má povolit jediný přechod a jedinou novou událost; druhá operace po uvolnění zámku selže. Stejně prověřit souběžné vytvoření stejného UUID a stejného obsahu žádosti – vznikne jeden řádek a jedna počáteční událost. U CRM ověřit souběžnou editaci stejného pole (konflikt) a různých vlastních polí (zachování obou), uložení dokumentu a jeho přesun při souběhu, bez částečných zápisů a deadlocku.

Finanční SQL sada navíc obsahuje kontrolu změněného `posting_month` a `funding_mode` proti snapshotu, platného již vyplaceného ledgeru a zákaz přímého smazání stále připojeného dokladu přes Storage RLS (včetně historické URL s českým názvem souboru). Po úspěšném `clear_hourly_payout_invoice` má být odpojený soubor ve strukturované cestě odstranitelný při zachování dosavadních oprávnění. Souběh dvou členů s opačným pořadím projektů/realizací prověřit také při schválení/opravě docházky a změně hodinové žádosti; nové ledgerové zápisy předem zamykají projekty podle UUID a následně realizace podle UUID. Tyto SQL scénáře nebyly lokálně provedeny.

Pro migraci 5 doplnit souběh první měsíční uzávěrky a nové docházky před existencí submission řádku, dvou dávek přesahujících společně 24 hodin, stejného `p_batch_id`, založení hodinové žádosti proti otevření měsíce a schválení/proplacení/storna téže žádosti. Dvě paušální žádosti různých členů se stejnými projekty v opačném pořadí mají zamykat projekty ve stejném pořadí UUID. Přesné očekávané výsledky jsou v závěru SQL sady. PostgreSQL/Docker ani skutečný SQL parser nebyly v místním prostředí nalezeny; kontrola migračního manifestu nepotvrzuje syntaxi či runtime chování těchto SQL funkcí.

Nad skutečným stagingovým API doplnit testy, které SQL fixture nenahrazuje:

1. Přihlášení aktivního účtu, obnovení tokenu, změna role a deaktivace během otevřené stránky. Starý uživatelský token nesmí projít chráněným RPC, RLS čtením/zápisem ani žádným z 11 upravených privilegovaných Edge vstupů. Prověřit neaktivního zaměstnance odděleně od deaktivovaného přihlášení.
2. OAuth callback a reset hesla v testovací konfiguraci; po změně autorizačních kontrol musí fungovat povolené veřejné vstupy a odmítat nepovolené privilegované akce.
3. E-mailové testy pouze s testovacím poskytovatelem/příjemcem: nedostupný záznam odeslání před provider voláním, souběžný pokus, timeout po přijetí providerem, definitivní odmítnutí a selhání uložení potvrzení. Po timeoutu či `pending` nesmí vzniknout druhé odeslání. Lokální testy používají adaptéry a nenahrazují integrační ověření poskytovatele.
4. Zaměstnanec nevidí cizí metadata přímým REST dotazem; `super_manager` nesmí schvalovat zaměstnanecké žádosti. Admin může spravovat i dříve deaktivovaný zaměstnanecký profil, pokud jeho vlastní portalový účet zůstává aktivní.
5. Porovnání stávajících finančních výsledků, výplat, docházky a finalizovaných CRM snapshotů před/po na stejných datech; samostatně ověřit příslušné role a dosavadní schvalovací cesty.
6. Odebrání faktury proti souběžnému zaplacení/stornu, výpadek odpovědi DB po provedeném clear a selhání fyzického cleanup. Nepotvrzená změna nesmí spustit mazání, chyba doplňkového logu nesmí zneplatnit potvrzený výsledek. Přímé externí DELETE živého dokladu musí skončit 409 bez Graph DELETE, chyba lookupu 503. Ověřit Supabase i SharePoint cestu; lokální testy adaptéru tyto integrace nenahrazují.

Lokální kontroly zdrojů spouštěné z kořene repozitáře: `npm test`, `npm run test:preview` a `npm run build`. Úspěch JS testů, testu ukázkového klienta či produkčního buildu nedokazuje průchod skutečného SQL/RLS ani funkčnost externí integrace. Výsledky stagingu zapisovat s revizí aplikace, historií migrací a použitou rolí, bez tokenů a osobních dat.

## 5. Bezpečné pořadí nasazení

1. Zafixovat společnou revizi frontend/backend, ověřit dosavadní migrační historii a připravit zálohu databáze s ověřeným obnovením do odděleného prostředí. Uchovat předchozí frontendový artefakt, Edge revize a stav ACL/politik. Před změnou uložit srovnávací finanční výsledky a počty relevantních záznamů.
2. Na stagingu aplikovat pět migrací v uvedeném pořadí standardním migračním procesem. Po první migraci ověřit aktivního administrátora a absenci RLS rekurze. Po poslední ověřit tabulky, veřejné signatury RPC a jejich granty; při zastaralé API cache provést obvyklé obnovení PostgREST schématu a znovu načíst RPC přes API.
3. Nasadit všech 11 Edge funkcí ze stejné revize se zachováním jejich konfigurace. Použít existující bezpečně spravované stagingové secrets; tento postup nevyžaduje jejich zveřejnění ani načítání do pracovního logu.
4. Dokončit SQL sady a integrační scénáře výše. Selhání RLS, auditních pravidel, financí nebo nejisté duplicitní odesílání jsou důvodem rollout zastavit a opravit na stagingu.
5. Sestavit běžný produkční frontend příkazem `npm run build` a otestovat jej proti stagingovému backendu. `preview:ui`, `preview.html` a výstup `build/ui-preview` obsahují ukázková data; nejsou produkčním artefaktem ani důkazem napojení na backend.
6. Po splnění stagingových kontrol použít stejné pořadí pro schválené produkční nasazení: databáze → všech 11 Edge funkcí → produkční frontend. Omezit současné zápisy během výměny a počítat s otevřenými starými klienty. Neprovádět hromadné zařazení členů jako zaměstnanců; konkrétní profily založí admin až podle skutečné evidence.
7. Provést kontrolu aktivního admina a běžného zaměstnance, CRM uložení, plánování, docházky a stávajících financí. Sledovat chyby `42501`, `40001`, chybějící RPC/tabulky, selhanou synchronizaci Auth stavu a e-mailové `pending`. Rozlišovat očekávané odmítnutí neplatné akce od systémové chyby.

## 6. Návrat a obnova bez smazání HR/auditu

Pokud migrace selže, zastavit rollout, zkontrolovat výsledek transakce a migrační historii a opravit příčinu. Neoznačovat neprovedenou migraci jako úspěšnou, neaplikovat další kroky naslepo a nepoužívat `db reset` jako návrat provozní databáze.

Při problému nového UI lze vrátit předchozí frontendový artefakt a ponechat nové DB tabulky a ochrany. Starší CRM klient může používat původní vícekrokové ukládání: dokud není jeho kompatibilita ověřena, příslušné zápisy dočasně pozastavit. Návrat nesmí znovu otevřít neautorizovanou cestu; preferovat rychlou opravnou revizi zachovávající serverové kontroly.

Edge funkce vracet pouze na ověřenou kompatibilní revizi, která zachová blokování deaktivovaných účtů a ochranu před duplicitním odesláním, případně nasadit opravu dopředu. Hromadné vrácení starých bundlů by obnovilo odstraněné chyby. Při částečném nasazení evidovat, které funkce už používají novou společnou implementaci.

Databázový rollback po vzniku nových dat provádět jako cílenou opravnou migraci. **Nesmazat** `employee_profiles`, předání majetku, evidenci smluv/ověření, žádosti ani `employee_request_events`. Nevypínat neměnnost auditu a nemazat události za účelem opakování schválení. Nevracet stav zaměstnání změnou portalových rolí či Auth účtů. CRM finanční helper nepřejmenovávat zpět bez prověření závislých obálek; uchovat dokumenty, čísla, snapshoty a existující finanční záznamy.

U docházky zachovat také `attendance_write_batches`: smazání potvrzení může způsobit nové vložení stejné dávky při pozdějším retry. Ponechat stornované hodinové žádosti, původní snapshoty, faktury a audit. Neobnovovat přímé klientské `DELETE` ani přístup k neveřejným mzdovým helperům. Předchozí frontend používající mazání hodinových žádostí nebo vícekrokové vkládání docházky není pro tyto zápisy kompatibilní; při návratu UI tyto akce dočasně pozastavit a nasadit kompatibilní opravu.

Při návratu frontendové revize ponechat i ochranu odkazovaných faktur v Storage RLS a Edge. Nevracet mazání dokladu do pořadí soubor → databáze. Zbylé odpojené soubory nejsou důvodem znovu provádět clear/storno ani mazat finanční audit; jejich úklid řešit jednotlivě podle uložených identifikátorů a ověření, že již nejsou odkazované.

Úplná obnova starší zálohy přímo přes aktuální databázi by zahodila nová rozhodnutí a další provozní data. Při nutnosti obnovy nejprve obnovit do oddělené databáze, porovnat data vzniklá od zálohy a připravit řízené sloučení se zachováním ID, návazností a historie. Předchozí záloha nenahrazuje tento krok.

U e-mailů zachovat `workflow_email_deliveries` a původní idempotency klíče. `pending` může znamenat již přijaté odeslání, které nebylo potvrzeno v databázi. Nesmazat záznam ani jej mechanicky nepřepsat na `failed` pro opakování. Nejdříve podle klíče/ID zprávy prověřit stav u poskytovatele a řízeně doplnit evidenci. Výsledek `success: true, recorded: false` znamená přijetí poskytovatelem bez uloženého potvrzení, nikoli požadavek na nové odeslání.

## 7. Význam zaměstnanecké evidence

Zaměstnanecká metadata jsou soukromá a chráněná serverovou RLS. Evidence obsahuje údaje o vydaném autě, klíčích, technice či licenci a metadata smluv/ověření/školení. Neukládají se sem licenční hesla ani veřejné soubory. `reference_url` je pouze bezpečně formátovaný HTTPS odkaz do chráněného dokumentového systému; přístup k samotnému souboru musí samostatně vynucovat tento systém. Kontrola formátu URL sama neověřuje oprávnění cílového úložiště.

Schválení žádosti je interní rozhodnutí administrátora. **Nespouští automatický nákup, platbu, objednávku ani změnu existujících finančních/výplatových záznamů.** Následné zajištění školení, licence nebo vybavení se řeší provozně; admin jej potvrdí stavem `fulfilled`. Události žádosti uchovávají rozhodnutí, aktéra, čas a poznámku pro pozdější rozšíření schvalování vedoucími.
