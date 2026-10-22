/**
 * Card scripts — landfall triggers.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted landfall triggers (#2496)
 */
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { detectLandfallTriggers } from "../../keyword-actions/landfall";
import { id, card, put } from "./helpers";
import { resolveScriptedAbility } from "../index";

describe("scripted landfall triggers (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const TEXT =
    "Landfall — Whenever a land you control enters, you gain 1 life.";

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "terra",
      card("Eumidian Terrabotanist", "Creature — Insect Druid", [2, 3]),
    );
  });

  it("fires for a land you control and resolves from the script", () => {
    const s0 = put(
      state,
      p1,
      "forest",
      card("Forest", "Basic Land — Forest", [0, 0]),
    );
    const triggers = detectLandfallTriggers(s0, id("forest"));
    expect(triggers).toHaveLength(1);
    expect(triggers[0].sourceCardId).toBe(id("terra"));
    expect(triggers[0].effect).toBe(TEXT);
    const s = resolveScriptedAbility(s0, {
      id: "ab-land",
      type: "ability",
      sourceCardId: id("terra"),
      controllerId: p1,
      text: TEXT,
      targets: [],
      triggered: true,
    } as unknown as StackObject)!;
    expect(s.players.get(p1)!.life).toBe(21);
  });

  it("ignores an opponent's land", () => {
    const s0 = put(
      state,
      p2,
      "swamp",
      card("Swamp", "Basic Land — Swamp", [0, 0]),
    );
    expect(detectLandfallTriggers(s0, id("swamp"))).toHaveLength(0);
  });
});
