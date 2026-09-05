const editableFields = new Set([
  'expected_close_date', 'priority', 'probability', 'value', 'currency', 'version_no',
  'business_type', 'category', 'source', 'classification_1', 'classification_2', 'classification_3', 'tags', 'next_step',
]);

export const createCrmOpportunityDraft = () => ({ fields: {}, expectedFields: {}, customFields: {}, status: 'idle', error: '' });
export const hasCrmOpportunityDraft = (draft) => Object.keys(draft.fields).length + Object.keys(draft.customFields).length > 0;

export const crmOpportunityDraftReducer = (state, action) => {
  if (action.type === 'reset') return createCrmOpportunityDraft();
  if (action.type === 'saved') return { ...createCrmOpportunityDraft(), status: 'saved' };
  if (action.type === 'saving') return { ...state, status: 'saving', error: '' };
  if (action.type === 'error') return { ...state, status: 'error', error: action.message };
  if (state.status === 'saving') return state;
  if (action.type === 'edit') {
    const expectedFields = { ...state.expectedFields };
    for (const key of Object.keys(action.patch)) {
      if (!editableFields.has(key)) throw new Error('Toto pole nelze upravit v detailu.');
      if (!Object.hasOwn(expectedFields, key)) expectedFields[key] = action.record?.[key] ?? null;
    }
    return { ...state, fields: { ...state.fields, ...action.patch }, expectedFields, status: 'dirty', error: '' };
  }
  if (action.type === 'custom') {
    return {
      ...state,
      customFields: {
        ...state.customFields,
        [action.key]: {
          value: action.value,
          fieldType: action.fieldType,
          expected_value: Object.hasOwn(state.customFields, action.key)
            ? state.customFields[action.key].expected_value : action.record?.custom_fields?.[action.key] ?? null,
        },
      },
      status: 'dirty', error: '',
    };
  }
  return state;
};

const numericValue = (value, label, { min = -Infinity, max = Infinity, integer = false } = {}) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const number = Number(normalized);
  if (!normalized || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label}: zadejte platné číslo${Number.isFinite(min) ? ` od ${min}` : ''}${Number.isFinite(max) ? ` do ${max}` : ''}.`);
  }
  return number;
};

export const buildCrmOpportunityDraftPayload = (opportunityId, draft) => {
  const fields = {};
  for (const [key, value] of Object.entries(draft.fields)) {
    if (!editableFields.has(key)) throw new Error('Toto pole nelze upravit v detailu.');
    if (key === 'probability') fields[key] = numericValue(value, 'Pravděpodobnost', { min: 0, max: 100, integer: true });
    else if (key === 'value') fields[key] = numericValue(value, 'Hodnota', { min: 0 });
    else if (key === 'version_no') fields[key] = numericValue(value, 'Verze', { min: 1, integer: true });
    else if (key === 'tags') fields[key] = Array.isArray(value) ? value : String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
    else if (key === 'currency') {
      const currency = String(value || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Měna musí být třípísmenný kód, například CZK nebo EUR.');
      fields[key] = currency;
    } else fields[key] = value === '' ? null : value;
  }
  return {
    p_opportunity_id: opportunityId,
    p_fields: fields,
    p_expected_fields: draft.expectedFields,
    p_custom_fields: Object.entries(draft.customFields).map(([key, patch]) => ({
      key,
      value: patch.fieldType === 'number' && patch.value !== '' && patch.value !== null
        ? numericValue(patch.value, 'Vlastní pole') : patch.value,
      expected_value: patch.expected_value,
    })),
  };
};

export const submitCrmOpportunityDraft = async (client, opportunityId, draft) => {
  if (!hasCrmOpportunityDraft(draft)) return { data: null, error: null };
  return client.rpc('save_crm_opportunity_fields_atomic', buildCrmOpportunityDraftPayload(opportunityId, draft));
};
