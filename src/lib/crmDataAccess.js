// A fresh, deterministically ordered query is required for every page. Do not
// return a partial history/catalog after an error on a later page.
export const fetchAllCrmRows = async (queryFactory, pageSize = 500) => {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  const rows = [];
  while (true) {
    const result = await queryFactory().range(rows.length, rows.length + pageSize - 1);
    if (result.error) return { data: null, error: result.error, count: null };
    const page = result.data || [];
    rows.push(...page);
    if (!page.length || (result.count != null && rows.length >= result.count)) {
      return { data: rows, error: null, count: rows.length };
    }
  }
};

// Keep related requests below URL limits, including when filtering a full catalog.
export const fetchCrmRowsByIds = async (ids, queryFactory) => {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batches = [];
    for (let start = offset; start < Math.min(offset + 400, ids.length); start += 100) {
      batches.push(fetchAllCrmRows(() => queryFactory(ids.slice(start, start + 100))));
    }
    const results = await Promise.all(batches);
    for (const result of results) {
      if (result.error) return { data: null, error: result.error, count: null };
      rows.push(...result.data);
    }
  }
  return { data: rows, error: null, count: rows.length };
};

export const crmWorkflowErrorMessage = (error) => (
  error?.code === 'PGRST202' || error?.code === '42883'
    ? 'Chybí databázová aktualizace pro bezpečné uložení. Požádejte správce o instalaci migrace CRM 2.0; změny zůstávají ve formuláři.'
    : error?.message || 'Operaci se nepodařilo dokončit.'
);
