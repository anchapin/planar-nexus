/**
 * Legal target ids for whatever is choosing targets (#2300).
 */
import { getLegalTargetIdsForChoice } from "../trigger-system/trigger-targets";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
  StackObject,
} from "../types";

function cardData(name: string, oracle: string, typeLine: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "battlefield" | "hand",
  cardId: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), {
    ...createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
    hasSummoningSickness: false,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("getLegalTargetIdsForChoice", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = { ...s, priorityPlayerId: p1 };
    state = put(state, p1, "battlefield", "bear", cardData("Bear", "", "Creature — Bear"));
    state = put(state, p2, "battlefield", "wolf", cardData("Wolf", "", "Creature — Wolf"));
    state = put(state, p2, "battlefield", "rock", cardData("Rock", "", "Artifact"));
  });

  it("lists the creatures a spell can target", () => {
    state = put(state, p1, "hand", "murder", cardData("Murder", "Destroy target creature.", "Instant"));
    const ids = getLegalTargetIdsForChoice(state, p1, { cardId: "murder" });
    expect(ids).toEqual(expect.arrayContaining(["bear", "wolf"]));
    expect(ids).not.toContain("rock");
  });

  it("uses the activated ability's text when an ability index is given", () => {
    state = put(
      state,
      p1,
      "battlefield",
      "pinger",
      cardData("Pinger", "{T}: This creature deals 1 damage to target creature.", "Creature — Wizard"),
    );
    const ids = getLegalTargetIdsForChoice(state, p1, {
      cardId: "pinger",
      abilityIndex: 0,
    });
    expect(ids).toEqual(expect.arrayContaining(["bear", "wolf"]));
    expect(ids).not.toContain("rock");
  });

  it("uses the stack object's text for an ability waiting on the stack", () => {
    const obj = {
      id: "trig-1",
      type: "ability",
      sourceCardId: id("bear"),
      controllerId: p1,
      name: "Bear trigger",
      text: "When this creature enters, it deals 2 damage to target creature an opponent controls.",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      isCountered: false,
      timestamp: Date.now(),
    } as unknown as StackObject;
    state = { ...state, stack: [...state.stack, obj] };
    const ids = getLegalTargetIdsForChoice(state, p1, { stackObjectId: "trig-1" });
    expect(ids).toContain("wolf");
    expect(ids).not.toContain("bear");
  });

  it("returns nothing for a missing stack object or no choice", () => {
    expect(getLegalTargetIdsForChoice(state, p1, { stackObjectId: "gone" })).toEqual([]);
    expect(getLegalTargetIdsForChoice(state, p1, {})).toEqual([]);
  });
});
