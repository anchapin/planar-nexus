/**
 * useP2PDiagnostics — React hook that surfaces live ICE / NAT-traversal
 * diagnostics for the diagnostics panel.
 * Issue #1088: NAT-traversal diagnostics panel with ICE candidate reporting.
 *
 * The hook polls a connection's `getDiagnostics()` snapshot on an interval and
 * exposes a manual `refresh`. It is guarded for SSR and for environments
 * without WebRTC (older Tauri webviews). It never mutates the connection.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isICEDiagnosticsSupported,
  type ICEDiagnosticsSnapshot,
} from "@/lib/ice-diagnostics";

/**
 * Structural type for anything that can produce a diagnostics snapshot
 * (e.g. `WebRTCConnection`). Kept loose so the hook is decoupled from the
 * concrete connection class and trivially mockable in tests.
 */
export interface DiagnosticsSource {
  getDiagnostics(): Promise<ICEDiagnosticsSnapshot | null>;
}

export interface UseP2PDiagnosticsOptions {
  /** The connection to observe, or null when none is active. */
  connection: DiagnosticsSource | null;
  /** Start/stop polling. When false the hook keeps the last snapshot. */
  enabled?: boolean;
  /** Polling cadence in ms. Defaults to 2000. */
  pollIntervalMs?: number;
}

export interface UseP2PDiagnosticsResult {
  snapshot: ICEDiagnosticsSnapshot | null;
  loading: boolean;
  error: Error | null;
  supported: boolean;
  refresh: () => void;
}

/**
 * Default polling interval. ICE state changes are comparatively slow, so 2s
 * balances responsiveness against `getStats()` cost.
 */
const DEFAULT_POLL_MS = 2000;

export function useP2PDiagnostics(
  options: UseP2PDiagnosticsOptions,
): UseP2PDiagnosticsResult {
  const {
    connection,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_MS,
  } = options;

  const supported = isICEDiagnosticsSupported();
  const [snapshot, setSnapshot] = useState<ICEDiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track the latest connection + a "refresh nonce" so polling and manual
  // refresh share one async path without racing stale closures.
  const connectionRef = useRef<DiagnosticsSource | null>(connection);
  connectionRef.current = connection;
  const refreshNonce = useRef(0);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    refreshNonce.current += 1;
    setNonce(refreshNonce.current);
  }, []);

  useEffect(() => {
    if (!supported || !enabled || !connection) {
      setLoading(false);
      // Drop the snapshot when the connection goes away.
      if (!connection) setSnapshot(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchSnapshot = async () => {
      const source = connectionRef.current;
      if (!source) return;
      try {
        const next = await source.getDiagnostics();
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchSnapshot();

    const interval = setInterval(fetchSnapshot, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // `nonce` changes on manual refresh; connection/enabled/cadence drive setup.
  }, [connection, enabled, pollIntervalMs, supported, nonce]);

  return { snapshot, loading, error, supported, refresh };
}
