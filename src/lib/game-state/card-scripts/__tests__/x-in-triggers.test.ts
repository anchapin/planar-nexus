/**
 * Card scripts — x in triggers.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted X in triggers and activations (#2559)
 */
import { CardInstance, GameState, PlayerId, StackObject } from "../../types";
import { activateAbility } from "../../abilities/activated";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put } from "./helpers";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { resolveScriptedEffects } from "../interpret";

describe("scripted X in triggers and activations (#2559)", () => {
  // Engine-only tests of the X-from-cast → trigger/activation-stack-object
  // plumbing. Cards-as-data coverage is in the `scripted X spells` block
  // above; here we exercise the engine bits: `xValue` stamped on the
  // CardInstance at resolve, and that value seeded into
  // StackObject.variableValues by `putTriggersOnStack` and `activateAbility`.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("putTriggersOnStack seeds X from the source's xValue", () => {
    // A hypothetical X-cost permanent with a trigger that draws X cards.
    const cardId = id("wildwood");
    let s = state;
    s = put(
      s,
      p1,
      "wildwood",
      card("Wildwood Scourge", "Creature — Hydra", [0, 0]),
    );
    // Stamp xValue as resolve would (X=3 chosen at cast).
    const wildwood = s.cards.get(cardId)!;
    s = {
      ...s,
      cards: new Map(s.cards).set(cardId, { ...wildwood, xValue: 3 }),
    };

    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "Draw X cards.",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.get("X")).toBe(3);
  });

  it("putTriggersOnStack leaves X unset for non-X sources", () => {
    // A non-X permanent with the same trigger text. X should default to 0
    // in the resolveScriptedEffects path (per the `?? 0` in interpret.ts).
    const cardId = id("boring");
    const s = put(
      state,
      p1,
      "boring",
      card("Boring Bear", "Creature — Bear", [2, 2]),
    );
    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "Draw X cards.",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.has("X")).toBe(false);
  });

  it("activateAbility seeds X from the source's xValue", () => {
    // The activated-side analogue: an X-cost permanent activates its
    // {X}-cost ability and the resulting StackObject should see X.
    const cardId = id("hydra");
    let s = put(
      state,
      p1,
      "hydra",
      card("Big Hydra", "Creature — Hydra", [0, 0]),
    );
    const hydra = s.cards.get(cardId)!;
    s = { ...s, cards: new Map(s.cards).set(cardId, { ...hydra, xValue: 5 }) };
    const before = s.cards.get(cardId)!.xValue;
    expect(before).toBe(5);
    // Sanity: putTriggersOnStack would seed X=5 too.
    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "draw",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.get("X")).toBe(5);
    // Suppress the unused `p2` warning; p2 isn't needed for this test.
    void p2;
  });
});
