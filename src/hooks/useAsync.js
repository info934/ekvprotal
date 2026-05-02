import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for handling async operations with loading, error states, and cancellation.
 * 
 * @param {Function} asyncFunction - The async function to execute. Can accept an AbortSignal as first argument.
 * @param {Array} dependencies - Dependencies array that triggers re-execution when changed.
 * @param {boolean} [immediate=true] - Whether to execute the function immediately on mount/update.
 * @returns {Object} { execute, status, value, error, isLoading, isSuccess, isError, retry }
 */
export function useAsync(asyncFunction, dependencies = [], immediate = true) {
  const [status, setStatus] = useState('idle');
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);

  // Ref to keep track of the latest request's abort controller
  const abortControllerRef = useRef(null);

  // The execute function that wraps the async operation
  const execute = useCallback(() => {
    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setStatus('pending');
    setValue(null);
    setError(null);

    return asyncFunction(abortController.signal)
      .then((response) => {
        // Only update state if this request wasn't aborted
        if (!abortController.signal.aborted) {
          setValue(response);
          setStatus('success');
        }
        return response;
      })
      .catch((error) => {
        // Ignore abort errors (they are expected when cancelling)
        if (error.name === 'AbortError') {
          return;
        }
        
        // Only update state if this request wasn't aborted
        if (!abortController.signal.aborted) {
          setError(error);
          setStatus('error');
        }
        throw error;
      });
  }, [asyncFunction, ...dependencies]);

  // Effect to run execution on mount/dependencies change
  useEffect(() => {
    if (immediate) {
      execute();
    }
    
    // Cleanup: cancel pending request on unmount or dep change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [execute, immediate]);

  return {
    execute,
    status,
    value,
    error,
    isLoading: status === 'pending',
    isSuccess: status === 'success',
    isError: status === 'error',
    retry: execute,
    data: value // Alias for compatibility with common patterns
  };
}