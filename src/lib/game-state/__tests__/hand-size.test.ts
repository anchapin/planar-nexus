/**
 * Maximum hand size (issue #2446, CR 402.2 / CR 514.1) and "You have no
 * maximum hand size" (Proft's Eidetic Memory, #2428).
 */
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import {
  cardsOverHandSize,
  discardToHandSize,
  getPlayerMaxHandSize,
  hasNoMaximumHandSize,
} from "../keyword-actions/hand-size";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const PROFT =
  "When Proft's Eidetic Memory enters, draw a card.\nYou have no maximum hand size.";

function data(name: string, oracle = ""): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Instant",
    oracle_text: oracle,
    mana_cost: "{U}",
    cmc: 1,
    colors: ["U"],
    color_identity: ["U"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  cardId: string,
  card: ScryfallCard,
): GameState {
  const key = `${playerId}-${zone}`;
  const id = cardId as CardInstanceId;
  const cards = new Map(state.cards);
  cards.set(
    id,
    createCardInstance(card, playerId, playerId, { id, currentZoneKey: key }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id] });
  return { ...state, cards, zones };
}

/** Empty the hand, then fill it with `n` test cards. */
function handOf(state: GameState, playerId: PlayerId, n: number): GameState {
  const zones = new Map(state.zones);
  const key = `${playerId}-hand`;
  zones.set(key, { ...zones.get(key)!, cardIds: [] });
  let s = { ...state, zones };
  for (let i = 0; i < n; i++)
    s = put(s, playerId, "hand", `h${i}`, data(`C${i}`));
  return s;
}

const handSize = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-hand`)!.cardIds.length;

describe("maximum hand size (#2446)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("defaults to seven", () => {
    expect(getPlayerMaxHandSize(state, p1)).toBe(7);
  });

  it("applies the hand size modifier", () => {
    const players = new Map(state.players);
    players.set(p1, { ...players.get(p1)!, currentHandSizeModifier: -2 });
    expect(getPlayerMaxHandSize({ ...state, players }, p1)).toBe(5);
  });

  it("discards down to seven, keeping the chosen cards out", () => {
    state = handOf(state, p1, 9);
    expect(cardsOverHandSize(state, p1)).toBe(2);
    const chosen = ["h0", "h4"] as CardInstanceId[];
    const result = discardToHandSize(state, p1, chosen);
    expect(handSize(result.state, p1)).toBe(7);
    const hand = result.state.zones.get(`${p1}-hand`)!.cardIds;
    expect(hand).not.toContain(chosen[0]);
    expect(hand).not.toContain(chosen[1]);
  });

  it("does nothing at or under the limit", () => {
    state = handOf(state, p1, 7);
    const result = discardToHandSize(state, p1);
    expect(result.state).toBe(state);
  });

  it("'You have no maximum hand size' lifts the limit for its controller only", () => {
    state = put(
      state,
      p1,
      "battlefield",
      "proft",
      data("Proft's Eidetic Memory", PROFT),
    );
    state = handOf(state, p1, 10);
    expect(hasNoMaximumHandSize(state, p1)).toBe(true);
    expect(hasNoMaximumHandSize(state, p2)).toBe(false);
    expect(getPlayerMaxHandSize(state, p1)).toBe(Infinity);
    expect(cardsOverHandSize(state, p1)).toBe(0);
    expect(handSize(discardToHandSize(state, p1).state, p1)).toBe(10);
  });

  it("does not count the text from a card in hand", () => {
    state = put(
      state,
      p1,
      "hand",
      "proft",
      data("Proft's Eidetic Memory", PROFT),
    );
    expect(hasNoMaximumHandSize(state, p1)).toBe(false);
  });
});
