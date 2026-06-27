/**
 * @fileoverview Unit tests for the Blitz keyword (CR 702.150).
 *
 * Issue #1061 — [Rules Engine] Implement Blitz alternate cost and its delayed
 * trigger (CR 702.150).
 *
 * Blitz (CR 702.150):
 * - 702.150a: "Blitz [cost]" is a static ability that functions while the spell
 *   is on the stack. It offers an alternative cost. If a creature's blitz cost
 *   was paid, it gains haste and "When this creature dies, draw a card" and is
 *   sacrificed at the beginning of the next end step.
 * - 702.150b: Casting for the blitz cost follows the rules for alternative
 *   costs. The spell's mana value is unchanged; other additional costs/taxes
 *   still apply.
 * - 702.150c: Multiple instances are redundant.
 *
 * These tests cover: parsing (parseBlitz / parseAlternativeCost), the
 * alternative-cost cast path (mana spend + CMC unchanged), the resolution
 * markers (haste + blitz flag), the dies-draw trigger, the end-step sacrifice,
 * the trigger-system detection wiring, and the normal-cast contrast.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { canCastSpell, castSpell, resolveTopOfStack } from "../spell-casting";
import {
  createInitialGameState,
  startGame,
  loadDeckForPlayer,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseBlitz,
  parseAlternativeCost,
  extractKeywords,
  AlternativeCostType,
} from "../oracle-text-parser";
import {
  hasBlitzMarker,
  resolveBlitzDeathDraw,
  applyBlitzEndStepSacrifice,
} from "../keyword-actions";
import {
  detectCreatureDeathTriggers,
  detectBlitzEndStepTriggers,
  detectTurnEndTriggers,
} from "../trigger-system";
import { Phase, ZoneType } from "../types";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Creature — Goblin",
    oracle_text: "",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    power: "4",
    toughness: "4",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A blitz creature. Printed mana cost {4}{R}{R} (mana value 6); blitz cost
 * {2}{R}. Used across the parsing and casting tests.
 */
function blitzCreature(): ScryfallCard {
  return makeCard({
    id: "mock-blitz-creature",
    name: "Henchfiend",
    type_line: "Creature — Ogre Warrior",
    oracle_text: "Blitz {2}{R}",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    power: "5",
    toughness: "4",
  });
}

/** A cheap card used to populate a drawable library. */
function basicMountain(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `mountain-${idSuffix}`,
    name: "Mountain",
    type_line: "Basic Land — Mountain",
    oracle_text: "({T}: Add {R}.)",
    mana_cost: "",
    cmc: 0,
  });
}

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

/** Place a card into a player's hand and the global card map. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

/** Place a permanent onto a player's battlefield. */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { blitz?: boolean; summoningSick?: boolean } = {},
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = opts.summoningSick ?? false;
  card.blitz = opts.blitz ? true : undefined;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card.id;
}

/** Hand size for a player. */
function handSize(state: GameState, playerId: PlayerId): number {
  return state.zones.get(`${playerId}-hand`)!.cardIds.length;
}

/** Library size for a player. */
function librarySize(state: GameState, playerId: PlayerId): number {
  return state.zones.get(`${playerId}-library`)!.cardIds.length;
}

/** Battlefield creature IDs for a player. */
function battlefieldIds(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
}

/** Graveyard IDs for a player. */
function graveyardIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)!.cardIds;
}

// ===========================================================================
// Parsing (CR 702.150a)
// ===========================================================================

describe("Blitz — parsing (CR 702.150)", () => {
  it("parseBlitz detects 'Blitz {cost}' and parses the cost", () => {
    const r = parseBlitz("Blitz {2}{R}");
    expect(r.hasBlitz).toBe(true);
    expect(r.blitzCost).not.toBeNull();
    expect(r.blitzCost!.generic).toBe(2);
    expect(r.blitzCost!.red).toBe(1);
    expect(r.description).toBe("Blitz {2}{R}");
  });

  it("parseBlitz is case-insensitive", () => {
    expect(parseBlitz("blitz {1}{B}").hasBlitz).toBe(true);
    expect(parseBlitz("BLITZ {3}").hasBlitz).toBe(true);
  });

  it("parseBlitz returns false when the keyword is absent", () => {
    expect(parseBlitz("Flying").hasBlitz).toBe(false);
    expect(parseBlitz("Dash {2}{R}").hasBlitz).toBe(false);
    expect(parseBlitz("").hasBlitz).toBe(false);
    expect(parseBlitz("").blitzCost).toBeNull();
  });

  it("parseBlitz does not match 'blitz' inside other words", () => {
    expect(parseBlitz("blitzkrieg").hasBlitz).toBe(false);
  });

  it("parseAlternativeCost recognizes blitz as an alternative cost", () => {
    const r = parseAlternativeCost("Blitz {2}{R}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.BLITZ);
    expect(r.manaCost).not.toBeNull();
    expect(r.manaCost!.red).toBe(1);
    expect(r.description).toContain("Blitz");
  });

  it("extractKeywords detects the blitz mechanic keyword", () => {
    const parsed = extractKeywords("Blitz {3}{R}", "Creature — Goblin");
    expect(parsed.some((k) => k.keyword.includes("blitz"))).toBe(true);
  });
});

// ===========================================================================
// Alternative-cost casting (CR 702.150a/b)
// ===========================================================================

describe("Blitz — casting for the blitz cost (CR 702.150b)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, blitzCreature());
    // Enough mana for either the printed cost or the blitz cost.
    f.state = addMana(f.state, f.aliceId, { red: 2, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("castSpell with alternativeCost blitz succeeds and records the cost used", () => {
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "blitz",
    });
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("blitz");
  });

  it("pays the blitz cost (not the printed mana cost)", () => {
    // Printed {4}{R}{R} = 4 generic + 2 red; blitz {2}{R} = 2 generic + 1 red.
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "blitz",
    });
    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // Spent exactly 2 generic + 1 red (the blitz cost).
    expect(before.generic - after.generic).toBe(2);
    expect(before.red - after.red).toBe(1);
  });

  it("leaves the spell's mana value (printed mana_cost / cmc) unchanged (CR 702.150b)", () => {
    const result = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "blitz",
    });
    expect(result.success).toBe(true);
    // The StackObject keeps the printed mana_cost string, not the blitz cost.
    expect(result.state.stack[0].manaCost).toBe("{4}{R}{R}");
    const card = result.state.cards.get(cardId)!;
    expect(card.cardData.cmc).toBe(6);
  });

  it("blitz cast is rejected when the blitz cost cannot be paid", () => {
    // Give Alice only 1 red + 1 generic: blitz cost is {2}{R} (2 generic + 1 red).
    const poor: GameState = {
      ...f.state,
      players: new Map(f.state.players).set(f.aliceId, {
        ...f.state.players.get(f.aliceId)!,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 1,
          green: 0,
          generic: 1,
        },
      }),
    };
    const result = castSpell(poor, f.aliceId, cardId, [], [], 0, false, {
      type: "blitz",
    });
    expect(result.success).toBe(false);
  });

  it("the same creature can be cast normally (without blitz) by paying its printed cost", () => {
    const result = castSpell(f.state, f.aliceId, cardId);
    expect(result.success).toBe(true);
    // Normal cast does not record the blitz alternative cost.
    expect(result.state.stack[0].alternativeCostsUsed ?? []).not.toContain(
      "blitz",
    );
  });
});

// ===========================================================================
// Resolution: haste + blitz marker (CR 702.150a)
// ===========================================================================

describe("Blitz — resolution grants haste and the blitz marker", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, blitzCreature());
    f.state = addMana(f.state, f.aliceId, { red: 2, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("a creature cast for blitz enters with the blitz marker and haste", () => {
    const cast = castSpell(f.state, f.aliceId, cardId, [], [], 0, false, {
      type: "blitz",
    });
    expect(cast.success).toBe(true);

    const resolved = resolveTopOfStack(cast.state);
    const onBf = battlefieldIds(resolved, f.aliceId);
    expect(onBf).toContain(cardId);
    const creature = resolved.cards.get(cardId)!;
    // CR 702.150a: gains haste (no summoning sickness) and is blitz-marked.
    expect(creature.blitz).toBe(true);
    expect(creature.hasSummoningSickness).toBe(false);
  });

  it("a creature cast normally is NOT blitz-marked and keeps summoning sickness", () => {
    const cast = castSpell(f.state, f.aliceId, cardId);
    expect(cast.success).toBe(true);

    const resolved = resolveTopOfStack(cast.state);
    const creature = resolved.cards.get(cardId)!;
    // Normal cast: no blitz effects (CR 702.150b — blitz effects apply only to
    // the blitz-cost cast).
    expect(creature.blitz).toBeFalsy();
    expect(creature.hasSummoningSickness).toBe(true);
  });
});

// ===========================================================================
// Dies-draw trigger (CR 702.150a)
// ===========================================================================

describe("Blitz — dies-draw trigger (CR 702.150a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    // Load a drawable library for Alice (startGame draws opening hands, so we
    // need extra cards left to draw from).
    const deck = Array.from({ length: 12 }, (_, i) => basicMountain(String(i)));
    f.state = loadDeckForPlayer(f.state, f.aliceId, deck, false);
    f.state.priorityPlayerId = f.aliceId;
  });

  it("hasBlitzMarker reports the marker", () => {
    const card = createCardInstance(blitzCreature(), f.aliceId, f.aliceId);
    card.blitz = true;
    expect(hasBlitzMarker(card)).toBe(true);
    card.blitz = undefined;
    expect(hasBlitzMarker(card)).toBe(false);
  });

  it("a dead blitz creature causes its controller to draw a card", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    // Simulate the creature dying (move to graveyard); marker is retained.
    const bf = f.state.zones.get(`${f.aliceId}-battlefield`)!;
    const gy = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== creatureId),
    });
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...gy,
      cardIds: [...gy.cardIds, creatureId],
    });

    const handBefore = handSize(f.state, f.aliceId);
    const libBefore = librarySize(f.state, f.aliceId);

    const res = resolveBlitzDeathDraw(f.state, creatureId);
    expect(res.applied).toBe(true);
    expect(handSize(res.state, f.aliceId)).toBe(handBefore + 1);
    expect(librarySize(res.state, f.aliceId)).toBe(libBefore - 1);
  });

  it("the marker is consumed so the draw cannot fire twice for one cast", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    const first = resolveBlitzDeathDraw(f.state, creatureId);
    expect(first.applied).toBe(true);
    // Second invocation on the same dead creature: marker already cleared.
    const second = resolveBlitzDeathDraw(first.state, creatureId);
    expect(second.applied).toBe(false);
  });

  it("a non-blitz creature dying does NOT draw a card", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: false,
    });
    const handBefore = handSize(f.state, f.aliceId);
    const res = resolveBlitzDeathDraw(f.state, creatureId);
    expect(res.applied).toBe(false);
    expect(handSize(res.state, f.aliceId)).toBe(handBefore);
  });
});

// ===========================================================================
// End-step sacrifice (CR 702.150a delayed trigger)
// ===========================================================================

describe("Blitz — end-step sacrifice (CR 702.150a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    // Drawable library so the coupled dies-draw can resolve on sacrifice.
    const deck = Array.from({ length: 12 }, (_, i) => basicMountain(String(i)));
    f.state = loadDeckForPlayer(f.state, f.aliceId, deck, false);
    f.state.priorityPlayerId = f.aliceId;
  });

  it("sacrifices a blitz creature at the end step (it goes to the graveyard)", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    const res = applyBlitzEndStepSacrifice(f.state);
    expect(res.applied).toBe(true);
    expect(res.affectedIds).toContain(creatureId);
    expect(battlefieldIds(res.state, f.aliceId)).not.toContain(creatureId);
    expect(graveyardIds(res.state, f.aliceId)).toContain(creatureId);
  });

  it("the sacrifice is a death, so the controller draws a card", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    const handBefore = handSize(f.state, f.aliceId);
    const res = applyBlitzEndStepSacrifice(f.state);
    expect(res.applied).toBe(true);
    expect(handSize(res.state, f.aliceId)).toBe(handBefore + 1);
  });

  it("does not affect a creature that was cast normally (no marker)", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: false,
    });
    const res = applyBlitzEndStepSacrifice(f.state);
    expect(res.applied).toBe(false);
    expect(battlefieldIds(res.state, f.aliceId)).toContain(creatureId);
  });

  it("only fires once (the sacrificed creature is gone next end step)", () => {
    putOnBattlefield(f.state, f.aliceId, blitzCreature(), { blitz: true });
    const first = applyBlitzEndStepSacrifice(f.state);
    expect(first.affectedIds.length).toBe(1);
    // A second pass finds nothing — the creature left the battlefield.
    const second = applyBlitzEndStepSacrifice(first.state);
    expect(second.applied).toBe(false);
    expect(second.affectedIds.length).toBe(0);
  });
});

// ===========================================================================
// Trigger-system detection wiring (CR 702.150a)
// ===========================================================================

describe("Blitz — trigger-system detection (CR 702.150a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("detectCreatureDeathTriggers synthesizes a draw trigger for a dead blitz creature", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    // Simulate the creature dying while retaining its marker.
    const bf = f.state.zones.get(`${f.aliceId}-battlefield`)!;
    const gy = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== creatureId),
    });
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...gy,
      cardIds: [...gy.cardIds, creatureId],
    });

    const triggers = detectCreatureDeathTriggers(
      f.state,
      creatureId,
      f.aliceId,
    );
    const draw = triggers.find((t) => /draw a card/i.test(t.effect));
    expect(draw).toBeDefined();
    expect(draw!.sourceCardId).toBe(creatureId);
    expect(draw!.triggeringPlayerId).toBe(f.aliceId);
  });

  it("detectCreatureDeathTriggers adds nothing for a non-blitz death", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: false,
    });
    const triggers = detectCreatureDeathTriggers(
      f.state,
      creatureId,
      f.aliceId,
    );
    expect(triggers.filter((t) => /draw a card/i.test(t.effect))).toHaveLength(
      0,
    );
  });

  it("detectBlitzEndStepTriggers returns a sacrifice trigger for each blitz creature", () => {
    const creatureId = putOnBattlefield(f.state, f.aliceId, blitzCreature(), {
      blitz: true,
    });
    const triggers = detectBlitzEndStepTriggers(f.state, f.aliceId);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].sourceCardId).toBe(creatureId);
    expect(triggers[0].effect).toMatch(/sacrifice/i);
    expect(triggers[0].triggeringPlayerId).toBe(f.aliceId);
  });

  it("detectTurnEndTriggers includes the blitz sacrifice trigger", () => {
    putOnBattlefield(f.state, f.aliceId, blitzCreature(), { blitz: true });
    const triggers = detectTurnEndTriggers(f.state, f.aliceId);
    expect(triggers.some((t) => /sacrifice/i.test(t.effect))).toBe(true);
  });

  it("detectBlitzEndStepTriggers is empty when no creature was blitz-cast", () => {
    putOnBattlefield(f.state, f.aliceId, blitzCreature(), { blitz: false });
    expect(detectBlitzEndStepTriggers(f.state, f.aliceId)).toHaveLength(0);
  });
});

// ===========================================================================
// Zone helper sanity (guards the test scaffolding itself)
// ===========================================================================

describe("Blitz — test scaffolding zone keys", () => {
  it("battlefield and graveyard zone keys resolve to the right zone types", () => {
    const f = makeFixture();
    expect(f.state.zones.get(`${f.aliceId}-battlefield`)!.type).toBe(
      ZoneType.BATTLEFIELD,
    );
    expect(f.state.zones.get(`${f.aliceId}-graveyard`)!.type).toBe(
      ZoneType.GRAVEYARD,
    );
  });
});
