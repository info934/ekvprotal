import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputPath = resolve('docs/FINANCIAL_CALCULATIONS_AUDIT_REPORT.html');

const money = (value) => {
  const amount = Number.parseFloat(value);
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
};

const pct = (value) => `${Number.parseFloat(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} %`;

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const readJsonQuery = (sql) => {
  try {
    const output = execFileSync('docker', [
      'exec',
      'supabase_db_horizons-local',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-t',
      '-A',
      '-c',
      sql,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return JSON.parse(output || '[]');
  } catch (error) {
    return { error: error.stderr?.toString?.() || error.message };
  }
};

const projectRows = readJsonQuery(`
with project_sample as (
  select p.*
  from public.projects p
  where coalesce(p.price, 0) > 0
  order by coalesce(p.price, 0) desc
  limit 8
),
project_costs as (
  select
    pc.project_id,
    coalesce(sum(pc.amount) filter (where not coalesce(pc.is_attendance_cost, false)), 0)::numeric as direct_costs,
    coalesce(sum(pc.amount) filter (where coalesce(pc.is_attendance_cost, false)), 0)::numeric as attendance_costs
  from public.project_costs pc
  group by pc.project_id
),
subcontractors as (
  select project_id, coalesce(sum(price), 0)::numeric as subcontractor_costs
  from public.project_subcontractors
  group by project_id
),
overheads as (
  select project_id, coalesce(sum(amount), 0)::numeric as allocated_overhead_costs
  from public.project_overhead_costs
  group by project_id
),
payouts as (
  select
    pi.project_id,
    coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded')), 0)::numeric as reserved_payouts,
    coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_task_payouts
  from public.payout_items pi
  join public.payouts po on po.id = pi.payout_id
  where pi.project_id is not null
  group by pi.project_id
),
paid_hourly as (
  select
    nullif(entry.value->>'project_id', '')::uuid as project_id,
    coalesce(sum(coalesce((entry.value->>'hours')::numeric, 0) * coalesce(h.hourly_rate, 0)), 0)::numeric as paid_hourly_payouts
  from public.hourly_payout_requests h
  cross join lateral jsonb_array_elements(coalesce(h.attendance_snapshot, '[]'::jsonb)) entry(value)
  where h.status = 'paid'
    and nullif(entry.value->>'project_id', '') is not null
  group by nullif(entry.value->>'project_id', '')::uuid
)
select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb)
from (
  select
    row_number() over (order by coalesce(p.price, 0) desc) as alias_index,
    p.code,
    p.name,
    p.status,
    coalesce(p.price, 0)::numeric as price,
    coalesce(p.budget_percentage, 0)::numeric as budget_percentage,
    coalesce(p.overhead_percentage, 0)::numeric as overhead_percentage,
    (coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100))::numeric as gross_project_budget,
    (coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100) * (coalesce(p.overhead_percentage, 0) / 100))::numeric as planned_overhead,
    coalesce(s.subcontractor_costs, 0)::numeric as subcontractor_costs,
    coalesce(c.direct_costs, 0)::numeric as direct_costs,
    coalesce(c.attendance_costs, 0)::numeric as hourly_exposure,
    coalesce(o.allocated_overhead_costs, 0)::numeric as allocated_overhead_costs,
    coalesce(pay.reserved_payouts, 0)::numeric as reserved_payouts,
    coalesce(pay.paid_task_payouts, 0)::numeric as paid_task_payouts,
    coalesce(ph.paid_hourly_payouts, 0)::numeric as paid_hourly_payouts,
    (
      coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100)
      - coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100) * (coalesce(p.overhead_percentage, 0) / 100)
      - coalesce(s.subcontractor_costs, 0)
    )::numeric as planned_team_budget,
    (
      coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100)
      - coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100) * (coalesce(p.overhead_percentage, 0) / 100)
      - coalesce(s.subcontractor_costs, 0)
      - coalesce(c.direct_costs, 0)
      - coalesce(o.allocated_overhead_costs, 0)
    )::numeric as cost_adjusted_team_budget,
    (
      coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100)
      - coalesce(p.price, 0) * (coalesce(p.budget_percentage, 0) / 100) * (coalesce(p.overhead_percentage, 0) / 100)
      - coalesce(s.subcontractor_costs, 0)
      - coalesce(c.direct_costs, 0)
      - coalesce(o.allocated_overhead_costs, 0)
      - coalesce(pay.paid_task_payouts, 0)
      - coalesce(ph.paid_hourly_payouts, 0)
    )::numeric as team_budget_after_paid
  from project_sample p
  left join project_costs c on c.project_id = p.id
  left join subcontractors s on s.project_id = p.id
  left join overheads o on o.project_id = p.id
  left join payouts pay on pay.project_id = p.id
  left join paid_hourly ph on ph.project_id = p.id
) result;
`);

const realizationRows = readJsonQuery(`
with realization_sample as (
  select r.*
  from public.realizations r
  where coalesce(r.contract_amount, 0) > 0
  order by coalesce(r.contract_amount, 0) desc
  limit 8
),
manual_costs as (
  select realizace_id, coalesce(sum(amount), 0)::numeric as manual_costs
  from public.realizace_costs
  group by realizace_id
),
extra_costs as (
  select realizace_id, coalesce(sum(cost_amount), 0)::numeric as extra_costs, coalesce(sum(sale_amount), 0)::numeric as extra_revenue
  from public.realizace_extra_costs
  group by realizace_id
),
payouts as (
  select
    pi.realization_id,
    coalesce(sum(pi.amount) filter (where po.status in ('pending', 'approved', 'invoice_uploaded')), 0)::numeric as reserved_payouts,
    coalesce(sum(pi.amount) filter (where po.status = 'paid'), 0)::numeric as paid_task_payouts
  from public.payout_items pi
  join public.payouts po on po.id = pi.payout_id
  where pi.realization_id is not null
  group by pi.realization_id
),
paid_hourly as (
  select
    nullif(entry.value->>'realizace_id', '')::uuid as realization_id,
    coalesce(sum(coalesce((entry.value->>'hours')::numeric, 0) * coalesce(h.hourly_rate, 0)), 0)::numeric as paid_hourly_payouts
  from public.hourly_payout_requests h
  cross join lateral jsonb_array_elements(coalesce(h.attendance_snapshot, '[]'::jsonb)) entry(value)
  where h.status = 'paid'
    and nullif(entry.value->>'realizace_id', '') is not null
  group by nullif(entry.value->>'realizace_id', '')::uuid
)
select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb)
from (
  select
    row_number() over (order by coalesce(r.contract_amount, 0) desc) as alias_index,
    r.name,
    r.status,
    coalesce(r.contract_amount, 0)::numeric as base_contract_amount,
    coalesce(ec.extra_revenue, 0)::numeric as extra_revenue,
    (coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0))::numeric as total_revenue,
    coalesce(r.profit_margin_percent, 0)::numeric as profit_margin_percent,
    coalesce(r.overhead_percent, 0)::numeric as overhead_percent,
    ((coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0)) * coalesce(r.profit_margin_percent, 0) / 100)::numeric as profit_amount,
    ((coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0)) * coalesce(r.overhead_percent, 0) / 100)::numeric as overhead_amount,
    coalesce(mc.manual_costs, 0)::numeric as manual_costs,
    coalesce(ec.extra_costs, 0)::numeric as extra_costs,
    (coalesce(mc.manual_costs, 0) + coalesce(ec.extra_costs, 0))::numeric as operational_costs,
    coalesce(pay.reserved_payouts, 0)::numeric as reserved_payouts,
    coalesce(pay.paid_task_payouts, 0)::numeric as paid_task_payouts,
    coalesce(ph.paid_hourly_payouts, 0)::numeric as paid_hourly_payouts,
    (
      coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0)
      - ((coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0)) * coalesce(r.profit_margin_percent, 0) / 100)
      - ((coalesce(r.contract_amount, 0) + coalesce(ec.extra_revenue, 0)) * coalesce(r.overhead_percent, 0) / 100)
      - coalesce(mc.manual_costs, 0)
      - coalesce(ec.extra_costs, 0)
      - coalesce(pay.paid_task_payouts, 0)
      - coalesce(ph.paid_hourly_payouts, 0)
    )::numeric as team_budget
  from realization_sample r
  left join manual_costs mc on mc.realizace_id = r.id
  left join extra_costs ec on ec.realizace_id = r.id
  left join payouts pay on pay.realization_id = r.id
  left join paid_hourly ph on ph.realization_id = r.id
) result;
`);

const queryError = projectRows?.error || realizationRows?.error;
const projects = Array.isArray(projectRows) ? projectRows : [];
const realizations = Array.isArray(realizationRows) ? realizationRows : [];

const demo = {
  project: {
    price: 100000,
    gross: 60000,
    plannedOverhead: 6000,
    subcontractors: 10000,
    plannedTeam: 44000,
    directCosts: 15000,
    allocatedOverhead: 5000,
    hourlyExposure: 6400,
    costAdjusted: 24000,
    paidPayouts: 2000,
    rewardBase: 22000,
    percentReward: 11000,
    reservedOrPaid: 7000,
    available: 4000,
  },
  realization: {
    totalRevenue: 230000,
    profit: 34500,
    overhead: 11500,
    manualCosts: 20000,
    extraCosts: 10000,
    hourlyExposure: 11200,
    totalCosts: 30000,
    teamBudget: 154000,
    percentShare: 38500,
    reserved: 8500,
    available: 30000,
  },
};

const projectTable = projects.map((row) => `
  <tr>
    <td>Projekt ${esc(row.alias_index)}</td>
    <td>${esc(row.status)}</td>
    <td>${money(row.price)}</td>
    <td>${money(row.planned_team_budget)}</td>
    <td>${money(row.direct_costs)}</td>
    <td>${money(row.allocated_overhead_costs)}</td>
    <td>${money(row.hourly_exposure)}</td>
    <td>${money(row.cost_adjusted_team_budget)}</td>
    <td>${money(row.team_budget_after_paid)}</td>
  </tr>
`).join('');

const realizationTable = realizations.map((row) => `
  <tr>
    <td>Realizace ${esc(row.alias_index)}</td>
    <td>${esc(row.status)}</td>
    <td>${money(row.total_revenue)}</td>
    <td>${pct(row.profit_margin_percent)}</td>
    <td>${pct(row.overhead_percent)}</td>
    <td>${money(row.operational_costs)}</td>
    <td>${money(Number(row.paid_task_payouts || 0) + Number(row.paid_hourly_payouts || 0))}</td>
    <td>${money(row.team_budget)}</td>
  </tr>
`).join('');

const generatedAt = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EKV Portal - audit finančních výpočtů</title>
  <style>
    :root { --bg:#f6f8fb; --ink:#172033; --muted:#647086; --line:#d9e0ea; --panel:#fff; --blue:#2563eb; --green:#059669; --amber:#d97706; --red:#dc2626; --slate:#475569; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 Arial, Helvetica, sans-serif; }
    header { background:#0f172a; color:#fff; padding:34px 24px 28px; border-bottom:5px solid var(--blue); }
    main { padding:24px; }
    .wrap, section { max-width:1180px; margin:0 auto; }
    section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:22px; margin-bottom:20px; box-shadow:0 12px 30px rgba(15,23,42,.08); }
    h1,h2,h3 { margin:0; line-height:1.2; }
    h1 { font-size:30px; }
    h2 { font-size:22px; margin-bottom:14px; }
    h3 { font-size:17px; margin:18px 0 8px; }
    p { margin:0 0 12px; }
    .lede { color:#cbd5e1; max-width:900px; margin-top:10px; }
    .meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    .pill { display:inline-flex; border-radius:999px; padding:6px 10px; background:#e2e8f0; color:#172033; font-weight:700; font-size:13px; }
    header .pill { background:rgba(255,255,255,.12); color:#fff; }
    .grid { display:grid; gap:14px; grid-template-columns:repeat(3,minmax(0,1fr)); }
    .card { border:1px solid var(--line); border-radius:8px; padding:16px; background:#fff; }
    .note { border-left:4px solid var(--blue); background:#eff6ff; color:#1e3a8a; padding:12px 14px; border-radius:6px; }
    .warn { border-left-color:var(--amber); background:#fffbeb; color:#92400e; }
    .ok { border-left-color:var(--green); background:#ecfdf5; color:#065f46; }
    code, pre { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { background:#0f172a; color:#e2e8f0; padding:14px; border-radius:8px; overflow:auto; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th,td { border-bottom:1px solid var(--line); padding:9px 10px; text-align:left; vertical-align:top; }
    th { background:#f1f5f9; color:#334155; font-size:13px; }
    td:nth-child(n+3), th:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
    ul { margin:0 0 12px 20px; padding:0; }
    @media (max-width: 800px) { .grid { grid-template-columns:1fr; } main { padding:14px; } table { font-size:13px; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Audit finančních výpočtů EKV Portalu</h1>
      <p class="lede">Statický auditní report pro projekce, realizace, výplaty, hodinové mzdy, režijní alokace a CRM doklady. Reálná data jsou anonymizovaná a slouží jen jako kontrolní vzorek.</p>
      <div class="meta">
        <span class="pill">Vygenerováno: ${esc(generatedAt)}</span>
        <span class="pill">Model: paid-only</span>
        <span class="pill">Data: anonymizovaná lokální DB + DEMO-FIN</span>
      </div>
    </div>
  </header>
  <main>
    ${queryError ? `<section><div class="note warn"><strong>Lokální DB vzorek nebyl načten.</strong> Report používá DEMO-FIN scénář. Detail: ${esc(queryError)}</div></section>` : ''}

    <section>
      <h2>Finanční pravidla</h2>
      <div class="grid">
        <div class="card">
          <h3>Projekce</h3>
          <p><code>gross_project_budget = price * budget_percentage / 100</code></p>
          <p><code>planned_team_budget = gross - planned_overhead - subcontractors</code></p>
          <p><code>cost_adjusted = planned_team_budget - direct_costs - allocated_overhead</code></p>
        </div>
        <div class="card">
          <h3>Výplaty</h3>
          <p><code>team_budget_after_paid = cost_adjusted - paid_payouts</code></p>
          <p><code>available = calculated_reward - reserved_or_paid</code></p>
          <p>Rezervace blokují další žádost, ale nejsou náklad.</p>
        </div>
        <div class="card">
          <h3>Realizace</h3>
          <p><code>team_budget = total_revenue - profit - overhead - operational_costs - paid_payouts</code></p>
          <p>Nezaplacená hodinová práce je expozice, ne náklad.</p>
        </div>
      </div>
    </section>

    <section>
      <h2>DEMO-FIN kontrolní scénář</h2>
      <div class="note ok">Tento scénář je deterministický a slouží jako ruční kontrola backend RPC, UI a dokumentace.</div>
      <h3>Projekt</h3>
      <pre>gross_project_budget = ${money(demo.project.price)} * 60 % = ${money(demo.project.gross)}
planned_team_budget = ${money(demo.project.gross)} - ${money(demo.project.plannedOverhead)} - ${money(demo.project.subcontractors)} = ${money(demo.project.plannedTeam)}
cost_adjusted = ${money(demo.project.plannedTeam)} - ${money(demo.project.directCosts)} - ${money(demo.project.allocatedOverhead)} = ${money(demo.project.costAdjusted)}
hourly_exposure = ${money(demo.project.hourlyExposure)} (nezaplaceno, nesnižuje cost_adjusted)
reward_base = ${money(demo.project.costAdjusted)} - paid ${money(demo.project.paidPayouts)} = ${money(demo.project.rewardBase)}
percentage_reward = ${money(demo.project.rewardBase)} * 50 % = ${money(demo.project.percentReward)}
available = ${money(demo.project.percentReward)} - reserved_or_paid ${money(demo.project.reservedOrPaid)} = ${money(demo.project.available)}</pre>
      <h3>Realizace</h3>
      <pre>team_budget = ${money(demo.realization.totalRevenue)} - ${money(demo.realization.profit)} - ${money(demo.realization.overhead)} - ${money(demo.realization.totalCosts)} = ${money(demo.realization.teamBudget)}
hourly_exposure = ${money(demo.realization.hourlyExposure)} (nezaplaceno, nesnižuje team_budget)
percent_share = ${money(demo.realization.teamBudget)} * 25 % = ${money(demo.realization.percentShare)}
available_share = ${money(demo.realization.percentShare)} - reserved ${money(demo.realization.reserved)} = ${money(demo.realization.available)}</pre>
    </section>

    <section>
      <h2>Anonymizovaný vzorek projektů</h2>
      <p>Alias je stabilní jen v rámci tohoto reportu. Skutečné názvy a kódy nejsou vypsané.</p>
      <table>
        <thead><tr><th>Alias</th><th>Stav</th><th>Cena</th><th>Plán. tým</th><th>Přímé náklady</th><th>Režie</th><th>Hodinová expozice</th><th>Cost-adjusted</th><th>Tým po paid</th></tr></thead>
        <tbody>${projectTable || '<tr><td colspan="9">Bez dostupného vzorku z DB.</td></tr>'}</tbody>
      </table>
    </section>

    <section>
      <h2>Anonymizovaný vzorek realizací</h2>
      <table>
        <thead><tr><th>Alias</th><th>Stav</th><th>Výnos</th><th>Marže</th><th>Režie</th><th>Provozní náklady</th><th>Paid výplaty celkem</th><th>Týmový budget</th></tr></thead>
        <tbody>${realizationTable || '<tr><td colspan="8">Bez dostupného vzorku z DB.</td></tr>'}</tbody>
      </table>
    </section>

    <section>
      <h2>Nálezy a akceptační pravidla</h2>
      <ul>
        <li>UI nesmí používat lokální finanční helper jako autoritativní hodnotu pro výplatu, schválení nebo uzavření workflow.</li>
        <li>Projektové odměny se mají zobrazovat proti budgetu po paid výplatách, pokud je backend summary dostupný.</li>
        <li>Realizační a projektová hodinová práce zůstává expozice do momentu, kdy odpovídající hodinová výplata přejde do stavu <code>paid</code>.</li>
        <li>Režijní alokace se ukládají přes RPC a schválení provádí účetní zápis atomicky.</li>
      </ul>
    </section>
  </main>
</body>
</html>`;

writeFileSync(outputPath, html);
console.log(`Financial audit report written to ${outputPath}`);
