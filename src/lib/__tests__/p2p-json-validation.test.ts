/**
 * Tests for safe JSON parsing of untrusted P2P / signaling data.
 * Issue #924: unvalidated peer JSON.parse casts.
 */

import { safeParseJson } from "../p2p-json-validation";

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
});
