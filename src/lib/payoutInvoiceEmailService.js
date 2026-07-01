import { supabase } from '@/lib/customSupabaseClient';
import { sendEmail } from '@/lib/email';

export const DEFAULT_INVOICE_FORWARD_EMAIL = 'ekvfaktury@kvfinance.cz';

const parseInvoiceStoragePath = (invoiceUrl) => {
  if (!invoiceUrl) return null;

  let filePath = String(invoiceUrl).trim();
  let bucket = 'invoices';

  if (filePath.includes('/storage/v1/object/public/')) {
    filePath = filePath.split('/storage/v1/object/public/')[1];
  } else if (filePath.includes('/storage/v1/object/sign/')) {
    filePath = filePath.split('/storage/v1/object/sign/')[1];
  }

  filePath = filePath.split('?')[0].replace(/^\/+/, '');

  if (filePath.startsWith('invoices/')) {
    filePath = filePath.replace(/^invoices\//, '');
    bucket = 'invoices';
  }

  if (!filePath) return null;
  return { bucket, filePath };
};

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const createInvoiceLink = async (invoiceUrl) => {
  const parsed = parseInvoiceStoragePath(invoiceUrl);
  if (!parsed) {
    throw new Error('Výplata nemá platnou cestu k faktuře.');
  }

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.filePath, 60 * 60 * 24 * 14);

  if (error) throw error;

  return {
    url: data?.signedUrl,
    fileName: parsed.filePath.split('/').pop() || 'faktura',
  };
};

export const sendPayoutInvoiceForwardEmail = async ({ payout, to, type = 'task' }) => {
  const recipient = String(to || '').trim();
  if (!recipient) {
    return { success: false, error: 'Zadejte email příjemce.' };
  }

  if (!payout?.invoice_url) {
    return { success: false, error: 'U výplaty není nahraná faktura.' };
  }

  try {
    const invoice = await createInvoiceLink(payout.invoice_url);
    const memberName = payout.members?.name || payout.member_name || 'Pracovník';
    const amount = payout.amount ?? payout.total_amount ?? 0;
    const requestCode = payout.variable_symbol || payout.id;
    const payoutType = type === 'hourly' ? 'hodinové výplatě' : 'úkolové výplatě';

    const { error } = await sendEmail({
      to: recipient,
      subject: `Faktura k ${payoutType} ${requestCode}`,
      greeting: 'Dobrý den,',
      content: `
        <p>Posíláme fakturu k uzavřené ${payoutType}.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 12px;color:#64748b;">Pracovník</td><td style="padding:10px 12px;font-weight:700;text-align:right;">${memberName}</td></tr>
          <tr><td style="padding:10px 12px;color:#64748b;">Částka</td><td style="padding:10px 12px;font-weight:700;text-align:right;">${formatCurrency(amount)}</td></tr>
          <tr><td style="padding:10px 12px;color:#64748b;">Soubor</td><td style="padding:10px 12px;font-weight:700;text-align:right;">${invoice.fileName}</td></tr>
        </table>
        <p>Odkaz na stažení faktury je platný 14 dní.</p>
      `,
      cta: invoice.url ? { text: 'Stáhnout fakturu', url: invoice.url } : null,
      salutation: 'EKVPortal',
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[sendPayoutInvoiceForwardEmail] Failed:', error);
    return { success: false, error: error.message || 'Email s fakturou se nepodařilo odeslat.' };
  }
};
