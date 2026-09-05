# EKV portál 2.0 — audit použitelnosti a návrh dalšího rozvoje

Datum: 5. 9. 2026 · zdrojová verze: `0a9ba9d` · všechny role rovnoměrně.

## Závěr

Největší přínos přinese sjednocení práce napříč moduly: uživatel zadá informaci jednou, pozná její stav a ví, kdo má udělat další krok. Portál již obsahuje mnoho potřebných funkcí. Další samostatné obrazovky bez společných vazeb by zvyšovaly složitost.

Doporučené pořadí: (1) opravit nesoulady a sjednotit ovládání, (2) společný pracovní detail zakázky, (3) zápisy z KD s návaznými úkoly, (4) propojit kapacity, docházku a finance, (5) rozšířit obchodní a manažerské přehledy.

## Rozsah a limity

Jde o audit informační architektury a implementovaných toků podle rout, komponent, služeb a souvisejících migrací. Pokrývá všechny hlavní položky navigace a podpůrné toky; podrobnost kontroly pomocných komponent není stejná. Není to bezpečnostní audit, kontrola každé řádky aplikace ani dokončený uživatelský test.

Živá vizuální kontrola v prohlížeči nebyla provedena: dřívější automatická kontrola zamítla prohlížečový nástroj kvůli limitu použití. Proto nejsou případné přetékání na mobilu, kontrast, skutečná rychlost ani chování čtečky obrazovky označeny za ověřené chyby. Uvedené zdrojové cesty jsou relativní ke kořeni repozitáře a čísla řádků patří této verzi.

**Zjištění** = přímo doloženo zdrojem. **Riziko** = důsledek, který je nutné reprodukovat. **Návrh** = požadované nové chování, nikoli tvrzení o chybě.

## Co zachovat

- Jednotnou kartu zaměstnance s majetkem, žádostmi, smlouvami/ověřením a financemi; nevytvářet znovu oddělené centrum zaměstnance.
- Kalendář skutečné docházky a samostatný plán docházky. Plán nesmí automaticky znamenat odpracované hodiny ani schválenou dovolenou.
- Finanční výpočty a bonusy přes stávající kontrolované databázové operace. UX nesmí zavést druhý výpočet nároku.
- Existující synchronizaci projektových úkolů s harmonogramem. Migrace `20260905120000_planning_status_alignment.sql` obsahuje obousměrnou vazbu přes `legacy_project_task_id`.
- Moje práce, globální hledání, soukromý režim, vysvětlení průběhu výplaty a upozornění na neúplné finanční souhrny.
- Měsíční report plánu docházky: poslední den měsíce v 18:00 Europe/Prague, následující měsíc, info@ekvproject.cz. Je již implementovaný; další krok je jeho viditelnost a správa v portálu.

## 1. Konkrétní nálezy a priority

P1 = další vývojový blok; P2 = návazné zlepšení; P3 = pozdější rozšíření. Náročnost S/M/L je relativní, nikoli časový závazek.

| ID | Typ / priorita | Nález a dopad | Požadovaná úprava | Důkaz / náročnost |
|---|---|---|---|---|
| A01 | Zjištění / P1 | Menu a routa Reporty používají čtení, stránka vyžaduje správu. Uživatel s pouhým čtením dostane dostupný odkaz, ale nemůže pokračovat. | Oddělit čtení reportů od vytváření a mazání; stejné pravidlo v menu, routě i komponentě. | `portalNavigation.js`, `App.jsx`; `Reports.jsx:84,194` / S |
| A02 | Zjištění / P1 | Předávací protokoly jsou v projekci uvnitř Dokumentů, v realizaci mají vlastní záložku. | Stejná poloha a stejné pojmenování v obou detailech, například Dokumenty → Předání. | `ProjectDetail.jsx:1192`, `RealizaceDetail.jsx:871,879` / M |
| A03 | Zjištění / P1 | Globální hledání nepokrývá zaměstnance ani úkoly; dokument otevírá filtrem podle názvu, nikoli přesnou položku. Stejnojmenné dokumenty mohou být nejednoznačné. | Hledání úkolů a oprávněně dostupných osob; přesné otevření dokumentu podle ID; kontext zakázky ve výsledku. | `src/lib/portalSearchData.js:5` / M |
| A04 | Zjištění / P1 | Docházkový plán má zakázku/místo pouze ve volné poznámce. Nelze na tom spolehlivě počítat kapacitu zakázky. | Volitelná strukturovaná vazba na projekt/realizaci či plánovanou aktivitu; poznámka zůstane zvlášť. | `AttendancePlanning.jsx:85`; migrace `20260905160000_attendance_planning.sql:3` / M |
| A05 | Zjištění / P1 | Úkoly čtou `project_tasks`; synchronizace z harmonogramu přeskakuje plány bez project_id, tedy například samostatnou realizaci. Přehled Úkoly proto není automaticky úplným přehledem práce z realizací. | Společný čtecí přehled úkolů z projekce i realizací, s deduplikací již propojených položek. | `Tasks.jsx:329`; migrace synchronizace, podmínka `v_project_id is null` / L |
| A06 | Zjištění / P1 | Harmonogram převádí stav blocked na „V řešení“ v projektových úkolech. V různých pohledech tak mizí informace o blokaci. | Jeden srozumitelný model stavů včetně „Blokováno“ a důvodu blokace; kompatibilní migrace synchronizace. | `20260905120000_planning_status_alignment.sql`, mapování v_status / M |
| A07 | Zjištění / P1 | Existuje typ dokumentu Zápis z KD a parametr dialogu, ale hledání jeho použití neodhalilo volání s aktivovaným `isMeetingMinutes`. Není to hotový strukturovaný proces KD. | Doplnit zápis jako pracovní záznam, propojit s existujícími dokumenty a úkoly. | `DocumentDialog.jsx:16,58,61`; `Documents.jsx:29` / L |
| A08 | Zjištění / P2 | Notifikační zvonek načítá nejvýše 50 položek a konkrétní navigaci má pouze pro bonus. | Odkaz na původní záznam u každého podporovaného typu, celá historie, filtry, předvolby; detail znovu ověří oprávnění. | `layout/PortalNotifications.jsx:18,36` / M |
| A09 | Zjištění / P2 | Dokumenty, archiv reportů a režijní náklady mají načítání bez stránkování. | Serverové stránkování, správný celkový počet a agregace nezávislá na viditelné stránce. Riziko useknutí dat ověřit na objemu nad limitem API. | `Documents.jsx:55–71`, `Reports.jsx:94`, `OverheadCosts.jsx:171` / M |
| A10 | Zjištění / P2 | CRM detail má devět záložek, včetně „Další údaje“ a „Volitelná pole“, a část textů bez diakritiky. | Shrnutí a další obchodní krok nahoru; méně hlavních záložek; doplňující údaje do rozbalovacích sekcí; jazyková revize. | `CRM.jsx:611–619,789,834` / M |
| A11 | Zjištění / P2 | Moje práce stále používá text „Moje zázemí a finance“ a legacy /employee. Přesměrování funguje. | Odkaz „Moje karta“ na kanonickou cestu, Finance jako jasná část karty. Nejde o rozbitou routu. | `MyWork.jsx`, rychlé akce / S |
| A12 | Zjištění / P2 | Můj profil je v Nastavení a jeho viditelnost závisí na právech k settings. | Vlastní profil dostupný každému přihlášenému přes uživatelské menu; správa firmy zvlášť. Ověřit na roli bez settings. | `Settings.jsx:25,60`; parent routa settings v `App.jsx` / M |
| A13 | Riziko / P2 | Certifikace mají původní evidenci member_certifications, vedle nových zaměstnaneckých záznamů. | Jedna prezentace platností a jasné rozlišení certifikace, smlouvy a verifikace. Před případným sloučením provést mapování a deduplikaci skutečných dat. | `MemberDetail.jsx:210,450`; `employee/EmployeeCenter.jsx` / M |
| A14 | Návrh / P2 | Výplaty mají souhrn za celou historii. Pro měsíční zpracování je vhodnější periodický pracovní přehled. | Výběr období, odděleně datum nároku/žádosti/úhrady, zachovaný přepínač celá historie. Souhrny explicitně označit podle rozsahu. | `Payouts.jsx:365` a následující / M |

## 2. Cílová navigace a jednotné ovládání

Neprovádět jen přejmenování všech modulů. Zachovat známé adresy a postupně zavést méně rozhodování:

- **Moje práce:** dnes, po termínu, čeká na mě, nejbližší schůzky/KD. Administrátor uvidí i frontu schvalování.
- **Zakázky:** společný vstup s přepínačem Projekce / Realizace / Vše. Datové entity zůstanou oddělené; propojení bude viditelné.
- **Plán a docházka:** společná skupina se samostatnými pohledy Kapacity, Harmonogram, Moje docházka. Jasně odlišit plán a skutečnost.
- **Obchod:** CRM, Kontakty a firmy, Nabídky/objednávky, Katalog. „Subjekty“ lze zobrazovat s vysvětlujícím názvem „Kontakty a firmy“.
- **Lidé:** Zaměstnanci, moje karta, administrátorská fronta žádostí.
- **Finance:** Výplaty, Režie, související přehledy podle oprávnění.
- Dokumenty jako společná knihovna dostupná i z kontextu zakázky; konfigurace šablon do Nastavení, použití šablony přímo při zakládání zakázky.

Oblíbené a naposledy otevřené položky nabídnout bez nucení uživatele nastavovat si prostředí. Osobní předvolby ukládat podle identity uživatele; současný klíč oblíbených v localStorage není takto oddělený (`Sidebar.jsx`).

Každá pracovní stránka: název a kontext → jedna hlavní akce → důležité výjimky → obsah → méně časté akce. Souhrnné kartičky mají buď vysvětlit číslo, nebo otevřít odpovídající filtr. Formuláře mají zobrazit chybu u pole a zachovat rozepsaná data při selhání. Destruktivní akce uvést v menu a potvrdit s konkrétním dopadem.

## 3. Pokrytí modulů a doporučené změny

| Oblast / kontrolovaný zdroj | Doporučení a ověření výsledku |
|---|---|
| Moje práce (`MyWork.jsx`) | Sjednotit osobní frontu z projekce, realizace, inženýringu a KD. Člověk pozná „co udělat dál“ bez vstupu do několika seznamů. Finanční schválení zachovat s kontextem a validací, nikoli slepým tlačítkem v kartičce. |
| Projekce, seznam a formulář (`Projects`, `ProjectForm`) | Uložené pohledy Moje/Aktivní/Rizikové, minimum povinných polí při založení a šablona jako volitelná pomoc. V seznamu vedoucí, další termín, stav a výjimka; rozsáhlé finance až v detailu dle role. |
| Detail projektu (`ProjectDetail`) | Shrnutí zdraví zakázky, nejbližší milník, otevřené překážky, odpovědný vedoucí a poslední KD. Pracovní obsah v sekcích Přehled, Práce a plán, Zápisy, Dokumenty, Tým; Finance pouze oprávněným. Neztratit přímé odkazy na úkoly, které již podporují hash a task parametr. |
| Realizace (`RealizaceDetail`, návazné finance a objednávky) | Stejná kostra detailu jako projekce. Viditelná vazba na projekci, objednávky, předání, vady a termíny. V mobilu prioritně kontakt, dnešní práce, fotografie/příloha a bod KD. Společný přehled nesmí zdvojit rozpočet projekce a realizace. |
| Úkoly (`Tasks`, `ProjectTasks`) | Jednotný seznam včetně realizací; zdrojový KD, odpovědný, termín, blokace. Osobní pohled jako výchozí pro pracovníka. Hromadná změna jen vhodných polí a s jasným výsledkem. |
| Plánování (`PlanningBoard`, `planningService`) | Zachovat Gantt a cesty/ubytování/Outlook. Doplnit jednodušší týdenní kapacitní pohled; ukázat přetížení lidí podle úvazku a absencí. Není nutné měnit plány na docházku. |
| Docházka (`Attendance`, `AttendancePlanning`) | Opakování pracovního týdne, kopie zvolených dnů s náhledem konfliktů, návrh skutečné docházky z plánu až po potvrzení. Přehled chybějících dnů před odesláním měsíce, jasné uzamčení a důvod vrácení. Žádost o dovolenou jako samostatné schvalování. |
| Výplaty (`Payouts`, `EmployeeFinance`) | Člověk má vidět „nárok → rezervováno v žádostech → dostupné → vyplaceno“ s rozkliknutelným původem. Admin třídí podle dalšího kroku: schválit, doplnit doklad, evidovat úhradu. Rozlišit projektovou odměnu, bonus a hodinový nárok; nevytvářet nové účetnictví v UI. |
| Zaměstnanci (`Members`, `MemberDetail`, `EmployeeCenter`) | Zachovat jednu kartu; nahoře pouze relevantní výjimky: končící smlouva, licence, chybějící ověření. Žádost po schválení doplnit o stav vyřízení a vazbu na přidělený majetek/licenci/školení. Schvaluje admin, jak již bylo dohodnuto. |
| CRM (`CRM`) | Kompaktní přehled případu: klient, fáze, hodnota dle role, vlastník, další aktivita. Oddělit běžné doplnění údajů od změny fáze či vytvoření nabídky. Raynet reprodukovat podle skutečných potřeb a pozdějšího mapování, nepřebírat automaticky celou jeho složitost. |
| Nabídky a objednávky (`CRMCommercialDocuments`) | Jedna návazná řada příležitost → nabídka → objednávka → zakázka. Ukázat zdroj, aktuální verzi, odeslání a platnost. Před potvrzením zobrazit změny oproti předchozí verzi. Duplicitu vytvoření chránit identifikátorem operace. |
| Kontakty a firmy (`Subjects`, `SubjectDetail`) | Jedna karta firmy napříč CRM a zakázkami; hledání IČO a upozornění na shodu před vytvořením. ARES nabídne náhled změn před přepsáním. Oddělit interní kontaktní osobu od právních údajů. |
| Produkty (`Products`, `ProductForm`) | Oddělit prodejní výběr od správy skladu/dodavatelů. V přehledu katalogu není nutné každému ukazovat součet ceníkových cen všech položek; nenaznačovat, že jde o hodnotu skladu nebo obrat. Stávající ukazatel je „Ceníková hodnota“ (`Products.jsx:579`). |
| Dokumenty (`Documents`, `SharePointFolderBrowser`, `HandoverProtocolsTab`) | Jedna dohledatelná evidence napříč úložišti: zakázka, typ, verze, autor, platnost, stav. Ukládat odkaz na soubor a jeho verzi, nikoli kopie do každé agendy. Sjednotit předání a návaznost na KD. |
| Inženýring (`Engineering`, `ProjectEngineering`) | Pracovní fronta podle termínu, úřadu, vlastníka a chybějících podkladů. Stejnou aktivitu zobrazit ve firmě i v projektu, bez ručního přepisu. Vazba na KD bude odkaz, nikoli druhá evidence úředního řízení. |
| Přehled firmy (`Dashboard`) | Ponechat manažerský účel odlišný od Moje práce. U každého ukazatele období, rozsah dat a definice; rozkliknutí na zdroj. Graf bez informace, jak podle něj jednat, přesunout níže. |
| Režie (`OverheadCosts`, `MonthlyAllocation`, `OverheadReports`) | Měsíční průvodce: náklady → klíč rozdělení → kontrola → uzavření. U nákladu ukázat alokaci; opětovné otevření s důvodem a historií. Stránkování nesmí měnit souhrny. |
| Reporty (`Reports`) | Oddělit interaktivní přehled, okamžitý export a archiv. Nabídnout přednastavení Docházka, Výplaty, Zakázky, KD po termínu. U plánovaných e-mailů příjemce, čas, poslední výsledek a příští běh. |
| Šablony (`ProjectTemplatesPage`, nastavení šablon) | Jeden katalog se zřetelným „Použít“ a odděleným „Upravit šablonu“. Revize šablony nesmí zpětně měnit rozepsané zakázky. |
| Nastavení, účty, role (`Settings`, routy App) | Oddělit osobní profil od firemní správy; čitelné vysvětlení rolí a náhled práv. Stav integrací zobrazit lidsky: aktivní/chybí nastavení/poslední chyba. Auditní log ponechat pro správce. |
| Přihlášení a veřejné objednávky (`Auth`, `UpdatePassword`, `OrderPage`, `SubcontractorOrderPage`) | Testovat celý průchod pozvánkou a obnovou hesla. U veřejného odkazu jasný zadavatel, dokument, platnost, kontakt a výsledek potvrzení. Expirovaný odkaz musí nabídnout další postup. Veřejnou dostupnost a důvěryhodný HTTPS certifikát ověřit odděleně; jejich dokončení zde nepotvrzuji. |

## 4. Zápisy ze schůzek a kontrolních dnů

### Uživatelský průchod

1. V projektu nebo realizaci otevřu **Zápisy** a kliknu **Nový kontrolní den**. Vyplním datum, místo, účastníky a zapisovatele. Zakázka je předvyplněná.
2. Nabídne se agenda z otevřených bodů předchozího KD. Body se odkazují na původní záznamy; nekopírují se jako nové úkoly.
3. Během jednání přidávám body typu Informace, Rozhodnutí, Úkol, Riziko či změnový požadavek. U úkolu zadám odpovědného a termín, případně připojím existující úkol.
4. Přiložím fotografii, výkres nebo existující soubor. Rozhodnutí ovlivňující cenu/termín označím jako změnový požadavek; samotný zápis nezmění schválený budget.
5. Uložím koncept. Před vydáním zkontroluji chybějící termíny/odpovědnosti a vyberu příjemce. Externí příjemce dostane pouze určený vydaný obsah, nikdy automaticky interní komentáře či finance.
6. Vydání vytvoří neměnnou revizi a PDF. Oprava vytvoří novou revizi se stručným vysvětlením. Odeslání se eviduje samostatně včetně selhání a bezpečného opakování.
7. Úkol se objeví v Moje práce a pracovním plánu. Další KD nabídne neuzavřené body; splnění úkolu se projeví ve všech pohledech. Historie vydaného PDF se nemění.

### Obrazovka zápisu

Nahoře například „KD 04 · Modernizace objektu · Koncept“, pod tím datum, místo a účastníci. Výchozí obsah: neuzavřené body minule → nové body → rozhodnutí → přílohy. Pro každý bod čitelné číslo, text, odpovědný, termín a stav. Na mobilu karty pod sebou; na počítači kompaktní tabulka. Hlavní akce se mění podle fáze: Uložit koncept / Připravit vydání / Odeslat vydanou revizi.

Externí odpovědný nemusí mít účet: evidovat kontakt a ruční stav potvrzení; nerozesílat mu automaticky pozvánku ani nedávat přístup k projektu. „Odesláno“ není totéž jako „přečteno“ nebo „odsouhlaseno“.

### Datový návrh, nikoli hotová migrace

- `meeting_records`: vazba na právě jeden primární projekt NEBO realizaci, typ schůzky, číslo v zakázce, termín, místo, zapisovatel, stav a verze pro souběžnou editaci. Případné související zakázky přes vazební tabulku, nikoli kopie zápisu.
- `meeting_participants`: interní member_id nebo externí contact_id, účast a role. Vydaná revize uchová jmenný snapshot, aby pozdější přejmenování kontaktu nezměnilo historii.
- `meeting_items`: stabilní ID bodu, číslo, druh, text, návaznost na předchozí bod a klasifikace interní/určeno k vydání. Autoritativní stav práce a termín číst z navázaného úkolu.
- `meeting_item_links`: odkaz na existující pracovní položku. Preferovat kanonickou planning_item pro podporu realizací; u projektů využít již existující legacy vazbu. Jedinečnost propojení chrání proti dvojímu vytvoření úkolu při opakovaném kliknutí.
- `meeting_revisions`: neměnný snapshot vydaného obsahu, číslo revize, autor, čas, odkaz na PDF/verzi souboru. Aktuální stav úkolu zobrazovat vedle historického vydaného stavu.
- `meeting_deliveries`: konkrétní revize, příjemci, stav a identifikátor doručení. Využít stávající mechanismus deduplikace e-mailů; nevytvářet paralelní obecný mailer.
- Přílohy odkazují do existující dokumentové evidence. Notifikace používají existující zvonek a bezpečné odkazy na zdrojový záznam.

Všude FK, indexy podle zakázky/data a odpovědného/termínu, kontrola oprávnění v DB, audit změn, transakční vytvoření bodu+úkolu a ochrana proti souběžnému přepsání. Samotné skrytí tlačítka v UI nestačí. Konkrétní schéma navrhnout až po ověření všech závislostí stávajícího task/planning modelu; tento dokument nespouští SQL.

### Zavádění a historie

Přidat tabulky a funkce aditivně, nejprve nasadit vypnutou funkci. Zálohovat DB a přílohy, vyzkoušet obnovu a RLS na testovacích datech. Stávající PDF typu Zápis z KD převzít jako historickou přílohu; nevymýšlet z něj automaticky rozhodnutí ani úkoly. Volitelná budoucí AI extrakce může připravit koncept, člověk musí potvrdit odpovědnosti, termíny a vydání. Při rollbacku vypnout nový vstup, zachovat již vytvořené záznamy.

## 5. Přijímací scénáře

- Pracovník najde svůj úkol z realizace i projekce v jednom seznamu a otevře jeho původní KD.
- Vydání téhož KD dvakrát nevytvoří dva úkoly ani dva automatické e-maily.
- Změna stavu propojeného úkolu se promítne v plánu i zápisu; vydaná revize zůstane historicky stejná.
- Dva lidé upravující koncept uvidí konflikt místo tichého přepsání.
- Externí příjemce nevidí interní komentář, mzdu, odměnu ani jiný projekt.
- Plánovaná absence se nepočítá jako schválená dovolená, plánovaný čas jako odpracovaný a bonus jako druhá základní odměna.
- Role reports.can_read otevře report; nemůže ho smazat bez odpovídajícího práva.
- Seznam nad limitem API zobrazí úplný počet a součet; filtr a návrat z detailu se zachovají.
- Na mobilu uživatel přidá docházku a bod KD bez horizontálního hledání hlavní akce.
- Pro běžnou práci otestovat klávesnici, návrat fokusu po zavření dialogu, popisy ikon, chyby polí, pomalé připojení a přerušení ukládání.

Při vizuální validaci používat jako základ WCAG 2.2: minimální cíle ovládání 24 × 24 CSS px s příslušnými výjimkami; pro hlavní mobilní akce navrhuji pohodlnější rozměr kolem 44 px. Stavové zprávy mají být dostupné asistivním technologiím bez nutnosti přesunout fokus. Zdroje: [W3C – velikost cíle](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [W3C – stavové zprávy](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). Jde o kritéria budoucí kontroly, nikoli tvrzení, že portál nyní splňuje WCAG.

## 6. Doporučené vývojové balíky

1. **Konzistence a orientace:** A01, A02, A03, A11, A12; sjednocení názvů, zpětných odkazů a chybových stavů. Malé změny s okamžitým přínosem pro všechny role.
2. **Jednotná práce a detail zakázky:** A05–A06, společná kostra projekt/realizace, zdrojové vazby. Podmínka pro kvalitní KD.
3. **KD první verze:** koncept, účastníci, body, vazba na úkoly, revize/PDF, řízené odeslání a další KD. Bez automatické transkripce a rozsáhlého externího portálu v první etapě.
4. **Kapacity, docházka a lidé:** A04, kopírování/opakování plánu, porovnání se skutečností, dokončení zaměstnanecké žádosti a viditelnost měsíčního reportu.
5. **Finance, CRM a přehledy:** období a akční fronty, sjednocené dokumentové vazby, stránkování a definice ukazatelů, následně konkrétní mapování Raynetu.

Úspěch měřit na reálných scénářích všech rolí: dokončení bez nápovědy, počet chybných kroků, čas najít další úkol, čas zapsat den a čas vydat KD. Výchozí hodnoty zatím nejsou změřené; nejprve je získat na současné verzi a potom porovnat stejnými scénáři.
