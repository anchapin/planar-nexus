/**
 * Issue #2568 (Aura op, FDN/BLB cards) — Untamed Hunger, Unflinching
 * Courage, Feather of Flight.
 *
 * The Aura op shipped (interpreter + AuraSchema + AuraStaticSchema
 * with P/T, keywords, restrictAttack, restrictBlock, restrictUntap,
 * maxBlockers, losesAbilities, etc.). Issue body proposes a first-3
 * of {Pacifism, Witness Protection, Unflinching Courage}, with
 * more to follow. On main those land as:
 *
 *   - Pacifism (scripted)
 *   - Witness Protection (scripted)
 *   - Unflinching Courage (this PR)
 *
 * The Aura op shape used by these scripts is `aura.static` with
 * integer P/T (no count source) and keywords from the
 * `EQUIPMENT_KEYWORDS` enum. We're adding the next 3 candidates
 * from the FDN/BLB list whose oracles fit this static shape:
 *
 *  - Untamed Hunger (FDN #529) — `{2}{B}` Aura. Static:
 *   "Enchanted creature gets +2/+1 and has menace."
 *   PT {power:2, toughness:1}, keywords ["menace"].
 *  - Unflinching Courage (FDN #722) — `{1}{G}{W}` Aura. Static:
 *   "Enchanted creature gets +2/+2 and has trample and lifelink."
 *   PT {power:2, toughness:2}, keywords ["trample", "lifelink"].
 *  - Feather of Flight (BLB) — `{U}` Aura with ETB draw trigger.
 *   Static: "Enchanted creature gets +1/+0 and has flying."
 *   PT {power:1, toughness:0}, keywords ["flying"]; plus the
 *   `triggers: [{ event: "etb", subject: "self", effects: [Draw] }]`
 *   mirroring Meltstrider's Resolve.
 *
 * Out of scope (deferred — not scriptable in the current schema):
 *  - Blanchwood Armor (FDN) — PT = count of Forests you control;
 *    needs a count source for the PT modifier (future-lane arm).
 *  - Angelic Destiny (M12) — type change ("is an Angel in addition
 *    to its other types"); no schema arm for that.
 *  - Confiscate (8ED) — gain control of enchanted permanent;
 *    ownership-change modifier, no schema arm.
 *  - Eaten by Piranhas (FDN #507) — loses all abilities + becomes a
 *    black Skeleton with P/T 0/0; combined `losesAbilities` +
 *    type-rewrite + base P/T — schema supports `losesAbilities`
 *    but the P/T rewrite + type change are gaps.
 *  - Due Diligence (MKM) — ETB on another creature (the
 *    "other than enchanted creature" target filter is a separate
 *    arm).
 *  - Stuck in Summoner's Sanctum (FIN) — "Enchanted creature can't
 *    untap" + sacrifice on damage (damage trigger separate).
 */
import { describe, it, expect } from "@jest/globals";
import { getCardScript } from "../card-scripts/registry";
import type { CardScript } from "../card-scripts/schema";

type AuraStatic = {
  text: string;
  power?: number;
  toughness?: number;
  keywords?: string[];
};

describe("issue #2568 — Aura op FDN/BLB card coverage", () => {
  describe("Untamed Hunger", () => {
    const script = getCardScript("Untamed Hunger") as CardScript | undefined;

    it("registers the script with an Aura static (+2/+1, menace)", () => {
      expect(script).toBeDefined();
      expect(script!.aura).toBeDefined();
      expect(script!.aura!.target).toBe("creature");
      const s = script!.aura!.static as AuraStatic;
      expect(s.power).toBe(2);
      expect(s.toughness).toBe(1);
      expect(s.keywords).toEqual(["menace"]);
    });
  });

  describe("Unflinching Courage", () => {
    const script = getCardScript("Unflinching Courage") as
      CardScript | undefined;

    it("registers the script with an Aura static (+2/+2, trample + lifelink)", () => {
      expect(script).toBeDefined();
      expect(script!.aura).toBeDefined();
      expect(script!.aura!.target).toBe("creature");
      const s = script!.aura!.static as AuraStatic;
      expect(s.power).toBe(2);
      expect(s.toughness).toBe(2);
      expect(s.keywords).toEqual(["trample", "lifelink"]);
    });
  });

  describe("Feather of Flight", () => {
    const script = getCardScript("Feather of Flight") as CardScript | undefined;

    it("registers the script with an Aura static (+1/+0, flying) plus ETB draw", () => {
      expect(script).toBeDefined();
      expect(script!.aura).toBeDefined();
      expect(script!.aura!.target).toBe("creature");
      const s = script!.aura!.static as AuraStatic;
      expect(s.power).toBe(1);
      expect(s.toughness).toBe(0);
      expect(s.keywords).toEqual(["flying"]);

      // ETB draw trigger (matches Meltstrider's Resolve pattern).
      expect(script!.triggers).toBeDefined();
      const etb = script!.triggers!.filter((t) => t.event === "etb");
      expect(etb.length).toBe(1);
      expect(etb[0]!.subject).toBe("self");
      expect(etb[0]!.effects![0]!.op).toBe("Draw");
    });
  });
});
