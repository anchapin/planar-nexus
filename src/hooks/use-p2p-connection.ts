/**
 * React hook for managing P2P game connections
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Enhanced with handshake protocol and conflict resolution.
 *
 * Issue #1927 — this module is now a composition root. The cohesive
 * concerns live in colocated sub-modules under `src/hooks/p2p/`:
 *   - `use-p2p-signaling-handshake.ts` — handshake session + reconnect
 *     token (issue #1254).
 *   - `use-p2p-reconnect.ts` — reconnection UI state (issue #988) and
 *     post-reconnect reconciliation (issue #1086).
 *   - `use-p2p-local-degrade.ts` — graceful degradation to local
 *     hot-seat (issue #1090).
 *   - `use-p2p-host-migration.ts` — host migration (issue #916).
 *   - `use-p2p-game-ended.ts` — game-ended persistence (issue #1570).
 *   - `create-p2p-connection-events.ts` — shared transport event wiring.
 * Public types and the promoted-host key rotation helper are re-exported
 * below so existing imports are unaffected.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  createP2PGameConnection,
  P2PGameConnection,
  type P2PConnectionState,
} from "@/lib/p2p-game-connection";
import type { LocalSignalingState } from "@/lib/local-signaling-client";
import type { RTCSessionDescriptionInit } from "@/lib/webrtc-types";
import { ConflictResolutionManager } from "@/lib/p2p-conflict-resolution";
import { useConnectionHealth } from "@/hooks/use-connection-health";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";
import { type PeerRole, DEFAULT_PEER_ROLE } from "@/lib/peer-role";
import {
  MAX_RECONNECT_ATTEMPTS_DISPLAY,
  type UseP2PConnectionOptions,
  type UseP2PConnectionReturn,
} from "./p2p/p2p-connection-types";
import { useP2PGameEnded } from "./p2p/use-p2p-game-ended";
import { useP2PLocalDegrade } from "./p2p/use-p2p-local-degrade";
import { useP2PHostMigration } from "./p2p/use-p2p-host-migration";
import { useP2PReconnect } from "./p2p/use-p2p-reconnect";
import { useP2PSignalingHandshake } from "./p2p/use-p2p-signaling-handshake";
import { useP2PTransportActions } from "./p2p/use-p2p-transport-actions";
import { createP2PConnectionEvents } from "./p2p/create-p2p-connection-events";

// Re-export the public surface so existing imports keep working (issue #1927).
export type {
  UseP2PConnectionOptions,
  UseP2PConnectionReturn,
  LocalDegradeInfo,
  ReconnectionPhase,
  LocalHotSeatMigrationResult,
  LocalHotSeatSaveResult,
} from "./p2p/p2p-connection-types";
export { rotateSessionKeyOnPromotion } from "./p2p/rotate-session-key-on-promotion";

export function useP2PConnection(
  options: UseP2PConnectionOptions,
): UseP2PConnectionReturn {
  const {
    playerId,
    playerName,
    role,
    gameCode,
    enableHandshake = true,
    enableConflictResolution = true,
    conflictResolutionStrategy = "host-wins",
    enableHostMigration = true,
    initialHostId,
    migrationPeers = [],
    onHostMigrated,
    onGameTerminated,
    onDegradedToLocal,
    // Issue #1253 — local peer's role. Defaults to `'player'` (the
    // legacy behaviour) so existing 1:1 / host call sites are
    // unaffected. Surfaced as `localRole` on the return value so the
    // UI can render spectator-specific affordances without reading
    // the transport directly.
    localRole,
  } = options;

  const fallbackHostId =
    initialHostId ?? (role === "host" ? playerId : playerId);
  const [connectionState, setConnectionState] =
    useState<P2PConnectionState>("disconnected");
  const [signalingState, setSignalingState] =
    useState<LocalSignalingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionFailureReason, setConnectionFailureReason] =
    useState<ConnectionFailureDiagnostic | null>(null);
  const connectionRef = useRef<P2PGameConnection | null>(null);
  const conflictManagerRef = useRef<ConflictResolutionManager | null>(null);
  // Issue #1253 — local peer's role. Mirrored in a ref so the
  // once-created connection event handlers read the latest role without
  // re-binding. Defaults to `'player'` (legacy behaviour) so existing
  // 1:1 / host call sites are unaffected.
  const localRoleRef = useRef<PeerRole>(localRole ?? DEFAULT_PEER_ROLE);
  localRoleRef.current = localRole ?? DEFAULT_PEER_ROLE;
  // Issue #1253 — `localRole` is also exposed via state so the UI can
  // re-render when the role flips (e.g. after a `spectator-handshake-ack`
  // adopts a new role). Updated only via `setLocalRole` (mirrored onto
  // the ref + the live connection).
  const [localRoleState, setLocalRoleState] = useState<PeerRole>(
    localRole ?? DEFAULT_PEER_ROLE,
  );
  // Issue #1253 — diagnostic counter surfaced to the diagnostics panel.
  const [spectatorDrops, setSpectatorDrops] = useState(0);

  // --- Composed concerns (issue #1927 split) ---

  // Issue #1090: graceful degradation to local hot-seat.
  const {
    degradedToLocal,
    terminalFailure,
    lastGameState,
    lastGameStateRef,
    cacheLatestGameState,
    continueAsLocalHotSeat,
    saveForLocalResume,
    dismissTerminalFailure,
    resetDegradeState,
  } = useP2PLocalDegrade({
    connectionState,
    playerName,
    onDegradedToLocal,
    setError,
    connectionRef,
  });

  // Issue #916: host migration.
  const {
    currentHostId,
    currentHostIdRef,
    cacheGameStateForMigration,
    registerPeerForMigration,
    handleMigrationGameAction,
    handlePeerLeftForMigration,
    resetHostMigration,
  } = useP2PHostMigration({
    enableHostMigration,
    playerId,
    playerName,
    role,
    fallbackHostId,
    migrationPeers,
    onHostMigrated,
    onGameTerminated,
    setError,
    connectionRef,
    conflictManagerRef,
  });

  // Issue #1570: game-ended persistence + state.
  const { gameEnded, handleGameEnded, resetGameEnded } = useP2PGameEnded({
    playerId,
    playerName,
  });

  // Issues #988 / #1086: reconnection UI state + reconciliation.
  const {
    reconnectAttempts,
    reconnectedRecently,
    acknowledgeReconnect,
    noteTransportStateChange,
    handleReconnect,
    adoptHostStateIfAwaiting,
    recordPendingAction,
    droppedPendingActions,
    reconnectionPhase,
    getReconnectAttempts,
    resetReconnectState,
  } = useP2PReconnect({
    playerId,
    connectionState,
    degradedToLocal,
    terminalFailure,
    connectionRef,
    currentHostIdRef,
    lastGameStateRef,
  });

  // Signaling handshake + reconnect token (issue #1254).
  const {
    handshakeState,
    setHandshakeState,
    handshakeSessionRef,
    reconnectToken,
    reconnectTokenLookupDone,
    clearReconnectToken,
    cleanupHandshake,
    resetHandshake,
  } = useP2PSignalingHandshake({
    enableHandshake,
    connectionState,
    playerId,
    playerName,
    gameCode,
    setError,
    connectionRef,
    currentHostIdRef,
  });

  // Transport send/process surface (issue #1716 orchestration).
  const {
    processAnswer,
    processIceCandidates,
    sendGameState,
    sendGameAction,
    requestStateSync,
    sendChat,
  } = useP2PTransportActions({
    playerId,
    playerName,
    connectionState,
    enableConflictResolution,
    setError,
    connectionRef,
    conflictManagerRef,
    localRoleRef,
    recordPendingAction,
    cacheLatestGameState,
  });

  // Initialize conflict resolution manager
  useEffect(() => {
    if (enableConflictResolution && !conflictManagerRef.current) {
      conflictManagerRef.current = new ConflictResolutionManager({
        strategy: conflictResolutionStrategy,
        hostId: role === "host" ? playerId : "",
      });
    }
  }, [enableConflictResolution, conflictResolutionStrategy, role, playerId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.close();
      }
      if (handshakeSessionRef.current) {
        handshakeSessionRef.current.cleanup();
      }
      if (conflictManagerRef.current) {
        conflictManagerRef.current.reset();
      }
    };
  }, [handshakeSessionRef]);

  // Connection health monitoring.
  //
  // The callbacks passed to `useConnectionHealth` MUST be stable across
  // renders — the hook wraps `updateHealth` in `useCallback` with these getters
  // as deps and runs it from a `useEffect([updateHealth])` and an interval.
  // If the getters are inline arrows, they get a new reference every render,
  // `updateHealth` re-creates, the effect re-runs, `setHealth` triggers a
  // re-render, and we are stuck in a "Maximum update depth exceeded" loop —
  // which is exactly what was crashing the /multiplayer E2E when the
  // persistent connection-state indicator (#986) was first mounted there.
  // Wrapping each getter in `useCallback` keeps the references stable while
  // still letting them observe live state (the refs always read the latest,
  // and `connectionState` triggers a fresh closure on state changes only).
  const getConnectionState = useCallback(
    () => connectionState,
    [connectionState],
  );
  // Issue #1927 — the reconnect getters read the hook-owned #988 counter
  // (see use-p2p-reconnect.ts); the transport owns no reconnect loop, so
  // there is nothing to read off it.
  const getMaxReconnectAttempts = useCallback(() => {
    return MAX_RECONNECT_ATTEMPTS_DISPLAY;
  }, []);

  const connectionHealth = useConnectionHealth({
    getConnectionState,
    getReconnectAttempts,
    getMaxReconnectAttempts,
    enableMonitoring: true,
  });

  // Initialize connection as host
  const initializeAsHost =
    useCallback(async (): Promise<RTCSessionDescriptionInit> => {
      try {
        setError(null);
        setHandshakeState("idle");

        if (connectionRef.current) {
          connectionRef.current.close();
        }

        // Create connection with event handlers
        const connection = createP2PGameConnection({
          playerId,
          playerName,
          role,
          gameCode,
          // Issue #1253 — spectator / moderator roles are read-only; the
          // transport gates `sendGameAction` and inbound filtering on the
          // local role flag.
          localRole: localRoleRef.current,
          events: createP2PConnectionEvents({
            mode: "host",
            connectionRef,
            setConnectionState,
            noteTransportStateChange,
            setConnectionFailureReason,
            setSpectatorDrops,
            handleReconnect,
            setSignalingState,
            handleGameEnded,
            handleMigrationGameAction,
            cacheGameStateForMigration,
            cacheLatestGameState,
            adoptHostStateIfAwaiting,
            enableHandshake,
            handshakeState,
            handshakeSessionRef,
            cleanupHandshake,
            registerPeerForMigration,
            handlePeerLeftForMigration: (peerPlayerId) =>
              handlePeerLeftForMigration(peerPlayerId, "host-disconnected"),
            setError,
          }),
        });

        connectionRef.current = connection;

        // Initialize as host
        await connection.initializeAsHost();

        // Get initial signaling state
        const signalingState = connection.getSignalingState();
        setSignalingState(signalingState);

        return signalingState.localOffer || ({} as RTCSessionDescriptionInit);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to initialize host";
        setError(errorMessage);
        throw err;
      }
    }, [
      playerId,
      playerName,
      role,
      gameCode,
      enableHandshake,
      handshakeState,
      handshakeSessionRef,
      setHandshakeState,
      noteTransportStateChange,
      cleanupHandshake,
      cacheGameStateForMigration,
      cacheLatestGameState,
      registerPeerForMigration,
      handlePeerLeftForMigration,
      handleMigrationGameAction,
      handleReconnect,
      adoptHostStateIfAwaiting,
      // Issue #1570 — the game-ended persistence handler is created via
      // `useCallback([])` (refs only) so the reference is stable across
      // renders and we don't churn the connection event bindings.
      handleGameEnded,
    ]);

  // Initialize connection as joiner
  const initializeAsJoiner = useCallback(
    async (
      offer: RTCSessionDescriptionInit,
    ): Promise<RTCSessionDescriptionInit> => {
      try {
        setError(null);
        setHandshakeState("idle");

        if (connectionRef.current) {
          connectionRef.current.close();
        }

        // Create connection with event handlers
        const connection = createP2PGameConnection({
          playerId,
          playerName,
          role,
          gameCode,
          // Issue #1253 — spectator / moderator roles are read-only; the
          // transport gates `sendGameAction` and inbound filtering on the
          // local role flag.
          localRole: localRoleRef.current,
          events: createP2PConnectionEvents({
            mode: "joiner",
            connectionRef,
            setConnectionState,
            noteTransportStateChange,
            setConnectionFailureReason,
            setSpectatorDrops,
            handleReconnect,
            setSignalingState,
            // Issue #1570 — see the matching comment in initializeAsHost
            // above. The joiner path uses the same handler.
            handleGameEnded,
            handleMigrationGameAction,
            cacheGameStateForMigration,
            cacheLatestGameState,
            adoptHostStateIfAwaiting,
            enableHandshake,
            handshakeState,
            handshakeSessionRef,
            cleanupHandshake,
            registerPeerForMigration,
            handlePeerLeftForMigration: (peerPlayerId) =>
              handlePeerLeftForMigration(peerPlayerId, "host-disconnected"),
            setError,
          }),
        });

        connectionRef.current = connection;

        // Initialize as joiner
        await connection.initializeAsJoiner(offer);

        // Get initial signaling state
        const signalingState = connection.getSignalingState();
        setSignalingState(signalingState);

        return signalingState.localAnswer || ({} as RTCSessionDescriptionInit);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to initialize joiner";
        setError(errorMessage);
        throw err;
      }
    },
    [
      playerId,
      playerName,
      role,
      gameCode,
      enableHandshake,
      handshakeState,
      handshakeSessionRef,
      setHandshakeState,
      noteTransportStateChange,
      cleanupHandshake,
      cacheGameStateForMigration,
      cacheLatestGameState,
      registerPeerForMigration,
      handlePeerLeftForMigration,
      handleMigrationGameAction,
      handleReconnect,
      adoptHostStateIfAwaiting,
      // Issue #1570 — the game-ended persistence handler is created via
      // `useCallback([])` (refs only) so the reference is stable across
      // renders and we don't churn the connection event bindings.
      handleGameEnded,
    ],
  );

  // Close connection
  const closeConnection = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }
    resetHandshake();
    resetHostMigration();
    setConnectionState("disconnected");
    setSignalingState(null);
    setError(null);
    setConnectionFailureReason(null);
    // Reset degrade-to-local bookkeeping so a fresh session starts clean.
    resetDegradeState();
    // Reset reconciliation + reconnection bookkeeping so a fresh session
    // starts clean.
    resetReconnectState();
    // Issue #1253: reset the role-aware diagnostic counter.
    setSpectatorDrops(0);
    // Issue #1570: reset the latest game-ended payload so a fresh session
    // does not surface the previous match's "Game Over" banner. The Dexie
    // `match_records` rows are NOT cleared here — the user expects match
    // history to survive a session boundary, and `match_records` is the
    // sole persistent store for P2P match history (issue #1863).
    resetGameEnded();
  }, [
    resetHandshake,
    resetHostMigration,
    resetDegradeState,
    resetReconnectState,
    resetGameEnded,
  ]);

  // Issue #1253 — set the local peer's role. Mirrors the value onto the
  // ref (so the connection event handlers see the latest) and onto the
  // live transport (so subsequent sends / inbound filters use the new
  // role). Cross-boundary transitions (player ⇄ non-player) require a
  // fresh `SpectatorHandshake`; the hook does NOT enforce that here —
  // the host's `ack` is the trust boundary.
  const setLocalRole = useCallback((role: PeerRole) => {
    localRoleRef.current = role;
    setLocalRoleState(role);
    connectionRef.current?.setLocalRole(role);
  }, []);

  // Get connection instance
  const getConnection = useCallback(() => {
    return connectionRef.current;
  }, []);

  // Get conflict queue size
  const getConflictQueueSize = useCallback(() => {
    if (!conflictManagerRef.current) {
      return 0;
    }
    return conflictManagerRef.current.getQueueSize();
  }, []);

  return {
    connectionState,
    signalingState,
    isConnected: connectionState === "connected",
    error,
    handshakeState,
    connectionHealth,
    connectionFailureReason,
    initializeAsHost,
    initializeAsJoiner,
    processAnswer,
    processIceCandidates,
    sendGameState,
    sendGameAction,
    sendChat,
    requestStateSync,
    closeConnection,
    getConnection,
    getConflictQueueSize,
    currentHostId,
    isAuthoritativeHost: currentHostId === playerId,
    terminalFailure,
    degradedToLocal,
    lastGameState,
    continueAsLocalHotSeat,
    saveForLocalResume,
    dismissTerminalFailure,
    droppedPendingActions,
    // --- Issue #988: user-facing reconnection UI ---
    reconnectionPhase,
    reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS_DISPLAY,
    reconnectedRecently,
    acknowledgeReconnect,
    // --- Issue #1254: per-peer reconnect-token (IndexedDB-backed) ---
    reconnectToken,
    reconnectTokenLookupDone,
    clearReconnectToken,
    // --- Issue #1253: per-peer role ---
    localRole: localRoleState,
    setLocalRole,
    spectatorDrops,
    // --- Issue #1570: game-ended event surface ---
    /**
     * The most recent `game-ended` payload received from the host during
     * this session, or `null` when no terminal event has arrived yet
     * (or after `closeConnection`). The hook ALSO persists a
     * `MatchRecord` row to Dexie on receipt so the value here is for
     * UI banner / state-update consumption, while the durable source of
     * truth for match history is `localIntelligenceDb.match_records` —
     * there is no second writer (issue #1863 closed the
     * `useLocalStorage` mirror).
     *
     * Reset by `closeConnection`. A subsequent session starts blank.
     */
    gameEnded,
  };
}
