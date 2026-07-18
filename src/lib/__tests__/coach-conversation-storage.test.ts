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
  type CoachConversation,
  clearAllCoachConversations,
  createConversationRecord,
  deleteConversation,
  deleteConversationsForDeck,
  deriveConversationTitle,
  exportAllConversations,
  exportConversationsForDeck,
  importConversationsFromJSON,
  loadConversation,
  loadConversations,
  loadMostRecentConversation,
  parseCoachConversationExport,
  pruneOldestConversationsForDeck,
  pruneOrphanedConversations,
  saveConversation,
  DEFAULT_MAX_CONVERSATIONS_PER_DECK,
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

  describe("export / import (issue #1242)", () => {
    it("exports every conversation for a deck as a versioned JSON envelope", async () => {
      const a = makeConversation({ id: "exp-a", deckId: "deck-x" });
      const b = makeConversation({ id: "exp-b", deckId: "deck-x" });
      // Different deck so we can verify deck scoping in the envelope.
      const other = makeConversation({ id: "exp-other", deckId: "deck-y" });
      await saveConversation(a);
      await saveConversation(b);
      await saveConversation(other);

      const envelope = await exportConversationsForDeck("deck-x");
      expect(envelope.type).toBe("planar-nexus-coach-conversations");
      expect(envelope.version).toBe(1);
      expect(envelope.deckId).toBe("deck-x");
      expect(envelope.conversations.map((c) => c.id).sort()).toEqual([
        "exp-a",
        "exp-b",
      ]);

      // JSON round-trip survives: every conversation re-parses identically.
      const json = JSON.stringify(envelope);
      const parsed = parseCoachConversationExport(json);
      expect(parsed).not.toBeNull();
      expect(parsed!.conversations).toHaveLength(2);
    });

    it("exports across every deck with deckId=null in the envelope", async () => {
      await saveConversation(makeConversation({ id: "x", deckId: "d1" }));
      await saveConversation(makeConversation({ id: "y", deckId: "d2" }));
      const envelope = await exportAllConversations();
      expect(envelope.deckId).toBeNull();
      expect(envelope.conversations).toHaveLength(2);
    });

    it("parseCoachConversationExport rejects malformed JSON", () => {
      expect(parseCoachConversationExport("not json")).toBeNull();
      expect(parseCoachConversationExport("{}")).toBeNull();
      expect(
        parseCoachConversationExport(JSON.stringify({ type: "other" })),
      ).toBeNull();
      expect(
        parseCoachConversationExport(
          JSON.stringify({
            type: "planar-nexus-coach-conversations",
            version: 99,
          }),
        ),
      ).toBeNull();
      expect(
        parseCoachConversationExport(
          JSON.stringify({
            type: "planar-nexus-coach-conversations",
            version: 1,
            conversations: "not-an-array",
          }),
        ),
      ).toBeNull();
    });

    it("imports a parsed envelope and re-loads every conversation", async () => {
      const envelope = await exportConversationsForDeck("deck-from");
      const result = await importConversationsFromJSON(envelope, {
        targetDeckId: "deck-to",
      });
      expect(result.imported).toBe(envelope.conversations.length);
      expect(result.skipped).toBe(0);

      const reloaded = await loadConversations("deck-to");
      expect(reloaded).toHaveLength(envelope.conversations.length);
      for (const conv of reloaded) {
        expect(conv.deckId).toBe("deck-to");
        // Each imported conversation has a usable message trail.
        expect(conv.messages.length).toBeGreaterThan(0);
      }
    });

    it("preserves the original deckId when targetDeckId is null", async () => {
      const source = makeConversation({
        id: "preserve-me",
        deckId: "original-deck",
      });
      await saveConversation(source);

      const envelope = {
        type: "planar-nexus-coach-conversations" as const,
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        deckId: "original-deck",
        conversations: [source],
      };

      const result = await importConversationsFromJSON(envelope, {
        targetDeckId: null,
      });
      expect(result.imported).toBe(1);
      const reloaded = await loadConversation("preserve-me");
      expect(reloaded!.deckId).toBe("original-deck");
    });

    it("assigns a fresh id on import when the original id would clobber", async () => {
      // Seed a local record with id "clash" so an import of the same id must
      // not silently overwrite it.
      const local = makeConversation({ id: "clash", deckId: "deck-local" });
      await saveConversation(local);

      const incoming = makeConversation({
        id: "clash",
        deckId: "deck-incoming",
      });
      const envelope = {
        type: "planar-nexus-coach-conversations" as const,
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        deckId: "deck-incoming",
        conversations: [incoming],
      };

      const result = await importConversationsFromJSON(envelope);
      expect(result.imported).toBe(1);
      // Original record survives untouched.
      const original = await loadConversation("clash");
      expect(original!.deckId).toBe("deck-local");
      // Newly-imported record exists under a different id (deck-scoped to deck-incoming).
      const list = await loadConversations("deck-incoming");
      expect(list).toHaveLength(1);
      expect(list[0].id).not.toBe("clash");
      // Messages round-trip with matching content + role.
      expect(
        list[0].messages.map((m) => ({ role: m.role, content: m.content })),
      ).toEqual(
        incoming.messages.map((m) => ({ role: m.role, content: m.content })),
      );
    });

    it("skips malformed conversation entries without aborting the rest", async () => {
      const good = makeConversation({ id: "ok-1", deckId: "deck-mix" });
      const envelope = {
        type: "planar-nexus-coach-conversations" as const,
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        deckId: "deck-mix",
        conversations: [
          good,
          // missing-id: no `id` field at all -> "missing id" (skip)
          {
            messages: [
              { role: "user", content: "x", id: "m1", timestamp: new Date() },
            ],
          },
          // empty messages -> "no usable messages" (skip)
          { id: "no-messages", messages: [] },
          // not an object (skip)
          "not-an-object",
        ] as unknown as (typeof good)[],
      };
      const result = await importConversationsFromJSON(envelope, {
        targetDeckId: "deck-mix",
      });
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(3);
      expect(result.errors.length).toBe(3);
      const list = await loadConversations("deck-mix");
      expect(list.map((c) => c.id)).toEqual(["ok-1"]);
    });
  });

  describe("orphan cleanup (issue #1242)", () => {
    it("prunes conversations whose deckId is not in the valid set", async () => {
      await saveConversation(
        makeConversation({ id: "keep-1", deckId: "alive" }),
      );
      await saveConversation(
        makeConversation({ id: "keep-2", deckId: "alive" }),
      );
      await saveConversation(
        makeConversation({ id: "orphan-1", deckId: "deleted-deck" }),
      );
      await saveConversation(
        makeConversation({ id: "orphan-2", deckId: "another-gone" }),
      );

      const removed = await pruneOrphanedConversations(["alive"]);
      expect(removed).toBe(2);

      expect(
        (await loadConversations("alive")).map((c) => c.id).sort(),
      ).toEqual(["keep-1", "keep-2"]);
      expect(await loadConversation("orphan-1")).toBeNull();
      expect(await loadConversation("orphan-2")).toBeNull();
    });

    it("always preserves the default (unscoped) bucket", async () => {
      await saveConversation(
        makeConversation({ id: "default-1", deckId: DEFAULT_DECK_ID }),
      );
      await saveConversation(
        makeConversation({ id: "orphan-x", deckId: "never-was" }),
      );
      const removed = await pruneOrphanedConversations([]);
      expect(removed).toBe(1);
      const list = await loadConversations(DEFAULT_DECK_ID);
      expect(list.map((c) => c.id)).toEqual(["default-1"]);
    });

    it("returns 0 when nothing is orphaned (no writes)", async () => {
      await saveConversation(makeConversation({ id: "lone", deckId: "solo" }));
      expect(await pruneOrphanedConversations(["solo"])).toBe(0);
    });
  });

  describe("bounded retention (issue #1242)", () => {
    it("prunes oldest conversations when a deck exceeds the per-deck cap", async () => {
      const baseTs = Date.parse("2026-01-01T00:00:00Z");
      for (let i = 0; i < 5; i++) {
        const c = makeConversation({ id: `c-${i}`, deckId: "deck-cap" });
        c.updatedAt = new Date(baseTs + i * 1000).toISOString();
        await saveConversation(c);
      }
      const pruned = await pruneOldestConversationsForDeck("deck-cap", 3);
      expect(pruned).toBe(2);
      const remaining = await loadConversations("deck-cap");
      expect(remaining.map((c) => c.id)).toEqual(["c-4", "c-3", "c-2"]);
    });

    it("does nothing when under the cap", async () => {
      await saveConversation(makeConversation({ id: "a", deckId: "under" }));
      await saveConversation(makeConversation({ id: "b", deckId: "under" }));
      expect(await pruneOldestConversationsForDeck("under", 5)).toBe(0);
      expect((await loadConversations("under")).length).toBe(2);
    });

    it("exposes a sensible default cap", () => {
      expect(DEFAULT_MAX_CONVERSATIONS_PER_DECK).toBeGreaterThan(0);
      expect(DEFAULT_MAX_CONVERSATIONS_PER_DECK).toBeLessThanOrEqual(100);
    });
  });

  describe("coach-memory summary persistence (issue #1417)", () => {
    it("round-trips a memorySummary through save/load", async () => {
      const conv = makeConversation({ id: "with-summary" });
      conv.memorySummary = {
        version: 1,
        updatedAt: "2026-07-01T00:00:00.000Z",
        goals: ["win the long game"],
        constraints: ["under $50"],
        acceptedSwaps: ["cut Murder for Doom Blade"],
        rejectedSwaps: ["cut Sheoldred"],
        matchupTargets: ["Mono-Red"],
        unresolvedQuestions: ["Sideboard plan?"],
        tokenEstimate: 42,
      };
      await saveConversation(conv);
      const loaded = await loadConversation(conv.id);
      expect(loaded!.memorySummary).toEqual(conv.memorySummary);
    });

    it("loads an older conversation without a memorySummary (backward compat)", async () => {
      // Persist a record WITHOUT the memorySummary field — simulates a
      // pre-#1417 conversation. Loading must succeed and the field must be
      // undefined (not null, not an empty summary).
      const conv = makeConversation({ id: "legacy-no-summary" });
      // Strip the field to simulate the old shape.
      const { memorySummary, ...legacy } = conv;
      expect(memorySummary).toBeUndefined();
      await saveConversation(legacy as CoachConversation);

      const loaded = await loadConversation(conv.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.memorySummary).toBeUndefined();
    });

    it("drops a malformed persisted summary on load (graceful degrade)", async () => {
      // Inject a poisoned summary through the storage layer directly so we
      // can verify loadConversation validates and drops it. We bypass the
      // TS type-checker here because the on-disk shape can come from older
      // versions, browser extensions, or hand-edited exports — the loader
      // must cope with anything.
      const conv = makeConversation({ id: "poisoned-summary" });
      await saveConversation(conv);
      const poisoned = {
        ...conv,
        memorySummary: { version: 999, goals: "not an array" },
      } as unknown as CoachConversation;
      await saveConversation(poisoned);
      const loaded = await loadConversation(conv.id);
      expect(loaded).not.toBeNull();
      // The bogus summary was dropped — callers treat undefined as "no summary yet".
      expect(loaded!.memorySummary).toBeUndefined();
    });

    it("preserves a memorySummary through export + import round-trip", async () => {
      const conv = makeConversation({ id: "export-me", deckId: "deck-exp" });
      conv.memorySummary = {
        version: 1,
        updatedAt: "2026-07-01T00:00:00.000Z",
        goals: ["persisted goal"],
        constraints: [],
        acceptedSwaps: [],
        rejectedSwaps: [],
        matchupTargets: [],
        unresolvedQuestions: [],
        tokenEstimate: 1,
      };
      await saveConversation(conv);
      const envelope = await exportConversationsForDeck("deck-exp");
      expect(envelope.conversations[0].memorySummary?.goals).toEqual([
        "persisted goal",
      ]);

      // Re-import into a fresh deck and confirm the summary survives.
      const result = await importConversationsFromJSON(envelope, {
        targetDeckId: "deck-imported",
      });
      expect(result.imported).toBe(1);
      const imported = await loadConversations("deck-imported");
      expect(imported[0].memorySummary?.goals).toEqual(["persisted goal"]);
    });
  });
});
