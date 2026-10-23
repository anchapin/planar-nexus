/**
 * Null Summoner (#2444), step 1 of 3: the cast-origin flag.
 *
 * The tests are deliberately engine-level: they exercise the generic
 * cast-origin mechanism through the same public entry points used by a
 * game. Steps 2 (ETB hand reveal with linked exile) and 3 (cast the
 * linked card at threshold with mana of any type) land in follow-ups.
 */
import { describe, expect, it } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { exileCard } from "../keyword-actions/removal";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "mock-null-summoner",
    name: "Null Summoner",
    type_line: "Creature — Human Wizard",
    oracle_text:
      "When this creature enters, if you cast it, target opponent reveals their hand. You choose a nonland card from it. Exile that card. Threshold — As long as there are seven or more cards in your graveyard, you may cast the exiled card, and mana of any type can be spent to cast that spell.",
    mana_cost: "{2}{U}{B}",
    cmc: 4,
    colors: ["U", "B"],
    color_identity: ["U", "B"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "4",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const instance = createCardInstance(data, playerId, playerId, {
    id: cardId as CardInstanceId,
    currentZoneKey: `${playerId}-hand`,
  });
  const cards = new Map(state.cards);
  cards.set(instance.id, instance);
  const zones = new Map(state.zones);
  const hand = zones.get(`${playerId}-hand`)!;
  zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, instance.id],
  });
  return { ...state, cards, zones };
}

function baseState(): { state: GameState; alice: PlayerId; bob: PlayerId } {
  let state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
  const [alice, bob] = Array.from(state.players.keys());
  state.status = "in_progress";
  state.turn.activePlayerId = alice;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.priorityPlayerId = alice;
  state = addMana(state, alice, { generic: 2, blue: 1, black: 1 });
  return { state, alice, bob };
}

describe("Null Summoner cast-origin (CR 603.6d)", () => {
  it("marks a permanent that entered by resolving a cast spell", () => {
    const { state, alice } = baseState();
    const withCard = putInHand(state, alice, "null-summoner", card());
    const cast = castSpell(withCard, alice, "null-summoner");
    expect(cast.error).toBeUndefined();
    expect(cast.success).toBe(true);

    const resolved = resolveTopOfStack(cast.state);
    expect(resolved.cards.get("null-summoner")?.wasCast).toBe(true);
  });

  it("does not mark a permanent put onto the battlefield without a cast", () => {
    const { state, alice } = baseState();
    const instance = createCardInstance(card(), alice, alice, {
      id: "null-summoner" as CardInstanceId,
      currentZoneKey: `${alice}-battlefield`,
    });
    const cards = new Map(state.cards);
    cards.set(instance.id, instance);
    const zones = new Map(state.zones);
    const battlefield = zones.get(`${alice}-battlefield`)!;
    zones.set(`${alice}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, instance.id],
    });
    const put = { ...state, cards, zones };

    expect(put.cards.get(instance.id)?.wasCast).toBeUndefined();
  });

  it("clears the cast-origin flag when the permanent leaves the battlefield", () => {
    const { state, alice } = baseState();
    const withCard = putInHand(state, alice, "null-summoner", card());
    const cast = castSpell(withCard, alice, "null-summoner");
    expect(cast.success).toBe(true);
    const resolved = resolveTopOfStack(cast.state);

    const exiled = exileCard(resolved, "null-summoner");
    expect(exiled.success).toBe(true);
    expect(exiled.state.cards.get("null-summoner")?.wasCast).toBeUndefined();
  });
});
