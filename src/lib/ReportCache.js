const CACHE_PREFIX = 'report_cache_';
const TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

export const getCachedReport = (reportType, filters) => {
  const key = generateCacheKey(reportType, filters);
  const cached = localStorage.getItem(key);
  
  if (!cached) return null;
  
  try {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
};

export const setCachedReport = (reportType, filters, data) => {
  const key = generateCacheKey(reportType, filters);
  const cacheEntry = {
    data,
    timestamp: Date.now()
  };
  
  // Basic LRU or clean up logic: remove old keys if storage is full
  try {
    localStorage.setItem(key, JSON.stringify(cacheEntry));
  } catch (e) {
    // If storage full, clear old report caches
    clearReportCache();
    try {
      localStorage.setItem(key, JSON.stringify(cacheEntry));
    } catch (e2) {
      console.warn('LocalStorage full, cannot cache report');
    }
  }
};

export const clearReportCache = () => {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(CACHE_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
};

const generateCacheKey = (reportType, filters) => {
  // Sort keys to ensure consistent hash
  const sortedFilters = Object.keys(filters || {})
    .sort()
    .reduce((acc, key) => {
      acc[key] = filters[key];
      return acc;
    }, {});
    
  return `${CACHE_PREFIX}${reportType}_${JSON.stringify(sortedFilters)}`;
};