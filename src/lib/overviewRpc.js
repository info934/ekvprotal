import { localDateKey } from '../domain/workOverview.js';

export async function fetchOverviewRpc(client, name, params, signal) {
  const started = performance.now();
  try {
    const { data, error } = await client.rpc(name, params).abortSignal(signal);
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Přehled nemá platný formát.');
    return data;
  } finally {
    // No identifiers, amounts or response bodies in performance entries.
    try {
      performance.measure?.(`portal:${name}`, { start: started, end: performance.now() });
      const measures = performance.getEntriesByName?.(`portal:${name}`) || [];
      if (measures.length > 20) performance.clearMeasures(`portal:${name}`);
    } catch { /* Optional telemetry must not break an otherwise successful request. */ }
  }
}

export function fetchMyWorkOverview(client, { signal } = {}) {
  return fetchOverviewRpc(client, 'get_my_work_overview_v2', { p_today: localDateKey() }, signal);
}
