/**
 * Issue #1708 — P2P session-key distribution forgery + downgrade tests.
 *
 * The pre-#1708 design shipped ONE host-generated HMAC key to every peer
 * (mesh-shared `sessionKeyHex` + cleartext distribution inside
 * `handshake-ack`), so any peer could forge a `MessageEnvelope` bearing an
 * arbitrary `senderId` — the exact swapped-sender attack the envelope was
 * built to stop. It also had two downgrade paths: `Math.random` keys when
 * `crypto` was missing, and legacy `handshake-ack`s silently disabling
 * verification.
 *
 * These tests pin the hardened properties:
 *   AC1. Per-peer-pair keys, never disclosed to third parties — outbound
 *        wire bytes on one link cannot verify on another link.
 *   AC2. Envelope mode fails closed — non-enveloped inbound traffic on a
 *        keyed link is rejected; inbound traffic can never mutate key state.
 *   AC3. `generateSessionKey` fails HARD without `crypto.getRandomValues`.
 *   AC4. A peer holding the (old mesh-shared / their own pairwise) key
 *        cannot produce an accepted envelope bearing another senderId;
 *        a legacy handshake-ack cannot disable verification.
 */

// The handshake state machine depends on serializeGameState(gameState) to
// compute/verify checksums — stub it (same mock as p2p-handshake.test.ts)
// so the tests can drive checksum-match paths without a full engine state.
jest.mock("@/lib/game-state/serialization", () => ({
  serializeGameState: (state: {
    turn?: { turnNumber?: number };
    __id?: string;
  }) => ({
    turnNumber: state?.turn?.turnNumber ?? 0,
    id: state?.__id ?? "default-state",
  }),
}));

import {
  createHandshakeAck,
  createHandshakeInit,
  createHandshakeResponse,
  generateSessionKey,
  isValidSessionKeyHex,
  requireSessionKeyFromAck,
  HandshakeSession,
  type HandshakeAckMessage,
} from "../p2p-handshake";
import {
  MeshGameConnection,
  derivePerSenderKey,
  type PeerLink,
} from "../mesh-game-connection";
import { signMessageEnvelope } from "../p2p-json-validation";
import type { GameMessage } from "../p2p-game-connection";
import type { GameState } from "../game-state/types";

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Deterministic valid pair keys (64 lowercase hex chars each). */
const KEY_A = "11".repeat(32);
const KEY_M = "22".repeat(32);

const makeGameState = (turnNumber: number): GameState =>
  ({
    turn: { turnNumber },
    __id: `state-${turnNumber}`,
  }) as unknown as GameState;

/** Wire envelope helper: sign `msg` as `senderId` would on a link keyed `pairKey`. */
const envelopeFor = (msg: GameMessage, pairKey: string): string =>
  JSON.stringify(
    signMessageEnvelope(msg, derivePerSenderKey(pairKey, msg.senderId)),
  );

const gameMsg = (senderId: string, seq: number): GameMessage => ({
  type: "game-action",
  senderId,
  timestamp: Date.now(),
  seq,
  data: { action: "pass_priority", data: {} },
});

/** Transport-link stand-in (mirrors mesh-game-connection.test.ts). */
class MockLink implements PeerLink {
  peerId: string;
  open: boolean;
  closed = false;
  sent: string[] = [];

  constructor(peerId: string, open = true) {
    this.peerId = peerId;
    this.open = open;
  }

  send(raw: string): boolean {
    if (!this.open) return false;
    this.sent.push(raw);
    return true;
  }

  isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.closed = true;
    this.open = false;
  }
}

/** Victim mesh with two keyed links: "alice" (KEY_A) and "mallory" (KEY_M). */
function newVictimMesh() {
  const onMessage = jest.fn();
  const mesh = new MeshGameConnection({
    localPlayerId: "victim",
    localPlayerName: "Victim",
    hostId: "victim",
    isHost: true,
    heartbeat: { intervalMs: 0 },
    events: { onMessage },
  });
  const alice = new MockLink("alice");
  const mallory = new MockLink("mallory");
  mesh.addPeerLink(alice);
  mesh.addPeerLink(mallory);
  mesh.setPeerSessionKey("alice", KEY_A);
  mesh.setPeerSessionKey("mallory", KEY_M);
  return { mesh, onMessage, alice, mallory };
}

// ────────────────────────────────────────────────────────────────────────
// AC3 — Math.random fallback removed (fail hard)
// ────────────────────────────────────────────────────────────────────────

describe("generateSessionKey fails hard without a CSPRNG (#1708 AC3)", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
      writable: true,
    });
  });

  it("produces a valid 64-hex-char key that is unique per call", () => {
    const k1 = generateSessionKey();
    const k2 = generateSessionKey();
    expect(isValidSessionKeyHex(k1)).toBe(true);
    expect(isValidSessionKeyHex(k2)).toBe(true);
    expect(k1).not.toBe(k2);
  });

  it("THROWS when crypto.getRandomValues is unavailable (no Math.random fallback)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    expect(() => generateSessionKey()).toThrow(/crypto\.getRandomValues/);
  });

  it("isValidSessionKeyHex rejects malformed keys", () => {
    const withLetters = "ab".repeat(32);
    expect(isValidSessionKeyHex("")).toBe(false);
    expect(isValidSessionKeyHex("xyz")).toBe(false);
    expect(isValidSessionKeyHex(withLetters.toUpperCase())).toBe(false);
    expect(isValidSessionKeyHex(`${withLetters}00`)).toBe(false);
    expect(isValidSessionKeyHex(withLetters)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Handshake-ack pairwise distribution + fail-closed adoption
// ────────────────────────────────────────────────────────────────────────

describe("handshake-ack pairwise key distribution (#1708 AC1)", () => {
  it("createHandshakeAck includes a valid key and throws on malformed keys", () => {
    const ack = createHandshakeAck("host", true, 3, KEY_A);
    expect(ack.payload.sessionKeyHex).toBe(KEY_A);

    expect(() => createHandshakeAck("host", true, 3, "short")).toThrow(
      /sessionKeyHex/,
    );
    expect(() => createHandshakeAck("host", true, 3, "")).toThrow(
      /sessionKeyHex/,
    );
  });

  it("HandshakeSession.handleResponse mints a FRESH pairwise key per connection", () => {
    const runHandshake = (): HandshakeAckMessage => {
      const host = new HandshakeSession("host");
      const challenge = host.handleInit(
        createHandshakeInit("joiner", "J", "joiner", "GAME"),
      );
      // Craft the joiner's response over the same state so the checksum
      // matches and the responder (host) reaches the verified branch.
      const state = makeGameState(7);
      const response = createHandshakeResponse(
        "joiner",
        challenge.payload.challenge,
        state,
      );
      return host.handleResponse(response, state);
    };

    const ack1 = runHandshake();
    const ack2 = runHandshake();

    expect(ack1.payload.checksumMatch).toBe(true);
    expect(isValidSessionKeyHex(ack1.payload.sessionKeyHex)).toBe(true);
    // One handshake = one key: two connections never share material.
    expect(ack1.payload.sessionKeyHex).not.toBe(ack2.payload.sessionKeyHex);
  });
});

describe("legacy handshake-ack cannot disable verification (#1708 AC4)", () => {
  it("requireSessionKeyFromAck THROWS on a legacy ack that omits sessionKeyHex", () => {
    const legacyAck = createHandshakeAck("host", true, 1);
    expect(legacyAck.payload.sessionKeyHex).toBeUndefined();
    expect(() => requireSessionKeyFromAck(legacyAck)).toThrow(
      /refusing to downgrade/,
    );
  });

  it("requireSessionKeyFromAck THROWS on a malformed key", () => {
    const badAck: HandshakeAckMessage = {
      ...createHandshakeAck("host", true, 1),
      payload: { checksumMatch: true, stateVersion: 1, sessionKeyHex: "zz" },
    };
    expect(() => requireSessionKeyFromAck(badAck)).toThrow(
      /refusing to downgrade/,
    );
  });

  it("requireSessionKeyFromAck returns the validated key on a conforming ack", () => {
    expect(
      requireSessionKeyFromAck(createHandshakeAck("host", true, 1, KEY_A)),
    ).toBe(KEY_A);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Mesh per-peer-pair keys + anti-forgery (#1708 AC1 / AC2 / AC4)
// ────────────────────────────────────────────────────────────────────────

describe("mesh keyed links: envelope wire format (#1708 AC1)", () => {
  it("outbound traffic on a keyed link is an envelope; unkeyed links stay legacy", () => {
    const { mesh, alice, mallory } = newVictimMesh();
    // Drop mallory's key so her link runs legacy mode.
    mesh.setPeerSessionKey("mallory", null);

    expect(mesh.broadcast({ type: "chat", data: { text: "hi" } })).toBe(2);

    const onAlice = JSON.parse(alice.sent[0]) as {
      payload?: unknown;
      hmac?: string;
    };
    expect(typeof onAlice.hmac).toBe("string");
    expect(onAlice.payload).toMatchObject({ senderId: "victim", type: "chat" });

    const onMallory = JSON.parse(mallory.sent[0]) as GameMessage;
    expect(onMallory).toMatchObject({ senderId: "victim", type: "chat" });
    expect("hmac" in onMallory).toBe(false);
  });

  it("distinct pair keys yield distinct envelope tags for the same message (key separation)", () => {
    const { mesh, alice, mallory } = newVictimMesh();
    mesh.broadcast({ type: "chat", data: { text: "hi" } });

    const tagAlice = (JSON.parse(alice.sent[0]) as { hmac: string }).hmac;
    const tagMallory = (JSON.parse(mallory.sent[0]) as { hmac: string }).hmac;
    expect(tagAlice).not.toBe(tagMallory);
  });

  it("the pairwise secret itself never appears on the wire", () => {
    const { mesh, alice } = newVictimMesh();
    mesh.broadcast({ type: "chat", data: { text: "hi" } });
    expect(alice.sent[0]).not.toContain(KEY_A);
    // Only the DERIVED per-sender subkey signs — the pair key is not it.
    expect(alice.sent[0]).not.toContain(derivePerSenderKey(KEY_A, "victim"));
  });
});

describe("mesh keyed links: genuine envelopes accepted (#1708)", () => {
  it("accepts a freshly-signed envelope from the keyed peer and forwards to onMessage", () => {
    const { mesh, onMessage } = newVictimMesh();
    mesh.handleIncoming(envelopeFor(gameMsg("alice", 0), KEY_A), "alice");
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({
      senderId: "alice",
      seq: 0,
    });
  });
});

describe("mesh keyed links fail closed (#1708 AC2)", () => {
  it("rejects legacy non-enveloped traffic on a keyed link", () => {
    const { mesh, onMessage } = newVictimMesh();
    mesh.handleIncoming(JSON.stringify(gameMsg("alice", 0)), "alice");
    expect(onMessage).not.toHaveBeenCalled();
    expect(mesh.getEnvelopeRejections()).toBe(1);
  });

  it("unkeyed links keep accepting legacy traffic (back-compat)", () => {
    const onMessage = jest.fn();
    const mesh = new MeshGameConnection({
      localPlayerId: "victim",
      localPlayerName: "Victim",
      hostId: "victim",
      isHost: true,
      heartbeat: { intervalMs: 0 },
      events: { onMessage },
    });
    mesh.addPeerLink(new MockLink("alice"));
    mesh.handleIncoming(JSON.stringify(gameMsg("alice", 0)), "alice");
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("inbound traffic can NEVER mutate key state (no remote downgrade)", () => {
    const { mesh, alice } = newVictimMesh();
    // Flood the link with legacy / envelope-shaped / junk payloads —
    // including a "handshake-ack"-looking payload that omits a key.
    const legacyAck = JSON.stringify({
      type: "handshake-ack",
      senderId: "alice",
      timestamp: Date.now(),
      payload: { checksumMatch: true, stateVersion: 1 },
    });
    mesh.handleIncoming(JSON.stringify(gameMsg("alice", 0)), "alice");
    mesh.handleIncoming(legacyAck, "alice");
    mesh.handleIncoming("garbage", "alice");
    mesh.handleIncoming(envelopeFor(gameMsg("alice", 1), KEY_A), "alice");

    expect(mesh.getPeerSessionKey("alice")).toBe(KEY_A);
    expect(mesh.isPeerLinkKeyed("alice")).toBe(true);
    // And the link STILL fails closed afterwards.
    mesh.handleIncoming(JSON.stringify(gameMsg("alice", 2)), "alice");
    expect(mesh.getEnvelopeRejections()).toBeGreaterThan(1);
    void alice;
  });
});

describe("mesh anti-forgery: swapped-sender envelopes rejected (#1708 AC4)", () => {
  it("a peer holding ITS OWN pair key cannot forge an envelope bearing another senderId", () => {
    const { mesh, onMessage } = newVictimMesh();
    // Mallory legitimately holds KEY_M (her pairwise secret with the
    // victim — a superset of what the old mesh-shared key disclosed).
    // She derives the per-sender subkey for "alice" and signs a forged
    // game-action. The HMAC verifies — but the declared sender ("alice")
    // is bound to the DELIVERING link ("mallory"), so it is rejected.
    const forged = gameMsg("alice", 0);
    const wire = JSON.stringify(
      signMessageEnvelope(forged, derivePerSenderKey(KEY_M, "alice")),
    );
    mesh.handleIncoming(wire, "mallory");

    expect(onMessage).not.toHaveBeenCalled();
    expect(mesh.getEnvelopeRejections()).toBe(1);
  });

  it("even identical pair keys on two links cannot cross-forge (link binding)", () => {
    const onMessage = jest.fn();
    const mesh = new MeshGameConnection({
      localPlayerId: "victim",
      localPlayerName: "Victim",
      hostId: "victim",
      isHost: true,
      heartbeat: { intervalMs: 0 },
      events: { onMessage },
    });
    const alice = new MockLink("alice");
    const mallory = new MockLink("mallory");
    mesh.addPeerLink(alice);
    mesh.addPeerLink(mallory);
    // Misconfiguration: same secret on both links (the old mesh-shared
    // arrangement). Forgery must STILL fail — sender is bound to the
    // delivering link, not just to the key.
    mesh.setPeerSessionKey("alice", KEY_A);
    mesh.setPeerSessionKey("mallory", KEY_A);

    const forged = signMessageEnvelope(
      gameMsg("alice", 0),
      derivePerSenderKey(KEY_A, "alice"),
    );
    mesh.handleIncoming(JSON.stringify(forged), "mallory");

    expect(onMessage).not.toHaveBeenCalled();
    expect(mesh.getEnvelopeRejections()).toBe(1);
  });

  it("a CAPTURED genuine envelope cannot be replayed on another link", () => {
    const { mesh, onMessage, alice } = newVictimMesh();
    mesh.broadcast({ type: "chat", data: { text: "hi" } });
    // Mallory captures the victim→alice envelope off alice's link and
    // replays it on her own link. The tag was computed under KEY_A's
    // victim-derived subkey; mallory's link verifies under KEY_M — and
    // the declared sender ("victim") ≠ delivering peer ("mallory").
    const captured = alice.sent[0];
    mesh.handleIncoming(captured, "mallory");
    expect(onMessage).not.toHaveBeenCalled();
    expect(mesh.getEnvelopeRejections()).toBe(1);
  });

  it("a wrong-key envelope from the correct sender is rejected", () => {
    const { mesh, onMessage } = newVictimMesh();
    // Alice's link is keyed KEY_A but she signs under KEY_M (stale /
    // rotated-away key): HMAC fails.
    mesh.handleIncoming(envelopeFor(gameMsg("alice", 0), KEY_M), "alice");
    expect(onMessage).not.toHaveBeenCalled();
    expect(mesh.getEnvelopeRejections()).toBe(1);
  });
});
