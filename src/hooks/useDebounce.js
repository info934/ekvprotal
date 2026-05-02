import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Custom hook for debouncing function calls.
 * Returns a memoized version of the callback that only invokes the function
 * after a specified delay has passed since the last call.
 * 
 * @param {Function} callback - The function to debounce
 * @param {number} delay - The delay in milliseconds (default: 300ms)
 * @returns {Function} - The debounced function with a .cancel() method attached
 */
export function useDebounce(callback, delay = 300) {
  const timeoutRef = useRef(null);
  const callbackRef = useRef(callback);

  // Keep the latest callback ref to avoid re-creating the debounced function
  // when only the callback changes, while still calling the latest version.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useMemo(() => {
    const func = (...args) => {
      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        if (callbackRef.current) {
          callbackRef.current(...args);
        }
      }, delay);
    };

    // Attach cancel method
    func.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    return func;
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * Custom hook for debouncing a value (commonly used for search inputs).
 * Returns a stateful value that updates only after the delay.
 * 
 * @param {any} value - The value to debounce
 * @param {number} delay - The delay in milliseconds
 * @returns {any} - The debounced value
 */
export function useDebouncedValue(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}