import { supabase } from '@/lib/customSupabaseClient';
import { combineAbortSignals, createTimedAbortController } from '@/lib/requestControl';
import { createBillingSummaryCache } from './billingSummaryCacheCore';

const scopedCache = createBillingSummaryCache({
  readSession: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  },
  subscribeAuth: callback => {
    const { data } = supabase.auth.onAuthStateChange(callback);
    return () => data?.subscription?.unsubscribe();
  },
  fetchSummary: async (entityType, entityId, signal) => {
    const request = createTimedAbortController();
    const combined = combineAbortSignals(signal, request.signal);
    try {
      const { data, error } = await supabase.rpc('get_entity_billing_summary', {
        p_entity_type: entityType, p_entity_id: entityId,
      }).abortSignal(combined);
      if (error) throw error;
      return data;
    } finally {
      request.dispose();
    }
  },
});

export const getBillingSummary = (entityType, entityId, options) => scopedCache.get(entityType, entityId, options);
export const invalidateBillingSummary = (entityType, entityId) => scopedCache.invalidate(entityType, entityId);
if (import.meta.hot) import.meta.hot.dispose(() => scopedCache.dispose());
