import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for infinite scrolling using Intersection Observer API.
 * 
 * @param {Function} queryFn - Async function returning data. 
 *                             Should accept (page) and return either an Array or { data: Array, hasMore: boolean }
 * @param {Object} options - Configuration options
 * @param {number} [options.threshold=1.0] - Intersection observer threshold (0 to 1)
 * @param {Element} [options.root=null] - The element that is used as the viewport for checking visibility
 * @param {string} [options.rootMargin="0px"] - Margin around the root
 * @param {number} [options.initialPage=1] - The starting page number
 * @param {Array} [options.dependencies=[]] - Dependencies that should trigger a list reset (e.g. filters)
 * 
 * @returns {Object} { items, loading, hasMore, error, ref }
 */
export function useInfiniteScroll(queryFn, { 
  threshold = 1.0, 
  root = null, 
  rootMargin = "0px",
  initialPage = 1,
  dependencies = []
} = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(initialPage);
  
  // Refs to access latest state inside observer callback without re-binding/re-running effects excessively
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const observerRef = useRef(null);
  const targetRef = useRef(null);

  // Sync refs with state
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  // Main data fetching function
  const fetchData = useCallback(async (pageParam, isReset = false) => {
    // Prevent duplicate requests if already loading (unless it's a forced reset)
    if (loadingRef.current && !isReset) return;

    setLoading(true);
    setError(null);

    try {
      const result = await queryFn(pageParam);
      
      let newItems = [];
      let shouldLoadMore = false;

      // Handle different response formats (Array vs Object with metadata)
      if (Array.isArray(result)) {
        newItems = result;
        shouldLoadMore = result.length > 0;
      } else if (result && typeof result === 'object') {
        if (Array.isArray(result.data)) newItems = result.data;
        else if (Array.isArray(result.items)) newItems = result.items;
        
        // Try to detect 'hasMore' flag, otherwise fallback to item length check
        if (typeof result.hasMore === 'boolean') shouldLoadMore = result.hasMore;
        else if (typeof result.hasNextPage === 'boolean') shouldLoadMore = result.hasNextPage;
        else shouldLoadMore = newItems.length > 0;
      }

      setItems(prev => isReset ? newItems : [...prev, ...newItems]);
      setHasMore(shouldLoadMore);
      
      // If we got data and there's more, prepare next page
      if (shouldLoadMore) {
        setPage(prev => prev + 1);
      }
    } catch (err) {
      console.error("Infinite scroll fetch error:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [queryFn]);

  // Initial load / Reset handler when dependencies (filters) change
  useEffect(() => {
    setItems([]);
    setPage(initialPage);
    setHasMore(true);
    hasMoreRef.current = true;
    loadingRef.current = false; // Manually reset ref for immediate fetch
    
    fetchData(initialPage, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, ...dependencies]);

  // Intersection Observer setup
  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;

    // Disconnect previous observer if it exists
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const observer = new IntersectionObserver((entries) => {
      const target = entries[0];
      // Load more if target is visible, we have more data, and aren't currently loading
      if (target.isIntersecting && hasMoreRef.current && !loadingRef.current) {
        fetchData(page);
      }
    }, {
      threshold,
      root,
      rootMargin
    });

    observer.observe(element);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [fetchData, page, threshold, root, rootMargin]);

  return { items, loading, hasMore, error, ref: targetRef };
}