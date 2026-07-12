# Audit přiřazení osob, hodinových mezd a týmových odměn

Datum auditu: 12. 7. 2026  
Rozsah: projekty, realizace, docházka, hodinové výplaty, úkolové výplaty, týmové odměny, podíly a finanční přehledy.

## Executive summary

Požadovaná logika je ekonomicky správná, pokud systém oddělí:

1. **účetní náklad práce** - skutečně odpracovaná a schválená práce,
2. **zdroj financování práce** - společný projektový rozpočet nebo hrubá odměna konkrétního člena týmu,
3. **výplatu/cash-flow** - kdy byla částka požadována, schválena, vyfakturována a zaplacena.

Mzda pracovníka musí zůstat dohledatelným nákladem práce. Pokud je však financována z odměny člena týmu, nesmí znovu snížit společný týmový rozpočet. Ekonomický dopad je potom `výplata pracovníka + čistá odměna člena = původní hrubá odměna člena`.

Současná aplikace tuto vazbu neumí. Umí pouze ručně přiřadit běžný `project_costs` konkrétnímu členovi a odečíst ho od jeho odměny. Docházka, hodinová výplata a realizace tuto vazbu nepřenášejí.

## 1. Současný proces

### Projekt

- `project_members` propojuje projekt a člena. Obsahuje `is_hourly`, `reward_type`, `reward_percentage` a `reward_amount`.
- Jeden člen může být současně hodinový a mít fixní/procentní odměnu, ale význam této kombinace není explicitně definovaný.
- Hrubá procentní odměna se dnes počítá z týmového rozpočtu po společných nákladech, režiích a vyplacených výplatách.
- `project_costs.member_id` umožňuje ruční náklad přiřadit členu. Takový náklad se neodečte ze společného základu, ale sníží čistou odměnu daného člena.
- Náklady označené `is_attendance_cost` jsou z této členské dedukce vyloučeny.

### Realizace

- `realizace_team_members` eviduje pouze účast a odpovědnost.
- `realization_profit_shares` samostatně eviduje fixní nebo procentní podíl. Není vynuceno, aby příjemce podílu byl členem realizačního týmu.
- Hodinová práce a podíly nemají vazbu „pracovník je hrazen z podílu člena X“.
- Vyplacené hodinové mzdy snižují společný týmový rozpočet realizace.

### Docházka a hodinová výplata

- `attendance` ukládá pracovníka, projekt nebo realizaci, datum, hodiny a popis. Neobsahuje assignment ani financujícího člena.
- Výběr projektu/realizace v UI neukládá typ finančního přiřazení.
- Hodinová sazba je jediná aktuální hodnota `members.hourly_rate`; neexistuje historie účinnosti sazeb.
- Měsíční žádost používá jednu aktuální sazbu pro všechny hodiny měsíce a vytváří snapshot docházky.
- Snapshot obsahuje hodiny a projekt/realizaci, ale ne sazbu každého řádku, assignment, financujícího člena ani alokační poměr.
- Do disponibilního rozpočtu vstupují hodinové mzdy až ve stavu `paid`. Schválená nevyplacená mzda rozpočet nerezervuje.

### Audit a oprávnění

- Docházka, submissions a hourly payout requests mají workflow audit.
- Projektový detail zapisuje snapshot změny odměn při změně členů, subdodavatelů a ručních nákladů.
- Chybí jednotný auditní záznam „tato hodinová práce snížila odměnu člena X o částku Y“.

## 2. Nalezené problémy a rizika

| Priorita | Nález | Dopad |
|---|---|---|
| Kritická | Schválená hodinová práce nerezervuje rozpočet; nákladem je až `paid`. | Projekt může mezi schválením práce a platbou rozdělit stejný rozpočet podruhé. |
| Kritická | Docházka nezná financujícího člena týmu. | Požadovaný odpočet od konkrétní odměny nelze serverově spočítat. |
| Kritická | Hodinové mzdy a ruční členské náklady používají odlišnou logiku. | Hrozí dvojí započtení nebo ruční nesoulad. |
| Vysoká | Jedna současná hodinová sazba bez platnosti. | Pozdější změna sazby může změnit ještě nevytvořenou žádost za starší měsíc. |
| Vysoká | Měsíční hourly request je agregovaný přes více projektů. | Nelze atomicky kontrolovat disponibilitu každého projektu a každého sponzora. |
| Vysoká | Projekt a realizace mají rozdílné modely členů a odměn. | Stejný pracovní vztah se chová jinak podle modulu. |
| Vysoká | Realizační podíl není svázaný s týmem. | Podíl lze přiřadit osobě mimo realizační tým. |
| Střední | Kombinace hodinové, fixní a procentní odměny nemá pořadí výpočtu. | Různé obrazovky mohou dát jiný výsledek. |
| Střední | Záporná čistá odměna se jen ořízne na nulu. | Přebytek nákladů zůstane bez jasného zdroje financování. |
| Střední | Linked-project docházka se u realizace zobrazuje jako expozice, ale zaplacený náklad se mapuje podle snapshot targetu. | Přehled expozice a skutečných nákladů se může rozcházet. |
| Střední | CZK je implicitní a sazby neobsahují měnový snapshot. | Budoucí cizí měna nebude auditovatelná. |

## 3. Doporučený cílový proces

1. Projektový manažer vytvoří **assignment** osoby k projektu/realizaci s platností od-do.
2. Určí roli: `team_owner`, `hourly_worker`, `external_contractor` nebo kombinaci více odměnových komponent.
3. U hodinového pracovníka určí zdroj financování:
   - `direct_project` - běžný náklad projektu,
   - `team_member_reward` - odpočet od hrubé odměny konkrétního člena,
   - `split` - procentní rozdělení mezi více členů a případný zbytek projektu.
4. Docházka odkazuje na konkrétní assignment, ne pouze na projekt/realizaci.
5. Při schválení měsíce server vytvoří neměnné **labor cost ledger entries** se snapshotem sazby a alokace. Tím vznikne akruální náklad a rezervace.
6. Výplatní žádost pouze agreguje již schválené ledger entries. Nemění finanční příslušnost.
7. Zaplacení mění cash-flow stav, nikoliv marži nebo výši závazku.
8. Oprava uzavřeného období vytvoří storno a nový opravný zápis. Historický záznam se nepřepisuje.

### Typy přiřazení

| Typ | Kdo | Podřízenost | Odměna | Zdroj | Dopad na projekt | Dopad na člena |
|---|---|---|---|---|---|---|
| Přímý hodinový pracovník | interní pracovník | projekt/realizace | hodiny × sazba | společný rozpočet | zvýší přímý náklad | žádný |
| Člen s podílem | člen týmu | projekt/realizace | fixní nebo % z explicitního základu | týmový pool | odměna je součást nákladů na tým | hrubá odměna |
| Sponzorovaný pracovník | hodinový pracovník | konkrétní člen | hodiny × sazba | hrubá odměna člena | nevytvoří druhý dopad do poolu | sníží čistou odměnu člena |
| Rozdělený pracovník | hodinový pracovník | více členů | hodiny × sazba | více odměn + volitelně projekt | pouze nepokrytý zbytek je přímý | každý člen nese svůj podíl |
| Externista | OSVČ/firma | projekt nebo člen | faktura/fix/hodiny | dle assignmentu | náklad bez odpočitatelné DPH; DPH samostatně | při sponzorování snižuje odměnu člena |

## 4. Pravidla výpočtů

### Hodinová práce

```text
pracovní odměna = schválené hodiny × sazba platná v den práce
účetní pracovní náklad = pracovní odměna + náklad zaměstnavatele (je-li evidován)
sponzorovaný odpočet člena = pracovní odměna × alokace na člena
přímý náklad projektu = pracovní odměna × nealokovaný podíl
```

Pro interní manažerské výpočty doporučujeme konfigurovat, zda se od odměny člena odečítá pouze hrubá odměna pracovníka, nebo úplný zaměstnavatelský náklad. Volba musí být jednotná pro celý projekt a viditelná v reportu.

### Odměna člena týmu

Každá procentní komponenta musí mít explicitní `base_type`:

- `revenue_net` - výnos bez DPH,
- `gross_margin` - výnos bez DPH minus přímé externí a materiálové náklady,
- `team_pool` - schválený týmový pool po společných nákladech,
- `project_profit` - zisk po všech akruálních nákladech před rozdělením bonusů.

```text
hrubá odměna člena = fixní komponenty + Σ(základ × procento)
čistá odměna člena = max(0, hrubá odměna − sponzorované pracovní náklady − jiné dedukce)
celková týmová kompenzace = přímé hodinové mzdy + sponzorované mzdy + čisté odměny členů
```

Sponzorovaná mzda se ve výsledku vykáže jako skutečný pracovní náklad, ale současně jako čerpání hrubé odměny člena. Do společného poolu se neodečítá podruhé.

### Marže a časové stavy

```text
akruální marže = výnos bez DPH − materiál − subdodávky − schválená práce − režie − čisté týmové odměny
cash marže = přijaté platby − skutečně zaplacené výdaje
disponibilní pool = plánovaný pool − akruální přímé mzdy − rezervované odměny − vyplacené odměny
```

UI musí odděleně zobrazovat plán, akruál, závazek a zaplaceno.

## 5. Návrh datového modelu

### `work_assignments`

- `id`, `project_id`, `realization_id` - právě jedna vazba povinná,
- `member_id`, volitelně `subject_id` pro externistu,
- `participant_type` (`team_owner`, `hourly_worker`, `external_contractor`),
- `valid_from`, `valid_to`, `status`, `responsibility`,
- `created_by`, `created_at`, `updated_by`, `updated_at`,
- unique aktivní assignment pro osobu a scope; kontrola nepřekrývající se platnosti.

### `compensation_terms`

- `assignment_id`, `component_type` (`hourly`, `fixed`, `percentage`),
- `base_type`, `rate`, `percentage`, `currency`,
- `valid_from`, `valid_to`, `employer_burden_percent`,
- nepřekrývající se platnost pro stejnou komponentu.

### `labor_funding_allocations`

- `worker_assignment_id`, `sponsor_assignment_id`, `allocation_percent`,
- `valid_from`, `valid_to`, `priority`,
- oba assignmenty musí patřit ke stejnému projektu/realizaci,
- sponzor musí mít fixní/procentní odměnu,
- součet aktivních alokací pracovníka nesmí překročit 100 %.

### Změny `attendance`

- přidat `work_assignment_id` a povinně jej vyžadovat pro nové záznamy,
- `project_id`/`realizace_id` dočasně ponechat pro kompatibilitu a kontrolovat shodu triggerem.

### `labor_cost_ledger`

- `attendance_id`, `submission_id`, `worker_assignment_id`,
- `work_date`, `hours`, `rate_snapshot`, `currency`, `fx_rate_snapshot`,
- `pay_amount`, `employer_cost`, `funding_mode`, `sponsor_assignment_id`, `allocation_percent`,
- `project_cost_impact`, `sponsor_reward_deduction`,
- `status` (`accrued`, `payable`, `paid`, `reversed`), `posting_period`,
- `source_entry_id` pro storno/opravný zápis,
- unikátní idempotency klíč pro attendance + verzi schválení + alokaci.

### `reward_calculation_runs` a `reward_ledger`

- verze výpočtu, použitý základ, vstupní snapshot, hrubá odměna, dedukce, čistá odměna,
- stav `preview`, `approved`, `locked`, `reversed`,
- audit actor, čas a důvod změny.

## 6. Návrh uživatelského rozhraní

### Dialog „Přidat osobu“

1. Osoba a typ vztahu: zaměstnanec / externista / člen týmu.
2. Platnost assignmentu.
3. Odměnové komponenty: hodinová, fixní, procentní; u procenta povinný základ.
4. Zdroj hodinové práce:
   - projektový rozpočet,
   - odměna člena týmu,
   - rozdělit mezi více členů.
5. Živý náhled: plánovaný náklad projektu, hrubá a čistá odměna člena, zbývající rezerva.

### Docházka

- Po výběru projektu zobrazit assignment a financování: `Přímo projekt` nebo `Z odměny: Jan Novák (100 %)`.
- Běžný pracovník nesmí financujícího člena svévolně změnit; změnu může provést PM/finance.
- Při neplatném nebo ukončeném assignmentu záznam nepovolit.

### Finance projektu/realizace

- Tři sloupce: **Náklad vznikl**, **Zdroj financování**, **Stav výplaty**.
- U člena zobrazit: hrubá odměna, pracovníci pod členem, dedukce, čistá odměna, vyplaceno, zbývá.
- U projektu zobrazit: přímé mzdy, mzdy hrazené z odměn, celkové skutečné mzdy, rezervace a cash výplaty.
- Drill-down musí vést až na konkrétní den docházky, sazbu a autora schválení.

## 7. Validační a kontrolní pravidla

1. Jedna docházka musí mít právě jeden platný assignment.
2. Assignment musí odpovídat projektu/realizaci v docházce.
3. Sazba se určuje podle data práce, nikoliv podle data žádosti.
4. Součet funding alokací je 0-100 %; zbytek je přímý projektový náklad.
5. Sponzor musí být členem stejného scope a mít kladnou hrubou odměnu.
6. Při schválení docházky vzniká rezervace; payout už nesmí vytvářet druhý náklad.
7. Stejný attendance řádek nesmí být zaúčtován dvakrát.
8. Pokud dedukce převýší hrubou odměnu člena, uzávěrku zablokovat. Povolené řešení: změna alokace, zvýšení schválené odměny, nebo admin override přebytku do přímého nákladu.
9. Uzavřený měsíc se nemění in-place; používá storno a correction entry.
10. Fixní + procentní + hodinová kombinace musí mít explicitní pořadí a samostatné ledger komponenty.
11. Procenta všech podílů a funding alokací kontroluje databáze v transakci s advisory lockem.
12. Částky ukládat jako PostgreSQL `numeric`, peníze zaokrouhlovat po řádku na 2 desetinná místa; hodiny doporučeně 2-4 desetinná místa.
13. Vlastní mzdy zaměstnanců nejsou plněním podléhajícím DPH. U externisty se DPH eviduje zvlášť a do projektového nákladu vstupuje neodpočitatelná část podle daňového režimu.
14. Finanční údaje smí měnit pouze PM/finance/admin; pracovník vidí vlastní assignment a vlastní výplaty, nikoliv odměny ostatních.
15. Každá změna sazby, assignmentu, alokace, schválení, storna a override musí mít actor, timestamp, předchozí/novou hodnotu a důvod.

## 8. Číselné scénáře

Ve všech scénářích je výnos bez DPH 200 000 Kč a ostatní projektové náklady 80 000 Kč. Marže je `200 000 − ostatní náklady − celková týmová kompenzace`.

### A. Běžný pracovník přímo do projektu

- 40 h × 500 Kč = 20 000 Kč.
- Náklady projektu: 80 000 + 20 000 = 100 000 Kč.
- Marže: 100 000 Kč.
- Výplata pracovníka: 20 000 Kč; odměna člena: 0 Kč.

### B. Člen týmu s procentní odměnou

- Explicitní `team_pool` = 100 000 Kč, podíl 50 % = 50 000 Kč.
- Náklady projektu: 80 000 + 50 000 = 130 000 Kč.
- Marže: 70 000 Kč.
- Výplata člena: 50 000 Kč.

### C. Pracovník pod členem týmu

- Hrubá odměna člena 50 000 Kč.
- Pracovník 40 h × 500 Kč = 20 000 Kč, funding 100 % z člena.
- Čistá odměna člena: 50 000 − 20 000 = 30 000 Kč.
- Celková kompenzace: 20 000 + 30 000 = 50 000 Kč; náklady projektu 130 000 Kč; marže 70 000 Kč.
- Částka 20 000 Kč je pracovní náklad, ale společný pool nesníží podruhé.

### D. Více pracovníků pod jedním členem

- Hrubá odměna člena 60 000 Kč.
- Pracovník A: 24 h × 500 = 12 000 Kč; B: 30 h × 600 = 18 000 Kč.
- Čistá odměna člena: 60 000 − 30 000 = 30 000 Kč.
- Celková kompenzace 60 000 Kč; náklady projektu 140 000 Kč; marže 60 000 Kč.

### E. Pracovník rozdělený mezi dva členy

- Hrubá odměna A 40 000 Kč, B 30 000 Kč.
- Pracovník 40 h × 500 = 20 000 Kč; alokace A 60 % = 12 000 Kč, B 40 % = 8 000 Kč.
- Čistá odměna A 28 000 Kč, B 22 000 Kč; pracovník 20 000 Kč.
- Celková kompenzace 70 000 Kč; náklady projektu 150 000 Kč; marže 50 000 Kč.

### F. Změna hodinové sazby během projektu

- 40 h při 400 Kč = 16 000 Kč a 40 h při 500 Kč = 20 000 Kč.
- Celkem 36 000 Kč, nikoliv 80 h × současných 500 = 40 000 Kč.
- Při přímém financování: náklady projektu 116 000 Kč, marže 84 000 Kč, výplata pracovníka 36 000 Kč.

### G. Pracovníci převýší odměnu člena

- Hrubá odměna člena 15 000 Kč; pracovník 20 000 Kč.
- Standardně se uzávěrka zablokuje kvůli deficitu 5 000 Kč.
- Při schváleném override: 15 000 Kč se odečte členu, 5 000 Kč jde do přímého nákladu; člen 0 Kč, pracovník 20 000 Kč.
- Náklady projektu 100 000 Kč; marže 100 000 Kč. Proti původnímu plánu odměny 15 000 Kč jde o překročení 5 000 Kč.

### H. Změna po uzavření měsíce

- Původně 40 h × 500 = 20 000 Kč.
- Oprava na 35 h vytvoří storno −20 000 Kč a nový accrual +17 500 Kč, čistá korekce −2 500 Kč.
- Audit zachová oba záznamy; projektový náklad a výplata se sníží o 2 500 Kč. Již zaplacená část se řeší correction payoutem.

### I. Kombinace fixní, hodinové a procentní odměny

- Člen A: fix 20 000 Kč + 20 % z poolu 100 000 Kč = hrubá odměna 40 000 Kč.
- Pracovník pod A: 20 h × 500 = 10 000 Kč.
- Čistá odměna A 30 000 Kč; pracovník 10 000 Kč; celková kompenzace 40 000 Kč.
- Náklady projektu 120 000 Kč; marže 80 000 Kč.

## 9. Hraniční a chybové stavy

- Nulová/záporná sazba, záporné hodiny, den nad 24 hodin.
- Docházka mimo platnost assignmentu nebo sazby.
- Sponzor odebraný z projektu v průběhu období.
- Sponzor bez odměny nebo se stornovanou odměnou.
- Alokace nad 100 %, kruhové financování nebo self-sponsoring bez explicitní politiky.
- Stejný pracovník na projektu i navázané realizaci za stejný čas.
- Schválení souběžnými administrátory; nutný advisory lock a idempotency klíč.
- Změna projektu/realizace po schválení docházky.
- Část docházky v CZK a část v jiné měně bez FX snapshotu.
- Externí faktura s DPH versus interní mzda bez DPH.
- Výplata dříve než schválení docházky nebo bez dostupného zdroje.
- Uzavřený projekt s otevřenou docházkou, rezervací nebo nezaplacenou odměnou.

## 10. Doporučení pro implementaci

### Etapa 1 - bezpečnost výpočtů

1. Přidat efektivně datované sazby a `work_assignments`.
2. Přidat assignment do docházky a snapshot sazby při schválení.
3. Zahrnout `approved` hodinové závazky do rezervace rozpočtu.
4. Sjednotit read modely projektu a realizace na plán / accrual / payable / paid.

### Etapa 2 - financování z odměny člena

1. Přidat `labor_funding_allocations` a kontrolu stejného scope.
2. Vytvářet ledger entries při schválení docházky.
3. Rozšířit výpočet čisté odměny o sponzorované hodinové náklady.
4. Blokovat deficit s možností auditovaného admin override.

### Etapa 3 - UI a migrace

1. Nový průvodce přiřazení osoby a náhled finančního dopadu.
2. Rozpad odměny člena a drill-down na docházku.
3. Migrovat stávající členy jako assignments; stávající docházku výchozím způsobem označit `direct_project`.
4. Historické paid snapshoty neměnit; dopočítat pouze read-only klasifikaci a od nového cut-off data používat nový ledger.

### Etapa 4 - uzávěrka a reporting

1. Měsíční uzávěrka s preflight kontrolou deficitů a neúplných alokací.
2. Export pro finance: pracovník, datum, sazba, hodiny, projekt, zdroj, sponzor, accrual, payable, paid.
3. Reconciliation report mezi docházkou, labor ledgerem, payout requests a účetnictvím.

## Doporučené akceptační podmínky

- Stejný attendance řádek ovlivní ekonomiku projektu právě jednou.
- Sponzorovaný pracovník sníží čistou odměnu zvoleného člena a nezmenší podruhé společný pool.
- Schválená práce je vidět v marži a rezervě ještě před zaplacením.
- Každý výsledek lze rozkliknout na zdrojovou docházku, sazbu, alokaci a schvalovatele.
- Opravy uzavřených období jsou provedeny pouze storno/opravnými zápisy.
- Projekt nelze finančně uzavřít s deficitem, nealokovanou prací nebo nezpracovanou výplatou bez auditovaného override.

## Účetní poznámka

Tento návrh rozlišuje manažerské přiřazení nákladu od účetního zaúčtování. Vlastní mzda zaměstnance zůstává mzdovým nákladem společnosti i tehdy, když manažersky čerpá odměnu člena týmu. Činnost zaměstnance v pracovněprávním vztahu se pro DPH nepovažuje za samostatně uskutečňovanou ekonomickou činnost; u externisty je nutné posoudit fakturu a odpočitatelnost DPH samostatně. Finální účtový a mzdový mapping má potvrdit účetní/daňový poradce.

## Zdrojové části aplikace

- `src/components/AssignMemberDialog.jsx`
- `src/components/ProjectCostDialog.jsx`
- `src/components/AttendanceDialog.jsx`
- `src/components/RealizaceTeam.jsx`
- `src/components/RealizaceProfitSharing.jsx`
- `src/domain/financials.js`
- `supabase/migrations/20260617143000_attendance_hourly_workflow_rpc.sql`
- `supabase/migrations/20260617152000_hourly_payout_snapshots_audit.sql`
- `supabase/migrations/20260621190000_paid_payout_financial_model.sql`
- `supabase/migrations/20260626123000_project_cost_member_deductions.sql`
