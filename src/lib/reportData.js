// Continue until an empty response: PostgREST may cap responses below our page size.
export async function fetchReportRows(factory, signal) {
  const rows = [];
  const seen = new Set();
  while (true) {
    if (signal?.aborted) throw new DOMException('Načítání přerušeno.', 'AbortError');
    let query = factory().range(rows.length, rows.length + 249);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Server nevrátil seznam záznamů.');
    if (!data.length) return rows;
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error('Seznam se během načítání změnil. Obnovte přehled.');
      seen.add(row.id);
    }
    rows.push(...data);
  }
}
