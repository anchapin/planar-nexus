/**
 * Public types for the `useP2PConnection` hook surface.
 *
 * Extracted from `src/hooks/use-p2p-connection.ts` (issue #1927) so the
 * hook file stays focused on composition. Re-exported from the hook module
 * for backward compatibility — import from either place.
 */

import type { GameState } from "@/lib/game-state";
import type {
  P2PGameConnection,
  P2PConnectionState,
  SignalingRole,
  GameEndedPayload,
} from "@/lib/p2p-game-connection";
import type { LocalSignalingState } from "@/lib/local-signaling-client";
import type {
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "@/lib/webrtc-types";
import type { HandshakeState } from "@/lib/p2p-handshake";
import type { TimestampedAction } from "@/lib/p2p-conflict-resolution";
import type {
  PeerRosterEntry,
  HostMigrationResult,
} from "@/lib/p2p-host-migration";
import type { PendingAction } from "@/lib/p2p-reconciliation";
import type { ConnectionHealth } from "@/hooks/use-connection-health";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";
import type { ReconnectToken } from "@/lib/p2p-reconnect-store";
import type { PeerRole } from "@/lib/peer-role";

/**
 * Upper bound for the user-facing "attempt N of M" label in the reconnection
 * UI (issue #988). The hook does not own the actual reconnection loop; this
 * constant is the maximum displayed attempt number before the UI switches to
 * the terminal "Reconnection failed" message. The underlying transport's
 * own `maxReconnectAttempts` is plumbed via {@link P2PConnectionState}
 * callers and may differ; this is purely a display bound.
 */
export const MAX_RECONNECT_ATTEMPTS_DISPLAY = 3;

export interface UseP2PConnectionOptions {
  playerId: string;
  playerName: string;
  role: SignalingRole;
  gameCode?: string;
  enableHandshake?: boolean;
  enableConflictResolution?: boolean;
  conflictResolutionStrategy?:
    "host-wins" | "timestamp-based" | "priority-based" | "round-robin";
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
  /**
   * Local peer's role (issue #1253). When the local peer is a spectator or
   * moderator, the hook gates `sendGameAction` and routes inbound
   * `game-action` messages through the read-only allowlist. Defaults to
   * {@link DEFAULT_PEER_ROLE} (`'player'`) so existing 1:1 / host call sites
   * are unaffected.
   */
  localRole?: PeerRole;
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
 * Derived from the connection state by `useP2PConnection`. The UI uses
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
 *                    that hands off to `P2PDegradeDialog`.
 */
export type ReconnectionPhase =
  "stable" | "lost" | "reconnecting" | "recovered" | "failed";

/**
 * Result of `UseP2PConnectionReturn.continueAsLocalHotSeat`.
 */
export interface LocalHotSeatMigrationResult {
  ok: boolean;
  resumeKey?: string;
  gameId?: string;
  hadGameState?: boolean;
  error?: string;
}

/**
 * Result of `UseP2PConnectionReturn.saveForLocalResume`.
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
   * `P2PReconnectionStatus` component.
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
   * `acknowledgeReconnect` once the message has been displayed.
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
  // --- Issue #1253: per-peer role ---
  /**
   * Local peer's role. Mirrored from the `localRole` option so the UI
   * can render a spectator-specific layout (e.g. "Watching as Alex —
   * read only") without re-deriving it from the transport.
   */
  localRole: PeerRole;
  /**
   * Set the local peer's role. Called after the spectator handshake
   * completes (the host `ack`s the role and the local client adopts
   * it). A cross-boundary change (player ⇄ non-player) requires a
   * fresh handshake — the hook does not enforce that here, it trusts
   * the host's `ack` to validate the new role.
   */
  setLocalRole: (role: PeerRole) => void;
  /**
   * Cumulative count of inbound messages dropped because the local
   * role disallowed them (issue #1253). Surfaced in the diagnostics
   * panel so a misconfigured spectator (or a hostile peer pushing
   * actions at a spectator) can be diagnosed. Reset on
   * `closeConnection`.
   */
  spectatorDrops: number;
  // --- Issue #1570: game-ended event surface ---
  /**
   * The most recent `game-ended` payload received from the host during
   * this session (see `GameEndedPayload`), or `null` when no
   * terminal event has arrived yet (or after `closeConnection`).
   *
   * The hook ALSO persists a `MatchRecord` row to Dexie on receipt so
   * the durable source of truth for match history is
   * `localIntelligenceDb.match_records` — there is no other store
   * (issue #1863 closed the `useLocalStorage` mirror). The `gameEnded`
   * field here is for UI banner / state-update consumption only
   * (e.g. a "Game Over" toast before the user dismisses it); future
   * match-history UI must read from `match_records` directly.
   */
  gameEnded: GameEndedPayload | null;
}
