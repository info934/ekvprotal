import { useRef, useCallback, useEffect } from 'react';

/**
 * Custom hook for advanced memoization of function results with configurable cache size,
 * invalidation strategies, and performance tracking.
 * 
 * Note: This is different from React.useMemo. This hook creates a memoized version of a function
 * that persists its cache across renders, similar to lodash.memoize but with more features.
 * 
 * @param {Function} fn - The function to memoize
 * @param {Object} options - Configuration options
 * @param {number} [options.maxSize=10] - Maximum number of entries in cache (LRU strategy)
 * @param {number} [options.ttl=0] - Time to live in milliseconds (0 = no expiry)
 * @param {Function} [options.keyResolver] - Function to generate cache key from arguments
 * @returns {Array} [memoizedFn, stats, utils]
 *   - memoizedFn: The wrapper function
 *   - stats: { hits, misses, ratio, size }
 *   - utils: { clear, delete(key) }
 */
export function useCustomMemo(fn, { maxSize = 10, ttl = 0, keyResolver } = {}) {
  // Use a ref to store the cache so it persists across renders
  // Structure: Map<key, { value, timestamp, timerId }>
  const cache = useRef(new Map());
  
  // Stats tracking
  const stats = useRef({ hits: 0, misses: 0 });
  
  // Cleanup on unmount (clear timeouts)
  useEffect(() => {
    return () => {
      cache.current.forEach(entry => {
        if (entry.timerId) clearTimeout(entry.timerId);
      });
      cache.current.clear();
    };
  }, []);

  const memoizedFn = useCallback((...args) => {
    const key = keyResolver ? keyResolver(...args) : JSON.stringify(args);
    const now = Date.now();
    
    // Check cache
    if (cache.current.has(key)) {
      const entry = cache.current.get(key);
      
      // Double check TTL just in case timer failed or wasn't used
      if (ttl > 0 && (now - entry.timestamp > ttl)) {
        cache.current.delete(key);
      } else {
        // Cache Hit
        stats.current.hits++;
        
        // Refresh LRU position by re-inserting
        cache.current.delete(key);
        cache.current.set(key, entry);
        
        return entry.value;
      }
    }

    // Cache Miss or Expired
    stats.current.misses++;
    const result = fn(...args);

    // Enforce max size (LRU - remove first inserted)
    if (cache.current.size >= maxSize) {
      const firstKey = cache.current.keys().next().value;
      const removedEntry = cache.current.get(firstKey);
      if (removedEntry?.timerId) clearTimeout(removedEntry.timerId);
      cache.current.delete(firstKey);
    }

    // Setup TTL timer if needed
    let timerId = null;
    if (ttl > 0) {
      timerId = setTimeout(() => {
        cache.current.delete(key);
      }, ttl);
    }

    // Save to cache
    cache.current.set(key, {
      value: result,
      timestamp: now,
      timerId
    });

    return result;
  }, [fn, maxSize, ttl, keyResolver]);

  // Utils
  const clear = useCallback(() => {
    cache.current.forEach(entry => {
      if (entry.timerId) clearTimeout(entry.timerId);
    });
    cache.current.clear();
    stats.current = { hits: 0, misses: 0 };
  }, []);

  const remove = useCallback((...args) => {
    const key = keyResolver ? keyResolver(...args) : JSON.stringify(args);
    const entry = cache.current.get(key);
    if (entry?.timerId) clearTimeout(entry.timerId);
    return cache.current.delete(key);
  }, [keyResolver]);

  // Calculate ratio
  const getStats = () => {
    const total = stats.current.hits + stats.current.misses;
    return {
      hits: stats.current.hits,
      misses: stats.current.misses,
      ratio: total === 0 ? 0 : stats.current.hits / total,
      size: cache.current.size
    };
  };

  return [memoizedFn, getStats, { clear, remove }];
}