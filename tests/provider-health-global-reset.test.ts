/**
 * @jest-environment node
 *
 * Regression pin for issue #2364: the global beforeEach in jest.setup.js must
 * reset provider-health's module-level state between tests.
 *
 * The first test in each pair poisons the state; the second asserts it starts
 * clean. Jest runs tests in a file in declaration order by default, so without
 * the global hook the second test inherits the first test's state and fails.
 * Do not add a local beforeEach that clears this state; that would hide a
 * regression in the global wiring this file exists to catch.
 */

jest.mock("@/ai/providers/factory", () => ({
  getAIModel: jest.fn(async () => {
    throw new Error("provider unreachable (test)");
  }),
}));

import {
  getCachedHealth,
  isHealthCached,
  pingProvider,
  providerHealth,
} from "@/ai/providers/provider-health";

describe("provider-health healthCache is reset between tests (#2364)", () => {
  it("poisons the cache with an unhealthy verdict", async () => {
    const result = await pingProvider("openai");
    expect(result.healthy).toBe(false);
    expect(isHealthCached("openai")).toBe(true);
  });

  it("starts the next test with no cached verdict", () => {
    expect(getCachedHealth("openai")).toBeUndefined();
    expect(isHealthCached("openai")).toBe(false);
  });
});

describe("providerHealth cooldown tracker is reset between tests (#2364)", () => {
  it("records a failure that puts the provider in cooldown", () => {
    providerHealth.recordFailure("anthropic", "rate-limit");
    expect(providerHealth.size()).toBeGreaterThan(0);
  });

  it("starts the next test with an empty tracker", () => {
    expect(providerHealth.size()).toBe(0);
    expect(providerHealth.snapshot("anthropic")).toBeUndefined();
  });
});
