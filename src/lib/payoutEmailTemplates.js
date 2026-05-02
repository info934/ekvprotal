const PORTAL_URL = 'https://ekvgroup.cz/payouts';

const baseTemplate = (title, content) => `
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background-color: #1e3a8a; color: #fff; padding: 20px; text-align: center; }
    .content { padding: 30px; }
    .footer { background-color: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .btn { display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
    table { widdth: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background-color: #f8fafc; font-weight: 600; width: 40%; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0;">${title}</h2>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} EKV Group. Všechna práva vyhrazena.<br>
      Tento email byl generován automaticky.
    </div>
  </div>
</body>
</html>
`;

export const templates = {
  request_created: (data) => baseTemplate(
    'Nová žádost o výplatu',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše žádost o výplatu byla úspěšně přijata a čeká na schválení administrátorem.</p>
      <table>
        <tr><th>Částka</th><td><strong>${data.amount.toLocaleString('cs-CZ')} Kč</strong></td></tr>
        <tr><th>Stav</th><td>Čeká na schválení</td></tr>
        <tr><th>Datum</th><td>${new Date().toLocaleDateString('cs-CZ')}</td></tr>
      </table>
      <a href="${PORTAL_URL}" class="btn">Zobrazit žádost v portálu</a>
    `
  ),
  approved: (data) => baseTemplate(
    'Žádost o výplatu schválena',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše žádost o výplatu ve výši <strong>${data.amount.toLocaleString('cs-CZ')} Kč</strong> byla schválena.</p>
      ${!data.approved_without_invoice ? '<p>Nyní prosím nahrajte fakturu do systému, abychom mohli provést platbu.</p>' : '<p>Žádost byla schválena k vyplacení bez nutnosti faktury.</p>'}
      <a href="${PORTAL_URL}" class="btn">Přejít do portálu</a>
    `
  ),
  rejected: (data) => baseTemplate(
    'Žádost o výplatu zamítnuta',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše žádost o výplatu ve výši <strong>${data.amount.toLocaleString('cs-CZ')} Kč</strong> byla zamítnuta.</p>
      ${data.reason ? `<p><strong>Důvod:</strong> ${data.reason}</p>` : ''}
      <p>Pro více informací se prosím přihlaste do portálu.</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit detaily</a>
    `
  ),
  invoice_uploaded: (data) => baseTemplate(
    'Faktura úspěšně nahrána',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše faktura k žádosti o výplatu (${data.amount.toLocaleString('cs-CZ')} Kč) byla úspěšně nahrána do systému.</p>
      <p>Platba bude brzy zpracována.</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit v portálu</a>
    `
  ),
  paid: (data) => baseTemplate(
    'Výplata odeslána',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše výplata ve výši <strong>${data.amount.toLocaleString('cs-CZ')} Kč</strong> byla odeslána na váš účet.</p>
      <p>Děkujeme za spolupráci!</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit historii výplat</a>
    `
  ),
  completed: (data) => baseTemplate(
    'Výplata dokončena',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Proces vaší výplaty (${data.amount.toLocaleString('cs-CZ')} Kč) byl kompletně uzavřen.</p>
      <a href="${PORTAL_URL}" class="btn">Přejít do portálu</a>
    `
  ),
  admin_notification: (data) => baseTemplate(
    `Nová akce u výplaty: ${data.action}`,
    `
      <p>Dobrý den administrátore,</p>
      <p>Byla zaznamenána nová aktivita v modulu výplat.</p>
      <table>
        <tr><th>Akce</th><td>${data.action}</td></tr>
        <tr><th>Pracovník</th><td>${data.memberName}</td></tr>
        <tr><th>Částka</th><td><strong>${data.amount.toLocaleString('cs-CZ')} Kč</strong></td></tr>
      </table>
      <a href="${PORTAL_URL}" class="btn">Přejít do administrace</a>
    `
  )
};