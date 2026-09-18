/**
 * Tests for src/lib/game-code-generator.ts
 *
 * Issue #1906 — contract: `generateGameCode()` must HARD-FAIL when
 * `crypto.getRandomValues` is unavailable. A silent `Math.random()`
 * fallback is non-uniform and predictable; TURN/TURN-credential peers
 * could brute-force candidate codes. Mirrors the canonical contract in
 * `src/app/api/signaling/route.ts` (issue #1568).
 */

import { describe, it, expect, afterEach, jest } from "@jest/globals";
import {
  generateGameCode,
  generateLobbyId,
  generatePlayerId,
  formatGameCode,
  isValidGameCode,
  normalizeGameCode,
} from "../game-code-generator";

describe("generateGameCode — issue #1906 CSPRNG contract", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
      writable: true,
    });
  });

  it("returns a 6-character code drawn from the unambiguous alphabet", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 50; i++) {
      const code = generateGameCode();
      expect(code).toHaveLength(6);
      for (const ch of code) {
        expect(allowed.includes(ch)).toBe(true);
      }
    }
  });

  it("THROWS the typed error when globalThis.crypto is undefined (issue #1906)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(() => generateGameCode()).toThrow(/crypto\.getRandomValues/);
    expect(() => generateGameCode()).toThrow(/issue #1906/);
  });

  it("THROWS when crypto exists but lacks getRandomValues (issue #1906)", () => {
    const realGetRandomValues = globalThis.crypto.getRandomValues;
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(() => generateGameCode()).toThrow(/crypto\.getRandomValues/);
    } finally {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        value: realGetRandomValues,
        configurable: true,
        writable: true,
      });
    }
  });

  it("does not silently fall back to Math.random (issue #1906)", () => {
    const realRandom = Math.random;
    const randomSpy = jest.fn(() => 0.5);
    Math.random = randomSpy;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(() => generateGameCode()).toThrow();
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      Math.random = realRandom;
    }
  });
});

describe("generateLobbyId / generatePlayerId — non-security identifiers", () => {
  it('generateLobbyId returns a string with the "lobby_" prefix', () => {
    const id = generateLobbyId();
    expect(id.startsWith("lobby_")).toBe(true);
    expect(id.length).toBeGreaterThan("lobby_".length);
  });

  it('generatePlayerId returns a string with the "player_" prefix', () => {
    const id = generatePlayerId();
    expect(id.startsWith("player_")).toBe(true);
    expect(id.length).toBeGreaterThan("player_".length);
  });
});

describe("formatGameCode / isValidGameCode / normalizeGameCode", () => {
  it("formatGameCode inserts a hyphen at index 3", () => {
    expect(formatGameCode("ABCDEF")).toBe("ABC-DEF");
  });

  it("formatGameCode is a no-op for non-6-char inputs", () => {
    expect(formatGameCode("AB")).toBe("AB");
  });

  it("isValidGameCode accepts hyphenated or plain valid codes", () => {
    expect(isValidGameCode("ABCDEF")).toBe(true);
    expect(isValidGameCode("abc-def")).toBe(true);
    expect(isValidGameCode("IL0O1")).toBe(false);
    expect(isValidGameCode("SHORT")).toBe(false);
  });

  it("normalizeGameCode strips hyphens and uppercases", () => {
    expect(normalizeGameCode("abc-def")).toBe("ABCDEF");
  });
});
