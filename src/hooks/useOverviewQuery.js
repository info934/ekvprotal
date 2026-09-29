import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { createOverviewCache } from '@/lib/overviewCache';
import { createTimedAbortController } from '@/lib/requestControl';
import { localDateKey } from '@/domain/workOverview';

const cache = createOverviewCache();
supabase.auth.onAuthStateChange(event => {
  if (['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) cache.clear();
});

export function useOverviewQuery({ name, scope, load, enabled = true }) {
  const key = `${name}:${scope}:${localDateKey()}`;
  const [state, setState] = useState({ key: null, data: null, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const lastRequest = useRef(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    const previousRequest = lastRequest.current;
    const force = previousRequest?.key === key && previousRequest.revision !== revision;
    lastRequest.current = { key, revision };
    const request = createTimedAbortController(20_000);
    setState(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: '' }));
    cache.load(key, () => load(request.signal), { force, signal: request.signal })
      .then(data => { if (current) setState({ key, data, loading: false, error: '' }); })
      .catch(error => {
        if (current) setState({ key, data: null, loading: false, error: request.signal.aborted
          ? 'Načítání překročilo časový limit. Zkuste přehled obnovit.'
          : error.message || 'Přehled se nepodařilo načíst.' });
      }).finally(() => request.dispose());
    return () => { current = false; request.controller.abort(); request.dispose(); };
  }, [key, load, enabled, revision]);
  // Never render the previous identity/permission/private-mode data after a switch.
  const visible = enabled && state.key === key ? state : { data: null, loading: enabled, error: '' };
  return { ...visible, refresh };
}
