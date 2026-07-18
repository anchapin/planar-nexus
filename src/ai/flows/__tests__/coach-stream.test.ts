/**
 * @fileoverview Tests for the coach streaming orchestrator (issue #1077).
 *
 * Covers: progressive token delivery, transparent provider failover when the
 * primary errors before any token, graceful end on mid-stream failure, the
 * all-providers-exhausted fallback, cooperative cancellation via AbortSignal,
 * token-usage surfacing, and the SSE wire format.
 *
 * The Vercel AI SDK `streamText` is mocked so these are fast, hermetic unit
 * tests; provider resolution + config detection are injected directly so no
 * network or env setup is required.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { streamText } from "ai";
import {
  streamCoachResponse,
  eventToSse,
  DEFAULT_FALLBACK_TEXT,
  type CoachStreamEvent,
  type CoachStreamMessage,
} from "../coach-stream";
import {
  ProviderHealthTracker,
  providerHealth,
} from "@/ai/providers/provider-health";

// Mock the Vercel AI SDK with an explicit factory so the real `ai` module
// (which references browser/Node stream globals like TransformStream that are
// absent in the jsdom test env) is never loaded. The mock is configured
// per-test below.
jest.mock("ai", () => ({
  streamText: jest.fn(),
}));
const mockedStreamText = streamText as jest.MockedFunction<typeof streamText>;

/** Build a fake `streamText` result whose textStream yields `deltas`. */
function fakeResult(
  deltas: string[],
  opts: {
    usage?: unknown;
    throwBefore?: number;
    errorMessage?: string;
  } = {},
) {
  const {
    usage = null,
    throwBefore,
    errorMessage = "upstream stream exploded",
  } = opts;
  async function* gen(): AsyncGenerator<string> {
    for (let i = 0; i < deltas.length; i++) {
      if (throwBefore !== undefined && i === throwBefore) {
        throw new Error(errorMessage);
      }
      yield deltas[i];
    }
  }
  return {
    textStream: gen(),
    totalUsage: Promise.resolve(usage),
  } as unknown as ReturnType<typeof streamText>;
}

const MESSAGES: CoachStreamMessage[] = [{ role: "user", content: "hi" }];

/** A noop model resolver that records which provider was asked for. */
function makeGetModel(log: string[]) {
  return async (provider: string) => {
    log.push(provider);
    return { provider } as unknown as Awaited<
      ReturnType<typeof import("../../providers/factory").getAIModel>
    >;
  };
}

async function collect(
  gen: AsyncGenerator<CoachStreamEvent>,
): Promise<CoachStreamEvent[]> {
  const out: CoachStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

beforeEach(() => {
  jest.resetAllMocks();
  // Issue #1418: the process-wide provider-health singleton carries cooldown
  // state across tests. Reset it so each test starts with all providers
  // healthy (tests that exercise cooldown inject a fresh tracker).
  providerHealth.clear();
});

describe("streamCoachResponse — progressive delivery", () => {
  it("streams tokens progressively and finishes with usage + done", async () => {
    mockedStreamText.mockReturnValue(
      fakeResult(["Hel", "lo", " world"], {
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      }),
    );
    const log: string[] = [];

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel(log),
        isConfigured: () => true,
      }),
    );

    expect(log).toEqual(["openai"]);
    expect(events.map((e) => e.type)).toEqual([
      "provider",
      "text",
      "text",
      "text",
      "usage",
      "done",
    ]);
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { value: string }).value)
      .join("");
    expect(text).toBe("Hello world");
    const usage = events.find((e) => e.type === "usage") as {
      usage: { totalTokens: number };
    };
    expect(usage.usage.totalTokens).toBe(8);
  });

  it("does not emit a usage event when the provider reports none", async () => {
    mockedStreamText.mockReturnValue(fakeResult(["x"], { usage: null }));
    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
      }),
    );
    expect(events.find((e) => e.type === "usage")).toBeUndefined();
    expect(events[events.length - 1].type).toBe("done");
  });
});

describe("streamCoachResponse — provider failover", () => {
  it("fails over to the next provider when the primary errors before any token", async () => {
    // First call (openai) throws on first iteration before yielding.
    // Second call (anthropic) succeeds.
    mockedStreamText
      .mockReturnValueOnce(
        fakeResult(["should-not-stream"], { throwBefore: 0 }),
      )
      .mockReturnValueOnce(
        fakeResult(["recovered"], {
          usage: { totalTokens: 2, inputTokens: 1, outputTokens: 1 },
        }),
      );

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("failover");
    const failover = events.find((e) => e.type === "failover") as {
      from: string;
      to: string;
      reason: string;
    };
    expect(failover.from).toBe("openai");
    expect(failover.to).toBe("anthropic");
    expect(failover.reason).toBe("stream-error");

    // The user still gets a response from the secondary provider.
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { value: string }).value)
      .join("");
    expect(text).toBe("recovered");
    expect(types[types.length - 1]).toBe("done");
    expect(mockedStreamText).toHaveBeenCalledTimes(2);
  });

  it("fails over when model setup throws (rate-limited provider)", async () => {
    const getModel = async (provider: string) => {
      if (provider === "openai") {
        throw new Error("429 rate limited");
      }
      return { provider } as unknown as Awaited<
        ReturnType<typeof import("../../providers/factory").getAIModel>
      >;
    };
    mockedStreamText.mockReturnValue(fakeResult(["ok"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel,
        isConfigured: () => true,
      }),
    );

    const failover = events.find((e) => e.type === "failover") as {
      reason: string;
    };
    expect(failover.reason).toBe("model-setup-failed");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("skips unconfigured providers and fails over with reason 'not-configured'", async () => {
    mockedStreamText.mockReturnValue(fakeResult(["from-google"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "google"],
        getModel: makeGetModel([]),
        isConfigured: (p) => p === "google",
      }),
    );

    const failover = events.find((e) => e.type === "failover") as {
      from: string;
      to: string;
      reason: string;
    };
    expect(failover).toEqual({
      type: "failover",
      from: "openai",
      to: "google",
      reason: "not-configured",
    });
    // openai was never asked to resolve a model.
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
  });

  it("ends gracefully (no failover) when a provider fails mid-stream", async () => {
    // Yields one token, then throws on the second.
    mockedStreamText.mockReturnValue(
      fakeResult(["Hel", "lo"], { throwBefore: 1 }),
    );

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    expect(types).toContain("error");
    expect(types[types.length - 1]).toBe("done");
    // No failover attempted after partial delivery.
    expect(types).not.toContain("failover");
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
  });

  it("streams the fallback text when every provider is exhausted", async () => {
    mockedStreamText
      .mockReturnValueOnce(fakeResult(["x"], { throwBefore: 0 }))
      .mockReturnValueOnce(fakeResult(["y"], { throwBefore: 0 }));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
      }),
    );

    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { value: string }).value)
      .join("");
    expect(text).toBe(DEFAULT_FALLBACK_TEXT);
    expect(events[events.length - 1].type).toBe("done");
  });

  it("uses a custom fallback text when the only provider errors", async () => {
    // Provider errors before any token → all providers exhausted → fallback.
    mockedStreamText.mockReturnValue(fakeResult(["x"], { throwBefore: 0 }));
    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        fallbackText: "custom fallback",
      }),
    );
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { value: string }).value)
      .join("");
    expect(text).toBe("custom fallback");
  });
});

describe("streamCoachResponse — cancellation", () => {
  it("stops without failing over when the abort signal fires mid-stream", async () => {
    const controller = new AbortController();
    // Yields three deltas; we abort after the first is consumed.
    mockedStreamText.mockReturnValue(fakeResult(["a", "b", "c"]));

    const gen = streamCoachResponse({
      systemPrompt: "sys",
      messages: MESSAGES,
      providers: ["openai", "anthropic"],
      getModel: makeGetModel([]),
      isConfigured: () => true,
      signal: controller.signal,
    });

    const events: CoachStreamEvent[] = [];
    for await (const e of gen) {
      events.push(e);
      if (e.type === "text") {
        controller.abort(); // user hit Cancel
      }
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("text");
    // Aborted → no done, no failover, no second provider attempted.
    expect(types).not.toContain("done");
    expect(types).not.toContain("failover");
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
  });

  it("does nothing when aborted before the first provider", async () => {
    const controller = new AbortController();
    controller.abort();
    mockedStreamText.mockReturnValue(fakeResult(["x"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        signal: controller.signal,
      }),
    );

    expect(events).toEqual([]);
    expect(mockedStreamText).not.toHaveBeenCalled();
  });
});

describe("streamCoachResponse — provider health backoff (#1418)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("skips a provider in cooldown and emits a failover(cooldown) event", async () => {
    const health = new ProviderHealthTracker();
    // Pre-record a timeout failure for the primary provider so it is in
    // cooldown at decision time. Cooldown base for timeout is 1s.
    health.recordFailure("openai", "timeout");
    expect(health.isHealthy("openai")).toBe(false);

    // openai would succeed if it were attempted; the test asserts it is NOT.
    mockedStreamText.mockReturnValue(
      fakeResult(["from-openai"], {
        usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 },
      }),
    );

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    const failover = events.find((e) => e.type === "failover") as {
      from: string;
      to: string;
      reason: string;
      cooldownReason?: string;
    };
    expect(failover).toEqual({
      type: "failover",
      from: "openai",
      to: "anthropic",
      reason: "cooldown",
      cooldownReason: "timeout",
    });
    // openai was skipped entirely; only anthropic was attempted.
    expect(mockedStreamText).toHaveBeenCalledTimes(1);

    // Stream completes normally → anthropic's health is reset.
    expect(health.isHealthy("anthropic")).toBe(true);
  });

  it("records a rate-limit cooldown when streamText throws 429 before any token", async () => {
    const health = new ProviderHealthTracker();
    // First call (openai) blows up before any token with a 429; anthropic
    // recovers.
    mockedStreamText
      .mockReturnValueOnce(
        fakeResult(["nope"], {
          throwBefore: 0,
          errorMessage: "429 Too Many Requests",
        }),
      )
      .mockReturnValueOnce(fakeResult(["ok"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    // The failover reason on the SSE event stays backward compatible.
    const failover = events.find((e) => e.type === "failover") as {
      reason: string;
    };
    expect(failover.reason).toBe("rate-limited");

    // ...but the health tracker recorded the bounded rate-limit reason with a
    // 2s base cooldown.
    expect(health.isHealthy("openai")).toBe(false);
    expect(health.cooldownRemaining("openai")).toBe(2_000);
    expect(health.snapshot("openai")?.lastFailureReason).toBe("rate-limit");
  });

  it("records model-setup failures so the next turn skips that provider", async () => {
    const health = new ProviderHealthTracker();
    const getModel = async (provider: string) => {
      if (provider === "openai") {
        throw new Error("model setup blew up");
      }
      return { provider } as unknown as Awaited<
        ReturnType<typeof import("../../providers/factory").getAIModel>
      >;
    };
    mockedStreamText.mockReturnValue(fakeResult(["ok"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel,
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    expect(events.some((e) => e.type === "done")).toBe(true);
    // openai's setup failure is recorded as model-setup, with the 1s base.
    expect(health.isHealthy("openai")).toBe(false);
    expect(health.cooldownRemaining("openai")).toBe(1_000);
    expect(health.snapshot("openai")?.lastFailureReason).toBe("model-setup");
  });

  it("successful completion leaves the provider healthy (no spurious cooldown)", async () => {
    // Note: the actual "recordSuccess clears a mid-cooldown entry" semantics
    // are covered in provider-health.test.ts. At the integration level we
    // verify the symmetric contract — a successful stream from a healthy
    // provider never creates a cooldown entry.
    const health = new ProviderHealthTracker();
    mockedStreamText.mockReturnValue(
      fakeResult(["hi"], {
        usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 },
      }),
    );

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    expect(events[events.length - 1].type).toBe("done");
    expect(health.isHealthy("anthropic")).toBe(true);
    expect(health.snapshot("anthropic")).toBeUndefined();
    expect(health.size()).toBe(0);
  });

  it("recordSuccess is invoked on success even when the provider had no entry", async () => {
    // Defensive contract: a successful stream must not regress a healthy
    // provider to unhealthy, and must clear any prior entry from a previous
    // turn once the cooldown has elapsed and the provider is retried.
    const health = new ProviderHealthTracker();

    // Turn 1: openai times out → cooldown recorded.
    mockedStreamText.mockReturnValueOnce(
      fakeResult(["nope"], {
        throwBefore: 0,
        errorMessage: "request timed out",
      }),
    );
    await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );
    expect(health.snapshot("openai")?.lastFailureReason).toBe("timeout");

    // Advance time past the 1s timeout cooldown so openai is retried.
    jest.advanceTimersByTime(1_000);
    expect(health.isHealthy("openai")).toBe(true);

    // Turn 2: openai succeeds → recordSuccess is a no-op on the pruned
    // entry, but the provider remains healthy.
    mockedStreamText.mockReturnValueOnce(fakeResult(["ok"]));
    await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    expect(health.isHealthy("openai")).toBe(true);
    expect(health.snapshot("openai")).toBeUndefined();
  });

  it("does not record a failure when the user cancels mid-stream", async () => {
    const health = new ProviderHealthTracker();
    const controller = new AbortController();
    mockedStreamText.mockReturnValue(fakeResult(["a", "b", "c"]));

    const gen = streamCoachResponse({
      systemPrompt: "sys",
      messages: MESSAGES,
      providers: ["openai", "anthropic"],
      getModel: makeGetModel([]),
      isConfigured: () => true,
      signal: controller.signal,
      healthTracker: health,
    });

    for await (const e of gen) {
      if (e.type === "text") {
        controller.abort();
      }
    }

    // Cancellation must not cool down openai — it is the user's action, not
    // a provider failure.
    expect(health.isHealthy("openai")).toBe(true);
    expect(health.snapshot("openai")).toBeUndefined();
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
  });

  it("does not record a failure on a mid-stream error (provider did start)", async () => {
    const health = new ProviderHealthTracker();
    mockedStreamText.mockReturnValue(
      fakeResult(["Hel", "lo"], { throwBefore: 1 }),
    );

    await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    expect(health.isHealthy("openai")).toBe(true);
    expect(health.snapshot("openai")).toBeUndefined();
  });

  it("emits failover(cooldown) on the next turn after a 429, then resets on recovery", async () => {
    // End-to-end multi-turn flow exercising the full #1418 contract:
    //   turn 1: openai returns 429 → rate-limit cooldown recorded → failover
    //           to anthropic.
    //   turn 2 (no time advanced): openai is still in cooldown → emit
    //           failover(cooldown) and skip without touching streamText.
    //   advance time past the cooldown: openai recovers, attempt it again,
    //           it succeeds → no further failures recorded.
    // Exponential growth across consecutive failures is covered in
    // provider-health.test.ts (the integration flow prunes entries once
    // their cooldown elapses, so the count resets between recovered turns).
    const health = new ProviderHealthTracker();

    // Turn 1.
    mockedStreamText
      .mockReturnValueOnce(
        fakeResult(["nope"], {
          throwBefore: 0,
          errorMessage: "429 Too Many Requests",
        }),
      )
      .mockReturnValueOnce(fakeResult(["turn1-ok"]));
    await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );
    const snap1 = health.snapshot("openai");
    expect(snap1?.failureCount).toBe(1);
    expect(snap1?.lastFailureReason).toBe("rate-limit");
    expect(health.cooldownRemaining("openai")).toBe(2_000);

    // Turn 2 — no time advanced, openai still in cooldown.
    mockedStreamText.mockReset();
    mockedStreamText.mockReturnValue(fakeResult(["turn2-ok"]));
    const events2 = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );
    // openai was skipped — streamText only called for anthropic.
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
    const cooldownFailover = events2.find(
      (e) =>
        e.type === "failover" &&
        (e as { reason: string }).reason === "cooldown",
    ) as
      | { from: string; to: string; reason: string; cooldownReason?: string }
      | undefined;
    expect(cooldownFailover).toBeDefined();
    expect(cooldownFailover?.from).toBe("openai");
    expect(cooldownFailover?.to).toBe("anthropic");
    expect(cooldownFailover?.cooldownReason).toBe("rate-limit");

    // Turn 3 — advance past the 2s cooldown, openai recovers and succeeds.
    jest.advanceTimersByTime(2_000);
    mockedStreamText.mockReset();
    mockedStreamText.mockReturnValue(fakeResult(["turn3-openai-ok"]));
    const events3 = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );
    // openai was attempted again (no cooldown skip), succeeded, and is now
    // healthy with no entry.
    expect(mockedStreamText).toHaveBeenCalledTimes(1);
    expect(
      events3.some(
        (e) =>
          e.type === "failover" &&
          (e as { reason: string }).reason === "cooldown",
      ),
    ).toBe(false);
    const provider3 = events3.find((e) => e.type === "provider") as {
      value: string;
    };
    expect(provider3.value).toBe("openai");
    expect(health.isHealthy("openai")).toBe(true);
    expect(health.snapshot("openai")).toBeUndefined();
  });

  it("when every provider is in cooldown, falls through to the fallback text", async () => {
    const health = new ProviderHealthTracker();
    health.recordFailure("openai", "rate-limit");
    health.recordFailure("anthropic", "timeout");

    mockedStreamText.mockReturnValue(fakeResult(["should-not-reach"]));

    const events = await collect(
      streamCoachResponse({
        systemPrompt: "sys",
        messages: MESSAGES,
        providers: ["openai", "anthropic"],
        getModel: makeGetModel([]),
        isConfigured: () => true,
        healthTracker: health,
      }),
    );

    // No provider event — every provider was skipped.
    expect(events.some((e) => e.type === "provider")).toBe(false);
    expect(mockedStreamText).not.toHaveBeenCalled();
    const text = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { value: string }).value)
      .join("");
    expect(text).toBe(DEFAULT_FALLBACK_TEXT);
    expect(events[events.length - 1].type).toBe("done");
  });
});

describe("eventToSse", () => {
  it("serializes an event as a single SSE data line", () => {
    expect(eventToSse({ type: "text", value: "hi" })).toBe(
      `data: {"type":"text","value":"hi"}\n\n`,
    );
  });

  it("serializes a done event", () => {
    expect(eventToSse({ type: "done" })).toBe(`data: {"type":"done"}\n\n`);
  });
});
