/**
 * Raid ability word (issue #2300, Standard remainder slice).
 */
import { hasAttackedThisTurn } from "../keyword-actions/raid";
import { evaluateInterveningIfClause } from "../abilities/evaluate";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { declareAttackers } from "../combat/declaration";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function creature(name: string, oracle = "") {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Goblin Warrior",
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: oracle.startsWith("Raid") ? ["Raid"] : [],
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

function inDeclareAttackers(state: GameState): GameState {
  return {
    ...state,
    turn: { ...state.turn, currentPhase: "declare_attackers" as never },
  };
}

const SEARSLICER =
  "Raid — At the beginning of your end step, if you attacked this turn, create a 1/1 red Goblin creature token.";

describe("raid", () => {
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

  it("starts each player as not having attacked this turn", () => {
    expect(hasAttackedThisTurn(state, p1)).toBe(false);
    expect(hasAttackedThisTurn(state, p2)).toBe(false);
  });

  it("marks only the attacking player when attackers are declared", () => {
    state = inDeclareAttackers(put(state, p1, "bear", creature("Bear")));
    const result = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]);
    expect(result.success).toBe(true);
    expect(hasAttackedThisTurn(result.state, p1)).toBe(true);
    expect(hasAttackedThisTurn(result.state, p2)).toBe(false);
  });

  it("evaluates the raid intervening-if from the controller's attack", () => {
    state = inDeclareAttackers(put(state, p1, "bear", creature("Bear")));
    expect(
      evaluateInterveningIfClause("you attacked this turn", state, p1),
    ).toBe(false);
    const after = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(
      evaluateInterveningIfClause("you attacked this turn", after, p1),
    ).toBe(true);
    expect(
      evaluateInterveningIfClause("you attacked this turn", after, p2),
    ).toBe(false);
  });

  it("only detects a raid end step trigger after its controller attacked", () => {
    state = inDeclareAttackers(
      put(
        put(state, p1, "bear", creature("Bear")),
        p1,
        "searslicer",
        creature("Searslicer Goblin", SEARSLICER),
      ),
    );
    const before = detectTriggeredAbilities(state, "endOfTurn").filter(
      (t) => t.sourceCardId === id("searslicer"),
    );
    expect(before).toHaveLength(0);

    const after = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    const triggers = detectTriggeredAbilities(after, "endOfTurn").filter(
      (t) => t.sourceCardId === id("searslicer"),
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toContain("Goblin creature token");
  });

  it("clears the attack flag when the next turn starts", () => {
    state = inDeclareAttackers(put(state, p1, "bear", creature("Bear")));
    let s = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(hasAttackedThisTurn(s, p1)).toBe(true);
    const startTurn = s.turn.turnNumber;
    for (let i = 0; i < 60 && s.turn.turnNumber === startTurn; i++) {
      s = passPriority(s, s.priorityPlayerId ?? s.turn.activePlayerId);
    }
    expect(s.turn.turnNumber).toBeGreaterThan(startTurn);
    expect(hasAttackedThisTurn(s, p1)).toBe(false);
  });
});
