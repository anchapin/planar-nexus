"use client";

import { useEffect, useState, useCallback } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface ServiceWorkerStatus {
  isOnline: boolean;
  cacheSize: number;
  cacheNames: string[];
  lastUpdated: number | null;
}

export function ServiceWorkerRegistration() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [swStatus, setSwStatus] = useState<ServiceWorkerStatus>({
    isOnline: true,
    cacheSize: 0,
    cacheNames: [],
    lastUpdated: null,
  });

  useEffect(() => {
    // Check if already installed
    if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Track online/offline status — surface as a persistent banner + toast
    const handleOnline = () => {
      setSwStatus(prev => ({ ...prev, isOnline: true }));
      toast({
        title: "Back online",
        description: "Your connection has been restored.",
      });
    };

    const handleOffline = () => {
      setSwStatus(prev => ({ ...prev, isOnline: false }));
      toast({
        title: "You're offline",
        description: "Changes will sync when you reconnect.",
        variant: "destructive",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check initial online status
    setSwStatus(prev => ({ ...prev, isOnline: navigator.onLine }));

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          toast({
            title: "Ready for offline use",
            description: "Planar Nexus is cached and can run without a connection.",
          });

          // Get cache information
          getCacheInfo();

          // Check for updates
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  setIsUpdateAvailable(true);
                  setSwStatus(prev => ({ ...prev, lastUpdated: Date.now() }));
                  toast({
                    title: "Update available",
                    description: "A new version is ready. Reload to update.",
                  });
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    }

    // Handle beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Handle app installed
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      toast({
        title: "Installed",
        description: "Planar Nexus has been added to your device.",
      });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Periodic cache info updates
    const intervalId = setInterval(getCacheInfo, 60000); // Every minute

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get cache information
  const getCacheInfo = useCallback(async () => {
    if (typeof caches === "undefined") return;

    try {
      const cacheNames = await caches.keys();
      let totalSize = 0;

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
          }
        }
      }

      setSwStatus(prev => ({
        ...prev,
        cacheSize: totalSize,
        cacheNames: cacheNames,
      }));
    } catch (error) {
      console.error("[SW] Failed to get cache info:", error);
    }
  }, []);

  // Format bytes to human-readable size
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }, []);

  // Handle install prompt
  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  // Handle update click
  const handleUpdateClick = useCallback(() => {
    window.location.reload();
  }, []);

  // Clear caches
  const handleClearCache = useCallback(async () => {
    if (typeof caches === "undefined") return;

    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));

      setSwStatus(prev => ({
        ...prev,
        cacheSize: 0,
        cacheNames: [],
      }));

      toast({
        title: "Cache cleared",
        description: `${cacheNames.length} cache${cacheNames.length === 1 ? "" : "s"} removed.`,
      });
      setShowSettings(false);
    } catch (error) {
      console.error("[SW] Failed to clear caches:", error);
    }
  }, []);

  // Force service worker update
  const handleForceUpdate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        registration.unregister();
        window.location.reload();
      }
    } catch (error) {
      console.error("[SW] Failed to force update:", error);
    }
  }, []);

  return (
    <>
      {/* Persistent offline banner — the primary visual indicator for lost connectivity */}
      {!swStatus.isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 bg-yellow-600 text-white px-4 py-2 text-sm font-medium shadow-md"
        >
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          You&apos;re offline — changes will sync when you reconnect
        </div>
      )}

      {/* Show install prompt button if not installed and prompt available */}
      {deferredPrompt && !isInstalled ? (
        <div
          className="fixed bottom-4 right-4 z-50"
          role="complementary"
          aria-label="Install app"
        >
          <button
            onClick={handleInstallClick}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg shadow-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            aria-label="Install Planar Nexus as an app"
          >
            Install App
          </button>
        </div>
      ) : isUpdateAvailable ? (
        /* Show update button if update available */
        <div
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end"
          role="complementary"
          aria-label="Update available"
        >
          <button
            onClick={handleUpdateClick}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg shadow-lg hover:bg-yellow-700 transition-colors text-sm font-medium"
            aria-label="Update to latest version"
          >
            Update Available
          </button>
        </div>
      ) : (
        /* Show settings button */
        <div className="fixed bottom-4 left-4 z-50">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-2 bg-background/80 backdrop-blur-sm border border-border rounded-lg shadow-lg hover:bg-background/90 transition-colors text-xs font-medium flex items-center gap-2"
            aria-label="Open service worker settings"
          >
            <div className={`w-2 h-2 rounded-full ${swStatus.isOnline ? "bg-green-500" : "bg-red-500"}`} />
            {formatBytes(swStatus.cacheSize)}
          </button>

          {showSettings && (
            <div className="absolute bottom-full left-0 mb-2 w-72 bg-background border border-border rounded-lg shadow-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Service Worker</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-500 hover:text-gray-700"
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>

              {/* Online Status */}
              <div className="flex items-center gap-2 mb-3 p-2 bg-muted rounded">
                <div className={`w-3 h-3 rounded-full ${swStatus.isOnline ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-sm">
                  {swStatus.isOnline ? "Online" : "Offline"}
                </span>
              </div>

              {/* Cache Information */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Cache Size:</span>
                  <span className="font-medium">{formatBytes(swStatus.cacheSize)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Caches:</span>
                  <span className="font-medium">{swStatus.cacheNames.length}</span>
                </div>
                {swStatus.lastUpdated && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Last Update:</span>
                    <span>{new Date(swStatus.lastUpdated).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button
                  onClick={handleClearCache}
                  className="w-full px-3 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors text-sm"
                >
                  Clear Cache
                </button>
                <button
                  onClick={handleForceUpdate}
                  className="w-full px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm"
                >
                  Force Update
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
