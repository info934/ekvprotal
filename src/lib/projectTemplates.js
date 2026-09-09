export const PROJECT_TEMPLATE_RETURNING = 'id, user_id, name, description, tasks_data, phases_data, milestones_data, created_at, updated_at';

const ARRAY_FIELDS = ['tasks_data', 'phases_data', 'milestones_data'];

export const normalizeProjectTemplatePayload = (payload = {}) => {
  const normalized = {
    name: String(payload.name || '').trim(),
    description: String(payload.description || '').trim() || null,
  };

  if (!normalized.name) {
    throw new Error('Název šablony je povinný.');
  }

  if (payload.user_id) normalized.user_id = payload.user_id;
  for (const field of ARRAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      normalized[field] = Array.isArray(payload[field]) ? payload[field] : [];
    }
  }

  return normalized;
};

export const createProjectTemplate = async (client, payload) => {
  const { data, error } = await client
    .from('project_templates_custom')
    .insert(normalizeProjectTemplatePayload(payload))
    .select(PROJECT_TEMPLATE_RETURNING)
    .single();

  if (error) throw error;
  return data;
};

export const updateProjectTemplate = async (client, templateId, userId, payload) => {
  const { data, error } = await client
    .from('project_templates_custom')
    .update(normalizeProjectTemplatePayload(payload))
    .eq('id', templateId)
    .eq('user_id', userId)
    .select(PROJECT_TEMPLATE_RETURNING)
    .single();

  if (error) throw error;
  return data;
};
