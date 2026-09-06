# Volitelné projektové složky — nasazení 6. 9. 2026

Projektový formulář umožňuje zapnout nebo vypnout vytvoření spravované složky. Uživatel může upravit popisnou část názvu a před uložením vidí výslednou cestu včetně kořenové složky, roku a stavu projektu. Kód projektu zůstává povinným prefixem názvu. Prázdná vlastní hodnota používá aktuální název projektu.

Vypnutí zabrání automatickému vytvoření při založení projektu i pozdější automatické synchronizaci. Existující složka se nemaže. Z karty Dokumenty lze volbu znovu zapnout a složku včetně standardní struktury a projektového listu vytvořit. Změna názvu existující složku bezpečně přejmenuje; kolize s jiným projektem se odmítne.

## Backend a oprávnění

- Migrace: `20260906190000_project_workspace_preferences.sql`.
- Produkční Supabase projekt: `yurysbxxevtuvhrbmloc`.
- Edge Function `document-storage`: aktivní verze 26.
- Přímý zápis do tabulky je pro `authenticated` zakázán. Zápis vede přes `save_project_workspace_preference` a vyžaduje právo upravovat daný projekt.
- Chybějící preference zachovává původní chování: složka je povolená a používá název projektu.

## Produkční release a návrat

- Aplikační commit: `cafae41`.
- Aktivní release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T082845Z`.
- Aktivní image: `sha256:91731a57ecae1ac9b90ae0e032cc0c90a1e8891ff76dfe8536c95ccb33fb56129`.
- Předchozí release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T075415Z`.
- Rollback image: `ekvportal:before-project-workspace-cafae41`.
- Serverová záloha konfigurace a container inspect: `/opt/ekvportal-backups/project-workspace-cafae41-20260906/`.
- Databázová záloha nastavení úložiště a projektových mapování: `output/backups/project-workspace-before-20260906190000.json`, SHA-256 `4DBE46AB46D5EAAF1853FA514268AF91CA16BACEDB21387746CD7D833F981560`.

## Ověření

- Produkční databázový transakční test ověřil vytvoření a změnu preference i odmítnutí uživatele bez práva upravovat projekty.
- RLS je zapnuté; přihlášený uživatel má pouze čtení dostupných preferencí a spuštění kontrolovaného RPC.
- 244 automatizovaných testů a kontrol prošlo, stejně jako cílený ESLint změněných souborů a produkční build.
- Lokální globální ESLint narazil na chybu resolveru instalovaného balíčku `@radix-ui/primitive/is-development`; cílený lint změněných souborů ani serverový čistý `npm ci` build tuto chybu neměly.
- Formulář byl zkontrolován na desktopu i šířce 390 px: živý náhled názvu, vypnutí složky a konzole bez chyb.
- Produkční kontejner je `running healthy`; `/`, `/projects/new`, `/projects` a `/settings?tab=storage` vracejí HTTPS 200.
