/**
 * The game-state `checkStateBasedActions` (re-exported as
 * `checkStateBasedActionsFromGameState`, used by the UI hook and the AI
 * simulator) runs the full SBA pass (issue #2466, CR 704.5a / 704.5g).
 */
import {
  createInitialGameState,
  startGame,
  checkStateBasedActionsFromGameState,
} from "@/lib/game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function bear(): ScryfallCard {
  return {
    id: "mock-bear",
    name: "Bear",
    type_line: "Creature \u2014 Bear",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
  } as unknown as ScryfallCard;
}

function putBear(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  damage: number,
): GameState {
  const key = `${playerId}-battlefield`;
  const id = cardId as CardInstanceId;
  const cards = new Map(state.cards);
  const inst = createCardInstance(bear(), playerId, playerId, {
    id,
    currentZoneKey: key,
  });
  cards.set(id, { ...inst, damage });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id] });
  return { ...state, cards, zones };
}

describe("checkStateBasedActionsFromGameState (#2466)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["A", "B"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
  });

  it("puts a creature with lethal damage into its owner's graveyard", () => {
    let s = putBear(state, p1, "dead", 2);
    s = putBear(s, p1, "alive", 1);
    s = checkStateBasedActionsFromGameState(s);
    const bf = s.zones.get(`${p1}-battlefield`)!.cardIds;
    const gy = s.zones.get(`${p1}-graveyard`)!.cardIds;
    expect(bf).toContain("alive");
    expect(bf).not.toContain("dead");
    expect(gy).toContain("dead");
  });

  it("ends the game when a player is at 0 life", () => {
    const players = new Map(state.players);
    players.set(p2, { ...players.get(p2)!, life: 0 });
    const s = checkStateBasedActionsFromGameState({ ...state, players });
    expect(s.players.get(p2)!.hasLost).toBe(true);
    expect(s.status).toBe("completed");
    expect(s.winners).toEqual([p1]);
  });
});
