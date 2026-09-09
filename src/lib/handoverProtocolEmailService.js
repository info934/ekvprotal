import { sendEmail } from '@/lib/email';
import { handoverProtocolTypeLabels } from '@/lib/handoverProtocolService';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const parseEmailRecipients = (value) => String(value || '')
  .split(/[;,\n]/)
  .map((email) => email.trim())
  .filter(Boolean);

export const validateEmailRecipients = (recipients) => recipients.length > 0 && recipients.every((email) => emailRegex.test(email));

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
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
    .replace(/\s+/g, '_') + '.pdf';
};

export const buildHandoverProtocolEmailDefaults = async (protocol) => {
  const { buildHandoverProtocolPayload } = await import('@/lib/documentGenerationService');
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

  const {
    buildHandoverProtocolPayload,
    createHandoverProtocolPdfBlob,
  } = await import('@/lib/documentGenerationService');
  const payload = buildHandoverProtocolPayload({ protocol });
  const { blob } = await createHandoverProtocolPdfBlob({ protocol, template });
  const attachmentName = buildAttachmentName(payload);
  const defaults = await buildHandoverProtocolEmailDefaults(protocol);

  const result = await sendEmail({
    to: normalizedRecipients.join(','),
    subject: subject || defaults.subject,
    greeting: 'Dobrý den,',
    content: message || defaults.message,
    salutation: salutation || 'S pozdravem,<br>EKV Project',
    attachments: [{
      filename: attachmentName,
      content: await toBase64(blob),
    }],
  });

  if (result.error) throw result.error;
  return { ...result, recipients: normalizedRecipients, attachmentName };
};
