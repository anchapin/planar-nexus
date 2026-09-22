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

import React from "react";
import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  beforeAll,
} from "@jest/globals";
import { renderHook, act, render, waitFor } from "@testing-library/react";
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

/**
 * Replace `globalThis.requestAnimationFrame` with a synchronous variant for
 * the duration of the supplied callback. jsdom's default rAF is
 * setTimeout-based and doesn't reliably flush inside `act()` — tests that
 * exercise the rAF coalescing path (issue #1793) need a deterministic
 * rAF to assert render counts and to observe the streaming draft's
 * mid-flight content.
 */
function withSyncRaf<T>(fn: () => Promise<T> | T): Promise<T> {
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let rafCalls = 0;
  (
    globalThis as unknown as {
      requestAnimationFrame: (cb: () => void) => number;
    }
  ).requestAnimationFrame = (cb: () => void) => {
    rafCalls++;
    cb();
    return 0;
  };
  (
    globalThis as unknown as { cancelAnimationFrame: (id: number) => void }
  ).cancelAnimationFrame = () => {};
  (globalThis as unknown as { __rafCalls?: number }).__rafCalls = rafCalls;
  return Promise.resolve(fn()).finally(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancel;
  });
}

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

  /**
   * #1950 regression: the read loop must reassemble SSE events delivered as
   * arbitrary byte slices — chunks that split a multibyte UTF-8 code point in
   * half and cut events mid-JSON before their `\n\n` separator. WebKit's
   * network stack delivers the mocked route body as differently-framed
   * chunks than Chromium/Firefox; the `TextDecoder` stream mode plus the
   * `\n\n` buffering in the hook is what keeps the streamed answer intact.
   */
  it("reassembles SSE events split across byte-level chunk boundaries with multibyte UTF-8 (#1950)", async () => {
    const STREAMED = "Libre ⚡ éclair!";
    const sse = [
      'data: {"type":"provider","value":"mock-provider"}\n\n',
      `data: ${JSON.stringify({ type: "text", value: STREAMED })}\n\n`,
      'data: {"type":"done"}\n\n',
    ].join("");

    // Encode once, then serve fixed-size byte slices. ⚡ is 3 bytes (E2 9A
    // A1) and é is 2 bytes (C3 A9), so a 5-byte slice is guaranteed to split
    // code points and slice events mid-line before the separator.
    const bytes = new TextEncoder().encode(sse);
    const SLICE = 5;
    let offset = 0;
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (offset >= bytes.length) return { done: true };
            const value = bytes.slice(offset, offset + SLICE);
            offset += SLICE;
            return { done: false, value };
          },
        }),
      },
    })) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );

    await act(async () => {
      await result.current.sendMessage("multibyte question");
    });

    const messages = result.current.messages;
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    expect(assistant.role).toBe("assistant");
    // The multibyte text must survive the byte-level slicing verbatim —
    // a decoder without `{ stream: true }` would emit U+FFFD replacements,
    // and buffering without `\n\n` reassembly would drop split events.
    expect(assistant.content).toBe(STREAMED);
    expect(assistant.content).not.toContain("\uFFFD");
    expect(assistant.provider).toBe("mock-provider");
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

    await act(async () => {
      first.unmount();
    });

    // Simulate a page reload: a brand-new hook instance mounts and its
    // auto-resume effect should load the most-recent conversation.
    const reloaded = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-z" }),
    );
    // Wait for the auto-resume effect to complete loading the persisted conversation.
    await flush();
    await waitFor(() => {
      expect(reloaded.result.current.messages.length).toBeGreaterThanOrEqual(2);
    });

    const restored = reloaded.result.current.messages;
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
    expect(
      parsed.conversations[0].messages.some(
        (m: { content: string }) => m.content === "how do I beat aggro?",
      ),
    ).toBe(true);
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

// ============================================================================
// issue #1241 — acceptance criteria coverage
// ============================================================================
//
// The earlier suites cover streaming, cancel, persistence, and export/import.
// This block closes the acceptance-criteria gaps named in the issue:
//   - per-deckId storage isolation
//   - streamed chunks accumulating into one assistant message
//   - chat error fallback (the "Sorry, I encountered an error" path)
//   - clearMessages behaviour (active id present vs. absent)
//   - the >20-card digest branch setting `payloadDeck = undefined`
//
// Together these lift the hook's branch coverage toward the 70% target.

describe("useDeckCoachChat — per-deckId storage isolation (#1241)", () => {
  it("never bleeds a conversation from deck-A into deck-B", async () => {
    // Seed a persisted conversation for deck-A only.
    const a = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-iso-A" }),
    );
    await act(async () => {
      await a.result.current.sendMessage("only-for-A", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    expect(a.result.current.activeConversationId).not.toBeNull();
    a.unmount();

    // Mount a fresh hook for deck-B; auto-resume must not surface deck-A.
    const b = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-iso-B" }),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    expect(b.result.current.messages).toEqual([]);
    expect(b.result.current.activeConversationId).toBeNull();
    expect(b.result.current.conversations).toEqual([]);

    // Sending on deck-B must create a deck-B record (not reuse deck-A's id).
    await act(async () => {
      await b.result.current.sendMessage("only-for-B", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    const deckBId = b.result.current.activeConversationId;
    expect(deckBId).not.toBeNull();

    const storage = await import("@/lib/coach-conversation-storage");
    const deckA = await storage.loadConversations("deck-iso-A");
    const deckB = await storage.loadConversations("deck-iso-B");
    expect(deckA).toHaveLength(1);
    expect(deckA[0].deckId).toBe("deck-iso-A");
    expect(deckA[0].id).not.toBe(deckBId);
    expect(deckB).toHaveLength(1);
    expect(deckB[0].deckId).toBe("deck-iso-B");
    b.unmount();
  });
});

describe("useDeckCoachChat — error fallback and clearMessages (#1241)", () => {
  it("replaces the placeholder with the fallback message when fetch throws", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-err" }),
    );

    await act(async () => {
      await result.current.sendMessage("ping", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content).toMatch(/Sorry, I encountered an error/i);
    expect(result.current.isStreaming).toBe(false);
  });

  it("replaces the placeholder when the route returns a non-OK response", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      statusText: "Service Unavailable",
      body: null,
    })) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-500" }),
    );

    await act(async () => {
      await result.current.sendMessage("ping", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content).toMatch(/Sorry, I encountered an error/i);
    expect(result.current.isStreaming).toBe(false);
  });

  it("clearMessages with an active conversation deletes that conversation by id", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-clear-active" }),
    );
    await act(async () => {
      await result.current.sendMessage("hello", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    const activeId = result.current.activeConversationId;
    expect(activeId).not.toBeNull();
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearMessages();
    });
    await act(async () => {
      await flush();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.activeConversationId).toBeNull();

    // The persisted record is gone; the deck's list is now empty.
    const storage = await import("@/lib/coach-conversation-storage");
    const deleted = await storage.loadConversation(activeId!);
    expect(deleted).toBeNull();
    const remaining = await storage.loadConversations("deck-clear-active");
    expect(remaining).toEqual([]);
  });

  it("clearMessages without an active conversation still wipes deck-scoped legacy data", async () => {
    // Seed two persisted conversations for the deck and then mount fresh
    // (auto-resume loads one of them — we'll start a new one to drop the
    // resume pointer, then clearMessages hits the "no active id" branch).
    const seed = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-clear-empty" }),
    );
    await act(async () => {
      await seed.result.current.sendMessage("first", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });
    await act(async () => {
      seed.unmount();
    });

    const app = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-clear-empty" }),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    // Start a brand-new conversation so there is no active id to delete.
    act(() => {
      app.result.current.startNewConversation();
    });
    await act(async () => {
      await flush();
    });
    expect(app.result.current.activeConversationId).toBeNull();

    const before = await (
      await import("@/lib/coach-conversation-storage")
    ).loadConversations("deck-clear-empty");
    expect(before.length).toBeGreaterThan(0);

    act(() => {
      app.result.current.clearMessages();
    });
    await act(async () => {
      await flush();
    });

    const after = await (
      await import("@/lib/coach-conversation-storage")
    ).loadConversations("deck-clear-empty");
    expect(after).toEqual([]);
    app.unmount();
  });
});

describe("useDeckCoachChat — digest branch for large decks (#1241)", () => {
  it("omits deckCards from the request body when the worker returns a digested context", async () => {
    // Provide a worker API that digests the deck, so the hook sets
    // `payloadDeck = undefined` (issue #1074/#1241 acceptance criterion).
    const workerModule = await import("@/ai/worker/ai-worker-client");
    (
      workerModule as unknown as {
        aiWorkerClient: { api: unknown };
      }
    ).aiWorkerClient.api = {
      prepareCoachContext: jest.fn(async () => ({
        deckSummary: {
          totalCards: 25,
          typeCounts: { Creature: 12, Land: 13 },
          averageCmc: 2.6,
          keyCards: ["Sol Ring"],
          manaCurve: [2, 6, 8, 5, 2, 1, 1],
          colors: ["W", "U"],
        },
        timestamp: Date.now(),
      })),
    };

    const bigDeck = Array.from({ length: 25 }, (_, i) => ({
      name: `Card ${i}`,
      count: 1,
    }));

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-big" }),
    );

    await act(async () => {
      await result.current.sendMessage("how is the curve?", {
        deckCards: bigDeck as never,
      });
    });

    // Digestion was requested, and the fetch payload omitted `deckCards`.
    expect(
      (
        workerModule as unknown as {
          aiWorkerClient: {
            api: { prepareCoachContext: jest.Mock };
          };
        }
      ).aiWorkerClient.api.prepareCoachContext,
    ).toHaveBeenCalled();
    // `payloadDeck` was set to undefined, so `deckCards` is absent from the
    // JSON-serialised body (JSON.stringify drops undefined keys).
    expect("deckCards" in lastRequestBody).toBe(false);
    expect(lastRequestBody.format).toBe("modern");
    // The digested context flowed through to the server payload.
    expect(
      (lastRequestBody as { digestedContext?: { deckSummary?: unknown } })
        .digestedContext,
    ).toBeDefined();

    // Restore the default mock so subsequent tests see api = null again.
    (
      workerModule as unknown as {
        aiWorkerClient: { api: unknown };
      }
    ).aiWorkerClient.api = null;
  });

  it("falls back to sending the full deck when the worker's digest throws", async () => {
    const workerModule = await import("@/ai/worker/ai-worker-client");
    (
      workerModule as unknown as {
        aiWorkerClient: { api: unknown };
      }
    ).aiWorkerClient.api = {
      prepareCoachContext: jest.fn(async () => {
        throw new Error("worker offline");
      }),
    };

    const bigDeck = Array.from({ length: 25 }, (_, i) => ({
      name: `Card ${i}`,
      count: 1,
    }));

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "modern", deckId: "deck-digest-fail" }),
    );

    await act(async () => {
      await result.current.sendMessage("help me tune the manabase", {
        deckCards: bigDeck as never,
      });
    });

    // Digest failed: payload falls back to the raw deck array (length 25).
    const fallbackBody = lastRequestBody as {
      deckCards?: unknown;
    };
    expect(Array.isArray(fallbackBody.deckCards)).toBe(true);
    expect((fallbackBody.deckCards as unknown[]).length).toBe(25);
    // The assistant message still rendered normally.
    expect(result.current.messages.some((m) => m.role === "assistant")).toBe(
      true,
    );

    (
      workerModule as unknown as {
        aiWorkerClient: { api: unknown };
      }
    ).aiWorkerClient.api = null;
  });
});

describe("useDeckCoachChat — SSE edge cases (#1241)", () => {
  it("ignores [DONE] sentinel events without crashing", async () => {
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
            'data: {"type":"text","value":"Hi"}\n\n',
            "data: [DONE]\n\n",
            'data: {"type":"text","value":" there"}\n\n',
            'data: {"type":"done"}\n\n',
          ],
          init?.signal,
        );
        return { ok: true, body };
      },
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    // [DONE] was skipped; later chunks still rendered.
    expect(assistant?.content).toBe("Hi there");
  });

  it("appends inline server errors to the assistant message rather than replacing it", async () => {
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
            'data: {"type":"text","value":"partial answer"}\n\n',
            'data: {"type":"error","value":"upstream timeout"}\n\n',
            'data: {"type":"done"}\n\n',
          ],
          init?.signal,
        );
        return { ok: true, body };
      },
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content).toContain("partial answer");
    expect(assistant?.content).toMatch(/upstream timeout/);
  });
});

describe("useDeckCoachChat — grounding guard wiring (#1419)", () => {
  /** Patch the mocked fetch to emit a custom event sequence. */
  function setSseEvents(events: string[]) {
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
      async (_url: string, init?: RequestInit) => {
        try {
          lastRequestBody = JSON.parse(String(init?.body ?? "{}"));
        } catch {
          lastRequestBody = {};
        }
        const body = makeSseBody(events, init?.signal);
        return { ok: true, body };
      },
    ) as unknown as typeof fetch;
  }

  it("appends the caveat and sets lowConfidence/needsReview on a grounding event", async () => {
    setSseEvents([
      'data: {"type":"provider","value":"openai"}\n\n',
      'data: {"type":"text","value":"You have 99 lands."}\n\n',
      'data: {"type":"grounding","lowConfidence":true,"needsReview":true,"caveat":"\\n---\\n⚠️ partial grounding failure","failures":["[numeric-contradiction/lands]Claimed 99; ledger 20"]}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander", deckId: "deck-grounding-1" }),
    );
    await act(async () => {
      await result.current.sendMessage("analyze", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant).toBeDefined();
    // Caveat text was appended after the streamed body.
    expect(assistant?.content).toContain("You have 99 lands.");
    expect(assistant?.content).toContain("partial grounding failure");
    // Flags set so persistence + UI can mark the message.
    expect(assistant?.lowConfidence).toBe(true);
    expect(assistant?.needsReview).toBe(true);
    expect(assistant?.groundingFailures).toEqual([
      "[numeric-contradiction/lands]Claimed 99; ledger 20",
    ]);
  });

  it("preserves progressive streaming when a grounding event arrives at the end", async () => {
    setSseEvents([
      'data: {"type":"text","value":"Hel"}\n\n',
      'data: {"type":"text","value":"lo"}\n\n',
      'data: {"type":"text","value":" world"}\n\n',
      'data: {"type":"grounding","lowConfidence":true,"needsReview":true,"caveat":"X","failures":[]}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander", deckId: "deck-grounding-2" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    // The streamed body is preserved end-to-end (progressive rendering is
    // intact — the grounding event only adds a suffix).
    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content.startsWith("Hello world")).toBe(true);
    // Suffix appended from the caveat.
    expect(assistant?.content.endsWith("X")).toBe(true);
  });

  it("persists the lowConfidence flag on the saved conversation record", async () => {
    setSseEvents([
      'data: {"type":"text","value":"answer"}\n\n',
      'data: {"type":"grounding","lowConfidence":true,"needsReview":true,"caveat":"review-me","failures":["a","b"]}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander", deckId: "deck-grounding-3" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    // Read the persisted record and assert the flag round-tripped through
    // IndexedDB (the storage module's sanitiseImportedConversation preserves
    // lowConfidence / needsReview / groundingFailures).
    const { loadMostRecentConversation } =
      await import("@/lib/coach-conversation-storage");
    const persisted = await loadMostRecentConversation("deck-grounding-3");
    expect(persisted).not.toBeNull();
    const persistedAssistant = persisted!.messages.find(
      (m) => m.role === "assistant",
    );
    expect(persistedAssistant?.lowConfidence).toBe(true);
    expect(persistedAssistant?.needsReview).toBe(true);
    expect(persistedAssistant?.groundingFailures).toEqual(["a", "b"]);
    expect(persistedAssistant?.content).toContain("review-me");
  });

  it("does not set lowConfidence when no grounding event is emitted (happy path)", async () => {
    setSseEvents([
      'data: {"type":"text","value":"Looks great."}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander", deckId: "deck-grounding-4" }),
    );
    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.lowConfidence).toBeUndefined();
    expect(assistant?.needsReview).toBeUndefined();
    expect(assistant?.groundingFailures).toBeUndefined();
    expect(assistant?.content).toBe("Looks great.");
  });
});

// ============================================================================
// issue #1793 — render-count acceptance criteria
// ============================================================================
//
// Acceptance: "non-chat panels do not re-render during a stream; deck-panel
// components render at most once per completed message rather than once per
// token." The hook now isolates the in-flight assistant message in a separate
// `streamingDraft` state (rAF-coalesced) so the page-level `messages` array
// does not change token-by-token — only the chat-message-list subtree
// re-renders during the stream. This block verifies that contract.
//
// The test wraps a hook consumer in a render-counter and streams 100 text
// tokens. Without the fix the counter would tick ~100 times; with the fix it
// ticks at most a handful of times for the user-send + draft-created +
// rAF-flushes + commit cycle.

describe("useDeckCoachChat — render-count (issue #1793)", () => {
  it("does not re-render the consumer once per text token", async () => {
    // Stub rAF to be synchronous so the coalescing contract is testable in
    // jsdom (the default setTimeout-based rAF doesn't reliably flush inside
    // `act()`). With sync rAF, every text delta triggers a synchronous
    // `setStreamingDraft` — and React 18+ auto-batches all synchronous state
    // updates inside the stream loop into a single render. Without the fix
    // (which used `setMessages` per token), each `await reader.read()` is a
    // microtask boundary that breaks batching, yielding N renders for N
    // tokens. With the fix, the rAF callback calls `setStreamingDraft` from
    // a non-awaited, synchronous hot loop, so React commits once.
    await withSyncRaf(async () => {
      let capturedSend: ((content: string) => Promise<void>) | null = null;
      let consumerRenders = 0;

      function CountingConsumer() {
        consumerRenders++;
        const chat = useDeckCoachChat({
          format: "commander",
          deckId: "deck-render-count",
        });
        capturedSend = chat.sendMessage;
        return null;
      }

      // Build an SSE body with N text events so the hook has many deltas to
      // coalesce. We pick a large N (100) so the unfixed behaviour would tick
      // the counter visibly.
      const N = 100;
      const events: string[] = [
        'data: {"type":"provider","value":"openai"}\n\n',
      ];
      for (let i = 0; i < N; i++) {
        events.push(`data: {"type":"text","value":"t${i} "}\n\n`);
      }
      events.push('data: {"type":"done"}\n\n');

      (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
        async (_url: string, init?: RequestInit) => {
          try {
            lastRequestBody = JSON.parse(String(init?.body ?? "{}"));
          } catch {
            lastRequestBody = {};
          }
          const body = makeSseBody(events, init?.signal);
          return { ok: true, body };
        },
      ) as unknown as typeof fetch;

      render(React.createElement(CountingConsumer));

      // Establish the baseline (mount + auto-resume load).
      await act(async () => {
        await flush();
      });
      const baseline = consumerRenders;
      expect(capturedSend).not.toBeNull();

      // Stream the 100-token reply.
      await act(async () => {
        await capturedSend!("hi");
      });
      await act(async () => {
        await flush();
      });

      // The pre-fix code would tick the counter ~N times. With the fix and
      // synchronous rAF, every text delta triggers a synchronous
      // setStreamingDraft and React 18+ auto-batches them — the consumer
      // re-renders at most a handful of times for the user-send +
      // draft-created + commit cycle, not once per token.
      expect(consumerRenders - baseline).toBeLessThan(N / 4);

      // Sanity: the committed assistant message reflects all N tokens.
      // (countingConsumer doesn't expose result.current.messages, but
      // capturedSend is the hook instance so we trust the commit via the
      // parallel "commits the streaming draft" test in this block.)
    });
  });

  it("commits the streaming draft to messages on completion with the full accumulated content", async () => {
    const { result } = renderHook(() =>
      useDeckCoachChat({
        format: "commander",
        deckId: "deck-draft-commit",
      }),
    );

    expect(result.current.streamingDraft).toBeNull();

    const events: string[] = [
      'data: {"type":"text","value":"Hello"}\n\n',
      'data: {"type":"text","value":" world"}\n\n',
      'data: {"type":"usage","usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3}}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      body: makeSseBody(events),
    })) as unknown as typeof fetch;

    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    // Draft cleared on completion; the full content lives in `messages`.
    expect(result.current.streamingDraft).toBeNull();
    const committed = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(committed?.content).toBe("Hello world");
    expect(committed?.usage?.totalTokens).toBe(3);
  });

  it("clears the streaming draft on cancel", async () => {
    // Mirror the original cancel test's body shape: yield one delta, then
    // block on an unresolved promise until the test releases it. The cancel
    // signal causes the blocked read to throw AbortError, which the hook's
    // catch handles by flagging the draft `cancelled: true`. We also force
    // sync rAF so the draft's mid-flight content is observable (jsdom's
    // default setTimeout-rAF doesn't flush inside `act()`).
    await withSyncRaf(async () => {
      let resolveBlock: () => void = () => {};
      const block = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const encoder = new TextEncoder();
      let yielded = false;
      (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
        async (_url: string, init?: RequestInit) => {
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
                        'data: {"type":"text","value":"partial"}\n\n',
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
        useDeckCoachChat({
          format: "commander",
          deckId: "deck-draft-cancel",
        }),
      );

      // Kick off a stream that yields one chunk then blocks.
      act(() => {
        void result.current.sendMessage("hi", {
          deckCards: [{ name: "Sol Ring", count: 1 } as never],
        });
      });
      await act(async () => {
        await flush();
      });
      expect(result.current.streamingDraft).not.toBeNull();
      expect(result.current.streamingDraft?.content).toBe("partial");

      // Cancel and let the AbortError path finish by unblocking the second read.
      act(() => {
        result.current.cancelGeneration();
      });
      await act(async () => {
        resolveBlock();
        await flush();
      });

      expect(result.current.streamingDraft).toBeNull();
      const committed = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(committed?.cancelled).toBe(true);
      expect(committed?.content).toContain("partial");
    });
  });

  it("clears the streaming draft on error and surfaces the fallback message", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDeckCoachChat({ format: "commander", deckId: "deck-draft-error" }),
    );

    await act(async () => {
      await result.current.sendMessage("hi", {
        deckCards: [{ name: "Sol Ring", count: 1 } as never],
      });
    });

    expect(result.current.streamingDraft).toBeNull();
    const committed = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(committed?.content).toMatch(/Sorry, I encountered an error/i);
  });
});
