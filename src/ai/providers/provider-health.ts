/**
 * @fileOverview Server-only in-memory provider health tracker for the coach
 * streaming failover path (issue #1418).
 *
 * Records transient failures per provider and applies short exponential
 * cooldowns so a provider that just timed out, rate-limited, or failed model
 * setup is NOT retried on every new coach turn. This removes the "static
 * failover chain" latency penalty called out in the issue and avoids
 * worsening rate-limit pressure on a provider that is already throttling.
 *
 * Health state is:
 *   - **Bounded**: at most {@link MAX_ENTRIES} providers tracked; the oldest
 *     entry is evicted when the cap is exceeded, so memory is predictable
 *     across long-running desktop/web sessions.
 *   - **Self-expiring**: entries are dropped lazily once their cooldown
 *     elapses (see {@link ProviderHealthTracker.prune}), so a recovered
 *     provider restarts its backoff at the base the next time it fails.
 *   - **Server-only**: this module is imported only by the coach stream
 *     orchestrator, which the SSE API route uses server-side. Provider error
 *     details are never leaked to clients — only the bounded
 *     {@link ProviderFailureReason} enum travels inside the `failover` SSE
 *     event, and only when a provider is *skipped* (never the raw error).
 *   - **Process-local**: lives in module scope, intentionally shared across
 *     coach turns so the cooldown memory survives between requests.
 *
 * ## Cooldown schedule
 *
 * `cooldownMs(n) = min(capMs, baseMs * factor^(n-1))` where `n` is the
 * consecutive failure count for that provider.
 *
 * | reason                       | baseMs | capMs  | factor | 1st / 2nd / 3rd / 4th |
 * | ---------------------------- | ------ | ------ | ------ | -------------------- |
 * | `rate-limit`                 | 2_000  | 60_000 | 2      | 2s / 4s / 8s / 16s   |
 * | `timeout`                    | 1_000  | 30_000 | 2      | 1s / 2s / 4s / 8s    |
 * | `model-setup`                | 1_000  | 30_000 | 2      | 1s / 2s / 4s / 8s    |
 * | `stream-before-first-token`  | 1_000  | 30_000 | 2      | 1s / 2s / 4s / 8s    |
 *
 * Rate-limit uses a longer base (2s) and higher cap (60s) than the other
 * transient classes because retrying into a throttled provider both wastes
 * the user's first-token latency budget and actively worsens the rate limit
 * (the original bug). Setup / timeout / stream-start failures get a lighter
 * penalty — they are typically transient and we want a fast recovery.
 */

/**
 * The bounded set of transient failure classes the coach stream records.
 *
 * The SSE `failover` event carries these only when a provider is skipped
 * because of a recent failure (as `cooldownReason`); raw upstream errors are
 * never exposed to the client.
 */
export type ProviderFailureReason =
  "rate-limit" | "timeout" | "model-setup" | "stream-before-first-token";

/** Per-reason exponential-backoff parameters (see module docstring). */
interface CooldownSchedule {
  baseMs: number;
  capMs: number;
  factor: number;
}

const COOLDOWN_SCHEDULE: Record<ProviderFailureReason, CooldownSchedule> = {
  "rate-limit": { baseMs: 2_000, capMs: 60_000, factor: 2 },
  timeout: { baseMs: 1_000, capMs: 30_000, factor: 2 },
  "model-setup": { baseMs: 1_000, capMs: 30_000, factor: 2 },
  "stream-before-first-token": { baseMs: 1_000, capMs: 30_000, factor: 2 },
};

/**
 * Maximum number of provider entries kept in memory. Bounds long-running
 * sessions; the actual provider space is ~5 (`openai|anthropic|google|zaic|
 * custom`), so this cap is generous while still preventing unbounded growth
 * if arbitrary provider names are ever pushed through the chain.
 */
export const MAX_ENTRIES = 32;

/**
 * Compute the cooldown duration for the `n`-th consecutive failure of a given
 * reason. Exported for unit testing; not part of the public tracker API.
 *
 * @param reason bounded failure class
 * @param failureCount 1-based consecutive failure count for this provider
 */
export function cooldownFor(
  reason: ProviderFailureReason,
  failureCount: number,
): number {
  const { baseMs, capMs, factor } = COOLDOWN_SCHEDULE[reason];
  const n = Math.max(1, Math.floor(failureCount));
  // n-1 exponent so the first failure (n=1) yields baseMs (factor^0 = 1).
  const grown = baseMs * factor ** (n - 1);
  return Math.min(grown, capMs);
}

/** Internal mutable record; {@link ProviderHealthSnapshot} is the read view. */
interface ProviderHealthEntry {
  failureCount: number;
  lastFailureAt: number;
  lastFailureReason: ProviderFailureReason;
  cooldownUntil: number;
}

/**
 * Read-only view of a provider's health. Returned by {@link
 * ProviderHealthTracker.snapshot} for telemetry/tests; never sent to the
 * client verbatim.
 */
export interface ProviderHealthSnapshot extends ProviderHealthEntry {
  provider: string;
}

/**
 * In-memory, bounded, server-only provider health tracker.
 *
 * One process-wide instance is exported as {@link providerHealth}; tests
 * either inject a fresh `new ProviderHealthTracker()` via the coach stream's
 * `healthTracker` seam or call {@link ProviderHealthTracker.clear} on the
 * singleton in `beforeEach`.
 */
export class ProviderHealthTracker {
  private readonly entries = new Map<string, ProviderHealthEntry>();

  /** Number of providers currently tracked (bounded by {@link MAX_ENTRIES}). */
  size(): number {
    return this.entries.size;
  }

  /** Remove all entries. Intended for test reset. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Drop entries whose cooldown has elapsed. Called on every read so a
   * recovered provider is treated as fresh (next failure restarts the
   * backoff at the base). Cheap: O(tracked) and tracked is bounded.
   */
  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.cooldownUntil <= now) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Enforce {@link MAX_ENTRIES} by evicting the oldest entry (Map preserves
   * insertion order). Called after every insert.
   */
  private enforceBound(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /**
   * Record a transient failure for `provider`. Bumps the consecutive failure
   * count and recomputes the cooldown using the exponential schedule for
   * `reason`. Re-inserts the entry at the tail of insertion order so LRU
   * eviction prefers keeping recently-touched providers.
   */
  recordFailure(
    provider: string,
    reason: ProviderFailureReason,
    now: number = Date.now(),
  ): ProviderHealthSnapshot {
    const existing = this.entries.get(provider);
    const failureCount = existing ? existing.failureCount + 1 : 1;
    const cooldownMs = cooldownFor(reason, failureCount);
    const entry: ProviderHealthEntry = {
      failureCount,
      lastFailureAt: now,
      lastFailureReason: reason,
      cooldownUntil: now + cooldownMs,
    };
    // Delete + set so the provider moves to the tail of insertion order
    // (LRU semantics for `enforceBound`).
    this.entries.delete(provider);
    this.entries.set(provider, entry);
    this.enforceBound();
    return { provider, ...entry };
  }

  /**
   * Mark `provider` as healthy again by dropping its entry. Called when a
   * coach stream from this provider completes successfully (#1418:
   * "Successful completion clears the provider/model cooldown entry").
   */
  recordSuccess(provider: string): void {
    this.entries.delete(provider);
  }

  /**
   * Whether `provider` may be attempted right now. `true` when there is no
   * entry (never failed, or cooldown elapsed and was pruned) or when the
   * recorded cooldown is in the past.
   */
  isHealthy(provider: string, now: number = Date.now()): boolean {
    this.prune(now);
    const entry = this.entries.get(provider);
    if (!entry) return true;
    return entry.cooldownUntil <= now;
  }

  /**
   * Milliseconds remaining in the current cooldown for `provider`. `0` when
   * the provider is healthy.
   */
  cooldownRemaining(provider: string, now: number = Date.now()): number {
    this.prune(now);
    const entry = this.entries.get(provider);
    if (!entry) return 0;
    return Math.max(0, entry.cooldownUntil - now);
  }

  /**
   * Read-only view of the provider's current health, or `undefined` when no
   * entry exists. Prunes expired entries first.
   */
  snapshot(
    provider: string,
    now: number = Date.now(),
  ): ProviderHealthSnapshot | undefined {
    this.prune(now);
    const entry = this.entries.get(provider);
    if (!entry) return undefined;
    return { provider, ...entry };
  }
}

/**
 * Process-wide singleton. Module scope keeps cooldowns across coach turns
 * (the entire point of issue #1418) while staying bounded and self-expiring.
 *
 * Server-only by convention: the only importer is the coach stream
 * orchestrator (`src/ai/flows/coach-stream.ts`), which the SSE API route
 * uses server-side.
 */
export const providerHealth = new ProviderHealthTracker();
