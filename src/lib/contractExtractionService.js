import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';
import { getDefaultStorageConnection, uploadInvoiceDocument } from '@/lib/documentStorageService';

const storageEntityType = (entityType) => entityType === 'realization' ? 'realizace' : entityType;
const MAX_CONTRACT_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_CONTRACT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const resolveContractMimeType = (file) => {
  if (ALLOWED_CONTRACT_TYPES.has(file.type)) return file.type;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || null;
};

export const listContractExtractions = async ({ entityType, entityId }) => {
  const targetColumn = entityType === 'realization' ? 'realization_id' : 'project_id';
  const { data, error } = await supabase
    .from('contract_extraction_jobs')
    .select('*, contract_extraction_milestones(*)')
    .eq(targetColumn, entityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const uploadAndAnalyzeContract = async ({ entityType, entityId, file }) => {
  if (!file) throw new Error('Vyberte smlouvu k analýze.');
  if (file.size > MAX_CONTRACT_FILE_SIZE) throw new Error('Soubor je větší než povolený limit 20 MB.');
  const mimeType = resolveContractMimeType(file);
  if (!mimeType) {
    throw new Error('Podporované formáty jsou PDF, DOC, DOCX, TXT, JPG, PNG a WEBP.');
  }
  const mappedType = storageEntityType(entityType);
  const targetTable = entityType === 'realization' ? 'realizations' : 'projects';
  const { data: target } = await supabase
    .from(targetTable)
    .select('code')
    .eq('id', entityId)
    .maybeSingle();
  const connection = await getDefaultStorageConnection();
  if (connection.provider !== 'sharepoint') {
    throw new Error('Analýza smlouvy vyžaduje aktivní centrální SharePoint úložiště Vedení.');
  }
  const uploaded = await uploadInvoiceDocument({
    file,
    recordId: crypto.randomUUID(),
    projectReference: target?.code || null,
    category: 'obchodni-smlouva',
    accessEntityType: mappedType,
    accessEntityId: entityId,
    connection,
  });
  if (uploaded.provider !== 'sharepoint' || !uploaded.fileId || !uploaded.connectionId) {
    throw new Error('Analýza smlouvy vyžaduje aktivní centrální SharePoint úložiště Vedení.');
  }

  const { data, error } = await invokeWithTimeout(supabase, 'analyze-contract', {
    body: {
      entityType,
      storageEntityType: 'invoice',
      entityId,
      connectionId: uploaded.connectionId,
      fileId: uploaded.fileId,
      fileName: file.name,
      mimeType,
      webUrl: uploaded.webUrl || null,
    },
  }, 120_000);
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Smlouvu se nepodařilo analyzovat.');
  return data;
};

export const setContractMilestoneAccepted = async (milestoneId, accepted) => {
  const { error } = await supabase.rpc('review_contract_extraction_milestone', {
    p_milestone_id: milestoneId,
    p_accepted: accepted,
  });
  if (error) throw error;
};

export const rejectContractExtraction = async ({ extractionId, reason }) => {
  const { data, error } = await supabase.rpc('reject_contract_extraction', {
    p_extraction_id: extractionId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
};

export const applyContractExtraction = async ({
  extractionId,
  updateContractValue,
  createBillingMilestones,
  reviewedContractValue,
  reviewedVatRate,
}) => {
  const { data, error } = await supabase.rpc('apply_contract_extraction', {
    p_extraction_id: extractionId,
    p_update_contract_value: updateContractValue,
    p_create_billing_milestones: createBillingMilestones,
    p_reviewed_contract_value: reviewedContractValue,
    p_reviewed_vat_rate: reviewedVatRate,
  });
  if (error) throw error;
  return data;
};
