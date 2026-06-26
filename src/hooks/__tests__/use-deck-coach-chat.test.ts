/**
 * @fileoverview Tests for the streaming coach chat hook (issue #1077).
 *
 * Asserts: progressive rendering of Server-Sent-Events as the assistant
 * message grows token-by-token, per-message provider/usage attachment, and
 * that `cancelGeneration` aborts the in-flight fetch (the Cancel button path).
 *
 * `fetch` is mocked to return a hand-rolled SSE body; the AI worker is mocked
 * so no Web Worker is spun up.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  beforeAll,
} from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import { useDeckCoachChat } from "../use-deck-coach-chat";

jest.mock("@/ai/worker/ai-worker-client", () => ({
  aiWorkerClient: { api: null },
}));

// Some jsdom builds lack crypto.randomUUID, which the hook uses for message ids.
beforeAll(() => {
  const c = globalThis.crypto as { randomUUID?: unknown } | undefined;
  if (!c || typeof c.randomUUID !== "function") {
    (globalThis as { crypto?: unknown }).crypto = {
      ...(c as object),
      randomUUID: () => `id-${Math.random().toString(36).slice(2)}`,
    };
  }
});

/** A minimal, abort-aware SSE body matching the shape the hook reads. */
function makeSseBody(
  chunks: string[],
  signal?: AbortSignal | null,
): {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
} {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        read: async () => {
          if (signal?.aborted) {
            throw new DOMException("aborted", "AbortError");
          }
          if (i >= chunks.length) return { done: true };
          const chunk = chunks[i++];
          return { done: false, value: encoder.encode(chunk) };
        },
      };
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let lastFetchOptions: { signal?: AbortSignal | null } = {};
let lastRequestBody: { messages?: unknown[]; format?: string } = {};

beforeEach(() => {
  lastFetchOptions = {};
  lastRequestBody = {};
  // The hook persists history to localStorage; clear it so tests are isolated.
  localStorage.clear();
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    async (_url: string, init?: RequestInit) => {
      lastFetchOptions = { signal: init?.signal };
      try {
        lastRequestBody = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        lastRequestBody = {};
      }
      const body = makeSseBody(
        [
          'data: {"type":"provider","value":"openai"}\n\n',
          'data: {"type":"text","value":"Hel"}\n\n',
          'data: {"type":"text","value":"lo"}\n\n',
          'data: {"type":"usage","usage":{"promptTokens":2,"completionTokens":2,"totalTokens":4}}\n\n',
          'data: {"type":"done"}\n\n',
        ],
        init?.signal,
      );
      return { ok: true, body };
    },
  ) as unknown as typeof fetch;
});

describe("useDeckCoachChat — progressive streaming render", () => {
  it("grows the assistant message token-by-token and attaches usage/provider", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );

    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", quantity: 1 } as never],
      });
    });

    const messages = result.current.messages;
    // user + assistant
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Hello");
    expect(assistant.provider).toBe("openai");
    expect(assistant.usage?.totalTokens).toBe(4);
  });

  it("sends the conversation history (minus the streaming placeholder) to the route", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );

    await act(async () => {
      await result.current.sendMessage("first", {
        deckCards: [{ name: "Sol Ring", quantity: 1 } as never],
      });
    });

    // The streaming placeholder is filtered out; only the user message remains.
    expect(lastRequestBody.messages).toEqual([
      expect.objectContaining({ role: "user", content: "first" }),
    ]);
    expect(lastRequestBody.format).toBe("commander");
  });
});

describe("useDeckCoachChat — cancel/abort", () => {
  it("aborting the controller stops the in-flight fetch and clears loading", async () => {
    // A body that yields one chunk then blocks until aborted.
    let resolveBlock: () => void = () => {};
    const block = new Promise<void>((r) => {
      resolveBlock = r;
    });
    const encoder = new TextEncoder();
    let capturedSignal: AbortSignal | null | undefined;
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
      async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal;
        let yielded = false;
        const body = {
          getReader() {
            return {
              read: async () => {
                if (init?.signal?.aborted) {
                  throw new DOMException("aborted", "AbortError");
                }
                if (!yielded) {
                  yielded = true;
                  return {
                    done: false,
                    value: encoder.encode(
                      'data: {"type":"text","value":"Hel"}\n\n',
                    ),
                  };
                }
                await block;
                if (init?.signal?.aborted) {
                  throw new DOMException("aborted", "AbortError");
                }
                return { done: true };
              },
            };
          },
        };
        return { ok: true, body };
      },
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );

    // Kick off the stream without awaiting completion.
    act(() => {
      void result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", quantity: 1 } as never],
      });
    });
    await flush();

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.cancelGeneration();
    });
    // Release the blocked read so the AbortError path can complete.
    await act(async () => {
      resolveBlock();
      await flush();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.isStreaming).toBe(false);
    // Partial text was rendered before the cancel.
    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content).toContain("Hel");
  });
});
