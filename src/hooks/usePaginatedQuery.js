import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for handling paginated Supabase queries with caching.
 * 
 * @param {Function} queryBuilder - Function that returns a Supabase query builder (without .range() or .limit()).
 *                                  Example: () => supabase.from('users').select('*', { count: 'exact' })
 * @param {Object} options - Configuration options
 * @param {number} options.pageSize - Number of items per page (default: 20)
 * @param {Array} options.dependencies - Dependencies array to trigger reset/refetch (e.g. search terms, filters)
 * @returns {Object} { items, currentPage, totalPages, totalItems, hasNextPage, hasPrevPage, goToPage, nextPage, prevPage, loading, error, refresh }
 */
export const usePaginatedQuery = (queryBuilder, { pageSize = 20, dependencies = [] } = {}) => {
  const [items, setItems] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Cache to store loaded pages: { [pageNumber]: data[] }
  const pageCache = useRef({});
  
  // Keep track of the latest dependencies to avoid race conditions or stale closures
  const depsRef = useRef(dependencies);

  // Helper to check if we can rely on cache
  const getCachedPage = (page) => {
    return pageCache.current[page] || null;
  };

  const fetchPage = useCallback(async (page, isRefresh = false) => {
    setLoading(true);
    setError(null);

    // If not refreshing and we have cache, use it
    if (!isRefresh) {
      const cachedData = getCachedPage(page);
      if (cachedData) {
        setItems(cachedData);
        setLoading(false);
        return;
      }
    }

    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      // Execute the query builder to get the base query
      let query = queryBuilder();

      // Apply range for pagination
      // We assume the user passes a select query. If they need count, they should include { count: 'exact' } in the builder
      query = query.range(from, to);

      const { data, count, error: supabaseError } = await query;

      if (supabaseError) throw supabaseError;

      // Update total items if count is returned (requires { count: 'exact' } in builder)
      if (count !== null) {
        setTotalItems(count);
      }

      const safeData = data || [];
      
      // Update state
      setItems(safeData);
      
      // Update cache
      pageCache.current[page] = safeData;
      
    } catch (err) {
      console.error('Pagination error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [pageSize, queryBuilder]); // Dependencies handled via effect

  // Reset pagination when dependencies change (e.g., searching, filtering)
  useEffect(() => {
    // Check if dependencies actually changed to avoid infinite loops if builder changes reference
    const prevDeps = depsRef.current;
    const depsChanged = JSON.stringify(prevDeps) !== JSON.stringify(dependencies);

    if (depsChanged) {
        pageCache.current = {}; // Clear cache
        setCurrentPage(1); // Reset to page 1
        depsRef.current = dependencies;
        fetchPage(1, true); // Fetch fresh data
    } else if (pageCache.current[1] === undefined) {
        // Initial load
        fetchPage(1, true);
    }
  }, [dependencies, fetchPage]);

  // Handle page changes
  const goToPage = useCallback((page) => {
    const totalPages = Math.ceil(totalItems / pageSize);
    const targetPage = Math.max(1, Math.min(page, totalPages || Infinity));
    
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
      fetchPage(targetPage);
    }
  }, [currentPage, totalItems, pageSize, fetchPage]);

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  // Force refresh of current page (bypassing cache)
  const refresh = useCallback(() => {
    pageCache.current = {}; // Optional: clear entire cache on refresh, or just current page
    fetchPage(currentPage, true);
  }, [currentPage, fetchPage]);

  const totalPages = Math.ceil(totalItems / pageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return {
    items,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    loading,
    error,
    refresh
  };
};