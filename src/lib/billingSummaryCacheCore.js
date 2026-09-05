export function createBillingSummaryCache({ readSession, fetchSummary, subscribeAuth, now = Date.now, ttl = 30_000 }) {
  const cache = new Map();
  let scope = null;
  let generation = 0;
  const clear = () => {
    generation += 1;
    for (const item of cache.values()) item.controller?.abort();
    cache.clear();
  };
  const adoptSession = (session, force = false) => {
    const next = session?.user?.id ? { userId: session.user.id, token: session.access_token ?? null } : null;
    if (force || next?.userId !== scope?.userId || next?.token !== scope?.token) clear();
    scope = next;
  };
  const unsubscribe = subscribeAuth?.((event, session) => adoptSession(session, event !== 'INITIAL_SESSION'));
  return {
    async get(entityType, entityId, { force = false } = {}) {
      if (!entityType || !entityId) return null;
      const sessionGeneration = generation;
      let session;
      try { session = await readSession(); }
      catch (error) { clear(); scope = null; throw error; }
      if (generation !== sessionGeneration && (scope?.userId !== session?.user?.id || scope?.token !== (session?.access_token ?? null))) {
        throw new DOMException('Přihlášení se během načítání změnilo. Obnovte přehled.', 'AbortError');
      }
      adoptSession(session);
      if (!scope) throw new Error('Pro načtení fakturace se přihlaste.');
      const requestGeneration = generation;
      const key = `${entityType}:${entityId}`;
      const cached = cache.get(key);
      if (!force && cached?.data && now() - cached.updatedAt < ttl) return cached.data;
      if (!force && cached?.promise) return cached.promise;
      cached?.controller?.abort();
      const controller = new AbortController();
      const token = Symbol(key);
      const promise = (async () => {
        const data = await fetchSummary(entityType, entityId, controller.signal);
        if (generation !== requestGeneration || controller.signal.aborted) throw new DOMException('Fakturace patří k předchozí relaci. Obnovte přehled.', 'AbortError');
        if (cache.get(key)?.token === token) cache.set(key, { data, updatedAt: now(), promise: null, controller: null });
        return data;
      })().catch(error => {
        if (cache.get(key)?.token === token) cache.delete(key);
        throw error;
      });
      cache.set(key, { token, promise, controller });
      return promise;
    },
    invalidate(entityType, entityId) {
      const key = `${entityType}:${entityId}`;
      cache.get(key)?.controller?.abort(); cache.delete(key);
    },
    clear,
    dispose() { clear(); unsubscribe?.(); },
  };
}
