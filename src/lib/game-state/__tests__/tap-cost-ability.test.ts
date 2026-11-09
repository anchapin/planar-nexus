/**
 * A {T} activation cost taps the source (CR 701.23b): a tapped permanent
 * cannot pay it, and activating taps it. Guards against the free, infinitely
 * repeatable tap ability that livelocked games (track2 measure, manamind #96).
 */
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { applyPriorityChoice, listPriorityChoices } from "../legal-choices";
import type { GameState, PlayerId, CardInstanceId, ScryfallCard } from "../types";

function permanent(name: string, oracle: string, typeLine = "Artifact") {
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
    power: "1",
    toughness: "1",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  tapped = false,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), {
    ...createCardInstance(data, playerId, playerId, { id: id(cardId), currentZoneKey: key }),
    isTapped: tapped,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("tap-cost abilities (CR 701.23b)", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    const s = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    p1 = Array.from(s.players.keys())[0];
    state = { ...s, priorityPlayerId: p1 };
  });

  it("omits the {T} ability while the source is tapped", () => {
    state = put(state, p1, "wall", permanent("Wall", "{T}: Surveil 1."), true);
    const choices = listPriorityChoices(state, p1);
    expect(choices.some((c) => c.kind === "activate_ability")).toBe(false);
  });

  it("rejects activating the {T} ability of a tapped source and leaves state untouched", () => {
    state = put(state, p1, "wall", permanent("Wall", "{T}: Surveil 1."), true);
    const before = state;
    const r = applyPriorityChoice(state, p1, {
      kind: "activate_ability",
      cardId: id("wall"),
      abilityIndex: 0,
      targets: [],
    });
    expect(r.success).toBe(false);
    expect(r.state).toBe(before);
  });

  it("taps the source as part of the activation payment", () => {
    state = put(state, p1, "wall", permanent("Wall", "{T}: Surveil 1."));
    const r = applyPriorityChoice(state, p1, {
      kind: "activate_ability",
      cardId: id("wall"),
      abilityIndex: 0,
      targets: [],
    });
    expect(r.success).toBe(true);
    expect(r.state.cards.get(id("wall"))?.isTapped).toBe(true);
  });
});
