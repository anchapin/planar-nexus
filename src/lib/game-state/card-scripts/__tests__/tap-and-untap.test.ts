/**
 * Card scripts — tap and untap.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted Tap and Untap (#2538)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  isTargetedEffect,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId } from "../../types";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put, spell, cardTarget } from "./helpers";

describe("scripted Tap and Untap (#2538)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mine", card("Elk", "Creature — Elk", [3, 3]));
  });

  const tapped = (s: GameState, c: string) => s.cards.get(id(c))!.isTapped;
  const setTapped = (s: GameState, c: string, v: boolean): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(c), { ...cards.get(id(c))!, isTapped: v });
    return { ...s, cards };
  };
  const script = (...effects: object[]): CardScript =>
    CardScriptSchema.parse({ name: "Tap Test", oracle: "x", spell: effects });

  it("validates Tap and Untap with the removal targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Tap", target: "creature" })).toBe(true);
    expect(ok({ op: "Untap", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "Tap", target: "creature", controller: "opponent" })).toBe(
      true,
    );
    expect(ok({ op: "Tap", target: "permanent" })).toBe(false);
    expect(ok({ op: "Untap", target: "land" })).toBe(false);
    expect(isTargetedEffect({ op: "Tap", target: "creature" })).toBe(true);
  });

  it("taps a target creature and untaps a target permanent", () => {
    let s = resolveScriptedSpell(
      state,
      script({ op: "Tap", target: "creature" }),
      spell(p1, [cardTarget("bear")]),
    );
    expect(tapped(s, "bear")).toBe(true);
    s = setTapped(s, "rock", true);
    s = resolveScriptedSpell(
      s,
      script({ op: "Untap", target: "nonland_permanent" }),
      spell(p1, [cardTarget("rock")]),
    );
    expect(tapped(s, "rock")).toBe(false);
  });

  it("does nothing to an illegal target but keeps resolving", () => {
    const before = state.players.get(p1)!.life;
    const s = resolveScriptedSpell(
      state,
      script(
        { op: "Tap", target: "nonland_permanent" },
        { op: "GainLife", amount: 2, who: "you" },
      ),
      spell(p1, [cardTarget("forest")]),
    );
    expect(tapped(s, "forest")).toBe(false);
    expect(s.players.get(p1)!.life).toBe(before + 2);
  });

  it("checks the controller filter on resolution", () => {
    const s = resolveScriptedSpell(
      state,
      script({ op: "Tap", target: "creature", controller: "opponent" }),
      spell(p1, [cardTarget("mine")]),
    );
    expect(tapped(s, "mine")).toBe(false);
  });

  it("leaves an already tapped permanent tapped", () => {
    const s0 = setTapped(state, "bear", true);
    const s = resolveScriptedSpell(
      s0,
      script({ op: "Tap", target: "creature" }),
      spell(p1, [cardTarget("bear")]),
    );
    expect(tapped(s, "bear")).toBe(true);
  });

  it("scripts the tap and untap cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const guard = byName.get("Frostbridge Guard")!;
    expect(guard.activated?.[0].cost.tap).toBe(true);
    expect(guard.activated?.[0].effects).toEqual([
      { op: "Tap", target: "creature" },
    ]);
    for (const name of [
      "Glamermite",
      "Giant-Sized Flying Ant",
      "Divining Duelist",
    ]) {
      const ops = byName
        .get(name)!
        .triggers![0].modes!.options.flatMap((o) => o.effects.map((e) => e.op));
      expect(ops).toEqual(expect.arrayContaining(["Tap", "Untap"]));
    }
    expect(byName.get("Thistledown Players")!.triggers![0].event).toBe(
      "attacks",
    );
  });
});
