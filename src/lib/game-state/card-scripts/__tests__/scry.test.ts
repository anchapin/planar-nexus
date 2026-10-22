/**
 * Card scripts — scry.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted Scry (#2540)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { card, spell } from "./helpers";
import { createInitialGameState, startGame } from "../../game-state";

describe("scripted Scry (#2540)", () => {
  it("validates Scry", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Scry", amount: 2 })).toBe(true);
    expect(ok({ op: "Scry", amount: 0 })).toBe(false);
    expect(ok({ op: "Scry", amount: 1, who: "target_player" })).toBe(false);
  });

  it("resolves Opt: scry 1, then draw a card", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const p1 = Array.from(state.players.keys())[0];
    const handBefore = state.zones.get(`${p1}-hand`)!.cardIds.length;
    const top = state.zones.get(`${p1}-library`)!.cardIds.slice(-1)[0];
    state = resolveScriptedSpell(state, getCardScript("Opt")!, spell(p1));
    const hand = state.zones.get(`${p1}-hand`)!.cardIds;
    expect(hand).toHaveLength(handBefore + 1);
    expect(hand).toContain(top);
  });

  it("scripts the scry cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const ops = (name: string) =>
      byName
        .get(name)!
        .triggers!.flatMap((t) => t.effects ?? [])
        .map((e) => e.op);
    expect(ops("Glider Kids")).toEqual(["Scry"]);
    expect(ops("Holy Cow")).toEqual(["GainLife", "Scry"]);
    expect(ops("Candy Trail")).toEqual(["Scry"]);
    expect(byName.get("Candy Trail")!.activated?.[0].cost.sacrifice).toBe(true);
    expect(byName.get("Merfolk Coralsmith")!.triggers![0].event).toBe("dies");
  });
});
