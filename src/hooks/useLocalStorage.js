import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook for safely using localStorage with state synchronization.
 * Handles parsing, stringifying, and fallback when localStorage is unavailable.
 * 
 * @param {string} key - The localStorage key
 * @param {any} initialValue - The initial value or function returning it
 * @returns {[any, Function, Function]} - [value, setValue, removeValue]
 */
export function useLocalStorage(key, initialValue) {
  // Initialize state function to read from localStorage only once
  const readValue = useCallback(() => {
    if (typeof window === "undefined") {
      return initialValue instanceof Function ? initialValue() : initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : (initialValue instanceof Function ? initialValue() : initialValue);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue instanceof Function ? initialValue() : initialValue;
    }
  }, [initialValue, key]);

  const [storedValue, setStoredValue] = useState(readValue);

  // Re-read value if key changes
  useEffect(() => {
    setStoredValue(readValue());
  }, [key, readValue]);

  // Return a wrapped version of useState's setter function
  const setValue = useCallback((value) => {
    try {
      setStoredValue((currentValue) => {
        // Allow value to be a function so we have same API as useState
        const valueToStore = value instanceof Function ? value(currentValue) : value;

        // Save to local storage
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          } catch (writeError) {
             console.warn(`Error writing to localStorage key "${key}":`, writeError);
          }
        }

        return valueToStore;
      });
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key]);

  const removeValue = useCallback(() => {
    try {
      const defaultValue = initialValue instanceof Function ? initialValue() : initialValue;
      
      // Reset state to default
      setStoredValue(defaultValue);

      // Remove from local storage
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}