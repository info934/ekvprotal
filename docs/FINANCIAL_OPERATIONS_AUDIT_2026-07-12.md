# Audit finančních výpočtů a operací

Datum kontroly: 12. 7. 2026  
Měna provozního modelu: CZK  
Rozsah: CRM, nabídky a objednávky, projekty, realizace, docházka, hodinové a úkolové výplaty.

## Výsledek

- Produkční kontrola 7 obchodních dokumentů a 16 položek po opravě: 0 rozdílů mezi položkami a hlavičkou dokumentu.
- 55 projektů: 0 záporných cen a 0 procent mimo povolený rozsah.
- 12 realizací: 0 záporných smluvních částek a 0 kombinací marže + režie nad 100 %.
- 11 podílů v 5 realizacích: žádná realizace nemá součet procentních podílů nad 100 %.
- 28 výplat: žádná nulová nebo záporná částka.
- Historických 23 vyplacených záznamů bez `paid_at` bylo doplněno z nejbližšího existujícího workflow data.
- Historických 12 vyplacených záznamů bez faktury bylo označeno explicitním příznakem schválení bez faktury.

## Autoritativní vzorce

### CRM položka

```text
hrubý mezisoučet = množství × prodejní jednotková cena
sleva = hrubý mezisoučet × sleva %
cena bez DPH = hrubý mezisoučet − sleva
DPH = cena bez DPH × sazba DPH
cena s DPH = cena bez DPH + DPH
náklad = množství × snapshot nákupní ceny
marže Kč = cena bez DPH − náklad
marže % = marže Kč / cena bez DPH
provize = cena bez DPH × provize %
zisk po provizi = marže Kč − provize
```

Výpočet probíhá po řádcích a každá peněžní hodnota se zaokrouhluje na dvě desetinná místa. Souhrn dokumentu je součtem zaokrouhlených řádků. Databázové RPC je autoritativní pro uložený stav.

### Projekt

```text
hrubý projektový budget = cena projektu × budget %
plánovaná režie = hrubý projektový budget × režie %
plánovaný týmový budget = hrubý budget − režie − subdodavatelé
budget po nákladech = týmový budget − nepřiřazené přímé náklady − alokované režie
budget po vyplacení = budget po nákladech − vyplacené úkolové odměny − vyplacené hodinové mzdy
dostupné k rezervaci = max(0, budget po vyplacení − čekající/schválené rezervace)
```

Náklad přiřazený konkrétnímu členovi se odečítá od jeho odměny, nikoliv znovu od společného základu. Tím se brání dvojímu odečtu.

### Realizace

```text
celkové tržby = smluvní cena + prodejní hodnota víceprací
plánovaný zisk = celkové tržby × marže %
režie = celkové tržby × režie %
provozní náklady = manuální náklady + nákladová hodnota víceprací
týmový budget = tržby − zisk − režie − provozní náklady
budget po vyplacení = týmový budget − vyplacené úkolové odměny − vyplacené hodinové mzdy
```

Nevyplacená docházka je pouze expozice a nesnižuje účetní budget. Nákladem se stane až zaplacená hodinová žádost. Toto je záměrný model aplikace.

### Výplaty

- `pending`, `approved` a `invoice_uploaded` rezervují dostupný nárok.
- Pouze `paid` snižuje finanční budget jako realizovaný náklad.
- Schválení i označení jako vyplacené znovu serverově kontroluje aktuální dostupnost.
- Vyplacený záznam musí mít `paid_at` a buď fakturu, nebo explicitní schválení bez faktury.
- Hodinová výplata používá neměnný snapshot schválené docházky a hodinové sazby.

## Opravené nálezy

1. `OBJ-26-001` měl správnou cenu bez DPH, DPH a celkovou cenu, ale historicky nulový hrubý mezisoučet. Hlavička byla přepočtena z položek.
2. Starší zaplacené výplaty vznikly před zavedením plného workflow auditu. Byla doplněna metadata a databázový constraint nyní zakazuje stejný stav do budoucna.
3. CRM položky, projekty, realizace a podíly dostaly databázové kontroly rozsahů. Procentní podíly jedné realizace nemohou v součtu překročit 100 %.

## Automatické kontroly

`npm run financial:check` ověřuje:

- slevy 0 %, 10 % a 100 %,
- kombinované sazby DPH 0 %, 12 % a 21 %,
- náklady, marži, provizi a zisk po provizi,
- dopočet prodejní ceny pro cílovou marži,
- projektový budget, náklady a rezervace,
- realizaci, podíly a vyplacené hodinové/úkolové náklady.

## Zbývající rizika a doporučení

1. Pole měny existuje u obchodních dokumentů, ale aplikace nemá kurzovní přepočty. Dokud se nepřidá FX vrstva, musí být finanční řízení považováno za CZK-only.
2. Sazba DPH je technicky omezena na 0/12/21 %, ale aplikace sama neurčuje správný daňový režim konkrétního plnění. Odpovědnost zůstává na uživateli/účetní kontrole.
3. JavaScript používá `Number`; autoritativní uložené částky proto musí nadále počítat PostgreSQL `numeric` a RPC.
4. Dashboardové agregace je vhodné dlouhodobě přesunout na dedikované read modely, aby klient nesčítal velké datové sady a nevznikaly časové rozdíly mezi obrazovkami.
5. Pro účetní uzávěrku doporučujeme pravidelný kontrolní export výplat, faktur a realizovaných nákladů proti účetnímu systému.

