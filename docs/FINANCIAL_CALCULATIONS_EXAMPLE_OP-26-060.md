# Příklad finančního výpočtu: OP-26-060

Zdroj dat: `supabase/seed.sql`

## Projekt

- Název: Vzorový projekt FVE 11,2kwp
- Kód: OP-26-060
- Stav: active
- Typ: FVE
- Klient / investor: Resort Letná s.r.o.
- Cena projektu: 46 900 Kč
- Projektový budget: 80 %
- Režie z projektového budgetu: 20 %
- Subdodavatelé v seed datech: 0 Kč
- Přímé projektové náklady v `project_costs`: 0 Kč
- Alokované režie v `project_overhead_costs`: 0 Kč
- Rezervované nebo vyplacené projektové výplaty: 0 Kč

## Rozpad Budgetu

```text
gross_project_budget = price * budget_percentage / 100
gross_project_budget = 46 900 * 80 / 100
gross_project_budget = 37 520 Kč
```

```text
planned_overhead = gross_project_budget * overhead_percentage / 100
planned_overhead = 37 520 * 20 / 100
planned_overhead = 7 504 Kč
```

```text
planned_team_budget = gross_project_budget - planned_overhead - subcontractor_costs
planned_team_budget = 37 520 - 7 504 - 0
planned_team_budget = 30 016 Kč
```

```text
planned_margin = price - gross_project_budget
planned_margin = 46 900 - 37 520
planned_margin = 9 380 Kč
```

```text
remaining_after_costs = planned_team_budget - direct_costs - allocated_overhead_costs
remaining_after_costs = 30 016 - 0 - 0
remaining_after_costs = 30 016 Kč
```

## Tým A Odměny

Aktuální výpočet projektových výplat vychází z `cost_adjusted_team_budget`, tedy ze zůstatku po přímých nákladech a alokovaných režiích.

```text
cost_adjusted_team_budget = planned_team_budget - direct_costs - allocated_overhead_costs
cost_adjusted_team_budget = 30 016 - 0 - 0
cost_adjusted_team_budget = 30 016 Kč
```

| Člen | Typ odměny | Výpočet | Celková odměna | Rezervováno/vyplaceno | Dostupné |
| --- | --- | ---: | ---: | ---: | ---: |
| Ing. Pavel Kopačka | 40 % | 30 016 * 40 % | 12 006,40 Kč | 0 Kč | 12 006,40 Kč |
| Ing. Jan Kopačka | 40 % | 30 016 * 40 % | 12 006,40 Kč | 0 Kč | 12 006,40 Kč |
| Matěj Hůla | hodinově | nepočítá se do projektové procentní/fixní odměny | 0 Kč | 0 Kč | 0 Kč |
| Jakub Brabec | fixní | min(2 500, 30 016) | 2 500 Kč | 0 Kč | 2 500 Kč |

Součet plánovaných projektových odměn z procentních a fixních pravidel:

```text
12 006,40 + 12 006,40 + 2 500 = 26 512,80 Kč
```

Zůstatek týmového budgetu po těchto odměnách:

```text
30 016 - 26 512,80 = 3 503,20 Kč
```

## Docházka V Seed Datech

Seed obsahuje k projektu dvě docházkové položky pro Matěje Hůlu:

| Datum | Hodiny | Hodinová sazba | Informativní náklad |
| --- | ---: | ---: | ---: |
| 2026-05-04 | 6 h | 200 Kč/h | 1 200 Kč |
| 2026-05-05 | 7 h | 200 Kč/h | 1 400 Kč |

Informativní součet docházky:

```text
13 h * 200 Kč/h = 2 600 Kč
```

V aktuálních seed datech ale tyto hodiny nejsou propsané do `project_costs`, takže backendový projektový read model je v tomto příkladu neodečítá jako `direct_costs`.

Pokud by se docházka zaúčtovala do `project_costs`, dopad by byl:

```text
remaining_after_costs = 30 016 - 2 600 - 0
remaining_after_costs = 27 416 Kč
```

Procentní odměna 40 % by potom byla:

```text
27 416 * 40 % = 10 966,40 Kč
```

Fixní odměna Jakuba Brabce by zůstala:

```text
min(2 500, 27 416) = 2 500 Kč
```

## Shrnutí

Pro projekt OP-26-060 podle zaúčtovaných projektových finančních dat:

- Plánovaná marže: 9 380 Kč
- Hrubý projektový budget: 37 520 Kč
- Plánovaná režie: 7 504 Kč
- Týmový budget: 30 016 Kč
- Zůstatek po nákladech: 30 016 Kč
- Dostupné projektové odměny:
  - Ing. Pavel Kopačka: 12 006,40 Kč
  - Ing. Jan Kopačka: 12 006,40 Kč
  - Jakub Brabec: 2 500 Kč
  - Matěj Hůla: 0 Kč v projektových payout pravidlech, protože je hodinový člen
