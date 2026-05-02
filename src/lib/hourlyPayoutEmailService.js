import { sendEmail } from '@/lib/email';

export const sendHourlyApprovalEmail = async (request, memberEmail) => {
  const subject = `Schválení žádosti o vyplacení hodinové mzdy`;
  const greeting = `Dobrý den,`;
  const content = `
    <p>Vaše žádost o vyplacení hodinové mzdy byla úspěšně <strong>schválena</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; background-color: #f9fafb; font-weight: bold;">Projekt</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${request.projects?.name || 'Všechny projekty'}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; background-color: #f9fafb; font-weight: bold;">Odpracované hodiny</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${request.hours} h</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; background-color: #f9fafb; font-weight: bold;">Celková částka</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; color: #10b981; font-weight: bold;">${Number(request.total_amount).toLocaleString('cs-CZ')} Kč</td>
      </tr>
    </table>
    <p>Nyní můžete vystavit a nahrát fakturu na tuto částku do systému.</p>
  `;
  const salutation = `S pozdravem,<br>Tým EKV Group`;

  return sendEmail({
    to: memberEmail,
    subject,
    greeting,
    content,
    salutation
  });
};

export const sendHourlyRejectionEmail = async (request, memberEmail, rejectionReason) => {
  const subject = `Zamítnutí žádosti o vyplacení hodinové mzdy`;
  const greeting = `Dobrý den,`;
  const content = `
    <p>Vaše žádost o vyplacení hodinové mzdy ze dne ${new Date(request.created_at).toLocaleDateString('cs-CZ')} byla <strong>zamítnuta</strong>.</p>
    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #991b1b; font-size: 16px;">Důvod zamítnutí:</h3>
      <p style="margin-bottom: 0; color: #7f1d1d;">${rejectionReason || 'Důvod nebyl uveden.'}</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px;">
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; background-color: #f9fafb; font-weight: bold;">Projekt</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${request.projects?.name || 'Všechny projekty'}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb; background-color: #f9fafb; font-weight: bold;">Požadovaná částka</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${Number(request.total_amount).toLocaleString('cs-CZ')} Kč</td>
      </tr>
    </table>
    <p>Pro více informací nebo pro řešení tohoto stavu prosím kontaktujte administrátora.</p>
  `;
  const salutation = `S pozdravem,<br>Tým EKV Group`;

  return sendEmail({
    to: memberEmail,
    subject,
    greeting,
    content,
    salutation
  });
};