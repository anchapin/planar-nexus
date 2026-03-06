"use client";

import { useEffect, useState, useCallback } from "react";

interface NetworkStatus {
  isOnline: boolean;
  effectiveType?: string;
  saveData: boolean;
  downlink?: number;
  rtt?: number;
}

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    saveData: false,
  });

  const updateStatus = useCallback(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    const connection =
      "connection" in navigator &&
      (navigator.connection as {
        effectiveType?: string;
        saveData?: boolean;
        downlink?: number;
        rtt?: number;
      });

    setStatus({
      isOnline: navigator.onLine,
      effectiveType: connection?.effectiveType,
      saveData: connection?.saveData ?? false,
      downlink: connection?.downlink,
      rtt: connection?.rtt,
    });
  }, []);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined") {
      return false;
    }

    try {
      // Try to fetch a small resource to verify actual connectivity
      const response = await fetch("/manifest.json", {
        method: "HEAD",
        cache: "no-cache",
      });

      const isActuallyOnline = response.ok;
      setStatus((prev) => ({ ...prev, isOnline: isActuallyOnline }));
      return isActuallyOnline;
    } catch (error) {
      setStatus((prev) => ({ ...prev, isOnline: false }));
      return false;
    }
  }, []);

  useEffect(() => {
    updateStatus();

    const handleOnline = () => {
      setStatus((prev) => ({ ...prev, isOnline: true }));
    };

    const handleOffline = () => {
      setStatus((prev) => ({ ...prev, isOnline: false }));
    };

    const handleConnectionChange = () => {
      updateStatus();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for connection changes if available
    if ("connection" in navigator) {
      const connection = navigator.connection as {
        addEventListener: (
          type: string,
          listener: () => void
        ) => void;
        removeEventListener: (
          type: string,
          listener: () => void
        ) => void;
      };

      connection.addEventListener("change", handleConnectionChange);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);

      if ("connection" in navigator) {
        const connection = navigator.connection as {
          removeEventListener: (
            type: string,
            listener: () => void
          ) => void;
        };

        connection.removeEventListener("change", handleConnectionChange);
      }
    };
  }, [updateStatus]);

  return {
    ...status,
    checkConnection,
  };
}
