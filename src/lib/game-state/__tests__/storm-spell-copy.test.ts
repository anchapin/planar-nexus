/**
 * @fileoverview Unit tests for spell-copy effects and the Storm keyword.
 *
 * Issue #1059 — [Rules Engine] Implement spell-copy effects and storm count
 * (CR 702.41, CR 707).
 *
 * Storm (CR 702.41):
 * - 702.41a: "When you cast this spell, copy it for each spell cast before it
 *   this turn. If the spell has any targets, you may choose new targets for any
 *   of the copies."
 * - 702.41c: multiple instances are redundant.
 *
 * Copying spells (CR 707.10):
 * - 707.10: a copy of a spell is itself a spell on the stack, with the same
 *   characteristics (name, cost, text, modes, targets, controller) and no cost
 *   paid. It is not "cast", so it does not add to the storm count.
 * - 707.10c: the copy retains the original's targets.
 * - 707.10d: the controller may choose new targets; a permanent copy enters as
 *   a token.
 *
 * Coverage: parsing, storm-count tracking (+ per-turn reset), storm copies
 * count, the copySpellOnStack primitive (characteristics/targets), and copy
 * resolution (instant vs permanent).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  castSpell,
  copySpellOnStack,
  resolveTopOfStack,
} from "../spell-casting";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { parseStorm } from "../oracle-text-parser";
import { detectStormTrigger } from "../trigger-system";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
  StackObject,
  Target,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}{R}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A storm cantrip (stands in for Grapeshot / Empty the Warrens). Untargeted so
 * the test can focus on copy COUNT without exercising target validation.
 */
function stormCantrip(): ScryfallCard {
  return makeCard({
    id: "mock-grapeshot",
    name: "Grapeshot",
    type_line: "Instant",
    oracle_text: "Storm\nYou draw a card.",
    mana_cost: "{1}{R}",
    cmc: 2,
  });
}

/** A cheap non-storm instant used to increment the storm count by casting. */
function cheapCantrip(): ScryfallCard {
  return makeCard({
    id: "mock-opt",
    name: "Opt",
    type_line: "Instant",
    oracle_text: "Draw a card.",
    mana_cost: "{U}",
    cmc: 1,
    colors: ["U"],
  });
}

/** A targeted damage instant (Lightning Bolt–like) for copy-target tests. */
function damageSpell(): ScryfallCard {
  return makeCard({
    id: "mock-bolt",
    name: "Lightning Bolt",
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
  });
}

/** A vanilla creature spell for the permanent-copy-to-token test. */
function vanillaCreature(): ScryfallCard {
  return makeCard({
    id: "mock-bear",
    name: "Runeclaw Bear",
    type_line: "Creature — Bear",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    power: "2",
    toughness: "2",
  });
}

function playerTarget(playerId: PlayerId): Target {
  return { type: "player", targetId: playerId, isValid: true };
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
  state.turn.isFirstTurn = false;
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

/** Register a card in the card map (without placing it in a zone). */
function registerCard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  return card;
}

/** Push a spell StackObject onto the stack (simulating it having been cast). */
function pushSpell(
  state: GameState,
  controllerId: PlayerId,
  card: CardInstance,
  overrides: Partial<StackObject> = {},
): StackObject {
  const obj: StackObject = {
    id: `spell-${state.stack.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
    type: "spell",
    sourceCardId: card.id,
    controllerId,
    name: card.cardData.name,
    text: card.cardData.oracle_text ?? "",
    manaCost: card.cardData.mana_cost ?? null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    ...overrides,
  };
  state.stack = [...state.stack, obj];
  return obj;
}

// ===========================================================================
// Tests — parsing
// ===========================================================================

describe("Storm — parsing (CR 702.41)", () => {
  it("detects the Storm keyword in oracle text", () => {
    expect(parseStorm("Storm\nYou draw a card.").hasStorm).toBe(true);
    expect(parseStorm("Storm").hasStorm).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseStorm("storm").hasStorm).toBe(true);
    expect(parseStorm("STORM").hasStorm).toBe(true);
  });

  it("returns false when the keyword is absent or empty", () => {
    expect(parseStorm("Draw a card.").hasStorm).toBe(false);
    expect(parseStorm("").hasStorm).toBe(false);
  });

  it("does not match substrings inside other words", () => {
    // word-boundary anchored on both sides
    expect(parseStorm("Brainstorm").hasStorm).toBe(false); // no boundary before 's'
    expect(parseStorm("stormbound").hasStorm).toBe(false); // no boundary after 'm'
  });

  it("exposes a description when present", () => {
    expect(parseStorm("Storm").description).toBe("Storm");
    expect(parseStorm("Draw a card.").description).toBe("");
  });
});

// ===========================================================================
// Tests — storm count tracking
// ===========================================================================

describe("Storm count tracking (Player.spellsCastThisTurn)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
  });

  it("initializes to 0 for a freshly created player", () => {
    expect(f.state.players.get(f.aliceId)!.spellsCastThisTurn ?? 0).toBe(0);
    expect(f.state.players.get(f.bobId)!.spellsCastThisTurn ?? 0).toBe(0);
  });

  it("increments by 1 each time a player casts a spell", () => {
    const card1 = putInHand(f.state, f.aliceId, cheapCantrip());
    const card2 = putInHand(f.state, f.aliceId, cheapCantrip());
    f.state = addMana(f.state, f.aliceId, { blue: 4, generic: 0 });

    const r1 = castSpell(f.state, f.aliceId, card1);
    expect(r1.success).toBe(true);
    expect(r1.state.players.get(f.aliceId)!.spellsCastThisTurn).toBe(1);

    // castSpell passes priority; hand it back to Alice for the second cast.
    r1.state.priorityPlayerId = f.aliceId;
    const r2 = castSpell(r1.state, f.aliceId, card2);
    expect(r2.success).toBe(true);
    expect(r2.state.players.get(f.aliceId)!.spellsCastThisTurn).toBe(2);
  });

  it("spell COPIES do not increment the storm count (CR 707.10)", () => {
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const spell = pushSpell(f.state, f.aliceId, card, {
      targets: [playerTarget(f.bobId)],
    });
    expect(f.state.players.get(f.aliceId)!.spellsCastThisTurn ?? 0).toBe(0);

    const copy = copySpellOnStack(f.state, spell.id);
    expect(copy.success).toBe(true);
    // Copying did not change the cast counter.
    expect(copy.state.players.get(f.aliceId)!.spellsCastThisTurn ?? 0).toBe(0);
  });

  it("resets to 0 at the start of the next turn (CR 702.41a)", () => {
    // Simulate Alice having cast several spells this turn.
    const alice = f.state.players.get(f.aliceId)!;
    f.state.players.set(f.aliceId, { ...alice, spellsCastThisTurn: 5 });

    // Park the turn at CLEANUP (the final step). When all players pass with an
    // empty stack from CLEANUP, advancePhase wraps and the engine starts a new
    // turn, resetting every player's per-turn counters.
    f.state.turn.currentPhase = Phase.CLEANUP;
    f.state.stack = [];
    f.state.consecutivePasses = 0;
    f.state.priorityPlayerId = f.aliceId;
    f.state.players.forEach((p) =>
      f.state.players.set(p.id, { ...p, hasPassedPriority: false }),
    );

    const turnBefore = f.state.turn.turnNumber;
    let s = passPriority(f.state, f.aliceId);
    s = passPriority(s, f.bobId);

    expect(s.turn.turnNumber).toBe(turnBefore + 1);
    expect(s.players.get(f.aliceId)!.spellsCastThisTurn ?? 0).toBe(0);
    expect(s.players.get(f.bobId)!.spellsCastThisTurn ?? 0).toBe(0);
  });
});

// ===========================================================================
// Tests — storm trigger copy count
// ===========================================================================

describe("Storm trigger — copy count (CR 702.41a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
  });

  it("detectStormTrigger reports copyCount = spells cast before this one", () => {
    const card = registerCard(f.state, f.aliceId, stormCantrip());
    const spell = pushSpell(f.state, f.aliceId, card, { storm: true });

    // 4 spells cast this turn (including the storm spell itself) → 3 copies.
    const alice = f.state.players.get(f.aliceId)!;
    f.state.players.set(f.aliceId, { ...alice, spellsCastThisTurn: 4 });

    const storm = detectStormTrigger(f.state, spell.id);
    expect(storm.shouldFire).toBe(true);
    expect(storm.copyCount).toBe(3);
  });

  it("returns copyCount 0 for a non-storm spell", () => {
    const card = registerCard(f.state, f.aliceId, cheapCantrip());
    const spell = pushSpell(f.state, f.aliceId, card);
    const alice = f.state.players.get(f.aliceId)!;
    f.state.players.set(f.aliceId, { ...alice, spellsCastThisTurn: 4 });
    expect(detectStormTrigger(f.state, spell.id)).toEqual({
      shouldFire: false,
      copyCount: 0,
    });
  });

  it("casting a storm spell with 3 prior spells creates exactly 3 copies", () => {
    // Simulate 3 spells already cast this turn (the "storm count").
    const alice = f.state.players.get(f.aliceId)!;
    f.state.players.set(f.aliceId, { ...alice, spellsCastThisTurn: 3 });

    const stormCard = putInHand(f.state, f.aliceId, stormCantrip());
    f.state = addMana(f.state, f.aliceId, { red: 2, generic: 5 });

    const result = castSpell(f.state, f.aliceId, stormCard);
    expect(result.success).toBe(true);

    const stack = result.state.stack;
    // 1 original + 3 copies.
    const stormObjects = stack.filter((o) => o.storm === true);
    expect(stormObjects.length).toBe(4);
    expect(stack.filter((o) => o.isCopy === true).length).toBe(3);

    // The original (pushed first) is not a copy; the rest are.
    expect(stack[0].isCopy !== true).toBe(true);
    expect(stack.slice(1).every((o) => o.isCopy === true)).toBe(true);

    // All copies share the original's characteristics.
    expect(stack.every((o) => o.name === "Grapeshot")).toBe(true);
    expect(stack.every((o) => o.controllerId === f.aliceId)).toBe(true);

    // The storm spell itself was counted when cast → 4.
    expect(result.state.players.get(f.aliceId)!.spellsCastThisTurn).toBe(4);
  });

  it("a storm spell cast as the first spell this turn creates no copies", () => {
    const stormCard = putInHand(f.state, f.aliceId, stormCantrip());
    f.state = addMana(f.state, f.aliceId, { red: 2, generic: 5 });

    const result = castSpell(f.state, f.aliceId, stormCard);
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].isCopy !== true).toBe(true);
    expect(result.state.players.get(f.aliceId)!.spellsCastThisTurn).toBe(1);
  });
});

// ===========================================================================
// Tests — copySpellOnStack primitive (CR 707.10)
// ===========================================================================

describe("copySpellOnStack — characteristics & targets (CR 707.10)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
  });

  it("creates a new spell on the stack with the same characteristics", () => {
    const card = registerCard(f.state, f.aliceId, stormCantrip());
    const original = pushSpell(f.state, f.aliceId, card, {
      manaCost: "{1}{R}",
      chosenModes: ["modeA"],
      storm: true,
    });
    original.variableValues.set("X", 3);

    const result = copySpellOnStack(f.state, original.id);
    expect(result.success).toBe(true);
    expect(result.copiedStackObjectId).toBeTruthy();

    const copy = result.state.stack[result.state.stack.length - 1];
    expect(copy.id).not.toBe(original.id);
    expect(copy.isCopy).toBe(true);
    expect(copy.name).toBe(original.name);
    expect(copy.text).toBe(original.text);
    expect(copy.manaCost).toBe(original.manaCost);
    expect(copy.controllerId).toBe(original.controllerId);
    expect(copy.sourceCardId).toBe(original.sourceCardId);
    expect(copy.chosenModes).toEqual(original.chosenModes);
    expect(copy.variableValues.get("X")).toBe(3);
    expect(copy.storm).toBe(true);
    expect(copy.isCountered).toBe(false);
  });

  it("retains the original's targets by default (CR 707.10c)", () => {
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const original = pushSpell(f.state, f.aliceId, card, {
      targets: [playerTarget(f.bobId)],
    });

    const result = copySpellOnStack(f.state, original.id);
    const copy = result.state.stack[result.state.stack.length - 1];
    expect(copy.targets).toEqual(original.targets);
    expect(copy.targets[0].targetId).toBe(f.bobId);
  });

  it("allows the controller to choose new targets (CR 707.10d)", () => {
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const original = pushSpell(f.state, f.aliceId, card, {
      targets: [playerTarget(f.aliceId)],
    });

    const result = copySpellOnStack(f.state, original.id, [
      playerTarget(f.bobId),
    ]);
    const copy = result.state.stack[result.state.stack.length - 1];
    // Copy is retargeted at Bob; the original still targets Alice.
    expect(copy.targets[0].targetId).toBe(f.bobId);
    expect(original.targets[0].targetId).toBe(f.aliceId);
  });

  it("can copy a copy (CR 707.10)", () => {
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const original = pushSpell(f.state, f.aliceId, card, {
      targets: [playerTarget(f.bobId)],
    });

    const first = copySpellOnStack(f.state, original.id);
    expect(first.success).toBe(true);
    const firstCopy = first.state.stack[first.state.stack.length - 1];
    expect(firstCopy.isCopy).toBe(true);

    const second = copySpellOnStack(first.state, firstCopy.id);
    expect(second.success).toBe(true);
    const secondCopy = second.state.stack[second.state.stack.length - 1];
    expect(secondCopy.isCopy).toBe(true);
    expect(secondCopy.name).toBe(original.name);
    expect(secondCopy.targets[0].targetId).toBe(f.bobId);
  });

  it("rejects copying a non-spell stack object", () => {
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const ability: StackObject = {
      id: "ability-1",
      type: "ability",
      sourceCardId: card.id,
      controllerId: f.aliceId,
      name: "Tap: Draw",
      text: "{T}: Draw a card.",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
    };
    f.state.stack = [...f.state.stack, ability];

    const result = copySpellOnStack(f.state, ability.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spell/i);
  });

  it("rejects an unknown source stack object id", () => {
    const result = copySpellOnStack(f.state, "does-not-exist");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ===========================================================================
// Tests — copy resolution (CR 707.10d)
// ===========================================================================

describe("Copy resolution (CR 707.10d)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
  });

  it("an instant copy resolves against its (possibly new) target then leaves the stack", () => {
    // Original Lightning Bolt targets Alice; the copy is retargeted at Bob.
    const card = registerCard(f.state, f.aliceId, damageSpell());
    const original = pushSpell(f.state, f.aliceId, card, {
      targets: [playerTarget(f.aliceId)],
    });

    const copy = copySpellOnStack(f.state, original.id, [
      playerTarget(f.bobId),
    ]);
    expect(copy.success).toBe(true);

    const bobLifeBefore = copy.state.players.get(f.bobId)!.life;
    const aliceLifeBefore = copy.state.players.get(f.aliceId)!.life;
    const graveBefore = copy.state.zones.get(`${f.aliceId}-graveyard`)!.cardIds
      .length;

    // resolveTopOfStack resolves the TOP object (the copy, which was pushed last).
    const resolved = resolveTopOfStack(copy.state);

    // The copy dealt 3 to its target (Bob), not to Alice.
    expect(resolved.players.get(f.bobId)!.life).toBe(bobLifeBefore - 3);
    expect(resolved.players.get(f.aliceId)!.life).toBe(aliceLifeBefore);

    // The copy is gone from the stack...
    expect(resolved.stack.some((o) => o.id === copy.copiedStackObjectId)).toBe(
      false,
    );
    // ...and no card was moved to graveyard (a copy has no card backing it).
    expect(resolved.zones.get(`${f.aliceId}-graveyard`)!.cardIds.length).toBe(
      graveBefore,
    );
  });

  it("a permanent copy enters the battlefield as a token", () => {
    const card = registerCard(f.state, f.aliceId, vanillaCreature());
    // The copy is itself a spell on the stack (isCopy), backed by the creature
    // card's characteristics via sourceCardId.
    const copyObj: StackObject = {
      id: "creature-copy",
      type: "spell",
      sourceCardId: card.id,
      controllerId: f.aliceId,
      name: card.cardData.name,
      text: card.cardData.oracle_text ?? "",
      manaCost: card.cardData.mana_cost ?? null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
      isCopy: true,
    };
    f.state.stack = [...f.state.stack, copyObj];

    const bfBefore = f.state.zones.get(`${f.aliceId}-battlefield`)!.cardIds
      .length;

    const resolved = resolveTopOfStack(f.state);

    // Copy removed from the stack...
    expect(resolved.stack.some((o) => o.id === "creature-copy")).toBe(false);
    // ...and a token (copy of the permanent) entered Alice's battlefield.
    expect(resolved.zones.get(`${f.aliceId}-battlefield`)!.cardIds.length).toBe(
      bfBefore + 1,
    );
  });
});
