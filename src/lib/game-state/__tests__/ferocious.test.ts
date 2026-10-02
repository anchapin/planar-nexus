/**
 * Ferocious ability word (issue #2300, Standard remainder slice).
 */
import {
  ferociousThreshold,
  controlsCreatureWithPowerAtLeast,
  evaluateTriggerWhileCondition,
} from "../keyword-actions/ferocious";
import { evaluateInterveningIfClause } from "../abilities/evaluate";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { parseOracleText } from "../oracle-text-parser";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function card(
  name: string,
  oracle = "",
  power = "2",
  typeLine = "Creature — Wolf",
) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: oracle.startsWith("Ferocious") ? ["Ferocious"] : [],
    legalities: { standard: "legal" },
    layout: "normal",
    power,
    toughness: "2",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  powerModifier = 0,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  const inst = createCardInstance(data, playerId, playerId, {
    id: id(cardId),
    currentZoneKey: key,
  });
  cards.set(id(cardId), {
    ...inst,
    hasSummoningSickness: false,
    powerModifier: inst.powerModifier + powerModifier,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

const FEROCIOUS = "you control a creature with power 4 or greater";
const PURSUER =
  "Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.";
const RABBIT =
  "Ferocious — At the beginning of combat on your turn, if you control a creature with power 4 or greater, put a +1/+1 counter on this creature.";

describe("ferocious", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = { ...s, turn: { ...s.turn, activePlayerId: p1 } };
  });

  it("reads the power threshold from digits and number words", () => {
    expect(ferociousThreshold(FEROCIOUS)).toBe(4);
    expect(
      ferociousThreshold("you control a creature with power four or greater"),
    ).toBe(4);
    expect(ferociousThreshold("you control a creature")).toBeNull();
  });

  it("counts only the player's own creatures at their current power", () => {
    state = put(state, p2, "ogre", card("Ogre", "", "5"));
    state = put(state, p1, "bear", card("Bear", "", "3"));
    state = put(
      state,
      p1,
      "relic",
      card("Relic", "", "6", "Artifact — Equipment"),
    );
    expect(controlsCreatureWithPowerAtLeast(state, p1, 4)).toBe(false);
    expect(controlsCreatureWithPowerAtLeast(state, p2, 4)).toBe(true);

    const pumped = put(state, p1, "pumped", card("Pumped Bear", "", "3"), 1);
    expect(controlsCreatureWithPowerAtLeast(pumped, p1, 4)).toBe(true);
  });

  it("evaluates the ferocious intervening-if against creature power", () => {
    state = put(state, p1, "bear", card("Bear", "", "2"));
    expect(evaluateInterveningIfClause(FEROCIOUS, state, p1)).toBe(false);
    const big = put(state, p1, "ogre", card("Ogre", "", "4"));
    expect(evaluateInterveningIfClause(FEROCIOUS, big, p1)).toBe(true);
    expect(evaluateInterveningIfClause(FEROCIOUS, big, p2)).toBe(false);
  });

  it("parses the beginning-of-combat form as an intervening-if", () => {
    const [ability] = parseOracleText(
      card("Rabbit", RABBIT),
    ).triggeredAbilities;
    expect(ability.interveningIf).toContain("power 4 or greater");
    expect(ability.whileCondition).toBeUndefined();
  });

  it("parses the attack form as a trigger-time while condition", () => {
    const [ability] = parseOracleText(
      card("Pursuer", PURSUER),
    ).triggeredAbilities;
    expect(ability.trigger.event).toBe("attacked");
    expect(ability.whileCondition).toBe(FEROCIOUS);
    expect(ability.interveningIf).toBeUndefined();
  });

  it("only detects the attack trigger while a 4-power creature is controlled", () => {
    state = put(state, p1, "pursuer", card("Nighthowl Pursuer", PURSUER, "3"));
    const small = detectTriggeredAbilities(state, "attacked").filter(
      (t) => t.sourceCardId === id("pursuer"),
    );
    expect(small).toHaveLength(0);

    const big = put(state, p1, "ogre", card("Ogre", "", "4"));
    const triggers = detectTriggeredAbilities(big, "attacked").filter(
      (t) => t.sourceCardId === id("pursuer"),
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toContain("+2/+2");
  });

  it("leaves unrecognised while conditions ungated", () => {
    expect(
      evaluateTriggerWhileCondition("you're the monarch", state, p1),
    ).toBeUndefined();
  });
});
