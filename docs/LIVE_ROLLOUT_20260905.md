# EKV Portal 2.0 – skutečné nasazení 5. 9. 2026

Nový frontend je aktivní na VM 108 `web-app` (`192.168.1.180`) za hostovým Nginx, port 8080. Supabase projekt `yurysbxxevtuvhrbmloc` používá všech pět nových migrací a jedenáct aktualizovaných Edge funkcí. Nasazení vychází z `main` / `064c34a`, s doplněným kopírováním `.npmrc` před `npm ci` v Dockerfile. Aplikační kód a migrační SQL při rollout nebyly měněny; opraveny byly předpoklady SQL testovacích fixture.

## Dostupnost

- Interní adresa: `https://portal.ekvproject.cz`, lokálně přeložena na `192.168.1.180`.
- Veřejný DNS resolver 1.1.1.1 k 5. 9. 2026 nevrací pro tuto subdoménu A ani CNAME. Nasazení samo nezpřístupňuje VM z internetu.
- Stávající certifikát vydala `EKV-Local-Root-CA`, platnost 11. 5. 2026 až 13. 8. 2028. Má SAN pro doménu i IP. Prohlížeč na tomto zařízení autoritě nedůvěřuje; interaktivní přihlášení proto nebylo ověřeno. Systémová důvěra certifikátům nebyla měněna.
- Technická HTTPS kontrola použila přesný veřejný certifikát získaný přes SSH s ověřeným host key. Ověřování TLS nebylo vypnuto.

## Zálohy před první migrací

Proxmox, úplná VM 108: `/var/lib/vz/dump/vzdump-qemu-108-2026_09_05-13_57_29.vma.zst`, dokončeno 13:59:03 CEST, velikost 8,61 GB. `zstd -t` prošel. SHA-256: `123dcc22a312033f68777b1973fa27e1dee4adb9d613645222938d224cfe3678`. Jiné zálohy nebyly promazávány.

Serverový adresář s oprávněními pouze pro root: `/opt/ekvportal-backups/rollout-20260905T115613Z/`.

| Soubor | Obsah | SHA-256 |
| --- | --- | --- |
| `supabase-full.dump` | Konzistentní úplný pg_dump custom, včetně public, Auth, Storage metadat a historie migrací | `0c1f080e15fc6bad5e5bdf7c4307f8412dcd52782202d4f99b771f402d8498b9` |
| `roles.sql` | Role a členství, bez hesel | `0ff407bb0ca4f08e3696e8c0f1bf0c4482feff6e3d620482074d9ad6ba59aac1` |
| `frontend-before.docker.tar.gz` | Původní Docker obraz | `9c56d65ef67492dc79b35b6cd54551de6ef15fe9edccae2be6bffa15fe3060d4` |
| `server-config-source-before.tar.gz` | Původní aplikace, `.env` a Nginx včetně jeho TLS konfigurace | `ee533828cea5d8e1343be2f941b38ce0649afb2e2487e255d3c6631564f1271c` |
| `edge-storage-before.tar.gz` | Všech 12 původních Edge funkcí a jejich metadata, všech 35 Storage souborů a manifest | `5882b0c333653f280cc54b66e29a7fbf086d17b0b6867848bc1b54a3acd86706` |

Lokální kopie databáze, rolí, Edge funkcí, Storage a kontrol: `output/supabase-backups/rollout-20260905T115613Z/`. Tento adresář je ignorovaný Gitem a obsahuje soukromá provozní data; nesdílet veřejně. Storage záloha obsahuje 35 objektů, 18 876 423 bajtů; velikost každého souboru byla porovnána s metadaty a spočítán SHA-256. Vault obsahoval 0 tajemství. Existující Edge secrets nebyly změněny; jejich neveřejné hodnoty nejsou exportovány tímto balíčkem. Externí SharePoint/Google Drive nejsou součástí Supabase Storage zálohy a jejich obsah rollout neměnil.

## Obnova a testy

Plná databáze byla úspěšně obnovena do izolovaného kontejneru `supabase/postgres:17.6.1.011` bez sítě a bez preloadovaných plánovačů. Obnoveno 129 public tabulek, 12 Auth uživatelů, 35 Storage záznamů a 67 původních migrací. Pro lokální obnovu byl zachován bootstrap superuser postgres a normalizován grantor členství rolí na místního postgres; aplikační vlastníci, ACL, RLS a data pocházejí ze zálohy.

Nad obnovenou kopií prošlo pět migrací, obě katalogové kontroly a všechny čtyři SQL sady: aktivní účty, atomické CRM, zaměstnanecká evidence, finance/docházka. Testy byly opraveny pro skutečný Auth trigger automatického založení člena, rozdílná Auth/member ID, admin identitu při zakládání rozpočtu a transakční příznak Storage API při testování DELETE RLS. Příznak byl použit pouze v izolované transakci, nikoli v produkci.

Šest scénářů se dvěma skutečnými databázovými spojeními prošlo: opakované stejné UUID majetku, stejné UUID žádosti, souběžné schválení/zamítnutí, stejná docházková dávka, souběžné překročení 24 hodin a konflikt stejného CRM pole. Ověřena obousměrná synchronizace `Zrušeno`/`cancelled` a `Hotovo`/`done`. Tyto kontroly neznamenají vyčerpávající otestování všech souběhů popsaných v návrhovém rollout dokumentu.

Před rollout prošlo 183 existujících JS kontrol, lint a produkční build. Docker build na serveru rovněž prošel. Skutečné odeslání e-mailů, podpisy dokumentů, OAuth reset a nákupy nebyly spouštěny jako testy nad živými uživateli.

## Produkční změny a důkazy

Jednotlivě aplikováno a po každém úspěchu evidováno:

1. `20260905100000_active_account_authorization`
2. `20260905110000_crm_atomic_workflows`
3. `20260905120000_planning_status_alignment`
4. `20260905130000_employee_workspace`
5. `20260905140000_finance_attendance_hardening`

Historie vzrostla z 67 na 72. Historický drift starších migrací nebyl přepisován, nebyl použit hromadný `db push` ani `db reset`. Produkční `99_postflight.sql` i opakovaný `00_preflight.sql` prošly.

Porovnáno 161 existujících tabulek. Jediné očekávané rozdíly: čtvrtý stav úkolu, pět položek migrační historie a tři nové prázdné sloupce hodinových výplat. Po odečtení těchto sloupců se shoduje původní otisk všech 7 hodinových výplat: `bd4b9cf2977f31b7ed9156009ad34c28`. Ostatní existující data mají stejné počty i otisky. Nikdo nebyl automaticky zařazen jako zaměstnanec.

| Edge funkce | Původní → nová verze |
| --- | --- |
| manage-users | 37 → 38 |
| send-message-to-member | 17 → 18 |
| send-email | 17 → 18 |
| send-payout-email | 17 → 18 |
| send-admin-payout-notification | 17 → 18 |
| send-payout-notification | 15 → 16 |
| document-storage | 21 → 22 |
| planning-calendar | 13 → 14 |
| analyze-contract | 10 → 11 |
| google-drive-esign | 6 → 7 |
| send-attendance-notification | 1 → 2 |

Všech 11 má stav ACTIVE a zachované `verify_jwt`. `send-scheduled-reports` zůstává verze 1. Neautorizovaný HTTP požadavek všech 11 vstupů byl odmítnut 401/403; anonymní REST čtení HR tabulek rovněž. Read-only SQL simulace ověřila existující aktivní role, identitu člena a RLS čtení HR bez změn účtů.

Nový obraz: `sha256:49b9b112d38166ffd9cb7cad9000bf099c78acb75751e9fe4925d01e4e67ce90`, tag `ekvportal:2.0-20260905-candidate` a po aktivaci `ekvportal:latest`. Kontejner `ekvportal` je healthy. `/`, `/employee`, `/payouts?tab=fixed`, `/attendance`, `/projects` vracejí 200 a stejné nové HTML, SHA-256 `bc869c4138741992ee4b9a7b9310139bc742d4c99b70fe65983053770e47d432`; odkázané JS/CSS assety jsou dostupné.

## Návrat

Původní obraz je zachován jako `ekvportal:before-20260905`, ID `sha256:cd55c4c9fa98c6b9145ff4fbe650419bd4a9507e0dacc64e68473539a528596d`. Pro návrat frontendové vrstvy retagovat tento obraz a použít existující compose s `--no-build`. Před tím posoudit kompatibilitu starého klienta se zpřísněnými zápisovými cestami; podrobnosti v `EKVPORTAL_2_0_BACKEND_ROLLOUT.md`.

Neobnovovat slepě celou starou DB přes nově vzniklá data. Obnovit nejprve do oddělené instance a zachovat nové zaměstnanecké žádosti, audit, finanční záznamy i idempotency potvrzení. Staré Edge funkce nevracet hromadně bez kontroly, protože by se obnovily opravené autorizační nedostatky.
