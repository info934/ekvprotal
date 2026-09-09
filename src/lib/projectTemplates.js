export const PROJECT_TEMPLATE_RETURNING = 'id, user_id, name, description, project_data, tasks_data, phases_data, milestones_data, created_at, updated_at';

const ARRAY_FIELDS = ['tasks_data', 'phases_data', 'milestones_data'];
const STRING_FIELDS = ['type', 'stage_id', 'created_by_member_id', 'complexity_level', 'location', 'client_internal_ref', 'brief', 'investor_id', 'client_id'];
const NUMBER_FIELDS = ['estimated_work_days', 'budget_percentage', 'overhead_percentage'];
const BOOLEAN_FIELDS = ['is_priority', 'investor_is_client'];

const normalizeSubjectSnapshot = (subject, fallbackId) => {
  const id = subject?.id || fallbackId;
  if (!id) return null;
  return {
    id,
    name: String(subject?.name || subject?.label || '').trim() || 'Vybraný subjekt',
    ...(subject?.ico ? { ico: String(subject.ico).trim() } : {}),
  };
};

export const normalizeProjectTemplateData = (projectData = {}) => {
  if (!projectData || typeof projectData !== 'object' || Array.isArray(projectData)) return {};

  const normalized = { schema_version: 1 };
  for (const field of STRING_FIELDS) {
    const value = projectData[field];
    if (typeof value === 'string' && value.trim()) normalized[field] = value.trim();
  }
  for (const field of NUMBER_FIELDS) {
    if (projectData[field] === null || projectData[field] === undefined || projectData[field] === '') continue;
    const value = Number(projectData[field]);
    if (Number.isFinite(value)) normalized[field] = value;
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof projectData[field] === 'boolean') normalized[field] = projectData[field];
  }

  const investor = normalizeSubjectSnapshot(
    projectData.subjects?.investor || projectData.investor,
    normalized.investor_id,
  );
  const client = normalizeSubjectSnapshot(
    projectData.subjects?.client || projectData.client,
    normalized.client_id,
  );
  if (investor || client) {
    normalized.subjects = {
      ...(investor ? { investor } : {}),
      ...(client ? { client } : {}),
    };
  }

  return Object.keys(normalized).length === 1 ? {} : normalized;
};

export const buildProjectTemplateData = (project = {}) => normalizeProjectTemplateData({
  type: project.type,
  stage_id: project.stage_id,
  created_by_member_id: project.created_by_member_id,
  complexity_level: project.complexity_level,
  estimated_work_days: project.estimated_work_days,
  location: project.location,
  client_internal_ref: project.client_internal_ref,
  brief: project.brief,
  investor_id: project.investor_id,
  client_id: project.client_id,
  is_priority: project.is_priority,
  budget_percentage: project.budget_percentage,
  overhead_percentage: project.overhead_percentage,
  investor_is_client: Boolean(project.investor_id && project.investor_id === project.client_id),
  investor: project.investor,
  client: project.client,
});

export const getProjectTemplateFormValues = (projectData = {}, { includeFinancialDefaults = false } = {}) => {
  const normalized = normalizeProjectTemplateData(projectData);
  const values = {};
  for (const field of [...STRING_FIELDS, 'estimated_work_days', ...BOOLEAN_FIELDS]) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) values[field] = normalized[field];
  }
  if (includeFinancialDefaults) {
    for (const field of ['budget_percentage', 'overhead_percentage']) {
      if (Object.prototype.hasOwnProperty.call(normalized, field)) values[field] = normalized[field];
    }
  }
  return values;
};

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
  if (Object.prototype.hasOwnProperty.call(payload, 'project_data')) {
    normalized.project_data = normalizeProjectTemplateData(payload.project_data);
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
