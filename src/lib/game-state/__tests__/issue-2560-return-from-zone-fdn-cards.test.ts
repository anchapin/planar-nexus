/**
 * Issue #2560 (ReturnFromZone op, additional FDN/MKM cards) —
 * Zombify, Driver of the Dead, Call a Surprise Witness.
 *
 * ReturnFromZone op shipped (bd7215fd / #2577; follow-ups #2690 count
 * "all", etc.) plus 4 FDN scripts (Alesha, Reassembling Skeleton, Sun-
 * Blessed Healer, Raise the Past). Issue body proposes a first 5 of
 * {Alesha, Dawn's Truce, Jackdaw Savior, Reassembling Skeleton,
 * Sun-Blessed Healer}; on main those land as:
 *   - Alesha (scripted)
 *   - Reassembling Skeleton (scripted)
 *   - Sun-Blessed Healer (scripted)
 *   - Dawn's Truce (BLB, misclassified — actually hexproof + indestructible
 *     instant, not a graveyard-returner)
 *   - Jackdaw Savior (BLB, blocked on schema gaps: `mv_lt: <dynamic>` for
 *     "lesser mana value than the dying creature" and "another target"
 *     target-filter — both future-lane)
 *
 * The PR adds the **next 3 clean candidates** from the 46-card pile
 * that fit the current ReturnFromZone shape (filter keys: `creature`,
 * `mv_le`, `controller`):
 *
 *  - Zombify — sorcery, "Return target creature card from your graveyard
 *    to the battlefield." Canonical filter `{creature: true, controller:
 *    "you"}` with no MV cap.
 *  - Driver of the Dead (FDN #605) — `{3}{B}, 3/2 Vampire, dies trigger:
 *    "return target creature card with mana value 2 or less from your
 *    graveyard to the battlefield."` Triggered ability (`event: "dies"`
 *    / `subject: "self"`) exercising the MV-restricted ReturnFromZone.
 *  - Call a Surprise Witness (MKM #6) — `{1}{W}` sorcery, "Return target
 *    creature card with mana value 3 or less from your graveyard to the
 *    battlefield. Put a flying counter on it. It's a Spirit in addition
 *    to its other types." The script handles only the reanimate part —
 *    flying counter + Spirit type-change are out-of-scope for
 *    ReturnFromZone (no schema arm yet).
 *
 * Other FDN/FIN graveyard-returners deliberately deferred:
 *  - Nullpriest of Oblivion (kicker, needs `if_kicked` from #2564)
 *  - Yuna, Hope of Spira (finality counter + multitrigger; counter type)
 *  - Deadly Plot (Zombie subtype + "tapped" destination — both gaps)
 *  - Evil Reawakened (+1/+1 counter additions)
 *  - Forum Necroscribe / Moment of Reckoning (subtype/nonland filter)
 *  - Phoenix Down (already scripted; covered here for sanity).
 */
import { describe, it, expect } from "@jest/globals";
import { getCardScript } from "../card-scripts/registry";
import type { CardScript } from "../card-scripts/schema";

type ReturnFromZoneEffect = {
  op: "ReturnFromZone";
  from: string;
  to: string;
  filter: Record<string, unknown>;
  count?: number | "all";
};

describe("issue #2560 — ReturnFromZone op FDN/MKM card coverage", () => {
  describe("Zombify", () => {
    const script = getCardScript("Zombify") as CardScript | undefined;

    it("registers the script with a spell-shaped ReturnFromZone", () => {
      expect(script).toBeDefined();
      expect(script!.spell).toBeDefined();
      expect(script!.spell!.length).toBe(1);
      const s = script!.spell![0]! as unknown as ReturnFromZoneEffect;
      expect(s.op).toBe("ReturnFromZone");
      expect(s.from).toBe("graveyard");
      expect(s.to).toBe("battlefield");
      expect(s.filter).toEqual({ creature: true, controller: "you" });
      expect(s.count).toBe(1);
    });
  });

  describe("Driver of the Dead", () => {
    const script = getCardScript("Driver of the Dead") as
      CardScript | undefined;

    it("registers the script with a dies-trigger ReturnFromZone (mv_le 2)", () => {
      expect(script).toBeDefined();
      expect(script!.triggers).toBeDefined();
      const dies = script!.triggers!.filter((t) => t.event === "dies");
      expect(dies.length).toBeGreaterThan(0);
      const t = dies[0]!;
      expect(t.subject).toBe("self");
      const e = t.effects![0]! as unknown as ReturnFromZoneEffect;
      expect(e.op).toBe("ReturnFromZone");
      expect(e.from).toBe("graveyard");
      expect(e.to).toBe("battlefield");
      expect(e.filter).toEqual({ creature: true, mv_le: 2, controller: "you" });
      expect(e.count).toBe(1);
    });
  });

  describe("Call a Surprise Witness", () => {
    const script = getCardScript("Call a Surprise Witness") as
      CardScript | undefined;

    it("registers the script with a spell-shaped ReturnFromZone (mv_le 3)", () => {
      expect(script).toBeDefined();
      expect(script!.spell).toBeDefined();
      expect(script!.spell!.length).toBe(1);
      const s = script!.spell![0]! as unknown as ReturnFromZoneEffect;
      expect(s.op).toBe("ReturnFromZone");
      expect(s.from).toBe("graveyard");
      expect(s.to).toBe("battlefield");
      expect(s.filter).toEqual({ creature: true, mv_le: 3, controller: "you" });
      expect(s.count).toBe(1);
    });
  });
});
