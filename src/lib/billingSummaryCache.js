import { supabase } from '@/lib/customSupabaseClient';
import { createTimedAbortController } from '@/lib/requestControl';

const STALE_TIME_MS = 30_000;
const summaryCache = new Map();

const getKey = (entityType, entityId) => `${entityType}:${entityId}`;

export const invalidateBillingSummary = (entityType, entityId) => {
  summaryCache.delete(getKey(entityType, entityId));
};

export const getBillingSummary = async (
  entityType,
  entityId,
  { force = false } = {}
) => {
  if (!entityType || !entityId) return null;

  const key = getKey(entityType, entityId);
  const cached = summaryCache.get(key);
  const isFresh = cached?.data && Date.now() - cached.updatedAt < STALE_TIME_MS;

  if (!force && isFresh) return cached.data;
  if (!force && cached?.promise) return cached.promise;

  const request = createTimedAbortController();
  const token = Symbol(key);
  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_entity_billing_summary', {
        p_entity_type: entityType,
        p_entity_id: entityId,
      }).abortSignal(request.signal);
      if (error) throw error;

      if (summaryCache.get(key)?.token === token) {
        summaryCache.set(key, {
          data,
          updatedAt: Date.now(),
          promise: null,
          token: null,
        });
      }
      return data;
    } catch (error) {
      const previous = summaryCache.get(key);
      if (previous?.token === token) {
        if (previous.data) {
          summaryCache.set(key, { ...previous, promise: null, token: null });
        } else {
          summaryCache.delete(key);
        }
      }
      throw error;
    } finally {
      request.dispose();
    }
  })();

  summaryCache.set(key, {
    data: cached?.data || null,
    updatedAt: cached?.updatedAt || 0,
    promise,
    token,
  });

  return promise;
};
