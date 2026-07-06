/**
 * Per-peer role model for the mesh transport.
 *
 * Issue #1253: "[Multiplayer] Wire spectator slots into the mesh transport
 * with a read-only GameMessage stream".
 *
 * Background
 * ----------
 * `src/lib/spectator.ts` models spectators at the lobby-metadata level, and
 * #75 shipped the original spectator mode. But the transport layer was
 * never role-aware: a joiner with `PlayerSlotType === 'spectator'` still
 * flowed through the same `P2PGameConnection` / `MeshGameConnection` as a
 * player, so an 8-player Commander pod with 3 spectators had no read-only
 * channel and spectators effectively could not join.
 *
 * This module formalises the per-peer role so the transport can filter the
 * `GameMessage` stream per-peer:
 *
 *   - `player`     — full read/write on every message type (legacy default).
 *   - `spectator`  — read-only; receives state-sync, chat, emotes, joins,
 *                    leaves, errors, and lobby pauses — but NEVER a
 *                    `game-action`. A spectator peer that somehow receives
 *                    a `game-action` drops it before the message touches
 *                    game state. Spectators cannot originate a `game-action`
 *                    (the transport rejects the send).
 *   - `moderator`  — receives everything a player does, plus the
 *                    host-only `lobby-control` channel; cannot originate a
 *                    `game-action` (the moderator is a read-only oversight
 *                    role, e.g. a tournament judge). Moderator is opt-in:
 *                    callers that do not need a non-playing role can simply
 *                    stick to `'player' | 'spectator'`.
 *
 * The role is assigned at handshake time (see
 * `p2p-handshake.ts → SpectatorHandshake`) and is the SINGLE source of
 * truth for the allowlist — neither caller code nor per-message handlers
 * should branch on `senderId` to decide whether to apply a message.
 *
 * Acceptance criteria from #1253 that this module implements:
 *
 *   - "Spectator peers in a 4-player Commander pod receive state-sync +
 *     chat + emotes but never receive `PlayerActionMessage`s" — encoded
 *     by {@link SPECTATOR_INBOUND_ALLOWED_TYPES}.
 *   - "A player peer cannot be demoted/promoted to spectator mid-game
 *     without re-handshake" — encoded by {@link ROLE_REHANDSHAKE_REASONS}.
 *   - "Spectator count appears in the lobby UI and on P2PDiagnosticsPanel"
 *     — see `multiplayer/page.tsx` and `p2p-diagnostics-panel.tsx`.
 */

import type { GameMessageType } from "./p2p-game-connection";

/** Per-peer role in a mesh pod. See module header for semantics. */
export type PeerRole = "player" | "spectator" | "moderator";

/** Default role when none is supplied. Matches the legacy pre-#1253 default. */
export const DEFAULT_PEER_ROLE: PeerRole = "player";

/**
 * Reason an inbound `game-action` from a non-player peer was dropped. Surfaced
 * via `onError` so the diagnostic surface can attribute drops to a role
 * mismatch rather than a malformed payload.
 */
export const REJECT_SENT_AS_SPECTATOR =
  "Spectator peers may not originate game actions" as const;
export const REJECT_SENT_AS_MODERATOR =
  "Moderator peers may not originate game actions" as const;

/**
 * Reasons a `PeerRole` change requires a full re-handshake rather than a
 * hot-swap. Both promotions (`player` → `moderator`) and demotions
 * (`player` → `spectator`) re-key the trust boundary, so a live role flip
 * without a fresh handshake is rejected.
 *
 *   - `'role-flip-mid-game'` — peer tried to change role without going
 *     through the SpectatorHandshake dance again.
 *   - `'spectator-sent-game-action'` — a peer in the spectator allowlist
 *     somehow originated a `game-action`; we treat this as a handshake
 *     violation (the role is mislabelled or stale) and require a re-handshake
 *     to recover.
 */
export const ROLE_REHANDSHAKE_REASONS = [
  "role-flip-mid-game",
  "spectator-sent-game-action",
] as const;
export type RoleRehandshakeReason = (typeof ROLE_REHANDSHAKE_REASONS)[number];

/**
 * Game-message types a spectator is allowed to RECEIVE.
 *
 * Spec from #1253: "Spectator peers in a 4-player Commander pod receive
 * state-sync + chat + emotes but never receive PlayerActionMessages".
 * Encoded here as the inverse — the set of types a spectator is allowed to
 * receive — so the transport applies one membership check per inbound
 * message rather than branching on type.
 *
 * The list mirrors the read-only stream a spectator would experience in a
 * live Commander pod:
 *
 *   - `game-state-sync`       — the authoritative state snapshot.
 *   - `request-state-sync`    — a peer's request to the host; harmless to
 *                               a spectator and useful for diagnostics.
 *   - `chat`                  — open-table chat.
 *   - `player-joined` /
 *     `player-left`           — roster events.
 *   - `ping` / `pong`         — liveness probes.
 *   - `error`                 — typed rejection channel (issue #1089);
 *                               spectators see them as read-only feedback
 *                               but cannot act on them.
 *   - `lobby-control`         — host moderation events (kick, ban, pause,
 *                               resume) so spectators see "Game paused…"
 *                               banners in real time.
 *
 * Critically absent: `game-action`. A `game-action` arriving on a
 * spectator-only channel is dropped silently (the trust boundary — issue
 * #1089 — must never let a player's action reach spectator game state).
 */
export const SPECTATOR_INBOUND_ALLOWED_TYPES: ReadonlySet<GameMessageType> =
  new Set<GameMessageType>([
    "game-state-sync",
    "request-state-sync",
    "chat",
    "player-joined",
    "player-left",
    "ping",
    "pong",
    "error",
    "lobby-control",
  ]);

/**
 * Game-message types a moderator is allowed to RECEIVE — a superset of
 * {@link SPECTATOR_INBOUND_ALLOWED_TYPES}. Moderators additionally see the
 * `game-action` channel so a judge can audit the full action log, but
 * {@link isRoleAllowedToSend} gates the moderator's OWN outgoing actions to
 * the read-only types below.
 */
export const MODERATOR_INBOUND_ALLOWED_TYPES: ReadonlySet<GameMessageType> =
  new Set<GameMessageType>([
    ...SPECTATOR_INBOUND_ALLOWED_TYPES,
    "game-action",
  ]);

/**
 * Game-message types a non-player (spectator / moderator) is allowed to
 * SEND. Both roles are read-only — they can chat, react to rosters, and
 * request state, but they cannot author game actions.
 *
 * If a caller asks the transport to send a disallowed type, the transport
 * returns false and surfaces {@link REJECT_SENT_AS_SPECTATOR} /
 * {@link REJECT_SENT_AS_MODERATOR} on the error channel so the UI can
 * surface a "Spectators cannot play — watch only" hint.
 */
export const READ_ONLY_OUTBOUND_ALLOWED_TYPES: ReadonlySet<GameMessageType> =
  new Set<GameMessageType>([
    "chat",
    "ping",
    "request-state-sync",
  ]);

/**
 * True when `type` is in {@link SPECTATOR_INBOUND_ALLOWED_TYPES} — i.e. a
 * spectator peer is allowed to receive it. Centralised so the mesh and
 * 1:1 transports apply the SAME check; if the allowlist ever changes,
 * there is one place to update.
 *
 * The check runs AFTER the existing trust pipeline (rate limit, parse,
 * shape, anti-replay) so a disallowed type is dropped at the very last
 * step, just before the message would be emitted to consumers.
 */
export function isMessageAllowedForRole(
  role: PeerRole,
  type: GameMessageType,
): boolean {
  if (role === "player") return true;
  if (role === "spectator") {
    return SPECTATOR_INBOUND_ALLOWED_TYPES.has(type);
  }
  // moderator — read access to every type
  return MODERATOR_INBOUND_ALLOWED_TYPES.has(type);
}

/**
 * True when a peer in `role` is allowed to ORIGINATE `type`. Players can
 * author every type (legacy default). Spectators and moderators are
 * read-only — they can only emit the read-only allowlist above.
 *
 * Note: `game-action` is NEVER allowed for spectators or moderators, even
 * if the calling code happens to be a spectator. The transport applies
 * this gate at the outbound entrypoint so a `sendGameAction` from a
 * spectator returns `{ success: false }` without ever touching the wire.
 */
export function isRoleAllowedToSend(
  role: PeerRole,
  type: GameMessageType,
): boolean {
  if (role === "player") return true;
  return READ_ONLY_OUTBOUND_ALLOWED_TYPES.has(type);
}

/**
 * Human-readable reason an outbound send was rejected because the local
 * peer's role disallows it. Used by the transport's `onError` event and
 * surfaced in `P2PDiagnosticsPanel`. Returns `null` when the role is
 * allowed to send `type` (no rejection).
 */
export function rejectionReasonForSend(
  role: PeerRole,
  type: GameMessageType,
): string | null {
  if (isRoleAllowedToSend(role, type)) return null;
  if (role === "spectator") return REJECT_SENT_AS_SPECTATOR;
  if (role === "moderator") return REJECT_SENT_AS_MODERATOR;
  return null;
}

/**
 * Validate a proposed `role` change. Per acceptance criteria, a player peer
 * cannot be demoted/promoted to spectator mid-game without re-handshake —
 * any live `setPeerRole` call that crosses the player/non-player boundary
 * is rejected here so callers go through
 * `SpectatorHandshake → setPeerRole`.
 *
 * Same-role updates (e.g. `'player' → 'player'`) are always a no-op
 * (returns `true`) so caller code can call this defensively without
 * first checking equality.
 */
export function isRoleTransitionAllowed(
  currentRole: PeerRole,
  nextRole: PeerRole,
): boolean {
  if (currentRole === nextRole) return true;
  // Cross-boundary transitions (player ⇄ non-player) require re-handshake.
  const currentIsPlayer = currentRole === "player";
  const nextIsPlayer = nextRole === "player";
  return currentIsPlayer === nextIsPlayer;
}
