"use client";

import { useState, useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";

/**
 * OfflineIndicator Component
 *
 * Displays the current network status and provides feedback about offline availability.
 * Shows which features work offline and which require connection.
 */

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log("[Offline] Connection restored");
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log("[Offline] Connection lost");
    };

    // Check initial status
    setIsOnline(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) {
    return (
      <div
        className="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-xs font-medium"
        role="status"
        aria-live="polite"
      >
        <Wifi className="w-4 h-4" />
        <span>Online</span>
      </div>
    );
  }

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2"
      role="status"
      aria-live="polite"
    >
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
        aria-expanded={showDetails}
        aria-label={`${showDetails ? 'Hide' : 'Show'} offline details`}
      >
        <WifiOff className="w-4 h-4" />
        <span>Offline</span>
      </button>

      {showDetails && (
        <div className="w-72 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Offline Mode</h3>

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 mt-1.5 rounded-full bg-green-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-medium">Available Offline</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Card search, deck building, game play, saved games
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="w-2 h-2 mt-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-medium">Requires Connection</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Multiplayer, card images, AI features
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-medium">Data Synced</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Your changes will sync when you're back online
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>Waiting for connection...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
