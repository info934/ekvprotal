# Release: jednodušší plánování a pracovní reporty

Datum nasazení: 2026-09-08, Europe/Prague

## Produkční stav

- Aktivní release: `/opt/ekvportal-releases/ekvportal-2.0-20260908T194700Z`
- Aktivní image: `sha256:675e5a2ee1411a3a7cd37510401845425709685a9d574f2e7c5d90cc5b4db9b3`
- Implementační commit: `dab1b43`
- Opravný commit po vizuálním smoke testu: `90cfc4d`
- Feature flagy `planning_simplified_v1` a `work_reports_v1` jsou aktivní.

## Databáze a funkce

- Nasazena migrace `20260908120000_simplified_planning_work_reports.sql`.
- Nasazena Edge Function `send-work-reports`.
- Edge Function `send-scheduled-reports` zůstává vyhrazena finančním reportům.
- Aktivní cron úlohy:
  - `work-reports-morning-prague`
  - `work-reports-friday-prague`
- Funkce ověřuje skutečný čas v `Europe/Prague`; širší UTC okna bezpečně pokrývají CET i CEST.

## Ověření odesílání

Testovací pracovní report byl odeslán na `info@ekvproject.cz` dne 2026-09-08 v 19:34 UTC.

- Stav jobu: `sent`
- Počet pokusů: `1`
- Stav sledované e-mailové zásilky: `sent`
- Provider message ID byl vrácen.
- Naplánované spuštění mimo pondělní, středeční a páteční časové okno vrátilo `scheduled: 0`.

## Zálohy a návrat

- Supabase REST/Auth záloha: `output/backups/supabase-yurysbxxevtuvhrbmloc-20260908T193135Z.tar.gz`
- SHA-256 Supabase zálohy: `3f4ebf7920751f9f6fc6d44d41c523e5696f6c134c0e8bf916cecddc962339e2`
- Serverová záloha: `/opt/ekvportal-backups/20260908T193132Z/release.tar.gz`
- Rollback před opravným releasem: `ekvportal:rollback-20260908T194700Z`
- Původní image před celým releasem: `ekvportal:rollback-20260908T193132Z`

Při návratu se přepne `/opt/ekvportal` na požadovaný předchozí release, odpovídající rollback image se označí jako `ekvportal:latest` a kontejner se znovu vytvoří přes Docker Compose.

## Kontroly

- Produkční build prošel lokálně i na serveru.
- Před prvním nasazením prošlo 205 workflow testů, bezpečnostní a UI invarianty.
- Po opravném importu prošly 4 cílené testy a nový produkční build.
- Vizuální kontrola proběhla na 390 × 844, 768 × 1024 a 1440 × 1000.
- Serverové routy `/`, `/planning`, `/projects`, `/realizace` a PWA manifest odpovídají očekávaným přesměrováním na přihlášení.
- Produkční kontejner je `healthy` a aplikační log po nasazení neobsahuje `error`, `fatal` ani `panic`.

## Známá provozní položka mimo tento release

Veřejná doména vrací portál, ale certifikační řetězec stále není na klientovi důvěryhodný (`SEC_E_UNTRUSTED_ROOT`). Úpravy HTTPS byly z tohoto plánu výslovně vynechány.
