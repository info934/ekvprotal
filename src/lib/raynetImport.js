const normalizeText = (value) => String(value ?? '').trim();

export const raynetStatusToCrm = (status) => {
  const value = normalizeText(status).toUpperCase();
  if (value.includes('WIN')) return { stage: 'won', status: 'closed' };
  if (value.includes('LOST') || value.includes('CANCEL')) return { stage: 'lost', status: 'closed' };
  return { stage: 'lead', status: 'open' };
};

export const raynetActivityStatusToCrm = (activity) => {
  if (normalizeText(activity?.status).toUpperCase() === 'CANCELLED') return 'cancelled';
  if (activity?.completed || normalizeText(activity?.status).toUpperCase() === 'COMPLETED') return 'completed';
  return 'planned';
};

export const detectRaynetBusinessType = (businessCase) => {
  const haystack = [
    businessCase?.businessCaseType?.value,
    businessCase?.category?.value,
    businessCase?.businessCaseClassification1?.value,
    businessCase?.businessCaseClassification2?.value,
    businessCase?.businessCaseClassification3?.value,
    ...(Array.isArray(businessCase?.tags) ? businessCase.tags : []),
  ].map(normalizeText).join(' ').toLowerCase();
  return /\bfve\b|fotovolta|sol[aá]r/.test(haystack) ? 'fve' : 'general';
};

export const raynetAddressToText = (company) => {
  const address = company?.primaryAddress?.address || company?.address || {};
  return [address.street, [address.zipCode, address.city].filter(Boolean).join(' '), address.country]
    .map(normalizeText).filter(Boolean).join(', ');
};

export const summarizeRaynetBatch = (rows = []) => rows.reduce((summary, row) => {
  const entity = row.entity_type || 'unknown';
  const action = row.proposed_action || 'unknown';
  summary.total += 1;
  summary.entities[entity] = (summary.entities[entity] || 0) + 1;
  summary.actions[action] = (summary.actions[action] || 0) + 1;
  return summary;
}, { total: 0, entities: {}, actions: {} });
