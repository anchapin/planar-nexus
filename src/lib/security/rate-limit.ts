/**
 * @fileOverview Lightweight, dependency-free rate-limit primitives for
 * P2P / lobby / API surfaces that lack a centralized server.
 *
 * Issue #1277 extends the per-connection limiter introduced in #1111 with
 * per-peer, per-bucket limits for the signaling, lobby-browser, and
 * deck-import message handlers. Three primitives are exported here:
 *
 *   - {@link TokenBucket}           — token-bucket, smooth long-term rate
 *                                    plus burst allowance. Good for chat &
 *                                    emote paths where a small burst is OK.
 *   - {@link FixedWindowLimiter}    — fixed-window counter. Simpler than
 *                                    sliding-window; tightest bound for
 *                                    `connection-request` / `lobby-list`
 *                                    type spam where bursts must be capped.
 *   - {@link KeyedRateLimiter}      — a map from opaque peer/IP identifier
 *                                    to one of the above primitives, with
 *                                    LRU-style eviction so the map cannot
 *                                    grow unbounded under attack.
 *
 * All three are deliberately allocation-cheap (one Map / one object per
 * peer), pure JS (no Date.now() in hot paths beyond a single `now()` call
 * per acquire, with the timestamp injectable for deterministic tests), and
 * never throw on overflow — `tryAcquire` simply returns `false` so the
 * caller can drop / log / emit a typed `error` message back to the sender.
 */

export interface RateLimitOptions {
  /** Maximum number of events permitted within {@link windowMs}. */
  maxEvents: number;
  /** Length of the rate-limit window in milliseconds. */
  windowMs: number;
}

/**
 * Token-bucket rate limiter. Tokens regenerate at `maxEvents / windowMs`
 * tokens per ms, capped at `maxEvents`. Each {@link TokenBucket.tryAcquire}
 * consumes one token; while the bucket is empty, calls return `false` until
 * enough wall time has passed for the next token to accrue.
 *
 * Conceptually:
 *
 *     tokens(t) = min(maxEvents, tokens(0) + (t / windowMs) * maxEvents)
 *     tryAcquire() -> tokens(t) >= 1 ? (tokens(t) -= 1; true) : false
 */
export class TokenBucket {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private tokens: number;
  private lastRefillAt: number;

  constructor(options: RateLimitOptions, now: number = Date.now()) {
    if (options.maxEvents <= 0 || !Number.isFinite(options.maxEvents)) {
      throw new Error("TokenBucket: maxEvents must be a positive number");
    }
    if (options.windowMs <= 0 || !Number.isFinite(options.windowMs)) {
      throw new Error("TokenBucket: windowMs must be a positive number");
    }
    this.maxEvents = options.maxEvents;
    this.windowMs = options.windowMs;
    this.tokens = options.maxEvents;
    this.lastRefillAt = now;
  }

  /**
   * Refill the bucket based on wall time elapsed since the last refill, then
   * try to consume one token. Returns `true` if a token was consumed,
   * `false` if the bucket is empty. Never throws.
   */
  tryAcquire(now: number = Date.now()): boolean {
    if (now < this.lastRefillAt) {
      // Clamp backwards clock movement (NTP correction) to "no refill".
      now = this.lastRefillAt;
    }
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs > 0) {
      const regenerated = (elapsedMs / this.windowMs) * this.maxEvents;
      this.tokens = Math.min(this.maxEvents, this.tokens + regenerated);
      this.lastRefillAt = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Current token count (after the most recent acquire). Diagnostics/tests. */
  get availableTokens(): number {
    return this.tokens;
  }

  /** Drain the bucket — used by tests and on peer disconnect. */
  reset(now: number = Date.now()): void {
    this.tokens = this.maxEvents;
    this.lastRefillAt = now;
  }
}

/**
 * Fixed-window rate limiter. Counts events in non-overlapping
 * `[floor(now / windowMs), floor(now / windowMs) + 1)` buckets; once the
 * count for the current window reaches `maxEvents`, the next `tryAcquire`
 * returns `false` until the window rolls over.
 *
 * Compared to the existing sliding-window `P2PRateLimiter` from #1111, this
 * is cheaper (one `Map` per peer vs an unbounded timestamp array), gives a
 * tighter worst-case bound, and is sufficient for capping peer-driven
 * signaling traffic such as `connection-request` / `lobby-list`.
 */
export class FixedWindowLimiter {
  private readonly maxEvents: number;
  private readonly windowMs: number;
  private windowStart: number;
  private count: number;

  constructor(options: RateLimitOptions, now: number = Date.now()) {
    if (options.maxEvents <= 0 || !Number.isFinite(options.maxEvents)) {
      throw new Error(
        "FixedWindowLimiter: maxEvents must be a positive number",
      );
    }
    if (options.windowMs <= 0 || !Number.isFinite(options.windowMs)) {
      throw new Error("FixedWindowLimiter: windowMs must be a positive number");
    }
    this.maxEvents = options.maxEvents;
    this.windowMs = options.windowMs;
    this.windowStart = Math.floor(now / options.windowMs) * options.windowMs;
    this.count = 0;
  }

  /**
   * Record one event at {@link now}. Returns `true` if the event is within
   * the limit (and counted), `false` if the limit has been reached and the
   * event must be dropped. Never throws.
   */
  tryAcquire(now: number = Date.now()): boolean {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    if (windowStart !== this.windowStart) {
      this.windowStart = windowStart;
      this.count = 0;
    }
    if (this.count >= this.maxEvents) {
      return false;
    }
    this.count += 1;
    return true;
  }

  get currentCount(): number {
    return this.count;
  }

  reset(now: number = Date.now()): void {
    this.windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    this.count = 0;
  }
}

/**
 * Map a string peer/key identifier to one rate-limit primitive. The map is
 * bounded by {@link maxKeys} (oldest-insertion eviction) so a hostile
 * peer cannot manufacture fresh keys to dodge a limit by exhausting memory.
 *
 * The primitive factory is injectable so callers can choose token-bucket
 * (chat / emote) or fixed-window (control / metadata) limits per surface.
 */
export class KeyedRateLimiter<T> {
  private readonly factory: (now: number) => T;
  private readonly maxKeys: number;
  private readonly keys: Map<string, T> = new Map();
  private evictionCursor = 0;

  constructor(
    factory: (now?: number) => T,
    options: { maxKeys?: number } = {},
  ) {
    this.factory = factory as (now: number) => T;
    this.maxKeys = options.maxKeys ?? 1000;
  }

  /**
   * Look up (creating if necessary) the limiter for {@link key}, then ask it
   * to record the next event. Returns `true` if within the limit and the
   * event was accepted, `false` if the limiter refused.
   */
  tryAcquire(key: string, now: number = Date.now()): boolean {
    let limiter = this.keys.get(key);
    if (!limiter) {
      // LRU-ish eviction when the map fills with keys never re-touched.
      if (this.keys.size >= this.maxKeys) {
        const evictKey = this.keys.keys().next().value as string | undefined;
        if (evictKey !== undefined) this.keys.delete(evictKey);
        else this.keys.clear();
      }
      limiter = this.factory(now);
      this.keys.set(key, limiter);
    } else {
      // Refresh recency: delete + re-insert keeps the keys Map in LRU order.
      this.keys.delete(key);
      this.keys.set(key, limiter);
    }
    const fn = (limiter as unknown as { tryAcquire: (n: number) => boolean })
      .tryAcquire;
    return fn.call(limiter, now);
  }

  /**
   * Drop the limiter for {@link key}. Call this on peer disconnect so the
   * map cannot grow unbounded across a session.
   */
  forget(key: string): void {
    this.keys.delete(key);
  }

  /**
   * Number of distinct keys currently tracked. Diagnostics/tests.
   */
  get size(): number {
    return this.keys.size;
  }

  /** Wipe all per-key limiters. */
  clear(): void {
    this.keys.clear();
  }
}
