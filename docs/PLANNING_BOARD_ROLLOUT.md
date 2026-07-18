# Rollout: Planning board projekce a realizace

## Scope

Release pridava spolecny planovaci board pro projekty a realizace:

- portfolio trasu `/planning`,
- zalozku `Plan` v detailu projektu a realizace,
- Gantt s fazemi, ukoly, milniky a vazbami,
- evidenci resitelu, cest a ubytovani,
- obousmernou synchronizaci projektovych ukolu,
- audit a RLS navazane na existujici pristup k projektu nebo realizaci.

Release obsahuje dvě databázové migrace a jednu Edge Function:

```text
supabase/migrations/20260717193000_project_realization_planning_board.sql
supabase/migrations/20260718101500_planning_microsoft_calendar_sync.sql
supabase/functions/planning-calendar/index.ts
```

Migrace je aditivni, ale pri aplikaci zaklada plany pro existujici projekty a realizace a kopiruje datovane `project_tasks` do `planning_items`.

## Release gate

Pred rolloutem musi platit:

- worktree je commitnuty a commit je na `origin/main`,
- `npm run lint` a `npm run build` probehly bez chyby,
- produkcni schema bylo zalohovano,
- `supabase migration list` neukazuje neocekavane lokalni pending migrace,
- dry-run obsahuje pouze schvalene migrace,
- existujici `project_tasks` nemaji neplatne datum `end_date < start_date`.
- Entra aplikace má Microsoft Graph Application oprávnění `Calendars.ReadWrite` a tenant administrátor udělil admin consent.
- Supabase secrets obsahují `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` a `SITE_URL=https://portal.ekvproject.cz`.

Pokud dry-run ukaze jinou nez schvalenou migraci, rollout zastavit. Na produkci nepoustet `supabase db reset` a neimportovat seed soubory.

## 1. Databazovy preflight a zaloha

```powershell
cd C:\tmp\horizons
npx supabase link --project-ref yurysbxxevtuvhrbmloc
npx supabase migration list
npx supabase db dump --linked --schema public --file backups/prod_schema_before_planning_board.sql
npx supabase db dump --linked --data-only --schema public --file backups/prod_data_before_planning_board.sql
```

Pred migraci zkontrolovat zdrojove ukoly:

```sql
select count(*) as invalid_project_tasks
from public.project_tasks
where start_date is not null
  and end_date is not null
  and end_date < start_date;
```

Ocekavana hodnota je `0`.

## 2. Aplikace migrace

Preferovany postup, pokud je historie migraci synchronizovana:

```powershell
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Po migracích nasadit kalendářovou Edge Function:

```powershell
npx supabase functions deploy planning-calendar --project-ref yurysbxxevtuvhrbmloc
```

Názvy secrets lze ověřit bez vypsání jejich hodnot:

```powershell
npx supabase secrets list --project-ref yurysbxxevtuvhrbmloc
```

Pokud se migrace aplikuje rucne v SQL editoru, aplikovat pouze obsah souboru
`20260717193000_project_realization_planning_board.sql` a nasledne srovnat historii:

```powershell
npx supabase migration repair --linked --status applied 20260717193000
```

Bezprostredne potom spustit:

```powershell
npx supabase db query --linked --file tools/planning-rollout-postcheck.sql
```

Pokud CLI nepodporuje `db query`, vlozit obsah post-check souboru do Supabase SQL editoru. Kazda assertion musi projit.

## 3. Nasazeni aplikace na VM 108

Na serveru musi byt nasazen stejny commit, ktery prosel buildem a jehoz migrace byla aplikovana.

```bash
ssh root@192.168.1.180
cd /opt/ekvportal
git fetch origin main
git status --short --branch
git pull --ff-only origin main
docker compose build --pull
docker compose up -d
docker compose ps
```

Kontrola sluzeb:

```bash
curl -fsSI http://127.0.0.1:8080/
docker compose logs --tail=150 ekvportal
nginx -t
systemctl is-active nginx
```

## 4. Browser smoke test

Na `https://portal.ekvproject.cz` overit:

1. Admin vidi polozku `Planovani` a otevre `/planning`.
2. Bezny uzivatel vidi pouze plany projektu/realizaci, ke kterym ma pristup.
3. Detail projektu a realizace obsahuje zalozku `Plan`.
4. Pridani faze, ukolu a milniku se projevi v Ganttu.
5. Zmena terminu projektoveho ukolu se projevi v puvodni zalozce ukolu.
6. Zmena puvodniho projektoveho ukolu se projevi v planu.
7. Nelze vytvorit zavislost mezi ruznymi plany ani cyklus.
8. Cesta a ubytovani lze vytvorit, upravit a smazat pouze uzivatelem s pravem editace.
9. Konzole neobsahuje React ani Supabase chyby a tabulka nepreteka mimo vlastni wrapper.
10. Úkol s přiřazeným pracovníkem lze synchronizovat do Outlooku a následná změna termínu upraví stejnou událost.
11. `Ověřit dostupnost` vrátí volný termín nebo počet kolizí; běžný uživatel nemůže číst plán, ke kterému nemá přístup.
12. Vypnutí synchronizace odstraní Outlook událost a ponechá auditní záznam.

Testovaci zaznamy oznacit `TEST PLAN` a po overeni je odstranit.

## 5. Rollback

Pri chybe UI vratit predchozi aplikacni commit a znovu sestavit kontejner. Databazove tabulky nema smysl okamzite mazat: jsou aditivni a starsi frontend je nepouziva.

```bash
cd /opt/ekvportal
git checkout <previous-production-commit>
docker compose up -d --build
```

Pri datove chybe zastavit zapis do planovani odebranim pristupu k trase v predchozim frontendu a provest forward-fix. Drop tabulek je povolen pouze po samostatnem schvaleni a po overeni zalohy, protoze migrace mohla vytvorit audit a synchronizovane ukoly.

## Evidence

Do rollout reportu ulozit:

- nasazeny git SHA,
- vystup `supabase migration list`,
- vysledek `tools/planning-rollout-postcheck.sql`,
- stav kontejneru a HTTP kontrolu,
- seznam otestovanych roli a tras,
- pripadne testovaci zaznamy a potvrzeni jejich uklidu.
