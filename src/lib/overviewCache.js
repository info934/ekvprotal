// Short-lived, memory-only read cache. A scope contains identity and effective permissions.
export function createOverviewCache({ ttl = 30_000, maxEntries = 8, now = Date.now } = {}) {
  const entries = new Map();
  let generation = 0;
  return {
    clear() { generation += 1; entries.clear(); },
    async load(key, loader, { force = false, signal } = {}) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const cached = entries.get(key);
      if (!force && cached && now() - cached.at < ttl) return cached.value;
      entries.delete(key);
      const version = generation;
      const value = await loader();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (version === generation) {
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entries.set(key, { value, at: now() });
      }
      return value;
    },
  };
}

export function overviewScope({ userId, memberId, userRole, permissions, isPrivateMode }) {
  return JSON.stringify([userId, memberId, userRole, Boolean(isPrivateMode),
    Object.entries(permissions || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([module, rights]) => [module, Boolean(rights.can_read), Boolean(rights.can_edit), Boolean(rights.can_admin)])]);
}
