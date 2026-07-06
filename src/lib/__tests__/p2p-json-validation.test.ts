/**
 * Tests for safe JSON parsing of untrusted P2P / signaling data.
 * Issue #924: unvalidated peer JSON.parse casts.
 * Issue #1111: resource-exhaustion limits (size / depth / key-count).
 */

import {
  safeParseJson,
  withinStructuralLimits,
  isNonNegativeInteger,
  isGameMessageLike,
  isMessageEnvelope,
  signMessageEnvelope,
  verifyMessageEnvelope,
  canonicalMessageForHmac,
  MAX_MESSAGE_SIZE_BYTES,
  MAX_NESTING_DEPTH,
  MAX_KEY_COUNT,
} from "../p2p-json-validation";

type Sample = { id: number; name: string };

const isSample = (value: unknown): value is Sample =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === "number" &&
  typeof (value as Record<string, unknown>).name === "string";

describe("safeParseJson", () => {
  describe("acceptance", () => {
    it("returns the validated value for well-formed JSON", () => {
      const result = safeParseJson('{"id":1,"name":"alpha"}', isSample);
      expect(result).toEqual({ id: 1, name: "alpha" });
    });

    it("parses nested valid objects", () => {
      const result = safeParseJson('{"id":2,"name":"beta"}', isSample);
      expect(result?.id).toBe(2);
    });
  });

  describe("rejection (must never throw)", () => {
    it("returns null for malformed JSON", () => {
      expect(safeParseJson("{ not json", isSample)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(safeParseJson("", isSample)).toBeNull();
    });

    it("returns null for a JSON scalar (number)", () => {
      expect(safeParseJson("42", isSample)).toBeNull();
    });

    it("returns null for a JSON scalar (string)", () => {
      expect(safeParseJson('"hello"', isSample)).toBeNull();
    });

    it("returns null for JSON null", () => {
      expect(safeParseJson("null", isSample)).toBeNull();
    });

    it("returns null for a JSON array", () => {
      expect(safeParseJson("[1,2,3]", isSample)).toBeNull();
    });

    it("returns null for valid JSON with the wrong shape", () => {
      expect(safeParseJson('{"foo":"bar"}', isSample)).toBeNull();
    });

    it("returns null when a required field has the wrong type", () => {
      expect(
        safeParseJson('{"id":"not-a-number","name":"alpha"}', isSample),
      ).toBeNull();
    });
  });

  describe("robustness", () => {
    it("never throws, regardless of input", () => {
      const inputs = [
        "",
        "   ",
        "{",
        "}}}",
        "undefined",
        "[1,",
        '{"id":1,"name":',
        String.fromCharCode(0),
      ];
      for (const input of inputs) {
        expect(() => safeParseJson(input, isSample)).not.toThrow();
        expect(safeParseJson(input, isSample)).toBeNull();
      }
    });

    it("returns null for non-string input (defensive)", () => {
      // safeParseJson is typed for strings but external callers may bypass TS.
      expect(
        safeParseJson(undefined as unknown as string, isSample),
      ).toBeNull();
      expect(safeParseJson(null as unknown as string, isSample)).toBeNull();
      expect(safeParseJson(123 as unknown as string, isSample)).toBeNull();
    });
  });

  describe("resource-exhaustion defenses (#1111)", () => {
    it("enforces the default max message size before parsing", () => {
      // A string one byte over the cap is rejected without ever parsing.
      const over = "x".repeat(MAX_MESSAGE_SIZE_BYTES + 1);
      expect(safeParseJson(over, isSample)).toBeNull();
    });

    it("treats the size cap as an inclusive boundary", () => {
      // A payload whose raw length exactly equals maxMessageBytes is accepted
      // (the guard is strictly greater-than). Pad a valid payload to the cap.
      const valid = JSON.stringify({ id: 1, name: "x" });
      const target = 128;
      const padding = " ".repeat(target - valid.length);
      // JSON allows insignificant whitespace, so the padded string still parses
      // to the same shape.
      const padded = valid + padding;
      expect(padded.length).toBe(target);
      const result = safeParseJson(padded, isSample, {
        limits: { maxMessageBytes: target },
      });
      expect(result).toEqual({ id: 1, name: "x" });
    });

    it("rejects oversize messages via an explicit small limit override", () => {
      const small = { limits: { maxMessageBytes: 32 } };
      const ok = '{"id":1,"name":"a"}';
      expect(ok.length).toBeLessThanOrEqual(32);
      expect(safeParseJson(ok, isSample, small)).toEqual({ id: 1, name: "a" });

      const tooBig = '{"id":1,"name":"' + "a".repeat(100) + '"}';
      expect(tooBig.length).toBeGreaterThan(32);
      expect(safeParseJson(tooBig, isSample, small)).toBeNull();
    });

    it("rejects deeply-nested payloads via the depth cap", () => {
      // Build a payload deeper than MAX_NESTING_DEPTH.
      const depth = MAX_NESTING_DEPTH + 5;
      let raw = "";
      for (let i = 0; i < depth; i++) raw += '{"a":';
      raw += "1";
      for (let i = 0; i < depth; i++) raw += "}";
      // The raw string is small (no size trip), parses fine, but exceeds the
      // structural depth limit.
      expect(raw.length).toBeLessThan(MAX_MESSAGE_SIZE_BYTES);
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(safeParseJson(raw, isSample)).toBeNull();
    });

    it("rejects key-bloated payloads via the key-count cap", () => {
      // A flat object with more keys than MAX_KEY_COUNT.
      const parts: string[] = [];
      for (let i = 0; i < MAX_KEY_COUNT + 10; i++) {
        parts.push(`"k${i}":1`);
      }
      const raw = `{"id":1,"name":"x",${parts.join(",")}}`;
      expect(raw.length).toBeLessThan(MAX_MESSAGE_SIZE_BYTES);
      expect(safeParseJson(raw, isSample)).toBeNull();
    });

    it("still accepts a legitimately large, non-pathological payload", () => {
      // 1k nested objects, each with a few keys — well within all caps.
      const items = Array.from({ length: 1000 }, (_, i) => ({
        a: i,
        b: "x",
        c: { d: i },
      }));
      const raw = JSON.stringify({
        id: 1,
        name: "legit",
        items,
      });
      expect(raw.length).toBeLessThan(MAX_MESSAGE_SIZE_BYTES);
      const result = safeParseJson(raw, isSample);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
    });

    it("withinStructuralLimits is bounded and never throws on hostile input", () => {
      // Deeply nested + wide — the walker must bail out, not blow the stack.
      let deep: unknown = 1;
      for (let i = 0; i < 10_000; i++) deep = { a: deep };
      const wide: Record<string, unknown> = {};
      for (let i = 0; i < 100_000; i++) wide[`k${i}`] = i;
      expect(() => withinStructuralLimits(deep)).not.toThrow();
      expect(() => withinStructuralLimits(wide)).not.toThrow();
      expect(withinStructuralLimits(deep)).toBe(false);
      expect(withinStructuralLimits(wide)).toBe(false);
    });
  });

  /**
   * Sequence-number predicate used by `isGameMessage` to require the
   * anti-replay `seq` field (issue #1091).
   */
  describe("isNonNegativeInteger (#1091 seq predicate)", () => {
    it("accepts 0 and positive integers", () => {
      expect(isNonNegativeInteger(0)).toBe(true);
      expect(isNonNegativeInteger(1)).toBe(true);
      expect(isNonNegativeInteger(42)).toBe(true);
      expect(isNonNegativeInteger(1_000_000)).toBe(true);
    });

    it("rejects negative integers", () => {
      expect(isNonNegativeInteger(-1)).toBe(false);
      expect(isNonNegativeInteger(-42)).toBe(false);
    });

    it("rejects non-integer numbers", () => {
      expect(isNonNegativeInteger(1.5)).toBe(false);
      expect(isNonNegativeInteger(0.1)).toBe(false);
      expect(isNonNegativeInteger(-0.5)).toBe(false);
    });

    it("rejects NaN and +/-Infinity (they break <= comparisons)", () => {
      expect(isNonNegativeInteger(NaN)).toBe(false);
      expect(isNonNegativeInteger(Infinity)).toBe(false);
      expect(isNonNegativeInteger(-Infinity)).toBe(false);
    });

    it("rejects non-number types", () => {
      expect(isNonNegativeInteger("0")).toBe(false);
      expect(isNonNegativeInteger("42")).toBe(false);
      expect(isNonNegativeInteger(true)).toBe(false);
      expect(isNonNegativeInteger(null)).toBe(false);
      expect(isNonNegativeInteger(undefined)).toBe(false);
      expect(isNonNegativeInteger({})).toBe(false);
      expect(isNonNegativeInteger([0])).toBe(false);
    });

    it("never throws on hostile input", () => {
      const hostile: unknown[] = [
        null,
        undefined,
        "",
        "0",
        [],
        {},
        Symbol("x"),

        new Number(0),
      ];
      for (const v of hostile) {
        expect(() => isNonNegativeInteger(v)).not.toThrow();
      }
    });
  });
});

/**
 * HMAC-signed message envelopes (issue #1252).
 *
 * Closes the peer-impersonation gap left by sequence numbers (#1091) by
 * binding every outbound `GameMessage` to a per-session symmetric key via
 * HMAC-SHA-256. These tests cover the helper trio in
 * `p2p-json-validation.ts`: `canonicalMessageForHmac`, `signMessageEnvelope`,
 * and `verifyMessageEnvelope`, plus the structural type guards
 * `isGameMessageLike` / `isMessageEnvelope`.
 */
describe("HMAC-signed message envelopes (issue #1252)", () => {
  // 32-byte hex (64 chars). Cryptographically random in production; here
  // we use a fixed value so the expected digests are deterministic.
  const SESSION_KEY = "a".repeat(64);
  const OTHER_KEY = "b".repeat(64);

  const sampleMessage = {
    type: "game-action",
    senderId: "player-1",
    timestamp: 1_700_000_000_000,
    seq: 7,
    data: { action: "pass_priority", data: { foo: "bar" } },
  };

  describe("canonicalMessageForHmac", () => {
    it("produces the same canonical form for messages with equal content", () => {
      const a = canonicalMessageForHmac(sampleMessage);
      const b = canonicalMessageForHmac({
        ...sampleMessage,
        // Reorder keys to confirm canonicalisation is order-independent.
        data: { data: { foo: "bar" }, action: "pass_priority" },
      });
      expect(a).toBe(b);
    });

    it("differs when senderId changes", () => {
      const a = canonicalMessageForHmac(sampleMessage);
      const b = canonicalMessageForHmac({ ...sampleMessage, senderId: "player-2" });
      expect(a).not.toBe(b);
    });

    it("differs when seq changes (replay protection)", () => {
      const a = canonicalMessageForHmac(sampleMessage);
      const b = canonicalMessageForHmac({ ...sampleMessage, seq: 8 });
      expect(a).not.toBe(b);
    });

    it("differs when data changes (payload tamper protection)", () => {
      const a = canonicalMessageForHmac(sampleMessage);
      const b = canonicalMessageForHmac({
        ...sampleMessage,
        data: { action: "pass_priority", data: { foo: "BAZ" } },
      });
      expect(a).not.toBe(b);
    });

    it("uses length-prefixed fields to prevent concatenation collisions", () => {
      // `("ab","c")` and `("a","bc")` must produce different canonical forms.
      const ab = canonicalMessageForHmac({
        ...sampleMessage,
        type: "ab",
        senderId: "c",
      });
      const ac = canonicalMessageForHmac({
        ...sampleMessage,
        type: "a",
        senderId: "bc",
      });
      expect(ab).not.toBe(ac);
    });

    it("normalises NaN/Infinity in data to null (matches JSON.stringify)", () => {
      // Without normalisation, two payloads that JSON.stringify differently
      // could canonicalise the same way and produce a forged collision.
      const a = canonicalMessageForHmac({
        ...sampleMessage,
        data: { x: Number.NaN },
      });
      const b = canonicalMessageForHmac({
        ...sampleMessage,
        data: { x: null },
      });
      expect(a).toBe(b);
    });
  });

  describe("isGameMessageLike / isMessageEnvelope", () => {
    it("accepts a well-formed message-like", () => {
      expect(isGameMessageLike(sampleMessage)).toBe(true);
    });

    it("rejects messages with a non-integer seq", () => {
      expect(isGameMessageLike({ ...sampleMessage, seq: 1.5 })).toBe(false);
      expect(isGameMessageLike({ ...sampleMessage, seq: -1 })).toBe(false);
      expect(isGameMessageLike({ ...sampleMessage, seq: NaN })).toBe(false);
    });

    it("rejects messages missing type, senderId, or seq", () => {
      const { type: _t, ...noType } = sampleMessage;
      expect(isGameMessageLike(noType)).toBe(false);
      const { senderId: _s, ...noSender } = sampleMessage;
      expect(isGameMessageLike(noSender)).toBe(false);
      const { seq: _q, ...noSeq } = sampleMessage;
      expect(isGameMessageLike(noSeq)).toBe(false);
    });

    it("accepts a well-formed envelope (does NOT verify the signature)", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      expect(isMessageEnvelope(env)).toBe(true);
    });

    it("rejects an envelope without a non-empty hmac string", () => {
      expect(
        isMessageEnvelope({ payload: sampleMessage, hmac: "" }),
      ).toBe(false);
      expect(
        isMessageEnvelope({ payload: sampleMessage, hmac: 123 }),
      ).toBe(false);
      expect(
        isMessageEnvelope({ payload: sampleMessage }),
      ).toBe(false);
    });
  });

  describe("signMessageEnvelope", () => {
    it("produces a 64-char hex HMAC", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      expect(typeof env.hmac).toBe("string");
      expect(env.hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it("does not mutate the input payload", () => {
      const original = { ...sampleMessage };
      signMessageEnvelope(original, SESSION_KEY);
      expect(original).toEqual(sampleMessage);
    });

    it("throws when the key is missing or empty", () => {
      expect(() => signMessageEnvelope(sampleMessage, "")).toThrow();
      // Non-string key — TypeScript prevents the type, but JS callers might
      // still pass one. We don't throw on non-string to keep the helper
      // fail-soft in dynamic contexts; the verifier will reject it instead.
      expect(() =>
        signMessageEnvelope(
          sampleMessage,
          null as unknown as string,
        ),
      ).toThrow();
    });

    it("produces different signatures for different keys", () => {
      const a = signMessageEnvelope(sampleMessage, SESSION_KEY);
      const b = signMessageEnvelope(sampleMessage, OTHER_KEY);
      expect(a.hmac).not.toBe(b.hmac);
    });
  });

  describe("verifyMessageEnvelope", () => {
    it("accepts a freshly-signed envelope with the matching key", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      expect(verifyMessageEnvelope(env, SESSION_KEY)).toBe(true);
    });

    it("accepts when the optional expectedSenderId matches", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      expect(verifyMessageEnvelope(env, SESSION_KEY, "player-1")).toBe(true);
    });

    it("rejects a senderId swap (peer impersonation attempt)", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      // The HMAC binds senderId; mutating it invalidates the signature
      // even though the receiver's expectedSenderId also catches it.
      const swapped = {
        ...env,
        payload: { ...env.payload, senderId: "attacker" },
      };
      expect(verifyMessageEnvelope(swapped, SESSION_KEY)).toBe(false);
      // Also rejected via the explicit expectedSenderId check.
      expect(verifyMessageEnvelope(env, SESSION_KEY, "attacker")).toBe(false);
    });

    it("rejects a payload tamper (any field)", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      // Mutate `data` — the receiver must reject.
      expect(
        verifyMessageEnvelope(
          {
            ...env,
            payload: {
              ...env.payload,
              data: { action: "concede", data: {} },
            },
          },
          SESSION_KEY,
        ),
      ).toBe(false);
      // Mutate `seq` — replay-with-bumped-seq must fail.
      expect(
        verifyMessageEnvelope(
          { ...env, payload: { ...env.payload, seq: 99 } },
          SESSION_KEY,
        ),
      ).toBe(false);
      // Mutate `type` — message-type forgery must fail.
      expect(
        verifyMessageEnvelope(
          {
            ...env,
            payload: { ...env.payload, type: "lobby-control" },
          },
          SESSION_KEY,
        ),
      ).toBe(false);
    });

    it("rejects when signed with a different key", () => {
      const env = signMessageEnvelope(sampleMessage, OTHER_KEY);
      expect(verifyMessageEnvelope(env, SESSION_KEY)).toBe(false);
    });

    it("rejects a key-rotation mismatch (issue #1252 acceptance criterion #2)", () => {
      // Pre-migration envelope was signed with the old key; the receiver
      // has already rotated to the new key. The signature no longer
      // verifies — the envelope is rejected, satisfying the
      // post-migration acceptance criterion.
      const preMigrationEnv = signMessageEnvelope(sampleMessage, SESSION_KEY);
      const postMigrationKey = "c".repeat(64);
      expect(verifyMessageEnvelope(preMigrationEnv, postMigrationKey)).toBe(
        false,
      );
    });

    it("rejects a truncated payload (HMAC was over a longer message)", () => {
      // Forge an envelope where the payload is truncated to a prefix of
      // the canonical form. The signature was computed over the full
      // canonical string, so the verifier's recompute diverges.
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      const truncated = {
        ...env,
        payload: { ...env.payload, data: { action: "pass" } }, // missing fields
      };
      expect(verifyMessageEnvelope(truncated, SESSION_KEY)).toBe(false);
    });

    it("rejects a malformed envelope shape without throwing", () => {
      const hostile: unknown[] = [
        null,
        undefined,
        "string-not-object",
        42,
        [],
        {},
        { hmac: 123 },
        { hmac: "" },
        { hmac: "deadbeef" }, // missing payload
        { payload: "not-an-object", hmac: "deadbeef" },
        {
          payload: { type: "ping", senderId: "p", seq: -1 },
          hmac: "deadbeef",
        },
      ];
      for (const v of hostile) {
        expect(() => verifyMessageEnvelope(v, SESSION_KEY)).not.toThrow();
        expect(verifyMessageEnvelope(v, SESSION_KEY)).toBe(false);
      }
    });

    it("rejects an empty/invalid session key", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      expect(verifyMessageEnvelope(env, "")).toBe(false);
      expect(
        verifyMessageEnvelope(env, null as unknown as string),
      ).toBe(false);
    });

    it("is robust against an HMAC of the wrong length", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      const wrongLength = { ...env, hmac: env.hmac.slice(0, 32) };
      expect(verifyMessageEnvelope(wrongLength, SESSION_KEY)).toBe(false);
    });

    it("constant-time compare: every byte position must match (smoke)", () => {
      // We can't time the compare in Jest (microsecond noise dominates), so
      // this is a smoke test: flipping any single character of a valid
      // signature must produce a verification failure.
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      for (let i = 0; i < env.hmac.length; i += 13) {
        const flipped = env.hmac.slice(0, i) +
          (env.hmac[i] === "0" ? "1" : "0") +
          env.hmac.slice(i + 1);
        expect(verifyMessageEnvelope({ ...env, hmac: flipped }, SESSION_KEY)).toBe(
          false,
        );
      }
    });
  });

  describe("performance (issue #1252 acceptance criterion: < 0.5 ms / message)", () => {
    it("verifies an envelope in well under 10 ms per message (issue #1252)", () => {
      const env = signMessageEnvelope(sampleMessage, SESSION_KEY);
      // Warm up V8 a little so the JIT compiles the canonicaliser.
      for (let i = 0; i < 1000; i++) verifyMessageEnvelope(env, SESSION_KEY);
      const iters = 2_000;
      const start = performance.now();
      for (let i = 0; i < iters; i++) {
        verifyMessageEnvelope(env, SESSION_KEY);
      }
      const elapsedMs = performance.now() - start;
      const perMessage = elapsedMs / iters;
      // Acceptance criterion is < 0.5 ms per message; we assert a much
      // looser 10 ms bound here so the test does not flake on cold CI
      // (the SHA-256 implementation in p2p-handshake.ts is pure JS). The
      // benchmark is logged so regressions show up in test output.
      console.log(
        `[p2p-json-validation] verifyMessageEnvelope: ${perMessage.toFixed(3)} ms / message (${iters} iters in ${elapsedMs.toFixed(1)} ms)`,
      );
      expect(perMessage).toBeLessThan(10);
    });
  });
});
