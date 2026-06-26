"use client";

/**
 * @fileOverview React hook exposing IndexedDB storage quota awareness to the UI.
 *
 * Issue #1085: large card collections can exhaust the origin storage quota and
 * start losing writes. This hook polls navigator.storage.estimate() (via
 * getStorageEstimate), surfaces a single non-blocking toast warning when usage
 * crosses the warn threshold, and exposes the current status so components can
 * degrade (e.g. offer export / hide heavy write actions) instead of bricking.
 *
 * No native alerts (per #1100/#1150) — uses the shadcn toast primitive.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getQuotaRemediationMessage,
  getStorageEstimate,
  type StorageQuotaEstimate,
} from "@/lib/storage-quota";
import { toast } from "@/hooks/use-toast";

export interface UseStorageQuotaResult {
  /** Latest storage estimate, or null before the first check resolves. */
  estimate: StorageQuotaEstimate | null;
  /** True when usage is at/above the warn threshold but below critical. */
  isNearQuota: boolean;
  /** True when usage is at/above the critical threshold (writes likely failing). */
  isCritical: boolean;
  /** True when the Storage API is unavailable (cannot determine status). */
  unavailable: boolean;
  /** Manually re-run the estimate (e.g. after a large write). */
  refresh: () => Promise<StorageQuotaEstimate>;
}

/** Re-check interval. Kept coarse — estimate() is cheap but we avoid busy polling. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useStorageQuota(autoToast = true): UseStorageQuotaResult {
  const [estimate, setEstimate] = useState<StorageQuotaEstimate | null>(null);
  const warnedRef = useRef(false);

  const refresh = useCallback(async () => {
    const next = await getStorageEstimate();
    setEstimate(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;

    const run = async () => {
      const next = await getStorageEstimate();
      if (!active) return;
      setEstimate(next);

      const overLimit =
        next.level === "warning" || next.level === "critical";
      // Fire the warning once per excursion into warn/critical; reset when
      // usage drops back to ok so a later excursion warns again.
      if (autoToast && overLimit && !warnedRef.current) {
        warnedRef.current = true;
        toast({
          variant: "destructive",
          title: next.level === "critical" ? "Storage full" : "Storage almost full",
          description: getQuotaRemediationMessage(next.level),
        });
      } else if (next.level === "ok") {
        warnedRef.current = false;
      }
    };

    run();
    const interval = setInterval(run, CHECK_INTERVAL_MS);
    const onFocus = () => run();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      active = false;
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [autoToast]);

  return {
    estimate,
    isNearQuota: estimate?.level === "warning",
    isCritical: estimate?.level === "critical",
    unavailable: estimate?.level === "unknown",
    refresh,
  };
}
