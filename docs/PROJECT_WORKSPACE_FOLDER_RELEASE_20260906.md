# Volitelné projektové složky — nasazení 6. 9. 2026

Projektový formulář umožňuje zapnout nebo vypnout vytvoření spravované složky. Uživatel může upravit popisnou část názvu a před uložením vidí výslednou cestu včetně kořenové složky, roku a stavu projektu. Kód projektu zůstává povinným prefixem názvu. Prázdná vlastní hodnota používá aktuální název projektu.

Vypnutí zabrání automatickému vytvoření při založení projektu i pozdější automatické synchronizaci. Existující složka se nemaže. Z karty Dokumenty lze volbu znovu zapnout a složku včetně standardní struktury a projektového listu vytvořit. Změna názvu existující složku bezpečně přejmenuje; kolize s jiným projektem se odmítne.

## Umístění v projektové knihovně

Připojená SharePoint knihovna je vyhrazena projektům a na synchronizovaném počítači odpovídá cestě `C:\Users\IngJanKopačka\OneDrive - EKV Project s.r.o\Shared Documents - Projects`. Portál proto nevkládá další mezisložky `EKVPortal\Projekty` a používá přímo strukturu:

- aktivní projekt: `Shared Documents - Projects\<rok>\Aktivni\<kód> - <název>`;
- dokončený projekt: `Shared Documents - Projects\<rok>\Hotovo\<kód> - <název>`.

Prázdná hodnota hlavní složky v nastavení úložiště je záměrná a v uživatelském rozhraní je podporovaná. Starší konfigurace, ve které vlastnost zcela chybí, dál používá kompatibilní výchozí hodnotu `Projekty`. Existující složky se hromadně nepřesouvají; složka napojená na projekt se srovná při jeho příští ruční synchronizaci nebo změně stavu.

## Backend a oprávnění

- Migrace: `20260906190000_project_workspace_preferences.sql` a `20260906191500_project_library_root.sql`.
- Produkční Supabase projekt: `yurysbxxevtuvhrbmloc`.
- Edge Function `document-storage`: aktivní verze 27 s podporou kořene vyhrazené projektové knihovny.
- Přímý zápis do tabulky je pro `authenticated` zakázán. Zápis vede přes `save_project_workspace_preference` a vyžaduje právo upravovat daný projekt.
- Chybějící preference zachovává původní chování: složka je povolená a používá název projektu.

## Produkční release a návrat

- Aplikační commity: `cafae41` a `fb617c4`.
- Aktivní release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T084128Z`.
- Aktivní image: `sha256:69e7985c479955da070dd40561b5c850363cb5327cca3b52d163a2ffd2bdcbb0a`.
- Předchozí release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T082845Z`.
- Rollback image: `ekvportal:before-project-library-root-fb617c4`.
- Serverová záloha konfigurace a container inspect: `/opt/ekvportal-backups/project-library-root-fb617c4-20260906/`.
- Databázová záloha nastavení úložiště a projektových mapování: `output/backups/project-workspace-before-20260906190000.json`, SHA-256 `4DBE46AB46D5EAAF1853FA514268AF91CA16BACEDB21387746CD7D833F981560`.
- Záloha nastavení před změnou kořene knihovny: `output/backups/project-library-root-before-20260906191500.json`, SHA-256 `8C6DBF8596B1877584AC2673C60A05E2C33865539C1BDB42B11737D1E61CFF6A`.

## Ověření

- Produkční databázový transakční test ověřil vytvoření a změnu preference i odmítnutí uživatele bez práva upravovat projekty.
- RLS je zapnuté; přihlášený uživatel má pouze čtení dostupných preferencí a spuštění kontrolovaného RPC.
- Původních 244 automatizovaných testů a kontrol změny formuláře prošlo. Po změně kořene knihovny znovu prošlo všech 226 aktuálních workflow a bezpečnostních kontrol, cílený ESLint i čistý produkční build.
- Lokální globální ESLint narazil na chybu resolveru instalovaného balíčku `@radix-ui/primitive/is-development`; cílený lint změněných souborů ani serverový čistý `npm ci` build tuto chybu neměly.
- Formulář byl zkontrolován na desktopu i šířce 390 px: živý náhled názvu, vypnutí složky a konzole bez chyb.
- Produkční kontejner je `running healthy`; `/`, `/projects/new`, `/projects` a `/settings?tab=storage` vracejí HTTPS 200.
