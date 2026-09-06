# Plan

Cílem je uzavřít celý obchodní tok od kalkulace přes odeslání nabídky až po potvrzení klientem a vznik objednávky. Změny budou navazovat na stávající CRM, dokumentový generátor, Supabase oprávnění a e-mailovou infrastrukturu bez vytvoření druhého adresáře klientů.

## Scope

- In: nabídky, objednávky, PDF verze, odesílání klientům, audit, klientské potvrzení, rozšířené položky, maržová upozornění, připomínky a sjednocený detail.
- Out: kvalifikovaný elektronický podpis třetí strany a automatické účetní zaúčtování.

## Action items

- [x] Přidat databázové verze dokumentů, doručení, události, bezpečné odkazy a soukromé úložiště PDF.
- [x] Přidat bezpečnou serverovou funkci pro odeslání PDF, kontrolu oprávnění, příjemců, limitů a audit.
- [x] Přidat do CRM dialog Odeslat klientovi, náhled, CC, potvrzení cizí adresy a historii doručení.
- [x] Přidat veřejnou stránku pro přijetí nebo odmítnutí nabídky a automatické vytvoření objednávky.
- [x] Přidat verze V1/V2, porovnání cen a položek, uzamčení odeslané verze a stažení přesného PDF.
- [x] Rozšířit položky o sekce, mezisoučty, volitelné a alternativní varianty a kopírování z jiného dokumentu.
- [x] Přidat upozornění na nízkou marži a skrýt citlivé finance uživatelům bez finančního oprávnění.
- [x] Přidat stav Čeká na klienta, důvod odmítnutí, časovou osu a návazné úkoly, schůzky a poznámky.
- [x] Přidat serverové připomínky před koncem platnosti a při neaktivitě s ochranou proti opakovanému odeslání.
- [ ] Ověřit migrace, RLS, e-mailové okrajové stavy, build, UI workflow a připravit bezpečný rollout a návratový bod.

## Open questions

- Výchozí platnost veřejného odkazu bude 30 dní, nejdéle však do konce platnosti nabídky.
- Přijetí nabídky automaticky vytvoří objednávku; projekt zůstane vědomým krokem administrátora.
- Výchozí hranice nízké marže bude 15 % a půjde později změnit v nastavení CRM.
