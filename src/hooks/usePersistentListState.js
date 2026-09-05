import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listStateSearch, normalizeListState, resolveListState } from '@/lib/listWorkspaceState';

const readSaved = key => {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; }
};

export function usePersistentListState({ scope, userId, statuses, sorts, ready }) {
  const key = `ekv:list:v2:${userId || 'anonymous'}:${scope}`;
  const location = useLocation();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => ({ key, ...readSaved(key) }));
  const currentSaved = saved.key === key ? saved : readSaved(key);
  const state = resolveListState(location.search, currentSaved.state, statuses, sorts);
  const current = useRef({ state, key, saved: currentSaved });
  current.current = { state, key, saved: currentSaved };
  const restored = useRef(false);

  const persist = useCallback(payload => {
    const next = { key, ...payload };
    setSaved(next);
    try { sessionStorage.setItem(key, JSON.stringify(payload)); } catch { /* Session storage can be disabled. */ }
  }, [key]);

  const update = useCallback(patch => {
    const next = normalizeListState({ ...current.current.state, ...patch }, statuses, sorts);
    current.current.state = next;
    persist({ state: next, scrollY: 0 });
    navigate({ pathname: location.pathname, search: listStateSearch(next) }, { replace: true });
  }, [location.pathname, navigate, persist, sorts, statuses]);

  const openRecord = useCallback(path => {
    persist({ state: current.current.state, scrollY: window.scrollY });
    navigate(path, { state: { returnTo: `${location.pathname}${listStateSearch(current.current.state)}` } });
  }, [location.pathname, navigate, persist]);

  useEffect(() => {
    if (!ready || restored.current) return;
    const top = Number(current.current.saved.scrollY) || 0;
    const frame = requestAnimationFrame(() => { restored.current = true; window.scrollTo({ top, behavior: 'instant' }); });
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return { state, update, openRecord };
}
