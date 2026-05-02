/**
 * Performance Monitoring Utility
 * Provides tools to measure render times, track memory usage, monitor network requests,
 * and analyze bundle sizes using the Performance API.
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.slowQueries = [];
    this.isSupported = typeof window !== 'undefined' && !!window.performance;
    
    // Initialize storage for metrics
    this.clear();
  }

  /**
   * Starts measuring a specific operation
   * @param {string} label - Unique label for the measurement
   */
  startMeasure(label) {
    if (!this.isSupported) return;
    try {
      // Clear previous marks with same name to avoid confusion
      if (performance.getEntriesByName(`${label}-start`).length > 0) {
        performance.clearMarks(`${label}-start`);
      }
      performance.mark(`${label}-start`);
    } catch (e) {
      console.warn('Performance mark failed:', e);
    }
  }

  /**
   * Ends measurement for a specific operation and logs the duration
   * @param {string} label - Unique label matching the startMeasure call
   * @returns {number} Duration in milliseconds
   */
  endMeasure(label) {
    if (!this.isSupported) return 0;
    
    const startMark = `${label}-start`;
    const endMark = `${label}-end`;
    
    try {
      performance.mark(endMark);
      
      // Measure duration between marks
      performance.measure(label, startMark, endMark);
      
      const entries = performance.getEntriesByName(label);
      const lastEntry = entries[entries.length - 1];
      const duration = lastEntry ? lastEntry.duration : 0;
      
      this.logMetric(label, duration);
      
      // Cleanup
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(label);
      
      return duration;
    } catch (e) {
      console.warn(`Failed to measure performance for ${label}:`, e);
      return 0;
    }
  }

  /**
   * Logs a generic metric value
   * @param {string} name - Metric name
   * @param {any} value - Metric value (number, object, string)
   */
  logMetric(name, value) {
    if (!this.metrics[name]) {
      this.metrics[name] = [];
    }
    
    this.metrics[name].push({
      timestamp: Date.now(),
      value
    });
  }

  /**
   * Wrapper for async operations (like API calls) to automatically track duration
   * and log slow queries (> 1s)
   * 
   * @param {string} queryName - Name of the query/operation
   * @param {Function} queryFn - Async function to execute
   * @param {number} [threshold=1000] - Threshold in ms for "slow" classification
   * @returns {Promise<any>} Result of the queryFn
   */
  async trackQuery(queryName, queryFn, threshold = 1000) {
    const start = performance.now();
    try {
      const result = await queryFn();
      const duration = performance.now() - start;
      
      this.logMetric(`query_${queryName}`, duration);
      
      if (duration > threshold) {
        const slowQueryLog = {
          query: queryName,
          duration,
          timestamp: new Date().toISOString(),
          threshold
        };
        this.slowQueries.push(slowQueryLog);
        console.warn(`[PerfMonitor] Slow query detected: ${queryName} took ${duration.toFixed(2)}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.logMetric(`query_${queryName}_error`, duration);
      throw error;
    }
  }

  /**
   * React Profiler onRender callback
   * Can be passed directly to the `onRender` prop of a <Profiler> component
   */
  onRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    this.logMetric(`render_${id}`, {
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime
    });
    
    // Warn if render takes too long (e.g., > 16ms which causes frame drops)
    if (actualDuration > 16) {
      console.debug(`[PerfMonitor] Slow render detected in ${id}: ${actualDuration.toFixed(2)}ms (${phase})`);
    }
  };

  /**
   * Gets current memory usage stats (Chrome only)
   * @returns {Object|null} Memory stats or null if not supported
   */
  getMemoryUsage() {
    if (this.isSupported && window.performance && window.performance.memory) {
      const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = window.performance.memory;
      return {
        usedJSHeapSize: this._formatBytes(usedJSHeapSize),
        totalJSHeapSize: this._formatBytes(totalJSHeapSize),
        jsHeapSizeLimit: this._formatBytes(jsHeapSizeLimit),
        usagePercentage: ((usedJSHeapSize / jsHeapSizeLimit) * 100).toFixed(2) + '%'
      };
    }
    return null;
  }

  /**
   * Analyzes loaded resources to approximate bundle size
   * @returns {Object} Stats about scripts, css, images, etc.
   */
  getBundleSize() {
    if (!this.isSupported) return null;
    
    const resources = performance.getEntriesByType("resource");
    
    const analyzeType = (initiatorTypes, extension) => {
      const filtered = resources.filter(r => 
        initiatorTypes.includes(r.initiatorType) || (r.name && r.name.endsWith(extension))
      );
      
      const totalBytes = filtered.reduce((acc, curr) => acc + (curr.transferSize || curr.encodedBodySize || 0), 0);
      
      return {
        count: filtered.length,
        sizeBytes: totalBytes,
        sizeFormatted: this._formatBytes(totalBytes)
      };
    };

    return {
      scripts: analyzeType(['script'], '.js'),
      styles: analyzeType(['link', 'css'], '.css'),
      images: analyzeType(['img', 'image'], ''),
      totalResources: resources.length
    };
  }

  /**
   * Returns a comprehensive report of all collected metrics
   */
  getReport() {
    return {
      generatedAt: new Date().toISOString(),
      memory: this.getMemoryUsage(),
      bundle: this.getBundleSize(),
      slowQueries: this.slowQueries,
      metricsSummary: this._summarizeMetrics()
    };
  }

  /**
   * Clears all collected metrics
   */
  clear() {
    this.metrics = {};
    this.slowQueries = [];
    if (this.isSupported) {
      performance.clearMarks();
      performance.clearMeasures();
    }
  }

  // --- Private Helpers ---

  _formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  _summarizeMetrics() {
    const summary = {};
    Object.keys(this.metrics).forEach(key => {
      const values = this.metrics[key].map(m => typeof m.value === 'number' ? m.value : 0);
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const max = Math.max(...values);
        summary[key] = {
          count: values.length,
          avg: avg.toFixed(2),
          max: max.toFixed(2)
        };
      }
    });
    return summary;
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();