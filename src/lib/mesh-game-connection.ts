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

  /** Registered peer links keyed by peer id (the mesh). */
  private readonly links: Map<string, PeerLink> = new Map();
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
    this.events.onPeerLeft(peerId);
    return true;
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
   */
  broadcast(payload: OutgoingGamePayload): number {
    if (this.links.size === 0) return 0;
    const raw = this.serializeOutgoing(payload);
    let sent = 0;
    for (const link of this.links.values()) {
      if (this.sendRawOnLink(link, raw)) sent++;
    }
    return sent;
  }

  /**
   * Send a message to a single targeted peer. Returns true if delivered to an
   * open link, false if the peer is unknown or its link is closed.
   */
  sendToPeer(peerId: string, payload: OutgoingGamePayload): boolean {
    const link = this.links.get(peerId);
    if (!link) return false;
    return this.sendRawOnLink(link, this.serializeOutgoing(payload));
  }

  /** Push a pre-serialized string onto a link, swallowing transport errors. */
  private sendRawOnLink(link: PeerLink, raw: string): boolean {
    if (!link.isOpen()) return false;
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
   *   5. Host-side rules-engine legality (#1089): on the authoritative host, a
   *      `game-action` is validated against the host's own state; illegal
   *      actions are rejected (peer notified via a typed `error` message
   *      targeted back over the sender's link) BEFORE being emitted.
   *
   * Malformed, oversize, rate-limited, replayed or illegal messages are
   * rejected gracefully without breaking the mesh or any other peer's link.
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

      // 5. Host-side rules-engine legality for game-actions. Issue #1089.
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
    this.antiReplay.clear();
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
