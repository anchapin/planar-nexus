/**
 * Server-Side Rate Limiting
 *
 * Issue #522: Implement server-side API key validation and proxy for AI calls.
 * Issue #1782: Back the limiter with a shared store so it works correctly in
 * any multi-instance / serverless deployment.
 *
 * The {@link checkRateLimit} / {@link enforceRateLimit} / {@link getRateLimitStatus}
 * surface is preserved (callers in `/api/ai-proxy`, `/api/chat`, and
 * `/api/chat/coach` keep working without modification). What changed is the
 * storage: the limiter is now a {@link ServerRateLimiter} that delegates
 * per-key bucket state to a pluggable {@link RateLimiterBackend}. Two
 * implementations ship in-tree:
 *
 *   - {@link InMemoryRateLimiterBackend} — module-scope `LRUCache` (the
 *     pre-#1782 behavior). Single-instance dev default; the effective abuse
 *     ceiling on multi-instance / serverless deploys is `maxRequests *
 *     instance-count`, not `maxRequests`. Not safe for production traffic.
 *   - {@link RedisRateLimiterBackend} — Upstash Redis HTTP REST, fixed-window
 *     via `INCR` + `EXPIRE`. The atomic counter lives in a shared KV store,
 *     so every warm instance enforces the same window. Selected via
 *     `RATE_LIMIT_BACKEND=redis` plus `REDIS_URL` + `REDIS_TOKEN`.
 *
 * Backend selection happens lazily on the first call into the singleton
 * (`defaultServerRateLimiter`). Tests that never trigger a real limit check
 * never trip the Redis constructor.
 */

import { LRUCache } from "lru-cache";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  message?: string;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: parseInt(process.env.AI_RATE_LIMIT_MAX || "100", 10),
  windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || "60000", 10),
  message: "Rate limit exceeded. Please try again later.",
};

/**
 * Per-key bucket state stored by a {@link RateLimiterBackend}.
 *
 * Fixed-window semantics: each window of length `windowMs` owns an isolated
 * counter keyed by `(bucketKey, windowFloor)`. When `windowFloor` advances,
 * the backend sees a new key and starts a fresh count — there is no carry-over
 * between windows, which is the simplest atomic primitive the shared Redis
 * backend can implement (one `INCR` + first-hit `EXPIRE`).
 *
 * `windowFloor` is `Math.floor(now / windowMs)`. Storing it alongside the
 * counter lets the limiter compute `resetAt = (windowFloor + 1) * windowMs`
 * without re-deriving it from the bucket key on every read.
 */
export interface RateLimitBucket {
  count: number;
  windowFloor: number;
}

/**
 * Storage backend interface for rate-limit bucket state.
 *
 * The contract is intentionally narrow: a backend is a thin key/value store
 * keyed on a string `bucketKey` (the caller-supplied user identifier, hashed
 * or prefixed however the implementation chooses). All window-flooring logic
 * lives in {@link ServerRateLimiter}; the backend never sees `windowMs` or
 * `Date.now()`, so a stub backend used in tests cannot drift from the
 * production window math.
 *
 * The limiter's abuse-control guarantee depends entirely on this contract
 * being shared across every process enforcing the same limit — that is the
 * point of issue #1782. An implementation whose writes are not visible to
 * other processes (a local `Map`, a local file) is per-instance and offers
 * no protection against request-storm amplification across replicas.
 */
export interface RateLimiterBackend {
  /**
   * Read the current bucket for `bucketKey`, or `null` when no window is
   * open. Returns the most-recently-written state; concurrent writers may
   * race, which is acceptable for an upper-bound counter.
   */
  get(bucketKey: string): Promise<RateLimitBucket | null>;

  /**
   * Persist `bucket` as the current state for `bucketKey`. Implementations
   * are expected to attach their own TTL so idle keys eventually disappear.
   */
  set(bucketKey: string, bucket: RateLimitBucket, ttlMs: number): Promise<void>;

  /**
   * Drop the bucket for `bucketKey` (used by {@link resetRateLimit}). A
   * backend with no per-key concept returns without effect.
   */
  delete(bucketKey: string): Promise<void>;

  /**
   * Drop every rate-limit bucket tracked by this backend. Used by the
   * consumer-route tests to reset state between cases; not on a production
   * hot path.
   */
  clear(): Promise<void>;
}

/**
 * Module-scope LRU-backed implementation of {@link RateLimiterBackend}.
 *
 * Preserves the pre-#1782 storage shape (an `LRUCache`) but only stores the
 * integer counter + window floor rather than a timestamp array. The LRU's
 * built-in TTL (`2 × windowMs`) keeps idle buckets from leaking memory.
 */
export class InMemoryRateLimiterBackend implements RateLimiterBackend {
  private readonly cache: LRUCache<string, RateLimitBucket>;

  constructor(maxSize: number = 10000) {
    this.cache = new LRUCache({
      max: maxSize,
      ttl: parseInt(process.env.AI_RATE_LIMIT_TTL_MS || "300000", 10), // 5 min default
      updateAgeOnGet: true,
    });
  }

  async get(bucketKey: string): Promise<RateLimitBucket | null> {
    return this.cache.get(bucketKey) ?? null;
  }

  async set(
    bucketKey: string,
    bucket: RateLimitBucket,
    _ttlMs: number,
  ): Promise<void> {
    this.cache.set(bucketKey, bucket);
  }

  async delete(bucketKey: string): Promise<void> {
    this.cache.delete(bucketKey);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Test/diagnostics hook. Exposed so the test suite can confirm the
   * per-instance LRU actually has the buckets it claims to (and is not
   * secretly sharing state via module reload).
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Options for {@link RedisRateLimiterBackend}.
 *
 * The backend speaks the Upstash Redis HTTP REST contract — a single
 * `fetch()` per primitive against `<baseUrl>/<COMMAND>/<args>?<query>`.
 * That keeps the dep cost at zero (no `ioredis`, no `@upstash/ratelimit`)
 * and is the same primitive Cloudflare Workers and Vercel Edge functions
 * reach for when they need a KV primitive from outside Node.
 */
export interface RedisRateLimiterBackendOptions {
  /** Upstash REST base URL, e.g. `https://my-instance.upstash.io`. */
  url: string;
  /** Upstash REST read/write token. */
  token: string;
  /**
   * Optional fetch implementation override. Tests stub this; production
   * code lets Node's global `fetch` (Node ≥18) handle the request.
   */
  fetchImpl?: typeof fetch;
  /**
   * Per-request timeout in ms. Default 1000. A Redis timeout MUST throw —
   * failing closed (denying the request) is the abuse-control-safe
   * behavior; failing open would silently lift the rate limit.
   */
  timeoutMs?: number;
  /**
   * Key prefix. Default `rl:`. The clear() SCAN match glob uses the same
   * prefix, so changing this without also wiring the clear pattern will
   * leave stale keys behind.
   */
  keyPrefix?: string;
}

/**
 * Response shape returned by the Upstash REST API. The `result` field
 * carries the command's native return value (`null` for GET misses,
 * `string` for SET/GET hits, an integer-shaped string for INCR, a
 * `[cursor, keys[]]` tuple for SCAN, etc.).
 */
interface UpstashResponse<T> {
  result: T;
}

/**
 * Cap on SCAN iterations in {@link RedisRateLimiterBackend.clear}. A
 * hostile or misconfigured Redis that keeps returning new cursors cannot
 * pin the test runner indefinitely.
 */
const MAX_SCAN_ITERATIONS = 1000;

/**
 * Shared Redis backend for the rate limiter — issue #1782.
 *
 * Encodes a fixed-window counter per bucket key as a single Redis string
 * holding `{ count, windowFloor }` JSON, with a TTL slightly longer than
 * the window so an idle bucket self-evicts. Every primitive goes over
 * the Upstash HTTP REST API (one `fetch()` per call) so the runtime
 * footprint is zero deps — there is no `ioredis`/`@upstash/ratelimit`
 * pulled in for what amounts to `GET` + `SET … EX` + `DEL`.
 *
 * Atomicity: a fixed-window has no read-modify-write race because the
 * `ServerRateLimiter` reads the bucket, decides, then writes the new
 * count — concurrent writers from different instances can race by one
 * request, which is the standard tradeoff for distributed rate limiters
 * and is well within the abuse-control envelope.
 */
export class RedisRateLimiterBackend implements RateLimiterBackend {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimiterBackendOptions) {
    if (!options.url) {
      throw new Error(
        "RedisRateLimiterBackend: `url` is required (Upstash REST base URL).",
      );
    }
    if (!options.token) {
      throw new Error(
        "RedisRateLimiterBackend: `token` is required (Upstash REST token).",
      );
    }
    this.baseUrl = options.url.replace(/\/$/, "");
    this.authHeader = `Bearer ${options.token}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 1000;
    this.keyPrefix = options.keyPrefix ?? "rl:";
  }

  /**
   * Build the Redis-side key for a caller-supplied bucket key. The
   * `rl:` prefix namespaces the limiter away from any other KV
   * usage the same Upstash database might serve.
   */
  private buildKey(bucketKey: string): string {
    return `${this.keyPrefix}${bucketKey}`;
  }

  async get(bucketKey: string): Promise<RateLimitBucket | null> {
    const key = this.buildKey(bucketKey);
    const url = `${this.baseUrl}/GET/${encodeURIComponent(key)}`;
    const response = await this.request(url);
    // Upstash REST returns 200 with `result: null` for a missing key;
    // some Upstash tiers return 404 for missing GETs — handle both.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw await this.commandError("GET", response);
    }
    const body = (await response.json()) as UpstashResponse<string | null>;
    if (body.result == null) return null;
    try {
      const parsed = JSON.parse(body.result) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { count?: unknown }).count === "number" &&
        typeof (parsed as { windowFloor?: unknown }).windowFloor === "number"
      ) {
        return parsed as RateLimitBucket;
      }
      return null;
    } catch {
      // Corrupt payload — treat as miss so the caller starts a fresh
      // window rather than denying on bad state.
      return null;
    }
  }

  async set(
    bucketKey: string,
    bucket: RateLimitBucket,
    ttlMs: number,
  ): Promise<void> {
    const key = this.buildKey(bucketKey);
    const value = encodeURIComponent(JSON.stringify(bucket));
    // Round up + buffer of 1s so the key does not expire mid-window under
    // a network roundtrip that eats into the last 100ms.
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000) + 1);
    const url = `${this.baseUrl}/SET/${encodeURIComponent(key)}/${value}?EX=${ttlSeconds}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw await this.commandError("SET", response);
    }
  }

  async delete(bucketKey: string): Promise<void> {
    const key = this.buildKey(bucketKey);
    const url = `${this.baseUrl}/DEL/${encodeURIComponent(key)}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw await this.commandError("DEL", response);
    }
  }

  /**
   * Drop every rate-limit bucket tracked by this backend. Cursor-scan
   * with the configured key prefix; capped at {@link MAX_SCAN_ITERATIONS}
   * iterations to bound pathological cases. Only invoked from tests
   * (`clearAllRateLimits` is not on any production hot path).
   */
  async clear(): Promise<void> {
    const matchPattern = `${this.keyPrefix}*`;
    let cursor = "0";
    let iterations = 0;
    do {
      const url = `${this.baseUrl}/SCAN/${encodeURIComponent(
        cursor,
      )}/MATCH/${encodeURIComponent(matchPattern)}/COUNT/100`;
      const response = await this.request(url);
      if (!response.ok) {
        throw await this.commandError("SCAN", response);
      }
      const body = (await response.json()) as UpstashResponse<
        [string, string[]]
      >;
      cursor = body.result[0];
      const keys = body.result[1] ?? [];
      for (const key of keys) {
        const delUrl = `${this.baseUrl}/DEL/${encodeURIComponent(key)}`;
        const delResponse = await this.request(delUrl);
        if (!delResponse.ok) {
          throw await this.commandError("DEL", delResponse);
        }
      }
      iterations++;
    } while (cursor !== "0" && iterations < MAX_SCAN_ITERATIONS);
  }

  private async request(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: this.authHeader },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async commandError(
    command: string,
    response: Response,
  ): Promise<Error> {
    const text = await response.text().catch(() => "");
    return new Error(
      `RedisRateLimiterBackend: ${command} failed with HTTP ${response.status}: ${text}`,
    );
  }
}

/**
 * The fixed-window counter logic shared by every {@link RateLimiterBackend}
 * implementation.
 *
 * Given a {@link ServerRateLimiter}'s configured backend, the supplied
 * `bucketKey`, the desired `maxRequests` / `windowMs`, and the current
 * `now`, return the rate-limit decision for one inbound request AND, when
 * the request fits, persist the new counter value via the backend.
 *
 * The backend interface is async (Redis / KV clients are async), so the
 * limiter is too — callers that previously used a synchronous `checkRateLimit`
 * now `await` it. The top-level {@link checkRateLimit} wrapper handles the
 * `await` internally so callers that do not care about the promise can
 * remain synchronous in spirit.
 */
export async function applyFixedWindowCheck(args: {
  backend: RateLimiterBackend;
  bucketKey: string;
  maxRequests: number;
  windowMs: number;
  now: number;
}): Promise<RateLimitResult> {
  const { backend, bucketKey, maxRequests, windowMs, now } = args;
  const windowFloor = Math.floor(now / windowMs);
  const current = await backend.get(bucketKey);
  const existingCount =
    current && current.windowFloor === windowFloor ? current.count : 0;
  const resetAt = (windowFloor + 1) * windowMs;

  if (existingCount >= maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return {
      success: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  await backend.set(
    bucketKey,
    { count: existingCount + 1, windowFloor },
    windowMs,
  );
  return {
    success: true,
    remaining: Math.max(0, maxRequests - existingCount - 1),
    resetAt,
  };
}

/**
 * A {@link ServerRateLimiter} wraps a {@link RateLimiterBackend} with the
 * {@link RateLimitConfig}-aware policy that the previous module-scope
 * `checkRateLimit` exported directly. Constructed via
 * {@link createServerRateLimiter}; the module-level {@link checkRateLimit}
 * uses {@link defaultServerRateLimiter}.
 */
export class ServerRateLimiter {
  constructor(private readonly backend: RateLimiterBackend) {}

  /** @returns the configured backend (mostly useful for tests). */
  getBackend(): RateLimiterBackend {
    return this.backend;
  }

  async check(
    userId: string,
    config: RateLimitConfig = DEFAULT_RATE_LIMIT,
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    return applyFixedWindowCheck({
      backend: this.backend,
      bucketKey: userId,
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      now,
    });
  }

  async getStatus(
    userId: string,
    config: RateLimitConfig = DEFAULT_RATE_LIMIT,
    now: number = Date.now(),
  ): Promise<{
    remaining: number;
    limit: number;
    resetIn: number;
    isLimited: boolean;
  }> {
    const result = await this.check(userId, config, now);
    return {
      remaining: result.remaining,
      limit: config.maxRequests,
      resetIn: Math.max(0, result.resetAt - now),
      isLimited: !result.success,
    };
  }

  async reset(userId: string): Promise<void> {
    await this.backend.delete(userId);
  }

  async clearAll(): Promise<void> {
    await this.backend.clear();
  }
}

/**
 * Build a {@link ServerRateLimiter} backed by the requested storage backend.
 *
 * Selection rules (issue #1782):
 *   - `RATE_LIMIT_BACKEND` unset / `"memory"` → {@link InMemoryRateLimiterBackend}
 *     (single-instance dev default; NOT safe for production multi-instance).
 *   - `RATE_LIMIT_BACKEND=redis` → {@link RedisRateLimiterBackend} configured
 *     from `REDIS_URL` + `REDIS_TOKEN`. Throws at construction time if either
 *     is missing so a misconfigured deploy fails loud rather than silently
 *     regressing to per-instance limiting.
 *
 * Selection is lazy (deferred until the first `check` call) so test files
 * that import the module without ever invoking the limiter do not crash on
 * a missing Redis env var.
 */
export function createServerRateLimiter(
  backend?: RateLimiterBackend,
): ServerRateLimiter {
  return new ServerRateLimiter(backend ?? selectBackendFromEnv());
}

/**
 * Detect if running in a serverless / multi-instance environment.
 *
 * Issue #2114: InMemoryRateLimiterBackend is per-process — in a multi-instance
 * serverless deploy each warm instance enforces its own window and the aggregate
 * abuse ceiling is maxRequests × instance-count. This is "failing open": the rate
 * limiter appears to work but provides no meaningful abuse control.
 *
 * We detect serverless via known deployment platform env vars. If the platform
 * is detected and no Redis backend is configured, we throw at construction time
 * rather than silently weakening the rate-limit guarantee.
 *
 * @internal
 */
function isServerlessEnvironment(): boolean {
  return (
    // Vercel (also sets VERTIGON_URL for serverless functions)
    !!process.env.VERCEL ||
    // AWS Lambda / ECS / Fargate
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    // Google Cloud Functions / Cloud Run
    !!process.env.FUNCTION_NAME ||
    // Azure Functions
    !!process.env.WEBSITE_FUNCTIONS ||
    // Cloudflare Workers
    !!process.env.CF_ID ||
    // Railway / Render / Fly.io (detect via general indicators)
    (!!process.env.RAILWAY_ENVIRONMENT && !!process.env.RAILWAY_STATIC_URL) ||
    !!process.env.RENDER ||
    !!process.env.FLY_APP_NAME
  );
}

/**
 * Pick a {@link RateLimiterBackend} based on `process.env.RATE_LIMIT_BACKEND`.
 *
 * Recognized values:
 *   - unset / `"memory"` / `""` → {@link InMemoryRateLimiterBackend}.
 *     THROWS in serverless environments (issue #2114) because InMemory
 *     fails open in multi-instance deployments.
 *   - `"redis"` → {@link RedisRateLimiterBackend} from `REDIS_URL` +
 *     `REDIS_TOKEN`. Throws if either is missing.
 *   - anything else → throws with the unrecognized value in the message.
 *
 * The throw-at-construction contract is the point: a misconfigured
 * multi-instance deploy MUST fail loud. A silent fallback to in-memory
 * would re-introduce the very bug #1782 retires — a state of "limits
 * appear to work in dev, fail open in production".
 *
 * @internal
 */
export function selectBackendFromEnv(): RateLimiterBackend {
  const raw = process.env.RATE_LIMIT_BACKEND;
  const backend = (raw ?? "memory").trim().toLowerCase();
  if (backend === "" || backend === "memory") {
    if (isServerlessEnvironment()) {
      throw new Error(
        "RATE_LIMIT_BACKEND=memory cannot be used in a serverless " +
          "multi-instance deployment (rate limiter would fail open). " +
          "Set RATE_LIMIT_BACKEND=redis with REDIS_URL and REDIS_TOKEN, " +
          "or deploy to a single-instance environment. " +
          "See docs/SECURITY.md for the deployment matrix.",
      );
    }
    return new InMemoryRateLimiterBackend();
  }
  if (backend === "redis") {
    const url = process.env.REDIS_URL;
    const token = process.env.REDIS_TOKEN;
    if (!url || !token) {
      throw new Error(
        "RATE_LIMIT_BACKEND=redis requires both REDIS_URL and REDIS_TOKEN " +
          "to be set. See docs/SECURITY.md for the deployment matrix.",
      );
    }
    return new RedisRateLimiterBackend({ url, token });
  }
  throw new Error(
    `Unknown RATE_LIMIT_BACKEND: "${raw}". Supported values: "memory", "redis".`,
  );
}

/** Lazily-constructed singleton used by the module-level wrappers below. */
let _defaultServerRateLimiter: ServerRateLimiter | undefined;
function getDefaultServerRateLimiter(): ServerRateLimiter {
  if (!_defaultServerRateLimiter) {
    _defaultServerRateLimiter = createServerRateLimiter();
  }
  return _defaultServerRateLimiter;
}

/**
 * Reset the default singleton to a fresh in-memory instance.
 *
 * Only used by tests that need to clear module-scope state between cases
 * without touching the real backing store. Not exported as part of the
 * supported public API — production code should never swap the singleton.
 *
 * @internal
 */
export function __resetDefaultServerRateLimiterForTests(): void {
  _defaultServerRateLimiter = undefined;
}

/**
 * Check rate limit for a user. Synchronous-shaped wrapper around
 * {@link ServerRateLimiter.check}; returns the resolved result.
 */
export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now?: number,
): Promise<RateLimitResult> {
  return getDefaultServerRateLimiter().check(userId, config, now);
}

/**
 * Enforce rate limit and throw {@link RateLimitError} if exceeded.
 */
export async function enforceRateLimit(
  userId: string,
  config?: RateLimitConfig,
  now?: number,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(userId, config, now);

  if (!result.success) {
    throw new RateLimitError(
      config?.message || "Rate limit exceeded",
      result.retryAfter || 0,
      result.remaining,
    );
  }

  return result;
}

/**
 * Rate limit error class
 */
export class RateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly remaining: number;
  public readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(
    message: string,
    retryAfterMs: number,
    remainingRequests: number,
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfterMs;
    this.remaining = remainingRequests;
  }
}

/**
 * Get rate limit status for display
 */
export async function getRateLimitStatus(
  userId: string,
  config?: RateLimitConfig,
  now?: number,
): Promise<{
  remaining: number;
  limit: number;
  resetIn: number;
  isLimited: boolean;
}> {
  return getDefaultServerRateLimiter().getStatus(userId, config, now);
}

/**
 * Reset rate limit for a user.
 */
export async function resetRateLimit(userId: string): Promise<void> {
  await getDefaultServerRateLimiter().reset(userId);
}

/**
 * Clear all rate limit data. Intended for test setup/teardown; not part of
 * any production hot path.
 */
export async function clearAllRateLimits(): Promise<void> {
  await getDefaultServerRateLimiter().clearAll();
}

/**
 * Create rate limit headers for response. Pure function; unchanged by the
 * #1782 backend refactor.
 */
export function getRateLimitHeaders(
  result: RateLimitResult,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": config.maxRequests.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.resetAt.toString(),
    ...(result.retryAfter && {
      "Retry-After": result.retryAfter.toString(),
    }),
  };
}
