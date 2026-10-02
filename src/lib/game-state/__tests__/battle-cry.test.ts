/**
 * Battle cry (CR 702.91, issue #2300): Sanguine Evangelist.
 */
import { hasBattleCry } from "../keyword-actions/battle-cry";
import { declareAttackers } from "../combat/declaration";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { clearUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const EVANGELIST =
  "Battle cry (Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.)\nWhen this creature enters or dies, create a 1/1 black Bat creature token with flying.";

function creature(name: string, oracle = "", keywords: string[] = []) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Test",
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords,
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "1",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  const card = createCardInstance(data, playerId, playerId, {
    id: id(cardId),
    currentZoneKey: key,
  });
  cards.set(id(cardId), { ...card, hasSummoningSickness: false });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function attack(state: GameState, ids: string[], defender: PlayerId) {
  const s = {
    ...state,
    turn: { ...state.turn, currentPhase: "declare_attackers" as never },
  };
  const r = declareAttackers(
    s,
    ids.map((c) => ({ cardId: id(c), defenderId: defender })),
  );
  expect(r.success).toBe(true);
  return r.state;
}

const power = (s: GameState, c: string) =>
  getEffectivePower(s.cards.get(id(c))!);

describe("battle cry", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = { ...s, turn: { ...s.turn, activePlayerId: p1 } };
    state = put(
      state,
      p1,
      "evangelist",
      creature("Sanguine Evangelist", EVANGELIST, ["Battle cry"]),
    );
    state = put(state, p1, "bear", creature("Bear"));
    state = put(state, p1, "wolf", creature("Wolf"));
  });

  it("recognizes the keyword, not a grant of it", () => {
    expect(hasBattleCry(state.cards.get(id("evangelist"))!)).toBe(true);
    expect(hasBattleCry(state.cards.get(id("bear"))!)).toBe(false);
    const granter = createCardInstance(
      creature("Granter", "Creatures you control have battle cry."),
      p1,
      p1,
    );
    expect(hasBattleCry(granter)).toBe(false);
  });

  it("gives each other attacker +1/+0 but not itself", () => {
    const s = attack(state, ["evangelist", "bear", "wolf"], p2);
    expect(power(s, "bear")).toBe(3);
    expect(power(s, "wolf")).toBe(3);
    expect(power(s, "evangelist")).toBe(2);
    expect(getEffectiveToughness(s.cards.get(id("bear"))!)).toBe(1);
  });

  it("does not pump creatures that stayed home", () => {
    const s = attack(state, ["evangelist", "bear"], p2);
    expect(power(s, "bear")).toBe(3);
    expect(power(s, "wolf")).toBe(2);
  });

  it("does nothing when the battle cry creature does not attack", () => {
    const s = attack(state, ["bear", "wolf"], p2);
    expect(power(s, "bear")).toBe(2);
    expect(power(s, "wolf")).toBe(2);
  });

  it("stacks: two battle cry attackers pump each other", () => {
    const st = put(
      state,
      p1,
      "evangelist2",
      creature("Sanguine Evangelist", EVANGELIST, ["Battle cry"]),
    );
    const s = attack(st, ["evangelist", "evangelist2", "bear"], p2);
    expect(power(s, "bear")).toBe(4);
    expect(power(s, "evangelist")).toBe(3);
    expect(power(s, "evangelist2")).toBe(3);
  });

  it("wears off at end of turn", () => {
    const s = clearUntilEndOfTurnPT(attack(state, ["evangelist", "bear"], p2));
    expect(power(s, "bear")).toBe(2);
  });
});
