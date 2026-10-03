/**
 * "At the beginning of your/each end step" printed triggers (issue #2448,
 * CR 513.1a). Raid end-step cards like Searslicer Goblin never fired before.
 */
import { detectEndStepTriggers, parseEndStepTriggers } from "../trigger-system";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SEARSLICER =
  "Raid \u2014 At the beginning of your end step, if you attacked this turn, create a 1/1 red Goblin creature token.";
const EACH = "At the beginning of each end step, you gain 1 life.";
const DELAYED =
  "When this creature enters, exile target creature. Return it at the beginning of the next end step.";

function data(name: string, oracle: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature \u2014 Goblin",
    oracle_text: oracle,
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "1",
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  card: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
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

function setAttacked(state: GameState, playerId: PlayerId): GameState {
  const players = new Map(state.players);
  players.set(playerId, { ...players.get(playerId)!, attackedThisTurn: true });
  return { ...state, players };
}

describe("end step triggers (#2448)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("parses raid's ability word and intervening if", () => {
    expect(parseEndStepTriggers(SEARSLICER)).toEqual([
      {
        scope: "your",
        interveningIf: "you attacked this turn",
        effect: "create a 1/1 red Goblin creature token",
      },
    ]);
  });

  it("ignores delayed 'next end step' wording inside an effect", () => {
    expect(parseEndStepTriggers(DELAYED)).toEqual([]);
  });

  it("fires raid only when its controller attacked this turn", () => {
    state = put(state, p1, "gob", data("Searslicer Goblin", SEARSLICER));
    expect(detectEndStepTriggers(state, p1)).toHaveLength(0);
    const fired = detectEndStepTriggers(setAttacked(state, p1), p1);
    expect(fired).toHaveLength(1);
    expect(fired[0].effect).toBe("create a 1/1 red Goblin creature token");
  });

  it("fires 'your end step' only on its controller's turn", () => {
    state = setAttacked(
      put(state, p1, "gob", data("Searslicer Goblin", SEARSLICER)),
      p1,
    );
    expect(detectEndStepTriggers(state, p2)).toHaveLength(0);
  });

  it("fires 'each end step' on every player's turn", () => {
    state = put(state, p1, "each", data("Each Ender", EACH));
    expect(detectEndStepTriggers(state, p1)).toHaveLength(1);
    expect(detectEndStepTriggers(state, p2)).toHaveLength(1);
  });
});
