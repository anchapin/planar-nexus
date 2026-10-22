/**
 * Card scripts — fight and bite.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted Fight and Bite (#2548)
 */
import {
  CardScriptSchema,
  effectTargetCount,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId } from "../../types";
import { checkStateBasedActions } from "../../state-based-actions";
import { createInitialGameState, startGame } from "../../game-state";
import { destroyCard } from "../../keyword-actions/removal";
import { getEffectivePower } from "../../evergreen-keywords";
import {
  getLegalSpellTargets,
  getLegalSpellTargetsAt,
  getSpellTargetSpecs,
} from "../../trigger-system/trigger-targets";
import { id, card, put, spell, cardTarget, battlefield } from "./helpers";

describe("scripted Fight and Bite (#2548)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p1, "elk", card("Elk", "Creature — Elk", [3, 3]));
  });

  const damage = (s: GameState, c: string) => s.cards.get(id(c))!.damage ?? 0;

  it("validates Fight and Bite and counts their targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    const bite = {
      op: "Bite",
      fighter: "creature",
      target: "creature",
      controller: "opponent",
    } as const;
    expect(ok(bite)).toBe(true);
    expect(ok({ ...bite, op: "Fight", fighter: "it" })).toBe(true);
    expect(ok({ ...bite, fighter: "self", optional: true })).toBe(true);
    expect(ok({ ...bite, fighter: "it", optional: true })).toBe(false);
    expect(ok({ ...bite, target: "player" })).toBe(false);
    expect(effectTargetCount(bite)).toBe(2);
    expect(effectTargetCount({ ...bite, fighter: "it" })).toBe(1);
    expect(effectTargetCount({ ...bite, fighter: "self" })).toBe(1);
    expect(effectTargetCount({ op: "Draw", amount: 1, who: "you" })).toBe(0);
  });

  it("Rabid Bite: only the creature you control deals damage", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Rabid Bite")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(3);
    expect(damage(s, "elk")).toBe(0);
    expect(
      checkStateBasedActions(s).state.zones.get(`${p2}-battlefield`)!.cardIds,
    ).not.toContain(id("bear"));
  });

  it("Kapow!: the countered creature fights, each dealing damage", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Kapow!")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(4);
    expect(damage(s, "elk")).toBe(2);
  });

  it("Huatli's Final Strike bites with the pumped power", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Huatli's Final Strike")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(4);
    expect(damage(s, "elk")).toBe(0);
  });

  it("no fight when the creature you control has left the battlefield", () => {
    const gone = destroyCard(state, id("elk")).state;
    const s = resolveScriptedSpell(
      gone,
      getCardScript("Kapow!")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(0);
  });

  it("no fight when the other creature is no longer legal", () => {
    const gone = destroyCard(state, id("bear")).state;
    const s = resolveScriptedSpell(
      gone,
      getCardScript("Troll Negotiations")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    // The counters still land; the fight doesn't happen.
    expect(getEffectivePower(s.cards.get(id("elk"))!)).toBe(5);
    expect(damage(s, "elk")).toBe(0);
  });

  it("does nothing when the fighter isn't yours", () => {
    let s = put(state, p2, "wolf", card("Wolf", "Creature — Wolf", [4, 4]));
    s = resolveScriptedSpell(
      s,
      getCardScript("Tenderize")!,
      spell(p1, [cardTarget("wolf"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(0);
  });

  it("a self fighter fights from an ability", () => {
    let s = put(state, p1, "brute", card("Brute", "Creature — Ogre", [5, 5]));
    s = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "Fight",
            fighter: "self",
            target: "creature",
            controller: "opponent",
          },
        ],
      }),
      {
        controllerId: p1,
        sourceCardId: "brute" as never,
        targets: [cardTarget("bear")],
      },
    );
    expect(damage(s, "bear")).toBe(5);
    expect(damage(s, "brute")).toBe(2);
  });

  it("lists both targets of a two-target spell, in order", () => {
    const s = put(state, p1, "bite", card("Rabid Bite", "Sorcery"), "hand");
    const specs = getSpellTargetSpecs(s, id("bite"));
    expect(specs.map((x) => [x.kind, x.controller])).toEqual([
      ["creature", "you"],
      ["creature", "opponent"],
    ]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 0)).toEqual(["elk"]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 1)).toEqual(["bear"]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 2)).toEqual([]);
  });

  it('an "it" fighter adds no target of its own', () => {
    const s = put(state, p1, "kapow", card("Kapow!", "Sorcery"), "hand");
    expect(getSpellTargetSpecs(s, id("kapow"))).toHaveLength(2);
    expect(getLegalSpellTargets(s, p1, id("kapow"))).toEqual(["elk"]);
  });
});
