/**
 * @fileOverview Per-connection rate limiter for untrusted P2P data-channel
 * messages.
 *
 * Peers join games via shared codes and are effectively anonymous, so a
 * hostile peer can flood the receive path with thousands of messages per
 * second. Each message triggers a JSON.parse and a recursive shape/structural
 * validation pass; without rate limiting this is a cheap CPU/memory
 * exhaustion vector. See issue #1111.
 *
 * This is a classic sliding-window counter scoped to a single connection
 * instance (one limiter per data channel). It complements, and is intentionally
 * separate from, the server-side AI-proxy limiter in `rate-limiter.ts` (which
 * is module-global and keyed by user id) — the P2P layer needs one independent
 * counter per peer connection, with no shared global state.
 */

/**
 * Configuration for a {@link P2PRateLimiter}.
 */
export interface P2PRateLimitOptions {
  /** Maximum number of messages permitted within {@link windowMs}. */
  maxMessages: number;
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
}

/**
 * Default per-connection rate limit. Allows up to 100 messages per second,
 * which comfortably accommodates real game traffic (5s ping cadence, state
 * syncs on each action, chat/emote bursts) while dropping a sustained flood.
 */
export const DEFAULT_P2P_RATE_LIMIT: P2PRateLimitOptions = {
  maxMessages: 100,
  windowMs: 1000,
};

/**
 * Sliding-window rate limiter for a single P2P connection.
 *
 * Call {@link tryAcquire} on every incoming message; it returns `true` if the
 * message is within the limit (and records the timestamp), or `false` if the
 * message exceeds the limit and must be dropped. The caller is responsible for
 * dropping/queueing on `false` — this limiter never throws.
 */
export class P2PRateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  /** Monotonic-ish receive timestamps currently inside the sliding window. */
  private timestamps: number[] = [];

  constructor(options?: Partial<P2PRateLimitOptions>) {
    const opts = { ...DEFAULT_P2P_RATE_LIMIT, ...options };
    if (opts.maxMessages <= 0 || !Number.isFinite(opts.maxMessages)) {
      throw new Error("P2PRateLimiter: maxMessages must be a positive number");
    }
    if (opts.windowMs <= 0 || !Number.isFinite(opts.windowMs)) {
      throw new Error("P2PRateLimiter: windowMs must be a positive number");
    }
    this.maxMessages = opts.maxMessages;
    this.windowMs = opts.windowMs;
  }

  /**
   * Attempt to record one incoming message at time {@link now}.
   *
   * @param now Optional timestamp (ms since epoch); defaults to `Date.now()`.
   *   Injected for deterministic tests.
   * @returns `true` if the message is within the rate limit (timestamp
   *   recorded), `false` if the limit has been exceeded (message should be
   *   dropped). Never throws.
   */
  tryAcquire(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    // Drop timestamps that have aged out of the window. The array is kept in
    // arrival order, so we can splice a single leading run.
    let firstInWindow = 0;
    while (
      firstInWindow < this.timestamps.length &&
      this.timestamps[firstInWindow] <= cutoff
    ) {
      firstInWindow++;
    }
    if (firstInWindow > 0) {
      this.timestamps = this.timestamps.slice(firstInWindow);
    }

    if (this.timestamps.length >= this.maxMessages) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /**
   * Number of messages recorded in the current window (after the most recent
   * acquire attempt). Mostly useful for diagnostics/tests.
   */
  get currentCount(): number {
    return this.timestamps.length;
  }

  /**
   * Reset the limiter (e.g. on connection close / reconnect).
   */
  reset(): void {
    this.timestamps = [];
  }
}
