/**
 * Slice from the Shadows — X-cost discard spell (lane 2 of #2552, part of
 * the op-frontier phase 5 epic #2487).
 *
 * Slice from the Shadows reads "{X}{B}: Look at target opponent's hand.
 * You draw X cards and they discard X cards." It is the canonical case
 * for `amount: "X"` flowing from a spell cost into both `Draw.amount`
 * (already xAmount-typed) and `Discard.amount` (extended in this PR to
 * accept X).
 *
 * Engine plumbing for X in spell effects was shipped in PR #2601 /
 * #2570 (#2552 lane 1, commit f944bfee). This PR extends the schema to
 * make `Discard.amount` X-capable (1-line schema change), scripts the
 * card, and pins the substitution behavior with `withX` for Discard.
 *
 * Discard's runtime resolution via `target_player` (consuming the spell's
 * declared target) is an engine-internal concern covered by
 * `card-scripts.test.ts`'s scripted-Discard suite and `#2594` follow-up
 * lane 15 (Myojin of Night's Reach). This test pins the **schema
 * extension + `withX` substitution**, which is what #2552 lane 2 owns.
 */
import { getCardScript } from "../index";
import type { CardEffect } from "../schema";
import { withX } from "../interpret";

describe("Slice from the Shadows (#2552 lane 2): X-cost discard spell", () => {
  it("registry exposes Slice from the Shadows with literal-X-cost spell effects", () => {
    const slc = getCardScript("Slice from the Shadows");
    expect(slc).toBeDefined();
    const spell = slc!.spell!;
    expect(spell).toHaveLength(2);
    expect(spell[0].op).toBe("Draw");
    expect(spell[1].op).toBe("Discard");
    if (spell[0].op !== "Draw") throw new Error("narrow");
    if (spell[1].op !== "Discard") throw new Error("narrow");
    expect(spell[0].amount).toBe("X");
    expect(spell[1].amount).toBe("X");
    expect(spell[0].who).toBe("you");
    expect(spell[1].who).toBe("target_player");
  });

  it("Discard.amount: 'X' is accepted by the schema (X-capable integer)", () => {
    // Synthetic Discard effect mirroring Slice from the Shadows's
    // discard step. After the schema extension in this PR, `amount` can
    // be either a positive integer (literal count) or the literal "X"
    // (resolved at run-time from the spell's {X} cost). The `all: false`
    // flag means "discard N cards of that player's choice" (vs `all:
    // true` = "discard the entire hand").
    const discard: CardEffect = {
      op: "Discard",
      amount: "X",
      who: "target_player",
      all: false,
    };
    expect(discard.amount).toBe("X");
    expect(discard.all).toBe(false);
  });

  it("withX substitutes X=3 into both Draw.amount and Discard.amount", () => {
    const slc = getCardScript("Slice from the Shadows")!;
    // We assert against the raw registry (which carries the typed effect
    // union); at runtime both slots are Draw and Discard respectively.
    // The .op guard narrows the union for the assertion below.
    const drawEffect = slc.spell![0];
    const discardEffect = slc.spell![1];
    expect(drawEffect.op).toBe("Draw");
    expect(discardEffect.op).toBe("Discard");

    // Both source effects use the literal string "X".
    expect((drawEffect as { amount: unknown }).amount).toBe("X");
    expect((discardEffect as { amount: unknown }).amount).toBe("X");

    // withX returns a per-op-narrowed ResolvedEffect; we widen to a
    // generic record so we can read `.amount` uniformly across Draw and
    // Discard (which use different shapes downstream).
    const resolvedDraw = withX(drawEffect, 3) as unknown as Record<string, unknown>;
    const resolvedDiscard = withX(
      discardEffect,
      3,
    ) as unknown as Record<string, unknown>;

    expect(resolvedDraw.amount).toBe(3);
    expect(resolvedDiscard.amount).toBe(3);
    expect(typeof resolvedDraw.amount).toBe("number");
    expect(typeof resolvedDiscard.amount).toBe("number");
  });

  it("withX substitutes X=0 (CR 107.3 default) and X=5", () => {
    const slc = getCardScript("Slice from the Shadows")!;
    const drawEffect = slc.spell![0];
    const discardEffect = slc.spell![1];

    expect((withX(drawEffect, 0) as unknown as Record<string, unknown>).amount).toBe(0);
    expect((withX(discardEffect, 0) as unknown as Record<string, unknown>).amount).toBe(0);
    expect((withX(drawEffect, 5) as unknown as Record<string, unknown>).amount).toBe(5);
    expect((withX(discardEffect, 5) as unknown as Record<string, unknown>).amount).toBe(5);
  });
});