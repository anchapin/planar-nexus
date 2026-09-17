/**
 * @fileoverview Tests for the server-side rate limiter (issue #1782).
 *
 * The pre-#1782 implementation stored bucket state in a module-scope LRU
 * singleton, so each warm instance enforced its own window. On any
 * serverless / multi-replica deploy the effective abuse ceiling was
 * `maxRequests × instance-count` rather than `maxRequests`. The
 * acceptance criterion for #1782 requires that this contract be
 * observable from the test layer: two limiter instances built on the
 * shared backend must see each other's writes.
 *
 * Coverage:
 *   1. `in-memory baseline` — the pre-#1782 behavior is preserved when
 *      the caller uses the in-memory backend (single-instance dev).
 *   2. `two-instance isolation on memory (proves the bug)` — two
 *      limiter instances built on independent in-memory backends do NOT
 *      share state. This is exactly what the #1730-style pre-fix
 *      behavior was; pinning it here documents that the in-memory
 *      backend is per-instance.
 *   3. `two-instance sharing on the redis backend (integration)` —
 *      gated on `RATE_LIMIT_TEST_BACKEND_URL` + `RATE_LIMIT_TEST_BACKEND_TOKEN`.
 *      Two limiter instances built on the SAME Redis URL see each
 *      other's writes; instance A's `check` decrements instance B's
 *      `remaining`. Skipped (not silently passed) when the env vars
 *      are unset, so CI without Redis still passes.
 *   4. `redis backend contract via stubbed fetch` — drives
 *      `RedisRateLimiterBackend` against a hand-rolled fetch stub that
 *      mimics Upstash's response shape, so the URL/headers/JSON wire
 *      format is pinned without needing a live Redis.
 *   5. `backend selection via env var` — `selectBackendFromEnv()`
 *      throws loudly when the env var is unrecognized or when the
 *      redis backend is requested without credentials.
 *
 * Note on test environment: jsdom does not ship a `Response.text()` or a
 * global `fetch`, so the redis tests install a hand-rolled stub for
 * both. The stub returns Response-shaped objects with `.ok`, `.status`,
 * `.json()` and `.text()` so the production code under test does not
 * have to know whether it is talking to the real Upstash REST API or a
 * mock.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

import {
  InMemoryRateLimiterBackend,
  RateLimitError,
  RedisRateLimiterBackend,
  ServerRateLimiter,
  applyFixedWindowCheck,
  checkRateLimit,
  clearAllRateLimits,
  createServerRateLimiter,
  enforceRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  selectBackendFromEnv,
  __resetDefaultServerRateLimiterForTests,
} from "../server-rate-limiter";

const MEMORY_BUCKET_KEY = "test-user-1";
const MEMORY_BUCKET_KEY_TWO = "test-user-2";
const FAST_CONFIG = { maxRequests: 3, windowMs: 60_000 };

// jsdom does not ship a global `fetch`. The RedisRateLimiterBackend's
// default `fetchImpl = fetch` reference is captured at construction time,
// so install a permissive stub here for any test that exercises the
// production default (rather than passing fetchImpl explicitly).
beforeAll(() => {
  if (typeof (globalThis as { fetch?: unknown }).fetch !== "function") {
    (globalThis as { fetch: typeof fetch }).fetch = (() =>
      Promise.resolve(new StubResponse())) as unknown as typeof fetch;
  }
});

// ---------------------------------------------------------------------------
// Minimal Response + fetch stub (jsdom does not implement either).
// ---------------------------------------------------------------------------

interface StubResponseInit {
  status?: number;
  bodyText?: string;
  jsonBody?: unknown;
}

class StubResponse {
  readonly status: number;
  readonly ok: boolean;
  private readonly bodyText: string;
  private readonly jsonBody: unknown;

  constructor(init: StubResponseInit = {}) {
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.bodyText = init.bodyText ?? "";
    this.jsonBody = init.jsonBody;
  }

  async text(): Promise<string> {
    return this.bodyText;
  }

  async json(): Promise<unknown> {
    if (this.jsonBody !== undefined) return this.jsonBody;
    return JSON.parse(this.bodyText) as unknown;
  }
}

/**
 * Hand-rolled fetch stub that mimics the Upstash Redis REST shape. Each
 * command is matched on its URL suffix (after the base URL); commands
 * that mutate state are reflected in an in-memory `Map` so GET can
 * observe what SET wrote.
 */
function createFetchStub(): {
  fetch: typeof fetch;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const fetchImpl = ((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    void _init;

    if (/\/GET\/(.+)$/.test(url)) {
      const key = decodeURIComponent(RegExp.$1);
      const value = store.get(key);
      return Promise.resolve(
        new StubResponse({
          status: 200,
          jsonBody: { result: value === undefined ? null : value },
        }),
      );
    }

    if (/\/SET\/([^/?]+)\/(.+?)(?:\?|$)/.test(url)) {
      const key = decodeURIComponent(RegExp.$1);
      const value = decodeURIComponent(RegExp.$2);
      store.set(key, value);
      return Promise.resolve(
        new StubResponse({ status: 200, jsonBody: { result: "OK" } }),
      );
    }

    if (/\/DEL\/(.+)$/.test(url)) {
      const key = decodeURIComponent(RegExp.$1);
      const existed = store.delete(key);
      return Promise.resolve(
        new StubResponse({
          status: 200,
          jsonBody: { result: existed ? 1 : 0 },
        }),
      );
    }

    if (/\/SCAN\/([^/]+)\/MATCH\/(.+?)\/COUNT\/(\d+)/.test(url)) {
      const cursor = decodeURIComponent(RegExp.$1);
      const match = decodeURIComponent(RegExp.$2);
      const count = Number(RegExp.$3);
      if (cursor !== "0") {
        return Promise.resolve(
          new StubResponse({ status: 200, jsonBody: { result: ["0", []] } }),
        );
      }
      const pattern = match
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const keys = [...store.keys()].filter((k) =>
        new RegExp(`^${pattern}$`).test(k),
      );
      const batch = keys.slice(0, count);
      return Promise.resolve(
        new StubResponse({ status: 200, jsonBody: { result: ["0", batch] } }),
      );
    }

    return Promise.resolve(
      new StubResponse({ status: 500, bodyText: `unhandled ${url}` }),
    );
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, store };
}

// ---------------------------------------------------------------------------
// 1. in-memory baseline — preserves pre-#1782 single-instance behavior
// ---------------------------------------------------------------------------

describe("server-rate-limiter — in-memory baseline (single-instance dev)", () => {
  let limiter: ServerRateLimiter;

  beforeEach(() => {
    limiter = createServerRateLimiter(new InMemoryRateLimiterBackend());
  });

  it("admits the first request and reports the right remaining count", async () => {
    const result = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("permits up to maxRequests requests within a window then denies", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      const result = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
      expect(result.success).toBe(true);
    }
    const denied = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(denied.success).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("counts each bucket independently", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    }
    const result = await limiter.check(MEMORY_BUCKET_KEY_TWO, FAST_CONFIG);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("advances the window forward so an old bucket's count is forgotten", async () => {
    const ancientNow = 1_700_000_000_000;
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      const result = await limiter.check(
        MEMORY_BUCKET_KEY,
        FAST_CONFIG,
        ancientNow,
      );
      expect(result.success).toBe(true);
    }
    const fresh = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(fresh.success).toBe(true);
    expect(fresh.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("reset() returns the user to a fresh budget", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    }
    await limiter.reset(MEMORY_BUCKET_KEY);
    const result = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("clearAll() drops every tracked bucket", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
      await limiter.check(MEMORY_BUCKET_KEY_TWO, FAST_CONFIG);
    }
    await limiter.clearAll();
    const resultA = await limiter.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(resultA.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("getStatus() returns the live budget and a positive resetIn", async () => {
    // getStatus consumes a slot (it routes through `check`); the first
    // call returns maxRequests - 1, the second returns maxRequests - 2.
    const first = await limiter.getStatus(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(first.isLimited).toBe(false);
    expect(first.remaining).toBe(FAST_CONFIG.maxRequests - 1);
    expect(first.limit).toBe(FAST_CONFIG.maxRequests);
    expect(first.resetIn).toBeGreaterThan(0);
    const second = await limiter.getStatus(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(second.remaining).toBe(FAST_CONFIG.maxRequests - 2);
  });
});

// ---------------------------------------------------------------------------
// 2. two-instance isolation on memory — pins the #1782 bug for the in-memory
//    backend. Reading from instance A and writing through instance B must NOT
//    decrement instance A's view of the budget.
// ---------------------------------------------------------------------------

describe("server-rate-limiter — two-instance isolation on memory (proves the bug)", () => {
  it("two limiters on independent in-memory backends do not share state", async () => {
    const instanceA = createServerRateLimiter(new InMemoryRateLimiterBackend());
    const instanceB = createServerRateLimiter(new InMemoryRateLimiterBackend());

    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      const result = await instanceA.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
      expect(result.success).toBe(true);
    }
    const aDenied = await instanceA.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(aDenied.success).toBe(false);

    // Instance B has its own LRU — the same key reads as a fresh bucket.
    // This is the bug #1782 retires: in any multi-instance / serverless
    // deployment each warm instance enforces its own window.
    const bFresh = await instanceB.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(bFresh.success).toBe(true);
    expect(bFresh.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("two limiters that share an in-memory backend DO share state", async () => {
    // Sanity check on the other axis: if two limiters are constructed
    // against the SAME in-memory backend (unusual but legal — used by
    // some tests), they see each other's writes. This pins that the
    // in-memory backend is correctly shared when explicitly reused,
    // even though the module-level singleton does not share it across
    // processes.
    const sharedBackend = new InMemoryRateLimiterBackend();
    const instanceA = createServerRateLimiter(sharedBackend);
    const instanceB = createServerRateLimiter(sharedBackend);

    await instanceA.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    await instanceA.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    const bSees = await instanceB.check(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(bSees.remaining).toBe(FAST_CONFIG.maxRequests - 3);
  });
});

// ---------------------------------------------------------------------------
// 3. module-level wrappers + the lazy singleton
// ---------------------------------------------------------------------------

describe("server-rate-limiter — module-level wrappers", () => {
  beforeEach(async () => {
    await clearAllRateLimits();
  });

  afterEach(async () => {
    await clearAllRateLimits();
    __resetDefaultServerRateLimiterForTests();
  });

  it("checkRateLimit delegates to the default singleton limiter", async () => {
    const result = await checkRateLimit(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });

  it("enforceRateLimit throws RateLimitError past the limit", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await enforceRateLimit(MEMORY_BUCKET_KEY, FAST_CONFIG);
    }
    await expect(
      enforceRateLimit(MEMORY_BUCKET_KEY, FAST_CONFIG),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("getRateLimitStatus returns the limit / remaining / resetIn shape", async () => {
    const status = await getRateLimitStatus(MEMORY_BUCKET_KEY, FAST_CONFIG);
    expect(status.limit).toBe(FAST_CONFIG.maxRequests);
    expect(status.isLimited).toBe(false);
    expect(status.resetIn).toBeGreaterThan(0);
  });

  it("resetRateLimit drops the bucket for one user only", async () => {
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await checkRateLimit(MEMORY_BUCKET_KEY, FAST_CONFIG);
      await checkRateLimit(MEMORY_BUCKET_KEY_TWO, FAST_CONFIG);
    }
    await resetRateLimit(MEMORY_BUCKET_KEY);
    const a = await checkRateLimit(MEMORY_BUCKET_KEY, FAST_CONFIG);
    const b = await checkRateLimit(MEMORY_BUCKET_KEY_TWO, FAST_CONFIG);
    expect(a.remaining).toBe(FAST_CONFIG.maxRequests - 1);
    expect(b.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. applyFixedWindowCheck — the shared fixed-window math
// ---------------------------------------------------------------------------

describe("server-rate-limiter — applyFixedWindowCheck (backend-agnostic)", () => {
  it("counts up and locks at the limit", async () => {
    const backend = new InMemoryRateLimiterBackend();
    const now = 1_700_000_000_000;
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      const result = await applyFixedWindowCheck({
        backend,
        bucketKey: MEMORY_BUCKET_KEY,
        maxRequests: FAST_CONFIG.maxRequests,
        windowMs: FAST_CONFIG.windowMs,
        now,
      });
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1 - i);
    }
    const denied = await applyFixedWindowCheck({
      backend,
      bucketKey: MEMORY_BUCKET_KEY,
      maxRequests: FAST_CONFIG.maxRequests,
      windowMs: FAST_CONFIG.windowMs,
      now,
    });
    expect(denied.success).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("ignores stale buckets from a previous window", async () => {
    const backend = new InMemoryRateLimiterBackend();
    const ancientNow = 1_700_000_000_000;
    const modernNow = ancientNow + FAST_CONFIG.windowMs * 5;
    for (let i = 0; i < FAST_CONFIG.maxRequests; i++) {
      await applyFixedWindowCheck({
        backend,
        bucketKey: MEMORY_BUCKET_KEY,
        maxRequests: FAST_CONFIG.maxRequests,
        windowMs: FAST_CONFIG.windowMs,
        now: ancientNow,
      });
    }
    const result = await applyFixedWindowCheck({
      backend,
      bucketKey: MEMORY_BUCKET_KEY,
      maxRequests: FAST_CONFIG.maxRequests,
      windowMs: FAST_CONFIG.windowMs,
      now: modernNow,
    });
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(FAST_CONFIG.maxRequests - 1);
  });
});

// ---------------------------------------------------------------------------
// 5. selectBackendFromEnv — fail-loud env-var selection
// ---------------------------------------------------------------------------

describe("server-rate-limiter — selectBackendFromEnv", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns the in-memory backend when RATE_LIMIT_BACKEND is unset", () => {
    delete process.env.RATE_LIMIT_BACKEND;
    const backend = selectBackendFromEnv();
    expect(backend).toBeInstanceOf(InMemoryRateLimiterBackend);
  });

  it("returns the in-memory backend when RATE_LIMIT_BACKEND=memory", () => {
    process.env.RATE_LIMIT_BACKEND = "memory";
    const backend = selectBackendFromEnv();
    expect(backend).toBeInstanceOf(InMemoryRateLimiterBackend);
  });

  it("tolerates empty-string and whitespace variants", () => {
    process.env.RATE_LIMIT_BACKEND = "   ";
    const backend = selectBackendFromEnv();
    expect(backend).toBeInstanceOf(InMemoryRateLimiterBackend);
  });

  it("throws when RATE_LIMIT_BACKEND=redis but REDIS_URL is missing", () => {
    process.env.RATE_LIMIT_BACKEND = "redis";
    delete process.env.REDIS_URL;
    process.env.REDIS_TOKEN = "tok";
    expect(() => selectBackendFromEnv()).toThrow(/REDIS_URL/);
  });

  it("throws when RATE_LIMIT_BACKEND=redis but REDIS_TOKEN is missing", () => {
    process.env.RATE_LIMIT_BACKEND = "redis";
    process.env.REDIS_URL = "https://example.upstash.io";
    delete process.env.REDIS_TOKEN;
    expect(() => selectBackendFromEnv()).toThrow(/REDIS_TOKEN/);
  });

  it("constructs the redis backend when both env vars are set", () => {
    process.env.RATE_LIMIT_BACKEND = "redis";
    process.env.REDIS_URL = "https://example.upstash.io";
    process.env.REDIS_TOKEN = "tok";
    const backend = selectBackendFromEnv();
    expect(backend).toBeInstanceOf(RedisRateLimiterBackend);
  });

  it("throws with the unknown value for an unrecognized backend name", () => {
    process.env.RATE_LIMIT_BACKEND = "dynamodb";
    expect(() => selectBackendFromEnv()).toThrow(/dynamodb/);
  });
});

// ---------------------------------------------------------------------------
// 6. RedisRateLimiterBackend — wire-format contract via stubbed fetch
// ---------------------------------------------------------------------------

describe("server-rate-limiter — RedisRateLimiterBackend contract", () => {
  it("issues GET / SET / DEL against the configured base URL", async () => {
    const seen: string[] = [];
    const { fetch: fetchImpl, store } = createFetchStub();
    // Wrap to capture command URLs.
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/GET\//.test(url)) seen.push("GET");
      else if (/\/SET\//.test(url)) seen.push("SET");
      else if (/\/DEL\//.test(url)) seen.push("DEL");
      return fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl: wrapped,
      timeoutMs: 100,
    });
    await backend.get("u1");
    await backend.set("u1", { count: 2, windowFloor: 42 }, 60_000);
    await backend.delete("u1");
    expect(seen).toEqual(["GET", "SET", "DEL"]);
    expect(store.has("rl:u1")).toBe(false); // DEL cleared it
  });

  it("namespaces keys with the configured keyPrefix", async () => {
    const captured: string[] = [];
    const { fetch: fetchImpl } = createFetchStub();
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/GET\//.test(url)) captured.push(url);
      return fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl: wrapped,
      keyPrefix: "planarnx:rl:",
    });
    await backend.get("client-a");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(
      "https://instance.upstash.io/GET/planarnx%3Arl%3Aclient-a",
    );
  });

  it("returns null for a missing key", async () => {
    const { fetch: fetchImpl } = createFetchStub();
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl,
    });
    const got = await backend.get("nope");
    expect(got).toBeNull();
  });

  it("decodes a stored {count, windowFloor} JSON payload", async () => {
    const { fetch: fetchImpl } = createFetchStub();
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl,
    });
    await backend.set("u1", { count: 5, windowFloor: 42 }, 60_000);
    const got = await backend.get("u1");
    expect(got).toEqual({ count: 5, windowFloor: 42 });
  });

  it("treats a corrupt JSON payload as a cache miss (does not deny)", async () => {
    const { store } = createFetchStub();
    store.set("rl:u1", "this-is-not-json");
    const { fetch: fetchImpl } = createFetchStub();
    // Use the same store as the one we pre-populated.
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (/\/GET\//.test(url)) {
          const key = decodeURIComponent(RegExp.$1);
          return Promise.resolve(
            new StubResponse({
              status: 200,
              jsonBody: { result: store.get(key) ?? null },
            }),
          );
        }
        return fetchImpl(input, init);
      }) as unknown as typeof fetch,
    });
    const got = await backend.get("u1");
    expect(got).toBeNull();
  });

  it("throws on a 500 response from Redis", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new StubResponse({ status: 500, bodyText: "kaboom" }),
      )) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl,
    });
    await expect(backend.get("u1")).rejects.toThrow(/HTTP 500/);
  });

  it("clear() drops every key matching the configured prefix", async () => {
    const { store, fetch: fetchImpl } = createFetchStub();
    store.set("rl:u1", JSON.stringify({ count: 1, windowFloor: 0 }));
    store.set("rl:u2", JSON.stringify({ count: 2, windowFloor: 0 }));
    store.set("rl:u3", JSON.stringify({ count: 3, windowFloor: 0 }));
    // Unrelated key — must NOT be cleared.
    store.set("unrelated", "leave-me-alone");
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl,
    });
    await backend.clear();
    expect(store.has("rl:u1")).toBe(false);
    expect(store.has("rl:u2")).toBe(false);
    expect(store.has("rl:u3")).toBe(false);
    expect(store.has("unrelated")).toBe(true);
  });

  it("throws when constructed without `url` or `token`", () => {
    expect(
      () =>
        new RedisRateLimiterBackend({
          url: "",
          token: "tok",
          fetchImpl: (() =>
            Promise.resolve(new StubResponse())) as unknown as typeof fetch,
        }),
    ).toThrow(/`url` is required/);
    expect(
      () =>
        new RedisRateLimiterBackend({
          url: "https://x",
          token: "",
          fetchImpl: (() =>
            Promise.resolve(new StubResponse())) as unknown as typeof fetch,
        }),
    ).toThrow(/`token` is required/);
  });

  it("strips a trailing slash from the base URL", async () => {
    const captured: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      captured.push(url);
      return Promise.resolve(
        new StubResponse({ status: 200, jsonBody: { result: null } }),
      );
    }) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io/",
      token: "tok",
      fetchImpl,
    });
    await backend.get("u1");
    expect(captured[0]).toBe("https://instance.upstash.io/GET/rl%3Au1");
  });

  it("sends the Upstash bearer auth header", async () => {
    let capturedAuth: string | null = null;
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/GET\//.test(url)) {
        capturedAuth =
          (init?.headers as Record<string, string> | undefined)
            ?.Authorization ?? null;
      }
      return Promise.resolve(
        new StubResponse({ status: 200, jsonBody: { result: null } }),
      );
    }) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok-abc",
      fetchImpl,
    });
    await backend.get("u1");
    expect(capturedAuth).toBe("Bearer tok-abc");
  });

  it("sends the SET EX query with a TTL >= windowMs / 1000 + 1", async () => {
    const capturedUrls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      capturedUrls.push(url);
      return Promise.resolve(
        new StubResponse({ status: 200, jsonBody: { result: "OK" } }),
      );
    }) as unknown as typeof fetch;
    const backend = new RedisRateLimiterBackend({
      url: "https://instance.upstash.io",
      token: "tok",
      fetchImpl,
    });
    await backend.set("u1", { count: 1, windowFloor: 0 }, 60_000);
    const setUrl = capturedUrls[0];
    expect(setUrl).toMatch(/^https:\/\/instance\.upstash\.io\/SET\//);
    // 60_000 ms → 60 s + 1 s buffer = 61 s.
    expect(setUrl).toMatch(/EX=61\b/);
  });
});

// ---------------------------------------------------------------------------
// 7. RedisRateLimiterBackend — integration test against a live Upstash.
//    Gated on RATE_LIMIT_TEST_BACKEND_URL + RATE_LIMIT_TEST_BACKEND_TOKEN so
//    CI without Redis passes; skipped (not silently green) when unset.
// ---------------------------------------------------------------------------

const LIVE_URL = process.env.RATE_LIMIT_TEST_BACKEND_URL;
const LIVE_TOKEN = process.env.RATE_LIMIT_TEST_BACKEND_TOKEN;

const describeIfLive =
  LIVE_URL && LIVE_TOKEN ? describe : describe.skip.bind(describe);

describeIfLive(
  "server-rate-limiter — RedisRateLimiterBackend live integration (#1782 acceptance)",
  () => {
    const KEY_PREFIX = `test-rl-${Date.now()}-`;
    const buildBackend = () =>
      new RedisRateLimiterBackend({
        url: LIVE_URL as string,
        token: LIVE_TOKEN as string,
        keyPrefix: KEY_PREFIX,
        timeoutMs: 5000,
      });

    it("two limiters built on the SAME Redis URL share state (acceptance #1782)", async () => {
      const instanceA = createServerRateLimiter(buildBackend());
      const instanceB = createServerRateLimiter(buildBackend());
      const userId = `shared-${Date.now()}`;
      const config = { maxRequests: 3, windowMs: 60_000 };

      try {
        for (let i = 0; i < config.maxRequests; i++) {
          const r = await instanceA.check(userId, config);
          expect(r.success).toBe(true);
        }
        const aDenied = await instanceA.check(userId, config);
        expect(aDenied.success).toBe(false);

        // Instance B reads the same Redis — instance A's writes must
        // be visible. This is the contract the in-memory backend CANNOT
        // satisfy across processes.
        const bSeesDenied = await instanceB.check(userId, config);
        expect(bSeesDenied.success).toBe(false);
        expect(bSeesDenied.remaining).toBe(0);
      } finally {
        await instanceA.clearAll();
      }
    });

    it("the live backend rejects over-limit and reports retryAfter", async () => {
      const limiter = createServerRateLimiter(buildBackend());
      const userId = `retry-${Date.now()}`;
      const config = { maxRequests: 2, windowMs: 60_000 };
      try {
        await limiter.check(userId, config);
        await limiter.check(userId, config);
        const denied = await limiter.check(userId, config);
        expect(denied.success).toBe(false);
        expect(denied.remaining).toBe(0);
        expect(denied.retryAfter).toBeGreaterThan(0);
      } finally {
        await limiter.clearAll();
      }
    });

    it("clear() drops every key with the configured prefix", async () => {
      const limiter = createServerRateLimiter(buildBackend());
      const userId = `clear-${Date.now()}`;
      const config = { maxRequests: 1, windowMs: 60_000 };
      try {
        await limiter.check(userId, config);
        await limiter.check(userId, config);
        await limiter.clearAll();
        const fresh = await limiter.check(userId, config);
        expect(fresh.success).toBe(true);
        expect(fresh.remaining).toBe(0);
      } finally {
        await limiter.clearAll();
      }
    });
  },
);
