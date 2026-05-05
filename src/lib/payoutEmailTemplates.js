import { createPayoutEmailShell } from './payoutEmailShell';

const PORTAL_URL = 'https://ekvgroup.cz/payouts';

const formatAmount = (amount = 0) => amount.toLocaleString('cs-CZ');

const baseTemplate = (title, content) => createPayoutEmailShell(title, content);

export const templates = {
  request_created: (data) => baseTemplate(
    'Nová žádost o výplatu',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše žádost o výplatu byla úspěšně přijata a čeká na schválení administrátorem.</p>
      <table>
        <tr><th>Částka</th><td><strong>${formatAmount(data.amount)} Kč</strong></td></tr>
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
      <p>Vaše žádost o výplatu ve výši <strong>${formatAmount(data.amount)} Kč</strong> byla schválena.</p>
      ${!data.approved_without_invoice ? '<p>Nyní prosím nahrajte fakturu do systému, abychom mohli provést platbu.</p>' : '<p>Žádost byla schválena k vyplacení bez nutnosti faktury.</p>'}
      <a href="${PORTAL_URL}" class="btn">Přejít do portálu</a>
    `
  ),
  rejected: (data) => baseTemplate(
    'Žádost o výplatu zamítnuta',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše žádost o výplatu ve výši <strong>${formatAmount(data.amount)} Kč</strong> byla zamítnuta.</p>
      ${data.reason ? `<p><strong>Důvod:</strong> ${data.reason}</p>` : ''}
      <p>Pro více informací se prosím přihlaste do portálu.</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit detaily</a>
    `
  ),
  invoice_uploaded: (data) => baseTemplate(
    'Faktura úspěšně nahrána',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše faktura k žádosti o výplatu (<strong>${formatAmount(data.amount)} Kč</strong>) byla úspěšně nahrána do systému.</p>
      <p>Platba bude brzy zpracována.</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit v portálu</a>
    `
  ),
  paid: (data) => baseTemplate(
    'Výplata odeslána',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Vaše výplata ve výši <strong>${formatAmount(data.amount)} Kč</strong> byla odeslána na váš účet.</p>
      <p>Děkujeme za spolupráci.</p>
      <a href="${PORTAL_URL}" class="btn">Zobrazit historii výplat</a>
    `
  ),
  completed: (data) => baseTemplate(
    'Výplata dokončena',
    `
      <p>Dobrý den, ${data.memberName},</p>
      <p>Proces vaší výplaty (<strong>${formatAmount(data.amount)} Kč</strong>) byl kompletně uzavřen.</p>
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
        <tr><th>Částka</th><td><strong>${formatAmount(data.amount)} Kč</strong></td></tr>
      </table>
      <a href="${PORTAL_URL}" class="btn">Přejít do administrace</a>
    `
  )
};
