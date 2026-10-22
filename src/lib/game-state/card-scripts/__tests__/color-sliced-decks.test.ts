/**
 * Card scripts — color sliced decks.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Mono-Red / Mono-Green self-play decks, slice 1 (#2614)
 */
import { GameState, PlayerId } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { getCardScript, resolveScriptedSpell } from "../index";
import {
  id,
  card,
  put,
  spell,
  cardTarget,
  playerTarget,
  battlefield,
} from "./helpers";

describe("Mono-Red / Mono-Green self-play decks, slice 1 (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Shock deals 2 to a player", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Shock")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(18);
  });

  it("Shock deals 2 to a creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Shock")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(s.cards.get(id("bear"))!.damage).toBe(2);
  });

  it("Shared Roots puts a basic land from the library onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds.length;
    const out = resolveScriptedSpell(
      s,
      getCardScript("Shared Roots")!,
      spell(p1, []),
    );
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    expect(lib).toHaveLength(libBefore - 1);
    expect(lib).toContain(id("lib-bear"));
  });

  it("Shared Roots does nothing when the library has no basic land", () => {
    const s = put(
      state,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    const before = battlefield(s, p1).length;
    const out = resolveScriptedSpell(
      s,
      getCardScript("Shared Roots")!,
      spell(p1, []),
    );
    expect(battlefield(out, p1)).toHaveLength(before);
    expect(out.zones.get(`${p1}-library`)!.cardIds).toContain(id("lib-bear"));
  });
});
