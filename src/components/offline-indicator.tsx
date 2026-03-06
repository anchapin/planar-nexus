"use client";

import { useEffect, useState } from "react";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
    };

    // Listen for online/offline events
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Check initial status
    updateOnlineStatus();

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const response = await fetch("/manifest.json", {
        method: "HEAD",
        cache: "no-cache",
      });
      setIsOnline(response.ok);
    } catch (error) {
      setIsOnline(false);
    } finally {
      setIsChecking(false);
    }
  };

  if (isOnline) {
    return null;
  }

  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-red-900/90 text-white rounded-lg shadow-lg backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-center justify-center">
        <div className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-75"></div>
        <div className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></div>
      </div>
      <span className="text-sm font-medium">You're offline</span>
      <button
        onClick={checkConnection}
        disabled={isChecking}
        className="ml-2 px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs transition-colors disabled:opacity-50"
        aria-label="Check connection"
      >
        {isChecking ? "Checking..." : "Retry"}
      </button>
    </div>
  );
}
