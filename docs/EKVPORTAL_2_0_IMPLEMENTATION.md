# EKV Portal 2.0 — provedené změny a ověření

Stav 5. 9. 2026. Větev `codex/ekvportal-2.0`, základ `436fb12` z 31. 8. 2026. Změny jsou v pracovním stromu. Produkční databáze, Edge funkce ani web nebyly nasazeny.

## Co je implementováno

- Společné rozhraní: tmavá navigace, mobilní menu, zachované oblíbené položky, skupiny Práce / Obchod / Firma, globální hledání s Ctrl/Cmd K, jednotné hlavičky, záložky a ovládací prvky.
- Nová výchozí stránka Moje práce s vlastními úkoly, termíny, rozpracovanými zakázkami a skutečnými počty ke schválení. Původní firemní a finanční dashboard zůstává dostupný.
- Projekce a realizace: tabulkový výchozí pohled, zachování filtru a řazení při návratu, přehlednější detaily, sbalitelná finanční analýza, zachované karty a kanban.
- Ochrana rozpracovaných projektových formulářů při odchodu a obnovení dočasného draftu po návratu historií. Úpravy obchodního případu mají explicitní Uložit / Zrušit a kontrolu souběžných změn polí.
- Stabilizace docházky, filtrů výplat, plánování, stavů úkolů, načítání dokumentů, exportů a stránkování. CRM výpočty nevymýšlejí marži, chybějící data se odlišují od nuly. Zápisy obchodních dokladů a sestav používají atomické databázové operace.
- Kontrola deaktivovaného účtu při obnovení relace a na backendu; ochrana před opakovaným odesláním emailu při nejednoznačné odpovědi poskytovatele.

## Zaměstnanecká karta a zachované finance

`/employee` otevírá vlastní kartu. Administrátor může přejít z detailu člena do `/employees/:employeeMemberId` a explicitně aktivovat zaměstnanecký status. Status je oddělený od přihlašovací role.

Karta obsahuje vozidla, klíče/přístupy, techniku a licence včetně předání a vrácení; smlouvy, ověření a školení s platností, stavem, poznámkou a bezpečným HTTPS odkazem. Jde o evidenci metadat, nikoliv nový systém nahrávání nebo elektronického podpisu souborů.

Aktivní zaměstnanec podává vlastní žádosti o školení, licenci nebo vybavení. Administrátor rozhoduje a eviduje vyřízení. Zamítnutí vyžaduje důvod. Historie zachovává aktéra a čas každého přechodu. Vlastník může zrušit vlastní čekající žádost. Schválení nespouští skutečný nákup ani platbu. Schvalování vedoucím je ponecháno pro další rozšíření dle zadání.

Finance zůstávají dostupné vlastníkovi a administrátorovi i bez aktivní zaměstnanecké samoobsluhy: hodinová sazba v evidované měně, disponibilní nároky, projektové odměny, čekající a vyplacené paušální i hodinové výplaty. Souhrny vycházejí ze stávajících finančních RPC. Při chybě části historie se ukáže dostupná část a upozornění; neúplný souhrn se nevydává za úplný. Soukromý režim maskuje částky. Původní detail člena i agenda výplat zůstávají.

## Automatické ověření

- ESLint celého projektu: prošel.
- 57 testů v `tests/*.test.mjs`, 9 provozních workflow, 8 ochrany draftů, 10 bezpečnostních scénářů a 16 izolovaného preview: **100 testů prošlo**, bez přeskočení.
- Kontrola 126 databázových migrací, finančních výpočtů, kritických rout a číslování, bezpečnostních a UI invariantů: prošla.
- Produkční sestavení Vite a sestavení odděleného UI preview: prošla. Sestavení hlásí stávající větší balíčky Gantt/XLSX a starší Browserslist data; tyto závislosti nebyly v této změně aktualizovány.
- Test importního grafu a produkčních assetů potvrzuje, že ukázkový backend není součástí produkční aplikace.

SQL integrační sady a skutečné databázové souběhy **nebyly spuštěny**: v prostředí není místní PostgreSQL/Docker. Připravené sady a postup nasazení jsou popsány v [backendovém rollout dokumentu](EKVPORTAL_2_0_BACKEND_ROLLOUT.md). Nasazení vyžaduje stagingové ověření a čtyři migrace před frontendem.

## Ověření v prohlížeči

Kontrola proběhla na skutečných komponentách aplikace s označenými lokálními ukázkovými daty, v rolích administrátor a pracovník. Zápisy v tomto náhledu zůstávají jen v paměti prohlížeče a vnější integrace jsou zablokované.

- Vyhledání zakázky a souvisejících záznamů, filtrování projekcí, otevření detailu a návrat se zachovaným filtrem; mobilní menu a tabulkový kontejner.
- Zápis docházky respektuje vybraný měsíc; odeslaný měsíc nemá nepovolenou akci k úpravě.
- Nová projekce: rozpracovaná hodnota přežije zrušení odchodu; přechod přes postranní menu vyžaduje rozhodnutí. Čistý editační formulář realizace nehlásí neuložené změny.
- Zaměstnanecká žádost: chybná záporná cena ponechá rozepsané hodnoty, zrušení rozepsaného dialogu vyžaduje rozhodnutí, platná žádost se uloží. Zkratka Nový záznam otevře přímo formulář.
- Administrátor žádost schválí, označí jako vyřízenou a v jiné žádosti uvede důvod zamítnutí. Rozbalená historie ukazuje všechny aktéry, časy i poznámky.
- Vrácené vozidlo se přesune do historie majetku a nenabízí další vrácení či úpravu vydání.
- Po deaktivaci zaměstnanecké samoobsluhy pracovník stále načte vlastní finance; cizí zaměstnanecká karta je odmítnuta. Soukromý režim maskuje sazbu, souhrny i řádky.
- Finální kontrola konzole na detailu projektu: žádné chyby. Při vývoji náhledu byl opraven neukončený průchod odměn; test skutečného finančního loaderu proti preview adapteru nyní ověřuje ukončení stránkování.

## Vizuální kontrola

Referenční návrhy a uložené finální snímky byly otevřeny a vizuálně porovnány. Pět kontrolovaných bodů:

1. Tmavá levá navigace a světlá pracovní plocha drží stejnou hierarchii jako reference. Všechny původní agendy mají dostupnou cestu.
2. Nadpisy a hlavní akce jsou odlišené od obsahu. V detailu je návrat samostatně nad titulkem, takže mu neubírá šířku.
3. Souhrnné údaje mají klidný společný pás; projektové i zaměstnanecké údaje se čtou v řádcích a dvou sloupcích na desktopu.
4. Aktivní záložku označuje podtržení. Stav používá text a barvu; upozornění vycházejí z dat. Finanční záložka zachovává rozpis, nikoliv jen souhrnné číslo.
5. Na šířce 390 px se menu skrývá, panely skládají a široké tabulky/záložky posouvají uvnitř. Titulky, formuláře a primární akce zůstávají dosažitelné.

Reference nepředepisují jména ani počty; snímky obsahují pouze ukázková data. Případná „Neuvedeno“ v projektu znamenají chybějící hodnotu. Dokumenty a fakturace mají zachované funkční záložky a panely, proto se spodní část detailu liší od konceptu.

Snímky: [Moje práce — desktop](design/ekvportal-2.0/qa/work-desktop.jpg), [mobil](design/ekvportal-2.0/qa/work-mobile.jpg), [projekce](design/ekvportal-2.0/qa/project-desktop.jpg), [zaměstnanecká karta](design/ekvportal-2.0/qa/employee-desktop.jpg), [karta na mobilu](design/ekvportal-2.0/qa/employee-mobile.jpg), [finance](design/ekvportal-2.0/qa/finance-desktop.jpg), [finance na mobilu](design/ekvportal-2.0/qa/finance-mobile.jpg).

## Lokální náhled a další rozsah

Spuštěný lokální náhled: `http://127.0.0.1:4175/`. Lze přepínat role a obnovit ukázková data. Pro nové spuštění použijte `npm run preview:ui` (výchozí port 4174).

Tato revize pokrývá stabilizaci, společný základ nového rozhraní, pilotní pracovní obrazovky a novou zaměstnaneckou kartu. Detailní reprodukce vašeho Raynet CRM je navazující práce; tato revize ji nevydává za dokončenou.
