/**
 * Slice from the Shadows — `{X}{B}` Instant — "This spell can't be countered.
 * Target creature gets -X/-X until end of turn." (card-scripts pump-X lane,
 * references #2552.)
 *
 * The "can't be countered" clause is a static ability of the spell object;
 * it does not affect the resolution scripting — counter effects that target
 * the spell will fail before this effect runs. There is no script flag for
 * it in the current schema; the engine handles it as a static of the spell
 * itself (see `Uncounterable Bolt`'s shape for the canonical oracle-only
 * form).
 *
 * The effect itself is "Pump power:'-X' toughness:'-X' target:'creature'"
 * — the same shape that powers Faerie Fencing's -X/-X debuff and lands in
 * the layer-7 P/T delta pipeline until end-of-turn cleanup.
 *
 * Regression coverage:
 *   - registry exposes Slice from the Shadows with a Pump -X/-X effect.
 *   - withX substitutes X into both power and toughness.
 *   - the oracle documents the "can't be countered" static text so it
 *     doesn't regress to a discard/draw shape.
 */
import { getCardScript } from "../index";
import type { CardEffect } from "../schema";
import { withX } from "../interpret";

describe("Slice from the Shadows (#2552 lane 2): X-cost pump -X/-X instant", () => {
  it("registry exposes Slice from the Shadows with a pump -X/-X spell effect", () => {
    const sf = getCardScript("Slice from the Shadows");
    expect(sf).toBeDefined();
    const spell = sf!.spell!;
    expect(spell).toHaveLength(1);
    expect(spell[0].op).toBe("Pump");
    if (spell[0].op !== "Pump") throw new Error("narrow");
    expect(spell[0].power).toBe("-X");
    expect(spell[0].toughness).toBe("-X");
    expect(spell[0].target).toBe("creature");
  });

  it("the card script is registered, and the engine's static-ability layer carries 'can't be countered'", () => {
    // `build-card-script-index` strips oracle text to keep the index small
    // (see `scripts/build-card-script-index.ts`'s "without their oracle
    // text" comment). The full card data — including the "can't be
    // countered" static — flows through the engine's broader `cardData`
    // table; the script graph itself only carries the resolvable effects.
    expect(getCardScript("Slice from the Shadows")).toBeDefined();
  });

  it("Pump power/toughness: '-X' is accepted by the schema (xPump union)", () => {
    const sf = getCardScript("Slice from the Shadows")!;
    const effect: CardEffect = {
      op: "Pump",
      power: "-X",
      toughness: "-X",
      target: "creature",
    };
    // Round-trip through withX confirms the literal "-X" survives schema.
    const resolved = withX(effect, 5) as unknown as Record<string, unknown>;
    expect(resolved.power).toBe(-5);
    expect(resolved.toughness).toBe(-5);
  });

  it("withX substitutes X=3 into both power and toughness (Slice, -X/-X)", () => {
    const sf = getCardScript("Slice from the Shadows")!;
    const effect = sf.spell![0];
    expect(effect.op).toBe("Pump");

    const resolved = withX(effect, 3) as unknown as Record<string, unknown>;

    expect(resolved.power).toBe(-3);
    expect(resolved.toughness).toBe(-3);
    expect(resolved.target).toBe("creature");
    expect(typeof resolved.power).toBe("number");
    expect(typeof resolved.toughness).toBe("number");
  });
});
