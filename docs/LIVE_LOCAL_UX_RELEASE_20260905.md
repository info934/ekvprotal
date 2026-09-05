# Nasazení lokálních UX úprav — 5. 9. 2026

- Aplikační commit: `a0ffd03`.
- Release: `ekvportal-2.0-20260905T183159Z`.
- Aktivní server: VM 108, `192.168.1.180`, `/opt/ekvportal` ukazuje na `/opt/ekvportal-releases/ekvportal-2.0-20260905T183159Z`.
- Image: `sha256:3b2e09a2570db9e087db44bfa87f7ad8f581a5c9535cc9cf14ee5449bafe1fa5`, kontejner `ekvportal` healthy.
- HTML SHA-256: `3be1d78999fc9070c353bddf939bdc2a168326ef81239870f7e76be9f052de7b`.

Nasazeny lokální změny od checkpoint/online-20260905: adresář zaměstnanců, opravené finanční součty včetně obnoveného zbývajícího nároku, soukromý režim, dokumenty a mobilní karty, ochrana rozepsaných formulářů, tiskový náhled verzí KD, přímé odkazy na úkoly v harmonogramu, filtry a přesné termíny úkolů. Tento rozdíl neobsahuje migrace ani Edge funkce; produkční databázové schéma a funkce se neměnily.

## Záloha a návrat

Čerstvá záloha před přepnutím: `/opt/ekvportal-backups/local-ux-a0ffd03-20260905/` (root-only).

- `supabase-full.dump`: SHA-256 `25976f48e345d6d81269ee62d85d21d86f3e9418c2897423d2df51d82672504c`; pg_restore katalog úspěšně přečten, 3077 řádků. Nový restore rehearsal se neprováděl.
- `app-source.tar.gz`: SHA-256 `b8cd6a187d2f2b879342a4514870d7015361de487c361dfd888127ece560ffb9`.
- `image-before.tar.gz`: SHA-256 `1f4e5f4e410466ede87c8128e1f11099031eb1660f2b2d42097b80a5e7f8170d`.
- Nginx konfigurace, předchozí cesta vydání a container inspect také zachovány v záloze.
- Návratový image tag: `ekvportal:before-local-ux-a0ffd03-20260905`.
- Předchozí release: `/opt/ekvportal-releases/ekvportal-2.0-20260905T150623Z`.

Pro frontendový návrat použít předchozí image pod ekvportal:latest, compose z předchozího vydání s --no-build a vrátit symlink. Neobnovovat kvůli frontendovému návratu starou databázi přes nová uživatelská data.

## Ověření

186 JS testů, globální ESLint, kontroly migrací, finančních výpočtů, kritických/security/UI invariantů a tři další workflow sady prošly. Produkční Docker build s existující konfigurací prošel; oddělený kandidát na localhost:8081 byl healthy před přepnutím. Konflikt historického názvu testovacího kontejneru byl vyřešen samostatným novým názvem, původní testovací kontejner zůstal zachován.

Po přepnutí ověřeno HTTPS 200 a shoda HTML s kandidátem na `/`, `/members`, `/attendance?tab=planning`, `/payouts?tab=fixed`, `/projects`, `/realizace`, `/documents`, `/reports`, `/crm`, `/tasks` a dostupnost čtyř vstupních JS/CSS assetů. TLS ověřeno přes již ověřený serverový certifikát; ověřování certifikátu nebylo vypnuto. DNS ani důvěra veřejných prohlížečů se tímto nasazením neměnily. Záznam `output/rollout-runtime/local-ux-smoke.json`.

Kontrola HTTP/assetů neprokazuje kompletní přihlášené workflow všech produkčních rolí. Skutečné finanční transakce, odesílání e-mailů a zápisy do živých dat nebyly při smoke testu prováděny.
