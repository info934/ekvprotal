# Review modulu Projekce a Realizace

Datum: 2026-06-17
Commit vychoziho stavu: 91f7190c84104947db0ee3a6c018c70d7d073614

## Rozsah

- Projekce: seznam, detail, formular, financni vypocty, RLS a summary RPC.
- Realizace: seznam, detail, formular, profit sharing, financni vypocty, RLS a summary RPC.
- Navaznosti na dochazku, hodinove naklady a payout dostupnost.

## Hlavni zjisteni

1. Realizace posilaji financni sloupce do klienta i pro role, ktere je v UI nemaji videt.
   - `src/components/Realizace.jsx` nacita `contract_amount`, `expected_total_cost`, `actual_costs`, `budget` bez ohledu na `canViewAmounts`.
   - `src/components/RealizaceDetail.jsx` nacita `realizations.*` pred tim, nez se financni cast podminene skryje.
   - RLS baseline ma `realizations` SELECT pro vsechny authenticated uzivatele.

2. Realizace maji prilis volny update v databazi.
   - Baseline policy `Enable update for authenticated users on realizations` dovoli update libovolnemu authenticated uzivateli.
   - UI sice schovava editaci podle `hasPermission('realizace', 'can_edit')`, ale backend to nevynucuje.

3. Status workflow projektu i realizace je jen klientsky update sloupce `status`.
   - `Projects.jsx`, `ProjectDetail.jsx`, `Realizace.jsx` a `RealizaceDetail.jsx` meni status primo pres `.update({ status })`.
   - Chybi backend pravidla prechodu, audit duvodu, kontrola uzavreni financnich polozek a ochrana pred preskocenim mezistavu.

4. Profit sharing realizace neni atomicky.
   - `RealizaceForm.jsx` i `RealizaceProfitSharing.jsx` pouzivaji delete-then-insert.
   - Pokud delete projde a insert selze, existujici podily jsou ztracene.
   - Pri zmene statusu mimo `Dokončeno` mohou zustat stare podily v databazi.

5. Tvorba projektu/realizace z CRM prilezitosti neni transakcni.
   - `ProjectForm.jsx` vytvori projekt a potom jen zkusi dopsat `crm_opportunities.project_id`.
   - `RealizaceForm.jsx` stejne dopisuje `crm_opportunities.realization_id`.
   - Selhani linku nevrati chybu uzivateli a muze vzniknout osiřela vazba.

6. Seznamy maji null-unsafe vyhledavani.
   - `Projects.jsx` vola `p.name.toLowerCase()` a `p.code.toLowerCase()`.
   - `Realizace.jsx` vola `r.name.toLowerCase()`.
   - Constraints dnes `projects.name/code` chrani, ale frontend by nemel padat kvuli legacy/import datu. U realizaci neni stejne jasne, ze `name` nikdy nebude null.

7. Financni vypocty jsou rozdelene mezi klienta a backend.
   - Existuji backend summary RPC `project_financial_summary` a `realization_financial_summary`.
   - Cast detailu ale porad drzi lokalni fallback vypocty a detail realizace znovu pocita hodinove naklady klientsky.
   - To zvysuje riziko rozdilu mezi UI, payout dostupnosti a reporty.

8. Projekty maji prisnejsi RLS nez realizace, ale UI stale pouziva primy write model.
   - Projekty maji SELECT omezeny na admina nebo prirazene cleny a write jen admin.
   - Projektove formulare/statusy ale pocitaji s primym klientskym zapisem, coz je krehke pro role mimo admina a pro budouci workflow.

## Doporuceny plan oprav

1. Zavest backend read modely bez financnich sloupcu pro bezne role.
   - `list_realizations_safe()` nebo view/RPC s podminenou projekci.
   - Detail realizace rozdelit na public/detail cast a finance summary.

2. Zprisnit RLS pro `realizations`.
   - SELECT minimalne na admin/super_manager nebo lead/team member.
   - UPDATE/DELETE jen pres role permissions, pripadne pouze pres RPC.
   - Doplnit regresni DB testy pro user/super_manager/admin.

3. Zavest RPC pro status workflow.
   - `update_project_status(p_project_id, p_next_status, p_note)`
   - `update_realization_status(p_realization_id, p_next_status, p_note)`
   - Validovat povolene prechody, roli, uzaviraci podminky a auditovat zmeny.

4. Zavest transakcni RPC pro ulozeni realizace a profit shares.
   - Jeden backend kontrakt pro create/update realizace + CRM link + profit shares.
   - Samostatny `replace_realization_profit_shares()` pro profit tab.
   - Validace duplicit clenu, procent/fix castek a zaporneho tymoveho rozpoctu na DB vrstve.

5. Sjednotit financni vypocty.
   - UI ma primarne cist backend summary RPC.
   - Klientske fallbacky ponechat jen jako zobrazeni "nelze nacist vypocet", ne jako alternativni pravdu.

6. Opravit nizkorizikove frontend pady.
   - Null-safe search ve `Projects.jsx`, `Realizace.jsx`, `RealizaceDetail.jsx`.
   - Normalizace numerickych poli ve formularech pred ulozenim.

## Verifikace pred rolloutem oprav

- `npm run lint`
- `npm run backend:check`
- `./node_modules/.bin/supabase migration up`
- Role smoke: admin, super_manager, user.
- Browser smoke: seznam Projekce, detail projektu, seznam Realizace, detail realizace, profit sharing, zmena statusu.

## Poznamky

- Playwright smoke v teto session blokoval lokalni wrapper/npx tooling, ne samotny Vite server.
- Predchozi balicek dochazka/vyplaty je v commitu `91f7190c84104947db0ee3a6c018c70d7d073614`.
