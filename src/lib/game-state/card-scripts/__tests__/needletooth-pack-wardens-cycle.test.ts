/**
 * Needletooth Pack (FDN 108) + Wardens of the Cycle (FDN 125): morbid
 * + phaseEnds trigger.
 *
 * Lane 83 of the Wave 4.8 follow-up 11 loop. Both cards share the
 * "Morbid — At the beginning of your end step, if a creature died this
 * turn" template. The trigger rides on lane 28's Cackling Prowler pattern
 * (`phaseEnds` + `intervening_if: "a creature died this turn"` +
 * `MORBID_CONDITION` evaluator). The two cards exercise different
 * effect families — Needletooth Pack adds a targeted `PutCounters`
 * effect on a creature you control, Wardens of the Cycle uses a modal
 * trigger (`modes.choose: 1`).
 */
import {
  getCardScript,
  resolveScriptedAbility,
} from "../index";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
import { evaluateInterveningIfClause } from "../../abilities/evaluate";
import { markCreatureDiedThisTurn } from "../../keyword-actions/morbid";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("Needletooth Pack (FDN 108): morbid + phaseEnds creature-ctrled trigger", () => {
  it("registry exposes Needletooth Pack with morbid + phaseEnds", () => {
    const card = getCardScript("Needletooth Pack");
    expect(card).toBeDefined();
    const trig = card!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("a creature died this turn");
    expect(trig.effects).toEqual([
      {
        op: "PutCounters",
        counter: "+1/+1",
        amount: 2,
        target: "creature",
        controller: "you",
      },
    ]);
  });

  it("forwards the morbid intervening_if to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Needletooth Pack",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("a creature died this turn");
  });

  it("evaluator returns false when no creature died this turn", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    expect(
      evaluateInterveningIfClause("a creature died this turn", state, p1),
    ).toBe(false);
  });

  it("evaluator returns true after markCreatureDiedThisTurn flips the flag", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    const died = markCreatureDiedThisTurn(state);
    expect(
      evaluateInterveningIfClause("a creature died this turn", died, p1),
    ).toBe(true);
  });

  it("end-of-turn trigger is suppressed when no creature died this turn", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "pack", card("Needletooth Pack", "Creature — Dinosaur", [4, 4]));

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const packTriggers = triggers.filter((t) => t.sourceCardId === id("pack"));
    expect(packTriggers).toHaveLength(0);
  });
});

describe("Wardens of the Cycle (FDN 125): morbid + phaseEnds modal trigger", () => {
  it("registry exposes Wardens of the Cycle with the morbid modal trigger", () => {
    const wardens = getCardScript("Wardens of the Cycle");
    expect(wardens).toBeDefined();
    const trig = wardens!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("a creature died this turn");
    expect(trig.modes).toBeDefined();
    expect(trig.modes!.choose).toBe(1);
    expect(trig.modes!.options).toHaveLength(2);
    expect(trig.modes!.options[0].text).toBe("You gain 2 life.");
    expect(trig.modes!.options[1].text).toBe(
      "You draw a card and you lose 1 life.",
    );
  });

  it("forwards the morbid intervening_if to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Wardens of the Cycle",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("a creature died this turn");
    // The modal trigger carries its modes on the script entry.
    const script = getCardScript("Wardens of the Cycle")!;
    expect(script.triggers![0].modes).toBeDefined();
    expect(script.triggers![0].modes!.options.length).toBe(2);
  });

  it("end-of-turn trigger is suppressed when no creature died this turn", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "wardens",
      card("Wardens of the Cycle", "Creature — Elf Warlock", [2, 4]),
    );

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const wardenTriggers = triggers.filter(
      (t) => t.sourceCardId === id("wardens"),
    );
    expect(wardenTriggers).toHaveLength(0);
  });

  it("end-of-turn trigger fires when a creature died this turn, with chosen mode 1 (gain 2 life)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "wardens",
      card("Wardens of the Cycle", "Creature — Elf Warlock", [2, 4]),
    );
    state = markCreatureDiedThisTurn(state);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const wardenTriggers = triggers.filter(
      (t) => t.sourceCardId === id("wardens"),
    );
    expect(wardenTriggers).toHaveLength(1);

    const { state: stacked, triggeredAbilities } = putTriggersOnStack(
      state,
      wardenTriggers,
    );
    expect(triggeredAbilities).toHaveLength(1);
    expect(stacked.stack).toHaveLength(1);

    // Stamp the modal choice on the stack object (gain-2-life mode).
    const stackObject = {
      ...stacked.stack[0],
      chosenModes: ["You gain 2 life."],
    };
    const beforeLife = stacked.players.get(p1)!.life;
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterLife = resolved.players.get(p1)!.life;
    expect(afterLife).toBe(beforeLife + 2);
  });
});