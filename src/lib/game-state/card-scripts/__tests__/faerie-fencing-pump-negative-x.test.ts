/**
 * Faerie Fencing — `{X}{B}` Instant — "Target creature gets -X/-X until
 * end of turn." (card-scripts pump-X lane — references #2552.)
 *
 * Engine plumbing for X in spell effects was shipped in PR #2601 /
 * #2570 (#2552 lane 1, commit f944bfee). The Pump op's `power` and
 * `toughness` already accept `xPump` (= `number | "X" | "-X" | "+X"`),
 * the same X-capable union that powers Primal Might (the canonical
 * +X/-X case) and Slice from the Shadows's `power: "-X"` shape.
 *
 * This test pins the **registry exposure** for Faerie Fencing and the
 * **`withX` substitution** for its `Pump power: "-X" / toughness: "-X"`
 * effect. The full state-level resolution (layer-7 P/T delta + cleanup
 * at end of turn + choosing a creature target from the battlefield) is
 * owned by `card-scripts.test.ts`'s scripted-Pump suite. The
 * Faerie-controlled-at-cast conditional `-3/-3` is **not** scriptable
 * today and belongs to a future lane (likely 1c `extra conditional P/T
 * adjustments` — see #2832 follow-up).
 */
import { getCardScript } from "../index";
import type { CardEffect } from "../schema";
import { withX } from "../interpret";

describe("Faerie Fencing (#2552 lane 2): X-cost pump -X/-X instant", () => {
  it("registry exposes Faerie Fencing with a pump -X/-X implicitly-end-of-turn effect", () => {
    const ff = getCardScript("Faerie Fencing");
    expect(ff).toBeDefined();
    const spell = ff!.spell!;
    expect(spell).toHaveLength(1);
    expect(spell[0].op).toBe("Pump");
    if (spell[0].op !== "Pump") throw new Error("narrow");
    // Pump on a Spell uses xPump: power/toughness = number | "X" | "-X" | "+X".
    // Pump deltas are implicitly end-of-turn per #2552 lane 1 plumbing
    // (f944bfee — see `GiantGrowth` and `Adamant Will` for shape).
    expect(spell[0].power).toBe("-X");
    expect(spell[0].toughness).toBe("-X");
    expect(spell[0].target).toBe("creature");
    // P/T Pump has no until field — duration is always end-of-turn.
    expect(
      (spell[0] as unknown as Record<string, unknown>).until,
    ).toBeUndefined();
  });

  it("Pump power/toughness: '-X' is accepted by the schema (xPump union)", () => {
    // Synthetic Pump effect mirroring Faerie Fencing's effect.
    const pump: CardEffect = {
      op: "Pump",
      power: "-X",
      toughness: "-X",
      target: "creature",
    };
    expect(pump.power).toBe("-X");
    expect(pump.toughness).toBe("-X");
  });

  it("withX substitutes X=3 into both power and toughness (Pump -X/-X)", () => {
    const ff = getCardScript("Faerie Fencing")!;
    const effect = ff.spell![0];
    expect(effect.op).toBe("Pump");

    const resolved = withX(effect, 3) as unknown as Record<string, unknown>;

    expect(resolved.power).toBe(-3);
    expect(resolved.toughness).toBe(-3);
    expect(resolved.target).toBe("creature");
    expect(typeof resolved.power).toBe("number");
    expect(typeof resolved.toughness).toBe("number");
  });

  it("withX substitutes X=0 (CR 107.3 default) and X=7", () => {
    const ff = getCardScript("Faerie Fencing")!;
    const effect = ff.spell![0];
    expect(effect.op).toBe("Pump");

    const zero = withX(effect, 0) as unknown as Record<string, unknown>;
    const big = withX(effect, 7) as unknown as Record<string, unknown>;

    // `withX("-X", 0)` returns -0 (which is the same effective P/T delta as 0,
    // but Object.is distinguishes them; we assert via signed arithmetic).
    expect((zero.power as number) | 0).toBe(0);
    expect((zero.toughness as number) | 0).toBe(0);
    expect(big.power).toBe(-7);
    expect(big.toughness).toBe(-7);
  });
});
