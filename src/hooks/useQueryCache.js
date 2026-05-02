import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for caching async query results (e.g. Supabase) in localStorage with TTL.
 * 
 * @param {string} key - Unique identifier for the query.
 * @param {Function} queryFn - Async function that returns the data.
 * @param {Object} options - Configuration options.
 * @param {number} options.ttl - Time to live in seconds (default: 300).
 * @param {boolean} options.enabled - Whether the query is enabled (default: true).
 * @returns {Object} { data, loading, error, refetch, invalidate }
 */
export const useQueryCache = (key, queryFn, { ttl = 300, enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Helper to construct storage key
  const storageKey = key ? `horizons_cache_${key}` : null;

  // Retrieve valid data from cache
  const getValidCache = useCallback(() => {
    if (!storageKey) return null;
    try {
      const item = localStorage.getItem(storageKey);
      if (!item) return null;

      const parsed = JSON.parse(item);
      const { data, timestamp } = parsed;
      const now = Date.now();

      // Check TTL (ttl is in seconds)
      if (now - timestamp > ttl * 1000) {
        localStorage.removeItem(storageKey);
        return null;
      }

      return data;
    } catch (err) {
      console.warn('Error reading/parsing cache:', err);
      // If corrupted, clear it
      localStorage.removeItem(storageKey);
      return null;
    }
  }, [storageKey, ttl]);

  // Main fetch function
  const fetchData = useCallback(async (ignoreCache = false) => {
    if (!enabled || !key) return;

    // 1. Try cache if allowed
    if (!ignoreCache) {
      const cached = getValidCache();
      if (cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }

    // 2. Fetch fresh data
    setLoading(true);
    setError(null);

    try {
      const result = await queryFn();

      // Detect Supabase-like response structure
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        throw result.error;
      }

      setData(result);

      // 3. Save to cache
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            data: result,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('Failed to save to localStorage (quota exceeded?):', e);
        }
      }

    } catch (err) {
      console.error('Query error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [key, enabled, queryFn, getValidCache, storageKey]);

  // Effect to trigger fetch
  useEffect(() => {
    fetchData();
    // We intentionally exclude queryFn from deps to avoid infinite loops 
    // when users pass inline async functions. Key is the primary trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Manual invalidation
  const invalidate = useCallback(() => {
    if (storageKey) {
      localStorage.removeItem(storageKey);
      setData(null);
    }
  }, [storageKey]);

  // Refetch (force update)
  const refetch = useCallback(() => {
    return fetchData(true);
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refetch,
    invalidate
  };
};