/**
 * Issue #2562 (SearchLibrary op, FDN cards) — Expedition Map + Rune-Scarred Demon.
 *
 * SearchLibrary op shipped (d81bb36 / #2574, follow-ups #2584 tapped,
 * #2587 count up to 2, #2594 OR filter). This issue was kept open for
 * further FDN card coverage — the two below are the next-priority FDN
 * tutors whose only remaining blocker is "script it as SearchLibrary"
 * per docs/card-scripts/drafts/fdn.md §1.
 *
 *  - Expedition Map: `{2}, {T}, Sacrifice this artifact: Search your
 *    library for a land card, put it into your hand, then shuffle.`
 *    SearchLibrary with `filter: { land: true }`, `destination: "hand"`,
 *    `count: 1`, sacrifice-self activation cost.
 *  - Rune-Scarred Demon: ETB → search library for any card, put into
 *    hand, shuffle. The "any card" filter uses `or: [...]` of the four
 *    permanent types + basic land (the `or` arm shipped in #2594).
 *
 * Out of scope (blocked on follow-ups):
 *  - Fierce Empath (`mv_ge` filter not in #2562 scope; #2587 added `mv_le`)
 *  - Circuitous Route (`gate` subtype filter not yet a SearchLibrary key)
 *  - Wishclaw Talisman (multi-player `opponent` search)
 *  - Hoarding Dragon (exile-and-return-on-leaves compound; #2560 lane)
 *  - Grow from the Ashes (kicker; #2564 lane)
 */
import { describe, it, expect } from "@jest/globals";
import { getCardScript } from "../card-scripts/registry";
import type { CardScript } from "../card-scripts/schema";

type SearchLibraryEffect = {
  op: "SearchLibrary";
  filter: { or?: Array<Record<string, unknown>> } & Record<string, unknown>;
  destination: string;
  count?: number;
  shuffle?: boolean;
};

describe("issue #2562 — SearchLibrary op FDN card coverage", () => {
  describe("Expedition Map", () => {
    const script = getCardScript("Expedition Map") as CardScript | undefined;

    it("registers the script with an activated SearchLibrary", () => {
      expect(script).toBeDefined();
      expect(script!.activated).toBeDefined();
      expect(script!.activated!.length).toBe(1);
      const a = script!.activated![0]!;
      expect(a.cost.tap).toBe(true);
      expect(a.cost.sacrifice).toBe(true);
      const e = a.effects![0]! as unknown as SearchLibraryEffect;
      expect(e.op).toBe("SearchLibrary");
      expect(e.filter).toEqual({ land: true });
      expect(e.destination).toBe("hand");
      expect(e.count).toBe(1);
      expect(e.shuffle).toBe(true);
    });

    it("does not accept the legacy `reveal` field on the SearchLibrary effect", () => {
      // Per ops/search-library.ts the searcher reference explicitly notes
      // reveal is "not modeled" — gating this with a script-level check
      // keeps the next agent from re-adding it.
      const a = script!.activated![0]!;
      expect(a.effects![0]!).not.toHaveProperty("reveal");
    });
  });

  describe("Rune-Scarred Demon", () => {
    const script = getCardScript("Rune-Scarred Demon") as
      CardScript | undefined;

    it("registers the script with an ETB SearchLibrary using `or` filter", () => {
      expect(script).toBeDefined();
      expect(script!.triggers).toBeDefined();
      const etb = script!.triggers!.filter((t) => t.event === "etb");
      expect(etb.length).toBeGreaterThan(0);
      const t = etb[0]!;
      expect(t.subject).toBe("self");
      const e = t.effects![0]! as unknown as SearchLibraryEffect;
      expect(e.op).toBe("SearchLibrary");
      expect(e.filter.or).toBeDefined();
      expect(e.filter.or!.length).toBeGreaterThanOrEqual(4);
      // Each sub-filter is exactly one type-key (so OR covers the four
      // permanent types + basic land — every card the ETB can hit).
      for (const sub of e.filter.or!) {
        expect(Object.keys(sub)).toHaveLength(1);
      }
      expect(e.destination).toBe("hand");
      expect(e.count).toBe(1);
      expect(e.shuffle).toBe(true);
    });
  });
});
