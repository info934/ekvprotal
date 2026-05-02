import { useEffect, useRef, useMemo, useState } from 'react';

/**
 * Custom hook for throttling function calls.
 * Ensures the function is called at most once every specified interval.
 * 
 * @param {Function} callback - The function to throttle
 * @param {number} delay - The interval in milliseconds (default: 300ms)
 * @returns {Function} - The throttled function with a .cancel() method attached
 */
export function useThrottle(callback, delay = 300) {
  const lastRun = useRef(0);
  const timeout = useRef(null);
  const callbackRef = useRef(callback);

  // Keep the latest callback reference
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Create the throttled function using useMemo to ensure stability
  const throttledCallback = useMemo(() => {
    const func = (...args) => {
      const now = Date.now();
      const timeSinceLastRun = now - lastRun.current;

      // If enough time has passed, execute immediately (leading edge)
      if (timeSinceLastRun >= delay) {
        if (timeout.current) {
          clearTimeout(timeout.current);
          timeout.current = null;
        }
        lastRun.current = now;
        if (callbackRef.current) {
          callbackRef.current(...args);
        }
      } else {
        // Otherwise schedule for the end of the interval (trailing edge)
        if (!timeout.current) {
          const remaining = delay - timeSinceLastRun;
          timeout.current = setTimeout(() => {
            lastRun.current = Date.now();
            timeout.current = null;
            if (callbackRef.current) {
              callbackRef.current(...args);
            }
          }, remaining);
        }
      }
    };

    // Attach cancel method
    func.cancel = () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
        timeout.current = null;
      }
      lastRun.current = 0; // Reset so the next call can be immediate
    };

    return func;
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
  }, []);

  return throttledCallback;
}

/**
 * Custom hook for throttling a value (e.g. for scroll positions or resize observers).
 * 
 * @param {any} value - The value to throttle
 * @param {number} delay - The interval in milliseconds
 * @returns {any} - The throttled value
 */
export function useThrottledValue(value, delay = 300) {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastRan = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRan.current >= delay) {
        setThrottledValue(value);
        lastRan.current = Date.now();
      }
    }, delay - (Date.now() - lastRan.current));

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return throttledValue;
}