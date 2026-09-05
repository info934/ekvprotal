import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { loadPayoutWorkspace } from '@/lib/payoutWorkspaceData';

export function usePayoutWorkspace({ memberId, canAdmin, actorId }) {
  const key = `${actorId || ''}|${memberId || ''}|${canAdmin}`;
  const [state, setState] = useState({ key: null, loading: true });
  const request = useRef({ sequence: 0, controller: null });
  const reload = useCallback(async () => {
    request.current.controller?.abort();
    const controller = new AbortController();
    const sequence = ++request.current.sequence;
    request.current.controller = controller;
    setState({ key, loading: true });
    try {
      const data = await loadPayoutWorkspace(supabase, { memberId, canAdmin, signal: controller.signal });
      if (!controller.signal.aborted && sequence === request.current.sequence) setState({ key, loading: false, ...data });
    } catch (error) {
      if (!controller.signal.aborted && sequence === request.current.sequence) {
        const failed = { rows: null, error: error.message || 'Výplaty se nepodařilo načíst.' };
        setState({ key, loading: false, fixed: failed, hourly: failed });
      }
    }
  }, [key, memberId, canAdmin]);
  useEffect(() => {
    reload();
    const channel = supabase.channel(`payout-workspace-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, reload).subscribe();
    return () => { request.current.controller?.abort(); supabase.removeChannel(channel); };
  }, [key, reload]);
  return { ...(state.key === key ? state : { loading: true }), reload };
}
