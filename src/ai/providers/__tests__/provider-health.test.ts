/**
 * @fileoverview Unit tests for the server-only provider health tracker
 * (issue #1418).
 *
 * Covers: cooldown math (exponential growth + per-reason base/cap), reset on
 * success, lazy pruning of expired entries, and the MAX_ENTRIES bound. All
 * time-dependent behaviour is driven by `jest.useFakeTimers` so `Date.now()`
 * advances deterministically — no real wall-clock waits.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  ProviderHealthTracker,
  cooldownFor,
  MAX_ENTRIES,
  type ProviderFailureReason,
} from "../provider-health";

const REASONS: ProviderFailureReason[] = [
  "rate-limit",
  "timeout",
  "model-setup",
  "stream-before-first-token",
];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("cooldownFor — schedule", () => {
  it("uses baseMs for the first failure of each reason", () => {
    expect(cooldownFor("rate-limit", 1)).toBe(2_000);
    expect(cooldownFor("timeout", 1)).toBe(1_000);
    expect(cooldownFor("model-setup", 1)).toBe(1_000);
    expect(cooldownFor("stream-before-first-token", 1)).toBe(1_000);
  });

  it("grows exponentially with factor 2", () => {
    expect(cooldownFor("rate-limit", 2)).toBe(4_000);
    expect(cooldownFor("rate-limit", 3)).toBe(8_000);
    expect(cooldownFor("rate-limit", 4)).toBe(16_000);
    expect(cooldownFor("timeout", 2)).toBe(2_000);
    expect(cooldownFor("timeout", 3)).toBe(4_000);
    expect(cooldownFor("timeout", 4)).toBe(8_000);
  });

  it("is capped per reason (60s for rate-limit, 30s otherwise)", () => {
    expect(cooldownFor("rate-limit", 100)).toBe(60_000);
    expect(cooldownFor("timeout", 100)).toBe(30_000);
    expect(cooldownFor("model-setup", 100)).toBe(30_000);
    expect(cooldownFor("stream-before-first-token", 100)).toBe(30_000);
  });

  it("treats non-positive or non-integer counts as the first failure", () => {
    expect(cooldownFor("rate-limit", 0)).toBe(2_000);
    expect(cooldownFor("rate-limit", -3)).toBe(2_000);
    expect(cooldownFor("rate-limit", 1.9)).toBe(2_000);
  });
});

describe("ProviderHealthTracker — fresh state", () => {
  it("reports a never-seen provider as healthy with zero cooldown remaining", () => {
    const t = new ProviderHealthTracker();
    expect(t.isHealthy("openai")).toBe(true);
    expect(t.cooldownRemaining("openai")).toBe(0);
    expect(t.snapshot("openai")).toBeUndefined();
    expect(t.size()).toBe(0);
  });
});

describe("ProviderHealthTracker — recording failures", () => {
  it("marks a provider unhealthy after a rate-limit failure for the base cooldown", () => {
    const t = new ProviderHealthTracker();
    const snap = t.recordFailure("openai", "rate-limit");

    expect(snap.failureCount).toBe(1);
    expect(snap.lastFailureReason).toBe("rate-limit");
    expect(snap.cooldownUntil).toBe(Date.now() + 2_000);
    expect(t.isHealthy("openai")).toBe(false);
    expect(t.cooldownRemaining("openai")).toBe(2_000);
    expect(t.snapshot("openai")?.lastFailureReason).toBe("rate-limit");
    expect(t.size()).toBe(1);
  });

  it("grows the cooldown exponentially on consecutive failures", () => {
    const t = new ProviderHealthTracker();

    t.recordFailure("openai", "timeout");
    expect(t.cooldownRemaining("openai")).toBe(1_000);

    t.recordFailure("openai", "timeout");
    expect(t.cooldownRemaining("openai")).toBe(2_000);

    t.recordFailure("openai", "timeout");
    expect(t.cooldownRemaining("openai")).toBe(4_000);

    t.recordFailure("openai", "timeout");
    expect(t.cooldownRemaining("openai")).toBe(8_000);

    const snap = t.snapshot("openai");
    expect(snap?.failureCount).toBe(4);
    expect(snap?.lastFailureReason).toBe("timeout");
  });

  it("uses the rate-limit schedule (2s base, 60s cap) which is stricter than other reasons", () => {
    const t = new ProviderHealthTracker();
    for (let i = 0; i < 10; i++) {
      t.recordFailure("openai", "rate-limit");
    }
    // Capped at 60s even after many consecutive failures.
    expect(t.cooldownRemaining("openai")).toBe(60_000);
  });

  it("independent per-reason failure counts do not bleed — each provider tracks one count", () => {
    // recordFailure bumps the *provider's* consecutive count regardless of
    // reason, then uses the new count with the reason's own schedule. So a
    // first-time rate-limit after a timeout still uses the rate-limit base
    // with count=2 → 2s*2^1 = 4s. This documents that contract.
    const t = new ProviderHealthTracker();
    t.recordFailure("openai", "timeout"); // count=1 → 1s
    expect(t.cooldownRemaining("openai")).toBe(1_000);
    t.recordFailure("openai", "rate-limit"); // count=2 → rate-limit 2s*2^1 = 4s
    expect(t.cooldownRemaining("openai")).toBe(4_000);
  });
});

describe("ProviderHealthTracker — recovery and reset", () => {
  it("auto-prunes the entry once the cooldown elapses, making the provider healthy again", () => {
    const t = new ProviderHealthTracker();
    t.recordFailure("openai", "timeout"); // 1s cooldown
    expect(t.isHealthy("openai")).toBe(false);

    jest.advanceTimersByTime(1_000);
    // Exactly at the boundary — cooldown is over.
    expect(t.isHealthy("openai")).toBe(true);
    expect(t.snapshot("openai")).toBeUndefined();
    expect(t.size()).toBe(0);
  });

  it("restarts the backoff at the base after a pruned entry", () => {
    const t = new ProviderHealthTracker();
    t.recordFailure("openai", "rate-limit");
    t.recordFailure("openai", "rate-limit");
    expect(t.cooldownRemaining("openai")).toBe(4_000);

    // Let it fully recover.
    jest.advanceTimersByTime(10_000);
    expect(t.isHealthy("openai")).toBe(true);

    // A fresh failure starts back at the base (count=1 → 2s).
    t.recordFailure("openai", "rate-limit");
    expect(t.cooldownRemaining("openai")).toBe(2_000);
    expect(t.snapshot("openai")?.failureCount).toBe(1);
  });

  it("recordSuccess clears the entry even mid-cooldown", () => {
    const t = new ProviderHealthTracker();
    t.recordFailure("openai", "rate-limit");
    t.recordFailure("openai", "rate-limit");
    expect(t.isHealthy("openai")).toBe(false);

    t.recordSuccess("openai");
    expect(t.isHealthy("openai")).toBe(true);
    expect(t.snapshot("openai")).toBeUndefined();
    expect(t.size()).toBe(0);
  });

  it("cooldownRemaining strictly decreases as time advances and hits 0 at the boundary", () => {
    const t = new ProviderHealthTracker();
    t.recordFailure("openai", "timeout"); // 1s

    jest.advanceTimersByTime(300);
    expect(t.cooldownRemaining("openai")).toBe(700);
    jest.advanceTimersByTime(300);
    expect(t.cooldownRemaining("openai")).toBe(400);
    jest.advanceTimersByTime(400);
    expect(t.cooldownRemaining("openai")).toBe(0);
  });

  it("recordSuccess is a no-op for an unknown provider", () => {
    const t = new ProviderHealthTracker();
    expect(() => t.recordSuccess("openai")).not.toThrow();
    expect(t.size()).toBe(0);
  });
});

describe("ProviderHealthTracker — bounded state", () => {
  it("evicts the oldest entry once MAX_ENTRIES is exceeded", () => {
    const t = new ProviderHealthTracker();
    // Insert MAX_ENTRIES distinct providers, then one more.
    for (let i = 0; i < MAX_ENTRIES; i++) {
      t.recordFailure(`p${i}`, "timeout");
    }
    expect(t.size()).toBe(MAX_ENTRIES);
    expect(t.isHealthy("p0")).toBe(false);

    // One more → oldest (p0) is evicted.
    t.recordFailure(`p${MAX_ENTRIES}`, "timeout");
    expect(t.size()).toBe(MAX_ENTRIES);
    expect(t.snapshot("p0")).toBeUndefined();
    expect(t.isHealthy("p0")).toBe(true); // no longer tracked
    expect(t.isHealthy(`p${MAX_ENTRIES}`)).toBe(false);
  });

  it("re-recording an existing provider does not grow the entry count", () => {
    const t = new ProviderHealthTracker();
    for (let i = 0; i < 10; i++) {
      t.recordFailure("openai", "rate-limit");
    }
    expect(t.size()).toBe(1);
    expect(t.snapshot("openai")?.failureCount).toBe(10);
  });

  it("each reason type can be recorded and looked up", () => {
    const t = new ProviderHealthTracker();
    for (const reason of REASONS) {
      t.recordFailure(`prov-${reason}`, reason);
    }
    expect(t.size()).toBe(REASONS.length);
    for (const reason of REASONS) {
      expect(t.snapshot(`prov-${reason}`)?.lastFailureReason).toBe(reason);
    }
  });
});

describe("ProviderHealthTracker — explicit now override", () => {
  it("accepts an explicit timestamp for deterministic cooldown math", () => {
    const t = new ProviderHealthTracker();
    const snap = t.recordFailure("openai", "rate-limit", 10_000);
    expect(snap.lastFailureAt).toBe(10_000);
    expect(snap.cooldownUntil).toBe(12_000);

    // Just before the boundary → still unhealthy.
    expect(t.isHealthy("openai", 11_999)).toBe(false);
    expect(t.cooldownRemaining("openai", 11_999)).toBe(1);
    // At the boundary → healthy and pruned.
    expect(t.isHealthy("openai", 12_000)).toBe(true);
  });
});
