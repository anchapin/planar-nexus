/**
 * Card scripts — modal triggered abilities.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted modal triggered and activated abilities (#2525)
 */
import { CardScriptSchema, resolveScriptedAbility } from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import {
  abilityNeedsModes,
  autoChooseTriggerTargets,
  chooseAbilityModes,
  chooseTriggerTargets,
  getAbilityModes,
  getLegalTriggerTargets,
  triggerNeedsTargets,
} from "../../trigger-system/trigger-targets";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put } from "./helpers";
import { registerCardScripts } from "../registry";

describe("scripted modal triggered and activated abilities (#2525)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const ETB = "When this creature enters, choose one —";
  const DAMAGE = "This creature deals 3 damage to target creature.";
  const LIFE = "You gain 4 life.";
  const DRAW = "Draw a card.";
  const DESTROY = "Destroy target creature.";
  // A made-up card, so the test doesn't depend on which real cards are scripted.
  const fixture = {
    name: "Test Modal Beast",
    oracle: `${ETB}\n• ${DAMAGE}\n• ${LIFE}\n{2}, Sacrifice this creature: Choose one —\n• ${DRAW}\n• ${DESTROY}`,
    triggers: [
      {
        text: ETB,
        event: "etb",
        modes: {
          choose: 1,
          options: [
            {
              text: DAMAGE,
              effects: [{ op: "DealDamage", amount: 3, target: "creature" }],
            },
            {
              text: LIFE,
              effects: [{ op: "GainLife", amount: 4, who: "you" }],
            },
          ],
        },
      },
    ],
    activated: [
      {
        text: "Choose one —",
        cost: { mana: "{2}", sacrifice: true },
        modes: {
          choose: 1,
          options: [
            { text: DRAW, effects: [{ op: "Draw", amount: 1, who: "you" }] },
            { text: DESTROY, effects: [{ op: "Destroy", target: "creature" }] },
          ],
        },
      },
    ],
  };

  beforeAll(() => registerCardScripts([...RAW_CARD_SCRIPTS, fixture]));
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "beast",
      card("Test Modal Beast", "Creature — Beast", [4, 4]),
    );
  });

  const onStack = (s: GameState, kind: "triggered" | "activated") => {
    const obj = {
      id: "modal-1",
      type: "ability",
      sourceCardId: id("beast"),
      controllerId: p1,
      name: "Test Modal Beast ability",
      text: kind === "triggered" ? ETB : "Choose one —",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: 0,
      triggered: kind === "triggered",
      activated: kind === "activated",
    } as unknown as StackObject;
    return { ...s, stack: [...s.stack, obj] };
  };
  const top = (s: GameState) => s.stack[s.stack.length - 1];

  it("validates modes on abilities: effects or modes, exactly one", () => {
    expect(CardScriptSchema.safeParse(fixture).success).toBe(true);
    const trigger = fixture.triggers[0];
    const bad = (t: object) =>
      CardScriptSchema.safeParse({ ...fixture, triggers: [t] }).success;
    expect(bad({ ...trigger, effects: [{ op: "Draw", amount: 1 }] })).toBe(
      false,
    );
    const { modes: _modes, ...noModes } = trigger;
    expect(bad(noModes)).toBe(false);
  });

  it("asks for modes before targets, then targets what the chosen mode targets", () => {
    state = put(
      state,
      p2,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    let s = onStack(state, "triggered");
    expect(abilityNeedsModes(s, top(s))).toBe(true);
    expect(getAbilityModes(s, top(s))).toEqual({
      choose: 1,
      options: [DAMAGE, LIFE],
    });
    expect(triggerNeedsTargets(top(s), s)).toBe(false);

    expect(chooseAbilityModes(s, "modal-1", ["Not a mode."]).success).toBe(
      false,
    );
    expect(chooseAbilityModes(s, "modal-1", [DAMAGE, LIFE]).success).toBe(
      false,
    );
    const chosen = chooseAbilityModes(s, "modal-1", [DAMAGE]);
    expect(chosen.success).toBe(true);
    s = chosen.state;
    expect(abilityNeedsModes(s, top(s))).toBe(false);
    expect(triggerNeedsTargets(top(s), s)).toBe(true);
    const legal = getLegalTriggerTargets(s, top(s));
    expect(legal).toEqual(expect.arrayContaining(["beast", "bear"]));
    expect(legal).not.toContain(p2);

    s = chooseTriggerTargets(s, "modal-1", ["bear"]).state;
    s = resolveScriptedAbility(s, top(s))!;
    expect(s.cards.get(id("bear"))!.damage).toBe(3);
    expect(s.players.get(p1)!.life).toBe(20);
  });

  it("resolves only the chosen mode, and nothing when none was chosen", () => {
    let s = onStack(state, "triggered");
    expect(resolveScriptedAbility(s, top(s))!.players.get(p1)!.life).toBe(20);
    s = chooseAbilityModes(s, "modal-1", [LIFE]).state;
    expect(triggerNeedsTargets(top(s), s)).toBe(false);
    expect(resolveScriptedAbility(s, top(s))!.players.get(p1)!.life).toBe(24);
  });

  it("lets the AI pick the mode and target that kill an opposing creature", () => {
    state = put(
      state,
      p2,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    const s = autoChooseTriggerTargets(onStack(state, "triggered"), p1);
    expect(top(s).chosenModes).toEqual([DAMAGE]);
    expect(top(s).targets.map((t) => t.targetId)).toEqual(["bear"]);
  });

  it("lets the AI gain life when only its own creatures could be hit", () => {
    const s = autoChooseTriggerTargets(onStack(state, "triggered"), p1);
    expect(top(s).chosenModes).toEqual([LIFE]);
    expect(top(s).targets).toEqual([]);
  });

  it("gives a modal activated ability the same mode choice", () => {
    let s = onStack(state, "activated");
    expect(abilityNeedsModes(s, top(s))).toBe(true);
    s = chooseAbilityModes(s, "modal-1", [DRAW]).state;
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    s = resolveScriptedAbility(s, top(s))!;
    expect(s.zones.get(`${p1}-hand`)!.cardIds.length).toBe(handBefore + 1);
  });
});
