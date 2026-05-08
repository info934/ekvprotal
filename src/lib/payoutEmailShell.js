export const createPayoutEmailShell = (title, content) => `
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #eef2f7; font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.6; }
    .outer { width: 100%; padding: 32px 12px; box-sizing: border-box; }
    .shell { max-width: 640px; margin: 0 auto; }
    .brand { padding: 0 4px 12px; color: #64748b; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; font-weight: 700; }
    .container { background: #ffffff; border: 1px solid #dbe3ee; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 45px rgba(15, 23, 42, .10); }
    .header { background: #0f172a; color: #fff; padding: 28px 30px; }
    .kicker { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    h1, h2 { margin: 14px 0 0; color: #fff; font-size: 26px; line-height: 1.25; font-weight: 800; }
    .content { padding: 30px; }
    .content p { color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 16px; }
    .footer { background: #f8fafc; padding: 20px 30px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.6; }
    .fineprint { padding: 16px 4px 0; color: #94a3b8; font-size: 12px; text-align: center; }
    .btn { display: inline-block; padding: 12px 18px; background: #2563eb; color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 700; margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
    th, td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 14px; }
    tr:last-child th, tr:last-child td { border-bottom: 0; }
    th { color: #64748b; font-weight: 700; width: 40%; }
    td { color: #111827; }
    strong { color: #0f172a; }
  </style>
</head>
<body>
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${title}</div>
  <div class="outer">
    <div class="shell">
      <div class="brand">EKV Portal</div>
      <div class="container">
        <div class="header">
          <span class="kicker">Výplaty</span>
          <h1>${title}</h1>
        </div>
        <div class="content">
          ${content}
        </div>
        <div class="footer">
          Tento e-mail byl odeslán automaticky systémem EKV Portal. Na tuto zprávu není potřeba odpovídat.
        </div>
      </div>
      <div class="fineprint">
        &copy; ${new Date().getFullYear()} EKV Group
      </div>
    </div>
  </div>
</body>
</html>
`;
