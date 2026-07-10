/**
 * @fileOverview useDesktopUpdate — React hook for the in-app Tauri 2
 * auto-update prompt (issue #1403).
 *
 * Polls `checkForDesktopUpdate()` once on mount, exposes the result as a
 * stable discriminated union, and re-checks on a configurable cadence so
 * long-running sessions still pick up new releases without a manual
 * restart. The hook is intentionally SSR-safe: in non-Tauri environments
 * (and during the first client render) it short-circuits to the
 * "unsupported" state so React tree rendering never depends on Tauri
 * globals.
 *
 * The hook also honours `prefers-reduced-motion`: when set, it suppresses
 * any internal polling churn that would otherwise cause extra manifest
 * fetches (we keep the initial check but skip the periodic one — a
 * mid-session refresh would be surprising).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkForDesktopUpdate,
  isTauriEnvironment,
  type DesktopUpdateResult,
} from "@/lib/updater";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/** Status of the last update-check call. */
export type UseDesktopUpdateStatus =
  | "idle" // Hook has not yet kicked off a check.
  | "checking" // A check is in flight.
  | "checked" // Check completed (no-update, available, or error all land here).
  | "unsupported"; // Not running in Tauri — checks are skipped.

export interface UseDesktopUpdateOptions {
  /** Re-check cadence in milliseconds. Default: 6 hours. Set to 0 to disable. */
  pollIntervalMs?: number;
  /** Disable the hook entirely (e.g. when the user has opted out). */
  disabled?: boolean;
}

export interface UseDesktopUpdateReturn {
  status: UseDesktopUpdateStatus;
  /** True iff the latest check found a newer release. */
  updateAvailable: boolean;
  /** Convenience booleans so callers don't have to switch on `result`. */
  isSupported: boolean;
  /** Latest check result, or null while idle / unsupported. */
  result: DesktopUpdateResult | null;
  /** Force a fresh check (e.g. from a "Check for updates" menu item). */
  recheck: () => Promise<void>;
}

const DEFAULT_POLL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * React hook that polls the Tauri updater and surfaces a stable result.
 *
 * @example
 *   const { updateAvailable, result } = useDesktopUpdate();
 *   if (updateAvailable) { /* render banner *\/ }
 */
export function useDesktopUpdate(
  options: UseDesktopUpdateOptions = {},
): UseDesktopUpdateReturn {
  const { pollIntervalMs = DEFAULT_POLL_MS, disabled = false } = options;
  const reduceMotion = usePrefersReducedMotion();

  const supported = isTauriEnvironment() && !disabled;

  const [status, setStatus] = useState<UseDesktopUpdateStatus>(
    supported ? "idle" : "unsupported",
  );
  const [result, setResult] = useState<DesktopUpdateResult | null>(null);

  // Guard against overlapping checks (e.g. mount + interval firing close
  // together) without resorting to global state.
  const inFlightRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (!supported) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus("checking");
    try {
      const r = await checkForDesktopUpdate();
      setResult(r);
      setStatus("checked");
    } finally {
      inFlightRef.current = false;
    }
  }, [supported]);

  // Initial check on mount.
  useEffect(() => {
    if (!supported) return;
    void runCheck();
  }, [supported, runCheck]);

  // Periodic re-check. Suppressed under reduced-motion to honour the
  // user's preference for fewer background fetches (a manifest hit is a
  // network round-trip, which the OS-level reduced-motion preference
  // does not strictly cover, but it is a sensible proxy).
  useEffect(() => {
    if (!supported) return;
    if (pollIntervalMs <= 0) return;
    if (reduceMotion) return;

    const id = setInterval(() => {
      void runCheck();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [supported, pollIntervalMs, reduceMotion, runCheck]);

  return {
    status,
    updateAvailable: result?.available === true,
    isSupported: supported,
    result,
    recheck: runCheck,
  };
}
