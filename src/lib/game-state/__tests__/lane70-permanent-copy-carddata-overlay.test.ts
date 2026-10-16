/**
 * Wave 4.8 follow-up 23 lane 70 piece 2b (#2614 follow-up):
 * the helpers + battlefield-leave cleanup for the
 * `CardInstance.permanentCopyPrintedCardData` snapshot +
 * `restorePermanentCopyOffBattlefield` consult.
 *
 * Piece 2a's test file (`lane70-permanent-copy-refresh-write.test.ts`)
 * exercises the END-TO-END refresh path: source lands on BF,
 * `become_copy: { target, until: "permanent" }` activates,
 * the overlay writes the target's printed characteristics
 * onto the source's `cardData`, the snapshot is captured.
 * This file tests the SUBSTRATE in isolation — the
 * `snapshotPermanentCopyPrintedCardData` / `clearPermanent
 * CopyPrintedCardData` helpers and the
 * `restorePermanentCopyOffBattlefield` consult, separate
 * from the refresh pass. The substrate mirrors lane 51's
 * `permanentTypeOverlay` / `restorePermanentTypeOverlay`
 * pattern (parallel "permanent overlay snapshot" shape —
 * `cardData` snapshot persisted across the
 * `refreshScriptedStatics` calls, restored on a
 * battlefield-leave consult).
 *
 * Test pattern mirrors the lane 51 / lane 70 piece 1/N
 * helper-only tests (in-process, no script registration
 * required — the helpers take an in-memory `CardInstance`
 * directly).
 */
import { describe, it, expect } from "@jest/globals";
import {
  clearPermanentCopyPrintedCardData,
  snapshotPermanentCopyPrintedCardData,
} from "../keyword-actions/copy-chain";
import { restorePermanentCopyOffBattlefield } from "../pt-until-end-of-turn";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

function makeBaseCard(name: string): CardInstance {
  const data: ScryfallCard = {
    id: `mock-carddata-overlay-${name}`,
    name,
    type_line: "Creature — Bear",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    power: "2",
    toughness: "2",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
  return createCardInstance(
    data,
    "player-a" as CardInstance["controllerId"],
    "player-a" as CardInstance["controllerId"],
  );
}

const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-70-2b",
  name: "Grizzly Bears",
  type_line: "Creature — Bear",
  oracle_text: "",
  mana_cost: "{1}{G}",
  cmc: 2,
  colors: ["G"],
  color_identity: ["G"],
  keywords: [],
  power: "2",
  toughness: "2",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

const SHAPESHIFTER_PRINTED: ScryfallCard = {
  id: "mock-shapeshifter-70-2b",
  name: "Test Shapeshifter (lane 70 piece 2b)",
  type_line: "Creature — Shapeshifter",
  oracle_text: "",
  mana_cost: "{3}{U}",
  cmc: 4,
  colors: ["U"],
  color_identity: ["U"],
  keywords: [],
  power: "0",
  toughness: "0",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

describe("Lane 70 piece 2b (follow-up 23): permanent-copy cardData snapshot helpers", () => {
  describe("snapshotPermanentCopyPrintedCardData", () => {
    it("stamps permanentCopyPrintedCardData on a fresh card", () => {
      const card = makeBaseCard("snap-1");
      expect(card.permanentCopyPrintedCardData).toBeUndefined();
      const snapshotted = snapshotPermanentCopyPrintedCardData(
        card,
        SHAPESHIFTER_PRINTED,
      );
      expect(snapshotted.permanentCopyPrintedCardData).toBe(SHAPESHIFTER_PRINTED);
      // Original card unchanged (immutability convention).
      expect(card.permanentCopyPrintedCardData).toBeUndefined();
    });

    it("is idempotent on the same snapshot reference (no needless allocation)", () => {
      const card = makeBaseCard("snap-2");
      const first = snapshotPermanentCopyPrintedCardData(card, SHAPESHIFTER_PRINTED);
      const second = snapshotPermanentCopyPrintedCardData(first, SHAPESHIFTER_PRINTED);
      // Same reference returned when the field is
      // already set to the same snapshot — preserves the
      // "no needless allocation on refresh" pattern from
      // lane 51's `permanentTypeOverlay` helpers.
      expect(second).toBe(first);
    });

    it("re-stamps with a new snapshot reference when the printed cardData changes", () => {
      const card = makeBaseCard("snap-3");
      const stamped = snapshotPermanentCopyPrintedCardData(card, SHAPESHIFTER_PRINTED);
      const reStamped = snapshotPermanentCopyPrintedCardData(stamped, GRIZZLY_BEARS);
      expect(stamped.permanentCopyPrintedCardData).toBe(SHAPESHIFTER_PRINTED);
      expect(reStamped.permanentCopyPrintedCardData).toBe(GRIZZLY_BEARS);
      expect(reStamped).not.toBe(stamped);
    });
  });

  describe("clearPermanentCopyPrintedCardData", () => {
    it("removes the field (no empty ledger residue)", () => {
      const card = makeBaseCard("clear-1");
      const stamped = snapshotPermanentCopyPrintedCardData(card, SHAPESHIFTER_PRINTED);
      expect(stamped.permanentCopyPrintedCardData).toBe(SHAPESHIFTER_PRINTED);
      const cleared = clearPermanentCopyPrintedCardData(stamped);
      expect(cleared.permanentCopyPrintedCardData).toBeUndefined();
      // The field is GONE (not "" / null) — mirrors the
      // `restrictionLedger` / `animatedUntilEndOfTurn`
      // immutability convention ("no field if no data").
      expect("permanentCopyPrintedCardData" in cleared).toBe(false);
    });

    it("is a no-op when the field is unset", () => {
      const card = makeBaseCard("clear-2");
      expect(card.permanentCopyPrintedCardData).toBeUndefined();
      const cleared = clearPermanentCopyPrintedCardData(card);
      // Same reference returned when the field is
      // already unset.
      expect(cleared).toBe(card);
    });
  });

  describe("restorePermanentCopyOffBattlefield", () => {
    it("restores printed cardData + clears ledger + clears snapshot when source leaves the battlefield", () => {
      // The substrate mirrors lane 51's
      // `restorePermanentTypeOverlay` consult (parallel
      // "permanent overlay snapshot" cleanup). When the
      // SOURCE leaves the battlefield, the consult
      // restores `cardData` from the snapshot AND
      // clears both the snapshot field and the
      // permanent-arm ledger.
      const card = makeBaseCard("leaves-1");
      // Simulate the end-of-piece-2a state: source has
      // the overlay applied (cardData = Grizzly Bears)
      // AND the snapshot (permanentCopyPrintedCardData
      // = Shapeshifter printed) AND the ledger
      // (copyOfTargetIdPermanent = "target-id-1").
      const overlaid = {
        ...card,
        cardData: GRIZZLY_BEARS,
        permanentCopyPrintedCardData: SHAPESHIFTER_PRINTED,
        copyOfTargetIdPermanent: "target-id-1",
      } as CardInstance;
      // Source moves out of the battlefield (e.g. dies
      // → goes to graveyard).
      const moved = {
        ...overlaid,
        currentZoneKey: "player-a-graveyard",
      } as CardInstance;
      // Build a minimal GameState — the consult only
      // needs `cards` and doesn't read any other fields.
      const state = {
        cards: new Map<string, CardInstance>([[moved.id, moved]]),
      } as unknown as Parameters<typeof restorePermanentCopyOffBattlefield>[0];
      const after = restorePermanentCopyOffBattlefield(state);
      const restored = after.cards.get(moved.id)!;
      // Printed `cardData` restored from the snapshot.
      expect(restored.cardData).toBe(SHAPESHIFTER_PRINTED);
      // Snapshot field cleared.
      expect(restored.permanentCopyPrintedCardData).toBeUndefined();
      expect("permanentCopyPrintedCardData" in restored).toBe(false);
      // Permanent-arm ledger cleared (parallel — the
      // substrate consult drops the overlay entirely
      // for the source-leaves case).
      expect(restored.copyOfTargetIdPermanent).toBeUndefined();
      expect("copyOfTargetIdPermanent" in restored).toBe(false);
    });

    it("is a no-op when the source is still on the battlefield", () => {
      // Defensive: the consult must NOT touch sources
      // that are still on the battlefield (the
      // `currentZoneKey?.endsWith("-battlefield")`
      // guard). The same-state short-circuit is also
      // verified (the helper returns the SAME state
      // reference when nothing changed).
      const card = makeBaseCard("leaves-2");
      const overlaid = {
        ...card,
        cardData: GRIZZLY_BEARS,
        permanentCopyPrintedCardData: SHAPESHIFTER_PRINTED,
        copyOfTargetIdPermanent: "target-id-2",
      } as CardInstance;
      // Source STILL on the battlefield.
      const bfOverlaid = {
        ...overlaid,
        currentZoneKey: "player-a-battlefield",
      } as CardInstance;
      const cards = new Map<string, CardInstance>([[bfOverlaid.id, bfOverlaid]]);
      const state = {
        cards,
      } as unknown as Parameters<typeof restorePermanentCopyOffBattlefield>[0];
      const after = restorePermanentCopyOffBattlefield(state);
      // The state is unmodified — overlay, snapshot, and
      // ledger all intact.
      expect(after).toBe(state);
      const source = after.cards.get(bfOverlaid.id)!;
      expect(source.cardData).toBe(GRIZZLY_BEARS);
      expect(source.permanentCopyPrintedCardData).toBe(SHAPESHIFTER_PRINTED);
      expect(source.copyOfTargetIdPermanent).toBe("target-id-2");
    });

    it("is a no-op when no card has a permanentCopyPrintedCardData snapshot", () => {
      // Defensive: the consult must NOT rewrite the
      // `cards` map when nothing matches the consult
      // condition. The helper returns the SAME state
      // reference (`cards ? ... : state`) — the
      // follow-up loop's `cards ??=` allocation is
      // skipped in the empty-match case, preserving
      // referential equality on no-op.
      const card = makeBaseCard("leaves-3");
      const cards = new Map<string, CardInstance>([[card.id, card]]);
      const state = {
        cards,
      } as unknown as Parameters<typeof restorePermanentCopyOffBattlefield>[0];
      const after = restorePermanentCopyOffBattlefield(state);
      expect(after).toBe(state);
    });
  });
});
