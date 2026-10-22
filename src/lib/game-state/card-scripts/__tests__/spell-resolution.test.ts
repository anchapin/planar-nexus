/**
 * Card scripts — spell resolution.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - resolveScriptedSpell
 */
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { getCardScript, resolveScriptedSpell } from "../index";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import {
  id,
  card,
  put,
  spell,
  cardTarget,
  playerTarget,
  battlefield,
} from "./helpers";

describe("resolveScriptedSpell", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Lightning Strike deals 3 to a player", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Lightning Strike")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(17);
  });

  it("Lightning Strike deals 3 to a creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Lightning Strike")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(s.cards.get(id("bear"))!.damage).toBe(3);
  });

  it("Fell destroys the target creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Fell")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-graveyard`)!.cardIds).toContain(id("bear"));
  });

  it("Wander Off exiles the target creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Wander Off")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-exile`)!.cardIds).toContain(id("bear"));
  });

  it("does nothing to a target that left the battlefield (CR 608.2b)", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Fell")!,
      spell(p1, [cardTarget("gone")]),
    );
    expect(s).toBe(state);
  });

  it("Dragon Fodder creates two 1/1 red Goblins for the caster", () => {
    const before = battlefield(state, p1).length;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Dragon Fodder")!,
      spell(p1),
    );
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(2);
    const token = s.cards.get(created[0])!;
    expect(token.cardData.name).toBe("Goblin");
    expect(token.cardData.power).toBe("1");
    expect(token.cardData.colors).toEqual(["red"]);
  });

  it("Giant Growth gives +3/+3 until end of turn", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Giant Growth")!,
      spell(p1, [cardTarget("bear")]),
    );
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(5);
    expect(getEffectiveToughness(bear)).toBe(5);
  });

  it("Cancel counters the target spell", () => {
    const victim = {
      id: "stack-victim",
      type: "spell",
      sourceCardId: null,
      controllerId: p2,
      name: "Victim",
      text: "",
      manaCost: "",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      timestamp: 0,
    } as unknown as StackObject;
    const s0 = { ...state, stack: [victim] };
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Cancel")!,
      spell(p1, [{ type: "stack", targetId: "stack-victim", isValid: true }]),
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(false);
  });
});
