/**
 * Tests for the SpectatorHandshake + capability-token machinery. Issue #1253.
 *
 * Covers the acceptance criteria:
 *
 *   - "Add SpectatorHandshake to p2p-handshake.ts that exchanges a
 *     capability token proving the joining peer is in the lobby's
 *     spectators[] roster." — exercised via
 *     `signSpectatorCapabilityToken` + `verifySpectatorCapabilityToken`
 *     + `validateSpectatorTokenForLobby` + `evaluateSpectatorHandshakeInit`.
 *   - "Coverage maintained" — every public symbol in the spectator
 *     handshake section is exercised.
 */

import { describe, it, expect } from "@jest/globals";
import {
  canonicalTokenPayload,
  createSpectatorHandshakeAck,
  createSpectatorHandshakeChallenge,
  createSpectatorHandshakeFailed,
  createSpectatorHandshakeInit,
  createSpectatorHandshakeResponse,
  evaluateSpectatorHandshakeInit,
  hmacSha256Hex,
  signSpectatorCapabilityToken,
  validateSpectatorTokenForLobby,
  verifySpectatorCapabilityToken,
  DEFAULT_SPECTATOR_TOKEN_TTL_MS,
  SPECTATOR_HANDSHAKE_PROTOCOL_VERSION,
  type SpectatorCapabilityToken,
} from "../p2p-handshake";

const SECRET = "00112233445566778899aabbccddeeff";

function makeToken(
  overrides: Partial<Parameters<typeof signSpectatorCapabilityToken>[0]> = {},
): SpectatorCapabilityToken {
  return signSpectatorCapabilityToken({
    lobbyId: "lobby-1",
    spectatorId: "spec-1",
    gameCode: "ABC123",
    secret: SECRET,
    issuedAt: 1_700_000_000_000,
    ttlMs: 5 * 60 * 1000,
    ...overrides,
  });
}

describe("SpectatorHandshake — constants", () => {
  it("SPECTATOR_HANDSHAKE_PROTOCOL_VERSION is a stable version string", () => {
    expect(SPECTATOR_HANDSHAKE_PROTOCOL_VERSION).toBe("1.0.0");
  });

  it("DEFAULT_SPECTATOR_TOKEN_TTL_MS is 5 minutes", () => {
    expect(DEFAULT_SPECTATOR_TOKEN_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe("SpectatorHandshake — canonicalTokenPayload", () => {
  it("joins fields with '|' separators in fixed order", () => {
    expect(
      canonicalTokenPayload("lobby-1", "spec-1", "ABC123", 100, 200),
    ).toBe("lobby-1|spec-1|ABC123|100|200");
  });
});

describe("SpectatorHandshake — hmacSha256Hex", () => {
  it("is deterministic for the same input", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).toBe(hmacSha256Hex("aabbcc", "hello"));
  });

  it("differs when the secret differs", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).not.toBe(hmacSha256Hex("ddeeff", "hello"));
  });

  it("differs when the message differs", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).not.toBe(hmacSha256Hex("aabbcc", "world"));
  });

  it("returns a 64-char hex digest (SHA-256)", () => {
    const digest = hmacSha256Hex("aabbcc", "hello");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SpectatorHandshake — sign / verify capability token", () => {
  it("a freshly minted token verifies with the same secret", () => {
    const token = makeToken();
    expect(verifySpectatorCapabilityToken(token, SECRET, token.issuedAt + 1000)).toBe(
      true,
    );
  });

  it("a token with a wrong secret fails verification", () => {
    const token = makeToken();
    expect(verifySpectatorCapabilityToken(token, "000000", token.issuedAt + 1000)).toBe(
      false,
    );
  });

  it("an expired token (past expiresAt) fails verification", () => {
    const token = makeToken({ issuedAt: 1000, ttlMs: 5000 });
    expect(verifySpectatorCapabilityToken(token, SECRET, 10_000)).toBe(false);
  });

  it("a token with a forged signature fails verification", () => {
    const token = makeToken();
    const forged: SpectatorCapabilityToken = {
      ...token,
      signature: "0".repeat(token.signature.length),
    };
    expect(verifySpectatorCapabilityToken(forged, SECRET, token.issuedAt + 1000)).toBe(
      false,
    );
  });

  it("a token with a tampered lobbyId fails verification", () => {
    const token = makeToken();
    const tampered: SpectatorCapabilityToken = {
      ...token,
      lobbyId: "other-lobby",
    };
    expect(verifySpectatorCapabilityToken(tampered, SECRET, token.issuedAt + 1000)).toBe(
      false,
    );
  });

  it("a token with expiresAt <= issuedAt is rejected", () => {
    const token = makeToken({ issuedAt: 1000, ttlMs: 0 });
    expect(verifySpectatorCapabilityToken(token, SECRET, 1000)).toBe(false);
  });

  it("a token missing fields is rejected", () => {
    const token = makeToken();
    expect(
      verifySpectatorCapabilityToken(
        { ...token, lobbyId: undefined as unknown as string },
        SECRET,
        token.issuedAt + 1000,
      ),
    ).toBe(false);
    expect(
      verifySpectatorCapabilityToken(
        { ...token, signature: undefined as unknown as string },
        SECRET,
        token.issuedAt + 1000,
      ),
    ).toBe(false);
  });

  it("the signature is constant-time comparable (length-mismatch short-circuits)", () => {
    // Not a strict timing test, but the implementation explicitly
    // checks signature length before the loop so a wrong-length
    // signature can never be verified.
    const token = makeToken();
    const shortSig: SpectatorCapabilityToken = {
      ...token,
      signature: "abcd",
    };
    expect(verifySpectatorCapabilityToken(shortSig, SECRET, token.issuedAt + 1)).toBe(
      false,
    );
  });
});

describe("SpectatorHandshake — validateSpectatorTokenForLobby", () => {
  it("returns accepted when the token verifies AND the spectator is in the roster", () => {
    const token = makeToken();
    const result = validateSpectatorTokenForLobby(
      token,
      SECRET,
      () => true,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(true);
  });

  it("returns rejected when the token does not verify", () => {
    const token = makeToken();
    const result = validateSpectatorTokenForLobby(
      token,
      "wrong-secret",
      () => true,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/invalid|expired/i);
    }
  });

  it("returns rejected when the spectator is not in the roster", () => {
    const token = makeToken();
    const result = validateSpectatorTokenForLobby(
      token,
      SECRET,
      () => false,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/not in this lobby/i);
    }
  });
});

describe("SpectatorHandshake — message factories", () => {
  it("createSpectatorHandshakeInit embeds the token + protocol version", () => {
    const token = makeToken();
    const msg = createSpectatorHandshakeInit("peer-a", token);
    expect(msg.type).toBe("spectator-handshake-init");
    expect(msg.senderId).toBe("peer-a");
    expect(msg.payload.token).toBe(token);
    expect(msg.payload.protocolVersion).toBe(SPECTATOR_HANDSHAKE_PROTOCOL_VERSION);
  });

  it("createSpectatorHandshakeChallenge carries a fresh nonce", () => {
    const msg = createSpectatorHandshakeChallenge("host-1");
    expect(msg.type).toBe("spectator-handshake-challenge");
    expect(msg.senderId).toBe("host-1");
    expect(typeof msg.payload.challenge).toBe("string");
    expect(msg.payload.challenge.length).toBeGreaterThan(0);
  });

  it("createSpectatorHandshakeResponse echoes the challenge", () => {
    const msg = createSpectatorHandshakeResponse("peer-a", {
      challenge: "abc",
      spectatorId: "spec-1",
      lobbyId: "lobby-1",
    });
    expect(msg.type).toBe("spectator-handshake-response");
    expect(msg.payload.challenge).toBe("abc");
    expect(msg.payload.spectatorId).toBe("spec-1");
    expect(msg.payload.lobbyId).toBe("lobby-1");
  });

  it("createSpectatorHandshakeAck assigns a role", () => {
    const msg = createSpectatorHandshakeAck("host-1", "spectator");
    expect(msg.type).toBe("spectator-handshake-ack");
    expect(msg.payload.accepted).toBe(true);
    expect(msg.payload.assignedRole).toBe("spectator");
  });

  it("createSpectatorHandshakeFailed carries a reason", () => {
    const msg = createSpectatorHandshakeFailed("host-1", "roster full");
    expect(msg.type).toBe("spectator-handshake-failed");
    expect(msg.payload.accepted).toBe(false);
    expect(msg.payload.reason).toBe("roster full");
  });
});

describe("SpectatorHandshake — evaluateSpectatorHandshakeInit", () => {
  it("rejects on protocol version mismatch", () => {
    const token = makeToken();
    const init = createSpectatorHandshakeInit("peer-a", token);
    const tampered = {
      ...init,
      payload: { ...init.payload, protocolVersion: "0.0.0" },
    };
    const result = evaluateSpectatorHandshakeInit(
      tampered,
      SECRET,
      () => true,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/protocol/i);
    }
  });

  it("accepts a valid token + roster hit", () => {
    const token = makeToken();
    const init = createSpectatorHandshakeInit("peer-a", token);
    const result = evaluateSpectatorHandshakeInit(
      init,
      SECRET,
      () => true,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(true);
  });

  it("rejects a valid token + roster miss", () => {
    const token = makeToken();
    const init = createSpectatorHandshakeInit("peer-a", token);
    const result = evaluateSpectatorHandshakeInit(
      init,
      SECRET,
      () => false,
      token.issuedAt + 1000,
    );
    expect(result.accepted).toBe(false);
  });
});
