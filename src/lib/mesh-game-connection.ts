/**
 * Mesh Game Connection — game-message-level full-mesh routing for 3+ players.
 *
 * Issue #1087: "[Multiplayer] Support 3+ player mesh topology in the P2P
 * connection layer".
 *
 * ----------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ----------------------------------------------------------------------------
 * The transport layer already had multi-peer plumbing (the
 * `WebRTCConnectionPool` / `MeshTopologyManager` added under issue #1021), but
 * it operates on the low-level `P2PMessage` type which carries none of the
 * game-layer guarantees. Meanwhile the game-message layer that DOES carry
 * those guarantees — `P2PGameConnection` with its monotonic `seq`
 * anti-replay (#1091), host-side rules-engine validation (#1089), rate
 * limiting (#1111) and structural message limits — held a single
 * `peerConnection` + `dataChannel` + `remotePlayerId`: strictly 1 host ↔ 1
 * peer. So Commander / 2HG pods (>2 players) were unreachable even though the
 * lobby, host-migration and anti-replay code were all written for N peers.
 *
 * `MeshGameConnection` closes that gap. It is a **game-message-level** mesh:
 * it maintains N peer links and routes `GameMessage`s across them (broadcast +
 * targeted), while reusing — not duplicating — the existing trust pipeline:
 *
 *   - shape validation via the shared {@link isGameMessage} guard,
 *   - structural/size limits via {@link safeParseJson},
 *   - per-sender anti-replay via {@link AntiReplayTracker} (the same
 *     high-water-mark policy as `P2PGameConnection`, now a shared primitive),
 *   - per-link rate limiting via {@link P2PRateLimiter} (one independent
 *     counter per peer, matching #1111's intent),
 *   - authoritative-host action validation via {@link PeerActionValidator}
 *     (the #1089 gate), applied on the host regardless of which peer sent the
 *     action.
 *
 * ----------------------------------------------------------------------------
 * TOPOLOGY DECISION: FULL MESH (each peer ↔ each peer)
 * ----------------------------------------------------------------------------
 * The local node holds one {@link PeerLink} per remote peer and `broadcast`
 * fans a message out to every open link. This is deliberately a *superset* of
 * both the legacy 1:1 link (the N=2 degenerate case) and a host-centered star:
 * the host still owns game-state authority through the validation gate, but it
 * ALSO holds direct links to every peer so a host drop can be detected and
 * rewired by the existing `HostMigrationManager` (#946) without re-discovery.
 * Full mesh was chosen because (a) the issue title specifies mesh, (b) being a
 * superset it cannot regress the shipped 1:1 path or the star-authority model,
 * and (c) host-migration's `remainingPeers` roster already assumes every peer
 * knows every other peer.
 *
 * ----------------------------------------------------------------------------
 * COMPOSITION BOUNDARY (what this module deliberately does NOT do)
 * ----------------------------------------------------------------------------
 * `MeshGameConnection` is **transport-agnostic**: it owns `PeerLink` send
 * handles, never `RTCPeerConnection`s. ICE gathering, NAT traversal, the
 * #943 per-link ICE-restart reconnection, and the actual data-channel
 * handshake all continue to live in `WebRTCConnection` / the connection pool.
 * A production caller wires each peer's open data channel into a `PeerLink`;
 * the mesh then handles routing, anti-replay, rate limiting and host
 * validation uniformly across all of them. This keeps the trust pipeline in
 * exactly one place and avoids regressing the shipped transport. Wiring the
 * mesh into the live signaling runtime / UI (currently 1:1 via
 * `useP2PConnection`) and exercising host-migration + per-link reconnection
 * end-to-end at N>2 is tracked as follow-up work — see the PR description.
 */
import {
  isGameMessage,
  type GameMessage,
  type GameMessageType,
  type PeerActionValidator,
  type PeerActionValidationResult,
  type PeerGameActionPayload,
} from "./p2p-game-connection";
import { safeParseJson } from "./p2p-json-validation";
import { P2PRateLimiter, type P2PRateLimitOptions } from "./p2p-rate-limiter";
import { redactSensitive } from "./p2p-log-redact";
import { AntiReplayTracker } from "./anti-replay-tracker";
import {
  type PeerRole,
  DEFAULT_PEER_ROLE,
  isMessageAllowedForRole,
  isRoleAllowedToSend,
  rejectionReasonForSend,
} from "./peer-role";

/**
 * A handle the mesh uses to push bytes to one remote peer and query its
 * liveness. In production this is backed by an open `RTCDataChannel` (or a
 * pooled `WebRTCConnection`); in tests it is a mock. Abstracting it here is
 * what lets the mesh compose with the existing transport instead of owning
 * `RTCPeerConnection`s itself.
 */
export interface PeerLink {
  /** Stable identity of the remote peer this link reaches. */
  peerId: string;
  /**
   * Per-link role for the remote peer. Issue #1253. Defaults to
   * {@link DEFAULT_PEER_ROLE} when omitted so legacy callers that do not
   * know about the role concept keep working. The mesh uses this to filter
   * outbound (per-peer allowlist) and inbound (`game-action` is dropped on
   * a spectator-only link) traffic.
   */
  role?: PeerRole;
  /** Serialize + push a raw message string to the remote peer. */
  send(raw: string): boolean;
  /** Whether the underlying transport is currently usable. */
  isOpen(): boolean;
  /** Close the underlying transport (idempotent). */
  close(): void;
}

/**
 * Events emitted by {@link MeshGameConnection}. Each inbound event is tagged
 * with the `fromPeerId` that delivered it so callers can attribute state.
 */
export interface MeshGameConnectionEvents {
  /** A well-formed, non-replay, host-validated message was accepted. */
  onMessage: (message: GameMessage, fromPeerId: string) => void;
  /** A `game-action` cleared the host validation gate (host-side convenience). */
  onGameAction: (action: string, data: unknown, senderId: string) => void;
  /** A `chat` message was accepted. */
  onChat: (senderId: string, senderName: string, text: string) => void;
  /** A new peer link was registered (peer joined / connected). */
  onPeerJoined: (peerId: string) => void;
  /** A peer link was removed (peer left / disconnected). */
  onPeerLeft: (peerId: string) => void;
  /** Recoverable trust-pipeline rejection (malformed/replay/illegal/rate). */
  onError: (error: Error, fromPeerId: string) => void;
}

/** A message payload the caller wants to put on the wire (seq/timestamp stamped by the mesh). */
export interface OutgoingGamePayload {
  type: GameMessageType;
  data: unknown;
}

/** Options for constructing a {@link MeshGameConnection}. */
export interface MeshGameConnectionOptions {
  /** Stable identity of the local player. */
  localPlayerId: string;
  /** Display name of the local player (used for chat emission). */
  localPlayerName: string;
  /**
   * Identity of the authoritative host (game-state authority). Non-host peers
   * route their `game-action`s here via {@link MeshGameConnection.sendGameActionToHost}.
   * Updated on host migration via {@link MeshGameConnection.setHostId}.
   */
  hostId: string;
  /** Whether the local client is the authoritative host. */
  isHost: boolean;
  /**
   * Local peer's role (issue #1253). Defaults to {@link DEFAULT_PEER_ROLE}
   * (`'player'`) so legacy callers that do not know about the role concept
   * keep working. When the local peer is a `'spectator'` the outbound
   * `sendGameAction` / `broadcastGameAction` paths refuse to emit a
   * `game-action`; when it is a `'moderator'` the same gate applies (a
   * moderator is a read-only oversight role).
   */
  localRole?: PeerRole;
  /** Lifecycle events. `onMessage` defaults to a no-op. */
  events?: Partial<MeshGameConnectionEvents>;
  /**
   * Authoritative-host action validation gate (issue #1089). When true (host
   * only), incoming `game-action`s are validated by {@link validatePeerAction}
   * against the host's authoritative state before being emitted.
   */
  validatePeerActions?: boolean;
  /** Rules-engine legality check for peer game-actions (host-only, #1089). */
  validatePeerAction?: PeerActionValidator;
  /** Per-link rate limit for inbound messages (one counter per peer, #1111). */
  rateLimit?: Partial<P2PRateLimitOptions>;
}

/** Default reason stamped on a host rejection when the validator omits one. */
const DEFAULT_REJECTION_REASON = "Action rejected by host";

/**
 * Multi-peer game-message mesh.
 *
 * See the module header for the full topology / composition rationale. This
 * class is intentionally free of any `RTCPeerConnection` reference: it routes
 * already-serialized `GameMessage`s across registered {@link PeerLink}s and
 * runs the shared trust pipeline on everything that arrives.
 */
export class MeshGameConnection {
  private readonly localPlayerId: string;
  private readonly localPlayerName: string;
  private hostId: string;
  private isHostFlag: boolean;
  /**
   * Local peer's role (issue #1253). When the local peer is a spectator or
   * moderator, `broadcastGameAction` / `sendGameActionToHost` refuse to emit
   * a `game-action` (read-only role). Defaults to `'player'`.
   */
  private localRoleFlag: PeerRole;

  /** Registered peer links keyed by peer id (the mesh). */
  private readonly links: Map<string, PeerLink> = new Map();
  /** Per-peer role overrides (issue #1253). Falls back to the link's
   * declared role, then to {@link DEFAULT_PEER_ROLE}. */
  private readonly peerRoles: Map<string, PeerRole> = new Map();
  /** One independent rate limiter per peer link (issue #1111, per-connection). */
  private readonly rateLimiters: Map<string, P2PRateLimiter> = new Map();
  private readonly rateLimitOptions: Partial<P2PRateLimitOptions>;

  /**
   * Monotonic outgoing sequence counter shared across all sends. The local
   * node is a single sender, so every receiver tracks one monotonic stream for
   * `senderId = localPlayerId` — one counter keeps it gap-free everywhere.
   * Issue #1091.
   */
  private outgoingSeq = 0;

  /** Per-sender inbound anti-replay high-water marks. Issue #1091. */
  private readonly antiReplay: AntiReplayTracker = new AntiReplayTracker();

  /**
   * Counter of how many `game-action` messages were dropped on inbound
   * because the local role disallows them. Surfaced via
   * {@link MeshGameConnection.getSpectatorDrops} for the diagnostics panel
   * so an unexpectedly-high drop count surfaces a misconfigured spectator.
   */
  private spectatorDrops = 0;

  private readonly validatePeerActions: boolean;
  private readonly validatePeerAction: PeerActionValidator | null;
  private readonly events: MeshGameConnectionEvents;

  constructor(options: MeshGameConnectionOptions) {
    if (!options.localPlayerId) {
      throw new Error("MeshGameConnectionOptions.localPlayerId is required");
    }
    if (!options.hostId) {
      throw new Error("MeshGameConnectionOptions.hostId is required");
    }
    this.localPlayerId = options.localPlayerId;
    this.localPlayerName = options.localPlayerName;
    this.hostId = options.hostId;
    this.isHostFlag = options.isHost;
    this.localRoleFlag = options.localRole ?? DEFAULT_PEER_ROLE;
    this.rateLimitOptions = options.rateLimit ?? {};
    this.validatePeerActions = options.validatePeerActions === true;
    this.validatePeerAction = options.validatePeerAction ?? null;
 
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const noop = (): void => {};
    const defaults: MeshGameConnectionEvents = {
      onMessage: noop,
      onGameAction: noop,
      onChat: noop,
      onPeerJoined: noop,
      onPeerLeft: noop,
      onError: noop,
    };
    this.events = options.events
      ? { ...defaults, ...options.events }
      : defaults;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Topology / peer membership
  // ────────────────────────────────────────────────────────────────────────

  /** Whether the local client currently holds the authoritative-host role. */
  isHost(): boolean {
    return this.isHostFlag;
  }

  /** Current authoritative host id (updated on migration). */
  getHostId(): string {
    return this.hostId;
  }

  /**
   * Update the authoritative host. Used by the host-migration layer (#946) to
   * rewire routing after a host drop. Toggles the local host flag when the
   * local client is the new host.
   */
  setHostId(newHostId: string): void {
    if (!newHostId) return;
    this.hostId = newHostId;
    this.isHostFlag = newHostId === this.localPlayerId;
  }

  /**
   * Register a transport link to a peer (idempotent). Re-registering for an
   * existing peer id closes the previous link first so a transport never leaks.
   * The local player can never be added as a peer. Returns true when a NEW
   * peer was added (false on replace/self).
   *
   * The link MAY carry an optional `role` (issue #1253); if it does, the
   * role is recorded in the per-peer role map and used to filter outbound
   * and inbound traffic. If the link has no `role`, the peer defaults to
   * {@link DEFAULT_PEER_ROLE} (`'player'`) — backward-compatible with
   * legacy callers that do not know about the role concept.
   */
  addPeerLink(link: PeerLink): boolean {
    if (!link.peerId || link.peerId === this.localPlayerId) {
      return false;
    }
    const isReplace = this.links.has(link.peerId);
    if (isReplace) {
      this.links.get(link.peerId)!.close();
    }
    this.links.set(link.peerId, link);
    // A fresh limiter on (re)connect so a prior flood window doesn't persist.
    this.rateLimiters.set(
      link.peerId,
      new P2PRateLimiter(this.rateLimitOptions),
    );
    // Record the link's declared role. `setPeerRole` can override this
    // post-registration (e.g. once the spectator handshake completes).
    this.peerRoles.set(
      link.peerId,
      link.role ?? DEFAULT_PEER_ROLE,
    );
    if (!isReplace) {
      this.events.onPeerJoined(link.peerId);
    }
    return !isReplace;
  }

  /**
   * Remove a peer link (disconnect / leave). Closes the underlying transport,
   * drops its rate limiter, and emits {@link MeshGameConnectionEvents.onPeerLeft}.
   * The per-sender anti-replay state is intentionally RETAINED so a
   * reconnecting peer that re-delivers stale messages is still rejected; use
   * {@link resetIncomingSeq} for an explicit clean slate. No-op if unknown.
   */
  removePeerLink(peerId: string): boolean {
    const link = this.links.get(peerId);
    if (!link) return false;
    link.close();
    this.links.delete(peerId);
    this.rateLimiters.delete(peerId);
    this.peerRoles.delete(peerId);
    this.events.onPeerLeft(peerId);
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Per-peer roles (issue #1253)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Local peer's role. The local role is the OUTBOUND gate — a spectator or
   * moderator cannot originate a `game-action`. Returns
   * {@link DEFAULT_PEER_ROLE} when the mesh was constructed without
   * `localRole`.
   */
  getLocalRole(): PeerRole {
    return this.localRoleFlag;
  }

  /**
   * Update the local peer's role. Used after the spectator handshake
   * completes (the host `ack`s the new role and the local client adopts
   * it). Cross-boundary transitions (player ⇄ non-player) are allowed
   * here because the caller has already completed the role-aware
   * handshake — the mesh trusts the host's `spectator-handshake-ack`
   * to set the new role.
   */
  setLocalRole(role: PeerRole): void {
    this.localRoleFlag = role;
  }

  /**
   * Per-peer role lookup. Returns the role the link was registered with
   * (or {@link DEFAULT_PEER_ROLE} if the link had no role) when the peer
   * is registered; `null` when the peer is unknown. Used by the
   * diagnostics panel to render a per-peer role column.
   */
  getPeerRole(peerId: string): PeerRole | null {
    if (!this.links.has(peerId)) return null;
    return this.peerRoles.get(peerId) ?? DEFAULT_PEER_ROLE;
  }

  /**
   * Update a peer's role post-registration. Used when the host-side
   * spectator handshake completes and the mesh learns the peer is in
   * fact a spectator (the link may have been registered before the
   * handshake completed). Returns true when the role was applied.
   */
  setPeerRole(peerId: string, role: PeerRole): boolean {
    if (!this.links.has(peerId)) return false;
    this.peerRoles.set(peerId, role);
    return true;
  }

  /**
   * Count of registered spectator peers (issue #1253 — diagnostic surface
   * for `P2PDiagnosticsPanel`). A spectator peer is one whose current
   * role (per {@link getPeerRole}) is `'spectator'`. The count is
   * recomputed on every call so a `setPeerRole` is reflected without
   * manual book-keeping.
   */
  getSpectatorCount(): number {
    let count = 0;
    for (const role of this.peerRoles.values()) {
      if (role === "spectator") count += 1;
    }
    return count;
  }

  /**
   * Number of inbound `game-action` messages that were dropped because
   * the local role disallows them (issue #1253). Surfaced in the
   * diagnostics panel so a misconfigured spectator can be diagnosed
   * (a non-zero count means a player is trying to push actions at a
   * spectator, which is a misconfiguration, not a transport bug).
   */
  getSpectatorDrops(): number {
    return this.spectatorDrops;
  }

  /** Whether a link to `peerId` is currently registered. */
  hasPeer(peerId: string): boolean {
    return this.links.has(peerId);
  }

  /** Peer ids with a registered link (excluding the local player). */
  getPeerIds(): string[] {
    return Array.from(this.links.keys());
  }

  /** Number of registered peer links. */
  getPeerCount(): number {
    return this.links.size;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Outbound routing
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Allocate the next outgoing sequence number. Centralised so every send
   * path shares one monotonic counter (issue #1091).
   */
  private nextOutgoingSeq(): number {
    return this.outgoingSeq++;
  }

  /** Build a fully-stamped, serialized `GameMessage` ready for the wire. */
  private serializeOutgoing(payload: OutgoingGamePayload): string {
    const message: GameMessage = {
      type: payload.type,
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      seq: this.nextOutgoingSeq(),
      data: payload.data,
    };
    return JSON.stringify(message);
  }

  /**
   * Broadcast a message to every OPEN peer link. Returns the number of peers
   * the message was delivered to (closed links are skipped, not counted).
   *
   * The per-peer role allowlist is applied per link: a `game-action`
   * sent to a 4-peer pod with 1 spectator reaches only the 3 player
   * peers (issue #1253). The returned count reflects the actual
   * delivery, not the mesh size, so a caller's "reached N peers" log
   * surfaces the filtered count.
   */
  broadcast(payload: OutgoingGamePayload): number {
    if (this.links.size === 0) return 0;
    // Local role gate: a spectator/moderator cannot originate ANY message
    // that is not in the read-only allowlist. We refuse at the entry point
    // so the caller's `sendGameAction` is a clean no-op (no wire bytes,
    // no seq stamped).
    if (!isRoleAllowedToSend(this.localRoleFlag, payload.type)) {
      const reason = rejectionReasonForSend(
        this.localRoleFlag,
        payload.type,
      );
      this.events.onError(
        new Error(reason ?? "Local role does not allow this send"),
        this.localPlayerId,
      );
      return 0;
    }
    const raw = this.serializeOutgoing(payload);
    let sent = 0;
    for (const link of this.links.values()) {
      if (this.sendRawOnLink(link, raw, payload.type)) sent++;
    }
    return sent;
  }

  /**
   * Send a message to a single targeted peer. Returns true if delivered to an
   * open link, false if the peer is unknown or its link is closed, or the
   * local role disallows the send.
   */
  sendToPeer(peerId: string, payload: OutgoingGamePayload): boolean {
    const link = this.links.get(peerId);
    if (!link) return false;
    if (!isRoleAllowedToSend(this.localRoleFlag, payload.type)) {
      const reason = rejectionReasonForSend(
        this.localRoleFlag,
        payload.type,
      );
      this.events.onError(
        new Error(reason ?? "Local role does not allow this send"),
        this.localPlayerId,
      );
      return false;
    }
    return this.sendRawOnLink(link, this.serializeOutgoing(payload), payload.type);
  }

  /**
   * Push a pre-serialized string onto a link, swallowing transport errors.
   * `type` is the source message type; when provided, the per-peer role
   * allowlist is applied (a `game-action` is NOT delivered to a spectator
   * peer even if the local node is a player — the spectator's allowlist
   * filters it out at the wire). Returns true when the bytes were
   * delivered, false on transport failure OR a role-allowlist filter.
   */
  private sendRawOnLink(
    link: PeerLink,
    raw: string,
    type?: GameMessageType,
  ): boolean {
    if (!link.isOpen()) return false;
    if (type && !isMessageAllowedForRole(link.role ?? DEFAULT_PEER_ROLE, type)) {
      // Per-peer inbound allowlist rejected this message type for the
      // link's role. Silent drop — the spectator never sees the wire
      // bytes, so a host pushing `game-action` to a 4-peer pod with
      // spectators reaches only the player peers.
      return false;
    }
    try {
      return link.send(raw);
    } catch (error) {
      // #982: redact — transport errors may reference the payload/SDP.
      console.error(
        "[MeshGameConnection] Failed to send to peer:",
        redactSensitive(error),
      );
      return false;
    }
  }

  /** Broadcast a `game-action` to all peers (host distributing authoritative state). */
  broadcastGameAction(action: string, data: unknown): number {
    return this.broadcast({ type: "game-action", data: { action, data } });
  }

  /** Broadcast a `chat` message to all peers. */
  broadcastChat(text: string): number {
    return this.broadcast({
      type: "chat",
      data: { senderName: this.localPlayerName, text },
    });
  }

  /**
   * Route a `game-action` to the authoritative HOST for validation+application
   * (non-host path in the authoritative-host model). If the local client IS
   * the host this is a no-op return (the host applies its own actions locally).
   * Returns true if the action was sent to an open host link.
   *
   * Spectator / moderator (read-only) callers receive `false` and an
   * `onError` event (issue #1253) — a `sendGameActionToHost` from a
   * read-only peer is a programming error and the transport refuses
   * rather than silently swallow the action.
   */
  sendGameActionToHost(action: string, data: unknown): boolean {
    if (this.isHostFlag) return false;
    return this.sendToPeer(this.hostId, {
      type: "game-action",
      data: { action, data },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Inbound trust pipeline (compose with shared primitives)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get (creating if necessary) the per-link rate limiter for `peerId`. A
   * limiter is created lazily so an inbound message that arrives just before
   * its link is registered is still protected rather than dropped.
   */
  private ensureLimiter(peerId: string): P2PRateLimiter {
    let limiter = this.rateLimiters.get(peerId);
    if (!limiter) {
      limiter = new P2PRateLimiter(this.rateLimitOptions);
      this.rateLimiters.set(peerId, limiter);
    }
    return limiter;
  }

  /**
   * Handle a raw inbound message that arrived over `fromPeerId`'s link.
   *
   * Enforces, in order, the SAME pipeline as `P2PGameConnection.handleMessage`
   * so the trust boundary is identical at N=2 and N>2:
   *   1. Per-link rate limit — a flooding peer is dropped before any parsing
   *      (issue #1111). Each peer has its own counter so one flooder cannot
   *      starve the others.
   *   2. Safe parse + structural limits (size/depth/key-count) via
   *      {@link safeParseJson}.
   *   3. Shape validation via the shared {@link isGameMessage} guard
   *      (including the required `seq`, #1091).
   *   4. Anti-replay: a message with `seq <=` the highest seq already applied
   *      from this `senderId` is dropped BEFORE it can touch game state (#1091).
   *   5. Per-peer role allowlist (issue #1253): if the LOCAL role is
   *      `'spectator'` (or `'moderator'`), a `game-action` arriving on the
   *      wire is dropped BEFORE it can touch the dispatch surface. This is
   *      the read-only-stream contract: a `PlayerActionMessage` never
   *      reaches a spectator's game state.
   *   6. Host-side rules-engine legality (#1089): on the authoritative host, a
   *      `game-action` is validated against the host's own state; illegal
   *      actions are rejected (peer notified via a typed `error` message
   *      targeted back over the sender's link) BEFORE being emitted.
   *
   * Malformed, oversize, rate-limited, replayed, role-blocked or illegal
   * messages are rejected gracefully without breaking the mesh or any
   * other peer's link.
   */
  handleIncoming(raw: string, fromPeerId: string): void {
    try {
      // 1. Per-link rate limit first — never do parse/validation work for a
      //    flooding peer.
      if (!this.ensureLimiter(fromPeerId).tryAcquire()) {
        console.warn(
          "[MeshGameConnection] Rate limit exceeded; dropping peer message",
          redactSensitive({ fromPeerId }),
        );
        return;
      }

      // 2 + 3. Safe parse + structural limits + shape validation.
      const message = safeParseJson<GameMessage>(raw, isGameMessage);
      if (!message) {
        console.error(
          "[MeshGameConnection] Rejected malformed peer message",
          redactSensitive({ fromPeerId }),
        );
        return;
      }

      // 4. Anti-replay (per senderId, scales to N senders). Issue #1091.
      if (this.antiReplay.isReplay(message.senderId, message.seq)) {
        console.warn(
          "[MeshGameConnection] Dropping duplicate/replay message",
          redactSensitive({ senderId: message.senderId, seq: message.seq }),
        );
        return;
      }
      this.antiReplay.markApplied(message.senderId, message.seq);

      // 5. Per-peer role allowlist (issue #1253). The local role is the
      //    SINGLE source of truth for what the local node is willing to
      //    receive. A `game-action` arriving on a spectator-only link is
      //    dropped silently and counted via `getSpectatorDrops` so the
      //    diagnostic surface can flag a misconfigured pod. Note we run
      //    this AFTER anti-replay so a replayed `game-action` is still
      //    counted once (the anti-replay check rejects it first).
      if (!isMessageAllowedForRole(this.localRoleFlag, message.type)) {
        this.spectatorDrops += 1;
        console.warn(
          "[MeshGameConnection] Dropped message disallowed for local role",
          redactSensitive({
            fromPeerId,
            type: message.type,
            localRole: this.localRoleFlag,
          }),
        );
        return;
      }

      // 6. Host-side rules-engine legality for game-actions. Issue #1089.
      //    Auto-gated to the authoritative host: a non-host forwards actions
      //    untouched (the host is the only one with authoritative state), and
      //    a peer promoted by host migration (#946) begins validating
      //    automatically once isHostFlag flips on.
      if (
        message.type === "game-action" &&
        this.validatePeerActions &&
        this.isHostFlag
      ) {
        const result = this.validatePeerGameAction(message);
        if (!result.isValid) {
          this.sendActionRejection(message, fromPeerId, result.reason);
          return;
        }
      }

      this.dispatch(message, fromPeerId);
    } catch (error) {
      // Defensive: a handler bug must not tear down the mesh.
      console.error(
        "[MeshGameConnection] Failed to handle message:",
        redactSensitive(error),
      );
      this.events.onError(
        error instanceof Error
          ? error
          : new Error("Failed to handle mesh message"),
        fromPeerId,
      );
    }
  }

  /**
   * Fan an accepted message out to the typed event surface. Mirrors the
   * `P2PGameConnection` per-type dispatch so downstream consumers are
   * identical whether they sit on the 1:1 or the mesh connection.
   */
  private dispatch(message: GameMessage, fromPeerId: string): void {
    this.events.onMessage(message, fromPeerId);
    switch (message.type) {
      case "game-action": {
        const payload = message.data as { action?: unknown; data?: unknown };
        if (typeof payload.action === "string") {
          this.events.onGameAction(
            payload.action,
            payload.data,
            message.senderId,
          );
        }
        break;
      }
      case "chat": {
        const payload = message.data as {
          senderName?: unknown;
          text?: unknown;
        };
        if (typeof payload.text === "string") {
          this.events.onChat(
            message.senderId,
            typeof payload.senderName === "string" ? payload.senderName : "",
            payload.text,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Validate a peer-originated `game-action` against the rules engine using the
   * host's authoritative state (via {@link validatePeerAction}). Fail-closed:
   * anything that cannot be confirmed legal is treated as illegal so it can
   * never be applied to host state. Issue #1089.
   */
  private validatePeerGameAction(
    message: GameMessage,
  ): PeerActionValidationResult {
    const payload = message.data;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { action?: unknown }).action !== "string"
    ) {
      return { isValid: false, reason: "Malformed game action" };
    }
    if (!this.validatePeerAction) {
      // Gate enabled without a validator — fail-closed.
      return { isValid: false, reason: "No action validator configured" };
    }
    const peerAction = payload as PeerGameActionPayload;
    try {
      const result = this.validatePeerAction(peerAction, message.senderId);
      if (
        result &&
        typeof result === "object" &&
        typeof result.isValid === "boolean"
      ) {
        return result;
      }
      return { isValid: false, reason: "Invalid validator result" };
    } catch (error) {
      return {
        isValid: false,
        reason:
          error instanceof Error ? error.message : "Action validation error",
      };
    }
  }

  /**
   * Notify the originating peer that its `game-action` was rejected by the
   * authoritative host. Targets the sender's link specifically (in a full mesh
   * the sender is a direct neighbor). Reuses the exact `error` message shape
   * from `P2PGameConnection.sendActionRejection` so peers interpret rejections
   * identically across 1:1 and mesh connections. Issue #1089.
   */
  private sendActionRejection(
    message: GameMessage,
    fromPeerId: string,
    reason: string | undefined,
  ): void {
    const payload = message.data as { action?: unknown };
    const rejection: GameMessage = {
      type: "error",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      seq: this.nextOutgoingSeq(),
      data: {
        code: "action_rejected",
        action:
          typeof payload?.action === "string" ? payload.action : undefined,
        reason: reason ?? DEFAULT_REJECTION_REASON,
        // Echo the rejected message's seq so the peer can correlate.
        rejectedSeq: message.seq,
      },
    };
    // Prefer the message's declared sender; fall back to the delivering link.
    const targetId = this.links.has(message.senderId)
      ? message.senderId
      : fromPeerId;
    const link = this.links.get(targetId);
    if (!link) {
      // Originating peer already gone (left mid-rejection) — nothing to send.
      return;
    }
    this.sendRawOnLink(link, JSON.stringify(rejection));
  }

  // ────────────────────────────────────────────────────────────────────────
  // Anti-replay / migration helpers (issue #1091, #946)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Highest seq applied from `senderId`, or `null` if none observed. Exposed
   * for diagnostics, host-migration handoff, and tests. Issue #1091.
   */
  getLastAppliedSeq(senderId: string): number | null {
    return this.antiReplay.getLastApplied(senderId);
  }

  /**
   * Advance the per-sender anti-replay high-water mark (e.g. from a full
   * `game-state-sync` reconciliation snapshot carrying `lastSeq`). Issue #1091.
   */
  advanceIncomingSeq(senderId: string, seq: number): void {
    this.antiReplay.advanceTo(senderId, seq);
  }

  /** Reset the anti-replay high-water mark for a sender. Issue #1091. */
  resetIncomingSeq(senderId: string): void {
    this.antiReplay.resetSender(senderId);
  }

  /**
   * The highest outgoing seq stamped so far. A newly-promoted host ships this
   * as `lastSeq` in the post-migration reconciliation snapshot (#946/#1091).
   */
  getOutgoingSeq(): number {
    return this.outgoingSeq;
  }

  /**
   * Advance the outgoing seq counter to at least `seq` (no-op if already past
   * it). A newly-promoted host calls this after host migration so its
   * post-migration messages continue monotonically from the previous host's
   * high-water mark. Issue #1091.
   */
  adoptOutgoingSeq(seq: number): void {
    if (Number.isFinite(seq) && seq >= 0 && seq > this.outgoingSeq) {
      this.outgoingSeq = seq;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Teardown
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Tear down the mesh: close every peer link, drop all rate limiters, and
   * clear anti-replay state so a fresh session is not poisoned by stale
   * high-water marks. Idempotent.
   */
  close(): void {
    for (const link of this.links.values()) {
      try {
        link.close();
      } catch (error) {
        console.error(
          "[MeshGameConnection] Error closing peer link:",
          redactSensitive(error),
        );
      }
    }
    this.links.clear();
    this.rateLimiters.clear();
    this.peerRoles.clear();
    this.antiReplay.clear();
    this.spectatorDrops = 0;
  }
}

/**
 * Convenience factory mirroring `createP2PGameConnection`.
 */
export function createMeshGameConnection(
  options: MeshGameConnectionOptions,
): MeshGameConnection {
  return new MeshGameConnection(options);
}
