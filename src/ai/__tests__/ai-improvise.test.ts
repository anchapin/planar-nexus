/**
 * AI improvise payment (#2607, CR 702.126a): the AI taps untapped artifacts
 * for the generic mana its pool can't cover, printed improvise or granted by
 * Ironheart, Clever Champion.
 */
import { describe, it, expect } from "@jest/globals";
import {
  executeAIAction,
  chooseAIImproviseArtifacts,
  aiSpellHasImprovise,
  aiImproviseCapacity,
  chooseAIXValue,
} from "../ai-action-executor";
import { scoreNonCreatureSpell } from "../cast-other-spells-gate";
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

const arcReactor = (): ScryfallCard =>
  makeCard({
    id: "arc-reactor",
    name: "Arc Reactor",
    type_line: "Artifact",
    oracle_text: `${IMPROVISE_REMINDER}\nThis artifact enters tapped.\n{T}: Add {C}{C}{C}.`,
    mana_cost: "{5}",
    cmc: 5,
  });

const ironheart = (): ScryfallCard =>
  makeCard({
    id: "ironheart",
    name: "Ironheart, Clever Champion",
    type_line: "Legendary Artifact Creature — Human Hero",
    oracle_text: `${IMPROVISE_REMINDER}\nFlying\nNoncreature spells you cast have improvise.`,
    mana_cost: "{4}{U}",
    cmc: 5,
    colors: ["U"],
    color_identity: ["U"],
    power: "3",
    toughness: "3",
  });

const blueSorcery = (): ScryfallCard =>
  makeCard({
    id: "divination",
    name: "Divination",
    type_line: "Sorcery",
    oracle_text: "Draw two cards.",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  });

const vanillaCreature = (): ScryfallCard =>
  makeCard({
    id: "bear",
    name: "Bear",
    type_line: "Creature — Bear",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    power: "2",
    toughness: "2",
  });

const trinket = (id: string): ScryfallCard =>
  makeCard({ id, name: "Trinket", type_line: "Artifact", mana_cost: "{1}" });

const land = (id: string): ScryfallCard =>
  makeCard({
    id,
    name: "Island",
    type_line: "Basic Land — Island",
    mana_cost: "",
    cmc: 0,
  });

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

const manaRock = (id: string): ScryfallCard =>
  makeCard({
    id,
    name: "Mind Stone",
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}.",
    mana_cost: "{2}",
    cmc: 2,
  });

describe("AI improvise payment (#2607)", () => {
  it("taps just enough artifacts to cast Arc Reactor from a short pool", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { colorless: 2 });
    const trinkets = ["t1", "t2", "t3", "t4"].map((id) =>
      putOnBattlefield(state, aliceId, trinket(id)),
    );
    const reactor = putInHand(state, aliceId, arcReactor());

    const chosen = chooseAIImproviseArtifacts(state, aliceId, reactor);
    expect(chosen).toHaveLength(3);

    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: reactor },
      aliceId,
    );
    expect(result.success).toBe(true);
    const next = result.newState as GameState;
    const tapped = trinkets.filter((t) => next.cards.get(t.id)?.isTapped);
    expect(tapped).toHaveLength(3);
    expect(next.stack.some((o) => o.sourceCardId === reactor)).toBe(true);
  });

  it("leaves artifacts untapped when the pool already pays", () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { colorless: 5 });
    putOnBattlefield(state, aliceId, trinket("t1"));
    const reactor = putInHand(state, aliceId, arcReactor());
    expect(chooseAIImproviseArtifacts(state, aliceId, reactor)).toEqual([]);
  });

  it("uses Ironheart's grant for a noncreature spell and taps Ironheart last", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1 });
    const hero = putOnBattlefield(state, aliceId, ironheart());
    const t1 = putOnBattlefield(state, aliceId, trinket("t1"));
    const t2 = putOnBattlefield(state, aliceId, trinket("t2"));
    const spell = putInHand(state, aliceId, blueSorcery());

    expect(aiSpellHasImprovise(state, aliceId, spell)).toBe(true);
    expect(chooseAIImproviseArtifacts(state, aliceId, spell)).toEqual([
      t1.id,
      t2.id,
    ]);
    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: spell },
      aliceId,
    );
    expect(result.success).toBe(true);
    expect(result.newState?.cards.get(hero.id)?.isTapped).toBe(false);
  });

  it("does not grant improvise to creature spells", () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { green: 1 });
    putOnBattlefield(state, aliceId, ironheart());
    putOnBattlefield(state, aliceId, trinket("t1"));
    const bear = putInHand(state, aliceId, vanillaCreature());
    expect(aiSpellHasImprovise(state, aliceId, bear)).toBe(false);
    expect(chooseAIImproviseArtifacts(state, aliceId, bear)).toEqual([]);
  });

  it("prefers plain artifacts over mana rocks", () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { colorless: 4 });
    putOnBattlefield(state, aliceId, manaRock("rock"));
    const t1 = putOnBattlefield(state, aliceId, trinket("t1"));
    const reactor = putInHand(state, aliceId, arcReactor());
    expect(chooseAIImproviseArtifacts(state, aliceId, reactor)).toEqual([
      t1.id,
    ]);
  });

  it("returns nothing when artifacts can't cover the shortfall or colors are missing", () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { colorless: 1 });
    putOnBattlefield(state, aliceId, ironheart());
    putOnBattlefield(state, aliceId, trinket("t1"));
    const reactor = putInHand(state, aliceId, arcReactor());
    const spell = putInHand(state, aliceId, blueSorcery());
    expect(chooseAIImproviseArtifacts(state, aliceId, reactor)).toEqual([]);
    expect(chooseAIImproviseArtifacts(state, aliceId, spell)).toEqual([]);
  });
});

const xSorcery = (): ScryfallCard =>
  makeCard({
    id: "x-draw",
    name: "Stroke of Insight",
    type_line: "Sorcery",
    oracle_text: "Draw X cards.",
    mana_cost: "{X}{U}",
    cmc: 1,
    colors: ["U"],
    color_identity: ["U"],
  });

describe("AI improvise affordability (#2607)", () => {
  it("counts untapped artifacts up to the generic cost", () => {
    const { state, aliceId } = makeFixture();
    ["t1", "t2", "t3", "t4"].forEach((id) =>
      putOnBattlefield(state, aliceId, trinket(id)),
    );
    putOnBattlefield(state, aliceId, trinket("tapped"), { tapped: true });
    const reactor = putInHand(state, aliceId, arcReactor());
    const plain = putInHand(state, aliceId, blueSorcery());
    expect(aiImproviseCapacity(state, aliceId, reactor)).toBe(4);
    // Divination has no improvise without Ironheart.
    expect(aiImproviseCapacity(state, aliceId, plain)).toBe(0);
    putOnBattlefield(state, aliceId, ironheart());
    // {2}{U}: capped at the 2 generic, even with 5 untapped artifacts.
    expect(aiImproviseCapacity(state, aliceId, plain)).toBe(2);
  });

  it("raises X off artifacts when the spell has improvise", () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1, colorless: 1 });
    const spell = putInHand(state, aliceId, xSorcery());
    expect(chooseAIXValue(state, aliceId, spell)).toBe(1);
    putOnBattlefield(state, aliceId, ironheart(), { tapped: true });
    ["t1", "t2"].forEach((id) => putOnBattlefield(state, aliceId, trinket(id)));
    expect(chooseAIXValue(state, aliceId, spell)).toBe(3);
  });

  it("casts an improvise X spell with the artifacts paying part of X", async () => {
    const { state: s0, aliceId } = makeFixture();
    const state = addMana(s0, aliceId, { blue: 1, colorless: 1 });
    putOnBattlefield(state, aliceId, ironheart(), { tapped: true });
    const t = ["t1", "t2"].map((id) =>
      putOnBattlefield(state, aliceId, trinket(id)),
    );
    const spell = putInHand(state, aliceId, xSorcery());
    const result = await executeAIAction(
      state,
      { type: "cast_spell", cardId: spell },
      aliceId,
    );
    expect(result.success).toBe(true);
    expect(result.action?.xValue).toBe(3);
    for (const a of t) {
      expect(result.newState?.cards.get(a.id)?.isTapped).toBe(true);
    }
  });

  it("scores an improvise spell as affordable when artifacts cover the gap", () => {
    const board = {
      availableMana: 2,
      opponentCreatureCount: 0,
      ownCreatureCount: 0,
      turnNumber: 5,
      phase: "precombat_main",
      maxOpposingCreaturePower: 0,
    };
    const spell = {
      cardId: "reactor" as CardInstanceId,
      name: "Arc Reactor",
      cmc: 5,
      typeLine: "artifact",
      oracleText: "{T}: Add {C}{C}{C}.",
    };
    expect(scoreNonCreatureSpell({ spell, board })).toBe(0);
    expect(
      scoreNonCreatureSpell({ spell: { ...spell, improviseMana: 3 }, board }),
    ).toBeGreaterThan(0);
  });
});
