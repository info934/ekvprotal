# EKV Portal MCP Server

Lokální MCP server zpřístupňuje AI asistentům EKV Portál přes existující Supabase REST/RPC rozhraní. Umí číst projekty, realizace, CRM, servis, Gantt, zápisy z kontrolních dnů a finance. Po výslovném zapnutí umí pod oprávněním přihlášeného uživatele také zapisovat do Ganttu, vytvářet úkoly a spravovat zápisy z KD.

## Rozsah nástrojů

### Portál a vyhledávání

- `ekv_portal_health` – konfigurace, spojení, režim oprávnění a stav zápisů
- `ekv_portal_search` – hledání v projektech, realizacích, CRM, servisu, subjektech, lidech, úkolech a dokumentech
- `ekv_portal_list_projects` – projekční zakázky
- `ekv_portal_get_project_workspace` – projekt, úkoly, plán a navázané realizace
- `ekv_portal_list_crm_opportunities` – obchodní případy
- `ekv_portal_list_planning_tasks` – plánovací úkoly
- `ekv_portal_list_service_cases` – servisní případy

### Kompletní plánování a Gantt

- `ekv_portal_get_gantt_plan` – plán, fáze, úkoly, milníky, vazby, lidé, subdodavatelé, cesty a ubytování
- `ekv_portal_ensure_gantt_plan` – založení/dohledání plánu projektu nebo realizace
- `ekv_portal_save_gantt_item` – vytvoření nebo úprava fáze, úkolu či milníku včetně zdrojů a kapacit
- `ekv_portal_quick_update_gantt_item` – stav, odpovědná osoba a termín
- `ekv_portal_save_gantt_dependency` / `ekv_portal_delete_gantt_dependency` – návaznosti a prodlevy; databáze hlídá cykly
- `ekv_portal_delete_gantt_item` – chráněné odstranění položky
- `ekv_portal_save_travel_segment` / `ekv_portal_delete_travel_segment` – cesty
- `ekv_portal_save_accommodation` / `ekv_portal_delete_accommodation` – ubytování a hosté

### Kontrolní dny

- `ekv_portal_list_meeting_notes` – zápisy a body KD včetně vazeb na úkoly
- `ekv_portal_save_meeting_note` – nový nebo verzovaně upravený zápis
- `ekv_portal_create_task_from_meeting_point` – atomické vytvoření Gantt úkolu z bodu KD a zpětné propojení

Doporučené workflow je načíst aktuální Gantt a zápisy, uložit nový/změněný zápis s aktuální verzí a poté převést vybrané body na úkoly. Souběžnou změnu jiného uživatele backend odmítne místo tichého přepsání.

### Finance (pouze čtení)

- `ekv_portal_get_project_finances` – finanční a pracovní souhrn projektu
- `ekv_portal_get_realization_finances` – finanční a pracovní souhrn realizace
- `ekv_portal_get_finance_overview` – agregovaný přehled realizací

Finanční hodnoty počítají autoritativní databázové RPC používané portálem. MCP je nepřepočítává ani neupravuje a vrací jen data povolená rolí uživatele.

Všechny datové nástroje podporují `response_format: "markdown"` nebo `"json"`. Seznamy používají stránkování. Výstup je standardně omezen na 25 000 znaků.

## Instalace a test

Požadován je Node.js 20 nebo novější.

```powershell
cd C:\APP\EKV\Portal\ekvprotal\mcp
pnpm install
pnpm test
```

Server se spouští příkazem `node C:/APP/EKV/Portal/ekvprotal/mcp/dist/index.js`.

## Přihlášení agenta bez ručního JWT

Pro dlouhodobě běžícího agenta vytvořte v portálu samostatného technického uživatele a přidělte mu jen potřebná modulová oprávnění. Potom se na počítači, kde poběží MCP, přihlaste jednou:

```powershell
cd C:\APP\EKV\Portal\ekvprotal\mcp
$env:EKV_PORTAL_SUPABASE_URL="https://your-project.supabase.co"
$env:EKV_PORTAL_SUPABASE_ANON_KEY="replace-me"
pnpm auth:login
```

Příkaz se zeptá na e-mail a skrytě na heslo. Heslo nikam neuloží. Uloží pouze uživatelskou relaci; na Windows je její obsah zašifrovaný pomocí DPAPI pro aktuální Windows účet. Výchozí umístění je `%LOCALAPPDATA%\EKV Portal MCP\session.json`. Stav lze zkontrolovat pomocí `pnpm auth:status`; tokeny se nikdy nevypisují.

MCP obnoví JWT dvě minuty před expirací a také po první odpovědi HTTP 401. Supabase při obnově rotuje refresh token, proto MCP nový token ihned přepíše do chráněného souboru. Pokud administrátor relaci odvolá nebo změní heslo technického uživatele, je potřeba znovu spustit `pnpm auth:login`.

## Konfigurace MCP

Server sám nenačítá `.env`; hodnoty mu předává MCP klient při spuštění. Příklad je v `.env.example`.

Povinné:

- `EKV_PORTAL_SUPABASE_URL` (nebo `VITE_SUPABASE_URL`)
- `EKV_PORTAL_SUPABASE_ANON_KEY` (nebo `VITE_SUPABASE_ANON_KEY`)

Pro běžný provoz:

- `EKV_PORTAL_USE_STORED_SESSION=true` – použije relaci vytvořenou příkazem `pnpm auth:login`
- `EKV_PORTAL_ENABLE_WRITES=true` – zaregistruje zápisové nástroje pod technickým uživatelem
- `EKV_PORTAL_SESSION_FILE` – volitelná vlastní absolutní cesta k uložené relaci

`EKV_PORTAL_SUPABASE_ACCESS_TOKEN` zůstává podporovaný pouze jako dočasná alternativa pro testy. Pro bootstrap automatizovaného nasazení lze předat `EKV_PORTAL_SUPABASE_REFRESH_TOKEN`, ale proces musí mít trvalý zapisovatelný `EKV_PORTAL_SESSION_FILE`, protože refresh tokeny se rotují.

Service role obchází RLS. Zápisy s ní server nepovolí a finanční nástroje ji standardně odmítnou. Výjimka `EKV_PORTAL_ALLOW_SERVICE_ROLE_FINANCE=true` je určena jen pro oddělené, chráněné interní prostředí.

## Připojení k MCP klientovi

```json
{
  "mcpServers": {
    "ekv-portal": {
      "command": "node",
      "args": ["C:/APP/EKV/Portal/ekvprotal/mcp/dist/index.js"],
      "env": {
        "EKV_PORTAL_SUPABASE_URL": "https://your-project.supabase.co",
        "EKV_PORTAL_SUPABASE_ANON_KEY": "replace-me",
        "EKV_PORTAL_USE_STORED_SESSION": "true",
        "EKV_PORTAL_ENABLE_WRITES": "true"
      }
    }
  }
}
```

Po připojení zavolejte `ekv_portal_health`. Neobnovitelná relace vrátí pokyn ke spuštění `pnpm auth:login`; chyba 403 znamená, že technický uživatel nemá potřebné modulové/RLS oprávnění.

## Bezpečnostní model

- všechny zápisy vyžadují uživatelskou relaci, výslovný přepínač a existující RLS/RPC oprávnění portálu;
- heslo technického uživatele se neukládá a tokeny se nevypisují do stdout, logů ani odpovědí MCP;
- uložená relace je na Windows šifrovaná pomocí DPAPI a použitelná jen pod stejným Windows účtem;
- atomické databázové funkce chrání zápisy KD, tvorbu úkolů, zdroje a kapacity;
- destruktivní nástroje vyžadují `confirm: true`; odstranění položky Ganttu navíc přesný aktuální název;
- aktualizace a mazání bez filtru klient odmítne;
- finance jsou pouze ke čtení a service role je pro ně defaultně blokovaná;
- názvy tabulek, sloupců a RPC jsou pevně dané implementací, nikoli vstupem modelu;
- klíče a tokeny se nikdy nevracejí v odpovědi;
- HTTP mimo localhost musí používat TLS;
- provozní zprávy jdou na stderr, aby nepoškodily stdio MCP protokol.
