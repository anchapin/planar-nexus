/**
 * @fileoverview Unit tests for the Prowess evergreen keyword.
 *
 * Issue #1058 — [Rules Engine] Implement Prowess triggered ability (CR 702.108).
 *
 * Prowess (CR 702.108):
 * - 702.108a: Prowess is a triggered ability. "Whenever you cast a noncreature
 *   spell, this creature gets +1/+1 until end of turn."
 * - 702.108b: Multiple instances of prowess on the same creature trigger
 *   separately (each instance adds its own +1/+1).
 *
 * Coverage: oracle-text parsing, keyword detection + instance counting, the
 * cast-trigger detection (noncreature fires / creature does not / only the
 * caster's creatures / multi-instance stacks), the layer-7 +1/+1 application,
 * end-of-turn cleanup, and end-to-end behaviour through `castSpell`.
 */

import { describe, it, expect } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { parseProwess } from "../oracle-text-parser";
import { detectProwessTriggers } from "../trigger-system";
import {
  hasProwess,
  getProwessInstanceCount,
  getProwessBonus,
  applyProwessBoost,
  clearProwessBoosts,
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
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

/** A 1/2 prowess creature (stands in for Monastery Swiftspear). */
function prowessCreature(
  overrides: Partial<ScryfallCard> & { id: string } = { id: "mock-prowess" },
): ScryfallCard {
  return makeCard({
    name: "Prowess Creature",
    type_line: "Creature — Test",
    oracle_text: "Prowess",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    power: "1",
    toughness: "2",
    keywords: ["prowess"],
    ...overrides,
  });
}

/** A 1/2 creature that has prowess twice (CR 702.108b stacking case). */
function doubleProwessCreature(): ScryfallCard {
  return prowessCreature({
    id: "mock-double-prowess",
    name: "Double Prowess Creature",
    keywords: ["prowess", "prowess"],
  });
}

/** A cheap noncreature spell used to trigger prowess. */
function cantrip(): ScryfallCard {
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

/** A cheap creature spell that must NOT trigger prowess. */
function creatureSpell(): ScryfallCard {
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

/** Place a permanent onto a player's battlefield and the global card map. */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  controllerId?: PlayerId,
): CardInstance {
  const owner = controllerId ?? playerId;
  const card = createCardInstance(cardData, owner, owner);
  // Permanents entering the battlefield are ready (no summoning sickness for
  // the purposes of these non-combat tests).
  card.hasSummoningSickness = false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card;
}

/** Place a card into a player's hand and the global card map. */
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

// ===========================================================================
// Tests — parsing (CR 702.108)
// ===========================================================================

describe("Prowess — parsing (CR 702.108)", () => {
  it("detects the Prowess keyword in oracle text", () => {
    expect(parseProwess("Prowess").hasProwess).toBe(true);
    expect(
      parseProwess("Prowess\nWhenever you cast a noncreature spell...")
        .hasProwess,
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseProwess("prowess").hasProwess).toBe(true);
    expect(parseProwess("PROWESS").hasProwess).toBe(true);
  });

  it("returns false when the keyword is absent or empty", () => {
    expect(parseProwess("Draw a card.").hasProwess).toBe(false);
    expect(parseProwess("").hasProwess).toBe(false);
    expect(parseProwess("").description).toBe("");
  });

  it("does not match the keyword inside other words", () => {
    expect(parseProwess("Spellprowess").hasProwess).toBe(false);
  });

  it("exposes a description when present", () => {
    expect(parseProwess("Prowess").description).toBe("Prowess");
  });
});

// ===========================================================================
// Tests — keyword detection + instance counting
// ===========================================================================

describe("Prowess — detection + instance count (CR 702.108b)", () => {
  it("detects prowess on a creature", () => {
    const card = createCardInstance(prowessCreature(), "p1", "p1");
    expect(hasProwess(card)).toBe(true);
    expect(getProwessInstanceCount(card)).toBe(1);
  });

  it("returns false for a noncreature even if the word appears", () => {
    const card = createCardInstance(
      makeCard({
        id: "mock-noncreature",
        type_line: "Enchantment",
        oracle_text: "Prowess",
      }),
      "p1",
      "p1",
    );
    expect(hasProwess(card)).toBe(false);
    expect(getProwessInstanceCount(card)).toBe(0);
  });

  it("counts multiple prowess instances for stacking (CR 702.108b)", () => {
    const card = createCardInstance(doubleProwessCreature(), "p1", "p1");
    expect(hasProwess(card)).toBe(true);
    expect(getProwessInstanceCount(card)).toBe(2);
  });

  it("returns a 0 bonus when none is active", () => {
    const card = createCardInstance(prowessCreature(), "p1", "p1");
    expect(getProwessBonus(card)).toBe(0);
  });
});

// ===========================================================================
// Tests — trigger detection
// ===========================================================================

describe("Prowess — trigger detection (CR 702.108a)", () => {
  it("fires one trigger per prowess creature on a noncreature cast", () => {
    const f = makeFixture();
    const a = putOnBattlefield(
      f.state,
      f.aliceId,
      prowessCreature({
        id: "prowess-a",
      }),
    );
    const b = putOnBattlefield(
      f.state,
      f.aliceId,
      prowessCreature({
        id: "prowess-b",
      }),
    );
    // The spell being cast (noncreature).
    const spell = putInHand(f.state, f.aliceId, cantrip());

    const triggers = detectProwessTriggers(
      f.state,
      spell,
      f.aliceId,
      f.aliceId,
    );
    expect(triggers).toHaveLength(2);
    expect(new Set(triggers.map((t) => t.sourceCardId))).toEqual(
      new Set([a.id, b.id]),
    );
  });

  it("does NOT fire when the cast spell is a creature spell", () => {
    const f = makeFixture();
    putOnBattlefield(f.state, f.aliceId, prowessCreature());
    const creature = putInHand(f.state, f.aliceId, creatureSpell());

    const triggers = detectProwessTriggers(
      f.state,
      creature,
      f.aliceId,
      f.aliceId,
    );
    expect(triggers).toHaveLength(0);
  });

  it("does NOT fire for prowess creatures controlled by an opponent", () => {
    const f = makeFixture();
    // Bob controls the prowess creature; Alice casts.
    putOnBattlefield(f.state, f.bobId, prowessCreature());
    const spell = putInHand(f.state, f.aliceId, cantrip());

    const triggers = detectProwessTriggers(
      f.state,
      spell,
      f.aliceId,
      f.aliceId,
    );
    expect(triggers).toHaveLength(0);
  });

  it("fires once per prowess instance when a creature has prowess twice", () => {
    const f = makeFixture();
    const dbl = putOnBattlefield(f.state, f.aliceId, doubleProwessCreature());
    const spell = putInHand(f.state, f.aliceId, cantrip());

    const triggers = detectProwessTriggers(
      f.state,
      spell,
      f.aliceId,
      f.aliceId,
    );
    expect(triggers).toHaveLength(2);
    expect(triggers.every((t) => t.sourceCardId === dbl.id)).toBe(true);
  });
});

// ===========================================================================
// Tests — layer-7 power/toughness application + EOT cleanup
// ===========================================================================

describe("Prowess — +1/+1 application + end-of-turn cleanup", () => {
  it("adds prowessBoost to effective power and toughness", () => {
    const card = createCardInstance(prowessCreature(), "p1", "p1");
    expect(getEffectivePower(card)).toBe(1);
    expect(getEffectiveToughness(card)).toBe(2);

    card.prowessBoost = 1;
    expect(getEffectivePower(card)).toBe(2);
    expect(getEffectiveToughness(card)).toBe(3);

    card.prowessBoost = 3;
    expect(getEffectivePower(card)).toBe(4);
    expect(getEffectiveToughness(card)).toBe(5);
  });

  it("applyProwessBoost increments the active bonus", () => {
    const f = makeFixture();
    const creature = putOnBattlefield(f.state, f.aliceId, prowessCreature());

    const s1 = applyProwessBoost(f.state, creature.id);
    expect(getProwessBonus(s1.cards.get(creature.id)!)).toBe(1);

    const s2 = applyProwessBoost(s1, creature.id);
    expect(getProwessBonus(s2.cards.get(creature.id)!)).toBe(2);

    // Original state is untouched (immutable).
    expect(getProwessBonus(f.state.cards.get(creature.id)!)).toBe(0);
  });

  it("clearProwessBoosts removes the bonus at end of turn", () => {
    const f = makeFixture();
    const creature = putOnBattlefield(f.state, f.aliceId, prowessCreature());
    const boosted = applyProwessBoost(
      applyProwessBoost(f.state, creature.id),
      creature.id,
    );
    expect(getProwessBonus(boosted.cards.get(creature.id)!)).toBe(2);

    const cleared = clearProwessBoosts(boosted);
    expect(getProwessBonus(cleared.cards.get(creature.id)!)).toBe(0);
    // Effective P/T return to base after cleanup.
    expect(getEffectivePower(cleared.cards.get(creature.id)!)).toBe(1);
    expect(getEffectiveToughness(cleared.cards.get(creature.id)!)).toBe(2);
  });
});

// ===========================================================================
// Tests — end-to-end via castSpell
// ===========================================================================

describe("Prowess — castSpell integration", () => {
  it("pumps a prowess creature +1/+1 when its controller casts a noncreature spell", () => {
    const f = makeFixture();
    const creature = putOnBattlefield(f.state, f.aliceId, prowessCreature());
    const spell = putInHand(f.state, f.aliceId, cantrip());
    f.state = addMana(f.state, f.aliceId, { blue: 2 });

    const result = castSpell(f.state, f.aliceId, spell);
    expect(result.success).toBe(true);

    const boosted = result.state.cards.get(creature.id)!;
    expect(boosted.prowessBoost).toBe(1);
    expect(getEffectivePower(boosted)).toBe(2);
    expect(getEffectiveToughness(boosted)).toBe(3);
  });

  it("does NOT trigger when the cast spell is a creature", () => {
    const f = makeFixture();
    const creature = putOnBattlefield(f.state, f.aliceId, prowessCreature());
    const bear = putInHand(f.state, f.aliceId, creatureSpell());
    f.state = addMana(f.state, f.aliceId, { green: 3 });

    const result = castSpell(f.state, f.aliceId, bear);
    expect(result.success).toBe(true);

    const unaffected = result.state.cards.get(creature.id)!;
    expect(unaffected.prowessBoost ?? 0).toBe(0);
    expect(getEffectivePower(unaffected)).toBe(1);
  });

  it("stacks across multiple noncreature spells in one turn", () => {
    const f = makeFixture();
    const creature = putOnBattlefield(f.state, f.aliceId, prowessCreature());
    const spell1 = putInHand(f.state, f.aliceId, cantrip());
    const spell2 = putInHand(f.state, f.aliceId, cantrip());
    f.state = addMana(f.state, f.aliceId, { blue: 4 });

    const r1 = castSpell(f.state, f.aliceId, spell1);
    expect(r1.success).toBe(true);
    expect(r1.state.cards.get(creature.id)!.prowessBoost).toBe(1);

    // castSpell passes priority; hand it back to Alice for the second cast.
    r1.state.priorityPlayerId = f.aliceId;
    const r2 = castSpell(r1.state, f.aliceId, spell2);
    expect(r2.success).toBe(true);
    expect(r2.state.cards.get(creature.id)!.prowessBoost).toBe(2);
    expect(getEffectivePower(r2.state.cards.get(creature.id)!)).toBe(3);
  });

  it("stacks multiple prowess instances on one creature (CR 702.108b)", () => {
    const f = makeFixture();
    const dbl = putOnBattlefield(f.state, f.aliceId, doubleProwessCreature());
    const spell = putInHand(f.state, f.aliceId, cantrip());
    f.state = addMana(f.state, f.aliceId, { blue: 2 });

    const result = castSpell(f.state, f.aliceId, spell);
    expect(result.success).toBe(true);

    const boosted = result.state.cards.get(dbl.id)!;
    // One noncreature spell, two prowess instances → +2/+2.
    expect(boosted.prowessBoost).toBe(2);
    expect(getEffectivePower(boosted)).toBe(3);
    expect(getEffectiveToughness(boosted)).toBe(4);
  });
});
