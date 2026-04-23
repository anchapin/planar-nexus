"use client";

import {
  useState,
  useEffect,
  Dispatch,
  SetStateAction,
  useCallback,
} from "react";
import { indexedDBStorage } from "@/lib/indexeddb-storage";

/**
 * IndexedDB-based storage hook
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - Persistent storage using IndexedDB
 * - Fallback to localStorage for backward compatibility
 * - Loading states and error handling
 * - Support for complex data types
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>, { loading: boolean; error: Error | null }] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Validate that a loaded value matches the expected type of initialValue
  const validateLoadedValue = useCallback(
    (loaded: unknown): T => {
      // Arrays
      if (Array.isArray(initialValue)) {
        if (Array.isArray(loaded)) return loaded as T;
        console.warn(
          `Storage key "${key}" expected array but got ${typeof loaded}. Resetting to default.`,
        );
        return initialValue;
      }
      // Objects (non-null, non-array)
      if (
        initialValue !== null &&
        typeof initialValue === "object" &&
        !Array.isArray(initialValue)
      ) {
        if (
          loaded !== null &&
          typeof loaded === "object" &&
          !Array.isArray(loaded)
        ) {
          return loaded as T;
        }
        console.warn(
          `Storage key "${key}" expected object but got ${typeof loaded}. Resetting to default.`,
        );
        return initialValue;
      }
      // Primitives and null
      if (typeof loaded === typeof initialValue) {
        return loaded as T;
      }
      console.warn(
        `Storage key "${key}" expected ${typeof initialValue} but got ${typeof loaded}. Resetting to default.`,
      );
      return initialValue;
    },
    [key, initialValue],
  );

  // Initialize storage and load value
  useEffect(() => {
    let isMounted = true;

    const loadValue = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try IndexedDB first
        try {
          await indexedDBStorage.initialize();
          const value = await indexedDBStorage.get<Record<string, unknown>>(
            "preferences",
            key,
          );

          if (value !== null && isMounted) {
            let parsed: unknown;
            // Handle arrays stored with the wrapped format (_type: 'array')
            if (value._type === "array" && Array.isArray(value.items)) {
              parsed = value.items;
            } else if (value && typeof value === "object") {
              // Handle old broken array format: { id, 0: item1, 1: item2, ... }
              // where numeric keys were spread from an array into an object
              const { id, _type, ...rest } = value;
              const keys = Object.keys(rest);
              const numericKeys = keys.filter((k) => /^\d+$/.test(k));
              if (
                numericKeys.length > 0 &&
                numericKeys.length === keys.length
              ) {
                parsed = numericKeys
                  .sort((a, b) => parseInt(a) - parseInt(b))
                  .map((k) => rest[k]);
              } else {
                // Regular object
                parsed = rest;
              }
            } else {
              parsed = value;
            }
            setStoredValue(validateLoadedValue(parsed));
          } else if (isMounted) {
            setStoredValue(initialValue);
          }
        } catch (dbError) {
          // Fallback to localStorage
          console.warn(
            `IndexedDB not available, using localStorage for "${key}":`,
            dbError,
          );
          const item = window.localStorage.getItem(key);
          if (item && isMounted) {
            const parsed = JSON.parse(item);
            setStoredValue(validateLoadedValue(parsed));
          } else if (isMounted) {
            setStoredValue(initialValue);
          }
        }
      } catch (err) {
        console.error(`Error loading storage key "${key}":`, err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStoredValue(initialValue);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadValue();

    return () => {
      isMounted = false;
    };
  }, [key, initialValue, validateLoadedValue]);

  // Save value when it changes
  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    async (value) => {
      try {
        setError(null);
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);

        // Try IndexedDB first
        try {
          if (Array.isArray(valueToStore)) {
            // Store arrays in a wrapped format so they don't get spread into objects
            await indexedDBStorage.set("preferences", {
              id: key,
              _type: "array",
              items: valueToStore,
            } as unknown as T & { id: string });
          } else {
            await indexedDBStorage.set("preferences", {
              id: key,
              ...valueToStore,
            } as T & { id: string });
          }
        } catch (dbError) {
          // Fallback to localStorage
          console.warn(
            `IndexedDB not available, using localStorage for "${key}":`,
            dbError,
          );
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (err) {
        console.error(`Error setting storage key "${key}":`, err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [key, storedValue],
  );

  return [storedValue, setValue, { loading, error }];
}

/**
 * Simple localStorage hook for non-critical data
 *
 * Use this for data that doesn't require IndexedDB's capabilities
 * or for backward compatibility during migration.
 */
export function useSimpleLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  // We need to use a client-side effect to read from localStorage
  // This avoids a hydration mismatch between server and client
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
    }
  }, [key]);

  const setValue: Dispatch<SetStateAction<T>> = (value) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue];
}

/**
 * Check if IndexedDB is available and initialized
 */
export function useIndexedDBStatus(): {
  available: boolean;
  initialized: boolean;
  initializing: boolean;
} {
  const [available, setAvailable] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [initializing, setInitializing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkStatus = async () => {
      setInitializing(true);

      try {
        // Check if IndexedDB is available
        if (!window.indexedDB) {
          setAvailable(false);
          setInitialized(false);
          return;
        }

        setAvailable(true);

        // Try to initialize
        await indexedDBStorage.initialize();

        if (isMounted) {
          setInitialized(true);
        }
      } catch (error) {
        console.error("IndexedDB initialization failed:", error);
        if (isMounted) {
          setAvailable(false);
          setInitialized(false);
        }
      } finally {
        if (isMounted) {
          setInitializing(false);
        }
      }
    };

    checkStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  return { available, initialized, initializing };
}
