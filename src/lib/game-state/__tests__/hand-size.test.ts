/**
 * Maximum hand size (issue #2446, CR 402.2 / CR 514.1) and "You have no
 * maximum hand size" (Proft's Eidetic Memory, #2428).
 */
import {
  createInitialGameState,
  passPriority,
  startGame,
} from "../game-state";
import { resolveWaitingChoice } from "../spell-casting";
import { Phase } from "../types";
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

describe("cleanup discard choice (#2446, CR 514.1)", () => {
  let state: GameState;
  let active: PlayerId;
  let other: PlayerId;

  /** Put the game in the active player's cleanup step with `n` cards in hand. */
  function atCleanup(n: number, extra?: (s: GameState) => GameState): GameState {
    let s = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    active = s.turn.activePlayerId;
    other = Array.from(s.players.keys()).find((id) => id !== active)!;
    s = handOf(s, active, n);
    if (extra) s = extra(s);
    return {
      ...s,
      turn: { ...s.turn, currentPhase: Phase.CLEANUP },
      priorityPlayerId: active,
    };
  }

  const endTurn = (s: GameState) => passPriority(passPriority(s, active), other);

  it("ends the turn with no choice when the hand is at the limit", () => {
    state = endTurn(atCleanup(7));
    expect(state.waitingChoice).toBeNull();
    expect(state.turn.activePlayerId).toBe(other);
    expect(handSize(state, active)).toBe(7);
  });

  it("pauses the turn on a discard choice when over the limit", () => {
    const before = atCleanup(9);
    state = endTurn(before);
    expect(state.turn.activePlayerId).toBe(active);
    expect(state.turn.currentPhase).toBe(Phase.CLEANUP);
    expect(state.priorityPlayerId).toBe(active);
    const choice = state.waitingChoice!;
    expect(choice.type).toBe("discard_to_hand_size");
    expect(choice.playerId).toBe(active);
    expect(choice.minChoices).toBe(2);
    expect(choice.maxChoices).toBe(2);
    expect(choice.choices.map((c) => c.value)).toEqual(
      before.zones.get(`${active}-hand`)!.cardIds,
    );
  });

  it("does not let passing skip the pending discard", () => {
    state = endTurn(atCleanup(9));
    expect(passPriority(state, active)).toBe(state);
    expect(passPriority(state, other)).toBe(state);
  });

  it("rejects the wrong number of cards, duplicates, and cards not in hand", () => {
    state = endTurn(atCleanup(9));
    expect(resolveWaitingChoice(state, active, ["h0"]).success).toBe(false);
    expect(resolveWaitingChoice(state, active, ["h0", "h0"]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(state, active, ["h0", "nope"]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(state, other, ["h0", "h1"]).success).toBe(
      false,
    );
  });

  it("discards the chosen cards and finishes the turn", () => {
    state = endTurn(atCleanup(9));
    const result = resolveWaitingChoice(state, active, ["h2", "h5"]);
    expect(result.success).toBe(true);
    const after = result.state;
    expect(after.waitingChoice).toBeNull();
    expect(handSize(after, active)).toBe(7);
    const hand = after.zones.get(`${active}-hand`)!.cardIds;
    expect(hand).not.toContain("h2");
    expect(hand).not.toContain("h5");
    const graveyard = after.zones.get(`${active}-graveyard`)!.cardIds;
    expect(graveyard).toEqual(expect.arrayContaining(["h2", "h5"]));
    expect(after.turn.activePlayerId).toBe(other);
  });

  it("accepts a single card id when one discard is needed", () => {
    state = endTurn(atCleanup(8));
    expect(state.waitingChoice!.minChoices).toBe(1);
    const result = resolveWaitingChoice(state, active, "h3");
    expect(result.success).toBe(true);
    expect(handSize(result.state, active)).toBe(7);
    expect(result.state.turn.activePlayerId).toBe(other);
  });

  it("asks for nothing with no maximum hand size (Proft's Eidetic Memory)", () => {
    state = endTurn(
      atCleanup(10, (s) =>
        put(s, active, "battlefield", "proft", data("Proft's Eidetic Memory", PROFT)),
      ),
    );
    expect(state.waitingChoice).toBeNull();
    expect(handSize(state, active)).toBe(10);
    expect(state.turn.activePlayerId).toBe(other);
  });
});
