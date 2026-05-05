/**
 * PAYOUT WORKFLOW EMAIL SERVICE
 * 
 * Complete email notification system for payout workflow
 * All functions include error handling, logging, and proper email templates
 */

import { supabase } from '@/lib/customSupabaseClient';

const invokeEmailFunction = async (functionName, body) => {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || `Edge funkce ${functionName} vrátila chybu.`);
  return data;
};

/**
 * Creates HTML email template
 */
const createEmailTemplate = (subject, content) => {
  return `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="margin:0; padding:0; background:#eef2f7; font-family:Arial, Helvetica, sans-serif; color:#111827;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${subject}</div>
      <div style="width:100%; padding:32px 12px;">
        <div style="max-width:640px; margin:0 auto;">
          <div style="padding:0 4px 12px 4px; color:#64748b; font-size:13px; letter-spacing:.04em; text-transform:uppercase; font-weight:700;">
            EKV Portal
          </div>
          <div style="background:#ffffff; border:1px solid #dbe3ee; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(15,23,42,.10);">
            <div style="background:#0f172a; padding:28px 30px;">
              <div style="display:inline-block; padding:6px 10px; border-radius:999px; background:#1e293b; color:#cbd5e1; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;">Výplaty</div>
              <h1 style="margin:14px 0 0 0; color:#ffffff; font-size:26px; line-height:1.25; font-weight:800;">${subject}</h1>
            </div>
            <div style="padding:30px;">
              ${content}
            </div>
            <div style="background:#f8fafc; padding:20px 30px; border-top:1px solid #e2e8f0;">
              <p style="margin:0; color:#64748b; font-size:12px; line-height:1.6;">
                Tento e-mail byl odeslán automaticky systémem EKV Portal. Na tuto zprávu není potřeba odpovídat.
              </p>
            </div>
          </div>
          <div style="padding:16px 4px 0 4px; color:#94a3b8; font-size:12px; text-align:center;">
            EKV Group
          </div>
        </div>
      </div> 
    </body>
    </html>
  `;
};

/**
 * FUNCTION 1: Send notification when payout is created
 * Sends to: Admin (notification of new request)
 */
export const sendPayoutCreatedEmail = async (payout) => {
  try {
    console.log('[PayoutEmail] Sending payout created notification:', {
      payoutId: payout?.id,
      memberId: payout?.member_id,
      amount: payout?.amount,
      timestamp: new Date().toISOString()
    });

    if (!payout || !payout.id) {
      console.error('[PayoutEmail] Invalid payout object provided');
      return { success: false, error: 'Invalid payout object' };
    }

    // Fetch member details using explicit foreign key
    const { data: payoutData, error: fetchError } = await supabase
      .from('payouts')
      .select('*, members:members!payouts_member_id_fkey(name, email)')
      .eq('id', payout.id)
      .single();

    if (fetchError) {
      console.error('[PayoutEmail] Error fetching payout details:', fetchError);
      throw fetchError;
    }

    const memberEmail = payoutData?.members?.email;
    const memberName = payoutData?.members?.name || 'Neznámý pracovník';
    const amount = payout.amount || 0;

    const subject = `[Nová žádost] Výplata - ${memberName}`;
    
    const content = `
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Dobrý den,
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Byla vytvořena nová žádost o výplatu od člena týmu <strong>${memberName}</strong>.
      </p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 24px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Člen týmu:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${memberName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Částka:</td>
            <td style="padding: 8px 0; color: #10b981; font-size: 14px; font-weight: 600; text-align: right;">${amount.toLocaleString('cs-CZ')} Kč</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">ID žádosti:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace; text-align: right;">${payout.id}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Datum:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${new Date(payout.request_date).toLocaleDateString('cs-CZ')}</td>
          </tr>
        </table>
      </div>
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #1e40af; font-weight: 600;">
          ℹ️ Akce vyžadována
        </p>
        <p style="margin: 8px 0 0 0; color: #1d4ed8; font-size: 14px;">
          Zkontrolujte žádost a schvalte ji v administračním panelu.
        </p>
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${window.location.origin}/payouts" style="display: inline-block; background: #3b82f6; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
          Přejít do administrace výplat
        </a>
      </div>
    `;
    
    const htmlContent = createEmailTemplate(subject, content);
    
    const adminData = await invokeEmailFunction('send-admin-payout-notification', { subject, htmlContent });

    let memberData = null;
    if (memberEmail) {
      const memberSubject = 'Žádost o výplatu přijata';
      const memberContent = `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Dobrý den <strong>${memberName}</strong>,
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Vaše žádost o výplatu ve výši <strong style="color: #10b981;">${amount.toLocaleString('cs-CZ')} Kč</strong> byla přijata a čeká na schválení.
        </p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Stav:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">Čeká na schválení</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Částka:</td>
              <td style="padding: 8px 0; color: #10b981; font-size: 14px; font-weight: 600; text-align: right;">${amount.toLocaleString('cs-CZ')} Kč</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">ID žádosti:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace; text-align: right;">${payout.id}</td>
            </tr>
          </table>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
          Jakmile bude žádost schválena, přijde vám další e-mail s instrukcemi k nahrání faktury.
        </p>
      `;
      memberData = await invokeEmailFunction('send-payout-email', {
        to: memberEmail,
        subject: memberSubject,
        htmlContent: createEmailTemplate(memberSubject, memberContent),
      });
    }
    
    console.log('[PayoutEmail] Payout created notification sent successfully:', {
      payoutId: payout.id,
      adminResponse: adminData,
      memberResponse: memberData
    });

    if (!memberEmail) {
      return {
        success: false,
        error: 'Zaměstnanec nemá vyplněný email, potvrzení žádosti nebylo komu odeslat.',
        data: { admin: adminData, member: null }
      };
    }
    
    return { success: true, data: { admin: adminData, member: memberData } };
    
  } catch (error) {
    console.error('[PayoutEmail] sendPayoutCreatedEmail error:', {
      payoutId: payout?.id,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
};

/**
 * FUNCTION 2: Send approval notification to member
 * Sends to: User (their request was approved)
 */
export const sendPayoutApprovedEmail = async (payout) => {
  try {
    console.log('[PayoutEmail] Sending approval notification:', {
      payoutId: payout?.id,
      amount: payout?.amount,
      approvedWithoutInvoice: payout?.approved_without_invoice,
      timestamp: new Date().toISOString()
    });

    if (!payout || !payout.id) {
      console.error('[PayoutEmail] Invalid payout object provided');
      return { success: false, error: 'Invalid payout object' };
    }

    // Fetch member details using explicit foreign key
    const { data: payoutData, error: fetchError } = await supabase
      .from('payouts')
      .select('*, members:members!payouts_member_id_fkey(name, email)')
      .eq('id', payout.id)
      .single();

    if (fetchError) {
      console.error('[PayoutEmail] Error fetching payout details:', fetchError);
      throw fetchError;
    }

    const memberEmail = payoutData?.members?.email;
    const memberName = payoutData?.members?.name || 'Pracovník';
    const amount = payout.amount || 0;
    const approvedWithoutInvoice = payout.approved_without_invoice || false;

    if (!memberEmail) {
      console.warn('[PayoutEmail] No email found for member');
      return { success: false, error: 'Member email not found' };
    }
    
    const subject = 'Žádost o výplatu schválena';
    
    const content = approvedWithoutInvoice ? `
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Dobrý den <strong>${memberName}</strong>,
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Vaše žádost o výplatu ve výši <strong style="color: #10b981;">${amount.toLocaleString('cs-CZ')} Kč</strong> byla úspěšně schválena.
      </p>
      <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #065f46; font-weight: 600;">
          ✓ Schváleno bez nutnosti faktury
        </p>
        <p style="margin: 8px 0 0 0; color: #047857; font-size: 14px;">
          Výplata bude zpracována administrátorem bez nutnosti doložení faktury.
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
        Budete informováni emailem, jakmile bude výplata odeslána na váš účet.
      </p>
    ` : `
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Dobrý den <strong>${memberName}</strong>,
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Vaše žádost o výplatu ve výši <strong style="color: #10b981;">${amount.toLocaleString('cs-CZ')} Kč</strong> byla úspěšně schválena.
      </p>
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #92400e; font-weight: 600;">
          ⚠ Vyžadována faktura
        </p>
        <p style="margin: 8px 0 0 0; color: #b45309; font-size: 14px;">
          Pro dokončení výplaty je nutné nahrát fakturu v systému.
        </p>
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${window.location.origin}/payouts" style="display: inline-block; background: #667eea; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
          Nahrát fakturu v systému
        </a>
      </div>
      <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
        Po nahrání faktury bude výplata zpracována administrátorem.
      </p>
    `;
    
    const htmlContent = createEmailTemplate(subject, content);
    
    const data = await invokeEmailFunction('send-payout-email', { to: memberEmail, subject, htmlContent });
    
    console.log('[PayoutEmail] Approval notification sent successfully:', {
      payoutId: payout.id,
      recipientEmail: memberEmail,
      response: data
    });
    
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutEmail] sendPayoutApprovedEmail error:', {
      payoutId: payout?.id,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
};

/**
 * FUNCTION 3: Send invoice uploaded notification to admin
 * Sends to: Admin (invoice needs review)
 */
export const sendInvoiceUploadedNotification = async (payout) => {
  try {
    console.log('[PayoutEmail] Sending invoice uploaded notification:', {
      payoutId: payout?.id,
      invoiceUrl: payout?.invoice_url,
      invoiceName: payout?.invoice_name,
      timestamp: new Date().toISOString()
    });

    if (!payout || !payout.id) {
      console.error('[PayoutEmail] Invalid payout object provided');
      return { success: false, error: 'Invalid payout object' };
    }

    // Fetch member details using explicit foreign key
    const { data: payoutData, error: fetchError } = await supabase
      .from('payouts')
      .select('*, members:members!payouts_member_id_fkey(name, email)')
      .eq('id', payout.id)
      .single();

    if (fetchError) {
      console.error('[PayoutEmail] Error fetching payout details:', fetchError);
      throw fetchError;
    }

    const memberName = payoutData?.members?.name || 'Neznámý pracovník';
    const amount = payout.amount || 0;
    const invoiceName = payout.invoice_name || 'invoice.pdf';
    const uploadDate = payout.invoice_uploaded_at 
      ? new Date(payout.invoice_uploaded_at).toLocaleDateString('cs-CZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : new Date().toLocaleDateString('cs-CZ', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
    
    const subject = `[Faktura nahrána] Výplata - ${memberName}`;
    
    const content = `
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Dobrý den,
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Člen týmu <strong>${memberName}</strong> nahrál fakturu k žádosti o výplatu.
      </p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 24px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Člen týmu:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${memberName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Částka:</td>
            <td style="padding: 8px 0; color: #10b981; font-size: 14px; font-weight: 600; text-align: right;">${amount.toLocaleString('cs-CZ')} Kč</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">ID žádosti:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace; text-align: right;">${payout.id}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Název faktury:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${invoiceName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Datum nahrání:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${uploadDate}</td>
          </tr>
        </table>
      </div>
      <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #065f46; font-weight: 600;">
          ✓ Faktura přijata
        </p>
        <p style="margin: 8px 0 0 0; color: #047857; font-size: 14px;">
          Faktura čeká na vaše potvrzení. Po kontrole můžete označit výplatu jako dokončenou.
        </p>
      </div>
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="margin: 0; color: #1e40af; font-weight: 600;">
          ℹ️ Další kroky
        </p>
        <p style="margin: 8px 0 0 0; color: #1d4ed8; font-size: 14px;">
          1. Zkontrolujte nahranou fakturu v administračním panelu<br>
          2. Ověřte částku a údaje na faktuře<br>
          3. Potvrďte výplatu nebo kontaktujte člena týmu v případě nesrovnalostí
        </p>
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${window.location.origin}/payouts" style="display: inline-block; background: #3b82f6; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
          Zkontrolovat fakturu a potvrdit výplatu
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; line-height: 1.6; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <strong>Poznámka pro administrátora:</strong> Doporučujeme zkontrolovat fakturu do 2-3 pracovních dnů od nahrání.
      </p>
    `;
    
    const htmlContent = createEmailTemplate(subject, content);
    
    const data = await invokeEmailFunction('send-admin-payout-notification', { subject, htmlContent });
    
    console.log('[PayoutEmail] Invoice uploaded notification sent successfully:', {
      payoutId: payout.id,
      invoiceName,
      response: data
    });
    
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutEmail] sendInvoiceUploadedNotification error:', {
      payoutId: payout?.id,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
};

/**
 * FUNCTION 4: Send payment processed notification to member
 * Sends to: User (payment confirmed)
 */
export const sendPayoutPaidEmail = async (payout) => {
  try {
    console.log('[PayoutEmail] Sending payment processed notification:', {
      payoutId: payout?.id,
      amount: payout?.amount,
      paidAt: payout?.paid_at,
      timestamp: new Date().toISOString()
    });

    if (!payout || !payout.id) {
      console.error('[PayoutEmail] Invalid payout object provided');
      return { success: false, error: 'Invalid payout object' };
    }

    // Fetch member details using explicit foreign key
    const { data: payoutData, error: fetchError } = await supabase
      .from('payouts')
      .select('*, members:members!payouts_member_id_fkey(name, email)')
      .eq('id', payout.id)
      .single();

    if (fetchError) {
      console.error('[PayoutEmail] Error fetching payout details:', fetchError);
      throw fetchError;
    }

    const memberEmail = payoutData?.members?.email;
    const memberName = payoutData?.members?.name || 'Pracovník';
    const amount = payout.amount || 0;
    const paidAt = payout.paid_at || new Date().toISOString();

    if (!memberEmail) {
      console.warn('[PayoutEmail] No email found for member');
      return { success: false, error: 'Member email not found' };
    }
    
    const subject = 'Výplata zpracována';
    
    const paidDate = new Date(paidAt).toLocaleDateString('cs-CZ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const content = `
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Dobrý den <strong>${memberName}</strong>,
      </p>
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Máme radost, že vám můžeme oznámit, že vaše výplata byla úspěšně zpracována.
      </p>
      <div style="background: #f0fdf4; border: 2px solid #10b981; padding: 24px; border-radius: 8px; margin: 24px 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">✓</div>
        <p style="margin: 0; color: #047857; font-size: 18px; font-weight: 600;">
          Výplata odeslána
        </p>
        <p style="margin: 16px 0 0 0; color: #10b981; font-size: 32px; font-weight: 700;">
          ${amount.toLocaleString('cs-CZ')} Kč
        </p>
      </div>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 24px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Datum zpracování:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600; text-align: right;">${paidDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Částka:</td>
            <td style="padding: 8px 0; color: #10b981; font-size: 14px; font-weight: 600; text-align: right;">${amount.toLocaleString('cs-CZ')} Kč</td>
          </tr>
        </table>
      </div>
      <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
        Peníze by měly dorazit na váš účet během 1-3 pracovních dnů v závislosti na vaší bance.
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${window.location.origin}/payouts" style="display: inline-block; background: #667eea; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
          Zobrazit historii výplat
        </a>
      </div>
    `;
    
    const htmlContent = createEmailTemplate(subject, content);
    
    const data = await invokeEmailFunction('send-payout-email', { to: memberEmail, subject, htmlContent });
    
    console.log('[PayoutEmail] Payment processed notification sent successfully:', {
      payoutId: payout.id,
      recipientEmail: memberEmail,
      response: data
    });
    
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutEmail] sendPayoutPaidEmail error:', {
      payoutId: payout?.id,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
};

/**
 * Test function for debugging - can be called from browser console
 * Usage: window.testPayoutEmail('created', 'payout-id-here')
 */
export const testPayoutEmail = async (emailType, payoutId) => {
  try {
    console.log('[PayoutEmail] Testing email:', { emailType, payoutId });
    
    // Fetch payout with explicit foreign key
    const { data: payout, error } = await supabase
      .from('payouts')
      .select('*, members:members!payouts_member_id_fkey(name, email)')
      .eq('id', payoutId)
      .single();
    
    if (error) throw error;
    
    let result;
    switch (emailType) {
      case 'created':
        result = await sendPayoutCreatedEmail(payout);
        break;
      case 'approved':
        result = await sendPayoutApprovedEmail(payout);
        break;
      case 'invoice':
        result = await sendInvoiceUploadedNotification(payout);
        break;
      case 'paid':
        result = await sendPayoutPaidEmail(payout);
        break;
      default:
        throw new Error('Invalid email type. Use: created, approved, invoice, or paid');
    }
    
    console.log('[PayoutEmail] Test result:', result);
    return result;
    
  } catch (error) {
    console.error('[PayoutEmail] Test failed:', error);
    return { success: false, error: error.message };
  }
};

// Expose test function globally for console access
if (typeof window !== 'undefined') {
  window.testPayoutEmail = testPayoutEmail;
}
