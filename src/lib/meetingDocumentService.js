import { supabase } from '@/lib/customSupabaseClient';
import { createStyledPdfBlobFromHtml } from '@/lib/documentGenerationService';
import { uploadGeneratedEntityDocument } from '@/lib/documentStorageService';
import { meetingPrintHtml } from '@/lib/meetingPrint';

const safePart = (value, fallback = 'zapis') => String(value || fallback)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 70) || fallback;

export const meetingDocumentFolder = (entityType) => entityType === 'realization'
  ? '03_Harmonogram_a_KD/01_Zapisy_KD'
  : '02_Dokumentace/03_Zapisy_KD';

export const meetingDocumentFileName = (note, entityCode = '') => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(note?.meeting_date || '') ? note.meeting_date : new Date().toLocaleDateString('sv-SE');
  return `${date}_Zapis-KD_${safePart(entityCode, 'zakazka')}_${safePart(note?.title)}_v${Number(note?.version || 1)}.pdf`;
};

const blobToBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

export const saveMeetingNotePdf = async ({ note, entityType, entityId, entityTitle, entityCode }) => {
  const html = meetingPrintHtml(note, { entityTitle, entityType, entityCode });
  const blob = await createStyledPdfBlobFromHtml(html);
  const fileName = meetingDocumentFileName(note, entityCode);
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const stored = await uploadGeneratedEntityDocument({
    entityType, entityId, code: entityCode, name: entityTitle,
    relativeFolderPath: meetingDocumentFolder(entityType), file,
  });
  const { data, error } = await supabase.rpc('upsert_meeting_note_document', {
    p_note_id: note.id, p_note_version: note.version, p_file_name: fileName,
    p_storage_provider: stored.provider, p_storage_connection_id: stored.connectionId || null,
    p_storage_path: stored.path || stored.folderPath || '', p_external_file_id: stored.fileId || null,
    p_external_web_url: stored.webUrl || null,
  });
  if (error) throw error;
  return { blob, fileName, stored, document: data };
};

export const sendMeetingNotePdf = async ({ prepared, recipients, subject, message }) => {
  const { data, error } = await supabase.functions.invoke('send-meeting-note', { body: {
    documentId: prepared.document.id,
    idempotencyKey: `meeting-note-${prepared.document.id}-${prepared.document.note_version}`,
    recipients, subject, message,
    pdfBase64: await blobToBase64(prepared.blob),
  } });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'E-mail se nepodařilo odeslat.');
  return data;
};
