/**
 * Multiplayer type definitions for lobby management and game hosting
 */

export type GameFormat = 'commander' | 'standard' | 'modern' | 'pioneer' | 'legacy' | 'vintage' | 'pauper';
export type PlayerCount = '2' | '3' | '4';
export type LobbyStatus = 'waiting' | 'ready' | 'in-progress';
export type PlayerStatus = 'not-ready' | 'ready' | 'host';
export type GameMode = '1v1' | '2v2' | 'ffa' | 'commander-1v1' | 'commander-ffa';

/**
 * Issue #1255 — explicit lobby lifecycle states. The previous code conflated
 * `status: 'waiting' | 'in-progress'` with the lobby's roster phase, which
 * meant a host could fire `startGame` the moment the second peer joined —
 * racing the second peer's first `PlayerActionMessage`. The state machine
 * adds an explicit `READY_CHECK` (quorum gate) and `STARTING` (consensus
 * locked, transitioning into the game) between the two.
 *
 * Transitions:
 *   WAITING     → READY_CHECK   (peer count >= 2, host triggers check)
 *   READY_CHECK → STARTING      (quorum reached OR window expired)
 *   STARTING    → IN_GAME       (consensus message echoed by all peers)
 *   IN_GAME     → ENDED         (game-over handshake)
 *   READY_CHECK → WAITING       (host cancels; quorum failed AND window open)
 *   *           → WAITING       (closeLobby resets to a fresh state)
 */
export type LobbyState =
  | 'WAITING'
  | 'READY_CHECK'
  | 'STARTING'
  | 'IN_GAME'
  | 'ENDED';

/**
 * Issue #1255 — distinguishes a full-roster ready check (e.g. when 2nd peer
 * joins) from a late-joiner check (a single peer arriving during IN_GAME).
 * The UI uses the `kind` to render a different copy: the full check waits
 * for every non-spectator peer; the late-joiner check is a single-peer gate.
 */
export type ReadyCheckKind = 'full' | 'late-joiner';

/**
 * Issue #1255 — per-peer answer to a `READY_CHECK_REQUEST`. Stored on the
 * host's `ReadyCheckSession.responses` map; one entry per peerId once the
 * peer has answered. A peer that has not yet answered is implicitly
 * `ready: false` and contributes to the "missing responses" set.
 */
export interface ReadyCheckResponse {
  peerId: string;
  ready: boolean;
  /** Wall-clock ms when the host received the response. */
  respondedAt: number;
}

/**
 * Issue #1255 — the active ready-check session, owned by the host. Persists
 * `startedAt` (so the UI can render a countdown), the `windowMs` for the
 * specific check, the set of `targetPeerIds` that must answer, and any
 * responses received so far.
 *
 * `kind: 'late-joiner'` implies a single target (the joining peer); the
 * countdown uses `LOBBY_LATE_JOINER_READY_CHECK_MS` (shorter than the
 * full check) so the existing peers are not blocked for 15 s while a
 * single latecomer affirms ready.
 */
export interface ReadyCheckSession {
  id: string;
  kind: ReadyCheckKind;
  /** Wall-clock ms when the host opened the check. */
  startedAt: number;
  /** How long the check stays open before auto-advancing. */
  windowMs: number;
  /** Peer IDs that must affirm ready before the check resolves. */
  targetPeerIds: string[];
  /** Map of peerId → response, populated as peers answer. */
  responses: Record<string, ReadyCheckResponse>;
  /**
   * If the host cancels the check (e.g. a peer dropped mid-check) this is
   * the wall-clock ms when the cancel was issued; the session is
   * considered terminal once set. Without this, late `READY_CHECK_RESPONSE`
   * messages could resurrect a closed session.
   */
  cancelledAt: number | null;
}

/**
 * Issue #1255 — seat-hold entry. When a peer disconnects mid-game the
 * host reserves their seat for {@link LOBBY_SEAT_HOLD_DURATION_MS} so the
 * reconnect-token store (issue #1087) can reattach the same player slot
 * without the host opening the seat to a new joiner.
 *
 * A late joiner arriving while a seat is held is rejected; the UI tells
 * the joiner "Waiting for {originalPlayerId} to reconnect…".
 */
export interface SeatHold {
  peerId: string;
  /** Human-readable label so the UI can show "Alex's seat is held". */
  originalName: string;
  /** Wall-clock ms when the hold was issued. */
  heldAt: number;
  /** Wall-clock ms when the hold expires; auto-released past this point. */
  expiresAt: number;
  /** Why the hold was created (e.g. 'peer-disconnected'). */
  reason: 'peer-disconnected' | 'rejoin-window';
}

// Team-related types for 2v2 mode
export type TeamId = 'team-a' | 'team-b';

export interface Team {
  id: TeamId;
  name: string;
  color: string; // CSS color for visual distinction
  playerIds: string[];
  // Shared life total for Two-Headed Giant variant
  sharedLifeTotal?: number;
}

export interface TeamAssignment {
  playerId: string;
  teamId: TeamId;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  deckId?: string;
  deckName?: string;
  deckFormat?: string; // Format the deck was built for
  deckValidationErrors?: string[]; // Validation errors for the selected deck
  joinedAt: number;
  // Team assignment for 2v2 mode
  teamId?: TeamId;
}

export interface GameLobby {
  id: string;
  gameCode: string;
  name: string;
  hostId: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  players: Player[];
  status: LobbyStatus;
  createdAt: number;
  settings: LobbySettings;
  gameMode: GameMode;
  // Teams for 2v2 mode
  teams?: Team[];
  // 2v2 specific settings
  teamSettings?: TeamSettings;
  /**
   * Issue #1255 — explicit state-machine phase. Optional for backward
   * compatibility with persisted lobbies that pre-date the state machine;
   * {@link LobbyState} defaults to 'WAITING' when absent.
   */
  state?: LobbyState;
  /**
   * Issue #1253 — read-only spectators in the lobby. The host mints a
   * {@link import("./p2p-handshake").SpectatorCapabilityToken} for each
   * entry; the spectator presents the token during the
   * `SpectatorHandshake` to be admitted. Optional for backward
   * compatibility with persisted lobbies that pre-date the spectator
   * transport; defaults to `[]` when absent.
   */
  spectators?: import("./spectator").Spectator[];
}

export interface TeamSettings {
  sharedLife: boolean; // Two-Headed Giant variant (shared life total)
  sharedBlockers: boolean; // Teammates can block together
  teamChat: boolean; // Private chat between teammates
  startingLifePerTeam: number; // Default 30 for Two-Headed Giant
}

export interface LobbySettings {
  allowSpectators: boolean;
  password?: string;
  isPublic: boolean;
  timerEnabled: boolean;
  timerMinutes?: number;
}

export interface LobbyMessage {
  type: 'player-joined' | 'player-left' | 'player-ready' | 'player-not-ready' | 'game-starting' | 'chat' | 'host-migration' | 'error';
  data: unknown;
  senderId?: string;
  timestamp: number;
}

/**
 * Issue #1255 — host-to-peer ready-check request. Carries the session id so
 * a peer that arrived late (and whose `READY_CHECK_REQUEST` was queued
 * before they joined) can target the right session, and the `windowMs` so
 * the peer can render a client-side countdown even if the host's clock
 * drifts from the peer's.
 */
export interface ReadyCheckRequestMessage {
  type: 'ready-check-request';
  data: {
    sessionId: string;
    kind: ReadyCheckKind;
    startedAt: number;
    windowMs: number;
    targetPeerIds: string[];
  };
  senderId: string;
  timestamp: number;
}

/**
 * Issue #1255 — peer-to-host ready-check response. Host correlates on
 * `sessionId`; `peerId` is the responding peer's id. A peer's `ready: false`
 * is honored as a vote and counts as a response (so the host can advance
 * to STARTING on a quorum of "all answered", not "all said yes").
 */
export interface ReadyCheckResponseMessage {
  type: 'ready-check-response';
  data: {
    sessionId: string;
    peerId: string;
    ready: boolean;
  };
  senderId: string;
  timestamp: number;
}

/**
 * Host-migration announcement (issue #916). Broadcast when the authoritative
 * host leaves so a remaining peer can be promoted and the game continues.
 * Re-exported from the host-migration module for convenience.
 */
export interface HostMigrationLobbyMessage extends LobbyMessage {
  type: 'host-migration';
  data: {
    migrationId: string;
    previousHostId: string;
    newHostId: string;
    remainingPeers: string[];
    gameState: unknown;
    reason: 'host-disconnected' | 'host-left';
  };
}

export interface HostGameConfig {
  name: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  settings: LobbySettings;
  gameMode?: GameMode;
}
