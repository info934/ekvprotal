export const getCrmRecordRef = (record) => {
  if (!record) return '';
  const value = typeof record === 'string' ? record : (record.number || record.code || record.title || record.id || '');
  return encodeURIComponent(String(value));
};

export const findCrmRecordByRef = (records = [], ref) => {
  if (!ref) return null;
  const decodedRef = decodeURIComponent(String(ref));
  const normalizedRef = decodedRef.toLowerCase();
  return records.find((record) => (
    String(record.id || '').toLowerCase() === normalizedRef ||
    String(record.number || '').toLowerCase() === normalizedRef ||
    String(record.code || '').toLowerCase() === normalizedRef ||
    String(record.title || '').toLowerCase() === normalizedRef
  )) || null;
};

export const crmOpportunityPath = (opportunity) => `/crm/${getCrmRecordRef(opportunity)}`;

export const crmCommercialDocumentPath = (document) => {
  const base = document?.type === 'order' ? '/crm/orders' : '/crm/offers';
  return `${base}/${getCrmRecordRef(document)}`;
};
