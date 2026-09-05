export const normalizeSearchTerm = value => String(value).replace(/[%,_*()\\]/g, ' ').trim().slice(0, 100);
export async function fetchPortalSearch(supabase, value, hasPermission, signal) {
  const term = normalizeSearchTerm(value);
  if (term.length < 2) return { results: [], error: '' };
  const definitions = [
    ['projects', 'projects', 'id,name,code', ['name', 'code'], 'Projekce', '/projects', 'name', 'code'],
    ['realizace', 'realizations', 'id,name,code', ['name', 'code'], 'Realizace', '/realizace', 'name', 'code'],
    ['subjects', 'subjects', 'id,name,ico', ['name', 'ico'], 'Subjekt', '/subjects', 'name', 'ico'],
    ['crm', 'crm_opportunities', 'id,title,number', ['title', 'number'], 'Obchodní případ', '/crm/opportunities', 'title', 'number'],
    ['crm', 'crm_commercial_documents', 'id,title,number,type', ['title', 'number'], 'Obchodní dokument', '/crm', 'title', 'number'],
    ['members', 'members', 'id,name', ['name'], 'Zaměstnanec', '/members', 'name'],
    ['tasks', 'project_tasks', 'id,name,project_id', ['name'], 'Úkol', '/projects', 'name'],
    ['documents', 'documents', 'id,name,project_id', ['name'], 'Dokument', '/documents', 'name'],
  ].filter(([permission, table]) => hasPermission(permission, 'can_read')
    && (table !== 'project_tasks' || hasPermission('projects', 'can_read')));
  const response = await Promise.all(definitions.map(async ([, table, fields, filters, kind, path, titleKey, codeKey]) => {
    const matches = await Promise.all(filters.map(field => supabase.from(table).select(fields).ilike(field, `%${term}%`).order(titleKey).limit(6).abortSignal(signal)));
    const results = [...new Map(matches.flatMap(r => r.data || []).map(item => [item.id, item])).values()].slice(0, 6).map(item => ({
      id: item.id, title: item[titleKey] || item[codeKey] || kind, code: codeKey && item[codeKey], kind,
      path: table === 'crm_commercial_documents' ? `/crm/${item.type === 'order' ? 'orders' : 'offers'}/${item.id}`
        : table === 'documents' ? `/documents?document=${encodeURIComponent(item.id)}`
        : table === 'project_tasks' ? `/projects/${item.project_id}?task=${encodeURIComponent(item.id)}#tasks`
        : `${path}/${item.id}`,
    }));
    return { results, error: matches.some(r => r.error) };
  }));
  return { results: response.flatMap(r => r.results), error: response.some(r => r.error) ? 'Některé moduly se nepodařilo prohledat. Zobrazené výsledky mohou být neúplné.' : '' };
}
