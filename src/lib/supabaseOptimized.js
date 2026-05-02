import { supabase } from './customSupabaseClient';

/**
 * Utility functions for optimized Supabase queries
 */

/**
 * Executes a Supabase query selecting only specified columns to reduce payload size.
 * 
 * @param {string} table - Table name
 * @param {string} columns - Comma separated columns (e.g. 'id, name, status')
 * @param {Function} [queryModifier] - Optional callback to apply filters: (query) => query.eq('status', 'active')
 * @returns {Promise<{data: any[], error: any}>}
 */
export const fetchWithSelect = async (table, columns = '*', queryModifier) => {
  let query = supabase.from(table).select(columns);
  
  if (queryModifier && typeof queryModifier === 'function') {
    query = queryModifier(query);
  }
  
  return await query;
};

/**
 * Fetches multiple records by their IDs in a single request (batching).
 * Useful to avoid N+1 query problems.
 * 
 * @param {string} table - Table name
 * @param {Array<string|number>} ids - Array of IDs to fetch
 * @param {string} [idColumn='id'] - Column name to match IDs against (default: 'id')
 * @param {string} [columns='*'] - Columns to select
 * @returns {Promise<{data: any[], error: any}>}
 */
export const batchFetch = async (table, ids, idColumn = 'id', columns = '*') => {
  if (!ids || ids.length === 0) {
    return { data: [], error: null };
  }
  
  // Remove duplicates to optimize query
  const uniqueIds = [...new Set(ids)];
  
  return await supabase
    .from(table)
    .select(columns)
    .in(idColumn, uniqueIds);
};

/**
 * Fetches data with client-side caching strategy (TTL).
 * Uses localStorage to persist cache across page reloads.
 * 
 * @param {string} key - Unique cache key
 * @param {Function} queryFn - Async function returning the data
 * @param {number} [ttl=300] - Time to live in seconds (default: 5 minutes)
 * @returns {Promise<{data: any, error: any, fromCache: boolean}>}
 */
export const fetchWithCache = async (key, queryFn, ttl = 300) => {
  const cacheKey = `horizons_opt_${key}`;
  
  try {
    const cachedItem = localStorage.getItem(cacheKey);
    if (cachedItem) {
      const { data, timestamp } = JSON.parse(cachedItem);
      const now = Date.now();
      
      // Check if cache is still valid
      if (now - timestamp < ttl * 1000) {
        return { data, error: null, fromCache: true };
      }
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }

  // Cache miss or expired, fetch fresh data
  try {
    const result = await queryFn();
    
    // Handle Supabase response structure or direct data
    const data = result.data !== undefined ? result.data : result;
    const error = result.error || null;

    if (!error && data) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          data,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Cache write error (quota exceeded?):', e);
      }
    }

    return { data, error, fromCache: false };
  } catch (err) {
    return { data: null, error: err, fromCache: false };
  }
};

/**
 * Efficiently counts rows without fetching the actual data (using HEAD request).
 * 
 * @param {string} table - Table name
 * @param {Function} [queryModifier] - Optional callback to apply filters
 * @returns {Promise<{count: number, error: any}>}
 */
export const optimizedCount = async (table, queryModifier) => {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  
  if (queryModifier && typeof queryModifier === 'function') {
    query = queryModifier(query);
  }
  
  const { count, error } = await query;
  return { count, error };
};

/**
 * Prefetches data into the cache in the background (fire-and-forget).
 * Useful for loading data for the next likely view (e.g., hovering over a link).
 * 
 * @param {string} key - Cache key
 * @param {Function} queryFn - Async function to fetch data
 * @param {number} [ttl=300] - TTL in seconds
 */
export const prefetch = (key, queryFn, ttl = 300) => {
  // Execute query and cache it, catching errors silently so it doesn't disrupt main flow
  fetchWithCache(key, queryFn, ttl).catch(err => 
    console.debug(`Prefetch failed for key: ${key}`, err)
  );
};