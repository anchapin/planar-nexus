/**
 * Wave 4.8 follow-up 27 lane 71 piece 2/N (#2614 follow-up):
 * per-quality sources consult (DERIVED view of the
 * per-source ledger).
 *
 * The lane 71 piece 1/N (follow-up 25) substrate
 * stamps `protectionFromBySource: Record<sourceId,
 * string[]>` onto every affected target — multiple
 * simultaneous protection-granting sources keep
 * per-source quality arrays (multi-cast enforcement).
 *
 * The follow-up 27 piece 2/N derived helper
 * `getProtectionSourcesByQuality` reads the piece 1/N
 * ledger ONCE and returns the INVERTED view:
 * `Record<quality, sourceId[]>`. The helper is
 * READ-ONLY — it does NOT stamp or write any field.
 *
 * The new helper is INTERNAL-USE convenience for
 * callers that want to ask "which sources granted
 * red?" or "which sources granted blue?" without
 * iterating sources. The authoritative substrate
 * remains the per-source ledger (used by
 * `targeting-validation.isProtectedFromSource`,
 * `evergreen-keywords.isProtectedFromSource`, and
 * the `getProtectionQualitiesForSource` per-source
 * helper).
 */
import { describe, it, expect } from "@jest/globals";
import { createCardInstance } from "../card-instance";
import { getProtectionSourcesByQuality } from "../keyword-actions/protection";
import type { CardInstance, ScryfallCard } from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): CardInstance {
  const data = {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Creature",
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
  return createCardInstance(
    data,
    "player-a" as CardInstance["controllerId"],
    "player-a" as CardInstance["controllerId"],
  );
}

describe("Lane 71 piece 2/N (follow-up 27) — per-Quality sources derived consult", () => {
  describe("getProtectionSourcesByQuality — inverted index from per-source ledger", () => {
    it("returns { red: [sourceA], blue: [sourceB] } for the multi-cast substrate", () => {
      // The multi-cast substrate: target granted
      // protection from two simultaneous Auras —
      // source A grants `protection from red` and
      // source B grants `protection from blue`. The
      // per-quality consult returns the INVERTED
      // view (quality → list of sources), NOT the
      // union, NOT an empty object, NOT the per-
      // source ledger shape.
      const target = makeCard({ id: "target-per-quality-multi-cast" });
      const stamped = {
        ...target,
        protectionFrom: ["red", "blue"],
        protectionFromBySource: {
          "source-a": ["red"],
          "source-b": ["blue"],
        },
      };
      const got = getProtectionSourcesByQuality(stamped);
      expect(got).toEqual({
        red: ["source-a"],
        blue: ["source-b"],
      });
    });

    it("returns an empty object when the ledger is unset (vanilla card)", () => {
      // A vanilla card without per-source grants. The
      // consult returns {} (not null, not undefined);
      // callers can safely iterate `Object.keys(...)`.
      const card = makeCard({ id: "vanilla-no-per-source-quality" });
      expect(card.protectionFromBySource).toBeUndefined();
      const got = getProtectionSourcesByQuality(card);
      expect(got).toEqual({});
      // Object.keys on the result is empty.
      expect(Object.keys(got)).toEqual([]);
    });

    it("returns an empty object when the ledger exists but is empty (regression guard)", () => {
      // The ledger is `{}` — no sources stamped. The
      // consult returns {} (distinct from null). The
      // helper does not throw on empty ledgers.
      const target = makeCard({ id: "target-empty-ledger-quality" });
      const stamped = {
        ...target,
        protectionFromBySource: {},
      };
      const got = getProtectionSourcesByQuality(stamped);
      expect(got).toEqual({});
    });

    it("groups multiple sources under the same quality (overlap case)", () => {
      // Two sources both grant `protection from red`
      // (e.g. two Sanctifiers of the Night on the
      // battlefield). The per-quality consult groups
      // both sourceIds under the `red` key, in the
      // iteration order of `Object.keys(ledger)`.
      const target = makeCard({ id: "target-overlap-red-quality" });
      const stamped = {
        ...target,
        protectionFrom: ["red"],
        protectionFromBySource: {
          "source-a": ["red"],
          "source-b": ["red"],
          "source-c": ["blue"],
        },
      };
      const got = getProtectionSourcesByQuality(stamped);
      expect(got.red).toEqual(["source-a", "source-b"]);
      expect(got.blue).toEqual(["source-c"]);
    });

    it("returns a fresh object on every call (no shared mutable state)", () => {
      // The helper must not return a shared cached
      // object that callers could mutate — every call
      // returns a fresh Record. Mutating one result
      // must not affect a subsequent call.
      const target = makeCard({ id: "target-no-shared-mut" });
      const stamped = {
        ...target,
        protectionFromBySource: {
          "source-a": ["red"],
        },
      };
      const first = getProtectionSourcesByQuality(stamped);
      first.red.push("mutation-marker");
      const second = getProtectionSourcesByQuality(stamped);
      expect(second.red).toEqual(["source-a"]);
      // The mutation-marker is on `first` only.
      expect(first.red).toEqual(["source-a", "mutation-marker"]);
    });
  });
});
