-- Seed premium EKV offer template for CRM offer PDF/DOCX generation.
-- Idempotent by template name; safe even when order_templates.name has no unique constraint.
do $$
begin
  if exists (select 1 from public.order_templates where name = 'EKV Premium nabidka FVE') then
    update public.order_templates
       set description = 'Moderni nabidka pro PDF vystup se souhrnem, polozkami, ID originalu a podpisovym blokem. DOCX vystup pouziva specializovany renderer v aplikaci.',
           document_category = 'offer',
           content = '<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Nab&iacute;dka {{document_number}}</title>
  <style>
    :root { --ink:#111827; --muted:#667085; --line:#d8e0eb; --soft:#f5f8fc; --blue:#2459c7; --blue-dark:#153b82; --green:#2f8f5b; --amber:#d89024; }
    * { box-sizing: border-box; }
    body { margin:0; background:#e9edf4; color:var(--ink); font-family:"Aptos","Segoe UI",Calibri,Arial,sans-serif; font-size:10.8px; line-height:1.35; }
    .page { width:210mm; min-height:297mm; margin:16px auto; background:#fff; padding:9mm 10mm; box-shadow:0 20px 55px rgba(15,23,42,.16); }
    .topbar { height:7px; border-radius:999px; background:linear-gradient(90deg,var(--blue-dark),var(--blue),var(--green)); margin-bottom:9px; }
    header { display:grid; grid-template-columns:1fr 74mm; gap:8mm; align-items:start; margin-bottom:12px; }
    .brand { display:flex; align-items:center; margin-bottom:11px; }
    .brand-logo { width:54mm; max-width:100%; height:auto; display:block; }
    .doc-title .label { margin:0 0 6px; color:var(--blue); font-weight:800; text-transform:uppercase; letter-spacing:.12em; font-size:10px; }
    .doc-title h2 { margin:0; font-size:25px; line-height:1.03; letter-spacing:-.04em; }
    .doc-title .subtitle { margin:8px 0 0; color:#475467; font-size:12px; max-width:112mm; }
    .meta { border:1px solid var(--line); border-radius:13px; overflow:hidden; background:#fbfdff; }
    .meta-row { display:grid; grid-template-columns:30mm 1fr; gap:8px; padding:9px 10px; border-bottom:1px solid var(--line); }
    .meta-row:last-child { border-bottom:0; }
    .meta span { color:var(--muted); text-transform:uppercase; font-size:9px; letter-spacing:.11em; }
    .meta strong { text-align:right; font-size:11px; }
    .panel-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:9px; }
    .panel { border:1px solid var(--line); border-radius:13px; padding:9px; background:#fff; }
    .panel h3, .section h3 { margin:0 0 8px; font-size:12px; text-transform:uppercase; color:#344054; letter-spacing:.08em; }
    .panel .name { font-size:17px; font-weight:800; margin-bottom:5px; }
    .muted { color:var(--muted); }
    .section { margin-top:9px; }
    .section-title { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #e8edf5; padding-bottom:7px; margin-bottom:8px; }
    .section-title h3 { margin:0; font-size:14px; color:#111827; text-transform:none; letter-spacing:0; }
    .pill { border-radius:999px; background:#edf4ff; color:#2459c7; padding:4px 8px; font-weight:800; font-size:10px; }
    table { width:100%; border-collapse:separate; border-spacing:0; }
    .items { border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:10.2px; }
    .items th { background:#f3f6fb; color:#667085; text-transform:uppercase; letter-spacing:.08em; font-size:8.5px; text-align:left; padding:5px 5px; border-bottom:1px solid var(--line); }
    .items td { padding:5px 5px; border-bottom:1px solid #edf1f6; vertical-align:top; }
    .items tr:last-child td { border-bottom:0; }
    .num { text-align:right; white-space:nowrap; }
    .code { color:#2459c7; font-weight:800; white-space:nowrap; }
    .desc { display:block; color:#667085; font-size:9px; margin-top:2px; }
    .summary { display:flex; justify-content:flex-end; margin-top:9px; }
    .totals { border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#fff; }
    .total-row { display:grid; grid-template-columns:1fr 28mm; padding:7px 10px; border-bottom:1px solid #edf1f6; }
    .total-row:last-child { border-bottom:0; }
    .total-row strong { text-align:right; }
    .total-main { background:#ecfdf3; color:#14532d; font-size:13px; font-weight:900; }
    .signature { margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:8mm; }
    .sig-card { border:1px solid var(--line); border-radius:12px; padding:10px; min-height:58px; display:flex; flex-direction:column; justify-content:space-between; }
    .sig-line { border-top:1px solid #98a2b3; padding-top:6px; color:#667085; font-size:10px; }
    footer { margin-top:9px; padding-top:6px; border-top:1px solid #e8edf5; display:flex; justify-content:space-between; gap:10px; color:#667085; font-size:9px; }
    @page { size: A4; margin: 0; }
    @media print { body{background:#fff;} .page{margin:0; box-shadow:none; width:auto; min-height:auto;} }
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar"></div>
    <header>
      <div>
        <div class="brand"><img class="brand-logo" src="{{company_logo}}" alt="EKV Project" /></div>
        <div class="doc-title">
          <p class="label">Nab&iacute;dka {{document_number}}</p>
          <h2>{{document_title}}</h2>
          <p class="subtitle">Polo&#382;kov&yacute; n&aacute;vrh dod&aacute;vky a realizace. Hodnoty v dokumentu odpov&iacute;daj&iacute; aktu&aacute;ln&iacute; kalkulaci nab&iacute;dky.</p>
        </div>
      </div>
      <aside class="meta">
        <div class="meta-row"><span>Vystaveno</span><strong>{{document_date}}</strong></div>
        <div class="meta-row"><span>Platnost</span><strong>{{document_valid_until}}</strong></div>
        <div class="meta-row"><span>Obchodn&iacute; p&#345;&iacute;pad</span><strong>{{opportunity_title}}</strong></div>
        <div class="meta-row"><span>Celkem s DPH</span><strong>{{total_with_tax}}</strong></div>
      </aside>
    </header>

    <section class="panel-grid">
      <div class="panel"><h3>Klient</h3><div class="name">{{client_name}}</div><p class="muted">Kontaktn&iacute; &uacute;daje a faktura&#269;n&iacute; informace jsou veden&eacute; v detailu subjektu.</p></div>
      <div class="panel"><h3>Projekt</h3><div class="name">{{project_name}}</div><p class="muted">{{opportunity_description}}</p></div>
    </section>

    <section class="section">
      <div class="section-title"><h3>Polo&#382;kov&yacute; rozpo&#269;et</h3><span class="pill">{{item_count}} polo&#382;ek</span></div>
      <div class="items">{{items_table}}</div>
    </section>

    <section class="summary">
      <div class="totals">
        <div class="total-row"><span>Cena p&#345;ed slevou</span><strong>{{subtotal}}</strong></div>
        <div class="total-row"><span>Sleva celkem</span><strong>{{discount_total}}</strong></div>
        <div class="total-row"><span>DPH</span><strong>{{tax_total}}</strong></div>
        <div class="total-row total-main"><span>Celkem s DPH</span><strong>{{total_with_tax}}</strong></div>
      </div>
    </section>

    <section class="signature">
      <div class="sig-card"><strong>Za EKV Project</strong><div class="sig-line">Datum, jm&eacute;no a podpis</div></div>
      <div class="sig-card"><strong>Za klienta</strong><div class="sig-line">Datum, jm&eacute;no a podpis</div></div>
    </section>

    <footer><span>Vygenerov&aacute;no: {{generated_at}}</span><span>ID origin&aacute;lu: {{document_original_id}}</span></footer>
  </main>
</body>
</html>
',
           is_active = true,
           updated_at = coalesce(now(), updated_at)
     where name = 'EKV Premium nabidka FVE';
  else
    insert into public.order_templates (name, description, document_category, content, is_active)
    values (
      'EKV Premium nabidka FVE',
      'Moderni nabidka pro PDF vystup se souhrnem, polozkami, ID originalu a podpisovym blokem. DOCX vystup pouziva specializovany renderer v aplikaci.',
      'offer',
      '<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Nab&iacute;dka {{document_number}}</title>
  <style>
    :root { --ink:#111827; --muted:#667085; --line:#d8e0eb; --soft:#f5f8fc; --blue:#2459c7; --blue-dark:#153b82; --green:#2f8f5b; --amber:#d89024; }
    * { box-sizing: border-box; }
    body { margin:0; background:#e9edf4; color:var(--ink); font-family:"Aptos","Segoe UI",Calibri,Arial,sans-serif; font-size:10.8px; line-height:1.35; }
    .page { width:210mm; min-height:297mm; margin:16px auto; background:#fff; padding:9mm 10mm; box-shadow:0 20px 55px rgba(15,23,42,.16); }
    .topbar { height:7px; border-radius:999px; background:linear-gradient(90deg,var(--blue-dark),var(--blue),var(--green)); margin-bottom:9px; }
    header { display:grid; grid-template-columns:1fr 74mm; gap:8mm; align-items:start; margin-bottom:12px; }
    .brand { display:flex; align-items:center; margin-bottom:11px; }
    .brand-logo { width:54mm; max-width:100%; height:auto; display:block; }
    .doc-title .label { margin:0 0 6px; color:var(--blue); font-weight:800; text-transform:uppercase; letter-spacing:.12em; font-size:10px; }
    .doc-title h2 { margin:0; font-size:25px; line-height:1.03; letter-spacing:-.04em; }
    .doc-title .subtitle { margin:8px 0 0; color:#475467; font-size:12px; max-width:112mm; }
    .meta { border:1px solid var(--line); border-radius:13px; overflow:hidden; background:#fbfdff; }
    .meta-row { display:grid; grid-template-columns:30mm 1fr; gap:8px; padding:9px 10px; border-bottom:1px solid var(--line); }
    .meta-row:last-child { border-bottom:0; }
    .meta span { color:var(--muted); text-transform:uppercase; font-size:9px; letter-spacing:.11em; }
    .meta strong { text-align:right; font-size:11px; }
    .panel-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:9px; }
    .panel { border:1px solid var(--line); border-radius:13px; padding:9px; background:#fff; }
    .panel h3, .section h3 { margin:0 0 8px; font-size:12px; text-transform:uppercase; color:#344054; letter-spacing:.08em; }
    .panel .name { font-size:17px; font-weight:800; margin-bottom:5px; }
    .muted { color:var(--muted); }
    .section { margin-top:9px; }
    .section-title { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #e8edf5; padding-bottom:7px; margin-bottom:8px; }
    .section-title h3 { margin:0; font-size:14px; color:#111827; text-transform:none; letter-spacing:0; }
    .pill { border-radius:999px; background:#edf4ff; color:#2459c7; padding:4px 8px; font-weight:800; font-size:10px; }
    table { width:100%; border-collapse:separate; border-spacing:0; }
    .items { border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:10.2px; }
    .items th { background:#f3f6fb; color:#667085; text-transform:uppercase; letter-spacing:.08em; font-size:8.5px; text-align:left; padding:5px 5px; border-bottom:1px solid var(--line); }
    .items td { padding:5px 5px; border-bottom:1px solid #edf1f6; vertical-align:top; }
    .items tr:last-child td { border-bottom:0; }
    .num { text-align:right; white-space:nowrap; }
    .code { color:#2459c7; font-weight:800; white-space:nowrap; }
    .desc { display:block; color:#667085; font-size:9px; margin-top:2px; }
    .summary { display:flex; justify-content:flex-end; margin-top:9px; }
    .totals { border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#fff; }
    .total-row { display:grid; grid-template-columns:1fr 28mm; padding:7px 10px; border-bottom:1px solid #edf1f6; }
    .total-row:last-child { border-bottom:0; }
    .total-row strong { text-align:right; }
    .total-main { background:#ecfdf3; color:#14532d; font-size:13px; font-weight:900; }
    .signature { margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:8mm; }
    .sig-card { border:1px solid var(--line); border-radius:12px; padding:10px; min-height:58px; display:flex; flex-direction:column; justify-content:space-between; }
    .sig-line { border-top:1px solid #98a2b3; padding-top:6px; color:#667085; font-size:10px; }
    footer { margin-top:9px; padding-top:6px; border-top:1px solid #e8edf5; display:flex; justify-content:space-between; gap:10px; color:#667085; font-size:9px; }
    @page { size: A4; margin: 0; }
    @media print { body{background:#fff;} .page{margin:0; box-shadow:none; width:auto; min-height:auto;} }
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar"></div>
    <header>
      <div>
        <div class="brand"><img class="brand-logo" src="{{company_logo}}" alt="EKV Project" /></div>
        <div class="doc-title">
          <p class="label">Nab&iacute;dka {{document_number}}</p>
          <h2>{{document_title}}</h2>
          <p class="subtitle">Polo&#382;kov&yacute; n&aacute;vrh dod&aacute;vky a realizace. Hodnoty v dokumentu odpov&iacute;daj&iacute; aktu&aacute;ln&iacute; kalkulaci nab&iacute;dky.</p>
        </div>
      </div>
      <aside class="meta">
        <div class="meta-row"><span>Vystaveno</span><strong>{{document_date}}</strong></div>
        <div class="meta-row"><span>Platnost</span><strong>{{document_valid_until}}</strong></div>
        <div class="meta-row"><span>Obchodn&iacute; p&#345;&iacute;pad</span><strong>{{opportunity_title}}</strong></div>
        <div class="meta-row"><span>Celkem s DPH</span><strong>{{total_with_tax}}</strong></div>
      </aside>
    </header>

    <section class="panel-grid">
      <div class="panel"><h3>Klient</h3><div class="name">{{client_name}}</div><p class="muted">Kontaktn&iacute; &uacute;daje a faktura&#269;n&iacute; informace jsou veden&eacute; v detailu subjektu.</p></div>
      <div class="panel"><h3>Projekt</h3><div class="name">{{project_name}}</div><p class="muted">{{opportunity_description}}</p></div>
    </section>

    <section class="section">
      <div class="section-title"><h3>Polo&#382;kov&yacute; rozpo&#269;et</h3><span class="pill">{{item_count}} polo&#382;ek</span></div>
      <div class="items">{{items_table}}</div>
    </section>

    <section class="summary">
      <div class="totals">
        <div class="total-row"><span>Cena p&#345;ed slevou</span><strong>{{subtotal}}</strong></div>
        <div class="total-row"><span>Sleva celkem</span><strong>{{discount_total}}</strong></div>
        <div class="total-row"><span>DPH</span><strong>{{tax_total}}</strong></div>
        <div class="total-row total-main"><span>Celkem s DPH</span><strong>{{total_with_tax}}</strong></div>
      </div>
    </section>

    <section class="signature">
      <div class="sig-card"><strong>Za EKV Project</strong><div class="sig-line">Datum, jm&eacute;no a podpis</div></div>
      <div class="sig-card"><strong>Za klienta</strong><div class="sig-line">Datum, jm&eacute;no a podpis</div></div>
    </section>

    <footer><span>Vygenerov&aacute;no: {{generated_at}}</span><span>ID origin&aacute;lu: {{document_original_id}}</span></footer>
  </main>
</body>
</html>
',
      true
    );
  end if;
end $$;
