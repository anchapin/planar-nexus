/**
 * @fileoverview Tests for the retired signaling route (issue #1730).
 *
 * The session-store endpoints (create / join / offer / answer /
 * ice-candidate / poll / close) must answer 410 Gone with a JSON body
 * naming the replacement (`src/lib/p2p-direct-connection.ts`), and must
 * NEVER answer 200. The `generateGameCode` CSPRNG suite from issue #1568
 * is preserved verbatim — the function is still exported as the canonical
 * sampling pattern.
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { describe, it, expect } from "@jest/globals";

// ---- Functional Response polyfill ------------------------------------------

class TestResponse {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly ok: boolean;
  constructor(body?: unknown, init: ResponseInit = {}) {
    this.body = body ?? null;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "OK";
    this.headers = init.headers
      ? new Headers(init.headers as HeadersInit)
      : new Headers();
    this.ok = this.status >= 200 && this.status < 300;
  }
  static json(data: unknown, init: ResponseInit = {}): TestResponse {
    return new TestResponse(JSON.stringify(data), {
      status: init.status,
      statusText: init.statusText,
      headers: {
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }
  async text(): Promise<string> {
    if (typeof this.body === "string") return this.body;
    if (this.body == null) return "";
    return String(this.body);
  }
  async json(): Promise<unknown> {
    const text = await this.text();
    if (!text) return null;
    return JSON.parse(text);
  }
}

(globalThis as unknown as { Response: unknown }).Response = TestResponse;

// Route is imported AFTER the polyfill is installed (see top-of-file note).
import { GET, POST, DELETE, generateGameCode } from "../route";

// ----------------------------------------------------------------------------
// 410 Gone — retired session-store API (issue #1730)
// ----------------------------------------------------------------------------

describe("GET /api/signaling — retired, answers 410 Gone", () => {
  it("returns 410 (never 200) even for well-formed polls", async () => {
    const res = await GET();
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deprecated).toBe(true);
    expect(String(body.replacement)).toContain("p2p-direct-connection.ts");
  });
});

describe("POST /api/signaling — retired, answers 410 Gone", () => {
  it.each(["create", "join", "offer", "answer", "ice-candidate", "close"])(
    "returns 410 (never 200) for message type %s",
    async (type) => {
      const res = await POST();
      expect(res.status).toBe(410);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.deprecated).toBe(true);
      expect(String(body.replacement)).toContain("p2p-direct-connection.ts");
      expect(type).toBeDefined(); // message types enumerate the retired verbs
    },
  );
});

describe("DELETE /api/signaling — retired, answers 410 Gone", () => {
  it("returns 410 (never 200) even with a sessionId", async () => {
    const res = await DELETE();
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deprecated).toBe(true);
    expect(String(body.replacement)).toContain("p2p-direct-connection.ts");
  });
});

describe("regression — no session-store verb returns 200", () => {
  it("GET, POST, and DELETE all answer non-200 (410)", async () => {
    for (const handler of [GET, POST, DELETE]) {
      const res = await handler();
      expect(res.status).not.toBe(200);
      expect(res.status).toBe(410);
    }
  });
});

const GAME_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

describe("generateGameCode — cryptographic randomness (issue #1568)", () => {
  it("AC3: produces 6-char codes drawn only from the allowed alphabet", () => {
    for (let i = 0; i < 1000; i += 1) {
      const code = generateGameCode();
      expect(code).toMatch(GAME_CODE_REGEX);
      expect(code).toHaveLength(6);
      // Ambiguous characters MUST stay excluded.
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("AC1 (anti-regression): Math.random is not used to draw code symbols", () => {
    // If the function silently fell back to Math.random, forcing
    // Math.random to return 0 would produce "AAAAAA" on every call.
    const savedRandom = Math.random;
    Math.random = () => 0;
    try {
      const code = generateGameCode();
      expect(code).not.toBe("AAAAAA");
      expect(code).toMatch(GAME_CODE_REGEX);
    } finally {
      Math.random = savedRandom;
    }
  });

  it("AC2: index draw is unbiased — chi-square p > 0.01 over 100k codes", () => {
    const N = 100_000;
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    // Each code contributes 6 independent draws, so the tally is over
    // 600k uniform samples on 32 bins.
    const counts = new Array<number>(ALPHABET.length).fill(0);
    for (let i = 0; i < N; i += 1) {
      const code = generateGameCode();
      expect(code).toMatch(GAME_CODE_REGEX);
      for (const ch of code) {
        const idx = ALPHABET.indexOf(ch);
        expect(idx).toBeGreaterThanOrEqual(0);
        counts[idx] += 1;
      }
    }
    const expected = (N * 6) / ALPHABET.length; // 18_750
    let chi2 = 0;
    for (const observed of counts) {
      chi2 += (observed - expected) ** 2 / expected;
    }
    // 31 degrees of freedom (32 bins - 1). Critical value at p = 0.01 is
    // 48.232. A truly uniform distribution has chi2 ≈ 31 ± √(2·31).
    expect(chi2).toBeLessThan(48.232);
    // Sanity: every bin should be hit (no degenerate empty bins from a
    // broken RNG).
    expect(counts.every((c) => c > 0)).toBe(true);
  }, 30_000);

  it("AC5: throws a descriptive error when globalThis.crypto is unavailable", () => {
    // In modern Node globalThis.crypto is a configurable accessor, so
    // delete works to simulate an environment without Web Crypto API
    // (e.g. a stripped-down SSR runtime).
    const realCrypto = globalThis.crypto;
    // @ts-expect-error — intentionally remove crypto to exercise the guard
    delete globalThis.crypto;
    try {
      expect(() => generateGameCode()).toThrow(/crypto\.getRandomValues/);
      expect(() => generateGameCode()).toThrow(/issue #1568/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: realCrypto,
        configurable: true,
        writable: true,
      });
    }
  });

  it("AC5: throws when crypto exists but lacks getRandomValues", () => {
    const realGetRandomValues = globalThis.crypto.getRandomValues;
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(() => generateGameCode()).toThrow(/getRandomValues/);
    } finally {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        value: realGetRandomValues,
        configurable: true,
        writable: true,
      });
    }
  });
});
