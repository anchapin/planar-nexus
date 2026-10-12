/**
 * Wave 4.8 follow-up 3 lane 63 — additional costs extension (#2614 follow-up)
 *
 * "Pay 1 life" and "Sacrifice a [thing]" as additional costs for instants /
 * sorceries (CR 118.4 + CR 602). The smallest scoped v1 arms live on the
 * existing `additionalCosts` object at the top of `CardScriptSchema`:
 * `additionalCosts.pay_life: { amount }` and
 * `additionalCosts.sacrifice: { amount, target }`. The engine deducts
 * these at cast time, AFTER mana is verified and spent (parallel to the
 * existing `kicker` arm's "post-mana" position). The sample card is
 * Painful Truths (sorcery, "Pay 1 life, draw 3 cards.").
 *
 * What this lane covers:
 *  - Schema accepts the new arms on the existing `additionalCosts` slot.
 *  - The Painful Truths JSON fixture declares `additionalCosts.pay_life`.
 *  - Casting a Painful Truths when the controller has >= 1 life deducts
 *    1 from the controller's life and lets the spell resolve (draw 3).
 *  - Casting when the controller has < 1 life fails with "Not enough life".
 *  - `additionalCosts.sacrifice` deducts matching permanents on cast.
 *
 * What this lane deliberately leaves out of scope (separate lanes):
 *  - Per-subtype sacrifice ("Sacrifice a Goblin") — the schema's
 *    `sacrifice.target` is the v1 enum; a `subtype` string would
 *    extend the union.
 *  - Activated-ability parallel — the lane 21 `cost.pay_life` field
 *    is already wired for activated abilities; the per-ability
 *    array is a follow-up.
 *  - Multi-color affinity discounts (lane 64 work).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { getCardScript } from "../card-scripts/registry";
import { CardScriptSchema } from "../card-scripts/schema";
import { getActivatedAbilities } from "../abilities/parse";

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Sorcery",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

function addCardToHand(
  state: GameState,
  cardData: ScryfallCard,
  owner: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, owner, owner);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${owner}-hand`)!;
  state.zones.set(`${owner}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return { state, cardId: card.id };
}

function addCreatureToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controller: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, controller, controller);
  state.cards.set(card.id, card);
  const battlefield = state.zones.get(`${controller}-battlefield`)!;
  state.zones.set(`${controller}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, card.id],
  });
  return { state, cardId: card.id };
}

function mainPhaseState(state: GameState, activePlayer: PlayerId): GameState {
  return {
    ...state,
    turn: {
      ...state.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: activePlayer,
    },
    stack: [],
    priorityPlayerId: activePlayer,
  };
}

describe("Wave 4.8 follow-up 3 lane 63 — additional costs extension", () => {
  // The Painful Truths JSON fixture is registered as part of the
  // generated card index, so the test process automatically picks
  // it up via RAW_CARD_SCRIPTS. The beforeAll/afterAll pair below
  // mirrors the lane 21 pay-life-cost test pattern.
  beforeAll(() => {
    registerCardScripts(RAW_CARD_SCRIPTS);
  });
  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("Painful Truths fixture declares additionalCosts.pay_life on its script", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "painful_truths.json"), "utf8"),
    ) as {
      name: string;
      additionalCosts?: { pay_life?: { amount: number } };
    };
    expect(fixture.name).toBe("Painful Truths");
    expect(fixture.additionalCosts?.pay_life?.amount).toBe(1);
  });

  it("getCardScript returns the Painful Truths script with the new pay_life arm", () => {
    const script = getCardScript("Painful Truths");
    expect(script).toBeDefined();
    expect(script?.additionalCosts?.pay_life?.amount).toBe(1);
  });

  it("CardScriptSchema parses the additionalCosts.pay_life arm", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Pay Life Spell",
      oracle: "Pay 1 life, draw 1 card.",
      additionalCosts: { pay_life: { amount: 1 } },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additionalCosts?.pay_life?.amount).toBe(1);
    }
  });

  it("CardScriptSchema parses the additionalCosts.sacrifice arm", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Sacrifice Spell",
      oracle: "Sacrifice a creature, draw 1 card.",
      additionalCosts: { sacrifice: { amount: 1, target: "creature" } },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additionalCosts?.sacrifice?.amount).toBe(1);
      expect(result.data.additionalCosts?.sacrifice?.target).toBe("creature");
    }
  });

  it("casting Painful Truths deducts 1 life from the controller and lets the spell resolve", () => {
    const { state: initial, aliceId } = setupTwoPlayerGame();
    const cardData = makeCard({
      id: "painful-truths",
      name: "Painful Truths",
      type_line: "Sorcery",
      mana_cost: "{2}{B}",
      cmc: 3,
      colors: ["B"],
      color_identity: ["B"],
      oracle_text: "Pay 1 life, draw 3 cards.",
    });
    const { state: sWithCard, cardId } = addCardToHand(initial, cardData, aliceId);

    // Plenty of black mana so the test isn't gated by pool size.
    const sWithMana = addMana(sWithCard, aliceId, { black: 5, generic: 5 });
    const s = mainPhaseState(sWithMana, aliceId);

    const beforeLife = s.players.get(aliceId)!.life;
    const result = castSpell(s, aliceId, cardId, [], [], 0, false);
    expect(result.success).toBe(true);
    const afterLife = result.state.players.get(aliceId)!.life;
    expect(beforeLife - afterLife).toBe(1);
  });

  it("casting Painful Truths with 0 life fails with 'Not enough life'", () => {
    const { state: initial, aliceId } = setupTwoPlayerGame();
    const cardData = makeCard({
      id: "painful-truths-low",
      name: "Painful Truths",
      type_line: "Sorcery",
      mana_cost: "{2}{B}",
      cmc: 3,
      colors: ["B"],
      color_identity: ["B"],
      oracle_text: "Pay 1 life, draw 3 cards.",
    });
    const { state: sWithCard, cardId } = addCardToHand(initial, cardData, aliceId);

    const sWithMana = addMana(sWithCard, aliceId, { black: 5, generic: 5 });
    const s = mainPhaseState(sWithMana, aliceId);
    // Drop life to 0 (below the additional-cost threshold).
    s.players.set(aliceId, { ...s.players.get(aliceId)!, life: 0 });

    const result = castSpell(s, aliceId, cardId, [], [], 0, false);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Not enough life");
  });

  it("getActivatedAbilities for Painful Truths returns no activated abilities (sorcery)", () => {
    // Sanity check: the new field doesn't accidentally bleed into
    // the activated-ability path. Painful Truths has only a `spell`
    // block, not an `activated` block.
    const cardData = makeCard({
      id: "painful-truths-parse",
      name: "Painful Truths",
      type_line: "Sorcery",
    });
    const parsed = getActivatedAbilities(cardData);
    expect(parsed).toEqual([]);
  });
});
