# Codex CLI Handoff - EKVPortal

Datum: 2026-07-04
Aktualni branch pouzivana pro praci: `codex/krannich-product-import`
Produkce/main baseline: `e8d086e Compact CRM product picker layout`
Repo: `https://github.com/info934/ekvprotal`

## Aktualni stav

- `origin/main` je aktualni na commitu `e8d086e`.
- Produkcni VM 108 byla rolloutnuta na `e8d086e`.
- Rollout byl app-only, bez databazove migrace.
- Docker service `ekvportal` bezi jako Docker Compose service v `/opt/ekvportal`.
- Databaze zustava hosted Supabase.
- Na produkci je bezny server-only drift `?? backups/`, nesahat a nestageovat.

## Posledni dulezite commity

- `e8d086e Compact CRM product picker layout`
  - Zkompaktneni produktoveho pickeru v CRM.
  - Dialog je sirsi, tabulka ma pevnejsi sloupce, mensi text a vnitrni scroll.
  - Sloupec nazvu produktu uz nezabira prilis prostoru; ceny, DPH, kategorie a popis zustavaji citelne.

- `6dd39d5 Add CRM document reassignment workflow`
  - V detailu nabidky/objednavky pribyly akce pro zmenu OP a kopii dokumentu k jinemu OP.
  - U polozek lze zvolit synchronizaci s cilovym OP nebo kopii aktualnich polozek jako vlastni snapshot.

- `ba3dc3c Improve product sets and document PDF generation`
  - Vylepseni produktovych setu a generovani dokumentu/PDF.

- `e0b0c05 Add CRM cancellation and soft-delete audit flow`
  - Storno/soft-delete workflow pro OP/NAB/OBJ s audit stopou.

## Soubory poslednich zmen

- `src/components/CrmProductPickerDialog.jsx`
- `src/components/CRMCommercialDocuments.jsx`

## Lokalne ignorovat/necommitovat

V pracovnim adresari jsou docasne/nepracovni soubory. Nestageovat bez samostatne kontroly:

- `.deploy-secrets/`
- `.tmp-*`
- `.vite/`
- `backups/`
- `doc-downloads/`
- `ssh-keys/`
- `patch_*.cjs`
- `write_handover_email_service.cjs`
- `baywa_sample*.csv/sql`
- `fa_portal/`

## Build / test

Lokalni build prikaz pouzivany v teto session:

```powershell
$env:Path='C:\tmp\node-v20.19.1-win-x64;' + $env:Path
& '.\node_modules\.bin\vite.cmd' build
```

Build prosel po poslednich zmenach.

## Produkcni rollout postup

Pouzivat skill/runbook `ekvportal-server-ops`.

Bezpecny postup:

1. Zkontrolovat lokalni `git status -sb` a `git log --oneline -5`.
2. Pushnout branch i main, pokud ma jit zmena na produkci.
3. Na VM 108 v `/opt/ekvportal` udelat:
   - `git fetch origin main`
   - porovnat `HEAD..origin/main`
   - pokud nejsou migrace, app-only rollout:
     - `git pull --ff-only origin main`
     - `docker compose build ekvportal`
     - `docker compose up -d ekvportal`
     - overit `docker compose ps`
     - overit `curl -I -s http://127.0.0.1:8080/crm/offers`
     - overit `curl -I -s http://127.0.0.1:8080/crm/orders`
     - `nginx -t`

Nikdy nepouzivat `git reset --hard`, `supabase db push` ani hromadne mazani bez explicitniho potvrzeni.

## Produkcni overeni posledniho rollout-u

Po nasazeni `e8d086e` bylo overeno:

- Docker container `ekvportal` je `healthy`.
- `http://127.0.0.1:8080/crm/offers` vraci `200 OK`.
- `http://127.0.0.1:8080/crm/orders` vraci `200 OK`.
- `nginx -t` je OK.
- Produkcni git HEAD: `e8d086e Compact CRM product picker layout`.

## Dalsi vhodne navazujici prace

- Vizualne otestovat produktovy picker primo v CRM detailu OP/NAB/OBJ na produkci po hard refreshi.
- U produktu zvazit jeste volitelne skryvani sloupce `Popis`, pokud bude katalog moc siroky pro notebook.
- Doresit diakritiku ve starsich textech nekterych CRM komponent; v poslednich zmenach se to zamerne neresilo, aby nebyl velky diff.
- Pokracovat v produktovych skupinach/setech a dodavatelskych cenach podle predchozi produktove roadmapy.
