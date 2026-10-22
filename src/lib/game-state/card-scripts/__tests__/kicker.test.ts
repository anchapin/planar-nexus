/**
 * Card scripts — kicker.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - kicker scripts (#2564)
 *   - kicker schema rejects (#2564)
 */
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { id, card, put, spell, cardTarget, playerTarget } from "./helpers";

describe("kicker scripts (#2564)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Divine Resilience: instant; +1/+0 + lifelink, and if kicked, also +1/+0.
  it("Divine Resilience un-kicked: +1/+0 and lifelink, no second pump", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Divine Resilience")!,
      spell(p1, [cardTarget("bear")]),
    );
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(3);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "lifelink")).toBe(true);
  });

  it("Divine Resilience kicked: +1/+0 + lifelink, then another +1/+0", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(s0, getCardScript("Divine Resilience")!, {
      ...spell(p1, [cardTarget("bear")]),
      wasKicked: true,
      timesKicked: 1,
    });
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(4);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "lifelink")).toBe(true);
  });

  it("Burst Lightning un-kicked: 2 damage", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Burst Lightning")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("Burst Lightning kicked: 4 damage (CR 702.33d instead replaces 2)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, getCardScript("Burst Lightning")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 4);
  });

  it("Gnarlid Colony ETB un-kicked: no pump", () => {
    let s = put(
      state,
      p1,
      "gnarlid",
      card("Gnarlid Colony", "Creature — Beast", [2, 2]),
    );
    s = put(s, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s2 = resolveScriptedAbility(s, {
      id: "ab-gnarlid",
      type: "ability",
      sourceCardId: id("gnarlid"),
      controllerId: p1,
      text: "When this creature enters, if it was kicked, target creature gets -2/-0 until end of turn.",
      targets: [cardTarget("bear")],
      triggered: true,
    } as unknown as StackObject)!;
    expect(getEffectivePower(s2.cards.get(id("bear"))!)).toBe(2);
  });

  it("Gnarlid Colony ETB kicked: -2/-0 to the chosen creature", () => {
    let s = put(
      state,
      p1,
      "gnarlid",
      card("Gnarlid Colony", "Creature — Beast", [2, 2]),
    );
    s = put(s, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s2 = resolveScriptedAbility(s, {
      id: "ab-gnarlid",
      type: "ability",
      sourceCardId: id("gnarlid"),
      controllerId: p1,
      text: "When this creature enters, if it was kicked, target creature gets -2/-0 until end of turn.",
      targets: [cardTarget("bear")],
      triggered: true,
      wasKicked: true,
      timesKicked: 1,
    } as unknown as StackObject)!;
    expect(getEffectivePower(s2.cards.get(id("bear"))!)).toBe(0);
    expect(getEffectiveToughness(s2.cards.get(id("bear"))!)).toBe(2);
  });
});

describe("kicker schema rejects (#2564)", () => {
  const base = {
    name: "Kicker Reject Test",
    oracle: "Test card.",
  };

  it("rejects a kicker without a mana cost", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a kicker with a multi-kicker (array) shape", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: [{ cost: "{1}" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a kicker with a single mana-string cost", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{W}" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an effect with if_kicked: true", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [
        { op: "DealDamage", amount: 2, target: "any", if_kicked: false },
        {
          op: "DealDamage",
          amount: 4,
          target: "any",
          kickedAmount: 4,
          if_kicked: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
