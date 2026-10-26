"use client";

import { useEffect, useState, useCallback } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { captureError, initTelemetry } from "@/lib/telemetry";
import {
  installAppEventRecorder,
  recordAppEvent,
} from "@/lib/app-event-recorder";

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

// Issue #2604 (diagnosis step 2): install the shared app-side event
// recorder at MODULE scope rather than inside an effect.
//
// The root layout mounts this component on EVERY page (src/app/layout.tsx),
// and React runs child effects BEFORE parent effects — so a recorder
// installed from this component's `useEffect` would start listening AFTER
// the page's own components had already opened their databases, missing
// exactly the open/upgrade/blocked events this diagnosis correlates.
// Module scope runs as soon as the client chunk is evaluated, i.e. before
// any effect. The `typeof window` guard keeps the server render (this
// module is also evaluated during SSR) a no-op.
if (typeof window !== "undefined") {
  installAppEventRecorder();
}

export function ServiceWorkerRegistration() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
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
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      setIsInstalled(true);
    }

    // Issue #1112: install global unhandled-exception listeners (consent-gated,
    // idempotent, no-op during SSR). Captures nothing unless the user opts in.
    initTelemetry();

    // Track online/offline status — surface as a persistent banner + toast
    const handleOnline = () => {
      setSwStatus((prev) => ({ ...prev, isOnline: true }));
      toast({
        title: "Back online",
        description: "Your connection has been restored.",
      });
    };

    const handleOffline = () => {
      setSwStatus((prev) => ({ ...prev, isOnline: false }));
      toast({
        title: "You're offline",
        description: "Changes will sync when you reconnect.",
        variant: "destructive",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check initial online status
    setSwStatus((prev) => ({ ...prev, isOnline: navigator.onLine }));

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Register service worker
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          // Some environments resolve register() without a registration
          // (Playwright's `serviceWorkers: "block"` does). Nothing to set up
          // then, and no "ready for offline" claim to make.
          if (!registration) return;

          toast({
            title: "Ready for offline use",
            description:
              "Planar Nexus is cached and can run without a connection.",
          });

          // Get cache information
          getCacheInfo();

          // Check for updates
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  setIsUpdateAvailable(true);
                  setSwStatus((prev) => ({ ...prev, lastUpdated: Date.now() }));
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
          // Issue #1112: report SW registration failures (consent-gated; no-op when off).
          captureError(error, "SW", "Service Worker registration failed");
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
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
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

      setSwStatus((prev) => ({
        ...prev,
        cacheSize: totalSize,
        cacheNames: cacheNames,
      }));
    } catch (error) {
      console.error("[SW] Failed to get cache info:", error);
      captureError(error, "SW", "Failed to get cache info");
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
    // Issue #2604 (diagnosis step 2): record the reload TRIGGER before
    // the reload destroys the document. The entry is mirrored into
    // sessionStorage, so it survives the navigation and can be correlated
    // with the navigation diagnostics in the e2e fixture.
    recordAppEvent(
      "sw-reload:update-available-click",
      "user clicked 'Update Available' (new service worker installed)",
    );
    window.location.reload();
  }, []);

  // Clear caches
  const handleClearCache = useCallback(async () => {
    if (typeof caches === "undefined") return;

    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      setSwStatus((prev) => ({
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
      captureError(error, "SW", "Failed to clear caches");
    }
  }, []);

  // Force service worker update
  const handleForceUpdate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        registration.unregister();
        // Issue #2604 (diagnosis step 2): same as the update button above
        // — distinct label so the two service-worker reload triggers can
        // be told apart in the correlated log.
        recordAppEvent(
          "sw-reload:force-update-click",
          "user clicked 'Force Update' (service worker unregistered)",
        );
        window.location.reload();
      }
    } catch (error) {
      console.error("[SW] Failed to force update:", error);
      captureError(error, "SW", "Failed to force SW update");
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
            className="px-3 py-2 bg-background/80 backdrop-blur-xs border border-border rounded-lg shadow-lg hover:bg-background/90 transition-colors text-xs font-medium flex items-center gap-2"
            aria-label="Open service worker settings"
          >
            <div
              className={`w-2 h-2 rounded-full ${swStatus.isOnline ? "bg-green-500" : "bg-red-500"}`}
            />
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
                <div
                  className={`w-3 h-3 rounded-full ${swStatus.isOnline ? "bg-green-500" : "bg-red-500"}`}
                />
                <span className="text-sm">
                  {swStatus.isOnline ? "Online" : "Offline"}
                </span>
              </div>

              {/* Cache Information */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Cache Size:</span>
                  <span className="font-medium">
                    {formatBytes(swStatus.cacheSize)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>Caches:</span>
                  <span className="font-medium">
                    {swStatus.cacheNames.length}
                  </span>
                </div>
                {swStatus.lastUpdated && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Last Update:</span>
                    <span>
                      {new Date(swStatus.lastUpdated).toLocaleTimeString()}
                    </span>
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
