# CRM 2.0 — Raynet, FVE a obchodní aktivity

## Cíl

Převést ověřený FVE obchodní postup z Raynetu do EKV Portálu a sjednotit příležitost, komunikaci, schůzky, nabídky, objednávky a obchodní cíle do jednoho pracovního toku.

## Implementace

- [x] Navrhnout společný datový model aktivit (telefonát, schůzka, e-mail, úkol, poznámka).
- [x] Přidat čas, místo, účastníky, výsledek, zápis a další krok.
- [x] Přidat audit změn aktivit.
- [x] Přidat měsíční cíle obchodníků a serverový přehled plnění.
- [x] Přidat konfigurovatelnou šablonu FVE obchodního případu.
- [x] Přidat vytváření a editaci aktivit do detailu obchodního případu.
- [x] Přidat týmový přehled aktivit a cílů.
- [x] Přidat odeslání pozvánky a synchronizaci události přes Microsoft Graph.
- [x] Provést inventuru vzorového FVE případu a pokrýt přes oficiální API typy OP, vlastní pole, stavy, uživatele a aktivity.
- [x] Doplnit administrační mapování, náhled bez zápisu a transakční idempotentní import Raynet → EKV.
- [x] Doplnit Raynet-inspirované účastníky OP a neměnný audit změn.
- [x] Doplnit měsíční kalendář aktivit a filtrování podle obchodníka a typu.
- [x] Ověřit migrace, RLS, build a UI.
- [x] Před produkčním rolloutem vytvořit a ověřit aktuální zálohu databáze.
- [x] Nasadit databázové migrace, Edge Functions a produkční frontend.
- [x] Ověřit produkční kontejner, interní HTTP odpověď a konfiguraci Nginx.
- [ ] Otevřít na Cloud Gateway Ultra veřejné TCP porty 80 a 443 na `192.168.1.180`, vystavit Let's Encrypt certifikát a ověřit přístup mimo LAN.
- [ ] V administračním náhledu provést první ostrý import s dočasným Raynet API klíčem.

## Raynet mapování

Raynet zůstane zdrojem pro počáteční převod. Do EKV se budou mapovat zejména:

| Raynet | EKV Portal |
| --- | --- |
| Obchodní případ | `crm_opportunities` |
| Kategorie / typ FVE | `business_type`, `category`, šablona OP |
| Vlastní pole FVE | `custom_fields` |
| Aktivita | `crm_activities` |
| Událost / schůzka | CRM aktivita typu `meeting` + kalendář |
| Poznámka ze schůzky | `meeting_minutes`, `outcome`, `next_step` |
| Nabídka / objednávka | `crm_commercial_documents` a jejich verze |
| Vlastník OP | `owner_member_id` |

Přístupové údaje ani exporty se neukládají do repozitáře. Mapování vychází ze skutečné konfigurace instance `ekvproject` a před ostrým importem se ještě potvrdí v administračním náhledu.
