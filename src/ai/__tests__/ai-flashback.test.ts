/**
 * AI flashback (#2607, CR 702.34): the AI can cast an instant or sorcery
 * from its graveyard for its flashback cost, tapping artifacts for improvise
 * when the spell has it (#2481).
 */
import { describe, it, expect } from "@jest/globals";
import {
  executeAIAction,
  chooseAIImproviseArtifacts,
  aiFlashbackCost,
} from "../ai-action-executor";
import { flashbackManaValue } from "../ai-turn-loop";
import { createInitialGameState, startGame } from "@/lib/game-state/game-state";
import { createCardInstance } from "@/lib/game-state/card-instance";
import { addMana } from "@/lib/game-state/mana";
import { Phase } from "@/lib/game-state/types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
  ScryfallCard,
} from "@/lib/game-state/types";

const IMPROVISE_REMINDER =
  "Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const trinket = (id: string): ScryfallCard =>
  makeCard({ id, name: "Trinket", type_line: "Artifact", mana_cost: "{1}" });

// ---------------------------------------------------------------------------
// Shared state scaffolding
// ---------------------------------------------------------------------------

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function makeFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const ids = Array.from(state.players.keys());
  const aliceId = ids[0];
  const bobId = ids[1];

  state.status = "in_progress";
  state.priorityPlayerId = aliceId;
  state.turn.activePlayerId = aliceId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

/**
 * Place a permanent on a player's battlefield. Default: untapped, NO summoning
 * sickness (mirrors the prowess fixture — convoke does not interact with
 * summoning sickness per CR 302.6, but tests that care about the flag can
 * pass `summoningSick: true`).
 */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { tapped?: boolean; summoningSick?: boolean } = {},
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = opts.summoningSick ?? false;
  card.isTapped = opts.tapped ?? false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card;
}

/** Place a card into a player's hand. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-hand`;
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

const rethink = (overrides: Partial<ScryfallCard> = {}): ScryfallCard =>
  makeCard({
    id: "rethink",
    name: "Second Thoughtful Look",
    type_line: "Instant",
    oracle_text: "Draw a card.\nFlashback {2}{U}",
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
    color_identity: ["U"],
    ...overrides,
  });

/** Place a card into a player's graveyard. */
function putInGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-graveyard`;
  state.cards.set(card.id, card);
  const grave = state.zones.get(`${playerId}-graveyard`)!;
  state.zones.set(`${playerId}-graveyard`, {
    ...grave,
    cardIds: [...grave.cardIds, card.id],
  });
  return card.id;
}

describe("AI flashback (#2607)", () => {
  it("reads the flashback cost from oracle text", () => {
    const { state, aliceId } = makeFixture();
    const plain = putInGraveyard(state, aliceId, rethink());
    const none = putInGraveyard(
      state,
      aliceId,
      rethink({ oracle_text: "Draw a card." }),
    );
    const xCost = putInGraveyard(
      state,
      aliceId,
      rethink({ oracle_text: "Draw X cards.\nFlashback {X}{U}{U}" }),
    );
    expect(aiFlashbackCost(state, plain)).toBe("{2}{U}");
    expect(aiFlashbackCost(state, none)).toBeNull();
    expect(aiFlashbackCost(state, xCost)).toBeNull();
  });

  it("prices flashback costs by mana value", () => {
    expect(flashbackManaValue("{2}{U}")).toBe(3);
    expect(flashbackManaValue("{10}{C}{R}")).toBe(12);
  });

  it("casts a flashback spell from the graveyard", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1, colorless: 2 });
    const spell = putInGraveyard(state, aliceId, rethink());

    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: spell, flashback: true },
      aliceId,
    );

    expect(result.success).toBe(true);
    expect(result.action?.flashback).toBe(true);
    const next = result.newState!;
    expect(next.zones.get(`${aliceId}-graveyard`)!.cardIds).not.toContain(
      spell,
    );
    expect(next.stack.some((o) => o.sourceCardId === spell)).toBe(true);
  });

  it("refuses flashback for a card that isn't in the graveyard", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1, colorless: 2 });
    const spell = putInHand(state, aliceId, rethink());

    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: spell, flashback: true },
      aliceId,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/graveyard/);
  });

  it("taps artifacts for improvise against the flashback cost", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1 });
    const trinkets = ["t1", "t2", "t3"].map((id) =>
      putOnBattlefield(state, aliceId, trinket(id)),
    );
    const spell = putInGraveyard(
      state,
      aliceId,
      rethink({
        oracle_text: `${IMPROVISE_REMINDER}\nDraw a card.\nFlashback {3}{U}`,
      }),
    );

    expect(
      chooseAIImproviseArtifacts(state, aliceId, spell, 0, "{3}{U}"),
    ).toHaveLength(3);

    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: spell, flashback: true },
      aliceId,
    );

    expect(result.success).toBe(true);
    for (const t of trinkets) {
      expect(result.newState!.cards.get(t.id)!.isTapped).toBe(true);
    }
  });
});
