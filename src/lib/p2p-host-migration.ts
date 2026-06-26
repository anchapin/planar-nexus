/**
 * P2P Host Migration
 *
 * Issue #916: When the authoritative host disconnects from a multiplayer game,
 * promote a remaining peer to host so the game continues instead of
 * terminating for everyone.
 *
 * This module is intentionally transport-agnostic and kept distinct from the
 * ICE-restart reconnection logic in `webrtc-p2p.ts` (issue #915): reconnection
 * recovers a *transient* link to the same host, whereas host migration handles
 * the *permanent* loss of the host by transferring authority to another peer.
 *
 * Design goals:
 *  - Deterministic successor selection so every peer computes the same new
 *    host without a central coordinator (prevents split-brain).
 *  - Idempotent migration application (duplicate / reordered migration
 *    messages are no-ops).
 *  - Graceful termination when no peers remain to continue.
 *
 * Sequence-number continuity policy (issue #1091):
 *  GameMessages carry a monotonic per-sender `seq` (see
 *  `p2p-game-connection.ts`). Host migration is the one place where the
 *  "sender" of the authoritative stream changes, so the policy must be
 *  explicit:
 *
 *    1. When the successor is promoted, it adopts the authoritative
 *       high-water mark: it calls `P2PGameConnection.adoptOutgoingSeq(<last
 *       seq observed from the previous host>)` so its post-migration messages
 *       continue monotonically from where the previous host left off.
 *    2. The successor then broadcasts a FULL `game-state-sync` carrying
 *       `data.lastSeq = <that high-water mark>` as the reconciliation
 *       snapshot. Followers advance their per-`senderId` anti-replay tracker
 *       for the new host to that mark (see `handleGameStateSync`).
 *    3. Any queued action the successor re-emits afterwards has
 *       `seq > lastSeq` (because step 1 continued the counter), so followers
 *       accept exactly the actions that are not yet baked into the snapshot
 *       and reject any they already applied under the previous host.
 *
 *  Net effect: a follower that already applied an action before the migration
 *  does not apply it again, satisfying issue #1091's post-migration
 *  acceptance criterion. The `lastKnownGameState` cached here is the snapshot
 *  the successor ships in step 2.
 */

/**
 * A peer tracked for host-migration purposes.
 */
export interface PeerRosterEntry {
  playerId: string;
  playerName: string;
  /** Join order / arrival time. Lower = earlier. Used for tie-breaking. */
  joinedAt: number;
}

/**
 * Why a host migration is happening.
 */
export type HostMigrationReason = "host-disconnected" | "host-left";

/**
 * The lifecycle state of migration for the local client.
 */
export type HostMigrationStatus =
  | "stable"
  | "migrating"
  | "migrated"
  | "terminated";

/**
 * Wire message broadcast by the newly-promoted host (and relayed by peers) to
 * announce authority transfer. Rides over the existing game-action channel.
 */
export interface HostMigrationMessage {
  type: "host-migration";
  /** Idempotency key: identical messages are applied at most once. */
  migrationId: string;
  previousHostId: string;
  newHostId: string;
  /** Remaining peer ids in deterministic join order. */
  remainingPeers: string[];
  /**
   * Authoritative game-state snapshot the new host adopted, so lagging peers
   * can re-sync. Opaque to this module (typed `unknown`).
   */
  gameState: unknown;
  reason: HostMigrationReason;
  timestamp: number;
}

/**
 * Outcome of a migration, returned to the caller and surfaced via events.
 */
export interface HostMigrationResult {
  migrationId: string;
  previousHostId: string;
  newHostId: string;
  remainingPeers: string[];
  /** True when no peers are left to continue (clean terminal state). */
  terminated: boolean;
  /** True when the local client became the new host. */
  promotedSelf: boolean;
  reason: HostMigrationReason;
  migratedAt: number;
}

/**
 * Events emitted by {@link HostMigrationManager}.
 */
export interface HostMigrationEvents {
  /** The local client was promoted to host. */
  onPromotedToHost: (result: HostMigrationResult) => void;
  /** A remote peer became host (the local client is a follower). */
  onHostChanged: (result: HostMigrationResult) => void;
  /** The game cannot continue; surface a clean terminal state to the UI. */
  onTerminated: (reason: string) => void;
}

export interface HostMigrationManagerOptions {
  localPlayerId: string;
  initialPeers: PeerRosterEntry[];
  initialHostId: string;
  events?: Partial<HostMigrationEvents>;
  /**
   * Minimum number of remaining peers (including the new host) required to
   * keep playing. When fewer remain after the host leaves, the game terminates
   * cleanly. Defaults to 2 (a multiplayer game needs at least two players).
   */
  minPlayersToContinue?: number;
}

const DEFAULT_MIN_PLAYERS = 2;

/**
 * Deterministically pick the next host from a set of peers.
 *
 * Selection rule: the peer with the smallest `joinedAt`; ties broken by the
 * lexicographically smallest `playerId`. The leaving host is excluded. The
 * rule is total and order-independent, so every peer that runs it on the same
 * roster obtains the same answer.
 *
 * @returns the chosen successor's id, or `null` if there is no candidate.
 */
export function selectHostSuccessor(
  peers: PeerRosterEntry[],
  excludeId?: string,
): string | null {
  const candidates = peers
    .filter((p) => p.playerId !== excludeId)
    .slice()
    .sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    });
  return candidates.length > 0 ? candidates[0].playerId : null;
}

/**
 * Build a stable, deterministic migration id so all peers that compute the
 * same migration agree on the same key (extra dedup safety beyond the literal
 * message id).
 */
export function buildMigrationId(
  previousHostId: string,
  newHostId: string,
  remainingPeers: string[],
): string {
  return `mig-${previousHostId}-${newHostId}-${remainingPeers.join(",")}`;
}

/**
 * Manages host migration for a P2P multiplayer session.
 *
 * The manager is pure coordination logic: it does not touch WebRTC directly.
 * A host layer (e.g. the `useP2PConnection` hook) feeds it the peer roster and
 * the latest authoritative game state, asks it to migrate on host loss, and
 * applies received migration messages.
 */
export class HostMigrationManager {
  private readonly localPlayerId: string;
  private readonly minPlayersToContinue: number;
  private hostId: string;
  private peers: Map<string, PeerRosterEntry> = new Map();
  private events: HostMigrationEvents;
  private status: HostMigrationStatus = "stable";
  /** Migration ids already applied — dedupes duplicates / reordering. */
  private appliedMigrationIds: Set<string> = new Set();
  /** Latest authoritative game state known to this client. */
  private lastKnownGameState: unknown = null;

  constructor(options: HostMigrationManagerOptions) {
    this.localPlayerId = options.localPlayerId;
    this.hostId = options.initialHostId;
    this.minPlayersToContinue =
      options.minPlayersToContinue ?? DEFAULT_MIN_PLAYERS;
    this.events = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onPromotedToHost: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onHostChanged: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onTerminated: () => {},
      ...options.events,
    };
    for (const peer of options.initialPeers) {
      this.peers.set(peer.playerId, { ...peer });
    }
  }

  /** Current authoritative host id. */
  getHostId(): string {
    return this.hostId;
  }

  /** True when the local client is the current host. */
  isLocalHost(): boolean {
    return this.hostId === this.localPlayerId;
  }

  getStatus(): HostMigrationStatus {
    return this.status;
  }

  /** Snapshot of the tracked peers in deterministic join order. */
  getRoster(): PeerRosterEntry[] {
    return this.peersList();
  }

  /** Cache the latest authoritative game state (for adoption on promotion). */
  setLastKnownGameState(state: unknown): void {
    this.lastKnownGameState = state;
  }

  getLastKnownGameState(): unknown {
    return this.lastKnownGameState;
  }

  /** Add or refresh a peer in the roster. */
  upsertPeer(peer: PeerRosterEntry): void {
    this.peers.set(peer.playerId, { ...peer });
  }

  /** Remove a peer from the roster (e.g. on disconnect). */
  removePeer(playerId: string): void {
    this.peers.delete(playerId);
  }

  hasPeer(playerId: string): boolean {
    return this.peers.has(playerId);
  }

  /**
   * Determine who should become host after the given host leaves, using the
   * current roster. Exposed so callers can decide whether the local client is
   * the initiator without mutating state.
   */
  computeSuccessor(leavingHostId: string): string | null {
    return selectHostSuccessor(this.peersList(), leavingHostId);
  }

  /**
   * Initiate a migration because the current host is gone. Only the computed
   * successor should call this (it broadcasts the resulting message); other
   * peers wait to receive the migration message and call {@link applyMigration}.
   *
   * - If too few peers remain, emits `onTerminated` and returns a terminal
   *   result (no broadcast needed).
   * - If the local client is the successor, promotes it, adopts the last known
   *   game state, emits `onPromotedToHost`, and returns a result whose
   *   message should be broadcast.
   * - Otherwise returns a result describing the computed successor without
   *   mutating local authority (the caller should not broadcast).
   */
  initiateMigration(reason: HostMigrationReason): HostMigrationResult {
    const previousHostId = this.hostId;
    // Drop the leaving host from the roster so successor selection is correct.
    this.removePeer(previousHostId);

    const remaining = this.peersList();
    const remainingIds = remaining.map((p) => p.playerId);
    const now = Date.now();

    // Not enough players to keep the game alive → clean terminal state.
    if (remaining.length < this.minPlayersToContinue) {
      const result: HostMigrationResult = {
        migrationId: buildMigrationId(previousHostId, "", remainingIds),
        previousHostId,
        newHostId: "",
        remainingPeers: remainingIds,
        terminated: true,
        promotedSelf: false,
        reason,
        migratedAt: now,
      };
      this.status = "terminated";
      this.appliedMigrationIds.add(result.migrationId);
      this.events.onTerminated(
        reason === "host-left"
          ? "Host left the game and not enough players remain to continue."
          : "Host disconnected and not enough players remain to continue.",
      );
      return result;
    }

    const successor = selectHostSuccessor(remaining);
    // successor is guaranteed non-null because remaining.length >= minPlayers >= 1
    const newHostId = successor as string;
    const migrationId = buildMigrationId(
      previousHostId,
      newHostId,
      remainingIds,
    );
    const promotedSelf = newHostId === this.localPlayerId;

    const result: HostMigrationResult = {
      migrationId,
      previousHostId,
      newHostId,
      remainingPeers: remainingIds,
      terminated: false,
      promotedSelf,
      reason,
      migratedAt: now,
    };

    if (promotedSelf) {
      this.applyResult(result, true);
    }

    return result;
  }

  /**
   * Build the wire message for a migration result computed locally. The
   * initiator broadcasts this so followers can apply it.
   */
  buildMigrationMessage(result: HostMigrationResult): HostMigrationMessage {
    return {
      type: "host-migration",
      migrationId: result.migrationId,
      previousHostId: result.previousHostId,
      newHostId: result.newHostId,
      remainingPeers: result.remainingPeers,
      gameState: result.promotedSelf ? this.lastKnownGameState : null,
      timestamp: result.migratedAt,
      reason: result.reason,
    };
  }

  /**
   * Apply a received migration message. Idempotent: a message whose
   * `migrationId` was already applied is a no-op (returns null), which makes
   * the protocol robust to duplicates and reordering.
   *
   * @returns the applied result, or `null` if it was a duplicate/no-op.
   */
  applyMigration(message: HostMigrationMessage): HostMigrationResult | null {
    if (message.type !== "host-migration") return null;
    // Defensive validation: a P2P message handler must tolerate malformed input.
    if (
      typeof message.migrationId !== "string" ||
      typeof message.newHostId !== "string" ||
      !Array.isArray(message.remainingPeers)
    ) {
      return null;
    }
    if (this.appliedMigrationIds.has(message.migrationId)) {
      return null;
    }

    // Record the id first so the apply is idempotent even if a downstream
    // event handler re-enters applyMigration with the same message.
    this.appliedMigrationIds.add(message.migrationId);

    const previousHostId = this.hostId;
    const promotedSelf = message.newHostId === this.localPlayerId;

    // Ensure the leaving host is no longer tracked.
    if (
      message.previousHostId &&
      message.previousHostId !== message.newHostId
    ) {
      this.removePeer(message.previousHostId);
    }

    const result: HostMigrationResult = {
      migrationId: message.migrationId,
      previousHostId: message.previousHostId || previousHostId,
      newHostId: message.newHostId,
      remainingPeers: message.remainingPeers.slice(),
      terminated: false,
      promotedSelf,
      reason: message.reason,
      migratedAt: message.timestamp,
    };

    this.applyResult(result, promotedSelf);

    // If the new host shipped an authoritative state, adopt it as the baseline.
    if (message.gameState !== null && message.gameState !== undefined) {
      this.lastKnownGameState = message.gameState;
    }

    return result;
  }

  /**
   * Apply a locally-resolved result: update host authority, status and emit the
   * appropriate event.
   */
  private applyResult(
    result: HostMigrationResult,
    promotedSelf: boolean,
  ): void {
    this.hostId = result.newHostId;
    this.status = "migrated";
    this.appliedMigrationIds.add(result.migrationId);

    if (promotedSelf) {
      this.events.onPromotedToHost(result);
    } else {
      this.events.onHostChanged(result);
    }
  }

  private peersList(): PeerRosterEntry[] {
    return Array.from(this.peers.values()).sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    });
  }

  /** Reset all migration tracking (e.g. when starting a fresh session). */
  reset(): void {
    this.appliedMigrationIds.clear();
    this.status = "stable";
    this.lastKnownGameState = null;
  }
}

/**
 * Convenience factory.
 */
export function createHostMigrationManager(
  options: HostMigrationManagerOptions,
): HostMigrationManager {
  return new HostMigrationManager(options);
}
