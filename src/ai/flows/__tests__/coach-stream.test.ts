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

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { streamText } from "ai";
import {
  streamCoachResponse,
  eventToSse,
  DEFAULT_FALLBACK_TEXT,
  type CoachStreamEvent,
  type CoachStreamMessage,
} from "../coach-stream";

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
  opts: { usage?: unknown; throwBefore?: number } = {},
) {
  const { usage = null, throwBefore } = opts;
  async function* gen(): AsyncGenerator<string> {
    for (let i = 0; i < deltas.length; i++) {
      if (throwBefore !== undefined && i === throwBefore) {
        throw new Error("upstream stream exploded");
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
