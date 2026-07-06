/**
 * useP2PDiagnostics — React hook that surfaces live ICE / NAT-traversal
 * diagnostics for the diagnostics panel.
 * Issue #1088: NAT-traversal diagnostics panel with ICE candidate reporting.
 * Issue #1178: SSR hydration fix — initialize `supported` to a stable SSR
 *              value, then update post-hydration so the first client render
 *              matches the server (no hydration mismatch).
 * Issue #1256: per-peer live RTT / packet-loss / bytes-per-sec polling.
 *
 * Two flavours:
 *   1. {@link useP2PDiagnostics} — single-connection snapshot (existing path).
 *   2. {@link usePeerDiagnostics} — per-peer mesh diagnostics: polls each
 *      peer's `getStats()` every 2 s, maintains a bounded rolling window
 *      (last 30 samples ≈ 60 s) per peer, and derives rates in pure JS so the
 *      math is unit-testable without a browser.
 *
 * Both hooks are guarded for SSR and for environments without WebRTC (older
 * Tauri webviews). Neither mutates the connection.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isICEDiagnosticsSupported,
  type ICEDiagnosticsSnapshot,
} from "@/lib/ice-diagnostics";
import {
  RollingWindow,
  summarizePeerSamples,
  type PeerStatsAggregate,
  type PeerStatsSample,
} from "@/lib/p2p-peer-stats";

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

  // Issue #1178: `isICEDiagnosticsSupported()` reads `window.RTCPeerConnection`,
  // which is absent during SSR. Computing it during render made the server
  // output (unsupported) differ from the client's first render (supported),
  // producing a React hydration mismatch on /multiplayer/. Initialize to a
  // stable SSR value and read the real capability in an effect after hydration
  // so the first client render matches the server, then update.
  const [supported, setSupported] = useState(false);

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

  // Detect WebRTC support post-hydration. Kept separate from the polling
  // effect: it runs once after mount so SSR and the first client render agree
  // on `supported` (issue #1178). Flipping this re-triggers the polling effect
  // below via its dependency on `supported`.
  useEffect(() => {
    setSupported(isICEDiagnosticsSupported());
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

/* ────────────────────────────────────────────────────────────────────────── *
 *  Per-peer diagnostics — issue #1256.
 * ────────────────────────────────────────────────────────────────────────── */

/** Stable peer identifier (e.g. DataChannel id, peer UUID). */
export type PeerId = string;

/**
 * Raw per-peer stats returned by a {@link PeerDiagnosticsSource}. All numeric
 * fields are nullable so partial implementations (e.g. an older browser that
 * does not yet expose `currentRoundTripTime` until the first STUN response)
 * can degrade gracefully instead of throwing.
 */
export interface PeerRawStats {
  peerId: PeerId;
  displayName?: string | null;
  phase?: string | null;
  rttMs?: number | null;
  bytesSent?: number | null;
  bytesReceived?: number | null;
  packetsSent?: number | null;
  packetsReceived?: number | null;
  packetsLost?: number | null;
  queueDepth?: number | null;
}

/**
 * Structural type for a 3+ player mesh connection. `getPeerIds()` is called
 * on each poll so peers added or removed mid-session are picked up; the hook
 * garbage-collects orphaned rolling windows on the next poll.
 */
export interface PeerDiagnosticsSource {
  getPeerIds(): PeerId[];
  getPeerDiagnostics(peerId: PeerId): Promise<PeerRawStats | null>;
}

/**
 * Per-peer panel row: stable identity + a rolling window of samples + the
 * derived aggregate used by the table.
 */
export interface PeerDiagnosticsRow {
  peerId: PeerId;
  displayName: string | null;
  phase: string | null;
  aggregate: PeerStatsAggregate;
  history: PeerStatsSample[];
}

export interface PeerDiagnosticsSummary {
  /** Epoch ms when the summary was assembled. */
  timestamp: number;
  peers: PeerDiagnosticsRow[];
}

export interface UsePeerDiagnosticsOptions {
  /** The mesh connection to observe, or null when none is active. */
  connection: PeerDiagnosticsSource | null;
  /** Start/stop polling. When false the hook keeps the last summary. */
  enabled?: boolean;
  /** Polling cadence in ms. Defaults to 2000 (acceptance: < 1% CPU on host). */
  pollIntervalMs?: number;
  /** Rolling-window size per peer (samples). Defaults to 30 (≈ 60 s at 2 s). */
  windowSize?: number;
}

export interface UsePeerDiagnosticsResult {
  summary: PeerDiagnosticsSummary | null;
  loading: boolean;
  error: Error | null;
  supported: boolean;
  refresh: () => void;
}

/** Default per-peer rolling window size (last 30 samples ≈ 60 s at 2 s poll). */
const DEFAULT_PEER_WINDOW = 30;

export function usePeerDiagnostics(
  options: UsePeerDiagnosticsOptions,
): UsePeerDiagnosticsResult {
  const {
    connection,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_MS,
    windowSize = DEFAULT_PEER_WINDOW,
  } = options;

  // SSR-safe init (issue #1178 parity): `supported` defaults to false and is
  // upgraded in an effect post-hydration so the server output matches the
  // first client render and React does not warn about hydration mismatch.
  const [supported, setSupported] = useState(false);
  const [summary, setSummary] = useState<PeerDiagnosticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Connection + windows live in refs so polling does not re-create them on
  // every render. The hook rebuilds the windows only when the connection or
  // windowSize identity changes.
  const connectionRef = useRef<PeerDiagnosticsSource | null>(connection);
  connectionRef.current = connection;
  const windowsRef = useRef<Map<PeerId, RollingWindow<PeerStatsSample>>>(
    new Map(),
  );
  const namesRef = useRef<Map<PeerId, string>>(new Map());
  const phasesRef = useRef<Map<PeerId, string>>(new Map());

  const refreshNonce = useRef(0);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => {
    refreshNonce.current += 1;
    setNonce(refreshNonce.current);
  }, []);

  // Reset windows when the connection identity or window size changes so a
  // different mesh session does not inherit a stale per-peer history.
  useEffect(() => {
    windowsRef.current = new Map();
    namesRef.current = new Map();
    phasesRef.current = new Map();
  }, [connection, windowSize]);

  useEffect(() => {
    setSupported(isICEDiagnosticsSupported());
  }, []);

  useEffect(() => {
    if (!supported || !enabled || !connection) {
      setLoading(false);
      if (!connection) {
        setSummary(null);
        windowsRef.current = new Map();
        namesRef.current = new Map();
        phasesRef.current = new Map();
      }
      return;
    }

    let cancelled = false;
    setLoading(true);

    const pollOnce = async () => {
      const source = connectionRef.current;
      if (!source) return;
      let peerIds: PeerId[];
      try {
        peerIds = source.getPeerIds();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
        return;
      }

      // Fetch every peer's current stats concurrently. Failures on a single
      // peer do not poison the others — the per-peer `null` row is filtered
      // out of the aggregate instead.
      const results = await Promise.all(
        peerIds.map(async (id) => {
          try {
            const raw = await source.getPeerDiagnostics(id);
            return { id, raw };
          } catch (err) {
            if (cancelled) throw err;
            // Surface the per-peer failure as a `null` raw entry; do not abort
            // the whole poll. The previous sample in the window remains, so
            // brief errors do not blank the sparkline.
            return {
              id,
              raw: null,
              error: err instanceof Error ? err : new Error(String(err)),
            };
          }
        }),
      );
      if (cancelled) return;

      const timestamp = Date.now();
      const liveIds = new Set<PeerId>();
      for (const { id, raw } of results) {
        liveIds.add(id);
        if (!raw) continue;
        const sample: PeerStatsSample = {
          timestamp,
          rttMs: raw.rttMs ?? null,
          bytesSent: raw.bytesSent ?? null,
          bytesReceived: raw.bytesReceived ?? null,
          packetsSent: raw.packetsSent ?? null,
          packetsReceived: raw.packetsReceived ?? null,
          packetsLost: raw.packetsLost ?? null,
          queueDepth: raw.queueDepth ?? null,
        };
        let window = windowsRef.current.get(id);
        if (!window) {
          window = new RollingWindow<PeerStatsSample>(windowSize);
          windowsRef.current.set(id, window);
        } else if (window.maxSize !== windowSize) {
          // Defensive: if the caller flips windowSize at runtime, rebuild.
          window = new RollingWindow<PeerStatsSample>(windowSize);
          windowsRef.current.set(id, window);
        }
        window.push(sample);
        if (raw.displayName) {
          namesRef.current.set(id, raw.displayName);
        }
        if (typeof raw.phase === "string") {
          phasesRef.current.set(id, raw.phase);
        }
      }

      // Garbage-collect peers that disappeared from the mesh so the table does
      // not show ghost rows. The window + cached display name are dropped.
      for (const id of Array.from(windowsRef.current.keys())) {
        if (!liveIds.has(id)) {
          windowsRef.current.delete(id);
          namesRef.current.delete(id);
          phasesRef.current.delete(id);
        }
      }

      const peers: PeerDiagnosticsRow[] = [];
      for (const id of Array.from(windowsRef.current.keys()).sort()) {
        const window = windowsRef.current.get(id);
        if (!window) continue;
        const history = window.toArray();
        peers.push({
          peerId: id,
          displayName: namesRef.current.get(id) ?? null,
          phase: phasesRef.current.get(id) ?? null,
          aggregate: summarizePeerSamples(history),
          history,
        });
      }

      setSummary({ timestamp, peers });
      setError(null);
      setLoading(false);
    };

    void pollOnce();

    const interval = setInterval(pollOnce, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection, enabled, pollIntervalMs, supported, windowSize, nonce]);

  return { summary, loading, error, supported, refresh };
}