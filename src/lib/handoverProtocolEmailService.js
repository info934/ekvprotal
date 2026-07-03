import { sendEmail } from '@/lib/email';
import {
  buildHandoverProtocolPayload,
  renderHandoverProtocolHtml,
} from '@/lib/documentGenerationService';
import { handoverProtocolTypeLabels } from '@/lib/handoverProtocolService';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const parseEmailRecipients = (value) => String(value || '')
  .split(/[;,\n]/)
  .map((email) => email.trim())
  .filter(Boolean);

export const validateEmailRecipients = (recipients) => recipients.length > 0 && recipients.every((email) => emailRegex.test(email));

const toBase64Utf8 = (value) => {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
};

const buildAttachmentName = (payload) => {
  const label = payload.document.label || 'Protokol';
  const number = payload.document.number || payload.document.id || 'bez-cisla';
  return `${label} ${number}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .trim()
    .replace(/\s+/g, '_') + '.html';
};

export const buildHandoverProtocolEmailDefaults = (protocol) => {
  const payload = buildHandoverProtocolPayload({ protocol });
  const documentLabel = handoverProtocolTypeLabels[protocol?.document_type] || payload.document.label || 'Dokument';
  const recipients = [payload.client.email].filter(Boolean).join(', ');
  const projectPart = payload.project.name ? ` k projektu <strong>${payload.project.name}</strong>` : '';
  return {
    recipients,
    subject: `${documentLabel} ${payload.document.number || ''}`.trim(),
    message: `Dobrý den,<br><br>v příloze zasíláme dokument <strong>${documentLabel} ${payload.document.number || ''}</strong>${projectPart}.<br><br>Prosíme o kontrolu a případné potvrzení.`,
  };
};

export const sendHandoverProtocolEmail = async ({ protocol, template, recipients, subject, message, salutation }) => {
  const normalizedRecipients = Array.isArray(recipients) ? recipients : parseEmailRecipients(recipients);
  if (!validateEmailRecipients(normalizedRecipients)) {
    throw new Error('Zadejte alespoň jednu platnou e-mailovou adresu.');
  }

  const payload = buildHandoverProtocolPayload({ protocol });
  const html = renderHandoverProtocolHtml(payload, template);
  const attachmentName = buildAttachmentName(payload);

  const result = await sendEmail({
    to: normalizedRecipients.join(','),
    subject: subject || buildHandoverProtocolEmailDefaults(protocol).subject,
    greeting: 'Dobrý den,',
    content: message || buildHandoverProtocolEmailDefaults(protocol).message,
    salutation: salutation || 'S pozdravem,<br>EKV Project',
    attachments: [{
      filename: attachmentName,
      content: toBase64Utf8(html),
    }],
  });

  if (result.error) throw result.error;
  return { ...result, recipients: normalizedRecipients, attachmentName };
};
