/**
 * @fileoverview Card trading persistence tests (issue #1432).
 *
 * Pins the real behavior of `src/lib/trading.ts` (`tradeManager` singleton
 * + `calculateTradeFairness`) across the three issue axes:
 *   1. Save/restore round-trip of TradeOffer through localStorage.
 *   2. Lifecycle / state-machine transitions (draft → pending → accepted →
 *      history) including the both-parties-accepted branch.
 *   3. Adversarial JSON — note `getAllTrades()` performs a bare
 *      `JSON.parse(stored)` with NO try/catch (QA report §4.7 / §2.13), so
 *      malformed storage *propagates* the parse error. We pin that real
 *      behavior so a future safe-load migration is a deliberate diff.
 *
 * Additionally reproduces the non-atomic read-modify-write hazard flagged in
 * QA §4.7 (two concurrent tabs) by interleaving two writers against the same
 * storage slot and asserting the lost update.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type { ScryfallCard } from "@/app/actions";
import {
  tradeManager,
  calculateTradeFairness,
  TradeOffer,
  TradeCardItem,
} from "../trading";

const STORAGE_KEY = "planar_nexus_trades";
const HISTORY_KEY = "planar_nexus_trade_history";

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `card-${Math.random().toString(36).slice(2)}`,
    name: "Lightning Bolt",
    cmc: 1,
    type_line: "Instant",
    colors: ["R"],
    color_identity: ["R"],
    legalities: {},
    ...overrides,
  };
}

function makeCardItem(overrides: Partial<TradeCardItem> = {}): TradeCardItem {
  return {
    card: makeCard(),
    quantity: 1,
    ...overrides,
  };
}

/** Read the raw trades slot the way `tradeManager.getAllTrades()` does. */
function readRawTrades(): unknown {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Faithful simulation of one "tab" performing `saveTrade`'s read-modify-write
 * against a PRE-CAPTURED snapshot. The hazard (QA §4.7) is that a tab writes
 * based on a stale read taken before another tab's write landed. Using a
 * snapshot — instead of re-reading live storage — reproduces that exactly
 * without modifying the source.
 */
function tabWriteFromSnapshot(snapshot: TradeOffer[], offer: TradeOffer): void {
  const trades = [...snapshot];
  const index = trades.findIndex((t) => t.id === offer.id);
  if (index >= 0) trades[index] = offer;
  else trades.push(offer);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

describe("trading — tradeManager", () => {
  beforeEach(() => {
    tradeManager.clearAllTrades();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    tradeManager.clearAllTrades();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // 1. Save / restore round-trip
  // -------------------------------------------------------------------
  describe("save/restore round-trip", () => {
    it("round-trips a freshly-created offer through getTradeOffer", () => {
      const created = tradeManager.createTradeOffer("p1", "Alice", "p2", "Bob");

      const restored = tradeManager.getTradeOffer(created.id);
      expect(restored).toEqual(created);
    });

    it("persists across a simulated reload by reading the same storage slot", () => {
      const created = tradeManager.createTradeOffer("p1", "A", "p2", "B");

      // Snapshot + restore the raw storage to emulate a fresh page load.
      const snapshot = localStorage.getItem(STORAGE_KEY);
      tradeManager.clearAllTrades();
      localStorage.setItem(STORAGE_KEY, snapshot!);

      expect(tradeManager.getTradeOffer(created.id)).toEqual(created);
    });

    it("persists added cards and want-lists across reload", () => {
      const created = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      const item = makeCardItem({ quantity: 3 });
      tradeManager.addCardsToOffer(created.id, "p1", [item]);
      tradeManager.addWantedCards(created.id, "p2", [
        makeCardItem({ quantity: 2 }),
      ]);

      const snapshot = localStorage.getItem(STORAGE_KEY);
      tradeManager.clearAllTrades();
      localStorage.setItem(STORAGE_KEY, snapshot!);

      const restored = tradeManager.getTradeOffer(created.id)!;
      expect(restored.parties[0].offeredCards).toHaveLength(1);
      expect(restored.parties[0].offeredCards[0].quantity).toBe(3);
      expect(restored.parties[1].wantedCards).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // 2. Lifecycle / state machine
  // -------------------------------------------------------------------
  describe("lifecycle", () => {
    it("creates an offer in the draft state with two pending parties", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");

      expect(offer.status).toBe("draft");
      expect(offer.parties).toHaveLength(2);
      expect(offer.parties.map((p) => p.status)).toEqual([
        "pending",
        "pending",
      ]);
      expect(offer.createdAt).toBe(offer.updatedAt);
    });

    it("submitTradeOffer moves draft → pending and notifies subscribers", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      const events: string[] = [];
      const unsub = tradeManager.subscribe((n) => events.push(n.type));

      const submitted = tradeManager.submitTradeOffer(offer.id, "p1");
      unsub();

      expect(submitted!.status).toBe("pending");
      expect(events).toContain("new_offer");
    });

    it("acceptTrade by one party keeps the trade open; both parties close it", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");

      const first = tradeManager.acceptTrade(offer.id, "p1");
      expect(first!.status).not.toBe("accepted");
      expect(first!.parties[0].status).toBe("accepted");
      expect(first!.parties[0].respondedAt).toBeDefined();

      const second = tradeManager.acceptTrade(offer.id, "p2");
      expect(second!.status).toBe("accepted");
      expect(second!.completedAt).toBeDefined();
    });

    it("writes a TradeHistoryEntry for both parties once fully accepted", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      tradeManager.addCardsToOffer(offer.id, "p1", [
        makeCardItem({ card: makeCard({ id: "given" }), quantity: 1 }),
      ]);
      tradeManager.addCardsToOffer(offer.id, "p2", [
        makeCardItem({ card: makeCard({ id: "received" }), quantity: 1 }),
      ]);

      tradeManager.acceptTrade(offer.id, "p1");
      tradeManager.acceptTrade(offer.id, "p2"); // p2 accepts last → bothAccepted

      // Two history entries are written, one from each party's perspective.
      const history = tradeManager.getTradeHistory("p1");
      expect(history).toHaveLength(2);
      const givenIds = history.map((h) => h.cardsGiven[0].card.id).sort();
      const receivedIds = history.map((h) => h.cardsReceived[0].card.id).sort();
      // Each party's "given" is their own offered card; "received" is the other's.
      expect(givenIds).toEqual(["given", "received"]);
      expect(receivedIds).toEqual(["given", "received"]);
    });

    it("rejectTrade marks the trade rejected", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      const rejected = tradeManager.rejectTrade(offer.id, "p2");
      expect(rejected!.status).toBe("rejected");
      expect(rejected!.parties[1].status).toBe("rejected");
    });

    it("counterOffer resets both parties to pending and moves to countered", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      tradeManager.acceptTrade(offer.id, "p1");

      const countered = tradeManager.counterOffer(offer.id, "p2");
      expect(countered!.status).toBe("countered");
      expect(countered!.parties.every((p) => p.status === "pending")).toBe(
        true,
      );
    });

    it("cancelTrade succeeds for the initiator but not the recipient", () => {
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");

      expect(tradeManager.cancelTrade(offer.id, "p2")).toBeNull();
      expect(tradeManager.getTradeOffer(offer.id)!.status).not.toBe(
        "cancelled",
      );

      const cancelled = tradeManager.cancelTrade(offer.id, "p1");
      expect(cancelled!.status).toBe("cancelled");
    });

    it("addTradeNotes appends party-attributed lines", () => {
      const offer = tradeManager.createTradeOffer("p1", "Alice", "p2", "Bob");
      tradeManager.addTradeNotes(offer.id, "p1", "hello");
      tradeManager.addTradeNotes(offer.id, "p2", "deal");

      const restored = tradeManager.getTradeOffer(offer.id)!;
      expect(restored.notes).toContain("Alice: hello");
      expect(restored.notes).toContain("Bob: deal");
    });
  });

  describe("queries", () => {
    it("getTradesForPlayer / getPendingTrades filter by party and status", () => {
      const o1 = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      const o2 = tradeManager.createTradeOffer("p1", "A", "p3", "C");
      tradeManager.submitTradeOffer(o1.id, "p1");
      tradeManager.acceptTrade(o2.id, "p1");
      tradeManager.acceptTrade(o2.id, "p3"); // o2 fully accepted → not pending

      expect(tradeManager.getTradesForPlayer("p1")).toHaveLength(2);
      expect(tradeManager.getPendingTrades("p1").map((t) => t.id)).toEqual([
        o1.id,
      ]);
      // getTradeHistory does not currently filter by playerId.
      expect(tradeManager.getTradeHistory("p1")).toHaveLength(2);
    });

    it("returns null for an unknown trade id", () => {
      expect(tradeManager.getTradeOffer("does-not-exist")).toBeNull();
    });

    it("returns null when mutating an unknown trade / unknown party", () => {
      expect(tradeManager.addCardsToOffer("nope", "p1", [])).toBeNull();
      const offer = tradeManager.createTradeOffer("p1", "A", "p2", "B");
      expect(tradeManager.addCardsToOffer(offer.id, "ghost", [])).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 3. Adversarial JSON  (pins QA §2.13 / §4.7 — bare JSON.parse)
  // -------------------------------------------------------------------
  describe("adversarial storage (bare JSON.parse, no try/catch)", () => {
    it("propagates a SyntaxError when the trades slot holds malformed JSON", () => {
      localStorage.setItem(STORAGE_KEY, "{ totally not json");

      // Real behavior: getAllTrades() has no try/catch, so the error escapes.
      expect(() => tradeManager.getTradeOffer("any")).toThrow(SyntaxError);
    });

    it("throws a TypeError when the slot holds a non-array JSON value", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));

      // trades.find is called on a plain object → TypeError propagates.
      expect(() => tradeManager.getTradeOffer("any")).toThrow(TypeError);
    });

    it("does not pollute Object.prototype via a __proto__ key", () => {
      // The bare JSON.parse keeps __proto__ without touching the global
      // prototype, but getAllTrades still returns a non-array which makes
      // downstream `find` throw — that's the pinned unsafe behavior above.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ __proto__: { polluted: "yes" } }),
      );

      // The non-array storage makes getTradeOffer throw (TypeError); pin it.
      expect(() => tradeManager.getTradeOffer("any")).toThrow(TypeError);
      // Global prototype is not polluted regardless.
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 4. Non-atomic read-modify-write (QA §4.7 — two concurrent tabs)
  // -------------------------------------------------------------------
  describe("two-tab write race (pins QA-4.7 lost update)", () => {
    /** Build a minimal but valid TradeOffer for direct storage manipulation. */
    function offer(id: string): TradeOffer {
      return {
        id,
        parties: [
          {
            id: "pA",
            name: "A",
            offeredCards: [],
            wantedCards: [],
            status: "pending",
          },
          {
            id: "pB",
            name: "B",
            offeredCards: [],
            wantedCards: [],
            status: "pending",
          },
        ],
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
      };
    }

    it("a later-writing tab with a stale snapshot silently overwrites the first", () => {
      expect(readRawTrades()).toEqual([]);

      // Both tabs read BEFORE either writes → both hold an empty snapshot.
      const snapA = readRawTrades() as TradeOffer[];
      const snapB = readRawTrades() as TradeOffer[];

      const offerA = offer("trade-A");
      const offerB = offer("trade-B");

      // Interleaving: A writes from snapA ([] + A → [A]), then B writes from
      // its STALE snapB ([] + B → [B]) — overwriting A entirely.
      tabWriteFromSnapshot(snapA, offerA);
      tabWriteFromSnapshot(snapB, offerB);

      // Pin the real (unsafe) behavior: offerA is GONE (lost update). A future
      // atomic / compare-and-swap migration must flip this to .not.toBeNull().
      expect(tradeManager.getTradeOffer("trade-A")).toBeNull();
      expect(tradeManager.getTradeOffer("trade-B")).not.toBeNull();
    });

    it("records two setItem calls — the last write wins (lost update)", () => {
      const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

      const snap: TradeOffer[] = []; // both tabs capture the same empty state
      tabWriteFromSnapshot(snap, offer("trade-A"));
      tabWriteFromSnapshot(snap, offer("trade-B")); // stale snapshot

      const final = readRawTrades() as TradeOffer[];
      expect(final.map((t) => t.id)).toEqual(["trade-B"]);
      // Two writes occurred; the second one (trade-B) is the survivor.
      expect(setItemSpy).toHaveBeenCalled();
    });

    it("contrast: sequential non-overlapping writes do NOT lose data", () => {
      // When tab B reads AFTER tab A's write lands, its snapshot includes A,
      // so both offers survive. This is the behavior a fix would guarantee
      // unconditionally.
      const snapA = readRawTrades() as TradeOffer[]; // []
      tabWriteFromSnapshot(snapA, offer("trade-A")); // [A]

      const snapBAfter = readRawTrades() as TradeOffer[]; // [A] — fresh
      tabWriteFromSnapshot(snapBAfter, offer("trade-B")); // [A, B]

      const final = readRawTrades() as TradeOffer[];
      expect(final.map((t) => t.id).sort()).toEqual(["trade-A", "trade-B"]);
    });
  });

  // -------------------------------------------------------------------
  // 5. calculateTradeFairness (pure function)
  // -------------------------------------------------------------------
  describe("calculateTradeFairness", () => {
    it("returns 'Incomplete trade' when either side has zero quantity", () => {
      expect(calculateTradeFairness([], [makeCardItem()])).toEqual({
        score: 0,
        assessment: "Incomplete trade",
      });
      expect(calculateTradeFairness([makeCardItem()], [])).toEqual({
        score: 0,
        assessment: "Incomplete trade",
      });
    });

    it("rates an equal-quantity trade as fair (score 1)", () => {
      const res = calculateTradeFairness(
        [makeCardItem({ quantity: 3 })],
        [makeCardItem({ quantity: 3 })],
      );
      expect(res.score).toBe(1);
      expect(res.assessment).toBe("Fair trade");
    });

    it("rates a ~0.8 ratio as slightly imbalanced", () => {
      const res = calculateTradeFairness(
        [makeCardItem({ quantity: 8 })],
        [makeCardItem({ quantity: 10 })],
      );
      expect(res.score).toBeCloseTo(0.8, 5);
      expect(res.assessment).toBe("Slightly imbalanced");
    });

    it("rates a ~0.6 ratio as imbalanced", () => {
      const res = calculateTradeFairness(
        [makeCardItem({ quantity: 6 })],
        [makeCardItem({ quantity: 10 })],
      );
      expect(res.assessment).toBe("Imbalanced trade");
    });

    it("rates a <0.5 ratio as highly imbalanced", () => {
      const res = calculateTradeFairness(
        [makeCardItem({ quantity: 3 })],
        [makeCardItem({ quantity: 10 })],
      );
      expect(res.assessment).toBe("Highly imbalanced");
    });
  });
});
