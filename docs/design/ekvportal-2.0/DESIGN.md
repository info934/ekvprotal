# EKV Portal 2.0 — návrh rozhraní

Větev `codex/ekvportal-2.0`, základ `436fb12` z 31. 8. 2026. Návrh a implementace 5. 9. 2026. Všechny role mají stejnou prioritu; dostupné akce a finanční údaje určují stávající oprávnění.

## Základ rozhraní

- Stálá navigace v tmavé modré `#142938`, šířka 240 px / sbalená 76 px. Mobil používá vysouvací menu. Oblíbené zachovávají původní uložené cesty.
- Pracovní plocha `#f5f7fa`, bílé panely, jemná linka `#dfe6ee`, radius 12 px. Akční modrá `#1469e8`; stavové barvy jsou doplněny textem.
- Inter se systémovým fallbackem, titulky 28–32 px, běžné ovládání 14–16 px. Základní vstupy a akce 44 px. Respektování omezeného pohybu, viditelný focus a odkaz pro přeskočení navigace.
- Jeden hlavní nadpis, kontextové akce v hlavičce, vodorovné záložky, data v řádcích. Detailní finanční analýzy zůstávají dostupné v příslušných modulech.
- Globální hledání přes Ctrl/Cmd K: projekce, realizace, subjekty, obchodní případy a dokumenty. Hledá názvy a identifikátory; zpracuje jen povolené moduly. Tab / Enter / Esc mají nápovědu v dialogu.

## Pracovní obrazovky

`Moje práce` je nová výchozí stránka. Zobrazuje skutečné úkoly, samostatně načtené úplné počty, rozpracované zakázky a odkazy do schvalovacích agend. Částečná chyba se zobrazí v přehledu; neznámý počet není nula. Původní finanční a firemní dashboard zůstává na `/dashboard`.

Projekce a realizace otevírají tabulkový pohled. Filtr, hledání, řazení a pohled jsou v URL a v uživatelské session; návrat z detailu je obnovuje. Grafy jsou ve sbalitelné „Analýze zakázek“. Karty a kanban zůstávají k dispozici.

Detaily projekce a realizace mají klidnější hlavičku, přehled odpovědností, termínů a následujících kroků. Finanční záložky a původní oprávnění zůstávají. Zrušené úkoly se nepočítají jako otevřené ani do pokroku.

Docházka vede od vybraného měsíce k zápisu a odeslání ke schválení. Zápis staršího měsíce se nezaloží na dnešním datu; schválené/odeslané měsíce respektují svůj pracovní postup.

`Moje zázemí` doplňuje zaměstnaneckou kartu: majetek, smlouvy a ověření, žádosti a dosavadní osobní finance. Zaměstnanecký stav je samostatný od přihlašovací role. Zaměstnance explicitně zařazuje administrátor. Aktuálně schvaluje žádosti administrátor; krok vedoucího je budoucí rozšíření.

## Obrazové reference

- [Moje práce](work-concept.png)
- [Detail projekce](project-concept.png)
- [Moje zázemí](employee-concept.png)

Reference určují strukturu, hierarchii a vizuální styl. Jména, počty, stavy a termíny pocházejí při běhu z aplikace. Náhled používá označená ukázková data. Referenční ikony upozornění/pomoci bez podporované funkce nejsou implementované; skutečné agendy a jejich přístupy se zachovávají. Mobil panely skládá pod sebe a široké tabulky posouvá uvnitř kontejneru.

## Stavové chování

Načítání, prázdná data a chyba mají oddělené stavy. Formuláře ponechávají vstup při chybě. Projektové formuláře chrání odchod vlastním dialogem, zavření/obnovu standardním upozorněním prohlížeče. Při návratu historií lze obnovit dočasný draft z paměti otevřené aplikace; po reloadu se paměťový draft neobnovuje. CRM ukládá rozpracované údaje explicitním potvrzením a detekuje souběžné změny polí.

Zaměstnanecké žádosti mají historii podání a rozhodnutí. Schválení není automatický nákup licence, rezervace školení ani platba. Smlouvy/ověření jsou evidence metadat a chráněných HTTPS odkazů; stav „Ověřeno“ zapisuje správce, ne automatické právní posouzení.
