/**
 * @fileoverview Tests for coach conversation IndexedDB persistence (issue #1074).
 *
 * Asserts the full local-first contract:
 *  - save/load/delete round-trip
 *  - persistence across a simulated reload (new storage read after "restart")
 *  - deck context is stored alongside messages (self-contained resume)
 *  - quota-exceeded writes degrade gracefully (no throw, typed result)
 *  - listing is deck-scoped and newest-first
 *  - auto-resume picks the most-recent conversation
 *
 * `fake-indexeddb` (loaded in jest.setup.js) backs the IndexedDB layer.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type { ChatMessage } from "@/types/chat";
import {
  COACH_CONVERSATION_STORE,
  DEFAULT_DECK_ID,
  clearAllCoachConversations,
  createConversationRecord,
  deleteConversation,
  deleteConversationsForDeck,
  deriveConversationTitle,
  loadConversation,
  loadConversations,
  loadMostRecentConversation,
  saveConversation,
} from "../coach-conversation-storage";

function msg(
  partial: Partial<ChatMessage> & { role: ChatMessage["role"] },
): ChatMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    content: "hello",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

function makeConversation(
  overrides: Partial<Parameters<typeof createConversationRecord>[0]> = {},
) {
  return createConversationRecord({
    id: overrides.id ?? `c-${Math.random().toString(36).slice(2)}`,
    deckId: overrides.deckId ?? DEFAULT_DECK_ID,
    messages: overrides.messages ?? [
      msg({ role: "user", content: "How do I beat aggro?" }),
      msg({ role: "assistant", content: "Add more cheap interaction." }),
    ],
    deckContext: overrides.deckContext ?? {
      format: "modern",
      archetype: "control",
      deckCards: [],
    },
    ...overrides,
  });
}

describe("coach-conversation-storage", () => {
  beforeEach(async () => {
    await clearAllCoachConversations();
  });

  afterEach(async () => {
    await clearAllCoachConversations();
  });

  describe("deriveConversationTitle", () => {
    it("uses the first user message, trimmed to one line", () => {
      const title = deriveConversationTitle([
        msg({ role: "assistant", content: "hi" }),
        msg({ role: "user", content: "  What   should I\nsideboard?  " }),
      ]);
      expect(title).toBe("What should I sideboard?");
    });

    it("truncates long titles with an ellipsis", () => {
      const long = "x".repeat(120);
      const title = deriveConversationTitle([
        msg({ role: "user", content: long }),
      ]);
      expect(title.length).toBeLessThanOrEqual(61);
      expect(title.endsWith("…")).toBe(true);
    });

    it("falls back to a default label when there is no user content", () => {
      expect(deriveConversationTitle([])).toBe("New coaching session");
      expect(
        deriveConversationTitle([msg({ role: "assistant", content: "hi" })]),
      ).toBe("New coaching session");
    });
  });

  describe("save / load round-trip", () => {
    it("persists a conversation and reads it back by id", async () => {
      const conv = makeConversation({
        deckContext: { format: "pioneer", archetype: "aggro" },
      });
      const result = await saveConversation(conv);
      expect(result.ok).toBe(true);

      const loaded = await loadConversation(conv.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(conv.id);
      expect(loaded!.deckId).toBe(conv.deckId);
      expect(loaded!.messages).toHaveLength(2);
      // Messages survive the structured-clone round-trip; timestamps normalize
      // back into Date instances.
      expect(loaded!.messages[0].role).toBe("user");
      expect(loaded!.messages[0].content).toBe("How do I beat aggro?");
      expect(loaded!.messages[0].timestamp).toBeInstanceOf(Date);
    });

    it("updates an existing conversation in place (idempotent put)", async () => {
      const conv = makeConversation();
      await saveConversation(conv);

      const updated = {
        ...conv,
        messages: [...conv.messages, msg({ role: "user", content: "thanks" })],
        updatedAt: new Date("2026-02-02T00:00:00Z").toISOString(),
      };
      await saveConversation(updated);

      const list = await loadConversations(conv.deckId);
      expect(list).toHaveLength(1);
      expect(list[0].messages).toHaveLength(3);
    });

    it("round-trips streaming-era message fields (provider/usage/cancelled)", async () => {
      const conv = makeConversation({
        messages: [
          msg({ role: "user", content: "q" }),
          msg({
            role: "assistant",
            content: "a",
            provider: "openai",
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
            cancelled: true,
          }),
        ],
      });
      await saveConversation(conv);
      const loaded = await loadConversation(conv.id);
      const a = loaded!.messages[1];
      expect(a.provider).toBe("openai");
      expect(a.usage).toEqual({
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      });
      expect(a.cancelled).toBe(true);
    });
  });

  describe("listing & deck scoping", () => {
    it("lists conversations for a deck newest-first", async () => {
      const a = makeConversation({ id: "a", deckId: "deck-1" });
      const b = makeConversation({ id: "b", deckId: "deck-1" });
      const other = makeConversation({ id: "other", deckId: "deck-2" });
      // Insert a first, then b with a later updatedAt so b should sort first.
      a.updatedAt = "2026-01-01T00:00:00Z";
      b.updatedAt = "2026-06-01T00:00:00Z";
      await saveConversation(a);
      await saveConversation(b);
      await saveConversation(other);

      const list = await loadConversations("deck-1");
      expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    });

    it("isolates decks (one deck does not see another's conversations)", async () => {
      await saveConversation(makeConversation({ id: "x", deckId: "d1" }));
      await saveConversation(makeConversation({ id: "y", deckId: "d2" }));
      expect((await loadConversations("d1")).map((c) => c.id)).toEqual(["x"]);
      expect((await loadConversations("d2")).map((c) => c.id)).toEqual(["y"]);
    });

    it("auto-resumes the most recent conversation for a deck", async () => {
      await saveConversation(makeConversation({ id: "old", deckId: "d1" }));
      const recent = makeConversation({ id: "recent", deckId: "d1" });
      recent.updatedAt = "2026-09-01T00:00:00Z";
      await saveConversation(recent);

      const got = await loadMostRecentConversation("d1");
      expect(got!.id).toBe("recent");
      expect(got!.messages.length).toBeGreaterThan(0);
    });

    it("returns null when there is nothing to resume", async () => {
      expect(await loadMostRecentConversation("empty-deck")).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes a single conversation by id", async () => {
      const conv = makeConversation({ id: "doomed" });
      await saveConversation(conv);
      expect(await loadConversation("doomed")).not.toBeNull();

      await deleteConversation("doomed");
      expect(await loadConversation("doomed")).toBeNull();
    });

    it("deletes every conversation for a deck", async () => {
      await saveConversation(makeConversation({ id: "k1", deckId: "dk" }));
      await saveConversation(makeConversation({ id: "k2", deckId: "dk" }));
      await saveConversation(makeConversation({ id: "keep", deckId: "other" }));

      await deleteConversationsForDeck("dk");
      expect(await loadConversations("dk")).toHaveLength(0);
      expect((await loadConversations("other")).map((c) => c.id)).toEqual([
        "keep",
      ]);
    });
  });

  describe("persistence across a simulated reload", () => {
    it("survives a fresh read after the in-memory state is dropped", async () => {
      // Write a conversation (simulating a completed chat turn).
      const conv = makeConversation({
        id: "persist-me",
        deckContext: { format: "legacy", archetype: "combo", deckCards: [] },
      });
      const saved = await saveConversation(conv);
      expect(saved.ok).toBe(true);

      // Simulate app restart: drop all in-memory references and re-read from
      // storage as the hook's mount effect would.
      const resumed = await loadMostRecentConversation(conv.deckId);
      expect(resumed!.id).toBe("persist-me");
      expect(resumed!.deckContext.format).toBe("legacy");
      expect(resumed!.messages.map((m) => m.content)).toEqual([
        "How do I beat aggro?",
        "Add more cheap interaction.",
      ]);
    });
  });

  describe("deck context is stored", () => {
    it("preserves format/archetype/strategy/cards on the conversation", async () => {
      const conv = makeConversation({
        deckContext: {
          format: "commander",
          archetype: "tokens",
          strategy: "go-wide",
          deckCards: [{ id: "1", name: "Sol Ring", count: 1 } as never],
        },
      });
      await saveConversation(conv);
      const loaded = await loadConversation(conv.id);
      expect(loaded!.deckContext.format).toBe("commander");
      expect(loaded!.deckContext.archetype).toBe("tokens");
      expect(loaded!.deckContext.strategy).toBe("go-wide");
      expect(loaded!.deckContext.deckCards).toHaveLength(1);
    });
  });

  describe("graceful quota handling", () => {
    it("returns a typed QuotaExceededError result instead of throwing", async () => {
      // Force the underlying IndexedDB put to reject with a quota error. We
      // return a minimal fake IDBRequest that fires ONLY `onerror`, so the
      // storage layer's `request.onerror` handler classifies + rejects (the
      // real fake-indexeddb request would otherwise fire onsuccess first).
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
        const conv = makeConversation();
        const result = await saveConversation(conv);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // The classified error is recognisable as quota-related.
          expect(result.error.name).toBe("QuotaExceededError");
          // The store name is annotated so the UI can reference it.
          expect((result.error as { storeName?: string }).storeName).toBe(
            COACH_CONVERSATION_STORE,
          );
        }
        // Critical: it did not throw, so the in-session coach would keep going.
      } finally {
        IDBObjectStore.prototype.put = realPut;
      }
    });
  });
});
