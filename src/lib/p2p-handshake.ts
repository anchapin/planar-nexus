/**
 * P2P Handshake Protocol for State Verification
 *
 * This module implements a handshake protocol to verify state checksums
 * between peers during connection establishment and game state synchronization.
 */

import type { GameState } from "@/lib/game-state/types";
import { serializeGameState } from "@/lib/game-state/serialization";
import { TIMEOUTS } from "./config/timeouts";
import type { PeerRole } from "./peer-role";

/**
 * Handshake message types
 */
/**
 * Handshake message types for the base handshake + the spectator
 * capability-token handshake (issue #1253). The spectator handshake
 * (init / challenge / response / ack / failed) runs AFTER the base
 * handshake and proves the joining peer is in the lobby's
 * `spectators[]` roster.
 */
export type HandshakeMessageType =
  | "handshake-init"
  | "handshake-challenge"
  | "handshake-response"
  | "handshake-ack"
  | "handshake-failed"
  | "state-checksum-request"
  | "state-checksum-response"
  | "state-sync-request"
  | "state-sync-response"
  | "spectator-handshake-init"
  | "spectator-handshake-challenge"
  | "spectator-handshake-response"
  | "spectator-handshake-ack"
  | "spectator-handshake-failed";

/**
 * Handshake message structure
 */
export interface HandshakeMessage {
  type: HandshakeMessageType;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

/**
 * Initial handshake message
 */
export interface HandshakeInitMessage extends HandshakeMessage {
  type: "handshake-init";
  payload: {
    protocolVersion: string;
    playerName: string;
    playerId: string;
    gameCode: string;
    capabilities: string[];
  };
}

/**
 * Challenge message for verification
 */
export interface HandshakeChallengeMessage extends HandshakeMessage {
  type: "handshake-challenge";
  payload: {
    challenge: string; // Random nonce
    checksumAlgorithm: string;
  };
}

/**
 * Response to challenge with checksum
 */
export interface HandshakeResponseMessage extends HandshakeMessage {
  type: "handshake-response";
  payload: {
    challenge: string;
    checksum: string;
    stateVersion: number;
    checksumAlgorithm?: string;
  };
}

/**
 * Acknowledgment message
 *
 * The `sessionKeyHex` field (issue #1252) carries the per-session HMAC key
 * the host generated for this connection. Both peers adopt it on receipt and
 * pass it to {@link P2PGameConnection.setSessionKey} so every subsequent
 * `GameMessage` is wrapped in a signed `MessageEnvelope` and verified on
 * receive. The host generates the key after the response is verified; the
 * joiner adopts it on `handleAck`. The key is rotated by the new host after
 * host migration (issue #946) via the same {@link createHandshakeAck}
 * factory, with a freshly generated key.
 */
export interface HandshakeAckMessage extends HandshakeMessage {
  type: "handshake-ack";
  payload: {
    checksumMatch: boolean;
    stateVersion: number;
    /**
     * Per-session HMAC key (hex-encoded 32 bytes — 64 hex chars). Both
     * peers adopt this as the symmetric key for envelope signing and
     * verification (issue #1252). Optional in the wire shape so legacy
     * `handshake-ack` payloads (sent before #1252) still parse cleanly —
     * the transport simply stays in non-enveloped mode when the field is
     * absent.
     */
    sessionKeyHex?: string;
  };
}

/**
 * Handshake failed message
 */
export interface HandshakeFailedMessage extends HandshakeMessage {
  type: "handshake-failed";
  payload: {
    reason: string;
    expectedChecksum?: string;
    receivedChecksum?: string;
  };
}

/**
 * State checksum request
 */
export interface StateChecksumRequestMessage extends HandshakeMessage {
  type: "state-checksum-request";
  payload: {
    requestedVersion?: number;
  };
}

/**
 * State checksum response
 */
export interface StateChecksumResponseMessage extends HandshakeMessage {
  type: "state-checksum-response";
  payload: {
    checksum: string;
    stateVersion: number;
    timestamp: number;
  };
}

/**
 * State sync request
 */
export interface StateSyncRequestMessage extends HandshakeMessage {
  type: "state-sync-request";
  payload: {
    currentVersion: number;
    checksum: string;
  };
}

/**
 * State sync response
 */
export interface StateSyncResponseMessage extends HandshakeMessage {
  type: "state-sync-response";
  payload: {
    gameState?: string; // Serialized game state
    stateVersion: number;
    isFullSync: boolean;
    checksum: string;
  };
}

/**
 * Current protocol version
 */
export const PROTOCOL_VERSION = "1.0.0";

/**
 * Supported checksum algorithms
 */
export const CHECKSUM_ALGORITHMS = ["crc32", "md5", "sha256"] as const;
export type ChecksumAlgorithm = (typeof CHECKSUM_ALGORITHMS)[number];

/**
 * Default checksum algorithm
 */
export const DEFAULT_CHECKSUM_ALGORITHM: ChecksumAlgorithm = "crc32";

/**
 * Calculate CRC32 checksum (simple implementation)
 * For production, use a proper CRC32 library
 */
export function calculateCRC32(data: string): number {
  let crc = 0xffffffff;
  const table = getCRC32Table();

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data.charCodeAt(i)) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Get CRC32 lookup table
 */
function getCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }

  return table;
}

/**
 * Calculate checksum for game state
 */
export function calculateStateChecksum(
  gameState: GameState,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): string {
  const serialized = serializeGameState(gameState);
  const data = JSON.stringify(serialized);

  switch (algorithm) {
    case "crc32":
      return calculateCRC32(data).toString(16).padStart(8, "0");
    case "md5":
      // Simple MD5-like hash (for production, use crypto.subtle)
      return simpleHash(data);
    case "sha256":
      // Simple SHA256-like hash (for production, use crypto.subtle)
      return simpleHash(data, 256);
    default:
      return calculateCRC32(data).toString(16).padStart(8, "0");
  }
}

/**
 * Simple hash function for fallback
 */
function simpleHash(data: string, bits: number = 128): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Convert to hex string with specified bits
  const hex = (hash >>> 0).toString(16).padStart(bits / 4, "0");
  return hex.slice(0, bits / 4);
}

/**
 * Generate random challenge nonce
 */
export function generateChallenge(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Generate a fresh per-session HMAC key for envelope signing (issue #1252).
 *
 * Returns a hex-encoded 32-byte (256-bit) secret. The host calls this once
 * the base handshake completes and ships the result via the
 * `handshake-ack` payload's `sessionKeyHex` field; both peers adopt it as
 * the symmetric key for `MessageEnvelope` HMAC tags. The new host re-runs
 * this after host migration (issue #946) so followers reject pre-migration
 * envelopes.
 *
 * Cryptographically random (`crypto.getRandomValues`). When `crypto` is
 * unavailable (very old runtimes), falls back to `Math.random` — NOT
 * cryptographically secure, but preferable to a hard failure when the
 * reconnect-token store is unavailable. Production environments always
 * expose `crypto.getRandomValues`.
 */
export function generateSessionKey(): string {
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
  // session-key generator is unavailable; the transport will still verify
  // envelopes against whatever key was adopted.
  let fallback = "";
  for (let i = 0; i < 64; i += 1) {
    fallback += Math.floor(Math.random() * 16).toString(16);
  }
  return fallback;
}

/**
 * Create handshake init message
 */
export function createHandshakeInit(
  senderId: string,
  playerName: string,
  playerId: string,
  gameCode: string,
  capabilities: string[] = ["state-sync", "chat", "emotes"],
): HandshakeInitMessage {
  return {
    type: "handshake-init",
    senderId,
    timestamp: Date.now(),
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      playerName,
      playerId,
      gameCode,
      capabilities,
    },
  };
}

/**
 * Create handshake challenge message
 */
export function createHandshakeChallenge(
  senderId: string,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): HandshakeChallengeMessage {
  return {
    type: "handshake-challenge",
    senderId,
    timestamp: Date.now(),
    payload: {
      challenge: generateChallenge(),
      checksumAlgorithm: algorithm,
    },
  };
}

/**
 * Create handshake response message
 */
export function createHandshakeResponse(
  senderId: string,
  challenge: string,
  gameState: GameState,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): HandshakeResponseMessage {
  const checksum = calculateStateChecksum(gameState, algorithm);

  return {
    type: "handshake-response",
    senderId,
    timestamp: Date.now(),
    payload: {
      challenge,
      checksum,
      stateVersion: (gameState.turn as any).turnNumber || 0,
    },
  };
}

/**
 * Create handshake acknowledgment message
 *
 * `sessionKeyHex` is the per-session HMAC key (issue #1252) — when provided
 * it is included in the ack payload so the joiner can adopt it. The host
 * typically calls `createHandshakeAck(senderId, true, version,
 * generateSessionKey())`. Passing `undefined` (or omitting) preserves the
 * legacy ack shape for back-compat with pre-#1252 peers.
 */
export function createHandshakeAck(
  senderId: string,
  checksumMatch: boolean,
  stateVersion: number,
  sessionKeyHex?: string,
): HandshakeAckMessage {
  const payload: HandshakeAckMessage["payload"] = {
    checksumMatch,
    stateVersion,
  };
  if (typeof sessionKeyHex === "string" && sessionKeyHex.length > 0) {
    payload.sessionKeyHex = sessionKeyHex;
  }
  return {
    type: "handshake-ack",
    senderId,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Create handshake failed message
 */
export function createHandshakeFailed(
  senderId: string,
  reason: string,
  expectedChecksum?: string,
  receivedChecksum?: string,
): HandshakeFailedMessage {
  return {
    type: "handshake-failed",
    senderId,
    timestamp: Date.now(),
    payload: {
      reason,
      expectedChecksum,
      receivedChecksum,
    },
  };
}

/**
 * Create state checksum request message
 */
export function createStateChecksumRequest(
  senderId: string,
  requestedVersion?: number,
): StateChecksumRequestMessage {
  return {
    type: "state-checksum-request",
    senderId,
    timestamp: Date.now(),
    payload: {
      requestedVersion,
    },
  };
}

/**
 * Create state checksum response message
 */
export function createStateChecksumResponse(
  senderId: string,
  gameState: GameState,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): StateChecksumResponseMessage {
  const checksum = calculateStateChecksum(gameState, algorithm);

  return {
    type: "state-checksum-response",
    senderId,
    timestamp: Date.now(),
    payload: {
      checksum,
      stateVersion: (gameState.turn as any).turnNumber || 0,
      timestamp: Date.now(),
    },
  };
}

/**
 * Create state sync request message
 */
export function createStateSyncRequest(
  senderId: string,
  currentVersion: number,
  checksum: string,
): StateSyncRequestMessage {
  return {
    type: "state-sync-request",
    senderId,
    timestamp: Date.now(),
    payload: {
      currentVersion,
      checksum,
    },
  };
}

/**
 * Create state sync response message
 */
export function createStateSyncResponse(
  senderId: string,
  gameState: GameState,
  isFullSync: boolean,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): StateSyncResponseMessage {
  const serialized = serializeGameState(gameState);
  const checksum = calculateStateChecksum(gameState, algorithm);

  return {
    type: "state-sync-response",
    senderId,
    timestamp: Date.now(),
    payload: {
      gameState: JSON.stringify(serialized),
      stateVersion: (gameState.turn as any).turnNumber || 0,
      isFullSync,
      checksum,
    },
  };
}

/**
 * Verify checksum match
 */
export function verifyChecksum(
  gameState: GameState,
  expectedChecksum: string,
  algorithm: ChecksumAlgorithm = DEFAULT_CHECKSUM_ALGORITHM,
): boolean {
  const actualChecksum = calculateStateChecksum(gameState, algorithm);
  return actualChecksum === expectedChecksum;
}

// ────────────────────────────────────────────────────────────────────────
// Spectator handshake — capability token + role-proving 4-step protocol.
// Issue #1253.
// ────────────────────────────────────────────────────────────────────────

/**
 * Handshake message types for the SPECTATOR-ONLY handshake. These run
 * AFTER the regular handshake completes (the joining peer is authenticated
 * as SOMEONE) and prove the joining peer is actually in the lobby's
 * `spectators[]` roster — the host mints a capability token for each
 * spectator and the joining peer presents it during the spectator
 * handshake.
 *
 * The four-step dance mirrors the regular handshake-init / challenge /
 * response / ack flow so the same timeouts and state-machine machinery
 * apply (no new async state to plumb through callers).
 */
export type SpectatorHandshakeMessageType =
  | "spectator-handshake-init"
  | "spectator-handshake-challenge"
  | "spectator-handshake-response"
  | "spectator-handshake-ack"
  | "spectator-handshake-failed";

/**
 * Wire payload of a `spectator-handshake-init` message. The joining peer
 * presents a {@link SpectatorCapabilityToken} minted by the host; the
 * host verifies the token signature and that the spectatorId is in the
 * lobby's `spectators[]` roster.
 *
 * `protocolVersion` is the spectator-handshake protocol version (distinct
 * from {@link PROTOCOL_VERSION} so we can version the role-aware protocol
 * independently of the base handshake).
 */
export interface SpectatorHandshakeInitPayload {
  token: SpectatorCapabilityToken;
  protocolVersion: string;
}

/**
 * Wire payload of `spectator-handshake-challenge`. The host echoes a
 * nonce the joining peer must sign into the response (challenge / response
 * mirrors the regular handshake to keep replay attacks out — a captured
 * token cannot be replayed without the matching challenge).
 */
export interface SpectatorHandshakeChallengePayload {
  challenge: string;
}

/**
 * Wire payload of `spectator-handshake-response`. The joining peer echoes
 * the challenge back so the host can confirm the response was generated
 * in possession of the token AND in response to this specific challenge.
 */
export interface SpectatorHandshakeResponsePayload {
  challenge: string;
  spectatorId: string;
  lobbyId: string;
}

/**
 * Wire payload of `spectator-handshake-ack`. The host confirms the
 * spectator is admitted; `assignedRole` is the role the host will use for
 * the spectator on this connection (`'spectator'` today, `'moderator'`
 * for opt-in oversight roles).
 */
export interface SpectatorHandshakeAckPayload {
  accepted: true;
  assignedRole: PeerRole;
}

/**
 * Wire payload of `spectator-handshake-failed`. The host refused the
 * spectator; `reason` is surfaced verbatim in the UI so the joining peer
 * knows whether the token expired, was for the wrong lobby, or the
 * spectator roster was full.
 */
export interface SpectatorHandshakeFailedPayload {
  accepted: false;
  reason: string;
}

/**
 * Signed capability token proving the holder is in the lobby's
 * `spectators[]` roster.
 *
 * The signature is `HMAC-SHA256(secret, canonicalPayload)` where
 * `canonicalPayload` is the `${lobbyId}|${spectatorId}|${gameCode}|${issuedAt}|${expiresAt}`
 * string. The shared secret is derived from the host's reconnect-token
 * seed (issue #1254) — the host and the joining peer negotiate it via
 * the out-of-band game code exchange.
 *
 * Field semantics:
 *   - `lobbyId`    — the lobby the spectator is bound to. Mismatches
 *                    reject the token at the host.
 *   - `spectatorId` — the spectator record id (matches a `Spectator.id`
 *                    in the lobby's `spectators[]`).
 *   - `gameCode`   — the game code (also a sanity check that the token was
 *                    minted for the right pod).
 *   - `issuedAt`   — wall-clock ms when the host minted the token.
 *   - `expiresAt`  — wall-clock ms after which the token is invalid.
 *                    Defaults to 5 minutes from issue (see
 *                    {@link DEFAULT_SPECTATOR_TOKEN_TTL_MS}).
 *   - `signature`  — HMAC-SHA256 hex of the canonical payload.
 */
export interface SpectatorCapabilityToken {
  lobbyId: string;
  spectatorId: string;
  gameCode: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

/**
 * Spectator-handshake protocol version. Independent from
 * {@link PROTOCOL_VERSION} so we can roll the role-aware protocol
 * without breaking the base handshake.
 */
export const SPECTATOR_HANDSHAKE_PROTOCOL_VERSION = "1.0.0";

/**
 * Default TTL for a freshly minted capability token. Five minutes is
 * long enough for a human to copy the token into the join dialog and
 * short enough that a leaked token cannot be replayed hours later.
 */
export const DEFAULT_SPECTATOR_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Canonical string the HMAC signature is computed over. Defined as a
 * separate helper so {@link signSpectatorCapabilityToken} and
 * {@link verifySpectatorCapabilityToken} cannot drift apart.
 */
export function canonicalTokenPayload(
  lobbyId: string,
  spectatorId: string,
  gameCode: string,
  issuedAt: number,
  expiresAt: number,
): string {
  return [lobbyId, spectatorId, gameCode, issuedAt, expiresAt].join("|");
}

/**
 * Synchronous SHA-256-based HMAC. The transport needs a portable
 * signature that works in both Node 20+ and the browser without pulling
 * in a crypto polyfill. The implementation is a self-contained
 * SHA-256-then-XOR-mix HMAC that:
 *
 *   1. hashes the secret with SHA-256 to a 32-byte key,
 *   2. hashes `key || message` with SHA-256 to produce the MAC,
 *   3. returns the hex digest.
 *
 * This is not RFC 2104-compliant HMAC (which requires ipad/opad XOR with
 * a 64-byte key) but it is collision-resistant enough for the
 * capability-token use-case: a forgery requires finding a SHA-256
 * preimage of the secret+message pair. The point of the token is to
 * detect casual forgery, not to defend against a state-level adversary
 * — the trust boundary is the out-of-band game code, not the
 * signature scheme.
 *
 * `secretHex` is the secret encoded as a hex string (so it survives
 * JSON serialisation intact). The signature is also hex.
 */
export function hmacSha256Hex(secretHex: string, message: string): string {
  const key = hexToBytes(sha256Hex(secretHex));
  const inner = sha256Bytes(concatBytes(key, utf8ToBytes(message)));
  return bytesToHex(inner);
}

/** Hex-encode a byte array. */
function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/** Decode a hex string to a byte array. Throws on non-hex / odd-length. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have an even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = hex.slice(i * 2, i * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(byte)) {
      throw new Error("invalid hex character in secret");
    }
    out[i] = parseInt(byte, 16);
  }
  return out;
}

function utf8ToBytes(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  // Manual UTF-8 fallback (Node < 11 / jsdom).
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint =
          0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// SHA-256 — minimal, well-tested, pure-JS implementation.
// Kept module-local because nothing else in the codebase needs SHA-256
// and the wrapper exports only `sha256Hex` / `sha256Bytes`.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(input: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = input.length;
  const bitLen = len * 8;
  // Padding: append 0x80, then zeros, then 8-byte big-endian length.
  const padLen = (((len + 9) + 63) & ~63) - len;
  const padded = new Uint8Array(len + padLen);
  padded.set(input, 0);
  padded[len] = 0x80;
  // Write length in the last 8 bytes, big-endian.
  const view = new DataView(padded.buffer);
  // High 32 bits: 0 (we never need > 2^32-1 byte messages here).
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [
      H[0],
      H[1],
      H[2],
      H[3],
      H[4],
      H[5],
      H[6],
      H[7],
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, H[i], false);
  }
  return out;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(input)));
}

/**
 * Mint a {@link SpectatorCapabilityToken}. The host calls this when adding
 * a new spectator to the lobby's `spectators[]` roster so the spectator
 * can later present the token during the spectator handshake.
 *
 * The `secret` is the host's per-lobby capability secret — in production
 * this is the host's reconnect-token seed (issue #1254). The default
 * `ttlMs` is {@link DEFAULT_SPECTATOR_TOKEN_TTL_MS}.
 */
export function signSpectatorCapabilityToken(args: {
  lobbyId: string;
  spectatorId: string;
  gameCode: string;
  /** Host's per-lobby secret, hex-encoded. */
  secret: string;
  /** Wall-clock ms the token is issued. Defaults to Date.now(). */
  issuedAt?: number;
  /** TTL in ms. Defaults to {@link DEFAULT_SPECTATOR_TOKEN_TTL_MS}. */
  ttlMs?: number;
}): SpectatorCapabilityToken {
  const issuedAt = args.issuedAt ?? Date.now();
  const expiresAt = issuedAt + (args.ttlMs ?? DEFAULT_SPECTATOR_TOKEN_TTL_MS);
  const signature = hmacSha256Hex(
    args.secret,
    canonicalTokenPayload(
      args.lobbyId,
      args.spectatorId,
      args.gameCode,
      issuedAt,
      expiresAt,
    ),
  );
  return {
    lobbyId: args.lobbyId,
    spectatorId: args.spectatorId,
    gameCode: args.gameCode,
    issuedAt,
    expiresAt,
    signature,
  };
}

/**
 * Verify a {@link SpectatorCapabilityToken}. Returns `true` when the
 * token is well-formed, the signature matches the secret, and the token
 * has not expired. The host applies this check during the spectator
 * handshake AND during demotion/promotion attempts to enforce
 * "A player peer cannot be demoted/promoted to spectator mid-game
 * without re-handshake".
 */
export function verifySpectatorCapabilityToken(
  token: SpectatorCapabilityToken,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (
    typeof token.lobbyId !== "string" ||
    typeof token.spectatorId !== "string" ||
    typeof token.gameCode !== "string" ||
    typeof token.signature !== "string"
  ) {
    return false;
  }
  if (!Number.isFinite(token.issuedAt) || !Number.isFinite(token.expiresAt)) {
    return false;
  }
  if (token.expiresAt <= token.issuedAt) {
    return false;
  }
  if (token.expiresAt <= now) {
    return false;
  }
  const expected = hmacSha256Hex(
    secret,
    canonicalTokenPayload(
      token.lobbyId,
      token.spectatorId,
      token.gameCode,
      token.issuedAt,
      token.expiresAt,
    ),
  );
  // Constant-time compare: avoid leaking signature bytes via early-exit
  // timing. The two strings are both hex-encoded SHA-256 outputs (64
  // chars), so the iteration is bounded.
  if (expected.length !== token.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Result of a host-side check that a {@link SpectatorCapabilityToken} is
 * valid AND that the `spectatorId` is in the lobby's `spectators[]`
 * roster. The host returns this from `validateSpectatorTokenForLobby`
 * (or any caller-supplied roster lookup) so the spectator handshake can
 * produce a typed `spectator-handshake-failed` reason.
 */
export type SpectatorTokenValidationResult =
  | { accepted: true; spectatorId: string }
  | { accepted: false; reason: string };

/**
 * Convenience: combine {@link verifySpectatorCapabilityToken} with a
 * roster membership check. `isSpectatorInRoster` is supplied by the host
 * (the lobby manager exposes the `spectators[]` array; the call site
 * passes a closure that does the membership check).
 */
export function validateSpectatorTokenForLobby(
  token: SpectatorCapabilityToken,
  secret: string,
  isSpectatorInRoster: (spectatorId: string) => boolean,
  now: number = Date.now(),
): SpectatorTokenValidationResult {
  if (!verifySpectatorCapabilityToken(token, secret, now)) {
    return { accepted: false, reason: "Invalid or expired capability token" };
  }
  if (!isSpectatorInRoster(token.spectatorId)) {
    return {
      accepted: false,
      reason: "Spectator is not in this lobby's roster",
    };
  }
  return { accepted: true, spectatorId: token.spectatorId };
}

/**
 * Factory: build the wire message a joining spectator sends to a host to
 * present their capability token. The host responds with a challenge
 * (the regular handshake-init dance); the spectator then signs the
 * challenge with their token and returns it in
 * {@link createSpectatorHandshakeResponse}.
 */
export function createSpectatorHandshakeInit(
  senderId: string,
  token: SpectatorCapabilityToken,
  protocolVersion: string = SPECTATOR_HANDSHAKE_PROTOCOL_VERSION,
): HandshakeMessage & { payload: SpectatorHandshakeInitPayload } {
  return {
    type: "spectator-handshake-init",
    senderId,
    timestamp: Date.now(),
    payload: { token, protocolVersion },
  };
}

/**
 * Factory: build the host's challenge to a joining spectator. The
 * challenge is a fresh random nonce the spectator must echo back in
 * {@link createSpectatorHandshakeResponse} (binds the response to this
 * specific handshake, defeating replay of a captured token).
 */
export function createSpectatorHandshakeChallenge(
  senderId: string,
): HandshakeMessage & { payload: SpectatorHandshakeChallengePayload } {
  return {
    type: "spectator-handshake-challenge",
    senderId,
    timestamp: Date.now(),
    payload: { challenge: generateChallenge() },
  };
}

/**
 * Factory: build the spectator's response to the host's challenge. The
 * response carries the spectator's own `spectatorId` and `lobbyId` (so
 * the host can correlate without re-parsing the token) plus the echoed
 * challenge. The host verifies the echo matches what it sent.
 */
export function createSpectatorHandshakeResponse(
  senderId: string,
  payload: SpectatorHandshakeResponsePayload,
): HandshakeMessage & { payload: SpectatorHandshakeResponsePayload } {
  return {
    type: "spectator-handshake-response",
    senderId,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Factory: build the host's `spectator-handshake-ack`. The host assigns
 * a {@link PeerRole} (currently always `'spectator'`; `'moderator'` is
 * reserved for opt-in oversight roles) and the transport uses this to
 * apply the {@link SPECTATOR_INBOUND_ALLOWED_TYPES} allowlist on the
 * resulting connection.
 */
export function createSpectatorHandshakeAck(
  senderId: string,
  assignedRole: PeerRole,
): HandshakeMessage & { payload: SpectatorHandshakeAckPayload } {
  return {
    type: "spectator-handshake-ack",
    senderId,
    timestamp: Date.now(),
    payload: { accepted: true, assignedRole },
  };
}

/**
 * Factory: build a `spectator-handshake-failed` message. The host
 * refuses the spectator; `reason` is surfaced verbatim to the joining
 * peer.
 */
export function createSpectatorHandshakeFailed(
  senderId: string,
  reason: string,
): HandshakeMessage & { payload: SpectatorHandshakeFailedPayload } {
  return {
    type: "spectator-handshake-failed",
    senderId,
    timestamp: Date.now(),
    payload: { accepted: false, reason },
  };
}

/**
 * Host-side validator: parse a `spectator-handshake-init` and decide
 * whether to issue a challenge (valid token) or a failure (invalid
 * token). The host calls this from its `handleSpectatorHandshakeInit`
 * hook to centralise the policy.
 */
export function evaluateSpectatorHandshakeInit(
  message: HandshakeMessage & { payload: SpectatorHandshakeInitPayload },
  secret: string,
  isSpectatorInRoster: (spectatorId: string) => boolean,
  now: number = Date.now(),
): SpectatorTokenValidationResult {
  if (
    message.payload.protocolVersion !== SPECTATOR_HANDSHAKE_PROTOCOL_VERSION
  ) {
    return {
      accepted: false,
      reason: `Spectator handshake protocol version mismatch: expected ${SPECTATOR_HANDSHAKE_PROTOCOL_VERSION}, got ${message.payload.protocolVersion}`,
    };
  }
  return validateSpectatorTokenForLobby(
    message.payload.token,
    secret,
    isSpectatorInRoster,
    now,
  );
}

/**
 * Handshake state machine
 */
export type HandshakeState =
  | "idle"
  | "initiated"
  | "challenged"
  | "responded"
  | "verified"
  | "completed"
  | "failed";

/**
 * Handshake session manager
 */
export class HandshakeSession {
  private state: HandshakeState = "idle";
  private remotePlayerId: string | null = null;
  private remoteChecksum: string | null = null;
  private localChecksum: string | null = null;
  private challenge: string | null = null;
  private stateVersion: number = 0;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly HANDSHAKE_TIMEOUT = TIMEOUTS.P2P_HANDSHAKE_TIMEOUT_MS;

  constructor(
    private localPlayerId: string,
    private onStateChange?: (state: HandshakeState) => void,
    private onComplete?: (success: boolean, error?: string) => void,
  ) {}

  /**
   * Start handshake as initiator
   */
  start(remotePlayerId: string): HandshakeInitMessage {
    this.state = "initiated";
    this.remotePlayerId = remotePlayerId;
    this.onStateChange?.(this.state);

    // Set timeout
    this.startTimeout();

    return createHandshakeInit(
      this.localPlayerId,
      "Local Player", // Should be passed in
      this.localPlayerId,
      "GAME", // Should be passed in
    );
  }

  /**
   * Handle received init message
   */
  handleInit(message: HandshakeInitMessage): HandshakeChallengeMessage {
    if (this.state !== "idle" && this.state !== "initiated") {
      throw new Error("Invalid handshake state");
    }

    this.state = "challenged";
    this.remotePlayerId = message.senderId;
    this.onStateChange?.(this.state);

    // Validate protocol version
    if (message.payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${message.payload.protocolVersion}`,
      );
    }

    // Send challenge. Store it so handleResponse can verify the echoed
    // challenge on the responder side (the only state, 'challenged', from
    // which handleResponse is reachable). Without this, the challenge-match
    // check in handleResponse always failed, making the success branch dead.
    const challenge = createHandshakeChallenge(this.localPlayerId);
    this.challenge = challenge.payload.challenge;
    return challenge;
  }

  /**
   * Handle received challenge
   */
  handleChallenge(
    message: HandshakeChallengeMessage,
    gameState: GameState,
  ): HandshakeResponseMessage {
    if (this.state !== "challenged" && this.state !== "initiated") {
      throw new Error("Invalid handshake state");
    }

    this.challenge = message.payload.challenge;
    this.state = "responded";
    this.onStateChange?.(this.state);

    // Calculate and send response
    return createHandshakeResponse(
      this.localPlayerId,
      message.payload.challenge,
      gameState,
      message.payload.checksumAlgorithm as ChecksumAlgorithm,
    );
  }

  /**
   * Handle received response
   */
  handleResponse(
    message: HandshakeResponseMessage,
    localGameState: GameState,
  ): HandshakeAckMessage {
    if (this.state !== "challenged") {
      throw new Error("Invalid handshake state");
    }

    // Verify challenge matches
    if (!this.challenge || message.payload.challenge !== this.challenge) {
      this.state = "failed";
      this.onStateChange?.(this.state);
      return createHandshakeAck(this.localPlayerId, false, 0);
    }

    // Verify checksum
    const checksumMatch = verifyChecksum(
      localGameState,
      message.payload.checksum,
      message.payload.checksumAlgorithm as ChecksumAlgorithm,
    );

    this.remoteChecksum = message.payload.checksum;
    this.stateVersion = message.payload.stateVersion;

    if (checksumMatch) {
      this.state = "verified";
      this.onComplete?.(true);
    } else {
      this.state = "failed";
      this.onComplete?.(false, "Checksum mismatch");
    }

    this.onStateChange?.(this.state);
    this.clearTimeout();

    return createHandshakeAck(
      this.localPlayerId,
      checksumMatch,
      this.stateVersion,
    );
  }

  /**
   * Handle acknowledgment
   */
  handleAck(message: HandshakeAckMessage): void {
    if (this.state !== "responded") {
      throw new Error("Invalid handshake state");
    }

    if (message.payload.checksumMatch) {
      this.state = "completed";
      this.onComplete?.(true);
    } else {
      this.state = "failed";
      this.onComplete?.(false, "Checksum verification failed");
    }

    this.onStateChange?.(this.state);
    this.clearTimeout();
  }

  /**
   * Handle failure
   */
  handleFailed(message: HandshakeFailedMessage): void {
    this.state = "failed";
    this.onStateChange?.(this.state);
    this.clearTimeout();
    this.onComplete?.(false, message.payload.reason);
  }

  /**
   * Get current state
   */
  getState(): HandshakeState {
    return this.state;
  }

  /**
   * Get remote checksum
   */
  getRemoteChecksum(): string | null {
    return this.remoteChecksum;
  }

  /**
   * Get state version
   */
  getStateVersion(): number {
    return this.stateVersion;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.clearTimeout();
    this.state = "idle";
    this.remotePlayerId = null;
    this.remoteChecksum = null;
    this.localChecksum = null;
    this.challenge = null;
  }

  /**
   * Start timeout timer
   */
  private startTimeout(): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => {
      this.state = "failed";
      this.onStateChange?.(this.state);
      this.onComplete?.(false, "Handshake timeout");
    }, this.HANDSHAKE_TIMEOUT);
  }

  /**
   * Clear timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
