/**
 * Regression tests for issue #1391: the HMAC session key MUST be rotated
 * when the local peer is promoted to host, so post-migration envelopes are
 * signed under fresh material and the previous host's key is invalidated.
 *
 * The `onPromotedToHost` callback in `use-p2p-connection.ts` delegates to
 * the exported `rotateSessionKeyOnPromotion` helper. We test the helper
 * directly (rather than mounting the full React hook, which wires WebRTC +
 * signaling) because the helper is the security-critical unit: it generates
 * a fresh key, pushes it onto the transport, and invalidates the old key.
 *
 * The deeper "old key is rejected on the verify path" guarantee is already
 * covered by the transport-level rotation tests in
 * `p2p-game-connection.test.ts` ("post-migration key rotation", issue #1252
 * acceptance criterion #2). These tests assert the production wiring in the
 * hook actually invokes that transport API.
 */
import { rotateSessionKeyOnPromotion } from "../use-p2p-connection";
import {
  createP2PGameConnection,
  type P2PGameConnection,
  type P2PGameConnectionEvents,
} from "@/lib/p2p-game-connection";

/**
 * Minimal real `P2PGameConnection` constructed via the public factory so the
 * `setSessionKey` / `getSessionKey` API exercised here is the same one the
 * production `onPromotedToHost` callback calls. We avoid importing the live
 * signalling path by never connecting the transport — only the key plumbing
 * is exercised.
 */
const makeConnection = (sessionKeyHex?: string): P2PGameConnection => {
  const events: P2PGameConnectionEvents = {
    onConnectionStateChange: () => {},
    onSignalingStateChange: () => {},
    onMessage: () => {},
    onGameStateSync: () => {},
    onChat: () => {},
    onError: () => {},
    onPlayerJoined: () => {},
    onPlayerLeft: () => {},
  };
  return createP2PGameConnection({
    playerId: "local",
    playerName: "Local",
    role: "host",
    sessionKeyHex,
    events,
  });
};

describe("rotateSessionKeyOnPromotion (issue #1391)", () => {
  it("rotates the key so the connection holds a new key after promotion", () => {
    const oldKey = "a".repeat(64);
    const conn = makeConnection(oldKey);
    expect(conn.getSessionKey()).toBe(oldKey);

    const newKey = rotateSessionKeyOnPromotion(conn);

    expect(newKey).not.toBeNull();
    expect(conn.getSessionKey()).toBe(newKey);
  });

  it("invalidates the previous key — the new key differs from the old", () => {
    const oldKey = "a".repeat(64);
    const conn = makeConnection(oldKey);

    const newKey = rotateSessionKeyOnPromotion(conn);

    expect(newKey).not.toBe(oldKey);
    expect(conn.getSessionKey()).not.toBe(oldKey);
  });

  it("generates a cryptographically-shaped 32-byte (64 hex char) key", () => {
    const conn = makeConnection();
    const newKey = rotateSessionKeyOnPromotion(conn);
    expect(newKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rotates even when the connection had no prior key (first promotion)", () => {
    const conn = makeConnection();
    expect(conn.getSessionKey()).toBeNull();

    const newKey = rotateSessionKeyOnPromotion(conn);

    expect(newKey).not.toBeNull();
    expect(conn.getSessionKey()).toBe(newKey);
  });

  it("is a safe no-op (returns null) when no connection is active", () => {
    expect(() => rotateSessionKeyOnPromotion(null)).not.toThrow();
    expect(rotateSessionKeyOnPromotion(null)).toBeNull();
  });

  it("produces a different key on each successive promotion", () => {
    const conn = makeConnection();
    const first = rotateSessionKeyOnPromotion(conn);
    const second = rotateSessionKeyOnPromotion(conn);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(conn.getSessionKey()).toBe(second);
  });
});
