/**
 * React hook for managing P2P game connections
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Enhanced with handshake protocol and conflict resolution
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GameState } from "@/lib/game-state/types";
import {
  createP2PGameConnection,
  P2PGameConnection,
  type P2PGameConnectionEvents,
  type P2PConnectionState,
  type ChatMessage,
  type SignalingRole,
} from "@/lib/p2p-game-connection";
import type { LocalSignalingState } from "@/lib/local-signaling-client";
import type {
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "@/lib/webrtc-types";
import { HandshakeSession, type HandshakeState } from "@/lib/p2p-handshake";
import {
  ConflictResolutionManager,
  type TimestampedAction,
} from "@/lib/p2p-conflict-resolution";
import {
  HostMigrationManager,
  createHostMigrationManager,
  type HostMigrationMessage,
  type HostMigrationResult,
  type PeerRosterEntry,
} from "@/lib/p2p-host-migration";
import { saveGameForLocalHotSeat } from "@/lib/local-game-storage";
import {
  ReconciliationCoordinator,
  type PendingAction,
} from "@/lib/p2p-reconciliation";
import {
  useConnectionHealth,
  type ConnectionHealth,
} from "@/hooks/use-connection-health";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";
import {
  reconnectTokenStore,
  type ReconnectToken,
} from "@/lib/p2p-reconnect-store";
import { logger } from "@/lib/logger";

const p2pLogger = logger.child("P2PConnection");

/**
 * Upper bound for the user-facing "attempt N of M" label in the reconnection
 * UI (issue #988). The hook does not own the actual reconnection loop; this
 * constant is the maximum displayed attempt number before the UI switches to
 * the terminal "Reconnection failed" message. The underlying transport's
 * own `maxReconnectAttempts` is plumbed via {@link P2PConnectionState}
 * callers and may differ; this is purely a display bound.
 */
const MAX_RECONNECT_ATTEMPTS_DISPLAY = 3;

export interface UseP2PConnectionOptions {
  playerId: string;
  playerName: string;
  role: SignalingRole;
  gameCode?: string;
  enableHandshake?: boolean;
  enableConflictResolution?: boolean;
  conflictResolutionStrategy?:
    | "host-wins"
    | "timestamp-based"
    | "priority-based"
    | "round-robin";
  /** Enable host migration when the authoritative host disconnects (issue #916). */
  enableHostMigration?: boolean;
  /** Initial authoritative host id. Defaults to the host when role === 'host'. */
  initialHostId?: string;
  /** Initial peer roster used for deterministic successor selection. */
  migrationPeers?: PeerRosterEntry[];
  /** Called after a host migration completes (promotion or remote change). */
  onHostMigrated?: (result: HostMigrationResult) => void;
  /** Called when no peers remain and the multiplayer game must end cleanly. */
  onGameTerminated?: (reason: string) => void;
  /**
   * Called after the connection degrades to local hot-seat on a terminal P2P
   * failure (issue #1090). Carries the resume key + gameId so the UI can load
   * the migrated game, or nulls when there was no game state to migrate.
   */
  onDegradedToLocal?: (result: LocalDegradeInfo) => void;
}

/**
 * Outcome of migrating a failed P2P game to local hot-seat storage.
 */
export interface LocalDegradeInfo {
  resumeKey: string | null;
  gameId: string | null;
  /** False when there was no in-progress game state to preserve. */
  hadGameState: boolean;
}

/**
 * Reconnection lifecycle phase surfaced to the UI (issue #988).
 *
 * Derived from the connection state by {@link useP2PConnection}. The UI uses
 * this to pick what to show:
 *   - `stable`     — no reconnection activity; nothing to surface.
 *   - `lost`       — the connection dropped after having been connected; the
 *                    transport is attempting recovery. Shows a "Connection
 *                    lost — reconnecting…" banner with attempt count.
 *   - `reconnecting` — the transport reports the "reconnecting" state (used
 *                    when the underlying WebRTC layer actively drives the
 *                    cycle, e.g. via WebRTCConnection's ICE-restart loop).
 *   - `recovered`  — transient: the transport recovered after a prior drop.
 *                    Shows a brief "Reconnected" success message and
 *                    auto-dismisses. Cleared by the consumer after handling.
 *   - `failed`     — reconnection retries were exhausted and the user has not
 *                    yet migrated or abandoned. Surfaces the recovery prompt
 *                    that hands off to {@link P2PDegradeDialog}.
 */
export type ReconnectionPhase =
  | "stable"
  | "lost"
  | "reconnecting"
  | "recovered"
  | "failed";

/**
 * Result of {@link useP2PConnectionReturn.continueAsLocalHotSeat}.
 */
export interface LocalHotSeatMigrationResult {
  ok: boolean;
  resumeKey?: string;
  gameId?: string;
  hadGameState?: boolean;
  error?: string;
}

/**
 * Result of {@link useP2PConnectionReturn.saveForLocalResume}.
 */
export interface LocalHotSeatSaveResult {
  ok: boolean;
  resumeKey?: string;
  error?: string;
}

export interface UseP2PConnectionReturn {
  connectionState: P2PConnectionState;
  signalingState: LocalSignalingState | null;
  isConnected: boolean;
  error: string | null;
  handshakeState: HandshakeState;
  connectionHealth: ConnectionHealth;
  /** Actionable diagnostic from the last connection failure, if any. */
  connectionFailureReason: ConnectionFailureDiagnostic | null;
  initializeAsHost: () => Promise<RTCSessionDescriptionInit>;
  initializeAsJoiner: (
    offer: RTCSessionDescriptionInit,
  ) => Promise<RTCSessionDescriptionInit>;
  processAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  processIceCandidates: (candidates: RTCIceCandidateInit[]) => Promise<void>;
  sendGameState: (gameState: GameState, isFullSync?: boolean) => boolean;
  sendGameAction: (
    action: string,
    data: unknown,
  ) => { success: boolean; action?: TimestampedAction; queued?: boolean };
  sendChat: (text: string) => boolean;
  /**
   * Pull a fresh authoritative full game-state-sync from the host on demand
   * (issue #1086). Used after an ICE-restart reconnect to reconcile, or any
   * time the local peer notices drift. No-op when not connected.
   */
  requestStateSync: () => boolean;
  closeConnection: () => void;
  getConnection: () => P2PGameConnection | null;
  getConflictQueueSize: () => number;
  /** Current authoritative host id (updates on host migration). */
  currentHostId: string;
  /** True when the local client currently holds host authority. */
  isAuthoritativeHost: boolean;
  // --- Issue #1090: graceful degradation to local hot-seat ---
  /** True when the P2P connection has failed terminally and the user has not yet acted. */
  terminalFailure: boolean;
  /** True after the game has been migrated to local hot-seat mode. */
  degradedToLocal: boolean;
  /** The most recent game state observed (sent or received), available for migration. */
  lastGameState: GameState | null;
  /** Migrate the in-progress game to local hot-seat storage and switch modes. Idempotent. */
  continueAsLocalHotSeat: () => Promise<LocalHotSeatMigrationResult>;
  /** Persist the in-progress game to IndexedDB for later resume (without switching modes). */
  saveForLocalResume: () => Promise<LocalHotSeatSaveResult>;
  /** Acknowledge the terminal failure (abandon) and dismiss the degrade prompt. */
  dismissTerminalFailure: () => void;
  /**
   * Local actions recorded while disconnected that were DROPPED when the host's
   * authoritative state was adopted after a reconnect (issue #1086). The UI
   * surfaces these so the player is not silently undone. Cleared on the next
   * reconcile / close.
   */
  droppedPendingActions: PendingAction[];
  // --- Issue #988: user-facing reconnection UI ---
  /**
   * Reconnection lifecycle phase derived from `connectionState` and the
   * connection's reconnection attempt count. Drives the
   * {@link P2PReconnectionStatus} component.
   */
  reconnectionPhase: ReconnectionPhase;
  /** Number of reconnection attempts since the last successful connect. */
  reconnectAttempts: number;
  /** Maximum reconnection attempts before transitioning to the terminal `failed`
   * phase. Matches the configured `maxReconnectAttempts` (defaults to 3). */
  maxReconnectAttempts: number;
  /**
   * True for a short window after a successful reconnect so the UI can show a
   * transient "Reconnected" message. Callers may clear it via
   * {@link acknowledgeReconnect} once the message has been displayed.
   */
  reconnectedRecently: boolean;
  /** Dismiss the transient "Reconnected" message once shown to the user. */
  acknowledgeReconnect: () => void;
  // --- Issue #1254: per-peer reconnect-token (IndexedDB-backed) ---
  /**
   * The persisted reconnect token for the current (gameCode, playerId)
   * pair, or `null` when no token exists / has expired / has been
   * purged. Surfaced so the lobby UI can attempt a silent rejoin
   * (claim the held seat via the host-side seat reservation, replay
   * missed messages) before falling through to the manual-entry lobby.
   */
  reconnectToken: ReconnectToken | null;
  /**
   * False until the initial store lookup completes. The lobby UI MUST
   * gate on this before falling through to manual entry, otherwise a
   * fast refresh could briefly flash the manual-entry screen before
   * the IDB read resolves.
   */
  reconnectTokenLookupDone: boolean;
  /**
   * Proactively clear the stored token for this (gameCode, playerId)
   * pair. Call on game end / lobby close so the 30-minute TTL is a
   * worst-case bound rather than the typical one. Returns `true` when
   * the delete succeeded (or there was nothing to delete).
   */
  clearReconnectToken: () => Promise<boolean>;
}

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
  } = options;

  const fallbackHostId =
    initialHostId ?? (role === "host" ? playerId : playerId);
  const [connectionState, setConnectionState] =
    useState<P2PConnectionState>("disconnected");
  const [signalingState, setSignalingState] =
    useState<LocalSignalingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handshakeState, setHandshakeState] = useState<HandshakeState>("idle");
  const [currentHostId, setCurrentHostIdState] =
    useState<string>(fallbackHostId);
  const [connectionFailureReason, setConnectionFailureReason] =
    useState<ConnectionFailureDiagnostic | null>(null);
  // --- Issue #988: reconnection UI state ---
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnectedRecently, setReconnectedRecently] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const hadConnectedRef = useRef(false);
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
  // --- Issue #1090: graceful degradation to local hot-seat ---
  const [degradedToLocal, setDegradedToLocal] = useState(false);
  const [terminalFailureDismissed, setTerminalFailureDismissed] =
    useState(false);
  const [lastGameState, setLastGameState] = useState<GameState | null>(null);
  const lastGameStateRef = useRef<GameState | null>(null);
  const degradedRef = useRef(false);
  const connectionRef = useRef<P2PGameConnection | null>(null);
  const handshakeSessionRef = useRef<HandshakeSession | null>(null);
  const conflictManagerRef = useRef<ConflictResolutionManager | null>(null);
  const hostMigrationRef = useRef<HostMigrationManager | null>(null);
  // Keep latest callbacks in refs so the connection event handlers (created
  // once per initialize) always see the current props without re-creating.
  const onHostMigratedRef = useRef(onHostMigrated);
  const onGameTerminatedRef = useRef(onGameTerminated);
  const onDegradedToLocalRef = useRef(onDegradedToLocal);
  onHostMigratedRef.current = onHostMigrated;
  onGameTerminatedRef.current = onGameTerminated;
  onDegradedToLocalRef.current = onDegradedToLocal;

  // --- Issue #1086: authoritative-state reconciliation after ICE-restart ---
  // Pure coordinator tracking pending actions during disconnect and producing
  // the reconcile decision on reconnect. See src/lib/p2p-reconciliation.ts.
  const reconcileRef = useRef<ReconciliationCoordinator>(
    new ReconciliationCoordinator(),
  );
  // Mirrors `currentHostId` so the once-created onReconnect handler reads the
  // latest authority without re-creating the connection.
  const currentHostIdRef = useRef(fallbackHostId);
  currentHostIdRef.current = currentHostId;
  // True on a non-host peer between its reconnect and the arrival of the
  // host's authoritative full sync (the snapshot it must adopt).
  const awaitingReconciliationRef = useRef(false);
  const [droppedPendingActions, setDroppedPendingActions] = useState<
    PendingAction[]
  >([]);

  // Initialize conflict resolution manager
  useEffect(() => {
    if (enableConflictResolution && !conflictManagerRef.current) {
      conflictManagerRef.current = new ConflictResolutionManager({
        strategy: conflictResolutionStrategy,
        hostId: role === "host" ? playerId : "",
      });
    }
  }, [enableConflictResolution, conflictResolutionStrategy, role, playerId]);

  // Initialize host migration manager
  useEffect(() => {
    if (enableHostMigration && !hostMigrationRef.current) {
      hostMigrationRef.current = createHostMigrationManager({
        localPlayerId: playerId,
        initialHostId: fallbackHostId,
        initialPeers: migrationPeers,
        events: {
          onPromotedToHost: (result) => {
            p2pLogger.info(
              "Promoted to host after migration",
              result.newHostId,
            );
            conflictManagerRef.current?.updateConfig({
              hostId: result.newHostId,
            });
            onHostMigratedRef.current?.(result);
          },
          onHostChanged: (result) => {
            p2pLogger.info("Remote peer promoted to host", result.newHostId);
            conflictManagerRef.current?.updateConfig({
              hostId: result.newHostId,
            });
            onHostMigratedRef.current?.(result);
          },
          onTerminated: (reason) => {
            p2pLogger.warn("Multiplayer game terminated", reason);
            setError(reason);
            onGameTerminatedRef.current?.(reason);
          },
        },
      });
      setCurrentHostIdState(hostMigrationRef.current.getHostId());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableHostMigration, playerId, fallbackHostId]);

  const setCurrentHostId = useCallback((hostId: string) => {
    setCurrentHostIdState(hostId);
  }, []);

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
  }, [enableHandshake, connectionState, playerId, gameCode, playerName]);

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
  }, []);

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
  const getReconnectAttempts = useCallback(() => {
    const conn = connectionRef.current as any;
    return conn?.["reconnectAttempts"] || 0;
  }, []);
  const getMaxReconnectAttempts = useCallback(() => {
    const conn = connectionRef.current as any;
    return conn?.["maxReconnectAttempts"] || 3;
  }, []);

  const connectionHealth = useConnectionHealth({
    getConnectionState,
    getReconnectAttempts,
    getMaxReconnectAttempts,
    enableMonitoring: true,
  });

  // --- Host migration helpers (issue #916) ---

  // Cache the latest authoritative game state so a promoted host can adopt it.
  const cacheGameStateForMigration = useCallback((gameState: GameState) => {
    hostMigrationRef.current?.setLastKnownGameState(gameState);
  }, []);

  // Cache the latest observed game state (sent or received) so it can be
  // migrated to local hot-seat storage on a terminal P2P failure (#1090).
  const cacheLatestGameState = useCallback((gameState: GameState) => {
    lastGameStateRef.current = gameState;
    setLastGameState(gameState);
  }, []);

  // Track a newly-joined peer for successor-selection purposes.
  const registerPeerForMigration = useCallback(
    (peerPlayerId: string, peerPlayerName: string) => {
      hostMigrationRef.current?.upsertPeer({
        playerId: peerPlayerId,
        playerName: peerPlayerName,
        joinedAt: Date.now(),
      });
    },
    [],
  );

  // Apply a received host-migration message (idempotent).
  const applyHostMigrationMessage = useCallback(
    (message: HostMigrationMessage) => {
      const manager = hostMigrationRef.current;
      if (!manager) return;
      const result = manager.applyMigration(message);
      if (result) {
        setCurrentHostId(manager.getHostId());
      }
    },
    [setCurrentHostId],
  );

  // Handle a peer leaving. If it was the host, run migration: the deterministic
  // successor broadcasts a migration message and promotes itself; others apply
  // it on receipt. If too few peers remain, the manager terminates cleanly.
  const handlePeerLeftForMigration = useCallback(
    (peerPlayerId: string, reason: "host-disconnected" | "host-left") => {
      const manager = hostMigrationRef.current;
      if (!manager) return;

      const wasHost = manager.getHostId() === peerPlayerId;
      manager.removePeer(peerPlayerId);

      if (!wasHost) return;

      const result = manager.initiateMigration(reason);
      if (result.terminated) {
        // onTerminated event already fired by the manager.
        return;
      }

      if (result.promotedSelf) {
        setCurrentHostId(manager.getHostId());
        const message = manager.buildMigrationMessage(result);
        connectionRef.current?.sendGameAction("host-migration", message);
      }
      // Non-successor peers do nothing here; they apply the successor's
      // broadcast via applyHostMigrationMessage when it arrives.
    },
    [setCurrentHostId],
  );

  // Inspect a game-action message and route host-migration messages.
  const handleMigrationGameAction = useCallback(
    (action: string, data: unknown) => {
      if (action !== "host-migration") return;
      if (!data || typeof data !== "object") return;
      const message = data as HostMigrationMessage;
      if (message.type !== "host-migration") return;
      applyHostMigrationMessage(message);
    },
    [applyHostMigrationMessage],
  );

  // --- Issue #1086: reconciliation after ICE-restart reconnect ---

  // Drive the reconcile decision when the transport recovers. The host pushes
  // its authoritative full state; a non-host peer arms adoption and pulls a
  // fresh snapshot (belt-and-suspenders alongside the host's reconnect push).
  // `droppedPendingActions` surfaced for the adopt path come from the
  // onGameStateSync adoption below. See src/lib/p2p-reconciliation.ts.
  const handleReconnect = useCallback(() => {
    // Issue #988: a successful reconnect deserves a transient "Reconnected"
    // user-facing message. Reset attempt counters and arm the flag the UI
    // consumes (cleared via `acknowledgeReconnect`).
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setReconnectedRecently(true);

    const coordinator = reconcileRef.current;
    const isHost = currentHostIdRef.current === playerId;
    const decision = coordinator.onReconnect({
      isHost,
      hasAuthoritativeState: lastGameStateRef.current !== null,
    });
    if (
      decision.action === "send-authoritative-state" &&
      lastGameStateRef.current
    ) {
      p2pLogger.info(
        "Reconnected as host; pushing authoritative full state to peer",
      );
      connectionRef.current?.sendGameState(lastGameStateRef.current, true);
    } else if (decision.action === "adopt-host-state") {
      // Arm adoption: the NEXT authoritative full sync received is adopted and
      // pending actions are dropped. Also explicitly request a snapshot so a
      // host push that raced ahead of this reconnect still produces an adopt.
      awaitingReconciliationRef.current = true;
      p2pLogger.info(
        "Reconnected as peer; awaiting host authoritative state for reconciliation",
      );
      connectionRef.current?.requestStateSync();
    }
  }, [playerId]);

  // Acknowledge the transient "Reconnected" message — caller fires once the
  // banner has been shown so the hook does not flip the flag back on. Issue
  // #988.
  const acknowledgeReconnect = useCallback(() => {
    setReconnectedRecently(false);
  }, []);

  // On a received game-state sync, if we are awaiting reconciliation, adopt
  // the host's authoritative state (source of truth) and drop the pending
  // actions that never reached the host. Idempotent: a duplicate full sync
  // with no pending queued between syncs drops nothing.
  const adoptHostStateIfAwaiting = useCallback(() => {
    if (!awaitingReconciliationRef.current) return;
    awaitingReconciliationRef.current = false;
    const dropped = reconcileRef.current.adoptAuthoritativeState();
    if (dropped.length > 0) {
      p2pLogger.warn(
        "Reconciled to host authoritative state; dropped pending actions",
        dropped.length,
      );
      setDroppedPendingActions(dropped);
    }
  }, []);

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
          events: {
            onConnectionStateChange: (state) => {
              setConnectionState(state);
              if (state === "failed") {
                const conn = connectionRef.current as any;
                setConnectionFailureReason(
                  conn?.getLastFailureDiagnostic?.() ?? null,
                );
              }
              // Issue #988: track reconnection attempts. The hook does not
              // own the underlying reconnect loop — that lives in
              // WebRTCConnection / the browser RTCPeerConnection — but it does
              // own the user-facing count of how many times we have observed
              // a drop after having been connected. Each observed drop
              // increments; a successful reconnect resets to 0 via
              // `handleReconnect` above. Capped at `maxReconnectAttempts + 1`
              // so the UI can label the terminal attempt explicitly.
              if (state === "disconnected" || state === "reconnecting") {
                if (hadConnectedRef.current) {
                  const next = Math.min(
                    reconnectAttemptsRef.current + 1,
                    MAX_RECONNECT_ATTEMPTS_DISPLAY + 1,
                  );
                  reconnectAttemptsRef.current = next;
                  setReconnectAttempts(next);
                }
              } else if (state === "connected") {
                // Successful recovery (or initial connect): clear the
                // transient "Reconnected" message flag only if we are NOT in
                // a recovery edge — the actual flag flip happens in
                // handleReconnect so it survives handler re-binding.
                hadConnectedRef.current = true;
              }
            },
            onReconnect: handleReconnect,
            onSignalingStateChange: setSignalingState,
            onMessage: (message) => {
              p2pLogger.debug("Received message:", message.type);

              // Handle handshake messages if enabled
              if (enableHandshake && handshakeSessionRef.current) {
                // Handshake message handling would go here
                // For now, we just log them
              }

              // Route host-migration announcements (issue #916).
              if (message.type === "game-action") {
                const payload = message.data as
                  | { action?: string; data?: unknown }
                  | undefined;
                if (payload?.action) {
                  handleMigrationGameAction(payload.action, payload.data);
                }
              }
            },
            onGameStateSync: (gameState) => {
              p2pLogger.debug("Received game state sync");
              cacheGameStateForMigration(gameState);
              cacheLatestGameState(gameState);
              // Issue #1086: adopt the host's authoritative state on
              // reconnect-driven reconciliation (drops pending actions).
              adoptHostStateIfAwaiting();

              // Verify checksum if handshake completed
              if (
                handshakeState === "completed" &&
                handshakeSessionRef.current
              ) {
                const remoteChecksum =
                  handshakeSessionRef.current.getRemoteChecksum();
                if (remoteChecksum) {
                  const isValid = verifyChecksum(gameState, remoteChecksum);
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
              setError(err.message);
            },
            onPlayerJoined: (playerId, playerName) => {
              p2pLogger.debug("Player joined:", playerName);
              registerPeerForMigration(playerId, playerName);

              // Start handshake with new player
              if (enableHandshake && handshakeSessionRef.current) {
                const initMessage = handshakeSessionRef.current.start(playerId);
                // Send init message to peer
                connectionRef.current?.sendGameAction(
                  "handshake-init",
                  initMessage,
                );
              }
            },
            onPlayerLeft: (playerId) => {
              p2pLogger.debug("Player left:", playerId);
              handlePeerLeftForMigration(playerId, "host-disconnected");

              // Cleanup handshake
              if (handshakeSessionRef.current) {
                handshakeSessionRef.current.cleanup();
                setHandshakeState("idle");
              }
            },
          },
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
      cacheGameStateForMigration,
      cacheLatestGameState,
      registerPeerForMigration,
      handlePeerLeftForMigration,
      handleMigrationGameAction,
      handleReconnect,
      adoptHostStateIfAwaiting,
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
          events: {
            onConnectionStateChange: (state) => {
              setConnectionState(state);
              if (state === "failed") {
                const conn = connectionRef.current as any;
                setConnectionFailureReason(
                  conn?.getLastFailureDiagnostic?.() ?? null,
                );
              }
              // Issue #988: same attempt tracking as the host path — see the
              // matching comment in initializeAsHost above.
              if (state === "disconnected" || state === "reconnecting") {
                if (hadConnectedRef.current) {
                  const next = Math.min(
                    reconnectAttemptsRef.current + 1,
                    MAX_RECONNECT_ATTEMPTS_DISPLAY + 1,
                  );
                  reconnectAttemptsRef.current = next;
                  setReconnectAttempts(next);
                }
              } else if (state === "connected") {
                hadConnectedRef.current = true;
              }
            },
            onReconnect: handleReconnect,
            onSignalingStateChange: setSignalingState,
            onMessage: (message) => {
              p2pLogger.debug("Received message:", message.type);

              // Route host-migration announcements (issue #916).
              if (message.type === "game-action") {
                const payload = message.data as
                  | { action?: string; data?: unknown }
                  | undefined;
                if (payload?.action) {
                  handleMigrationGameAction(payload.action, payload.data);
                }
              }
            },
            onGameStateSync: (gameState) => {
              p2pLogger.debug("Received game state sync");
              cacheGameStateForMigration(gameState);
              cacheLatestGameState(gameState);
              // Issue #1086: adopt the host's authoritative state on
              // reconnect-driven reconciliation (drops pending actions).
              adoptHostStateIfAwaiting();
            },
            onChat: (chatMessage) => {
              p2pLogger.debug("Received chat:", chatMessage.text);
            },
            onError: (err) => {
              setError(err.message);
            },
            onPlayerJoined: (playerId, playerName) => {
              p2pLogger.debug("Player joined:", playerName);
              registerPeerForMigration(playerId, playerName);
            },
            onPlayerLeft: (playerId) => {
              p2pLogger.debug("Player left:", playerId);
              handlePeerLeftForMigration(playerId, "host-disconnected");

              // Cleanup handshake
              if (handshakeSessionRef.current) {
                handshakeSessionRef.current.cleanup();
                setHandshakeState("idle");
              }
            },
          },
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
      cacheGameStateForMigration,
      cacheLatestGameState,
      registerPeerForMigration,
      handlePeerLeftForMigration,
      handleMigrationGameAction,
      handleReconnect,
      adoptHostStateIfAwaiting,
    ],
  );

  // Process answer (host only)
  const processAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit): Promise<void> => {
      if (!connectionRef.current) {
        throw new Error("No active connection");
      }

      try {
        setError(null);
        await connectionRef.current.processAnswer(answer);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to process answer";
        setError(errorMessage);
        throw err;
      }
    },
    [],
  );

  // Process ICE candidates
  const processIceCandidates = useCallback(
    async (candidates: RTCIceCandidateInit[]): Promise<void> => {
      if (!connectionRef.current) {
        throw new Error("No active connection");
      }

      try {
        setError(null);
        await connectionRef.current.processIceCandidates(candidates);
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to process ICE candidates";
        setError(errorMessage);
        throw err;
      }
    },
    [],
  );

  // Send game state
  const sendGameState = useCallback(
    (gameState: GameState, isFullSync: boolean = false): boolean => {
      // Cache the outgoing state so it is available for local migration on
      // a later terminal failure (#1090).
      cacheLatestGameState(gameState);
      if (!connectionRef.current) {
        return false;
      }

      return connectionRef.current.sendGameState(gameState, isFullSync);
    },
    [cacheLatestGameState],
  );

  // Send game action with conflict resolution
  const sendGameAction = useCallback(
    (
      action: string,
      data: unknown,
    ): { success: boolean; action?: TimestampedAction; queued?: boolean } => {
      if (!connectionRef.current) {
        return { success: false };
      }

      // Issue #1086: while the transport is down, record the action as
      // pending so it can be reconciled (re-submitted if the local node is
      // the host, or dropped with notice if the host's authoritative state is
      // adopted on reconnect). Best-effort — never blocks the send path.
      if (connectionState !== "connected") {
        reconcileRef.current.recordPendingAction(action, data);
      }

      // Apply conflict resolution if enabled
      if (enableConflictResolution && conflictManagerRef.current) {
        const result = conflictManagerRef.current.processAction(
          action,
          data,
          playerId,
          playerName,
        );

        if (result.shouldQueue) {
          return {
            success: false,
            action: result.action,
            queued: true,
          };
        }

        if (result.shouldProcess && result.action) {
          const success = connectionRef.current.sendGameAction(action, data);
          return {
            success,
            action: result.action,
            queued: false,
          };
        }
      }

      // No conflict resolution, send directly
      const success = connectionRef.current.sendGameAction(action, data);
      return { success };
    },
    [playerId, playerName, enableConflictResolution, connectionState],
  );

  // Request a fresh authoritative state sync from the host (issue #1086).
  const requestStateSync = useCallback((): boolean => {
    return connectionRef.current?.requestStateSync() ?? false;
  }, []);

  // Send chat
  const sendChat = useCallback((text: string): boolean => {
    if (!connectionRef.current) {
      return false;
    }

    return connectionRef.current.sendChat(text);
  }, []);

  // Close connection
  const closeConnection = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }
    if (handshakeSessionRef.current) {
      handshakeSessionRef.current.cleanup();
    }
    hostMigrationRef.current?.reset();
    setCurrentHostIdState(fallbackHostId);
    setConnectionState("disconnected");
    setSignalingState(null);
    setHandshakeState("idle");
    setError(null);
    setConnectionFailureReason(null);
    // Reset degrade-to-local bookkeeping so a fresh session starts clean.
    degradedRef.current = false;
    setDegradedToLocal(false);
    setTerminalFailureDismissed(false);
    lastGameStateRef.current = null;
    setLastGameState(null);
    // Reset reconciliation bookkeeping so a fresh session starts clean.
    reconcileRef.current.clear();
    awaitingReconciliationRef.current = false;
    setDroppedPendingActions([]);
    // Issue #988: reset reconnection UI state for a fresh session.
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setReconnectedRecently(false);
    hadConnectedRef.current = false;
  }, [fallbackHostId]);

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

  // --- Issue #1090: graceful degradation to local hot-seat ---

  // Tear down the dead P2P connection without ever throwing into the caller.
  const safeCloseConnection = useCallback(() => {
    try {
      connectionRef.current?.close();
    } catch (err) {
      p2pLogger.warn("Error closing failed P2P connection", String(err));
    }
    connectionRef.current = null;
  }, []);

  // Migrate the in-progress game to local hot-seat storage and switch modes.
  // Idempotent: a second call is a no-op once degradedToLocal is true.
  const continueAsLocalHotSeat =
    useCallback(async (): Promise<LocalHotSeatMigrationResult> => {
      if (degradedRef.current) {
        return { ok: true };
      }

      const gameState = lastGameStateRef.current;

      // No game state to preserve: still leave multiplayer cleanly and notify.
      if (!gameState) {
        degradedRef.current = true;
        setDegradedToLocal(true);
        setError(null);
        safeCloseConnection();
        onDegradedToLocalRef.current?.({
          resumeKey: null,
          gameId: null,
          hadGameState: false,
        });
        return { ok: true, hadGameState: false };
      }

      try {
        const resumeKey = `p2p_${gameState.gameId || Date.now().toString(36)}`;
        const session = await saveGameForLocalHotSeat(gameState, {
          resumeKey,
          playerName,
        });
        degradedRef.current = true;
        setDegradedToLocal(true);
        setError(null);
        safeCloseConnection();
        p2pLogger.info(
          "Degraded to local hot-seat after terminal P2P failure",
          session.gameId,
        );
        onDegradedToLocalRef.current?.({
          resumeKey: session.resumeKey ?? resumeKey,
          gameId: session.gameId,
          hadGameState: true,
        });
        return {
          ok: true,
          resumeKey: session.resumeKey ?? resumeKey,
          gameId: session.gameId,
          hadGameState: true,
        };
      } catch (err) {
        // Never let the degrade path crash the UI — surface as a normal error.
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to migrate game to local hot-seat";
        p2pLogger.error("Local hot-seat migration failed", msg);
        setError(msg);
        return { ok: false, error: msg };
      }
    }, [playerName, safeCloseConnection]);

  // Persist the in-progress game to IndexedDB for later resume WITHOUT
  // switching modes (the user chose "save for later" rather than continue).
  const saveForLocalResume =
    useCallback(async (): Promise<LocalHotSeatSaveResult> => {
      const gameState = lastGameStateRef.current;
      if (!gameState) {
        return { ok: false, error: "No in-progress game state to save" };
      }
      try {
        const resumeKey = `resume_${gameState.gameId || Date.now().toString(36)}`;
        const session = await saveGameForLocalHotSeat(gameState, {
          resumeKey,
          playerName,
        });
        return { ok: true, resumeKey: session.resumeKey ?? resumeKey };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to save game for local resume";
        setError(msg);
        return { ok: false, error: msg };
      }
    }, [playerName]);

  // The user chose to abandon: tear down and dismiss the degrade prompt.
  const dismissTerminalFailure = useCallback(() => {
    safeCloseConnection();
    setTerminalFailureDismissed(true);
  }, [safeCloseConnection]);

  // Terminal failure is a distinct, actionable state: the P2P connection has
  // failed AND fallback/reconnection is exhausted, the user has not yet
  // migrated or abandoned, and we are not already in local mode.
  const terminalFailure =
    connectionState === "failed" &&
    !degradedToLocal &&
    !terminalFailureDismissed;

  // --- Issue #988: derive the user-facing reconnection phase ---
  // Order of precedence (highest first):
  //   1. Transient "Reconnected" message immediately after a recovery edge.
  //   2. Terminal "failed" (after reconnection exhausted) and the user has
  //      not yet migrated/abandoned — surface the recovery prompt.
  //   3. Mid-flight "reconnecting" (the transport reports it actively).
  //   4. Lost after having been connected (silent pre-#988 bug).
  //   5. Stable — nothing to show.
  const reconnectionPhase: ReconnectionPhase = (() => {
    if (reconnectedRecently) return "recovered";
    if (terminalFailure) return "failed";
    if (connectionState === "reconnecting") return "reconnecting";
    if (
      connectionState === "disconnected" &&
      hadConnectedRef.current &&
      !degradedToLocal
    ) {
      return "lost";
    }
    return "stable";
  })();

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
  };
}

// Import handshake verification for use in the hook
function verifyChecksum(gameState: GameState, checksum: string): boolean {
  // Simple checksum verification - in production use the full implementation
  const data = JSON.stringify(gameState);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const computedChecksum = (hash >>> 0).toString(16);
  return computedChecksum === checksum;
}

/**
 * Issue #1254 — generate a fresh per-session shared secret used by the
 * reconnect-token store. Cryptographically random; never reused across
 * sessions so a leaked token cannot resurrect a future game.
 */
function generateSessionKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback (only hit on platforms without crypto). NOT
  // cryptographically secure — preferable to a hard failure when the
  // reconnect-token store is unavailable, the caller will skip the save
  // gracefully anyway.
  let fallback = "";
  for (let i = 0; i < 64; i += 1) {
    fallback += Math.floor(Math.random() * 16).toString(16);
  }
  return fallback;
}
