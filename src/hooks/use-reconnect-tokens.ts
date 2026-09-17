/**
 * React hooks for the reconnect-token store (issue #1254).
 *
 * The lobby UI uses these to:
 *   - List every persisted token in the browser so a returning peer can
 *     resume a half-finished game with one click ("Continue game in
 *     progress").
 *   - Subscribe to changes so a newly-persisted token (post-handshake)
 *     surfaces in the lobby without a full page reload.
 *
 * The persistence + scoping + TTL rules live in
 * {@link import("@/lib/p2p-reconnect-store").ReconnectTokenStore}. This
 * file is a thin React glue layer — no domain logic.
 *
 * Issue #1811 (PERSISTENCE_ARCHITECTURE section 6 stage 1, item 2):
 * the listing flow previously opened a SECOND read-only
 * `indexedDB.open("PlanarNexusReconnectTokens", 1)` directly here,
 * duplicating the store's schema knowledge and lacking `onblocked`
 * handling. It now goes through `reconnectTokenStore.list()`, the
 * store's public read-only enumeration API.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  reconnectTokenStore,
  type ReconnectToken,
} from "@/lib/p2p-reconnect-store";

/**
 * Snapshot of all live (non-expired) reconnect tokens in this browser.
 * The hook re-reads on mount and on demand via {@link refresh} so the
 * caller can wire a pull-to-refresh or "after handshake completed"
 * effect without prop-drilling a refresh signal.
 */
export function useReconnectTokens(): {
  tokens: ReconnectToken[];
  loading: boolean;
  refresh: () => Promise<void>;
  remove: (gameCode: string, peerId: string) => Promise<void>;
} {
  const [tokens, setTokens] = useState<ReconnectToken[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Sweep expired entries first so the returned list reflects what
      // `get()` would actually surface to a rejoin attempt.
      await reconnectTokenStore.purgeExpired();
      // Issue #1811 — list() goes through the store singleton, not a
      // second read-only open of the same DB. Filter out any rows
      // whose TTL has passed since the purge (defensive: a token can
      // race-expire between purgeExpired and list).
      const all = await reconnectTokenStore.list();
      const now = Date.now();
      setTokens(all.filter((t) => t.expiresAt > now));
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (gameCode: string, peerId: string) => {
    const ok = await reconnectTokenStore.delete(gameCode, peerId);
    if (ok) {
      setTokens((prev) =>
        prev.filter((t) => !(t.gameCode === gameCode && t.peerId === peerId)),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tokens, loading, refresh, remove };
}

/**
 * Look up a single token by (gameCode, peerId). Returns `null` when
 * there is no live token. Used by the p2p-join page to decide whether
 * to show the "Continue as {playerName}?" affordance before falling
 * through to the manual lobby.
 */
export function useReconnectToken(
  gameCode: string | null | undefined,
  peerId: string,
): {
  token: ReconnectToken | null;
  loading: boolean;
  clear: () => Promise<void>;
} {
  const [token, setToken] = useState<ReconnectToken | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!gameCode) {
      setToken(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    reconnectTokenStore
      .get(gameCode, peerId)
      .then((t) => {
        if (cancelled) return;
        setToken(t);
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameCode, peerId]);

  const clear = useCallback(async () => {
    if (!gameCode) return;
    await reconnectTokenStore.delete(gameCode, peerId);
    setToken(null);
  }, [gameCode, peerId]);

  return { token, loading, clear };
}
