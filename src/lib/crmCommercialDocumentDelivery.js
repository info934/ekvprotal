import { supabase } from '@/lib/customSupabaseClient';

export const parseCommercialDocumentRecipients = (value) => Array.from(new Set(
  String(value || '').split(/[;,\n]/).map((email) => email.trim().toLowerCase()).filter(Boolean),
));

export const isValidCommercialDocumentRecipients = (recipients) => (
  recipients.length > 0 && recipients.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
);

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

export const commercialDocumentEmailDefaults = (document) => {
  const label = document?.type === 'order' ? 'objednávku' : 'nabídku';
  const number = document?.number || '';
  const project = document?.opportunity?.project?.name || document?.opportunity?.title || document?.title || '';
  return {
    recipients: document?.subject?.email || document?.opportunity?.subject?.email || '',
    ccRecipients: '',
    subject: `${document?.type === 'order' ? 'Objednávka' : 'Nabídka'} ${number} - ${project}`.trim(),
    message: `Dobrý den,\n\nv příloze zasíláme ${label} ${number}${project ? ` k projektu ${project}` : ''}.\n\nProsíme o kontrolu. V případě nabídky ji můžete potvrdit pomocí bezpečného odkazu v e-mailu.\n\nS pozdravem\nEKV Project`,
  };
};

export const buildCommercialGenerationInput = (document, template = null) => ({
  document,
  opportunity: {
    ...document?.opportunity,
    subject: document?.subject || document?.opportunity?.subject,
  },
  template,
});

export const previewCommercialDocumentPdf = async ({ document, template }) => {
  const previewWindow = window.open('', '_blank');
  if (previewWindow) {
    previewWindow.document.title = 'Připravuji náhled PDF';
    previewWindow.document.body.innerHTML = '<p style="font-family:Arial,sans-serif;padding:24px">Připravuji náhled PDF...</p>';
  }
  const { buildDocumentGenerationPayload, createCommercialDocumentPdf } = await import('@/lib/documentGenerationService');
  const payload = buildDocumentGenerationPayload(buildCommercialGenerationInput(document, template));
  const pdf = await createCommercialDocumentPdf(payload, template);
  const url = URL.createObjectURL(pdf.output('blob'));
  if (previewWindow) previewWindow.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export const sendCommercialDocument = async ({
  document,
  template,
  recipients,
  ccRecipients,
  subject,
  message,
  customRecipientConfirmed,
}) => {
  const normalizedRecipients = parseCommercialDocumentRecipients(recipients);
  const normalizedCc = parseCommercialDocumentRecipients(ccRecipients);
  if (!isValidCommercialDocumentRecipients(normalizedRecipients)) throw new Error('Zadejte alespoň jednu platnou adresu příjemce.');
  if (normalizedCc.length && !isValidCommercialDocumentRecipients(normalizedCc)) throw new Error('Zkontrolujte adresy v kopii.');

  const { buildDocumentGenerationPayload, createCommercialDocumentPdf } = await import('@/lib/documentGenerationService');
  const payload = buildDocumentGenerationPayload(buildCommercialGenerationInput(document, template));
  const pdf = await createCommercialDocumentPdf(payload, template);
  const pdfBase64 = pdf.output('datauristring').split(',')[1];
  const messageHtml = escapeHtml(message).replace(/\n/g, '<br>');
  const idempotencyKey = crypto.randomUUID();
  const { data, error } = await supabase.functions.invoke('send-crm-commercial-document', {
    body: {
      documentId: document.id,
      idempotencyKey,
      recipients: normalizedRecipients,
      ccRecipients: normalizedCc,
      subject: subject.trim(),
      messageHtml,
      pdfBase64,
      snapshot: payload,
      templateId: template?.id || null,
      customRecipientConfirmed,
    },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Odeslání se nepodařilo.');
  return data;
};

export const fetchCommercialDocumentHistory = async (documentId, opportunityId) => {
  const [versionsResult, deliveriesResult, eventsResult, activitiesResult, notesResult] = await Promise.all([
    supabase.from('crm_commercial_document_versions').select('*').eq('document_id', documentId).order('version_number', { ascending: false }),
    supabase.from('crm_commercial_document_deliveries').select('*').eq('document_id', documentId).order('created_at', { ascending: false }),
    supabase.from('crm_commercial_document_events').select('*').eq('document_id', documentId).order('created_at', { ascending: false }),
    opportunityId ? supabase.from('crm_activities').select('id, type, status, title, description, due_at, completed_at, created_at').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    opportunityId ? supabase.from('crm_notes').select('id, body, created_at, author_member_id').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
  ]);
  const error = versionsResult.error || deliveriesResult.error || eventsResult.error || activitiesResult.error || notesResult.error;
  if (error) throw error;
  return {
    versions: versionsResult.data || [],
    deliveries: deliveriesResult.data || [],
    events: eventsResult.data || [],
    activities: activitiesResult.data || [],
    notes: notesResult.data || [],
  };
};

export const downloadCommercialDocumentVersion = async (version) => {
  const { data, error } = await supabase.storage.from('crm-commercial-documents').download(version.storage_path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = version.file_name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const compareCommercialDocumentVersions = (newer, older) => {
  const next = newer?.snapshot || {};
  const previous = older?.snapshot || {};
  const nextItems = Array.isArray(next.items) ? next.items : [];
  const previousItems = Array.isArray(previous.items) ? previous.items : [];
  const key = (item) => item.code || item.name;
  const previousByKey = new Map(previousItems.map((item) => [key(item), item]));
  const nextKeys = new Set(nextItems.map(key));
  return {
    totalDelta: Number(next.document?.totalWithTax || 0) - Number(previous.document?.totalWithTax || 0),
    added: nextItems.filter((item) => !previousByKey.has(key(item))).length,
    removed: previousItems.filter((item) => !nextKeys.has(key(item))).length,
    changed: nextItems.filter((item) => {
      const before = previousByKey.get(key(item));
      return before && (Number(before.quantity) !== Number(item.quantity) || Number(before.unitPrice) !== Number(item.unitPrice) || Number(before.discountPercent) !== Number(item.discountPercent));
    }).length,
  };
};
