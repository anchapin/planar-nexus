/**
 * Morbid ability word (issue #2300, Standard remainder slice).
 */
import { hasCreatureDiedThisTurn } from "../keyword-actions/morbid";
import { moveCardToZone } from "../keyword-actions/removal";
import { evaluateInterveningIfClause } from "../abilities/evaluate";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { parseOracleText } from "../oracle-text-parser";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function card(name: string, oracle = "", typeLine = "Creature — Hyena") {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: oracle.includes("Morbid") ? ["Morbid"] : [],
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
  const inst = createCardInstance(data, playerId, playerId, {
    id: id(cardId),
    currentZoneKey: key,
  });
  cards.set(id(cardId), { ...inst, hasSummoningSickness: false });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

const MORBID = "a creature died this turn";
const PROWLER =
  "Ward {2}\nMorbid — At the beginning of your end step, if a creature died this turn, put a +1/+1 counter on this creature.";
const CERBERUS =
  "This creature doesn't untap during your untap step.\nMorbid — At the beginning of each end step, if a creature died this turn, untap this creature.";

describe("morbid", () => {
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

  it("starts each turn with no creature having died", () => {
    expect(hasCreatureDiedThisTurn(state)).toBe(false);
    expect(evaluateInterveningIfClause(MORBID, state, p1)).toBe(false);
  });

  it("records a death when any player's creature goes to the graveyard", () => {
    state = put(state, p2, "bear", card("Bear"));
    const after = moveCardToZone(state, id("bear"), "graveyard").state;
    expect(hasCreatureDiedThisTurn(after)).toBe(true);
    // Global condition: true for both players, not just the creature's owner.
    expect(evaluateInterveningIfClause(MORBID, after, p1)).toBe(true);
    expect(evaluateInterveningIfClause(MORBID, after, p2)).toBe(true);
  });

  it("does not count noncreatures, exile, or graveyard moves from other zones", () => {
    state = put(state, p1, "relic", card("Relic", "", "Artifact"));
    state = put(state, p1, "bear", card("Bear"));
    let s = moveCardToZone(state, id("relic"), "graveyard").state;
    expect(hasCreatureDiedThisTurn(s)).toBe(false);
    s = moveCardToZone(s, id("bear"), "exile").state;
    expect(hasCreatureDiedThisTurn(s)).toBe(false);
    s = moveCardToZone(s, id("bear"), "graveyard").state;
    expect(hasCreatureDiedThisTurn(s)).toBe(false);
  });

  it("parses the end-step forms as intervening-if clauses", () => {
    for (const text of [PROWLER, CERBERUS]) {
      const triggered = parseOracleText(card("X", text)).triggeredAbilities;
      const morbid = triggered.find((a) => a.interveningIf);
      expect(morbid?.interveningIf).toContain("a creature died this turn");
    }
  });

  it("only detects the end-step trigger after a creature died", () => {
    state = put(state, p1, "prowler", card("Cackling Prowler", PROWLER));
    state = put(state, p2, "bear", card("Bear"));
    const before = detectTriggeredAbilities(state, "endOfTurn").filter(
      (t) => t.sourceCardId === id("prowler"),
    );
    expect(before).toHaveLength(0);

    const after = moveCardToZone(state, id("bear"), "graveyard").state;
    const triggers = detectTriggeredAbilities(after, "endOfTurn").filter(
      (t) => t.sourceCardId === id("prowler"),
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toContain("+1/+1 counter");
  });

  it("clears the death flag when the next turn starts", () => {
    state = put(state, p1, "bear", card("Bear"));
    let s = moveCardToZone(state, id("bear"), "graveyard").state;
    expect(hasCreatureDiedThisTurn(s)).toBe(true);
    const startTurn = s.turn.turnNumber;
    for (let i = 0; i < 60 && s.turn.turnNumber === startTurn; i++) {
      s = passPriority(s, s.priorityPlayerId ?? s.turn.activePlayerId);
    }
    expect(s.turn.turnNumber).toBeGreaterThan(startTurn);
    expect(hasCreatureDiedThisTurn(s)).toBe(false);
  });
});
