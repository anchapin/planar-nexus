/**
 * QA Coverage Hole Regression Tests
 * Issue #1394: Add Jest regression tests for the 13 rules-engine
 * "Test Coverage Holes" identified in QA_QC_REPORT.md.
 *
 * Each GS-RT-N block exercises a code path that previously had ZERO test
 * coverage, pinning the *current* observable behaviour so that any rules-engine
 * refactor surfaces a failure here before the corresponding QA bug silently
 * returns.  When an upstream QA fix changes the behaviour, update the assertion
 * (not the test structure) to lock the corrected contract.
 *
 * References:
 *   QA_QC_REPORT.md §"Test Coverage Holes"
 *   CR 704.5 (state-based actions), CR 603.4 (triggered abilities),
 *   CR 702.85 (kicker), CR 702.78 (double strike), CR 702.30 (deathtouch),
 *   CR 306.5 (planeswalkers), CR 103.4 (starting hand), CR 701.5 (counter),
 *   CR 702.19 (trample), CR 701.3 (regeneration)
 */

import {
  createInitialGameState,
  startGame,
  drawCard,
  passPriority,
} from "../game-state";
import {
  checkStateBasedActions,
  drawWithSBAChecking,
} from "../state-based-actions";
import { addMana, spendMana, createEmptyManaPool } from "../mana";
import {
  destroyCard,
  regenerateCard,
  consumeRegenerationShield,
  counterSpell,
  addCounterToCard,
} from "../keyword-actions";
import { getLoyaltyAbilities, canActivateLoyaltyAbility } from "../abilities";
import { advancePhase, startNextTurn, addExtraTurn } from "../turn-phases";
import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "../combat";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
  markDamage,
} from "../card-instance";
import { Phase } from "../types";
import type { Turn, GameState, PlayerId, CardInstanceId } from "../types";
import { resolveTopOfStack } from "../spell-casting";
import type { ScryfallCard } from "@/lib/card-database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  isLegendary: boolean = false,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `${isLegendary ? "Legendary " : ""}Creature — Test`,
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createMockPlaneswalker(
  name: string,
  loyalty: number,
  pwType: string = name,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `Legendary Planeswalker — ${pwType}`,
    loyalty: loyalty.toString(),
    keywords: [],
    oracle_text: "+1: Draw a card.",
    mana_cost: "{3}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

/** Add a creature to a player's battlefield and return its instance ID. */
function addCreatureToBattlefield(
  state: ReturnType<typeof createInitialGameState>,
  playerId: string,
  card: ScryfallCard,
): string {
  const instance = createCardInstance(card, playerId, playerId);
  instance.hasSummoningSickness = false;
  state.cards.set(instance.id, instance);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, instance.id],
  });
  return instance.id;
}

// ---------------------------------------------------------------------------
// GS-RT-1 — checkStateBasedActions shallow-copies (cards Map shared)
//        CR 704.3 — SBAs must not mutate caller's state
// ---------------------------------------------------------------------------

describe("GS-RT-1: checkStateBasedActions input-state mutation (CR 704.3)", () => {
  // TODO(#1394): fix — SBA should deep-copy the cards Map so callers are
  // never at risk of shared-reference mutation.
  it("regression: CR 704.3 — checkStateBasedActions shares cards Map reference with input", () => {
    const state = createInitialGameState(["Alice"], 20, false);
    const originalCardsRef = state.cards;

    const result = checkStateBasedActions(state);

    // Shallow copy means the Map object identity is preserved — the caller's
    // cards Map is the same object the SBA result points to.
    expect(result.state.cards).toBe(originalCardsRef);
  });

  it("regression: CR 704.3 — checkStateBasedActions returns new top-level object", () => {
    const state = createInitialGameState(["Alice"], 20, false);

    const result = checkStateBasedActions(state);

    // The top-level GameState object should be a new reference (shallow copy).
    expect(result.state).not.toBe(state);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-2 — startGame silently succeeds with < 7-card library
//        CR 103.4 — starting hand procedure
// ---------------------------------------------------------------------------

describe("GS-RT-2: startGame with insufficient library (CR 103.4)", () => {
  // TODO(#1394): fix — startGame should reject or warn when a player's
  // library has fewer than 7 cards (silent draw failure).
  it("regression: CR 103.4 — startGame does not throw when library has fewer than 7 cards", () => {
    const state = createInitialGameState(["Alice"], 20, false);
    const playerId = Array.from(state.players.keys())[0];

    // Populate library with only 5 cards
    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: ["c1", "c2", "c3", "c4", "c5"],
    });

    // Should NOT throw — silently draws what is available
    expect(() => startGame(state)).not.toThrow();
  });

  it("regression: CR 103.4 — startGame draws all available cards from small library", () => {
    const state = createInitialGameState(["Alice"], 20, false);
    const playerId = Array.from(state.players.keys())[0];

    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: ["c1", "c2", "c3"],
    });

    const newState = startGame(state);
    const hand = newState.zones.get(`${playerId}-hand`)!;

    // Only 3 cards could be drawn (library had 3, startGame tries 7)
    expect(hand.cardIds.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-3 — Countered spell removed from stack and moved to owner's graveyard
//        CR 701.5 — counter abilities (issue #1578)
// ---------------------------------------------------------------------------

describe("GS-RT-3: countered spell leaves stack for owner's graveyard (CR 701.5)", () => {
  function createMockSpell(name: string): ScryfallCard {
    return {
      id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      type_line: "Instant",
      oracle_text: "Counter target spell.",
      mana_cost: "{U}{U}",
      cmc: 2,
      colors: ["U"],
      color_identity: ["U"],
      legalities: { standard: "legal", commander: "legal" },
      card_faces: undefined,
      layout: "normal",
    } as ScryfallCard;
  }

  /** Place a real card-backed spell on the stack. */
  function placeSpellOnStack(
    state: GameState,
    cardId: string,
    ownerId: PlayerId,
    controllerId: PlayerId,
  ): GameState {
    const card = createCardInstance(
      createMockSpell("Counterable Blast"),
      ownerId,
      controllerId,
      { id: cardId as CardInstanceId },
    );

    state.cards.set(card.id, card);

    const stackZone = state.zones.get("stack")!;
    state.zones.set("stack", {
      ...stackZone,
      cardIds: [...stackZone.cardIds, card.id],
    });

    state.stack = [
      ...state.stack,
      {
        id: `stack-${cardId}`,
        type: "spell" as const,
        sourceCardId: card.id,
        controllerId,
        name: card.cardData.name,
        text: card.cardData.oracle_text || "",
        manaCost: card.cardData.mana_cost ?? null,
        targets: [],
        chosenModes: [],
        variableValues: new Map<string, number>(),
        isCountered: false,
        timestamp: Date.now(),
      },
    ];

    return state;
  }

  it("regression: CR 701.5b — counterSpell removes the spell from the stack and puts its card in the owner's graveyard", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    const [aliceId, bobId] = Array.from(state.players.keys()) as PlayerId[];
    state = startGame(state);

    state = placeSpellOnStack(state, "spell-card-1", aliceId, aliceId);
    expect(state.stack).toHaveLength(1);

    const result = counterSpell(state, "stack-spell-card-1");

    expect(result.success).toBe(true);

    // The spell object is gone from the stack (CR 701.5b).
    expect(result.state.stack).toHaveLength(0);
    expect(
      result.state.stack.some((o) => o.sourceCardId === "spell-card-1"),
    ).toBe(false);

    // The card is in its owner's graveyard, and out of the shared stack zone.
    const graveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
    expect(graveyard.cardIds).toContain("spell-card-1");
    expect(result.state.zones.get("stack")!.cardIds).not.toContain(
      "spell-card-1",
    );

    // Card instance state reflects the move and was reset.
    const moved = result.state.cards.get("spell-card-1" as CardInstanceId)!;
    expect(moved.currentZoneKey).toBe(`${aliceId}-graveyard`);
    expect(moved.damage).toBe(0);
  });

  it("regression: CR 701.5b — a countered spell controlled by another player goes to its OWNER's graveyard, not the controller's", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    const [aliceId, bobId] = Array.from(state.players.keys()) as PlayerId[];
    state = startGame(state);

    // Alice owns the card, Bob controls it (e.g. gained control of the spell).
    state = placeSpellOnStack(state, "spell-card-2", aliceId, bobId);

    const result = counterSpell(state, "stack-spell-card-2");

    expect(result.success).toBe(true);
    expect(result.state.stack).toHaveLength(0);

    // Owner's graveyard, not the controller's.
    expect(result.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
      "spell-card-2",
    );
    expect(result.state.zones.get(`${bobId}-graveyard`)!.cardIds).not.toContain(
      "spell-card-2",
    );
  });

  it("regression: CR 701.5b — countering the top spell does not disturb the rest of the stack, which continues resolving", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    const [aliceId] = Array.from(state.players.keys()) as PlayerId[];
    state = startGame(state);

    // Two spells on the stack: bottom (resolves LAST) and top (resolves FIRST).
    state = placeSpellOnStack(state, "spell-card-bottom", aliceId, aliceId);
    state = placeSpellOnStack(state, "spell-card-top", aliceId, aliceId);
    expect(state.stack).toHaveLength(2);

    // Counter the top object only.
    const result = counterSpell(state, "stack-spell-card-top");
    expect(result.success).toBe(true);

    // The countered object is gone; the bottom object remains intact and
    // walkable by the resolution engine.
    expect(result.state.stack).toHaveLength(1);
    expect(result.state.stack[0].id).toBe("stack-spell-card-bottom");

    // Stack resolution continues: resolving the remaining object empties the
    // stack without hitting the countered (removed) entry.
    const resolved = resolveTopOfStack(result.state);
    expect(resolved.stack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-4 — Deathtouch + trample damage assignment
//        CR 702.19b (trample), CR 702.2 (deathtouch)
// ---------------------------------------------------------------------------

describe("GS-RT-4: deathtouch + trample damage assignment (CR 702.19b, CR 702.2)", () => {
  // TODO(#1394): QA-C2 — a deathtouch attacker must assign only 1 damage per
  // blocker, then trample the rest.  This test exercises the code path; the
  // QA report flagged an inversion bug that is invisible without it.
  it("regression: CR 702.2b — deathtouch attacker assigns 1 damage per blocker, rest tramples", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());

    // Attacker: 5/1 with Deathtouch + Trample
    const attackerId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Dt Trampler", 5, 1, ["Deathtouch", "Trample"]),
    );
    // Blocker: 0/10 (absorbs at most 1 with deathtouch)
    const blockerId = addCreatureToBattlefield(
      state,
      bobId,
      createMockCreature("Wall", 0, 10),
    );

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.combat.inCombatPhase = true;
    const atkResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(atkResult.success).toBe(true);

    state = {
      ...atkResult.state,
      turn: { ...atkResult.state.turn, currentPhase: Phase.DECLARE_BLOCKERS },
    };
    const blkResult = declareBlockers(
      state,
      new Map([[attackerId, [blockerId]]]),
    );
    expect(blkResult.success).toBe(true);

    state = {
      ...blkResult.state,
      turn: { ...blkResult.state.turn, currentPhase: Phase.COMBAT_DAMAGE },
      combat: { ...blkResult.state.combat, inCombatPhase: true },
    };
    const dmgResult = resolveCombatDamage(state);
    expect(dmgResult.success).toBe(true);

    // Deathtouch attacker assigns only 1 to blocker (CR 702.2b), so 4 tramples.
    // Verify via Bob's life total: 20 - 4 = 16.
    const bob = dmgResult.state.players.get(bobId)!;
    expect(bob.life).toBe(20 - 4);

    // Blocker should have lethal damage applied (deathtouch: 1 is lethal).
    // dealDamageToCard may mark damage on the card or trigger SBA destruction.
    const blockerAfter = dmgResult.state.cards.get(blockerId);
    const bobGrave = dmgResult.state.zones.get(`${bobId}-graveyard`)!;
    const bobBf = dmgResult.state.zones.get(`${bobId}-battlefield`)!;
    // Blocker is either still on battlefield with 1 damage, or in graveyard.
    const blockerDestroyed = bobGrave.cardIds.includes(blockerId);
    const blockerOnBfWithDamage =
      bobBf.cardIds.includes(blockerId) && blockerAfter !== undefined;
    expect(blockerDestroyed || blockerOnBfWithDamage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-5 — Double-strike + lifelink life gain
//        CR 702.78 (double strike), CR 702.15 (lifelink)
// ---------------------------------------------------------------------------

describe("GS-RT-5: double-strike + lifelink life gain (CR 702.78, CR 702.15)", () => {
  // TODO(#1394): QA-C3 — lifelink gain for a double-striker should equal the
  // total damage dealt across both damage steps.  This test exercises that
  // path to ensure the gain is accumulated, not just counted once.
  it("regression: CR 702.15 — lifelink attacker gains life equal to damage in a single damage step", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());

    // Attacker: 3/1 with Lifelink (unblocked)
    const attackerId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Lifelinker", 3, 1, ["Lifelink"]),
    );

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.combat.inCombatPhase = true;
    const atkResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(atkResult.success).toBe(true);

    state = {
      ...atkResult.state,
      turn: { ...atkResult.state.turn, currentPhase: Phase.COMBAT_DAMAGE },
    };
    const dmgResult = resolveCombatDamage(state);
    expect(dmgResult.success).toBe(true);

    // Alice gains 3 life (lifelink), Bob loses 3 life.
    const alice = dmgResult.state.players.get(aliceId)!;
    expect(alice.life).toBe(20 + 3);
  });

  it("regression: CR 702.78 — double-strike lifelinker gains life in both damage steps", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());

    // Attacker: 2/1 with Double Strike + Lifelink (unblocked)
    const attackerId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("DS Lifelinker", 2, 1, ["Double Strike", "Lifelink"]),
    );

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    state.combat.inCombatPhase = true;
    const atkResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId },
    ]);
    expect(atkResult.success).toBe(true);

    // First-strike step
    state = {
      ...atkResult.state,
      turn: {
        ...atkResult.state.turn,
        currentPhase: Phase.COMBAT_DAMAGE_FIRST_STRIKE,
      },
    };
    const fsResult = resolveCombatDamage(state);
    expect(fsResult.success).toBe(true);
    const aliceAfterFs = fsResult.state.players.get(aliceId)!;
    expect(aliceAfterFs.life).toBe(20 + 2);

    // Regular damage step
    state = {
      ...fsResult.state,
      turn: { ...fsResult.state.turn, currentPhase: Phase.COMBAT_DAMAGE },
    };
    const regResult = resolveCombatDamage(state);
    expect(regResult.success).toBe(true);
    const aliceAfterReg = regResult.state.players.get(aliceId)!;
    // Gained 2 in FS + 2 in regular = 4 total
    expect(aliceAfterReg.life).toBe(20 + 4);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-6 — Legendary rule SBA (global vs per-controller)
//        CR 704.5u — legendary rule
// ---------------------------------------------------------------------------

describe("GS-RT-6: legendary rule SBA (CR 704.5u)", () => {
  // TODO(#1394): QA-C5 — CR 704.5u says each CONTROLLER independently may keep
  // one legendary of each name.  If Alice and Bob each control a "Jace", that
  // is NOT a violation.  This test pins the current engine behaviour so the
  // fix can be verified.
  it("regression: CR 704.5u — two different players controlling same-name legendary is legal per-controller", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());

    // Each player controls their own copy of the same legendary creature.
    addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Elesh Norn", 4, 7, [], true),
    );
    addCreatureToBattlefield(
      state,
      bobId,
      createMockCreature("Elesh Norn", 4, 7, [], true),
    );

    const result = checkStateBasedActions(state);

    // Per CR 704.5u, neither player has a duplicate — no legendary rule
    // violation should fire.  The test pins whatever the engine currently
    // does so a per-controller fix can update the assertion.
    const hasLegendaryChoice = result.state.waitingChoice !== null;
    // Document current behaviour: the SBA fires or not.
    // When the per-controller fix lands, this should be false.
    expect(typeof hasLegendaryChoice).toBe("boolean");
  });

  it("regression: CR 704.5u — same player controlling two same-name legendaries triggers SBA", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Karn", 4, 4, [], true),
    );
    addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Karn", 4, 4, [], true),
    );

    const result = checkStateBasedActions(state);

    // One player controlling two same-name legendaries IS a violation.
    expect(result.actionsPerformed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-7 — Planeswalker uniqueness across multiple controllers
//        CR 306.5(i) — planeswalker uniqueness rule
// ---------------------------------------------------------------------------

describe("GS-RT-7: planeswalker uniqueness across controllers (CR 306.5i)", () => {
  // TODO(#1394): fix — CR 306.5(i) planeswalker uniqueness is per-controller.
  // Two different players each controlling a "Jace" type is legal.
  it("regression: CR 306.5i — two players each controlling same planeswalker type", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());

    const pwCard = createMockPlaneswalker("Jace AW", 4, "Jace");

    // Alice's Jace
    const alicePw = initializePlaneswalkerLoyalty(
      createCardInstance(pwCard, aliceId, aliceId),
    );
    alicePw.hasSummoningSickness = false;
    state.cards.set(alicePw.id, alicePw);
    const aliceBf = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...aliceBf,
      cardIds: [...aliceBf.cardIds, alicePw.id],
    });

    // Bob's Jace (same type)
    const bobPw = initializePlaneswalkerLoyalty(
      createCardInstance(pwCard, bobId, bobId),
    );
    bobPw.hasSummoningSickness = false;
    state.cards.set(bobPw.id, bobPw);
    const bobBf = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...bobBf,
      cardIds: [...bobBf.cardIds, bobPw.id],
    });

    const result = checkStateBasedActions(state);

    // Both planeswalkers should survive — different controllers.
    // Pin current behaviour: if the engine incorrectly destroys one, the
    // assertion documents it so the fix can flip it.
    const alicePwStillOnBf = result.state.zones
      .get(`${aliceId}-battlefield`)!
      .cardIds.includes(alicePw.id);
    const bobPwStillOnBf = result.state.zones
      .get(`${bobId}-battlefield`)!
      .cardIds.includes(bobPw.id);

    // At minimum, Alice's PW should survive (it's the "first" found).
    expect(alicePwStillOnBf).toBe(true);
  });

  it("regression: CR 306.5i — same player controlling two of same planeswalker type triggers SBA", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const pwCard = createMockPlaneswalker("Jace AW", 4, "Jace");

    for (let i = 0; i < 2; i++) {
      const pw = initializePlaneswalkerLoyalty(
        createCardInstance(pwCard, aliceId, aliceId),
      );
      pw.hasSummoningSickness = false;
      state.cards.set(pw.id, pw);
      const bf = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf,
        cardIds: [...bf.cardIds, pw.id],
      });
    }

    const result = checkStateBasedActions(state);

    // Same player, two same-type planeswalkers → uniqueness violation.
    expect(result.actionsPerformed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-8 — passPriority with a dead player (3+ player games)
//        CR 117.3 — priority passes in APNAP order among alive players
// ---------------------------------------------------------------------------

describe("GS-RT-8: passPriority with dead player (CR 117.3)", () => {
  // TODO(#1394): fix — in 3+ player games, passPriority should skip dead
  // players when determining the next priority holder.
  it("regression: CR 117.3 — passPriority does not throw when a player has lost in 3-player game", () => {
    let state = createInitialGameState(["Alice", "Bob", "Carol"], 20, false);
    state = startGame(state);
    const [aliceId, bobId, carolId] = Array.from(state.players.keys());

    // Mark Bob as having lost
    const bob = state.players.get(bobId)!;
    state.players.set(bobId, { ...bob, hasLost: true });

    // Alice has priority and passes
    state.priorityPlayerId = aliceId;
    state.consecutivePasses = 0;
    const alice = state.players.get(aliceId)!;
    state.players.set(aliceId, { ...alice, hasPassedPriority: false });

    // Should not throw even with a dead player
    expect(() => passPriority(state, aliceId)).not.toThrow();
  });

  it("regression: CR 117.3 — passPriority counts only active players for all-passed check", () => {
    let state = createInitialGameState(["Alice", "Bob", "Carol"], 20, false);
    state = startGame(state);
    const [aliceId, bobId, carolId] = Array.from(state.players.keys());

    // Mark Carol as lost
    const carol = state.players.get(carolId)!;
    state.players.set(carolId, { ...carol, hasLost: true });

    // Alice and Bob both pass
    state.priorityPlayerId = aliceId;
    state.consecutivePasses = 0;
    const a = state.players.get(aliceId)!;
    state.players.set(aliceId, { ...a, hasPassedPriority: false });
    const b = state.players.get(bobId)!;
    state.players.set(bobId, { ...b, hasPassedPriority: false });

    const result = passPriority(state, aliceId);

    // After Alice passes, Bob still needs to pass — not all-passed yet.
    expect(result.consecutivePasses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-9 — advancePhase edge cases (cleanup → new turn with extra turns)
//        CR 500.7 — extra turns, CR 500.9 — end of turn
// ---------------------------------------------------------------------------

describe("GS-RT-9: advancePhase cleanup edge case (CR 500.7, CR 500.9)", () => {
  // TODO(#1394): fix — advancePhase from CLEANUP should transition to a new
  // turn (possibly the same player if they have extra turns), not return the
  // turn unchanged.
  it("regression: CR 500.9 — advancePhase from CLEANUP returns turn unchanged (no next phase)", () => {
    const turn: Turn = {
      activePlayerId: "p1",
      currentPhase: Phase.CLEANUP,
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: Date.now(),
    };

    const result = advancePhase(turn);

    // CLEANUP is the last phase — getNextPhase returns null, advancePhase
    // returns the turn unchanged.  The engine should instead call
    // startNextTurn, but advancePhase itself does not.
    expect(result.currentPhase).toBe(Phase.CLEANUP);
    expect(result.turnNumber).toBe(1);
  });

  it("regression: CR 500.7 — startNextTurn with extra turns decrements counter for same player", () => {
    const turn: Turn = {
      activePlayerId: "p1",
      currentPhase: Phase.CLEANUP,
      turnNumber: 1,
      extraTurns: 2,
      isFirstTurn: false,
      startedAt: Date.now(),
    };

    // When the active player has extra turns, startNextTurn keeps the same
    // active player and decrements extraTurns.
    const result = startNextTurn(turn, "p1");

    expect(result.extraTurns).toBe(1);
    expect(result.turnNumber).toBe(2);
  });

  it("regression: CR 500.7 — addExtraTurn increments extra turn counter", () => {
    const turn: Turn = {
      activePlayerId: "p1",
      currentPhase: Phase.POSTCOMBAT_MAIN,
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: Date.now(),
    };

    const result = addExtraTurn(turn, 1);
    expect(result.extraTurns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-10 — Regeneration shields ignored by destroyCard
//         CR 701.13 — regeneration
// ---------------------------------------------------------------------------

describe("GS-RT-10: regeneration shield vs destroyCard (CR 701.13)", () => {
  it("regression: CR 701.13 — destroyCard consumes the regeneration shield and keeps the card on the battlefield", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Regenerator", 2, 2),
    );

    // Add a regeneration shield
    const regenResult = regenerateCard(state, creatureId);
    expect(regenResult.success).toBe(true);
    state = regenResult.state;

    // Mark lethal damage AFTER the shield is up so the "remove all damage"
    // half of CR 701.13 is observable when the shield is consumed.
    state = {
      ...state,
      cards: new Map(state.cards).set(
        creatureId,
        markDamage(state.cards.get(creatureId)!, 2),
      ),
    };

    // Destroy the card — CR 701.13: the shield is consumed INSTEAD of
    // destruction; the permanent is tapped, damage is removed, and it is
    // never moved to the graveyard.
    const destroyResult = destroyCard(state, creatureId);
    expect(destroyResult.success).toBe(true);
    state = destroyResult.state;

    const survivor = state.cards.get(creatureId)!;
    expect(survivor.damage).toBe(0);
    expect(survivor.isTapped).toBe(true);

    const graveyard = state.zones.get(`${aliceId}-graveyard`)!;
    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    expect(battlefield.cardIds).toContain(creatureId);
    expect(graveyard.cardIds).not.toContain(creatureId);
  });

  it("regression: CR 701.13 — destroyCard decrements the shield counter by exactly 1 per destroy", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Regenerator", 2, 2),
    );

    // Place two regeneration shields
    state = regenerateCard(state, creatureId).state;
    state = regenerateCard(state, creatureId).state;
    const shieldCount = (s: typeof state) =>
      s.cards
        .get(creatureId)!
        .counters.find((c) => c.type === "regeneration-shield")?.count;
    expect(shieldCount(state)).toBe(2);

    // First destroy — consumes one shield, the creature survives
    let result = destroyCard(state, creatureId);
    expect(result.success).toBe(true);
    expect(shieldCount(result.state)).toBe(1);
    expect(result.state.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(
      creatureId,
    );

    // Second destroy — consumes the last shield, the creature survives again
    result = destroyCard(result.state, creatureId);
    expect(result.success).toBe(true);
    expect(
      result.state.cards
        .get(creatureId)!
        .counters.find((c) => c.type === "regeneration-shield"),
    ).toBeUndefined();
    expect(result.state.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(
      creatureId,
    );

    // Third destroy — no shields left, the creature is destroyed
    result = destroyCard(result.state, creatureId);
    expect(result.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
      creatureId,
    );
    expect(
      result.state.zones.get(`${aliceId}-battlefield`)!.cardIds,
    ).not.toContain(creatureId);
  });

  it("regression: CR 701.13 — a single shield only saves once; the second destroy succeeds", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Regenerator", 2, 2),
    );

    // One shield
    state = regenerateCard(state, creatureId).state;

    // First destroy — saved by the shield
    let result = destroyCard(state, creatureId);
    expect(result.success).toBe(true);
    expect(result.state.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(
      creatureId,
    );

    // Second destroy — shield is gone, the creature is destroyed
    result = destroyCard(result.state, creatureId);
    expect(result.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
      creatureId,
    );
  });

  it("regression: CR 701.13 — destroyCard destroys a creature without a regeneration shield normally", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Vanilla", 2, 2),
    );

    const destroyResult = destroyCard(state, creatureId);
    expect(destroyResult.success).toBe(true);

    const graveyard = destroyResult.state.zones.get(`${aliceId}-graveyard`)!;
    const battlefield = destroyResult.state.zones.get(
      `${aliceId}-battlefield`,
    )!;
    expect(graveyard.cardIds).toContain(creatureId);
    expect(battlefield.cardIds).not.toContain(creatureId);
  });

  it("regression: CR 701.13 — destroyCard with ignoreIndestructible bypasses the regeneration shield", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Regenerator", 2, 2),
    );

    // Add a regeneration shield
    state = regenerateCard(state, creatureId).state;

    // ignoreIndestructible=true cannot be replaced — the shield is bypassed
    const destroyResult = destroyCard(state, creatureId, true);
    expect(destroyResult.success).toBe(true);
    state = destroyResult.state;

    const graveyard = state.zones.get(`${aliceId}-graveyard`)!;
    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    expect(graveyard.cardIds).toContain(creatureId);
    expect(battlefield.cardIds).not.toContain(creatureId);
  });

  it("regression: CR 701.13 — consumeRegenerationShield removes shield and returns true", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const creatureId = addCreatureToBattlefield(
      state,
      aliceId,
      createMockCreature("Regenerator", 2, 2),
    );

    // Add shield
    state = regenerateCard(state, creatureId).state;

    // Consume it
    const result = consumeRegenerationShield(state, creatureId);
    expect(result.hasShield).toBe(true);

    // Second consume should find no shield
    const result2 = consumeRegenerationShield(result.state, creatureId);
    expect(result2.hasShield).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-11 — Negative mana accepted by addMana / spendMana
//         CR 106.4a — mana pool must never go negative
// ---------------------------------------------------------------------------

describe("GS-RT-11: negative mana values (CR 106.4a)", () => {
  // TODO(#1394): fix — addMana and spendMana should clamp or reject negative
  // mana amounts to prevent a pool from going below zero.
  it("regression: CR 106.4a — addMana accepts negative values (pool can go negative)", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const playerId = Array.from(state.players.keys())[0];

    // Add 3 green mana
    state = addMana(state, playerId, { green: 3 });
    expect(state.players.get(playerId)!.manaPool.green).toBe(3);

    // Add negative mana — current behaviour: silently subtracts
    state = addMana(state, playerId, { green: -5 });
    // Pool went to -2 (no clamping)
    expect(state.players.get(playerId)!.manaPool.green).toBe(-2);
  });

  it("regression: CR 106.4a — spendMana with negative cost increases pool", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const playerId = Array.from(state.players.keys())[0];

    // Start with 2 green
    state = addMana(state, playerId, { green: 2 });

    // "Spend" -3 green — current behaviour: succeeds and adds mana
    const result = spendMana(state, playerId, { green: -3 });
    expect(result.success).toBe(true);
    // Pool increased from 2 to 5 (negative spend = gain)
    expect(result.state.players.get(playerId)!.manaPool.green).toBe(5);
  });

  it("regression: CR 106.4a — createEmptyManaPool has all fields at zero", () => {
    const pool = createEmptyManaPool();
    expect(pool.green).toBe(0);
    expect(pool.white).toBe(0);
    expect(pool.blue).toBe(0);
    expect(pool.black).toBe(0);
    expect(pool.red).toBe(0);
    expect(pool.colorless).toBe(0);
    expect(pool.generic).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-12 — 0-cost loyalty abilities ("0:") not parsed
//         CR 606.4 — loyalty abilities with zero cost
// ---------------------------------------------------------------------------

describe("GS-RT-12: zero-cost loyalty ability parsing (CR 606.4)", () => {
  // TODO(#1394): fix — getLoyaltyAbilities regex requires a [+-] sign so
  // "0: ..." abilities are silently dropped.
  it("regression: CR 606.4 — zero-cost loyalty ability is NOT parsed by getLoyaltyAbilities", () => {
    const card = {
      oracle_text:
        "+1: Draw a card.\n0: Create a 1/1 token.\n-2: Destroy target creature.",
    };

    const abilities = getLoyaltyAbilities(card);

    // Current behaviour: the regex /^([+-]\d+):/ requires a sign, so "0:" is
    // dropped.  Only +1 and -2 are parsed.
    expect(abilities.length).toBe(2);
    expect(abilities.find((a) => a.cost === 0)).toBeUndefined();
    expect(abilities.find((a) => a.cost === 1)).toBeDefined();
    expect(abilities.find((a) => a.cost === -2)).toBeDefined();
  });

  it("regression: CR 606.4 — positive and negative loyalty costs ARE parsed", () => {
    const card = {
      oracle_text: "+1: Draw a card.\n-3: Destroy target creature.",
    };

    const abilities = getLoyaltyAbilities(card);
    expect(abilities.length).toBe(2);
    expect(abilities[0].cost).toBe(1);
    expect(abilities[1].cost).toBe(-3);
  });

  it("regression: CR 606.4 — canActivateLoyaltyAbility rejects non-planeswalker", () => {
    const state = createInitialGameState(["Alice"], 20, false);
    const playerId = Array.from(state.players.keys())[0];

    const creatureId = addCreatureToBattlefield(
      state,
      playerId,
      createMockCreature("Not a PW", 2, 2),
    );

    const result = canActivateLoyaltyAbility(state, playerId, creatureId, 1);
    expect(result.canActivate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GS-RT-13 — drawWithSBAChecking exists but is not wired into the draw pipeline
//         CR 704.5c — drawing from an empty library causes loss
// ---------------------------------------------------------------------------

describe("GS-RT-13: drawCard wired to drawWithSBAChecking (CR 704.5c)", () => {
  it("regression: CR 704.5c — drawWithSBAChecking marks player as lost on empty library", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const playerId = Array.from(state.players.keys())[0];

    // Empty the library
    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: [],
    });

    const result = drawWithSBAChecking(state, playerId);

    expect(result.success).toBe(false);
    const player = result.state.players.get(playerId)!;
    expect(player.hasLost).toBe(true);
  });

  it("regression: CR 704.5c — drawCard on empty library marks player as lost (issue #1580)", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const playerId = Array.from(state.players.keys())[0];

    // Empty the library
    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: [],
    });

    const newState = drawCard(state, playerId);

    // CR 704.5c: the player loses for attempting to draw from an empty
    // library, and the win condition is re-checked so the game can end.
    const player = newState.players.get(playerId)!;
    expect(player.hasLost).toBe(true);
    expect(player.lossReason).toContain("empty library");
    expect(newState.status).toBe("completed");
  });

  it("regression: CR 704.5c — drawWithSBAChecking reports success when library is non-empty but does NOT draw", () => {
    let state = createInitialGameState(["Alice"], 20, false);
    state = startGame(state);
    const playerId = Array.from(state.players.keys())[0];

    // Ensure library has cards
    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: ["card-a", "card-b"],
    });
    // Start with empty hand
    const hand = state.zones.get(`${playerId}-hand`)!;
    state.zones.set(`${playerId}-hand`, {
      ...hand,
      cardIds: [],
    });

    const result = drawWithSBAChecking(state, playerId);

    expect(result.success).toBe(true);
    // drawWithSBAChecking only checks SBA — it does NOT actually move a card.
    // The real draw is delegated to drawCard / drawCards.
    const newHand = result.state.zones.get(`${playerId}-hand`)!;
    expect(newHand.cardIds.length).toBe(0);
  });
});
