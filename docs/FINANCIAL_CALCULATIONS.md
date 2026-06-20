# Finanční výpočty

Tento dokument popisuje aktuální výpočty CRM dokladů, projektových financí a dostupnosti výplat. Částky v CRM jsou vedené v Kč bez DPH, pokud není výslovně uvedeno jinak.

## Slovník

- `subtotal`: hrubý součet položek bez DPH před slevou.
- `discount_total`: součet řádkových slev bez DPH.
- `total`: základ bez DPH po slevách.
- `tax_total`: DPH počítané ze základu po slevách.
- `total_with_tax`: `total + tax_total`.
- `gross_project_budget`: část ceny projektu určená do projektového budgetu.
- `planned_overhead`: plánovaný rozpočet na režie projektu.
- `planned_team_budget`: týmový budget po odečtení plánovaných režií a subdodavatelů.
- `cost_adjusted_team_budget`: týmový budget po odečtení reálných přímých nákladů a alokovaných režií.
- `reserved_or_paid_amount`: součet výplat ve stavech `pending`, `approved`, `invoice_uploaded` a `paid`.

## CRM Položky A Doklady

Řádkový výpočet:

```text
line_gross = quantity * unit_price
line_discount = line_gross * discount_percent / 100
line_total = line_gross - line_discount
line_tax = line_total * vat_rate / 100
```

Souhrn dokladu nebo příležitosti:

```text
subtotal = sum(round(line_gross, 2))
discount_total = sum(round(line_gross, 2) - round(line_total, 2))
total = sum(round(line_total, 2))
tax_total = round(sum(round(line_total, 2) * vat_rate / 100), 2)
total_with_tax = total + tax_total
```

Příklad:

```text
2 ks * 1 000 Kč, sleva 10 %, DPH 21 %
subtotal = 2 000 Kč
discount_total = 200 Kč
total = 1 800 Kč
tax_total = 378 Kč
total_with_tax = 2 178 Kč
```

Příležitost synchronizovaná do nabídky nebo objednávky používá stejné vzorce ve frontend helperu `calculateCrmTotals` i v databázových RPC funkcích `replace_crm_opportunity_items` a `replace_crm_document_items`.

## Projektové Finance

Základní rozpad projektu:

```text
gross_project_budget = price * budget_percentage / 100
planned_overhead = gross_project_budget * overhead_percentage / 100
planned_team_budget = gross_project_budget - planned_overhead - subcontractor_costs
planned_margin = price - gross_project_budget
remaining_after_costs = planned_team_budget - direct_costs - allocated_overhead_costs
```

V UI se proto oddělují dvě různé hodnoty:

- Plánovaná marže: firemní marže z ceny projektu před reálnými náklady.
- Zůstatek po nákladech: dostupný týmový/provozní zůstatek po reálných přímých nákladech a alokovaných režiích.

## Projektové Výplaty

Výplaty projektových odměn vychází z nákladově upraveného týmového budgetu:

```text
cost_adjusted_team_budget = planned_team_budget - direct_costs - allocated_overhead_costs
```

Odměny:

```text
percentage_reward = max(0, cost_adjusted_team_budget) * reward_percentage / 100
fixed_reward = min(reward_fixed_amount, max(0, cost_adjusted_team_budget))
available_balance = max(0, calculated_reward - reserved_or_paid_amount)
```

Pokud náklady překročí týmový budget, `cost_adjusted_team_budget` je záporný a dostupná projektová výplata je `0 Kč`.

## Realizační Výplaty

Realizační výpočty se nemění. Stále vychází z celkového výnosu realizace, plánované marže, režie a reálných nákladů:

```text
total_revenue = base_contract_amount + extra_revenue
total_costs = manual_costs + hourly_costs + extra_costs
team_budget = total_revenue - profit_amount - overhead_amount - total_costs
available_share = max(0, total_share - reserved_or_paid_amount)
```
