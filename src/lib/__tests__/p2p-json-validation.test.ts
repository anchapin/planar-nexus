/**
 * Tests for safe JSON parsing of untrusted P2P / signaling data.
 * Issue #924: unvalidated peer JSON.parse casts.
 * Issue #1111: resource-exhaustion limits (size / depth / key-count).
 */

import {
  safeParseJson,
  withinStructuralLimits,
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
      for (let i = 0; i < depth; i++) raw += "{\"a\":";
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
});
