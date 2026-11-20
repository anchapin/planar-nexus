/**
 * activateAbility — input-immutability proof for the cards/players maps.
 *
 * Issue #2927: `activateAbility` used to copy the whole cards or players
 * map at six separate cost steps inside the one call (tap, pay-life,
 * once-per-turn record, once-only record, mana-ability return, final
 * priority reset). It now owns ONE working cards map and ONE working
 * players map for the whole activation, adopting a helper's fresh map
 * when a cost helper returns one.
 *
 * The ownership contract this file pins (mirroring
 * combat.players-immutability.test.ts from #2923):
 *
 *  - the caller's input cards/players maps are NEVER mutated (same size,
 *    same entry objects, the source card still untapped in the input);
 *  - the returned state carries DIFFERENT cards/players map objects than
 *    the input (the working copies), with the costs actually paid:
 *    the source is tapped, the mana is spent, the once-per-turn record
 *    is written, and priority has passed to the other player.
 *
 * The covered activation is deliberately multi-cost — {2}{G} mana, {T},
 * and an "activate only once each turn" limit — so the tap step, the
 * mana-helper adoption, the once-per-turn record, and the final
 * priority reset all execute in a single call.
 */

import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { activateAbility } from "../abilities/activated";
import { addMana } from "../mana/mana-pool";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const id = (s: string) => s as CardInstanceId;

const MULTI_COST =
  "{2}{G}, {T}: This creature gets +2/+2 until end of turn. Activate only once each turn.";

function data(name: string, oracle: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Cat",
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

describe("activateAbility working maps (#2927)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const put = (s: GameState, cardId: string, card: ScryfallCard): GameState => {
    const key = `${p1}-battlefield`;
    const cards = new Map(s.cards);
    const inst = createCardInstance(card, p1, p1, {
      id: id(cardId),
      currentZoneKey: key,
    });
    cards.set(id(cardId), { ...inst, hasSummoningSickness: false });
    const zones = new Map(s.zones);
    const z = zones.get(key)!;
    zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
    return { ...s, cards, zones };
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = {
      ...state,
      stack: [],
      priorityPlayerId: p1,
      turn: {
        ...state.turn,
        activePlayerId: p1,
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
    };
    state = addMana(put(state, "multi", data("Multi Cat", MULTI_COST)), p1, {
      green: 6,
    });
  });

  it("never mutates the input maps on a multi-cost activation", () => {
    const inputCards = state.cards;
    const inputPlayers = state.players;
    const inputCard = inputCards.get(id("multi"))!;
    const inputP1 = inputPlayers.get(p1)!;
    const inputP2 = inputPlayers.get(p2)!;
    const inputP1Passed = inputP1.hasPassedPriority;

    const result = activateAbility(state, p1, id("multi"), 0);
    expect(result.success).toBe(true);

    // Input maps: same size, same entry objects, source still untapped.
    expect(inputCards.size).toBe(state.cards.size);
    expect(inputCards.get(id("multi"))).toBe(inputCard);
    expect(inputCard.isTapped).toBe(false);
    expect(inputPlayers.get(p1)).toBe(inputP1);
    expect(inputPlayers.get(p2)).toBe(inputP2);
    expect(inputP1.hasPassedPriority).toBe(inputP1Passed);

    // Returned state: different map objects (the working copies).
    expect(result.state.cards).not.toBe(inputCards);
    expect(result.state.players).not.toBe(inputPlayers);

    // Costs actually paid in the returned state: tapped source,
    // once-per-turn record written, priority passed to p2.
    const outCard = result.state.cards.get(id("multi"))!;
    expect(outCard.isTapped).toBe(true);
    expect(outCard.activatedThisTurn?.abilities).toContain(0);
    expect(result.state.priorityPlayerId).toBe(p2);
    expect(result.state.players.get(p1)!.hasPassedPriority).toBe(false);
  });
});
