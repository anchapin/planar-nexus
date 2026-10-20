/**
 * Stream of Life — `{X}{G}` Sorcery — "Target player gains X life."
 * (card-scripts gainlife-X lane — references #2552.)
 *
 * Engine plumbing for X in spell effects was shipped in PR #2601 /
 * #2570 (#2552 lane 1, commit f944bfee). `GainLife` already accepts
 * `amount: xAmount` (= `number | "X"`) and `who: "target_player"`
 * (already used by other scripted life-gain effects — see #2827).
 *
 * This test pins the **registry exposure** for Stream of Life and the
 * **`withX` substitution** for its `GainLife` effect. The runtime
 * resolution (target-player prompt + life-total update + choosing
 * self vs. opponent) is owned by the engine test suite
 * `card-scripts.test.ts`'s scripted-GainLife suite and the underlying
 * `resolveScriptedSpell` path — not duplicated here.
 */
import { getCardScript } from "../index";
import type { CardEffect } from "../schema";
import { withX } from "../interpret";

describe("Stream of Life (#2552 lane 2): X-cost gainlife-target-player sorcery", () => {
  it("registry exposes Stream of Life with a target_player-X gainlife spell effect", () => {
    const sol = getCardScript("Stream of Life");
    expect(sol).toBeDefined();
    const spell = sol!.spell!;
    expect(spell).toHaveLength(1);
    expect(spell[0].op).toBe("GainLife");
    if (spell[0].op !== "GainLife") throw new Error("narrow");
    expect(spell[0].amount).toBe("X");
    expect(spell[0].who).toBe("target_player");
  });

  it("GainLife.amount: 'X' with target_player is accepted by the schema", () => {
    // Synthetic GainLife effect mirroring Stream of Life's effect.
    // `who: "target_player"` means "the player the spell targeted on cast";
    // the engine prompt at cast time chooses caster or one of their opponents.
    const gain: CardEffect = {
      op: "GainLife",
      amount: "X",
      who: "target_player",
    };
    expect(gain.amount).toBe("X");
    expect(gain.who).toBe("target_player");
  });

  it("withX substitutes X=3 into GainLife.amount", () => {
    const sol = getCardScript("Stream of Life")!;
    const effect = sol.spell![0];
    expect(effect.op).toBe("GainLife");

    const resolved = withX(effect, 3) as unknown as Record<string, unknown>;

    expect(resolved.amount).toBe(3);
    expect(resolved.who).toBe("target_player");
    expect(typeof resolved.amount).toBe("number");
  });

  it("withX substitutes X=0 (CR 107.3 default) and X=10", () => {
    const sol = getCardScript("Stream of Life")!;
    const effect = sol.spell![0];
    expect(effect.op).toBe("GainLife");

    expect(
      (withX(effect, 0) as unknown as Record<string, unknown>).amount,
    ).toBe(0);
    expect(
      (withX(effect, 10) as unknown as Record<string, unknown>).amount,
    ).toBe(10);
  });
});
