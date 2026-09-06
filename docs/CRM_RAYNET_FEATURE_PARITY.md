# Raynet → EKV CRM: funkční inspirace a cílové řešení

Inventura vznikla nad přihlášenou instancí `ekvproject` a nad oficiálním Raynet API v2. Kontrola v Raynetu byla pouze pro čtení.

| Funkce Raynetu | Řešení v EKV Portálu | Stav |
| --- | --- | --- |
| Obchodní nástěnka a pipeline | Kanban, tabulka, vážená pipeline, výhry/prohry a důvod prohry | Hotovo |
| Detail obchodního případu | Jedna karta pro klienta, finance, FVE data, produkty, nabídky, objednávky a návaznou výrobu | Hotovo |
| FVE volitelná pole | Šablona podle reálného OP: PD, parcela, FVE, panely, střídač, baterie, PPP/SOP, dotace, instalace, revize, certifikát | Připraveno v migraci |
| Aktivity a kalendář | Telefonát, schůzka, e-mail, úkol a poznámka; měsíční pohled s filtrem obchodníka a typu; pozvánky přes Microsoft 365 | Připraveno v migraci a UI |
| Zápisy ze schůzek | Soukromý zápis, výsledek a další krok přímo u aktivity | Připraveno v migraci a UI |
| Účastníci OP | Hlavní klient, rozhodovatel, technický kontakt, partner, dodavatel a interní člen týmu | Připraveno v migraci a UI |
| Historie záznamu | Neměnný audit změn OP plus společná časová osa aktivit, dokumentů a komentářů | Připraveno v migraci a UI |
| Nabídky a objednávky | Verze dokumentů, moderní PDF, odeslání klientovi, přijetí/odmítnutí a připomínky | Připraveno k rollout |
| Kalkulace produktů | Katalog, nákupní a prodejní ceny, marže, provize, skladový snapshot a synchronizace dokumentů | Hotovo |
| Analýzy obchodníků | Měsíční cíle aktivit, schůzek, nabídek, přijatých nabídek a obratu | Připraveno v migraci a UI |
| Adresář klientů | Centrální subjekty s ARES a vazbou na projekty, realizace a CRM | Hotovo |
| Interní diskuze | Komentáře u OP s autorem a datem | Hotovo |
| Online schvalování | Tokenové přijetí/odmítnutí nabídky s auditní stopou | Připraveno k rollout |
| Projektové řízení / Freelo | Nativní projekty, realizace, úkoly, plánování a meeting minutes | Hotovo |
| Raynet import | Připojení, inventura, mapování uživatelů a fází, náhled, deduplikace a transakční import | Připraveno v migraci, Edge Function a administraci |

## Záměrně propojené funkce

- Pošta a kalendář používají Microsoft 365, aby nevznikla druhá izolovaná schránka a druhý kalendář.
- Přílohy budou používat centrální dokumentový modul EKV s oprávněními a verzováním. Detail OP už má připravenou záložku; samostatné ukládání souborů do CRM by zbytečně duplikovalo dokumenty.
- Projektové úkoly se po výhře předávají do projektu nebo realizace. Obchodní případ zůstává obchodním zdrojem a nevytváří paralelní projektovou evidenci.

## Bezpečnost importu

- Raynet se pouze čte a EKV do něj nic nezapisuje.
- API klíč se neposílá do klientské databáze ani do git repozitáře.
- Každý import má náhled, uložené mapování a auditní dávku.
- Externí ID a hash zdroje brání duplicitám při opakování.
- Potvrzená dávka se provede v jedné databázové transakci; chyba zruší celou dávku.
- FVE případy a jejich aktivity se filtrují už v Raynet API; detail každého OP se načte zvlášť, aby se přenesla vlastní technická pole.
