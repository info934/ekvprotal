export const getCrmRecordRef = (record) => {
  if (!record) return '';
  const value = typeof record === 'string' ? record : (record.number || record.code || record.id || record.title || '');
  return encodeURIComponent(String(value));
};

export const decodeCrmRecordRef = (ref) => {
  try {
    return decodeURIComponent(String(ref ?? ''));
  } catch {
    return String(ref ?? '');
  }
};

// UUID columns must never receive a human document number (Postgres rejects it).
// Use an equality filter so punctuation in a reference cannot alter PostgREST syntax.
export const filterCrmRecordByRef = (query, ref) => {
  const value = decodeCrmRecordRef(ref);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  return query.eq(isUuid ? 'id' : 'number', value);
};

export const findCrmRecordByRef = (records = [], ref) => {
  if (!ref) return null;
  const decodedRef = decodeCrmRecordRef(ref);
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
