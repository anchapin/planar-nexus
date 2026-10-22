/**
 * Card scripts — sunspine lynx statics.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Sunspine Lynx: life gain and prevention statics (#2614)
 */
import { CardScriptSchema, getCardScript } from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import {
  gainLife as gainLifeAction,
  dealDamageToPlayer as dealDamageToPlayerAction,
} from "../../player-actions";
import { id, card, put, spell, battlefield } from "./helpers";
import { resolveScriptedEffects } from "../interpret";

describe("Sunspine Lynx: life gain and prevention statics (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const lynx = () => card("Sunspine Lynx", "Creature — Elemental Cat", [5, 4]);
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const shield = (s: GameState, who: PlayerId, amount: number) =>
    s.replacementEffectManager.addPreventionShield(who, {
      sourceId: id("shield-source"),
      amount,
      controllerId: who,
    });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("stops life gain while it is on the battlefield", () => {
    expect(life(gainLifeAction(state, p1, 3), p1)).toBe(23);
    state = put(state, p1, "lynx", lynx());
    expect(life(gainLifeAction(state, p1, 3), p1)).toBe(20);
    expect(life(gainLifeAction(state, p2, 3), p2)).toBe(20);
  });

  it("makes damage unpreventable while it is on the battlefield", () => {
    shield(state, p2, 5);
    expect(life(dealDamageToPlayerAction(state, p2, 3), p2)).toBe(20);
    state = put(state, p1, "lynx", lynx());
    expect(life(dealDamageToPlayerAction(state, p2, 3), p2)).toBe(17);
  });

  it("ETB deals damage to each player equal to their nonbasic lands", () => {
    state = put(state, p1, "lynx", lynx());
    state = put(state, p1, "dfield", card("Demolition Field", "Land"));
    state = put(state, p2, "dual1", card("Shared Roots", "Land"));
    state = put(state, p2, "dual2", card("Fabled Passage", "Land"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    const [trigger] = getCardScript("Sunspine Lynx")!.triggers!;
    const after = resolveScriptedEffects(state, trigger.effects!, {
      controllerId: p1,
      sourceCardId: id("lynx"),
      targets: [],
    } as unknown as StackObject);
    expect(life(after, p1)).toBe(19);
    expect(life(after, p2)).toBe(18);
  });

  it("deals no damage to a player with only basic lands", () => {
    state = put(state, p1, "lynx", lynx());
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    const [trigger] = getCardScript("Sunspine Lynx")!.triggers!;
    const after = resolveScriptedEffects(state, trigger.effects!, {
      controllerId: p1,
      sourceCardId: id("lynx"),
      targets: [],
    } as unknown as StackObject);
    expect(life(after, p1)).toBe(20);
    expect(life(after, p2)).toBe(20);
  });

  it("schema: per needs each_player, and rules can't sit on a spell", () => {
    const base = { name: "Test", oracle: "x" };
    expect(
      CardScriptSchema.safeParse({
        ...base,
        spell: [
          {
            op: "DealDamage",
            amount: 1,
            target: "each_opponent",
            per: "nonbasic_land",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CardScriptSchema.safeParse({
        ...base,
        spell: [{ op: "DealDamage", amount: 1, target: "each_opponent" }],
        rules: [
          { text: "Players can't gain life.", rule: "players_cant_gain_life" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CardScriptSchema.safeParse({
        ...base,
        rules: [
          {
            text: "Damage can't be prevented.",
            rule: "damage_cant_be_prevented",
          },
        ],
      }).success,
    ).toBe(true);
  });
});
