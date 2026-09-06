/**
 * @fileOverview Tests for `src/lib/turn-hmac.ts` — issue #1583.
 *
 * Pins the contract from the issue acceptance criteria:
 *   - The username is `<expiry-epoch>:<client-id>` (RFC 7635).
 *   - The credential is `HMAC-SHA1(secret, username)` (base64).
 *   - Two consecutive mints with the same inputs differ (different
 *     `now` ⇒ different expiry ⇒ different HMAC). Two mints with
 *     different `clientId` differ. Two mints with different
 *     `secret` differ.
 *   - The expiry is bounded above by 24h (issue acceptance criterion:
 *     "credentials with expiry <= 24h").
 *   - `verifyTurnCredential` accepts a freshly minted pair and rejects
 *     expired, tampered, and wrong-secret pairs.
 *   - The raw secret NEVER appears anywhere in the returned credential
 *     surface.
 *
 * Sanitisation tests pin the `clientId` policy: characters outside
 * `[A-Za-z0-9_-]` are stripped, empty inputs throw, long inputs are
 * truncated to 64 chars.
 */

import { describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";

import {
  TURN_CREDENTIAL_DEFAULT_TTL_SECONDS,
  TURN_CREDENTIAL_MAX_TTL_SECONDS,
  hmacSha1Base64,
  hmacSha1Hex,
  mintTurnCredential,
  parseTurnUsername,
  sanitizeClientId,
  verifyTurnCredential,
} from "../turn-hmac";

const FIXED_SECRET = "test-secret-do-not-use-in-prod-1234567890abcdef";

describe("TURN_CREDENTIAL_* constants", () => {
  it("default TTL is 1 hour", () => {
    expect(TURN_CREDENTIAL_DEFAULT_TTL_SECONDS).toBe(3600);
  });

  it("max TTL is 24 hours (issue acceptance criterion)", () => {
    expect(TURN_CREDENTIAL_MAX_TTL_SECONDS).toBe(24 * 60 * 60);
  });
});

describe("sanitizeClientId", () => {
  it("passes through safe characters unchanged", () => {
    expect(sanitizeClientId("peer-abc_123")).toBe("peer-abc_123");
  });

  it("strips characters outside [A-Za-z0-9_-]", () => {
    expect(sanitizeClientId("peer abc!@#123/")).toBe("peerabc123");
  });

  it("truncates to 64 chars", () => {
    const long = "a".repeat(128);
    expect(sanitizeClientId(long).length).toBe(64);
  });

  it("throws when no safe characters remain", () => {
    expect(() => sanitizeClientId("!!!")).toThrow(
      /at least one safe character/,
    );
  });

  it("throws when input is not a string", () => {
    // @ts-expect-error — intentional bad input
    expect(() => sanitizeClientId(42)).toThrow(/must be a string/);
    // @ts-expect-error — intentional bad input
    expect(() => sanitizeClientId(null)).toThrow(/must be a string/);
  });
});

describe("parseTurnUsername", () => {
  it("parses a valid `<expiry>:<clientId>` username", () => {
    const parsed = parseTurnUsername("1700000000:peer-1");
    expect(parsed).toEqual({
      expiryEpochSeconds: 1700000000,
      clientId: "peer-1",
    });
  });

  it("returns null for missing separator", () => {
    expect(parseTurnUsername("1700000000peer-1")).toBeNull();
  });

  it("returns null for empty clientId component", () => {
    expect(parseTurnUsername("1700000000:")).toBeNull();
  });

  it("returns null for empty expiry component", () => {
    expect(parseTurnUsername(":peer-1")).toBeNull();
  });

  it("returns null for non-numeric expiry", () => {
    expect(parseTurnUsername("notanumber:peer-1")).toBeNull();
  });

  it("returns null for clientId with unsafe characters", () => {
    expect(parseTurnUsername("1700000000:peer!1")).toBeNull();
  });

  it("returns null for empty / non-string input", () => {
    expect(parseTurnUsername("")).toBeNull();
    // @ts-expect-error — intentional bad input
    expect(parseTurnUsername(null)).toBeNull();
  });
});

describe("hmacSha1Base64", () => {
  it("matches a known RFC 2202 test vector (Test Case 1)", () => {
    // RFC 2202 Test Case 1: key = 0x0b * 20, data = "Hi There"
    // HMAC-SHA-1 = b617318655057264e28bc0b6fb378c8ef146be00
    // base64 of that = "thcxhlUFcmTii8C2+zeMjvFGvgA="
    const keyBytes = String.fromCharCode(0x0b).repeat(20);
    const expected = "thcxhlUFcmTii8C2+zeMjvFGvgA=";
    expect(hmacSha1Base64(keyBytes, "Hi There")).toBe(expected);
  });

  it("matches Node's crypto reference for a long secret + UTF-8 message", () => {
    // Sanity: re-mint with Node's HMAC-SHA1 and compare. This catches
    // any drift between the self-rolled SHA-1 and the canonical
    // implementation in a fresh process.
    const secret = "integration-secret-" + "x".repeat(100);
    const message = "1700000000:peer-with-utf8-名前";
    const nodeB64 = createHmac("sha1", secret).update(message).digest("base64");
    expect(hmacSha1Base64(secret, message)).toBe(nodeB64);
  });

  it("produces deterministic output for identical inputs", () => {
    expect(hmacSha1Base64(FIXED_SECRET, "hello")).toBe(
      hmacSha1Base64(FIXED_SECRET, "hello"),
    );
  });

  it("produces different output for different secrets", () => {
    expect(hmacSha1Base64("secret-a", "hello")).not.toBe(
      hmacSha1Base64("secret-b", "hello"),
    );
  });

  it("produces different output for different messages", () => {
    expect(hmacSha1Base64(FIXED_SECRET, "hello")).not.toBe(
      hmacSha1Base64(FIXED_SECRET, "world"),
    );
  });

  it("hex helper agrees with the base64 helper", () => {
    const hex = hmacSha1Hex(FIXED_SECRET, "hello");
    const b64 = hmacSha1Base64(FIXED_SECRET, "hello");
    // 20-byte SHA-1 → 40 hex chars / 28 base64 chars (one `=` pad
    // because 20 % 3 = 2).
    expect(hex).toMatch(/^[0-9a-f]{40}$/);
    expect(b64).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    // Both encode the same byte sequence.
    const expectedHex = Buffer.from(b64, "base64").toString("hex");
    expect(hex).toBe(expectedHex);
  });
});

describe("mintTurnCredential", () => {
  it("produces a `<expiry>:<clientId>` username", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    expect(result.username).toBe("1700003600:peer-1");
    expect(result.expiresAtEpochSeconds).toBe(1_700_003_600);
    expect(result.clientId).toBe("peer-1");
  });

  it("credential is non-empty base64 (HMAC-SHA1)", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    expect(result.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // 20-byte SHA-1 ⇒ 28-char base64 with `==` padding.
    expect(result.credential.length).toBe(28);
  });

  it("raw secret never appears in the returned credential / username / clientId", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(FIXED_SECRET);
  });

  it("two mints with identical inputs differ (expiry advances over time)", () => {
    const a = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    const b = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_001,
      ttlSeconds: 3600,
    });
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("two mints with different clientIds differ", () => {
    const a = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    const b = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-2",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("two mints with different secrets differ", () => {
    const a = mintTurnCredential({
      secret: "secret-a",
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    const b = mintTurnCredential({
      secret: "secret-b",
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    expect(a.username).toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("expiry is bounded above by 24h even when the caller asks for more", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    });
    expect(result.expiresAtEpochSeconds - 1_700_000_000).toBe(
      TURN_CREDENTIAL_MAX_TTL_SECONDS,
    );
  });

  it("expiry is bounded below by 1s (zero/negative TTL clamps upward)", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 0,
    });
    expect(result.expiresAtEpochSeconds - 1_700_000_000).toBe(1);
  });

  it("default TTL is used when none specified", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000,
    });
    expect(result.expiresAtEpochSeconds - 1_700_000_000).toBe(
      TURN_CREDENTIAL_DEFAULT_TTL_SECONDS,
    );
  });

  it("throws on empty / non-string secret", () => {
    expect(() =>
      mintTurnCredential({ secret: "", clientId: "peer-1" }),
    ).toThrow(/non-empty string/);
    // @ts-expect-error — intentional bad input
    expect(() => mintTurnCredential({ clientId: "peer-1" })).toThrow(
      /non-empty string/,
    );
  });

  it("throws when clientId reduces to empty after sanitisation", () => {
    expect(() =>
      mintTurnCredential({ secret: FIXED_SECRET, clientId: "!!!" }),
    ).toThrow(/at least one safe character/);
  });

  it("sanitises unsafe characters in clientId before minting", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer!@#1",
      nowEpochSeconds: 1_700_000_000,
      ttlSeconds: 3600,
    });
    expect(result.clientId).toBe("peer1");
    expect(result.username).toMatch(/:peer1$/);
  });

  it("nowEpochSeconds is floored to integer seconds", () => {
    const result = mintTurnCredential({
      secret: FIXED_SECRET,
      clientId: "peer-1",
      nowEpochSeconds: 1_700_000_000.9,
      ttlSeconds: 3600,
    });
    expect(result.expiresAtEpochSeconds).toBe(1_700_003_600);
  });
});

describe("verifyTurnCredential", () => {
  const now = 1_700_000_000;
  const ttl = 3600;
  const baseOpts = {
    secret: FIXED_SECRET,
    clientId: "peer-1",
    nowEpochSeconds: now,
    ttlSeconds: ttl,
  };

  it("accepts a freshly minted pair against the same secret", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        FIXED_SECRET,
        minted.username,
        minted.credential,
        now,
      ),
    ).toBe(true);
  });

  it("accepts the credential mid-window (now < expiry)", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        FIXED_SECRET,
        minted.username,
        minted.credential,
        now + 1,
      ),
    ).toBe(true);
  });

  it("rejects the credential at the expiry boundary (now === expiry)", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        FIXED_SECRET,
        minted.username,
        minted.credential,
        now + ttl,
      ),
    ).toBe(false);
  });

  it("rejects the credential past the expiry (now > expiry)", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        FIXED_SECRET,
        minted.username,
        minted.credential,
        now + ttl + 1,
      ),
    ).toBe(false);
  });

  it("rejects a credential under a different secret", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        "other-secret",
        minted.username,
        minted.credential,
        now,
      ),
    ).toBe(false);
  });

  it("rejects a tampered credential string", () => {
    const minted = mintTurnCredential(baseOpts);
    const tampered =
      minted.credential[0] === "A"
        ? `B${minted.credential.slice(1)}`
        : `A${minted.credential.slice(1)}`;
    expect(
      verifyTurnCredential(FIXED_SECRET, minted.username, tampered, now),
    ).toBe(false);
  });

  it("rejects a tampered username", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential(
        FIXED_SECRET,
        minted.username.replace(/:peer-1$/, ":peer-2"),
        minted.credential,
        now,
      ),
    ).toBe(false);
  });

  it("rejects an empty / malformed username or credential", () => {
    expect(verifyTurnCredential(FIXED_SECRET, "", "x", now)).toBe(false);
    expect(verifyTurnCredential(FIXED_SECRET, "peer-1", "x", now)).toBe(false);
    expect(verifyTurnCredential(FIXED_SECRET, "abc:def", "", now)).toBe(false);
  });

  it("rejects an empty secret", () => {
    const minted = mintTurnCredential(baseOpts);
    expect(
      verifyTurnCredential("", minted.username, minted.credential, now),
    ).toBe(false);
  });
});
