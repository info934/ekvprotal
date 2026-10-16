export const DEFAULT_PROJECT_PREFIX = 'PR';
export const PROJECT_PREFIX_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

export const normalizeProjectPrefix = value => String(value || '').trim().toUpperCase();

export const suggestProjectPrefix = name => normalizeProjectPrefix(name)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || DEFAULT_PROJECT_PREFIX;

export const formatProjectCode = (prefix, sequence, year = new Date().getFullYear()) => (
  `${normalizeProjectPrefix(prefix) || DEFAULT_PROJECT_PREFIX}-${String(year).slice(-2)}-${String(sequence).padStart(3, '0')}`
);

export const previewJobNumber = async (client, type, rpc = 'preview_project_code') => {
  const { data, error } = await client.rpc(rpc, { p_project_type: type || null });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('Číselnou řadu se nepodařilo načíst.');
  return data;
};

export const previewProjectCode = (client, type) => previewJobNumber(client, type);

export const saveProjectType = async (client, { id = null, name, prefix }) => {
  const normalized = normalizeProjectPrefix(prefix);
  if (!String(name || '').trim()) throw new Error('Zadejte název typu projektu.');
  if (!PROJECT_PREFIX_PATTERN.test(normalized)) throw new Error('Prefix: 1–20 písmen A–Z, číslic, pomlček nebo podtržítek.');
  const { data, error } = await client.rpc('save_project_type', {
    p_type_id: id, p_name: name.trim(), p_code_prefix: normalized,
  });
  if (error) throw error;
  return data;
};
