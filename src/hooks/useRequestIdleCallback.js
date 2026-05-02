import { useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for scheduling low-priority background tasks using requestIdleCallback API.
 * Provides a fallback to setTimeout for environments where requestIdleCallback is not supported.
 * 
 * @returns {Function} scheduleTask - Function to schedule a callback during idle periods.
 *                     Attached to this function is a .cancel() method.
 */
export function useRequestIdleCallback() {
  const handleIdRef = useRef(null);

  // Check if requestIdleCallback is supported
  const isSupported = typeof window !== 'undefined' && 'requestIdleCallback' in window;

  // Cleanup function to cancel any pending task
  const cancelIdleCallback = useCallback((id) => {
    if (isSupported) {
      window.cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  }, [isSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (handleIdRef.current) {
        cancelIdleCallback(handleIdRef.current);
      }
    };
  }, [cancelIdleCallback]);

  // The main scheduling function
  const scheduleTask = useCallback((callback, options = { timeout: 2000 }) => {
    // Cancel any existing pending task managed by this hook instance
    if (handleIdRef.current) {
      cancelIdleCallback(handleIdRef.current);
    }

    if (isSupported) {
      handleIdRef.current = window.requestIdleCallback((deadline) => {
        // Execute the callback passing the deadline object
        callback(deadline);
        handleIdRef.current = null;
      }, options);
    } else {
      // Fallback: use setTimeout to defer execution
      // We mimic the deadline object for compatibility
      const start = Date.now();
      handleIdRef.current = setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
        });
        handleIdRef.current = null;
      }, 1); // Short timeout to push to next tick
    }
    
    return handleIdRef.current;
  }, [isSupported, cancelIdleCallback]);

  // Attach cancel method to the returned function for manual cancellation
  scheduleTask.cancel = () => {
    if (handleIdRef.current) {
      cancelIdleCallback(handleIdRef.current);
      handleIdRef.current = null;
    }
  };

  return scheduleTask;
}