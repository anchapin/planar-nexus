/**
 * "Enters with +1/+1 counters" replacement (CR 614.1c, issue #2300).
 */
import {
  entersWithCountersCount,
  moveCardToZone,
  markAttackedThisTurn,
} from "../keyword-actions";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  GameState,
  ManaPool,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function creature(name: string, oracle: string, manaCost = "{2}") {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Test",
    mana_cost: manaCost,
    cmc: 2,
    power: "0",
    toughness: "0",
    colors: [],
    color_identity: [],
    keywords: [],
    oracle_text: oracle,
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function setup(
  data: ScryfallCard,
  zone: "hand" | "graveyard",
  mana: Partial<ManaPool> = {},
): { state: GameState; p1: PlayerId; cardId: CardInstanceId } {
  let state = startGame(
    createInitialGameState(["Player1", "Player2"], 20, false),
  );
  const [p1] = Array.from(state.players.keys()) as PlayerId[];
  const card = createCardInstance(data, p1, p1);
  const cards = new Map(state.cards);
  cards.set(card.id, card);
  const zones = new Map(state.zones);
  const key = `${p1}-${zone}`;
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, card.id] });
  state = addMana({ ...state, cards, zones }, p1, mana);
  state = {
    ...state,
    turn: {
      ...state.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: p1,
    },
    stack: [],
    priorityPlayerId: p1,
  };
  return { state, p1, cardId: card.id };
}

function plusOnes(state: GameState, cardId: CardInstanceId): number {
  return (
    state.cards.get(cardId)!.counters.find((c) => c.type === "+1/+1")?.count ??
    0
  );
}

const WILDGROWTH =
  "Trample\nConverge — Wildgrowth Archaic enters with a +1/+1 counter on it for each color of mana spent to cast it.";
const BOARDERS =
  "Raid — Goblin Boarders enters with a +1/+1 counter on it if you attacked this turn.";
const RAID_PREFIX =
  "Raid — If you attacked this turn, this creature enters with two +1/+1 counters on it.";

describe("enters with +1/+1 counters", () => {
  it("reads fixed counts, number words and the card's own name", () => {
    const a = setup(
      creature(
        "Walking Ballista",
        "This creature enters with three +1/+1 counters on it.",
      ),
      "graveyard",
    );
    expect(entersWithCountersCount(a.state, a.cardId)).toBe(3);
    const b = setup(
      creature("Grumgully", "Grumgully enters with a +1/+1 counter on it."),
      "graveyard",
    );
    expect(entersWithCountersCount(b.state, b.cardId)).toBe(1);
  });

  it("ignores other creatures' counters and unsupported conditions", () => {
    const a = setup(
      creature(
        "Lord",
        "Each other creature you control enters with an additional +1/+1 counter on it.",
      ),
      "graveyard",
    );
    expect(entersWithCountersCount(a.state, a.cardId)).toBe(0);
    const b = setup(
      creature(
        "Kicked",
        "If this creature was kicked, it enters with two +1/+1 counters on it.",
      ),
      "graveyard",
    );
    expect(entersWithCountersCount(b.state, b.cardId)).toBe(0);
  });

  it("uses X and colors spent from the context", () => {
    const a = setup(
      creature("Hydra", "This creature enters with X +1/+1 counters on it."),
      "graveyard",
    );
    expect(entersWithCountersCount(a.state, a.cardId, { xValue: 4 })).toBe(4);
    const b = setup(creature("Wildgrowth Archaic", WILDGROWTH), "graveyard");
    expect(entersWithCountersCount(b.state, b.cardId, { colorsSpent: 3 })).toBe(
      3,
    );
    expect(entersWithCountersCount(b.state, b.cardId)).toBe(0);
  });

  it("checks raid in both the prefix and the suffix wording", () => {
    const a = setup(creature("Raider", RAID_PREFIX), "graveyard");
    expect(entersWithCountersCount(a.state, a.cardId)).toBe(0);
    const attacked = markAttackedThisTurn(a.state, [a.p1]);
    expect(entersWithCountersCount(attacked, a.cardId)).toBe(2);
    const b = setup(creature("Goblin Boarders", BOARDERS), "graveyard");
    expect(
      entersWithCountersCount(markAttackedThisTurn(b.state, [b.p1]), b.cardId),
    ).toBe(1);
    expect(entersWithCountersCount(b.state, b.cardId)).toBe(0);
  });

  it("puts converge counters on a creature spell as it resolves", () => {
    const { state, p1, cardId } = setup(
      creature("Wildgrowth Archaic", WILDGROWTH, "{2}"),
      "hand",
      { green: 1, red: 1 },
    );
    const cast = castSpell(state, p1, cardId, [], [], 0, false);
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.zones.get(`${p1}-battlefield`)!.cardIds).toContain(cardId);
    expect(plusOnes(resolved, cardId)).toBe(2);
  });

  it("applies the counters when a card is put onto the battlefield", () => {
    const { state, cardId } = setup(
      creature(
        "Walking Ballista",
        "This creature enters with two +1/+1 counters on it.",
      ),
      "graveyard",
    );
    const result = moveCardToZone(state, cardId, "battlefield");
    expect(result.success).toBe(true);
    expect(plusOnes(result.state, cardId)).toBe(2);
  });
});
