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
- `reserved_payouts`: výplaty ve stavech `pending`, `approved` a `invoice_uploaded`; blokují další žádost, ale nejsou náklad.
- `paid_payouts`: výplaty ve stavu `paid`; vstupují do nákladového výsledku.
- `reserved_or_paid_amount`: součet aktivních rezervací a paid výplat pro kontrolu dostupnosti.

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
costs_before_paid_payouts = direct_costs + subcontractor_costs + allocated_overhead_costs
costs_after_paid_payouts = costs_before_paid_payouts + paid_payouts
team_budget_after_paid_payouts = remaining_after_costs - paid_payouts
```

`direct_costs` zde znamená ručně zadané projektové náklady bez položek označených jako docházka (`is_attendance_cost`). Docházka je na projektu evidovaná jako `attendance_costs` / `hourly_payout_exposure`, ale do nákladů vstoupí až ve chvíli, kdy odpovídající hodinová výplata přejde do stavu `paid`.

V UI se proto oddělují dvě různé hodnoty:

- Plánovaná marže: firemní marže z ceny projektu před reálnými náklady.
- Zůstatek po nákladech: dostupný týmový/provozní zůstatek po reálných přímých nákladech a alokovaných režiích.

## Projektové Výplaty

Výplaty projektových odměn vychází z nákladově upraveného týmového budgetu:

```text
cost_adjusted_team_budget = planned_team_budget - direct_costs - allocated_overhead_costs
team_budget_after_paid_payouts = cost_adjusted_team_budget - paid_payouts
```

Odměny:

```text
percentage_reward = max(0, team_budget_after_paid_payouts) * reward_percentage / 100
fixed_reward = min(reward_fixed_amount, max(0, team_budget_after_paid_payouts))
available_balance = max(0, calculated_reward - reserved_or_paid_amount)
```

Pokud náklady překročí týmový budget, `cost_adjusted_team_budget` je záporný a dostupná projektová výplata je `0 Kč`.

Rezervované výplaty (`pending`, `approved`, `invoice_uploaded`) snižují dostupnost pro další žádost, ale nezvyšují náklady projektu. Do nákladového výsledku vstupují až po stavu `paid`.

## Realizační Výplaty

Realizační výpočty se nemění. Stále vychází z celkového výnosu realizace, plánované marže, režie a reálných nákladů:

```text
total_revenue = base_contract_amount + extra_revenue
operational_costs = manual_costs + extra_costs
paid_payout_costs = paid_task_payouts + paid_hourly_payouts
costs_after_paid_payouts = operational_costs + paid_payout_costs
team_budget = total_revenue - profit_amount - overhead_amount - operational_costs - paid_payout_costs
available_share = max(0, total_share - reserved_or_paid_amount)
```

Hodinová docházka je v realizaci evidovaná jako potenciální hodinová mzda. Do nákladů vstupuje až ve chvíli, kdy je odpovídající hodinová výplata ve stavu `paid`.

Fixní realizační podíl je omezen dostupným týmovým budgetem stejně jako fixní projektová odměna:

```text
fixed_realization_share = min(share_value, max(0, team_budget))
percentage_realization_share = max(0, team_budget) * share_value / 100
```

Při schválení i zaplacení úkolové výplaty se dostupnost znovu validuje proti aktuálním nákladům, rezervacím a paid výplatám. Pokud se budget mezi vytvořením žádosti a schválením sníží, workflow výplatu nepustí dál.
