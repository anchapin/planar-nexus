/**
 * Shared transport event-handler wiring for `initializeAsHost` /
 * `initializeAsJoiner` (issue #1927).
 *
 * Both paths bind the same concern handlers (migration routing, reconnect
 * bookkeeping, game-state caching, game-ended persistence); the only
 * differences are host-only extras preserved verbatim from the pre-split
 * hook:
 *   - host refreshes the #1253 spectator-drop counter on every state
 *     change (the joiner path never did);
 *   - host verifies the handshake checksum on game-state sync;
 *   - host starts a handshake with newly-joined peers;
 *   - host carries the (debug-only) handshake message hook in onMessage.
 *
 * Not a hook — a plain factory called inside the two initialize callbacks.
 */

import type { RefObject } from "react";
import { toast } from "@/hooks/use-toast";
import type { GameState } from "@/lib/game-state";
import type {
  P2PConnectionState,
  P2PGameConnection,
  P2PGameConnectionEvents,
  GameEndedPayload,
} from "@/lib/p2p-game-connection";
import type { LocalSignalingState } from "@/lib/local-signaling-client";
import type { HandshakeState, HandshakeSession } from "@/lib/p2p-handshake";
import { verifySimpleStateChecksum } from "@/lib/p2p-handshake";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";
import { logger } from "@/lib/logger";

const p2pLogger = logger.child("P2PConnection");

export interface CreateP2PConnectionEventsDeps {
  /** `"host"` enables the host-only handler branches (see module doc). */
  mode: "host" | "joiner";
  connectionRef: RefObject<P2PGameConnection | null>;
  setConnectionState: (state: P2PConnectionState) => void;
  /** #988 attempt bookkeeping (reconnect sub-hook). */
  noteTransportStateChange: (state: P2PConnectionState) => void;
  setConnectionFailureReason: (
    diagnostic: ConnectionFailureDiagnostic | null,
  ) => void;
  setSpectatorDrops: (drops: number) => void;
  handleReconnect: () => void;
  setSignalingState: (signalingState: LocalSignalingState) => void;
  handleGameEnded: (payload: GameEndedPayload) => Promise<void>;
  handleMigrationGameAction: (action: string, data: unknown) => void;
  cacheGameStateForMigration: (gameState: GameState) => void;
  cacheLatestGameState: (gameState: GameState) => void;
  adoptHostStateIfAwaiting: () => void;
  enableHandshake: boolean;
  handshakeState: HandshakeState;
  handshakeSessionRef: RefObject<HandshakeSession | null>;
  /** onPlayerLeft path: cleanup only when a session exists. */
  cleanupHandshake: () => void;
  registerPeerForMigration: (playerId: string, playerName: string) => void;
  handlePeerLeftForMigration: (playerId: string) => void;
  setError: (error: string | null) => void;
}

export function createP2PConnectionEvents(
  deps: CreateP2PConnectionEventsDeps,
): Partial<P2PGameConnectionEvents> {
  const isHost = deps.mode === "host";

  return {
    onConnectionStateChange: (state) => {
      deps.setConnectionState(state);
      if (state === "failed") {
        // Issue #1927 — typed call; the diagnostic accessor is part of
        // the public P2PGameConnection surface (issue #926).
        deps.setConnectionFailureReason(
          deps.connectionRef.current?.getLastFailureDiagnostic() ?? null,
        );
      }
      // Issue #988: track reconnection attempts (shared host/joiner
      // bookkeeping — see use-p2p-reconnect.ts).
      deps.noteTransportStateChange(state);
      // Issue #1253 — refresh the role-aware diagnostic counter on every
      // state change so the diagnostics panel always shows the latest drop
      // count. Host path only (preserved from the pre-split hook). Typed
      // call (issue #1927).
      if (isHost) {
        deps.setSpectatorDrops(
          deps.connectionRef.current?.getSpectatorDrops() ?? 0,
        );
      }
    },
    onReconnect: deps.handleReconnect,
    onSignalingStateChange: deps.setSignalingState,
    // Issue #1570 — host-authoritative terminal-event channel. Wired so the
    // hook layer persists a `MatchRecord` row to Dexie and surfaces a React
    // state update. Anti-replay (#1091) ensures a re-delivered `game-ended`
    // is dropped at the transport layer BEFORE this handler runs, so only
    // one Dexie row is written even after a host-reconnect rebroadcast.
    onGameEnded: deps.handleGameEnded,
    onMessage: (message) => {
      p2pLogger.debug("Received message:", message.type);

      // Handle handshake messages if enabled (host path only — preserved
      // from the pre-split hook; currently debug-only).
      if (isHost && deps.enableHandshake && deps.handshakeSessionRef.current) {
        // Handshake message handling would go here
        // For now, we just log them
      }

      // Route host-migration announcements (issue #916).
      if (message.type === "game-action") {
        const payload = message.data as
          { action?: string; data?: unknown } | undefined;
        if (payload?.action) {
          deps.handleMigrationGameAction(payload.action, payload.data);
        }
      }
    },
    onGameStateSync: (gameState) => {
      p2pLogger.debug("Received game state sync");
      deps.cacheGameStateForMigration(gameState);
      deps.cacheLatestGameState(gameState);
      // Issue #1086: adopt the host's authoritative state on
      // reconnect-driven reconciliation (drops pending actions).
      deps.adoptHostStateIfAwaiting();

      // Verify checksum if handshake completed (host path only — preserved
      // from the pre-split hook).
      if (
        isHost &&
        deps.handshakeState === "completed" &&
        deps.handshakeSessionRef.current
      ) {
        const remoteChecksum =
          deps.handshakeSessionRef.current.getRemoteChecksum();
        if (remoteChecksum) {
          const isValid = verifySimpleStateChecksum(gameState, remoteChecksum);
          if (!isValid) {
            console.warn("[useP2PConnection] State checksum mismatch!");
          }
        }
      }
    },
    onChat: (chatMessage) => {
      p2pLogger.debug("Received chat:", chatMessage.text);
    },
    onError: (err) => {
      deps.setError(err.message);
      toast({
        variant: "destructive",
        title: "Connection error",
        description: err.message,
      });
    },
    onPlayerJoined: (playerId, playerName) => {
      p2pLogger.debug("Player joined:", playerName);
      deps.registerPeerForMigration(playerId, playerName);

      // Start handshake with new player (host path only — preserved from
      // the pre-split hook).
      if (isHost && deps.enableHandshake && deps.handshakeSessionRef.current) {
        const initMessage = deps.handshakeSessionRef.current.start(playerId);
        // Send init message to peer
        deps.connectionRef.current?.sendGameAction(
          "handshake-init",
          initMessage,
        );
      }
    },
    onPlayerLeft: (playerId) => {
      p2pLogger.debug("Player left:", playerId);
      deps.handlePeerLeftForMigration(playerId);

      // Cleanup handshake
      deps.cleanupHandshake();
    },
  };
}
