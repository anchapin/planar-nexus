"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface CacheInfo {
  version: string;
  caches: Record<
    string,
    {
      entries: number;
      size: number;
      sizeMB: string;
    }
  >;
}

interface ServiceWorkerCacheHookReturn {
  cacheInfo: CacheInfo | null;
  isLoading: boolean;
  error: string | null;
  clearCache: () => Promise<void>;
  refreshCacheInfo: () => Promise<void>;
  getCacheSize: () => number;
}

export function useServiceWorkerCache(): ServiceWorkerCacheHookReturn {
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageChannelRef = useRef<MessageChannel | null>(null);

  // Initialize message channel
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const channel = new MessageChannel();
    messageChannelRef.current = channel;

    return () => {
      if (messageChannelRef.current) {
        messageChannelRef.current.port1.close();
      }
    };
  }, []);

  const refreshCacheInfo = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !messageChannelRef.current
    ) {
      setError("Service Worker not available");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          setError("Request timeout");
          setIsLoading(false);
          resolve();
        }, 5000);

        messageChannelRef.current!.port1.onmessage = (event) => {
          clearTimeout(timeout);
          setCacheInfo(event.data);
          setIsLoading(false);
          resolve();
        };

        registration.active?.postMessage(
          { type: "GET_CACHE_INFO" },
          [messageChannelRef.current!.port2]
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }, []);

  const clearCache = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !messageChannelRef.current
    ) {
      setError("Service Worker not available");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          setError("Request timeout");
          setIsLoading(false);
          resolve();
        }, 5000);

        messageChannelRef.current!.port1.onmessage = (event) => {
          clearTimeout(timeout);
          if (event.data.success) {
            setCacheInfo(null);
          }
          setIsLoading(false);
          resolve();
        };

        registration.active?.postMessage(
          { type: "CLEAR_CACHE" },
          [messageChannelRef.current!.port2]
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsLoading(false);
    }
  }, []);

  const getCacheSize = useCallback((): number => {
    if (!cacheInfo) return 0;

    let totalSize = 0;
    for (const cacheData of Object.values(cacheInfo.caches)) {
      totalSize += cacheData.size;
    }

    return totalSize;
  }, [cacheInfo]);

  useEffect(() => {
    refreshCacheInfo();
  }, [refreshCacheInfo]);

  return {
    cacheInfo,
    isLoading,
    error,
    clearCache,
    refreshCacheInfo,
    getCacheSize,
  };
}
