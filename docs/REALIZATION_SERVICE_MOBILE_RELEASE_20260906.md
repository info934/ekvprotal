# Realizace, servis a mobilní rozhraní — release 6. 9. 2026

Realizační dokumentace používá vyhrazenou SharePoint knihovnu, která se ve Windows synchronizuje jako `Dokumenty - Realizace`. Portál pracuje přímo s ID knihovny přes Microsoft Graph; místní cesta jednoho počítače se do backendu neukládá.

## Struktura

- aktivní realizace: `Dokumenty - Realizace/<rok>/Aktivni/R-<id> - <název>`;
- dokončená nebo předaná realizace: `Dokumenty - Realizace/<rok>/Hotovo/R-<id> - <název>`;
- servis navázaný na realizaci: `<složka realizace>/Servis/<číslo případu> - <název>`;
- samostatný servis: `Dokumenty - Realizace/Servis/Samostatne/<rok>/<číslo případu> - <název>`.

Nová realizace automaticky připraví administrativu, smlouvy a objednávky, technickou dokumentaci, harmonogram a KD, náklady, fotodokumentaci, revize, předání, fakturaci a složku `Servis`. Nový servisní případ připraví administrativu, fotodokumentaci, servisní a předávací protokoly, komunikaci a materiál s měřením. Odkaz na vytvořenou složku se ukládá do záznamu a na detailu servisu je dostupné tlačítko pro otevření nebo dodatečné vytvoření složky.

Backend už nečte neexistující `realizations.code`. Pro realizace bez samostatného obchodního kódu vytváří stabilní prefix z ID záznamu. Existující spravované složky se při další synchronizaci bezpečně přesunou do správného roku a stavu; kolize se odmítne bez sloučení obsahu.

## Mobil a tablet

- dialogy se vejdou do viditelné výšky, posouvají vlastní obsah a mají 44px zavírací prvek;
- hlavní akce dialogů jsou na telefonu přes celou šířku;
- výběry a položky menu mají dotykovou výšku alespoň 44 px;
- záložky detailů se na úzké obrazovce posouvají vodorovně bez zmenšení textu;
- plán docházky má kompaktnější mobilní kalendář a jednosloupcový formulář;
- CRM kanban se na telefonu skládá pod sebe a na široké obrazovce zůstává ve sloupcích;
- profil bezpečně zobrazuje i neplatné starší datum bez pádu celé stránky.

## Produkce a návrat

- commit: `bcfd64a`;
- release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T092357Z`;
- aktivní image: `sha256:21792751eee238d84613ee9ae2b41d35a85c0d8ad6cf9ba85b919916499a7cbe`;
- předchozí release: `/opt/ekvportal-releases/ekvportal-2.0-20260906T084128Z`;
- rollback image: `ekvportal:before-realization-service-bcfd64a`;
- serverová záloha: `/opt/ekvportal-backups/realization-service-bcfd64a-20260906T092357Z/`;
- databázová záloha: `output/backups/supabase-yurysbxxevtuvhrbmloc-20260906T091646Z.tar.gz`;
- SHA-256 databázové zálohy: `9d16994a7de44fffadd014c60d0372a00dd426b06d9c7dcd1bf0fab52af7e8b2`;
- migrace: `20260906203000_realization_service_sharepoint_workspaces`;
- Edge Function `document-storage`: verze 28.

Kontejner je `running healthy`; interní kontroly `/`, `/attendance`, `/service`, `/crm`, `/payouts` a `/settings` vracejí HTTP 200. Vizuální a interakční kontrola proběhla na 390 × 844 px a 768 × 1024 px bez přetečení stránky a bez nových chyb konzole.

## Veřejný HTTPS blokátor

Veřejné DNS resolveru ukazují `portal.ekvproject.cz` na `77.48.235.77`, lokální DNS jej překládá na `192.168.1.180`. Nginx používá interní certifikát `EKV-Local-Root-CA`. Pokus o automatické vystavení Let's Encrypt selhal, protože veřejná validace `http://portal.ekvproject.cz/.well-known/acme-challenge/...` na `77.48.235.77:80` vypršela. Pro důvěryhodný certifikát a přístup bez VPN musí Cloud Gateway Ultra přesměrovat veřejné TCP 80 i 443 na `192.168.1.180` na stejné porty; potom lze znovu spustit Certbot.
