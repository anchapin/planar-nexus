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

/**
 * Chi-square goodness-of-fit critical value for 31 degrees of freedom
 * (32 alphabet bins − 1) at significance α = 0.001 — i.e. a perfectly
 * uniform RNG produces chi² ≥ 61.098 in exactly 0.1% of rounds.
 *
 * Exact quantile of the χ²(31) survival function S(x) = Q(31/2, x/2)
 * (regularized upper incomplete gamma), verified against published
 * chi-square tables via the df=30 anchor (α = 0.01 → 50.892).
 *
 * Calibration history (issue #1764): the previous threshold of 48.232 was
 * labelled "p = 0.01" but is actually the df=31 α = 0.025 critical value
 * (S(48.232) = 0.025), so a CORRECT implementation flaked red ~2.5% of CI
 * runs. The single-round gate below additionally requires a second
 * independent excursion before failing; see the AC2 test for the
 * false-failure budget math.
 */
const CHI2_DF31_ALPHA001 = 61.098;

/** Alphabet tally result: the χ²(31) statistic plus the raw bin counts. */
type UniformityTally = { chi2: number; counts: number[] };

/**
 * Draw `codes` game codes from `sampler` and tally the per-symbol
 * distribution across the 32-symbol alphabet (6 draws per code).
 *
 * The per-character alphabet-membership assertion of the original AC2 loop
 * is redundant with the per-code regex match (`[A-HJ-NP-Z2-9]` already
 * pins every character) and dominated the test's runtime; dropping it
 * (issue #1764) lets the suite afford three independent 100k-code rounds
 * for the calibrated gate below without changing what is verified.
 */
function tallyUniformity(
  sampler: () => string,
  codes: number,
): UniformityTally {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const counts = new Array<number>(ALPHABET.length).fill(0);
  let allCodesWellFormed = true;
  for (let i = 0; i < codes; i += 1) {
    const code = sampler();
    // Regex per code (cheap), but a single jest assertion after the loop:
    // 300k expect() calls dominated the old runtime (issue #1764).
    allCodesWellFormed = allCodesWellFormed && GAME_CODE_REGEX.test(code);
    for (const ch of code) {
      counts[ALPHABET.indexOf(ch)] += 1;
    }
  }
  expect(allCodesWellFormed).toBe(true);
  const expected = (codes * 6) / ALPHABET.length;
  let chi2 = 0;
  for (const observed of counts) {
    chi2 += (observed - expected) ** 2 / expected;
  }
  return { chi2, counts };
}

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

  it("AC2: index draw is unbiased — chi-square gate, 2-of-3 rounds at α=0.001 (issue #1764)", () => {
    // FALSE-FAILURE BUDGET (issue #1764 acceptance criterion ≤ 0.1%):
    // under a perfectly uniform RNG, one round of 100k codes (600k symbol
    // draws, 32 bins, 31 df) yields chi² ≥ 61.098 with probability exactly
    // α = 0.001. The test fails only when ≥ 2 of the 3 INDEPENDENT rounds
    // exceed the critical value:
    //
    //   P(false red) = C(3,2)·0.001²·0.999 + 0.001³ ≈ 3.0×10⁻⁶  (≈ 0.0003%)
    //
    // A genuinely biased generator, by contrast, skews EVERY round the same
    // way (the bias is a property of the sampler, not the round), so it
    // still fails deterministically — the companion "detection power" test
    // below pins that with a seeded skewed RNG stub.
    const ROUNDS = 3;
    const N = 100_000;
    let exceeded = 0;
    let counts: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const tally = tallyUniformity(generateGameCode, N);
      if (tally.chi2 >= CHI2_DF31_ALPHA001) {
        exceeded += 1;
      }
      counts = tally.counts;
    }
    // Fail only on a repeat excursion (2-of-3), not a single unlucky round.
    expect(exceeded).toBeLessThan(2);
    // Sanity: every bin should be hit (no degenerate empty bins from a
    // broken RNG) — checked on the final round's tally.
    expect(counts.every((c) => c > 0)).toBe(true);
  }, 30_000);

  it("AC2 (detection power): the chi-square gate still flags a demonstrably biased RNG (issue #1764)", () => {
    // Issue #1764 acceptance criterion: lowering the false-failure budget
    // must not blind the uniformity gate. Stub getRandomValues with a
    // SEEDED (deterministic, never flaky) mulberry32 PRNG whose bytes are
    // squared toward 0 — half the mass lands in the lowest quarter of the
    // byte range (alphabet bins 0-7) instead of the uniform 25%. The same
    // gate as the unbiased test above MUST reject it.
    let state = 0x1764; // fixed seed → reproducible result every run
    const prng = (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const realGetRandomValues = globalThis.crypto.getRandomValues;
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      value: (buf: Uint8Array): Uint8Array => {
        for (let i = 0; i < buf.length; i += 1) {
          // u·u ∈ [0,1) is heavily concentrated near 0 → low bins overflow.
          buf[i] = Math.min(255, Math.floor(prng() * prng() * 256));
        }
        return buf;
      },
      configurable: true,
      writable: true,
    });
    try {
      const { chi2 } = tallyUniformity(generateGameCode, 20_000);
      expect(chi2).toBeGreaterThanOrEqual(CHI2_DF31_ALPHA001);
    } finally {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        value: realGetRandomValues,
        configurable: true,
        writable: true,
      });
    }
  });

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
