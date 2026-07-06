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
import {
  useDeckCoachChat,
  clearAllCoachConversations,
} from "../use-deck-coach-chat";

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

beforeEach(async () => {
  lastFetchOptions = {};
  lastRequestBody = {};
  // The hook persists conversations to IndexedDB (issue #1074); clear the store
  // so each test starts isolated and a prior test's conversation is never
  // auto-resumed into the next one.
  await clearAllCoachConversations();
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

describe("useDeckCoachChat — IndexedDB persistence (#1074)", () => {
  it("persists a completed conversation and resumes it after a simulated reload", async () => {
    // First "session": send a message and let the stream complete.
    const first = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-z" }),
    );
    await act(async () => {
      await first.result.current.sendMessage("how do I sideboard?", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    // The finalized assistant message must be present before we tear down.
    expect(
      first.result.current.messages.some((m) => m.role === "assistant"),
    ).toBe(true);
    first.unmount();

    // Simulate a page reload: a brand-new hook instance mounts and its
    // auto-resume effect should load the most-recent conversation.
    const reloaded = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-z" }),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    const restored = reloaded.result.current.messages;
    expect(restored.length).toBeGreaterThanOrEqual(2);
    expect(restored.some((m) => m.content === "how do I sideboard?")).toBe(
      true,
    );
    expect(restored.some((m) => m.content === "Hello")).toBe(true);
    // The resumed conversation is the active one.
    expect(reloaded.result.current.activeConversationId).not.toBeNull();
    expect(reloaded.result.current.conversations.length).toBeGreaterThanOrEqual(
      1,
    );
    reloaded.unmount();
  });

  it("saves streaming-era fields once the assistant message completes", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-fields" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.provider).toBe("openai");
    expect(assistant?.usage?.totalTokens).toBe(4);

    // Read the persisted conversation directly and assert the finalized fields
    // (provider/usage) were written — i.e. we saved once on completion, not
    // per token.
    const { loadMostRecentConversation } =
      await import("@/lib/coach-conversation-storage");
    const persisted = await loadMostRecentConversation("deck-fields");
    expect(persisted).not.toBeNull();
    const persistedAssistant = persisted!.messages.find(
      (m) => m.role === "assistant",
    );
    expect(persistedAssistant?.provider).toBe("openai");
    expect(persistedAssistant?.usage?.totalTokens).toBe(4);
  });

  it("resumes a past conversation via resumeConversation", async () => {
    // Seed two conversations for the deck.
    const seed = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-resume" }),
    );
    await act(async () => {
      await seed.result.current.sendMessage("first question", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    const firstId = seed.result.current.activeConversationId;
    seed.unmount();

    const seed2 = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-resume" }),
    );
    // Auto-resume loaded the most recent (firstId); start a fresh conversation
    // and complete it so a second persisted conversation exists.
    await act(async () => {
      seed2.result.current.startNewConversation();
      await flush();
    });
    await act(async () => {
      await seed2.result.current.sendMessage("second question", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    const secondId = seed2.result.current.activeConversationId;
    expect(secondId).not.toBe(firstId);
    seed2.unmount();

    // Mount again and explicitly resume the FIRST conversation.
    const app = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-resume" }),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    await act(async () => {
      await app.result.current.resumeConversation(firstId!);
      await flush();
    });
    expect(app.result.current.activeConversationId).toBe(firstId);
    expect(
      app.result.current.messages.some((m) => m.content === "first question"),
    ).toBe(true);
    app.unmount();
  });

  it("degrades gracefully on quota errors (no crash, surfaces a notice)", async () => {
    // Force every IndexedDB put to reject with a quota error for this test.
    // Return a fake request that fires ONLY onerror so the storage layer
    // classifies + rejects (the real fake-indexeddb request would otherwise
    // fire onsuccess first).
    const realPut = IDBObjectStore.prototype.put;
    const quotaError = new DOMException(
      "The quota has been exceeded",
      "QuotaExceededError",
    );
    IDBObjectStore.prototype.put = function () {
      const fakeReq: {
        error: unknown;
        onsuccess: ((ev: Event) => void) | null;
        onerror: ((ev: Event) => void) | null;
      } = { error: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        fakeReq.error = quotaError;
        if (typeof fakeReq.onerror === "function") {
          fakeReq.onerror(new Event("error"));
        }
      }, 0);
      return fakeReq as unknown as IDBRequest;
    };

    try {
      const { result } = renderHook(() =>
        useDeckCoachChat({ format: "modern", deckId: "deck-quota" }),
      );

      // The send must not throw even though persistence fails.
      await act(async () => {
        await result.current.sendMessage("hello", {
          deckCards: [{ name: "Sol Ring", count: 1 } as never],
        });
      });

      // The assistant message still rendered in-session.
      expect(result.current.messages.some((m) => m.role === "assistant")).toBe(
        true,
      );
      // A non-null storage notice surfaced the degraded persistence.
      expect(result.current.storageNotice).not.toBeNull();
      expect(result.current.storageNotice).toMatch(/save/i);
    } finally {
      IDBObjectStore.prototype.put = realPut;
    }
  });
});

describe("useDeckCoachChat — export / import (#1242)", () => {
  it("exportActiveDeckToJSON returns null when there are no conversations", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-empty-export" }),
    );
    await act(async () => {
      await flush();
    });
    expect(await result.current.exportActiveDeckToJSON()).toBeNull();
  });

  it("exportActiveDeckToJSON produces a parseable envelope containing the saved session", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-export" }),
    );
    await act(async () => {
      await result.current.sendMessage("how do I beat aggro?", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const json = await result.current.exportActiveDeckToJSON();
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.type).toBe("planar-nexus-coach-conversations");
    expect(parsed.deckId).toBe("deck-export");
    expect(parsed.conversations).toHaveLength(1);
    expect(parsed.conversations[0].messages.some(
      (m: { content: string }) => m.content === "how do I beat aggro?",
    )).toBe(true);
  });

  it("importFromJSON surfaces a typed error for unrecognised JSON", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-import-bad" }),
    );
    await act(async () => {
      await flush();
    });
    const r = await result.current.importFromJSON("not a coach export");
    expect("error" in r).toBe(true);
  });

  it("importFromJSON imports conversations scoped to the active deck", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-import-target" }),
    );
    await act(async () => {
      await flush();
    });
    const envelope = {
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: "deck-import-source",
      conversations: [
        {
          id: "incoming-session",
          deckId: "deck-import-source",
          title: "sideboard help",
          deckContext: { format: "modern" },
          messages: [
            {
              id: "m1",
              role: "user",
              content: "How do I sideboard vs control?",
              timestamp: new Date(),
            },
            {
              id: "m2",
              role: "assistant",
              content: "Bring in more removal.",
              timestamp: new Date(),
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const r = await result.current.importFromJSON(JSON.stringify(envelope));
    expect("imported" in r).toBe(true);
    if ("imported" in r) {
      expect(r.imported).toBe(1);
      expect(r.skipped).toBe(0);
    }
    await act(async () => {
      await flush();
    });
    expect(result.current.conversations.length).toBeGreaterThanOrEqual(1);
    expect(
      result.current.conversations.some((c) => c.id === "incoming-session"),
    ).toBe(true);
    // Re-scoped to the active deck.
    expect(
      result.current.conversations.find((c) => c.id === "incoming-session")
        ?.deckId,
    ).toBe("deck-import-target");
  });

  it("importFromJSON({ scope: 'original' }) preserves the original deckId", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-active-keep" }),
    );
    await act(async () => {
      await flush();
    });
    const envelope = {
      type: "planar-nexus-coach-conversations",
      version: 1,
      exportedAt: new Date().toISOString(),
      deckId: "deck-original",
      conversations: [
        {
          id: "kept-original-deck",
          deckId: "deck-original",
          title: "kept",
          deckContext: {},
          messages: [
            { id: "m1", role: "user", content: "q", timestamp: new Date() },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await result.current.importFromJSON(JSON.stringify(envelope), {
      scope: "original",
    });
    await act(async () => {
      await flush();
    });
    // Switch to the original deck and verify it shows up there.
    const fromOriginal = await import("@/lib/coach-conversation-storage");
    const reloaded = await fromOriginal.loadConversation("kept-original-deck");
    expect(reloaded!.deckId).toBe("deck-original");
  });
});
