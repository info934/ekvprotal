# Aktuální stav: nasazeno 5. 9. 2026

Produkční kód: `ea0db95` (main), release `ekvportal-2.0-20260905T145010Z`. Níže uvedené lokální stavy jsou historické záznamy jednotlivých kroků.

- Sjednocené menší hlavičky a rozestupy napříč moduly, aktualizovaná nápověda globálního hledání, česká data a stavy v zápisech KD.
- Nasazeny oba předchozí balíky i kompaktní docházka a výplaty.
- Před změnou čerstvá plná databázová záloha a archiv aplikace: `/opt/ekvportal-backups/ux-kd-20260905/`. Dump má 3065 položek v ověřeném katalogu. Předchozí image zachován jako `ekvportal:before-ux-kd-20260905`.
- Produkční migrace 20260905170000 a 20260905180000 úspěšné; RLS zapnuté, anonymní SELECT a přímý klientský UPDATE zakázány.
- Validace: všech 154 JS testů, lint, UI/security/critical invariants, kontrola migrací a build. SQL testy na izolované obnovené databázi viz níže.
- Browser: projekty na desktopu, hledání Javorová zúží 4 záznamy na 2; zaměstnanci na mobilu 390 × 844. Smysluplný obsah bez error overlay a bez console errors. Předchozí balík má kontrolu docházky, výplat a KD.
- Produkční kontejner healthy. Deset cest a čtyři vstupní assets vrací HTTP 200; HTML odpovídá kandidátovi. HTTPS ověřeno s explicitně důvěryhodným existujícím certifikátem serveru; veřejná důvěryhodnost certifikátu se tím nemění. Nejde o test všech přihlášených produkčních workflow.
- Image: `sha256:402741885266ad523130e5c95f9238c20f198917fc06f4b2009c2c4e56173232`.
- Zbývá: PDF a externí rozesílání KD, prohlížeč historie verzí, tvorba úkolu přímo ze zápisu a ostatní backlog auditu.

---

# První balík úprav použitelnosti — 5. 9. 2026

Navazuje na PORTAL_UX_FUNCTIONAL_AUDIT_20260905.md.

Implementováno:
- Reporty: čtení podle can_read, mazání podle can_admin; pravidlo SELECT ověřeno čtením pg_policies v živé Supabase. Bez změny DB oprávnění.
- Reporty a export projektů: pokračování přes skutečný počet vrácených řádků až do prázdné stránky, ochrana před opakovanými řádky a neúplným výsledkem.
- Projekt má ve skupině Dokumenty stejné položky Soubory a Předání jako realizace; přímý odkaz #handover.
- Moje práce odkazuje na vlastní kanonickou kartu zaměstnance.
- Hledání zaměstnanců podle oprávnění k adresáři; projektové úkoly jen s právem čtení úkolů i cílového modulu Projekce.
- Dokument z hledání má přesnou adresu podle ID. Neplatný/nepřístupný odkaz má vysvětlení, přepnutí zpět na knihovnu je jedním tlačítkem.

Validace: cílené testy reportového načítání, oprávnění a hledání; dosavadní testy pracovní plochy, detailu projektu a zaměstnanců. ESLint změněných souborů, UI a security invariants, produkční build.
Vizuální kontrola není dokončená: předchozí automatické zamítnutí browser nástroje kvůli limitu použití. Žádný náhradní browser nebyl použit.

Stav: lokální implementace; nebyla nasazena na produkční server. Tento balík nevyžaduje migraci.

Další implementace: sjednocení úkolů projekce/realizace a blokací, potom KD (koncept, účastníci, body, návazné úkoly, neměnné revize/PDF a řízené doručení). Nové KD ani příslušné DB tabulky zatím nejsou implementovány. Další body auditu zůstávají v backlogu; audit není označen jako kompletně realizovaný.

## Druhý balík: pracovní zápisy KD a blokované úkoly

Implementováno lokálně:
- Projekt i realizace: Práce → Zápisy KD, založení a úprava interního zápisu, datum, účastníci, informační/rozhodovací body a vazba na existující úkol z plánu.
- Stav a termín navázaného úkolu se čtou ze stejné položky plánu, nevytváří se kopie úkolu.
- DB: historie každé uložené verze, kontrola souběžné editace, kontrola přístupu podle zakázky, zákaz přímých klientských zápisů do tabulek.
- Stav Blokováno ve formuláři a obou seznamech projektových úkolů; migrace zachová tento stav při synchronizaci s harmonogramem.

Migrace `20260905170000_planning_blocked_status.sql` a `20260905180000_meeting_notes.sql` byly úspěšně provedeny pouze na izolované databázi ekv_rehearsal. Transakční SQL testy prošly: historie verzí, konflikt změn, chybějící vazba na úkol, zákaz přímého UPDATE, čtení/zápis uživatele bez přístupu a obousměrná synchronizace Blokováno. Testovací kontejner byl následně zastaven. Produkční databáze se nezměnila.

Prohlížeč již dostupný: ověřeno vytvoření a úprava ukázkového KD, propojení s úkolem, desktop a šířka 390 px, bez console errors. Použit čerstvý izolovaný preview server http://127.0.0.1:4176 (starší 4175 používal zastaralý preview klient). Náhled neprokazuje produkční RLS; to ověřují SQL testy na obnovené kopii.

Validace: 14 cílených JS testů, ESLint, kontrola migrací, UI/security invariants, produkční build. Build má známé upozornění na velikost některých balíků.

Zbývá: produkční rollout se zálohou; vydané revize a PDF, doručování účastníkům, vytváření nového úkolu přímo ze zápisu, přebírání otevřených bodů dalšího KD, sjednocená globální fronta úkolů projekce/realizace. Historie verzí je nyní v DB; samostatný prohlížeč starších verzí zatím není v UI. Neoznačovat tyto položky za dokončené.

## Kompaktní docházka a výplaty

- Docházka: společný pás měsíce a přidání hodin, menší souhrny, horizontální záložky, kalendář před doplňujícími přehledy. Export a odeslání měsíce pod kalendářem/seznamem.
- Výplaty: menší záhlaví a souhrny, odkazy na úkolové/hodinové schvalování přímo v kartě, odstraněná duplicitní řada tlačítek. Nápověda přesunuta pod seznam. Mobilní aktualizace jako přístupně pojmenované ikonové tlačítko vedle hlavní akce.
- Rozložení je omezené třídou compact-workspace na tyto dvě agendy; databáze ani výpočty se nemění.
- Browser: desktop a šířka 390 px; přepnutí měsíce, návrat na aktuální měsíc, kliknutí na den otevře správné datum, odkaz Úkolové otevře filtr pending. Bez console errors.
- 41 regresních testů, lint, UI invariants a build. Lokální náhled na portu 4176; produkční rollout neproveden.
