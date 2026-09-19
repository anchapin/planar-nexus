/**
 * Signaling-handshake concern for the P2P hook: the `HandshakeSession`
 * lifecycle (issue-driven checksum verification) and the IndexedDB-backed
 * reconnect token (issue #1254). Extracted from
 * `src/hooks/use-p2p-connection.ts` (issue #1927); composed by
 * `useP2PConnection`.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { P2PGameConnection } from "@/lib/p2p-game-connection";
import {
  HandshakeSession,
  generateSessionKey,
  type HandshakeState,
} from "@/lib/p2p-handshake";
import {
  reconnectTokenStore,
  type ReconnectToken,
} from "@/lib/p2p-reconnect-store";
import { logger } from "@/lib/logger";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PSignalingHandshakeResult {
  handshakeState: HandshakeState;
  setHandshakeState: (state: HandshakeState) => void;
  /** Ref mirror of the live `HandshakeSession` (checksum reads, cleanup). */
  handshakeSessionRef: RefObject<HandshakeSession | null>;
  /** The persisted reconnect token, or `null` (issue #1254). */
  reconnectToken: ReconnectToken | null;
  /** False until the initial token lookup completes (issue #1254). */
  reconnectTokenLookupDone: boolean;
  /** Proactively clear the stored token (issue #1254). */
  clearReconnectToken: () => Promise<boolean>;
  /** Cleanup the session ONLY when one exists (onPlayerLeft path). */
  cleanupHandshake: () => void;
  /** Cleanup + unconditionally reset handshake state (`closeConnection`). */
  resetHandshake: () => void;
}

export function useP2PSignalingHandshake(options: {
  enableHandshake: boolean;
  connectionState:
    | "disconnected"
    | "signaling"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "failed";
  playerId: string;
  playerName: string;
  gameCode?: string;
  setError: (error: string | null) => void;
  connectionRef: RefObject<P2PGameConnection | null>;
  /** Ref mirror of the current authoritative host id (migration hook). */
  currentHostIdRef: RefObject<string>;
}): UseP2PSignalingHandshakeResult {
  const {
    enableHandshake,
    connectionState,
    playerId,
    playerName,
    gameCode,
    setError,
  } = options;
  const { connectionRef, currentHostIdRef } = options;

  const [handshakeState, setHandshakeState] = useState<HandshakeState>("idle");
  const handshakeSessionRef = useRef<HandshakeSession | null>(null);
  // --- Issue #1254: per-peer reconnect-token state ---
  // `reconnectToken` mirrors the IndexedDB-persisted token (when one
  // exists for this (gameCode, playerId) pair) so the lobby UI can show
  // "Reconnecting to {gameCode} as {playerName}…" without making the
  // caller wire up its own store consumer. `reconnectTokenLookupDone`
  // distinguishes "we have not checked yet" from "we checked and found
  // nothing" — important for the page mount race where the lobby
  // should NOT fall through to the manual-entry UI before the lookup
  // resolves.
  const [reconnectToken, setReconnectToken] = useState<ReconnectToken | null>(
    null,
  );
  const [reconnectTokenLookupDone, setReconnectTokenLookupDone] =
    useState(false);
  const reconnectTokenLookupRef = useRef<string | null>(null);

  // Initialize handshake session when connection is established.
  // On successful handshake, persist a reconnect token (issue #1254) so the
  // peer can silently rejoin the same game/seat after a browser refresh or
  // Tauri window restart. The token is keyed by `${gameCode}::${peerId}`
  // and carries the session key, the current authoritative host, and the
  // anti-replay high-water mark so the reattaching peer can catch up
  // without double-applying already-seen messages.
  useEffect(() => {
    if (
      enableHandshake &&
      connectionState === "connected" &&
      !handshakeSessionRef.current
    ) {
      handshakeSessionRef.current = new HandshakeSession(
        playerId,
        (state) => setHandshakeState(state),
        (success, errorReason) => {
          if (!success) {
            setError(`Handshake failed: ${errorReason}`);
            return;
          }
          // Persist the reconnect token on successful handshake. Failures
          // here are non-fatal — the live session keeps working, we just
          // lose the ability to silently rejoin after a refresh. Issue
          // #1254 acceptance criteria: tokens are scoped to (gameCode,
          // peerId) and never transferable across games.
          const code = gameCode;
          if (!code) {
            p2pLogger.debug(
              "Skipping reconnect-token save: no gameCode on connection",
            );
            return;
          }
          const sessionKey = generateSessionKey();
          const conn = connectionRef.current;
          const lastDeliveredSeq = conn?.getOutgoingSeq?.() ?? 0;
          reconnectTokenStore
            .save({
              peerId: playerId,
              sessionKey,
              hostPeerId: currentHostIdRef.current,
              gameCode: code,
              lastDeliveredSeq,
              playerName,
            })
            .then((ok) => {
              if (ok) {
                p2pLogger.info("Persisted reconnect token", code);
              } else {
                p2pLogger.warn(
                  "Reconnect-token save failed; live session unaffected",
                  code,
                );
              }
            })
            .catch((err) => {
              p2pLogger.warn(
                "Reconnect-token save threw; live session unaffected",
                String(err),
              );
            });
        },
      );
    }
  }, [
    enableHandshake,
    connectionState,
    playerId,
    gameCode,
    playerName,
    setError,
    connectionRef,
    currentHostIdRef,
  ]);

  // Issue #1254 — on mount (or whenever `gameCode` changes), look up a
  // stored reconnect token for this (gameCode, playerId) pair. The lobby
  // UI surfaces this so it can attempt a silent rejoin before falling
  // through to the manual-entry lobby. We guard against double-firing
  // with a ref so React strict-mode + dep-array churn does not trigger
  // multiple IDB reads for the same code.
  useEffect(() => {
    if (!gameCode) {
      setReconnectTokenLookupDone(true);
      return;
    }
    if (reconnectTokenLookupRef.current === gameCode) {
      return;
    }
    reconnectTokenLookupRef.current = gameCode;
    let cancelled = false;
    reconnectTokenStore
      .get(gameCode, playerId)
      .then((token) => {
        if (cancelled) return;
        setReconnectToken(token);
      })
      .catch((err) => {
        if (cancelled) return;
        p2pLogger.warn("Reconnect-token lookup threw", String(err));
        setReconnectToken(null);
      })
      .finally(() => {
        if (cancelled) return;
        setReconnectTokenLookupDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gameCode, playerId]);

  // Issue #1254 — drop a stored token once the host confirms the game has
  // ended cleanly (e.g. on lobby close). Auto-purge expired tokens is
  // handled inside the store; this is the proactive cleanup path so the
  // 30-minute TTL is a worst-case bound, not the typical one.
  const clearReconnectToken = useCallback(async () => {
    if (!gameCode) return false;
    return reconnectTokenStore.delete(gameCode, playerId);
  }, [gameCode, playerId]);

  // Cleanup the handshake session only when one exists (onPlayerLeft path).
  const cleanupHandshake = useCallback(() => {
    if (handshakeSessionRef.current) {
      handshakeSessionRef.current.cleanup();
      setHandshakeState("idle");
    }
  }, []);

  // Cleanup + unconditional state reset (`closeConnection` path).
  const resetHandshake = useCallback(() => {
    if (handshakeSessionRef.current) {
      handshakeSessionRef.current.cleanup();
    }
    setHandshakeState("idle");
  }, []);

  return {
    handshakeState,
    setHandshakeState,
    handshakeSessionRef,
    reconnectToken,
    reconnectTokenLookupDone,
    clearReconnectToken,
    cleanupHandshake,
    resetHandshake,
  };
}
