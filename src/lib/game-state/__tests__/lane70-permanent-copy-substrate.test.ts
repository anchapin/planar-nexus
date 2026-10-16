/**
 * Wave 4.8 follow-up 22 lane 70 piece 1/N (#2614 follow-up):
 * "becomes a copy of [X] forever" substrate — the
 * non-EOT-bound copy variant (Clone / Phantasmal Image
 * without the EOT suffix / Sakashima without the EOT suffix).
 *
 * Lanes 75 / 75b / 75c / 75d / 75e shipped the EOT-bound copy
 * + cycle guard variants; lane 70 is the remaining
 * "permanent becomes a copy of [X] until end of game"
 * variant. The v1 minimum for piece 1/N is SUBSTRATE ONLY:
 *
 *  - Schema: `StaticSchema.become_copy.{target|named_card}.
 *    until` extends from `z.literal("end_of_turn")` to
 *    `z.union([literal("end_of_turn"), literal("permanent")])`.
 *    The permanent variant is parseable; the engine
 *    refresh-pass write that applies the permanent overlay
 *    (and the battlefield-leave rollback that drops it)
 *    rides lane 70 piece 2/N.
 *  - CardInstance: a new `copyOfTargetIdPermanent?: string`
 *    field, parallel to the existing `copyOfTargetId`
 *    (EOT) ledger.
 *  - Helpers: `setPermanentCopyOf(card, targetId)` and
 *    `clearPermanentCopyOf(card)` in
 *    `keyword-actions/copy-chain.ts`.
 *
 * The test pattern mirrors the lane 49 / 52 / 55 / 69 /
 * 70 / 71 / 75 / ... `CardScriptSchema.parse +
 * registerCardScripts` shape.
 */
import { describe, it, expect } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  clearPermanentCopyOf,
  setPermanentCopyOf,
} from "../keyword-actions/copy-chain";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

function makeCard(name: string): CardInstance {
  const data = {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Bear",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
  return createCardInstance(
    data,
    "player-a" as CardInstance["controllerId"],
    "player-a" as CardInstance["controllerId"],
  );
}

describe("Lane 70 piece 1/N (follow-up 22): permanent-copy substrate", () => {
  describe("schema — StaticSchema.become_copy.target.until accepts 'permanent'", () => {
    it("parses a target copy static with until: 'permanent' (the new arm)", () => {
      const script: CardScript = CardScriptSchema.parse({
        name: "Test Permanent Copy Source (lane 70 piece 1/N)",
        oracle:
          "As this creature enters the battlefield, you may choose a creature on the battlefield. If you do, this creature enters as a copy of it.",
        // No `enters` arm in v1 (a future piece); we exercise
        // the schema shape via a self-static instead.
        statics: [
          {
            text:
              "This creature is a copy of [chosen permanent] forever.",
            affects: { controller: "you" },
            become_copy: {
              target: "target-card-id-1",
              until: "permanent",
            },
          },
        ],
      });
      const stat = script.statics!.find((s) => s.become_copy !== undefined)!;
      expect(
        (stat.become_copy as { target: string; until: string }).until,
      ).toBe("permanent");
      expect(
        (stat.become_copy as { target: string; until: string }).target,
      ).toBe("target-card-id-1");
    });

    it("still parses a target copy static with until: 'end_of_turn' (regression guard for lane 75)", () => {
      // The union replacement must NOT reject the existing
      // EOT literal; lane 75 / 75a / 75d / 75e statics rely
      // on this shape. A regression here would silently
      // narrow the lane 75 family.
      const script: CardScript = CardScriptSchema.parse({
        name: "Test EOT Copy Source (lane 70 piece 1/N regression)",
        oracle:
          "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
        statics: [
          {
            text:
              "It's a copy of [chosen permanent] until end of turn.",
            affects: { controller: "you" },
            become_copy: {
              target: "target-card-id-2",
              until: "end_of_turn",
            },
          },
        ],
      });
      const stat = script.statics!.find((s) => s.become_copy !== undefined)!;
      expect(
        (stat.become_copy as { target: string; until: string }).until,
      ).toBe("end_of_turn");
    });

    it("parses a named_card copy static with until: 'permanent' (lane 75b permanent variant)", () => {
      // The named_card arm gets the same union
      // replacement. "Becomes a copy of [card name]
      // forever" (Memmnarch without the EOT suffix, etc.).
      const script: CardScript = CardScriptSchema.parse({
        name: "Test Named Permanent Copy Source (lane 70 piece 1/N)",
        oracle: "This creature is a copy of Grizzly Bears forever.",
        statics: [
          {
            text: "This creature is a copy of Grizzly Bears forever.",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "Grizzly Bears" },
              until: "permanent",
            },
          },
        ],
      });
      const stat = script.statics!.find((s) => s.become_copy !== undefined)!;
      const arm = stat.become_copy as {
        named_card: { name: string };
        until: string;
      };
      expect(arm.until).toBe("permanent");
      expect(arm.named_card.name).toBe("Grizzly Bears");
    });

    it("rejects an unknown until value (typos like 'forever' must not silently widen the substrate)", () => {
      // The schema enum guards: only "end_of_turn" and
      // "permanent" are accepted. A typo like "forever"
      // (which IS the English-language duration but is
      // NOT the schema sentinel) must throw so a card
      // script with the wrong string doesn't silently
      // broaden the substrate.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Permanent Copy Typo (lane 70 piece 1/N)",
          oracle: "This creature is a copy of [chosen permanent] forever.",
          statics: [
            {
              text: "This creature is a copy of [chosen permanent] forever.",
              affects: { controller: "you" },
              become_copy: {
                target: "target-card-id-3",
                until: "forever",
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("CardInstance — copyOfTargetIdPermanent field + helpers", () => {
    it("setPermanentCopyOf stamps the field with the targetId", () => {
      const card = makeCard("Test Permanent Copy Target (lane 70 piece 1/N)");
      expect(card.copyOfTargetIdPermanent).toBeUndefined();
      const stamped = setPermanentCopyOf(card, "target-card-id-1");
      expect(stamped.copyOfTargetIdPermanent).toBe("target-card-id-1");
      // Original card unchanged (immutability convention).
      expect(card.copyOfTargetIdPermanent).toBeUndefined();
    });

    it("setPermanentCopyOf is idempotent on the same targetId", () => {
      const card = makeCard("Test Permanent Copy Idempotent (lane 70 piece 1/N)");
      const first = setPermanentCopyOf(card, "target-card-id-2");
      const second = setPermanentCopyOf(first, "target-card-id-2");
      // Same reference returned when the field is already
      // set to the targetId — avoids needless allocation
      // on every refresh pass write.
      expect(second).toBe(first);
    });

    it("setPermanentCopyOf with a new targetId re-stamps the field", () => {
      const card = makeCard("Test Permanent Copy Re-stamp (lane 70 piece 1/N)");
      const first = setPermanentCopyOf(card, "target-card-id-3");
      const second = setPermanentCopyOf(first, "target-card-id-4");
      expect(first.copyOfTargetIdPermanent).toBe("target-card-id-3");
      expect(second.copyOfTargetIdPermanent).toBe("target-card-id-4");
      // Distinct objects (the field actually changed).
      expect(second).not.toBe(first);
    });

    it("clearPermanentCopyOf removes the field (no empty ledger residue)", () => {
      const card = makeCard("Test Permanent Copy Clear (lane 70 piece 1/N)");
      const stamped = setPermanentCopyOf(card, "target-card-id-5");
      expect(stamped.copyOfTargetIdPermanent).toBe("target-card-id-5");
      const cleared = clearPermanentCopyOf(stamped);
      expect(cleared.copyOfTargetIdPermanent).toBeUndefined();
      // The field is GONE (not "" / null) — the
      // immutability convention is "no field if no data",
      // matching `restrictionLedger` /
      // `animatedUntilEndOfTurn` patterns.
      expect("copyOfTargetIdPermanent" in cleared).toBe(false);
    });

    it("clearPermanentCopyOf is a no-op when the field is unset", () => {
      const card = makeCard("Test Permanent Copy Clear Noop (lane 70 piece 1/N)");
      expect(card.copyOfTargetIdPermanent).toBeUndefined();
      const cleared = clearPermanentCopyOf(card);
      // Same reference returned when the field is already
      // unset — defensive against needless allocations.
      expect(cleared).toBe(card);
    });
  });
});