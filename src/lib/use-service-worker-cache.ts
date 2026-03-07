"use client";

import { useState, useCallback, useEffect } from "react";

/**
 * Cache information structure
 */
interface CacheInfo {
  name: string;
  entries: number;
  size: number;
}

/**
 * Service worker cache information
 */
interface SWCacheInfo {
  caches: CacheInfo[];
  totalSize: number;
}

/**
 * useServiceWorkerCache Hook
 *
 * Provides methods to interact with the service worker cache.
 * Allows clearing specific caches, getting cache information, and managing cache size.
 */
export function useServiceWorkerCache() {
  const [cacheInfo, setCacheInfo] = useState<SWCacheInfo>({
    caches: [],
    totalSize: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Get cache information from service worker
  const getCacheInfo = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.active) {
        return;
      }

      const messageChannel = new MessageChannel();
      const port = messageChannel.port1;

      port.onmessage = (event) => {
        setCacheInfo(event.data);
        setIsLoading(false);
      };

      registration.active.postMessage(
        { type: "GET_CACHE_INFO" },
        [messageChannel.port2]
      );
    } catch (error) {
      console.error("[Cache] Failed to get cache info:", error);
      setIsLoading(false);
    }
  }, []);

  // Clear a specific cache
  const clearCache = useCallback(async (cacheName: string) => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.active) {
        return;
      }

      registration.active.postMessage({
        type: "CLEAR_CACHE",
        cacheName,
      });

      // Refresh cache info after clearing
      setTimeout(getCacheInfo, 500);
    } catch (error) {
      console.error("[Cache] Failed to clear cache:", error);
    }
  }, [getCacheInfo]);

  // Clear all caches
  const clearAllCaches = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.active) {
        return;
      }

      registration.active.postMessage({
        type: "CLEAR_ALL_CACHES",
      });

      // Refresh cache info after clearing
      setTimeout(getCacheInfo, 500);
    } catch (error) {
      console.error("[Cache] Failed to clear all caches:", error);
    }
  }, [getCacheInfo]);

  // Format bytes to human-readable size
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }, []);

  // Get cache size for a specific cache
  const getCacheSize = useCallback((cacheName: string): number => {
    const cache = cacheInfo.caches.find((c) => c.name === cacheName);
    return cache ? cache.size : 0;
  }, [cacheInfo]);

  // Get total cache size
  const getTotalCacheSize = useCallback((): number => {
    return cacheInfo.totalSize;
  }, [cacheInfo]);

  // Get total number of cached entries
  const getTotalEntries = useCallback((): number => {
    return cacheInfo.caches.reduce((sum, cache) => sum + cache.entries, 0);
  }, [cacheInfo]);

  // Get cache by name
  const getCache = useCallback((cacheName: string): CacheInfo | undefined => {
    return cacheInfo.caches.find((c) => c.name === cacheName);
  }, [cacheInfo]);

  // Refresh cache information
  const refreshCacheInfo = useCallback(() => {
    setIsLoading(true);
    getCacheInfo();
  }, [getCacheInfo]);

  // Initialize cache info on mount
  useEffect(() => {
    getCacheInfo();

    // Refresh cache info periodically
    const intervalId = setInterval(getCacheInfo, 60000); // Every minute

    return () => {
      clearInterval(intervalId);
    };
  }, [getCacheInfo]);

  return {
    cacheInfo,
    isLoading,
    clearCache,
    clearAllCaches,
    formatBytes,
    getCacheSize,
    getTotalCacheSize,
    getTotalEntries,
    getCache,
    refreshCacheInfo,
  };
}
