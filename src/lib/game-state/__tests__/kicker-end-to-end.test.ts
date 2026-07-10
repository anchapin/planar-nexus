/**
 * Kicker End-to-End Integration Tests
 *
 * Issue #1228 — [Testing] Add integration tests covering kicker effect
 * application through the full cast→resolve cycle.
 *
 * Goal: close the coverage gap between `parseKicker` (already tested in
 * alternative-costs.test.ts) and the missing post-resolution behavior that
 * applies the kicked additional effect (CR 702.85).
 *
 * This file exercises the public cast→resolve flow:
 *
 *     castSpell(state, playerId, cardId, [], [], 0, isKicked)
 *       → resolveTopOfStack(state)
 *       → checkStateBasedActions(state)
 *
 * Several tests assert the INTENDED behavior of the kicker effect application
 * step. Where the engine currently has a placeholder (`spell-casting.ts:1014-1017`
 * — the `// Additional effect handled by spell's own effect processing`
 * no-op branch), the tests are written as `it.todo(...)` placeholders with a
 * `// NOTE (gap)` comment so the gap is captured WITHOUT failing CI. Production
 * code is intentionally NOT modified here — kicker-effect resolution is tracked
 * in a separate issue.
 *
 * The non-gap tests verify the parts of the flow that work today:
 *   - Non-kicked cast pays only printed mana cost
 *   - Kicked cast deducts (printed + kicker) mana and stamps the StackObject
 *     metadata (`wasKicked: true`, `alternativeCostsUsed: ["kicker"]`)
 *   - Post-resolution zone transitions and deterministic state hash
 *   - Property-based: mana arithmetic balances across randomly shaped costs
 */

import fc from "fast-check";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { checkStateBasedActions } from "../state-based-actions";
import { computeStateHash } from "../state-hash";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, ManaPool, PlayerId, CardInstanceId } from "../types";

// ---------------------------------------------------------------------------
// Mock card factories
// ---------------------------------------------------------------------------

let factoryIdCounter = 0;
function uniqueId(prefix: string): string {
  factoryIdCounter += 1;
  return `${prefix}-${factoryIdCounter}`;
}

function createKickerInstant(
  name: string,
  oracleText: string,
  manaCost: string = "{2}{U}",
  kickerCost: string = "{1}{U}",
): ScryfallCard {
  // Oracle text always includes "Kicker <cost>" even when the body effect
  // does not reference it — this matches real cards (e.g. "Cancel" → "Kicker
  // {1}{U}, Counter target spell. If that spell is countered this way, draw
  // a card.").
  const fullOracle = oracleText.includes("Kicker")
    ? oracleText
    : `Kicker ${kickerCost}\n${oracleText}`;
  return {
    id: uniqueId(`spell-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: "Instant",
    mana_cost: manaCost,
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
    keywords: [],
    oracle_text: fullOracle,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createKickerCreature(
  name: string,
  power: number,
  toughness: number,
  kickerCost: string = "{2}{G}",
): ScryfallCard {
  return {
    id: uniqueId(`creature-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: `Creature — ${name}`,
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: `Kicker ${kickerCost}\nWhen ${name} enters the battlefield, draw a card.`,
    mana_cost: "{2}{G}",
    cmc: 3,
    colors: ["G"],
    color_identity: ["G"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createCreatureCard(
  name: string,
  power: number,
  toughness: number,
): ScryfallCard {
  return {
    id: uniqueId(`creature-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: ["G"],
    color_identity: ["G"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

// ---------------------------------------------------------------------------
// Game-state helpers
// ---------------------------------------------------------------------------

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

function sumColoredMana(pool: ManaPool): number {
  return (
    pool.white +
    pool.blue +
    pool.black +
    pool.red +
    pool.green +
    pool.colorless +
    pool.generic
  );
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

// ===========================================================================
// Test suite
// ===========================================================================

describe("Issue #1228 — Kicker effect application through cast→resolve cycle", () => {
  // -------------------------------------------------------------------------
  // Section 1: baseline (non-kicked) cast flow — control case
  // -------------------------------------------------------------------------
  describe("Baseline (non-kicked) cast flow", () => {
    it("a kicker spell cast WITHOUT isKicked pays only the printed mana cost", () => {
      const { state: initial, aliceId, bobId } = setupTwoPlayerGame();

      const kickerSpell = createKickerInstant(
        "Test Kicker Cantrip",
        "Draw a card.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );

      // Provide plenty of mana so the test is not gated by pool size.
      const sWithMana = addMana(sWithCard, aliceId, {
        blue: 8,
        generic: 8,
      });
      const s = mainPhaseState(sWithMana, aliceId);

      const before = s.players.get(aliceId)!.manaPool;
      const beforeSum = sumColoredMana(before);

      const result = castSpell(s, aliceId, cardId, [], [], 0, false);

      expect(result.success).toBe(true);
      const afterPool = result.state.players.get(aliceId)!.manaPool;
      const afterSum = sumColoredMana(afterPool);

      // Printed mana cost is {2}{U} → 3 mana. Kicker {1}{U} should NOT be paid
      // when isKicked=false, even though parseKicker would detect a kicker.
      expect(beforeSum - afterSum).toBe(3);
    });

    it("a non-kicker spell (no parseable Kicker) cannot be 'kicked' even if isKicked=true", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();

      const nonKickerSpell: ScryfallCard = {
        ...createCreatureCard("Vanilla Bear", 2, 2),
        oracle_text: "",
      };
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        nonKickerSpell,
        aliceId,
      );

      const sWithMana = addMana(sWithCard, aliceId, { green: 5, generic: 5 });
      const s = mainPhaseState(sWithMana, aliceId);

      const result = castSpell(s, aliceId, cardId, [], [], 0, true);

      // Engine should still allow the cast — kicker cost not added because
      // parseKicker returns hasKicker=false on the oracle text.
      expect(result.success).toBe(true);
      const stackObject = result.state.stack[0];
      expect(stackObject.wasKicked).toBe(true); // caller-declared flag retained
      expect(stackObject.alternativeCostsUsed ?? []).not.toContain("kicker");
    });

    it("non-kicked resolution produces a stack object with wasKicked=false", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        createKickerInstant(
          "Test Counter",
          "Counter target spell.",
          "{2}{U}",
          "{1}{U}",
        ),
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { blue: 6, generic: 6 });
      const s = mainPhaseState(sWithMana, aliceId);

      const cast = castSpell(s, aliceId, cardId, [], [], 0, false);
      expect(cast.success).toBe(true);
      expect(cast.state.stack).toHaveLength(1);

      const stackObject = cast.state.stack[0];
      expect(stackObject.wasKicked).toBe(false);
      expect(stackObject.alternativeCostsUsed ?? []).not.toContain("kicker");
    });
  });

  // -------------------------------------------------------------------------
  // Section 2: kicked cast — mana deduction + StackObject metadata
  // (these exercise the WORKING parts of castSpell today)
  // -------------------------------------------------------------------------
  describe("Kicked cast (CR 702.85)", () => {
    it("a kicker spell cast WITH isKicked=true deducts printed + kicker mana", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();

      const kickerSpell = createKickerInstant(
        "Kicker Cantrip",
        "Draw a card.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );

      const sWithMana = addMana(sWithCard, aliceId, { blue: 8, generic: 8 });
      const s = mainPhaseState(sWithMana, aliceId);

      const before = s.players.get(aliceId)!.manaPool;
      const beforeSum = sumColoredMana(before);

      const result = castSpell(s, aliceId, cardId, [], [], 0, true);
      expect(result.success).toBe(true);

      const afterPool = result.state.players.get(aliceId)!.manaPool;
      const afterSum = sumColoredMana(afterPool);

      // Printed {2}{U} = 3 + Kicker {1}{U} = 2 → 5 mana spent total.
      expect(beforeSum - afterSum).toBe(5);
    });

    it("kicked stamp appears on the resulting StackObject (wasKicked + alternativeCostsUsed)", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();

      const kickerSpell = createKickerInstant(
        "Kicker Bolt",
        "Deal 3 damage to any target.",
        "{R}",
        "{1}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );

      const sWithMana = addMana(sWithCard, aliceId, { red: 6, generic: 6 });
      const s = mainPhaseState(sWithMana, aliceId);

      const result = castSpell(s, aliceId, cardId, [], [], 0, true);
      expect(result.success).toBe(true);

      const stackObject = result.state.stack[0];
      expect(stackObject.type).toBe("spell");
      expect(stackObject.wasKicked).toBe(true);
      expect(stackObject.alternativeCostsUsed).toBeDefined();
      expect(stackObject.alternativeCostsUsed!).toContain("kicker");
    });

    it("kicked cast fails when player mana is less than printed + kicker cost", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const kickerSpell = createKickerInstant(
        "Big Kicker Spell",
        "Do something.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );

      // Only enough mana for the printed cost ({2}{U} = 3), NOT for kicker.
      const sWithMana = addMana(sWithCard, aliceId, { blue: 1, generic: 2 });
      const s = mainPhaseState(sWithMana, aliceId);

      const result = castSpell(s, aliceId, cardId, [], [], 0, true);
      expect(result.success).toBe(false);
      // The card should still be in hand (not moved to stack).
      const hand = result.state.zones.get(`${aliceId}-hand`)!;
      expect(hand.cardIds).toContain(cardId);
    });
  });

  // -------------------------------------------------------------------------
  // Section 3: kicker effect application through resolveTopOfStack
  // (gap scenarios — placeholder exists at spell-casting.ts:1014-1017)
  // -------------------------------------------------------------------------
  describe("Kicker effect application through resolveTopOfStack (CR 702.85)", () => {
    it("kicked spell resolves to the appropriate post-resolution zone (graveyard for instants)", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const kickerInstant = createKickerInstant(
        "Kicker Cantrip",
        "Draw a card.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerInstant,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { blue: 8, generic: 8 });
      const s = mainPhaseState(sWithMana, aliceId);

      const cast = castSpell(s, aliceId, cardId, [], [], 0, true);
      expect(cast.success).toBe(true);

      const resolved = resolveTopOfStack(cast.state);
      // Stack should be empty after resolution.
      expect(resolved.stack).toHaveLength(0);

      // Instant -> graveyard on resolution (CR 608.2).
      const graveyard = resolved.zones.get(`${aliceId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(cardId);

      // SBA pass should not flip any flags for this benign resolution.
      const sba = checkStateBasedActions(resolved);
      expect(sba.actionsPerformed).toBe(false);
    });

    it("resolve→SBA pipeline produces a deterministic state hash for a kicked spell", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const kickerInstant = createKickerInstant(
        "Deterministic Kicker",
        "Draw a card.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerInstant,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { blue: 8, generic: 8 });
      const s = mainPhaseState(sWithMana, aliceId);

      const runOnce = () => {
        const cast = castSpell(s, aliceId, cardId, [], [], 0, true);
        if (!cast.success) throw new Error("cast failed");
        const resolved = resolveTopOfStack(cast.state);
        return checkStateBasedActions(resolved).state;
      };

      const a = runOnce();
      const b = runOnce();
      expect(computeStateHash(a)).toBe(computeStateHash(b));
    });

    // --- CR 702.85 — kicked additional-effect application --------------------
    //
    // Issue #1222 placeholder at spell-casting.ts is replaced: the kicker
    // bonus is now forwarded from `stackObject.timesKicked` to
    // `resolveStackObjectEffects` via a `kickerBonus` argument. The default
    // engine rule is `final_amount = base_amount + timesKicked` for each
    // scalable effect (damage / card_draw / token_creation) — this matches
    // the common "+1 per kick" pattern on cards like Burst Lightning,
    // Mulldrifter, and most multikicker creatures.
    //
    // The tests below exercise the cast→resolve cycle and assert the kicked
    // additional effect fires as expected.

    it("kicked damage spell adds 1 to its base damage (Burst Lightning-style: base 2 → 3)", () => {
      const { state: initial, aliceId, bobId } = setupTwoPlayerGame();
      // Burst Lightning (paraphrased): "Kicker {R}. Burst Lightning deals 2
      // damage to any target. If you paid the kicker cost, it deals 3 damage
      // instead." The parser only sees the base 2 — the +1 bonus comes from
      // the kicker application step (CR 702.85).
      const kickerSpell = createKickerInstant(
        "Burst Lightning",
        "Deal 2 damage to any target.",
        "{R}",
        "{R}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { red: 4, generic: 4 });
      const s = mainPhaseState(sWithMana, aliceId);

      const bobBefore = s.players.get(bobId)!.life;

      const cast = castSpell(
        s,
        aliceId,
        cardId,
        [{ type: "player", targetId: bobId, isValid: true }],
        [],
        0,
        true,
      );
      expect(cast.success).toBe(true);
      const stackObject = cast.state.stack[cast.state.stack.length - 1];
      expect(stackObject.timesKicked).toBe(1);

      const resolved = resolveTopOfStack(cast.state);
      const bobAfter = resolved.players.get(bobId)!.life;
      expect(bobBefore - bobAfter).toBe(3);
    });

    it("non-kicked damage spell stays at its base damage (Burst Lightning-style: 2, not 3)", () => {
      const { state: initial, aliceId, bobId } = setupTwoPlayerGame();
      const kickerSpell = createKickerInstant(
        "Burst Lightning",
        "Deal 2 damage to any target.",
        "{R}",
        "{R}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { red: 4, generic: 4 });
      const s = mainPhaseState(sWithMana, aliceId);

      const bobBefore = s.players.get(bobId)!.life;

      const cast = castSpell(
        s,
        aliceId,
        cardId,
        [{ type: "player", targetId: bobId, isValid: true }],
        [],
        0,
        false,
      );
      expect(cast.success).toBe(true);
      const resolved = resolveTopOfStack(cast.state);
      const bobAfter = resolved.players.get(bobId)!.life;
      expect(bobBefore - bobAfter).toBe(2);
    });

    it("kicked card-draw spell draws 2 cards (Mulldrifter-style base 1 → 2 when kicked)", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const kickerCantrip = createKickerInstant(
        "Mulldrifter Cantrip",
        "Draw a card.",
        "{2}{U}",
        "{1}{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerCantrip,
        aliceId,
      );
      // Pre-load Alice's library with at least 3 cards so the draw succeeds.
      for (let i = 0; i < 3; i++) {
        const fillerCard = createCardInstance(
          {
            ...createCreatureCard(`Filler ${i}`, 1, 1),
          },
          aliceId,
          aliceId,
        );
        sWithCard.cards.set(fillerCard.id, fillerCard);
        const lib = sWithCard.zones.get(`${aliceId}-library`)!;
        sWithCard.zones.set(`${aliceId}-library`, {
          ...lib,
          cardIds: [...lib.cardIds, fillerCard.id],
        });
      }
      const sWithMana = addMana(sWithCard, aliceId, { blue: 8, generic: 8 });
      const s = mainPhaseState(sWithMana, aliceId);

      const handBefore = s.zones.get(`${aliceId}-hand`)!.cardIds.length;

      const cast = castSpell(s, aliceId, cardId, [], [], 0, true);
      expect(cast.success).toBe(true);
      const resolved = resolveTopOfStack(cast.state);

      // Hand size: started with `handBefore`, kicked draw = 2 cards, so
      // net change is +(2 - 0) = +2 (the kicked spell itself was cast from
      // hand so it left the hand — but resolution moves it to graveyard).
      const handAfter = resolved.zones.get(`${aliceId}-hand`)!.cardIds.length;
      // Net: -1 (the spell left hand) + 2 (draw) = +1
      expect(handAfter - handBefore).toBe(1);
    });

    it("multikicker paying 2x (N=2) adds 2 to base damage (Lightning Blast-style: base 4 → 6)", () => {
      const { state: initial, aliceId, bobId } = setupTwoPlayerGame();
      // Lightning Blast (paraphrased): "Kicker {R}. Lightning Blast deals 4
      // damage to any target." With multikicker N=2 the engine adds +2 to
      // the parsed base of 4 → 6 damage.
      const kickerSpell = createKickerInstant(
        "Lightning Blast",
        "Deal 4 damage to any target.",
        "{2}{R}",
        "{R}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { red: 6, generic: 6 });
      const s = mainPhaseState(sWithMana, aliceId);

      const bobBefore = s.players.get(bobId)!.life;

      const cast = castSpell(
        s,
        aliceId,
        cardId,
        [{ type: "player", targetId: bobId, isValid: true }],
        [],
        0,
        false,
        undefined,
        2, // multikicker count = 2
      );
      expect(cast.success).toBe(true);
      const stackObject = cast.state.stack[cast.state.stack.length - 1];
      expect(stackObject.timesKicked).toBe(2);

      const resolved = resolveTopOfStack(cast.state);
      const bobAfter = resolved.players.get(bobId)!.life;
      // 4 (base) + 2 (multikicker) = 6 damage
      expect(bobBefore - bobAfter).toBe(6);
    });

    it("multikicker paying 3x (N=3) draws 4 cards (base 1 + N = 4)", () => {
      const { state: initial, aliceId } = setupTwoPlayerGame();
      const kickerCantrip = createKickerInstant(
        "Triple Cantrip",
        "Draw a card.",
        "{1}{U}",
        "{U}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerCantrip,
        aliceId,
      );
      // Pre-load library with at least 5 cards so 4 draws succeed.
      for (let i = 0; i < 5; i++) {
        const fillerCard = createCardInstance(
          { ...createCreatureCard(`Filler T${i}`, 1, 1) },
          aliceId,
          aliceId,
        );
        sWithCard.cards.set(fillerCard.id, fillerCard);
        const lib = sWithCard.zones.get(`${aliceId}-library`)!;
        sWithCard.zones.set(`${aliceId}-library`, {
          ...lib,
          cardIds: [...lib.cardIds, fillerCard.id],
        });
      }
      const sWithMana = addMana(sWithCard, aliceId, { blue: 10, generic: 10 });
      const s = mainPhaseState(sWithMana, aliceId);

      const handBefore = s.zones.get(`${aliceId}-hand`)!.cardIds.length;

      const cast = castSpell(
        s,
        aliceId,
        cardId,
        [],
        [],
        0,
        false,
        undefined,
        3,
      );
      expect(cast.success).toBe(true);

      const resolved = resolveTopOfStack(cast.state);
      const handAfter = resolved.zones.get(`${aliceId}-hand`)!.cardIds.length;
      // Net: -1 (the spell left hand) + 4 (draw) = +3
      expect(handAfter - handBefore).toBe(3);
    });

    it("multikicker paying 0x (N=0) is the no-kick path: damage stays at base", () => {
      const { state: initial, aliceId, bobId } = setupTwoPlayerGame();
      const kickerSpell = createKickerInstant(
        "Lightning Blast",
        "Deal 4 damage to any target.",
        "{2}{R}",
        "{R}",
      );
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        kickerSpell,
        aliceId,
      );
      const sWithMana = addMana(sWithCard, aliceId, { red: 4, generic: 4 });
      const s = mainPhaseState(sWithMana, aliceId);

      const bobBefore = s.players.get(bobId)!.life;

      const cast = castSpell(
        s,
        aliceId,
        cardId,
        [{ type: "player", targetId: bobId, isValid: true }],
        [],
        0,
        false,
        undefined,
        0,
      );
      expect(cast.success).toBe(true);
      const resolved = resolveTopOfStack(cast.state);
      const bobAfter = resolved.players.get(bobId)!.life;
      expect(bobBefore - bobAfter).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Section 4: property-based — mana arithmetic for randomly shaped kicker costs
  // Mirrors property-based.test.ts style.
  // -------------------------------------------------------------------------
  describe("Property-based: mana arithmetic balances across kicker cost shapes", () => {
    /**
     * Helper that:
     *   1. Builds a spell whose printed mana cost is the provided {W,U,B,R,G,G,G}
     *      breakdown (all given as generic for simplicity).
     *   2. Casts it kicked with a known kicker generic cost.
     *   3. Asserts that exactly (printed + kicker) mana was deducted.
     */
    const basePrinted = 4; // generic for the property-test simplification
    const baseKicker = 2;

    it("kicker cost + printed cost equals total mana deducted for various mana-pool shapes", () => {
      fc.assert(
        fc.property(
          fc.record({
            white: fc.integer({ min: 0, max: 6 }),
            blue: fc.integer({ min: 0, max: 6 }),
            black: fc.integer({ min: 0, max: 6 }),
            red: fc.integer({ min: 0, max: 6 }),
            green: fc.integer({ min: 0, max: 6 }),
            colorless: fc.integer({ min: 0, max: 6 }),
            generic: fc.integer({ min: 0, max: 6 }),
          }),
          (pool): boolean => {
            const { state: initial, aliceId } = setupTwoPlayerGame();

            const kickerSpell = createKickerInstant(
              `Property Kicker ${uniqueId("p")}`,
              "Draw a card.",
              `{${basePrinted}}`,
              `{${baseKicker}}`,
            );
            const { state: sWithCard, cardId } = addCardToHand(
              initial,
              kickerSpell,
              aliceId,
            );

            // Seed the player's mana pool with the random shape.
            const sWithMana = addMana(sWithCard, aliceId, pool);
            const s = mainPhaseState(sWithMana, aliceId);

            const before = s.players.get(aliceId)!.manaPool;
            const beforeSum = sumColoredMana(before);

            const result = castSpell(s, aliceId, cardId, [], [], 0, true);

            if (!result.success) {
              // Insufficient mana for the kicked cost is a legitimate outcome
              // for some random pool shapes — when that happens, beforeSum
              // should be less than (printed + kicker).
              return beforeSum < basePrinted + baseKicker;
            }

            const afterPool = result.state.players.get(aliceId)!.manaPool;
            const afterSum = sumColoredMana(afterPool);

            // The test only holds when the pool actually had enough total mana
            // to pay the kicked cost. Drain it precisely.
            const expected =
              beforeSum >= basePrinted + baseKicker
                ? basePrinted + baseKicker
                : 0;
            return beforeSum - afterSum === expected;
          },
        ),
        { numRuns: 50 },
      );
    });

    it("mana-pool components are never negative after a kicked cast", () => {
      fc.assert(
        fc.property(
          fc.record({
            white: fc.integer({ min: 0, max: 6 }),
            blue: fc.integer({ min: 0, max: 6 }),
            black: fc.integer({ min: 0, max: 6 }),
            red: fc.integer({ min: 0, max: 6 }),
            green: fc.integer({ min: 0, max: 6 }),
            colorless: fc.integer({ min: 0, max: 6 }),
            generic: fc.integer({ min: basePrinted + baseKicker, max: 12 }),
          }),
          (pool): boolean => {
            const { state: initial, aliceId } = setupTwoPlayerGame();
            const kickerSpell = createKickerInstant(
              `Property Nonneg Kicker ${uniqueId("p")}`,
              "Draw a card.",
              `{${basePrinted}}`,
              `{${baseKicker}}`,
            );
            const { state: sWithCard, cardId } = addCardToHand(
              initial,
              kickerSpell,
              aliceId,
            );
            const sWithMana = addMana(sWithCard, aliceId, pool);
            const s = mainPhaseState(sWithMana, aliceId);

            const result = castSpell(s, aliceId, cardId, [], [], 0, true);
            if (!result.success) return true;

            const after = result.state.players.get(aliceId)!.manaPool;
            return (
              after.white >= 0 &&
              after.blue >= 0 &&
              after.black >= 0 &&
              after.red >= 0 &&
              after.green >= 0 &&
              after.colorless >= 0 &&
              after.generic >= 0
            );
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
