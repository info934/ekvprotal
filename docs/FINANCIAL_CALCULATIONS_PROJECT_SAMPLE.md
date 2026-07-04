# Přehled finančních výpočtů na vzorku projektů

Zdroj dat: `supabase/seed.sql`

Tento dokument používá stejnou metodiku jako `docs/FINANCIAL_CALCULATIONS.md`, ale ukazuje ji na větším vzorku projektů ze seedu. Částky jsou bez DPH.

## Použité Vzorce

```text
gross_project_budget = price * budget_percentage / 100
planned_overhead = gross_project_budget * overhead_percentage / 100
planned_team_budget = gross_project_budget - planned_overhead - subcontractor_costs
cost_adjusted_team_budget = planned_team_budget - direct_costs - allocated_overhead_costs
planned_margin = price - gross_project_budget
```

Projektové odměny ve vzorku:

```text
percentage_reward = max(0, cost_adjusted_team_budget) * reward_percentage / 100
fixed_reward = min(reward_fixed_amount, max(0, cost_adjusted_team_budget))
reserved_or_paid_amount = payouts ve stavech pending, approved, invoice_uploaded, paid
```

Sloupec `Analytický zůstatek` níže je rychlá projektová kontrola:

```text
max(0, cost_adjusted_team_budget - planned_rewards - reserved_or_paid_amount)
```

Backendová dostupnost ve výplatách se ale počítá po jednotlivých členech, tedy přes konkrétní `available_balance` člena.

## Souhrnná Tabulka

| Projekt | Stav | Cena | Projektový budget | Plán. režie | Subdod. | Přímé náklady | Tým po nákladech | Plán. marže | Členové / hodinoví | Plán. odměny | Rezerv./vypl. | Analytický zůstatek |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OP-26-029 PD - FVE 2026_1 | active | 1 345 000 Kč | 1 076 000 Kč | 107 600 Kč | 237 949 Kč | 50 000 Kč | 680 451 Kč | 269 000 Kč | 4 / 0 | 499 248,05 Kč | 10 000 Kč | 171 202,95 Kč |
| OP-25-098 eHUB - IVANOVICE NA HANÉ | ready_for_delivery | 1 382 600 Kč | 1 106 080 Kč | 55 304 Kč | 0 Kč | 2 800 Kč | 1 047 976 Kč | 276 520 Kč | 3 / 1 | 983 583,20 Kč | 291 425,99 Kč | 0 Kč |
| PRO-25-007 PD - Kralove Hradecky (SZ) | ready_for_delivery | 624 473 Kč | 499 578,40 Kč | 49 957,84 Kč | 45 000 Kč | 0 Kč | 404 620,56 Kč | 124 894,60 Kč | 4 / 0 | 403 696,45 Kč | 280 000 Kč | 0 Kč |
| PRO-25-006 PD - Jižní Morava (SZ) | delivered | 518 775 Kč | 415 020 Kč | 41 502 Kč | 45 000 Kč | 0 Kč | 328 518 Kč | 103 755 Kč | 4 / 0 | 269 110,80 Kč | 205 555,40 Kč | 0 Kč |
| PRO-25-003 PD - JIZNI CECHY 2 (SŽ) | delivered | 444 760 Kč | 355 808 Kč | 35 580,80 Kč | 30 000 Kč | 0 Kč | 290 227,20 Kč | 88 952 Kč | 3 / 0 | 224 136,32 Kč | 224 136,32 Kč | 0 Kč |
| FVE-0001 Fotovoltaické elektrárny Plzeň 2. | closed | 360 330 Kč | 288 264 Kč | 28 826,40 Kč | 106 600 Kč | 0 Kč | 152 837,60 Kč | 72 066 Kč | 4 / 1 | 152 060,68 Kč | 152 060,04 Kč | 0 Kč |
| PRO-25-002 PD - Ústecký Kraj (SŽ) | delivered | 333 600 Kč | 266 880 Kč | 13 344 Kč | 60 000 Kč | 0 Kč | 193 536 Kč | 66 720 Kč | 4 / 0 | 193 121,60 Kč | 193 120,78 Kč | 0 Kč |
| OP-25-013 PD - Contitental | closed | 293 850 Kč | 235 080 Kč | 23 508 Kč | 15 000 Kč | 0 Kč | 196 572 Kč | 58 770 Kč | 3 / 0 | 189 429 Kč | 32 000 Kč | 0 Kč |
| OP-24-233 PD - České Velenice (SŽ) | closed | 273 760 Kč | 219 008 Kč | 21 900,80 Kč | 15 000 Kč | 0 Kč | 182 107,20 Kč | 54 752 Kč | 3 / 0 | 177 475,04 Kč | 177 475,04 Kč | 0 Kč |
| OP-25-094 FVE 400kWp, Mantov | delivered | 249 000 Kč | 199 200 Kč | 19 920 Kč | 15 000 Kč | 1 800 Kč | 162 480 Kč | 49 800 Kč | 5 / 0 | 162 232 Kč | 56 000 Kč | 0 Kč |
| OP-24-274 Tradiční pivovar v Rakovníku | delivered | 249 000 Kč | 174 300 Kč | 17 430 Kč | 15 000 Kč | 0 Kč | 141 870 Kč | 74 700 Kč | 3 / 0 | 119 309 Kč | 20 000 Kč | 2 561 Kč |
| OP-25-177 BAT - Trutnov | closed | 196 900 Kč | 157 520 Kč | 15 752 Kč | 0 Kč | 0 Kč | 141 768 Kč | 39 380 Kč | 4 / 0 | 141 432,64 Kč | 39 695,04 Kč | 0 Kč |
| OP-25-149 ŽST Valašské Meziříčí | closed | 170 000 Kč | 119 000 Kč | 11 900 Kč | 0 Kč | 0 Kč | 107 100 Kč | 51 000 Kč | 4 / 0 | 103 390 Kč | 103 390 Kč | 0 Kč |
| FVE-0003 ZUS Rokycany | closed | 118 000 Kč | 82 600 Kč | 8 260 Kč | 0 Kč | 1 400 Kč | 72 940 Kč | 35 400 Kč | 2 / 1 | 65 646 Kč | 0 Kč | 7 294 Kč |
| OP-26-060 Vzorový projekt FVE 11,2kwp | active | 46 900 Kč | 37 520 Kč | 7 504 Kč | 0 Kč | 0 Kč | 30 016 Kč | 9 380 Kč | 3 / 1 | 26 512,80 Kč | 0 Kč | 3 503,20 Kč |

## Pozorování Ze Vzorku

- Největší volný analytický zůstatek má `OP-26-029 PD - FVE 2026_1`: 171 202,95 Kč. Důvodem je vysoký týmový budget po nákladech a relativně nízké již rezervované výplaty.
- Několik projektů má analytický zůstatek 0 Kč, protože plánované odměny a už rezervované/vyplacené částky vyčerpávají dostupný týmový budget.
- Projekty se subdodavateli mají nižší `planned_team_budget`, protože subdodavatelé se odečítají před rozdělením týmových odměn.
- Přímé náklady ve vzorku jsou zaúčtované jen u části projektů (`OP-26-029`, `OP-25-098`, `OP-25-094`, `FVE-0003`). U těchto projektů už snižují dostupný týmový budget.
- Hodinoví členové jsou v přehledu počítaní samostatně. Jejich docházkové náklady se projeví až ve chvíli, kdy jsou zaúčtované jako projektové náklady.

## Detail Vybraných Případů

### OP-26-029 PD - FVE 2026_1

```text
gross_project_budget = 1 345 000 * 80 % = 1 076 000 Kč
planned_overhead = 1 076 000 * 10 % = 107 600 Kč
planned_team_budget = 1 076 000 - 107 600 - 237 949 = 730 451 Kč
cost_adjusted_team_budget = 730 451 - 50 000 - 0 = 680 451 Kč
planned_margin = 1 345 000 - 1 076 000 = 269 000 Kč
```

Projekt má po nákladech stále vysoký týmový budget. Po plánovaných odměnách a rezervovaných výplatách zbývá analyticky 171 202,95 Kč.

### OP-25-098 eHUB - IVANOVICE NA HANÉ

```text
gross_project_budget = 1 382 600 * 80 % = 1 106 080 Kč
planned_overhead = 1 106 080 * 5 % = 55 304 Kč
planned_team_budget = 1 106 080 - 55 304 - 0 = 1 050 776 Kč
cost_adjusted_team_budget = 1 050 776 - 2 800 - 0 = 1 047 976 Kč
planned_margin = 1 382 600 - 1 106 080 = 276 520 Kč
```

Týmový budget je vysoký, ale ve vzorku je už proti projektu rezervováno nebo vyplaceno 291 425,99 Kč. Projektový analytický zůstatek po plánovaných odměnách proto vychází 0 Kč.

### OP-26-060 Vzorový projekt FVE 11,2kwp

```text
gross_project_budget = 46 900 * 80 % = 37 520 Kč
planned_overhead = 37 520 * 20 % = 7 504 Kč
planned_team_budget = 37 520 - 7 504 - 0 = 30 016 Kč
cost_adjusted_team_budget = 30 016 - 0 - 0 = 30 016 Kč
planned_margin = 46 900 - 37 520 = 9 380 Kč
```

Projekt nemá v seed datech zaúčtované přímé projektové náklady ani subdodavatele. Dostupný týmový budget je proto shodný s plánovaným týmovým budgetem: 30 016 Kč.
