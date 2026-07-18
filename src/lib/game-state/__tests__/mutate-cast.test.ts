/**
 * @fileoverview Unit tests for the Mutate keyword cast dispatch (CR 702.140).
 *
 * Issue #1410 — [Rules Engine] Wire Mutate merge into castSpell dispatch
 * (CR 702.140). This is the FINAL issue in the spell-casting clique.
 *
 * Mutate (CR 702.140):
 * - 702.140a: "Mutate [cost]" is a static ability that functions while the
 *   spell is on the stack. It offers an alternative cost: the spell's
 *   controller may pay [cost] rather than the printed mana cost to merge it
 *   with a target non-Human creature they control.
 * - 702.140b: The resulting merged permanent uses the top card's
 *   characteristics (P/T, color, type) and its text includes text from all
 *   components, with the highest-CMC component's text taking priority.
 * - 702.140f: If the target leaves the battlefield before the mutate spell
 *   resolves, the mutator enters the battlefield alone as a normal creature
 *   (the merge is abandoned).
 *
 * Unlike the other alternative-cost siblings (Convoke/Delve/Spectacle/
 * Escape), Mutate ALSO changes how the spell resolves — instead of entering
 * as an independent permanent, the mutator merges onto the target creature
 * via `applyMutate` (mutate.ts). These tests verify the full wiring: target
 * choice, cost replacement, applyMutate dispatch, resolution handling, the
 * target-disappears fallback, and the non-Human restriction.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  parseMutate,
  parseAlternativeCost,
  AlternativeCostType,
} from "../oracle-text-parser";
import { Phase } from "../types";
import { ZoneType } from "../types";
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
    type_line: "Creature — Elemental",
    oracle_text: "",
    mana_cost: "{2}{U}",
    cmc: 3,
    power: "2",
    toughness: "2",
    colors: ["U"],
    color_identity: ["U"],
    keywords: ["Mutate"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A canonical mutate creature. Printed mana cost {3}{U}{U} (mana value 5);
 * mutate cost {1}{U}. Oracle text intentionally uses the "Mutate {cost}"
 * keyword form that `parseMutate` recognises.
 */
function mutateCreature(): ScryfallCard {
  return makeCard({
    id: "mock-mutate-creature",
    name: "Cloudpiercer",
    type_line: "Creature — Elemental Dinosaur",
    oracle_text:
      "Mutate {1}{U}\nWhen this creature enters the battlefield, draw a card.",
    mana_cost: "{3}{U}{U}",
    cmc: 5,
    power: "4",
    toughness: "4",
    colors: ["U"],
    color_identity: ["U"],
    keywords: ["Mutate"],
  });
}

/** A non-Human target creature controlled by the caster. */
function targetBeast(): ScryfallCard {
  return makeCard({
    id: "mock-target-beast",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    power: "2",
    toughness: "2",
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
  });
}

/** A Human creature — an ILLEGAL mutate target per CR 702.140b. */
function humanCreature(): ScryfallCard {
  return makeCard({
    id: "mock-human",
    name: "Loyal Apprentice",
    type_line: "Creature — Human Artificer",
    oracle_text: "",
    mana_cost: "{1}{W}",
    cmc: 2,
    power: "1",
    toughness: "1",
    colors: ["W"],
    color_identity: ["W"],
    keywords: [],
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

/** Place a card onto a player's battlefield. */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-battlefield`;
  card.hasSummoningSickness = false;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card.id;
}

/** Remove a card from its controller's battlefield (simulates a destroy). */
function removeFromBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): void {
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: bf.cardIds.filter((id) => id !== cardId),
  });
  const card = state.cards.get(cardId);
  if (card) {
    card.currentZoneKey = `${playerId}-graveyard`;
  }
}

// ===========================================================================
// Parsing — parseMutate / parseAlternativeCost
// ===========================================================================

describe("Mutate — parsing (CR 702.140)", () => {
  it("parseMutate detects 'Mutate {cost}'", () => {
    const r = parseMutate("Mutate {1}{U}");
    expect(r.hasMutate).toBe(true);
    expect(r.mutateCost).not.toBeNull();
    expect(r.mutateCost!.generic).toBe(1);
    expect(r.mutateCost!.blue).toBe(1);
    expect(r.description).toBe("Mutate {1}{U}");
  });

  it("parseMutate is case-insensitive", () => {
    expect(parseMutate("mutate {2}{R}").hasMutate).toBe(true);
    expect(parseMutate("MUTATE {3}").hasMutate).toBe(true);
  });

  it("parseMutate returns false when the keyword is absent", () => {
    expect(parseMutate("Flying").hasMutate).toBe(false);
    expect(parseMutate("Flashback {2}{R}").hasMutate).toBe(false);
    expect(parseMutate("").hasMutate).toBe(false);
    expect(parseMutate("").mutateCost).toBeNull();
  });

  it("parseAlternativeCost recognises mutate as an alternative cost", () => {
    const r = parseAlternativeCost("Mutate {1}{U}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.MUTATE);
    expect(r.manaCost).not.toBeNull();
    expect(r.manaCost!.blue).toBe(1);
    expect(r.description).toContain("Mutate");
  });
});

// ===========================================================================
// castSpell — the alternative-cost switch branch (CR 702.140a/b)
// ===========================================================================

describe("Mutate — castSpell cost replacement + dispatch (CR 702.140a/b)", () => {
  let f: Fixture;
  let mutateCardId: CardInstanceId;
  let targetId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    mutateCardId = putInHand(f.state, f.aliceId, mutateCreature());
    targetId = putOnBattlefield(f.state, f.aliceId, targetBeast());
    // Printed {3}{U}{U} = 3 generic + 2 blue; mutate {1}{U} = 1 generic + 1 blue.
    // Give enough mana for either path.
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("castSpell with alternativeCost mutate succeeds and records the cost used", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: targetId,
      },
    );
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("mutate");
  });

  it("mutate cost REPLACES the printed mana cost (CR 702.140b)", () => {
    // Printed {3}{U}{U} = 3 generic + 2 blue; mutate {1}{U} = 1 generic + 1 blue.
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: targetId,
      },
    );
    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // Spent exactly 1 generic + 1 blue (the mutate cost), NOT the printed cost.
    expect(before.generic - after.generic).toBe(1);
    expect(before.blue - after.blue).toBe(1);
  });

  it("leaves the spell's mana value (printed mana_cost / cmc) unchanged (CR 702.140b)", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: targetId,
      },
    );
    expect(result.success).toBe(true);
    // The StackObject keeps the printed mana_cost string, not the mutate cost.
    expect(result.state.stack[0].manaCost).toBe("{3}{U}{U}");
    const card = result.state.cards.get(mutateCardId)!;
    expect(card.cardData.cmc).toBe(5);
  });

  it("stamps the target creature id on the StackObject for resolution", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: targetId,
      },
    );
    expect(result.success).toBe(true);
    expect(result.state.stack[0].mutateTargetCreatureId).toBe(targetId);
  });

  it("is rejected when no target creature is declared", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/target creature/i);
  });

  it("is rejected when the card has no mutate cost", () => {
    const nonMutateId = putInHand(
      f.state,
      f.aliceId,
      makeCard({
        id: "mock-non-mutate",
        name: "Plain Creature",
        oracle_text: "Flying",
        keywords: [],
      }),
    );
    const result = castSpell(
      f.state,
      f.aliceId,
      nonMutateId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: targetId,
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mutate cost/i);
  });
});

// ===========================================================================
// Non-Human target restriction (CR 702.140b)
// ===========================================================================

describe("Mutate — non-Human target restriction (CR 702.140b)", () => {
  let f: Fixture;
  let mutateCardId: CardInstanceId;
  let humanId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    mutateCardId = putInHand(f.state, f.aliceId, mutateCreature());
    humanId = putOnBattlefield(f.state, f.aliceId, humanCreature());
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("rejects mutating onto a Human creature", () => {
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: humanId,
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/human/i);
  });

  it("rejects mutating onto a creature the caster does not control", () => {
    const opponentBeastId = putOnBattlefield(f.state, f.bobId, targetBeast());
    const result = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      {
        type: "mutate",
        targetCreatureId: opponentBeastId,
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/control/i);
  });
});

// ===========================================================================
// Resolution — merge onto target (CR 702.140b) + target-disappears fallback
// ===========================================================================

describe("Mutate — resolution: merge onto target (CR 702.140b)", () => {
  let f: Fixture;
  let mutateCardId: CardInstanceId;
  let targetId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    mutateCardId = putInHand(f.state, f.aliceId, mutateCreature());
    targetId = putOnBattlefield(f.state, f.aliceId, targetBeast());
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("merges the mutator onto the target creature when the spell resolves", () => {
    const castResult = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      { type: "mutate", targetCreatureId: targetId },
    );
    expect(castResult.success).toBe(true);

    const resolved = resolveTopOfStack(castResult.state);
    // The merge relationship is established by applyMutate (CR 702.140b):
    // the target now carries the mutator in its mutatedCardIds list, and the
    // mutator records its mutateBaseId back to the target.
    const targetAfter = resolved.cards.get(targetId)!;
    expect(targetAfter.mutatedCardIds).toContain(mutateCardId);
    expect(targetAfter.isMutated).toBe(true);

    const mutatorAfter = resolved.cards.get(mutateCardId)!;
    expect(mutatorAfter.mutateBaseId).toBe(targetId);
    expect(mutatorAfter.isMutated).toBe(true);

    // The stack is empty after resolution.
    expect(resolved.stack.length).toBe(0);
  });

  it("records the highest-CMC component for merged-characteristics (CR 702.140b)", () => {
    // Mutator cmc 5, target cmc 2 → mutator is the highest-CMC component.
    const castResult = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      { type: "mutate", targetCreatureId: targetId },
    );
    const resolved = resolveTopOfStack(castResult.state);
    const targetAfter = resolved.cards.get(targetId)!;
    expect(targetAfter.highestCmcComponentId).toBe(mutateCardId);
  });

  it("merged permanent carries combined text from both components (CR 702.140b)", () => {
    const castResult = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      { type: "mutate", targetCreatureId: targetId },
    );
    const resolved = resolveTopOfStack(castResult.state);
    // getMutatedCreatureText combines text from all stack components, highest
    // CMC first (mutate.ts:174-200). The mutator (cmc 5) wins priority.
    // Import lazily to avoid a circular import at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMutatedCreatureText } = require("../mutate");
    const text = getMutatedCreatureText(resolved, targetId);
    // The mutator's "draw a card" ETB text and any component text both appear.
    expect(text).toContain("draw a card");
  });
});

describe("Mutate — target-disappears fallback (CR 702.140f)", () => {
  let f: Fixture;
  let mutateCardId: CardInstanceId;
  let targetId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    mutateCardId = putInHand(f.state, f.aliceId, mutateCreature());
    targetId = putOnBattlefield(f.state, f.aliceId, targetBeast());
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("enters as a normal creature when the target leaves the battlefield before resolution (CR 702.140f)", () => {
    const castResult = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      { type: "mutate", targetCreatureId: targetId },
    );
    expect(castResult.success).toBe(true);

    // Simulate the target being destroyed in response (while the mutate spell
    // is on the stack). The target leaves the battlefield; the mutator is now
    // an illegal merge target.
    removeFromBattlefield(castResult.state, f.aliceId, targetId);

    const resolved = resolveTopOfStack(castResult.state);
    // The mutator did NOT merge — it enters as a normal creature.
    const mutatorAfter = resolved.cards.get(mutateCardId)!;
    expect(mutatorAfter.mutateBaseId).toBeNull();
    expect(mutatorAfter.isMutated).toBe(false);
    // The target creature is not marked as mutated.
    const targetAfter = resolved.cards.get(targetId)!;
    expect(targetAfter.mutatedCardIds).not.toContain(mutateCardId);
    // The mutator is on the battlefield (entered as a normal creature).
    const bfZone = resolved.zones.get(`${f.aliceId}-battlefield`)!;
    expect(bfZone.cardIds).toContain(mutateCardId);
    expect(bfZone.type).toBe(ZoneType.BATTLEFIELD);
    // The stack is empty after resolution.
    expect(resolved.stack.length).toBe(0);
  });
});

// ===========================================================================
// Wiring: applyMutate is called from the casting flow
// ===========================================================================

describe("Mutate — applyMutate is wired into castSpell resolution", () => {
  it("rg-verification: castSpell calls applyMutate during mutate resolution", () => {
    // This is a structural assertion: the castSpell dispatch records the
    // mutate alternative cost, and resolveTopOfStack dispatches applyMutate
    // via the mutate alternative-cost branch in resolveSpellCompletion. The
    // merge relationship (mutatedCardIds / mutateBaseId) can ONLY be set by
    // applyMutate (mutate.ts:88-141), so observing it after resolution proves
    // the wiring is live.
    const f = makeFixture();
    const mutateCardId = putInHand(f.state, f.aliceId, mutateCreature());
    const targetId = putOnBattlefield(f.state, f.aliceId, targetBeast());
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 8 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];

    const castResult = castSpell(
      f.state,
      f.aliceId,
      mutateCardId,
      [],
      [],
      0,
      false,
      { type: "mutate", targetCreatureId: targetId },
    );
    expect(castResult.success).toBe(true);
    expect(castResult.state.stack[0].alternativeCostsUsed).toContain("mutate");

    const resolved = resolveTopOfStack(castResult.state);
    // If applyMutate were NOT wired, mutatedCardIds would be empty. The fact
    // that it contains the mutator proves applyMutate was dispatched.
    expect(resolved.cards.get(targetId)!.mutatedCardIds).toContain(
      mutateCardId,
    );
  });
});
