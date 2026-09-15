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
 *
 * Issue #1707 — `hmacSha256Hex` is now RFC 2104 HMAC-SHA-256. The
 * `hmacSha256Hex` block below pins the RFC 4231 test vectors (all 7),
 * cross-checks against Node's crypto HMAC (including the >64-byte-key
 * pre-hash path), and asserts that tags produced by the retired
 * SHA256-prefix scheme are rejected by the new verifier.
 */

import { describe, it, expect } from "@jest/globals";
import { createHash, createHmac } from "node:crypto";
import {
  canonicalTokenPayload,
  createSpectatorHandshakeAck,
  createSpectatorHandshakeChallenge,
  createSpectatorHandshakeFailed,
  createSpectatorHandshakeInit,
  createSpectatorHandshakeResponse,
  evaluateSpectatorHandshakeInit,
  hmacSha256Bytes,
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

/** Test-local hex decoder for building raw RFC 4231 key/data material. */
function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Test-local hex encoder for comparing raw digests. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    expect(canonicalTokenPayload("lobby-1", "spec-1", "ABC123", 100, 200)).toBe(
      "lobby-1|spec-1|ABC123|100|200",
    );
  });
});

describe("SpectatorHandshake — hmacSha256Hex (RFC 2104, issue #1707)", () => {
  it("is deterministic for the same input", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).toBe(
      hmacSha256Hex("aabbcc", "hello"),
    );
  });

  it("differs when the secret differs", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).not.toBe(
      hmacSha256Hex("ddeeff", "hello"),
    );
  });

  it("differs when the message differs", () => {
    expect(hmacSha256Hex("aabbcc", "hello")).not.toBe(
      hmacSha256Hex("aabbcc", "world"),
    );
  });

  it("returns a 64-char hex digest (SHA-256)", () => {
    const digest = hmacSha256Hex("aabbcc", "hello");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches RFC 4231 Test Case 1 (key = 0x0b × 20, "Hi There")', () => {
    const digest = bytesToHex(
      hmacSha256Bytes(
        bytesFromHex("0b".repeat(20)),
        bytesFromHex("4869205468657265"),
      ),
    );
    expect(digest).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it('matches RFC 4231 Test Case 2 ("Jefe") through the string API', () => {
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("matches RFC 4231 Test Case 3 (key = 0xaa × 20, data = 0xdd × 50)", () => {
    const digest = bytesToHex(
      hmacSha256Bytes(
        bytesFromHex("aa".repeat(20)),
        bytesFromHex("dd".repeat(50)),
      ),
    );
    expect(digest).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });

  it("matches RFC 4231 Test Case 4 (key = 0x01..0x19, data = 0xcd × 50)", () => {
    const key = bytesFromHex(
      Array.from({ length: 25 }, (_, i) =>
        (i + 1).toString(16).padStart(2, "0"),
      ).join(""),
    );
    const digest = bytesToHex(
      hmacSha256Bytes(key, bytesFromHex("cd".repeat(50))),
    );
    expect(digest).toBe(
      "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
    );
  });

  it('matches RFC 4231 Test Case 5 ("Test With Truncation", truncated to 128 bits)', () => {
    const full = bytesToHex(
      hmacSha256Bytes(
        bytesFromHex("0c".repeat(20)),
        new TextEncoder().encode("Test With Truncation"),
      ),
    );
    // RFC 4231 publishes only the first 128 bits (32 hex chars).
    expect(full.slice(0, 32)).toBe("a3b6167473100ee06e0c796c2955552b");
  });

  it("matches RFC 4231 Test Case 6 (key longer than block size, pre-hashed)", () => {
    const digest = bytesToHex(
      hmacSha256Bytes(
        bytesFromHex("aa".repeat(131)),
        new TextEncoder().encode(
          "Test Using Larger Than Block-Size Key - Hash Key First",
        ),
      ),
    );
    expect(digest).toBe(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    );
  });

  it("matches RFC 4231 Test Case 7 (key AND data larger than block size)", () => {
    const digest = bytesToHex(
      hmacSha256Bytes(
        bytesFromHex("aa".repeat(131)),
        new TextEncoder().encode(
          "This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.",
        ),
      ),
    );
    expect(digest).toBe(
      "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
    );
  });

  it("agrees with Node's crypto HMAC-SHA256 for long + short keys and UTF-8 data", () => {
    // Cross-checks the pure-JS RFC 2104 construction (including the
    // >64-byte key pre-hash path) against the canonical implementation.
    for (const secret of [
      "short-hex-secret-0011",
      "long-secret-" + "ab".repeat(80),
      SECRET,
    ]) {
      const message = `p2p-envelope-sender:peer-with-utf8-名前:${secret.length}`;
      const nodeHex = createHmac("sha256", secret)
        .update(message, "utf8")
        .digest("hex");
      expect(hmacSha256Hex(secret, message)).toBe(nodeHex);
    }
  });

  it("does not equal the retired secret-prefix construction for the same input", () => {
    // Pre-#1707 the tag was SHA256(SHA256(secret)||message) — a
    // length-extension-vulnerable secret-prefix MAC. The RFC 2104 tag
    // must differ from it on identical input.
    const secret = "aabbcc";
    const message = "hello";
    const k = createHash("sha256").update(secret, "utf8").digest();
    const oldSchemeTag = createHash("sha256")
      .update(Buffer.concat([k, Buffer.from(message, "utf8")]))
      .digest("hex");
    expect(hmacSha256Hex(secret, message)).not.toBe(oldSchemeTag);
  });
});

describe("SpectatorHandshake — sign / verify capability token", () => {
  it("a freshly minted token verifies with the same secret", () => {
    const token = makeToken();
    expect(
      verifySpectatorCapabilityToken(token, SECRET, token.issuedAt + 1000),
    ).toBe(true);
  });

  it("a token with a wrong secret fails verification", () => {
    const token = makeToken();
    expect(
      verifySpectatorCapabilityToken(token, "000000", token.issuedAt + 1000),
    ).toBe(false);
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
    expect(
      verifySpectatorCapabilityToken(forged, SECRET, token.issuedAt + 1000),
    ).toBe(false);
  });

  it("a token with a tampered lobbyId fails verification", () => {
    const token = makeToken();
    const tampered: SpectatorCapabilityToken = {
      ...token,
      lobbyId: "other-lobby",
    };
    expect(
      verifySpectatorCapabilityToken(tampered, SECRET, token.issuedAt + 1000),
    ).toBe(false);
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

  it("a token signed with the retired pre-#1707 scheme is rejected", () => {
    // Old-scheme tag for the exact makeToken() fields, computed with
    // the retired construction SHA256(SHA256(secret) || payload)
    // (replicated via node:crypto and cross-checked against the
    // pre-#1707 implementation before it was removed). The new
    // RFC 2104 verifier must fail closed on it.
    const OLD_SCHEME_SIGNATURE =
      "01f64d50bc4983730ca100017cd6a2562191ae8a69dfbc55c97a8bd812c5cd12";
    const oldSchemeToken: SpectatorCapabilityToken = {
      lobbyId: "lobby-1",
      spectatorId: "spec-1",
      gameCode: "ABC123",
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 5 * 60 * 1000,
      signature: OLD_SCHEME_SIGNATURE,
    };
    expect(
      verifySpectatorCapabilityToken(oldSchemeToken, SECRET, 1_700_000_001_000),
    ).toBe(false);
    // Sanity: the same token re-signed under the new scheme verifies,
    // proving the rejection comes from the MAC construction, not the
    // field values or expiry window.
    const freshToken = makeToken();
    expect(
      verifySpectatorCapabilityToken(freshToken, SECRET, 1_700_000_001_000),
    ).toBe(true);
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
    expect(
      verifySpectatorCapabilityToken(shortSig, SECRET, token.issuedAt + 1),
    ).toBe(false);
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
    expect(msg.payload.protocolVersion).toBe(
      SPECTATOR_HANDSHAKE_PROTOCOL_VERSION,
    );
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
