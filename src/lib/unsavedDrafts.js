// Deliberately memory-only: no form values are written to browser storage or a server.
const drafts = new Map();
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_DRAFTS = 20;

export const draftSignature = value => JSON.stringify(value ?? null);
const clone = value => JSON.parse(draftSignature(value));

export function rememberUnsavedDraft(key, snapshot, now = Date.now()) {
  if (!key) return;
  for (const [savedKey, draft] of drafts) if (now - draft.savedAt > DRAFT_TTL_MS) drafts.delete(savedKey);
  drafts.delete(key);
  drafts.set(key, { snapshot: clone(snapshot), savedAt: now });
  while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
}

export function readUnsavedDraft(key, now = Date.now()) {
  const draft = drafts.get(key);
  if (!draft) return null;
  if (now - draft.savedAt > DRAFT_TTL_MS) { drafts.delete(key); return null; }
  return { snapshot: clone(draft.snapshot), savedAt: draft.savedAt };
}

export const forgetUnsavedDraft = key => drafts.delete(key);

/** Only same-origin navigation which actually leaves the form should be blocked. */
export function internalFormDestination(href, currentHref, { target, download, modified } = {}) {
  if (download || modified || (target && target !== '_self') || !href) return null;
  let current, destination;
  try { current = new URL(currentHref); destination = new URL(href, current); } catch { return null; }
  if (!['http:', 'https:'].includes(destination.protocol) || destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
