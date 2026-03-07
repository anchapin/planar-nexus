"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Network status information
 */
interface NetworkStatus {
  isOnline: boolean;
  isSlow: boolean;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
}

/**
 * useNetworkStatus Hook
 *
 * Monitors network status and provides information about connection quality.
 * Useful for adapting UI behavior based on network conditions.
 */
export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: true,
    isSlow: false,
    effectiveType: "4g",
    downlink: 10,
    rtt: 100,
    saveData: false,
  });

  const updateNetworkStatus = useCallback(() => {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

    const isOnline = navigator.onLine;
    const effectiveType = connection?.effectiveType || "4g";
    const downlink = connection?.downlink || 10;
    const rtt = connection?.rtt || 100;
    const saveData = connection?.saveData || false;

    // Consider connection slow if it's 2g, 3g, or has high latency
    const isSlow = effectiveType === "2g" || effectiveType === "3g" || rtt > 300;

    setNetworkStatus({
      isOnline,
      isSlow,
      effectiveType,
      downlink,
      rtt,
      saveData,
    });
  }, []);

  useEffect(() => {
    // Update initial status
    updateNetworkStatus();

    // Listen for online/offline events
    const handleOnline = () => {
      console.log("[Network] Connection restored");
      updateNetworkStatus();
    };

    const handleOffline = () => {
      console.log("[Network] Connection lost");
      updateNetworkStatus();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for network change events
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      const handleNetworkChange = () => {
        console.log("[Network] Connection changed");
        updateNetworkStatus();
      };

      connection.addEventListener("change", handleNetworkChange);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        connection.removeEventListener("change", handleNetworkChange);
      };
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [updateNetworkStatus]);

  // Get a description of the connection type
  const getConnectionDescription = useCallback((): string => {
    if (!networkStatus.isOnline) {
      return "Offline";
    }

    const typeDescriptions: Record<string, string> = {
      "slow-2g": "Very slow",
      "2g": "2G",
      "3g": "3G",
      "4g": "4G",
    };

    return typeDescriptions[networkStatus.effectiveType] || "Unknown";
  }, [networkStatus]);

  // Check if network is suitable for specific actions
  const canStreamMedia = useCallback((): boolean => {
    return networkStatus.isOnline && !networkStatus.isSlow && !networkStatus.saveData;
  }, [networkStatus]);

  const canLoadImages = useCallback((): boolean => {
    return networkStatus.isOnline && !networkStatus.saveData;
  }, [networkStatus]);

  const canUseAI = useCallback((): boolean => {
    return networkStatus.isOnline && networkStatus.effectiveType !== "2g" && networkStatus.effectiveType !== "slow-2g";
  }, [networkStatus]);

  const canPlayMultiplayer = useCallback((): boolean => {
    return networkStatus.isOnline && networkStatus.effectiveType !== "2g" && networkStatus.effectiveType !== "slow-2g";
  }, [networkStatus]);

  return {
    ...networkStatus,
    connectionDescription: getConnectionDescription(),
    canStreamMedia,
    canLoadImages,
    canUseAI,
    canPlayMultiplayer,
  };
}
