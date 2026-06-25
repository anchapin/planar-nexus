/**
 * Integration tests for deathtouch in spell (non-combat) damage resolution.
 * Issue #967: Wire deathtouch into spell damage resolution.
 *
 * CR 702.2b: Any nonzero amount of damage dealt to a creature by a source
 * with deathtouch is considered lethal damage, regardless of the source's
 * power. This applies to ALL damage — combat and non-combat.
 *
 * These tests verify the full spell-damage path:
 *   resolveStackObjectEffects → resolveEffect → resolveDamageEffect
 *   → dealDamageToCard (deathtouch lethal marking) → checkStateBasedActions
 *
 * Coverage:
 *  - Deathtouch source dealing non-combat (spell) damage marks the target for
 *    destruction even when damage < toughness.
 *  - Non-deathtouch source dealing spell damage below toughness does NOT mark
 *    the target as lethally damaged.
 *  - Protection from the source's color prevents the damage entirely, so
 *    deathtouch never applies (CR 702.16c).
 *  - Zero net damage (prevented by replacement) does not trigger deathtouch.
 */

import {
  resolveDamageEffect,
  resolveStackObjectEffects,
} from "../effect-resolution";
import { dealDamageToCard } from "../keyword-actions";
import { checkStateBasedActions } from "../state-based-actions";
import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import type { ScryfallCard } from "@/app/actions";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackEffect,
} from "../types";

// ---------------------------------------------------------------------------
// Mock card factories
// ---------------------------------------------------------------------------

let cardIdCounter = 0;
function uniqueId(prefix: string): string {
  cardIdCounter += 1;
  return `${prefix}-${cardIdCounter}`;
}

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  colors: string[] = ["R"],
): ScryfallCard {
  return {
    id: uniqueId(`creature-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 1,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function createMockInstant(
  name: string,
  oracleText: string,
  colors: string[] = ["R"],
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: uniqueId(`spell-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: "Instant",
    mana_cost: "{R}",
    cmc: 1,
    colors,
    color_identity: colors,
    keywords,
    oracle_text: oracleText,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

// ---------------------------------------------------------------------------
// Game-state helpers
// ---------------------------------------------------------------------------

function addCardToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
): { state: GameState; cardId: string } {
  const card = createCardInstance(cardData, ownerId, controllerId);
  const cardWithLoyalty = initializePlaneswalkerLoyalty(card);
  state.cards.set(cardWithLoyalty.id, cardWithLoyalty);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, cardWithLoyalty.id],
  });
  return { state, cardId: cardWithLoyalty.id };
}

/** Add a card to a player's "on the stack" representation (cards map only). */
function addCardToState(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
): string {
  const card = createCardInstance(cardData, controllerId, controllerId);
  state.cards.set(card.id, card);
  return card.id;
}

function makeGame(): {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys());
  return { state, aliceId: playerIds[0], bobId: playerIds[1] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Issue #967 — Deathtouch in spell (non-combat) damage", () => {
  describe("dealDamageToCard — non-combat deathtouch", () => {
    it("marks a creature for destruction when a deathtouch source deals non-combat damage (damage < toughness)", () => {
      // Acceptance criterion: toughness-5 creature hit by 2 damage from a
      // deathtouch source is marked as lethally damaged.
      const { state, aliceId, bobId } = makeGame();
      const deathtouchSourceData = createMockCreature(
        "Deathtouch Sniper",
        1,
        1,
        ["Deathtouch"],
      );
      const targetData = createMockCreature("Big Baloth", 5, 5);

      let s = state;
      const src = addCardToBattlefield(
        s,
        deathtouchSourceData,
        aliceId,
        aliceId,
      );
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      // 2 non-combat damage from the deathtouch source.
      const result = dealDamageToCard(
        s,
        tgt.cardId,
        2,
        false,
        src.cardId as CardInstanceId,
      );
      expect(result.success).toBe(true);

      // Marked damage should be at least toughness (5) because deathtouch
      // makes any nonzero damage lethal (CR 702.2b).
      const damaged = result.state.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBeGreaterThanOrEqual(5);

      // State-based actions must destroy the creature.
      const sba = checkStateBasedActions(result.state);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(tgt.cardId);
    });

    it("does NOT mark a creature for destruction when a non-deathtouch source deals non-combat damage below toughness", () => {
      const { state, aliceId, bobId } = makeGame();
      const normalSourceData = createMockCreature("Cannon", 2, 2, []);
      const targetData = createMockCreature("Big Baloth", 5, 5);

      let s = state;
      const src = addCardToBattlefield(s, normalSourceData, aliceId, aliceId);
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      // 2 non-combat damage from a non-deathtouch source: NOT lethal for T5.
      const result = dealDamageToCard(
        s,
        tgt.cardId,
        2,
        false,
        src.cardId as CardInstanceId,
      );
      expect(result.success).toBe(true);

      const damaged = result.state.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBe(2); // exactly the dealt damage, no deathtouch bump

      const sba = checkStateBasedActions(result.state);
      expect(sba.actionsPerformed).toBe(false);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).not.toContain(tgt.cardId);
    });

    it("respects protection: damage from a deathtouch source is prevented and the creature survives", () => {
      // Acceptance criterion: protection prevents damage, so even with
      // deathtouch the creature survives — the mechanic is wired correctly.
      const { state, aliceId, bobId } = makeGame();
      // Red deathtouch source.
      const deathtouchSourceData = createMockCreature(
        "Red Deathtoucher",
        1,
        1,
        ["Deathtouch"],
        ["R"],
      );
      // Target with protection from red.
      const protectedData = createMockCreature(
        "Guardian of Faith",
        2,
        2,
        ["Protection from Red"],
        ["W"],
      );

      let s = state;
      const src = addCardToBattlefield(
        s,
        deathtouchSourceData,
        aliceId,
        aliceId,
      );
      s = src.state;
      const tgt = addCardToBattlefield(s, protectedData, bobId, bobId);
      s = tgt.state;

      const result = dealDamageToCard(
        s,
        tgt.cardId,
        3,
        false,
        src.cardId as CardInstanceId,
      );
      expect(result.success).toBe(true);

      // Protection prevented the damage entirely (no damage marked).
      const target = result.state.cards.get(tgt.cardId)!;
      expect(target.damage).toBe(0);

      // Creature survives.
      const sba = checkStateBasedActions(result.state);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).not.toContain(tgt.cardId);
    });
  });

  describe("resolveDamageEffect — spell damage entry point", () => {
    it("applies deathtouch lethal marking through resolveDamageEffect (non-combat)", () => {
      // Exercises the spell-damage path:
      //   resolveDamageEffect → dealDamageToCard (deathtouch check)
      const { state, aliceId, bobId } = makeGame();
      const deathtouchSourceData = createMockCreature(
        "Deathtouch Caster",
        1,
        1,
        ["Deathtouch"],
      );
      const targetData = createMockCreature("Hill Giant", 3, 3);

      let s = state;
      const src = addCardToBattlefield(
        s,
        deathtouchSourceData,
        aliceId,
        aliceId,
      );
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      // Simulate Shock (2 damage, non-combat) resolved through the spell
      // damage pipeline with the deathtouch source as sourceId.
      const result = resolveDamageEffect(
        s,
        src.cardId as CardInstanceId,
        tgt.cardId as CardInstanceId,
        2,
        false, // non-combat (spell) damage
      );
      expect(result.success).toBe(true);

      const damaged = result.state.cards.get(tgt.cardId)!;
      // Deathtouch makes 2 damage lethal against T3.
      expect(damaged.damage).toBeGreaterThanOrEqual(3);

      const sba = checkStateBasedActions(result.state);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(tgt.cardId);
    });

    it("does NOT apply deathtouch when source lacks the keyword", () => {
      const { state, aliceId, bobId } = makeGame();
      const normalSourceData = createMockCreature("Normal Caster", 1, 1, []);
      const targetData = createMockCreature("Hill Giant", 3, 3);

      let s = state;
      const src = addCardToBattlefield(s, normalSourceData, aliceId, aliceId);
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      const result = resolveDamageEffect(
        s,
        src.cardId as CardInstanceId,
        tgt.cardId as CardInstanceId,
        2,
        false,
      );
      expect(result.success).toBe(true);

      const damaged = result.state.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBe(2); // no deathtouch bump

      const sba = checkStateBasedActions(result.state);
      expect(sba.actionsPerformed).toBe(false);
    });
  });

  describe("resolveStackObjectEffects — full spell resolution path", () => {
    it("marks a creature lethally when a damage stack effect resolves from a deathtouch source", () => {
      // End-to-end: resolveStackObjectEffects → resolveEffect → resolveDamageEffect
      // → dealDamageToCard. Simulates a Shock-like spell whose source has
      // deathtouch (e.g. granted by a continuous effect).
      const { state, aliceId, bobId } = makeGame();

      // The "spell" on the stack is represented as a card in the cards map so
      // that dealDamageToCard can look it up via sourceId and detect deathtouch.
      const deathtouchSpellData = createMockInstant(
        "Lethal Shock",
        "Deathtouch\nLethal Shock deals 2 damage to any target.",
        ["R"],
        ["Deathtouch"],
      );
      const targetData = createMockCreature("Aggressive Mammoth", 6, 6);

      let s = state;
      const spellId = addCardToState(s, deathtouchSpellData, aliceId);
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      const damageEffect: StackEffect = {
        id: "effect-1",
        type: "spell",
        effectType: "damage",
        amount: 2,
        targetId: tgt.cardId,
        isCombatDamage: false,
        sourceCardId: spellId,
      } as unknown as StackEffect;

      const resolved = resolveStackObjectEffects(
        s,
        [damageEffect],
        spellId as CardInstanceId,
        [{ type: "creature", targetId: tgt.cardId }],
      );

      const damaged = resolved.cards.get(tgt.cardId)!;
      // T6 creature hit by 2 damage from deathtouch source → marked lethal.
      expect(damaged.damage).toBeGreaterThanOrEqual(6);

      const sba = checkStateBasedActions(resolved);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(tgt.cardId);
    });

    it("does not mark lethally when the damage stack effect source lacks deathtouch", () => {
      const { state, aliceId, bobId } = makeGame();
      const normalSpellData = createMockInstant(
        "Plain Shock",
        "Plain Shock deals 2 damage to any target.",
      );
      const targetData = createMockCreature("Aggressive Mammoth", 6, 6);

      let s = state;
      const spellId = addCardToState(s, normalSpellData, aliceId);
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      const damageEffect: StackEffect = {
        id: "effect-2",
        type: "spell",
        effectType: "damage",
        amount: 2,
        targetId: tgt.cardId,
        isCombatDamage: false,
        sourceCardId: spellId,
      } as unknown as StackEffect;

      const resolved = resolveStackObjectEffects(
        s,
        [damageEffect],
        spellId as CardInstanceId,
        [{ type: "creature", targetId: tgt.cardId }],
      );

      const damaged = resolved.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBe(2); // no deathtouch bump

      const sba = checkStateBasedActions(resolved);
      expect(sba.actionsPerformed).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("zero net damage from a deathtouch source does not mark lethal (CR 702.2b: nonzero only)", () => {
      const { state, aliceId, bobId } = makeGame();
      const deathtouchSourceData = createMockCreature(
        "Deathtouch Source",
        1,
        1,
        ["Deathtouch"],
      );
      const targetData = createMockCreature("Wall", 0, 3);

      let s = state;
      const src = addCardToBattlefield(
        s,
        deathtouchSourceData,
        aliceId,
        aliceId,
      );
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      // 0 damage: deathtouch requires nonzero damage to be lethal.
      const result = dealDamageToCard(
        s,
        tgt.cardId,
        0,
        false,
        src.cardId as CardInstanceId,
      );
      expect(result.success).toBe(true);

      const damaged = result.state.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBe(0);

      const sba = checkStateBasedActions(result.state);
      expect(sba.actionsPerformed).toBe(false);
    });

    it("1 damage from a deathtouch source is enough to mark any creature lethally", () => {
      const { state, aliceId, bobId } = makeGame();
      const deathtouchSourceData = createMockCreature("Stinger", 1, 1, [
        "Deathtouch",
      ]);
      const targetData = createMockCreature("Colossus", 10, 10);

      let s = state;
      const src = addCardToBattlefield(
        s,
        deathtouchSourceData,
        aliceId,
        aliceId,
      );
      s = src.state;
      const tgt = addCardToBattlefield(s, targetData, bobId, bobId);
      s = tgt.state;

      const result = dealDamageToCard(
        s,
        tgt.cardId,
        1,
        false,
        src.cardId as CardInstanceId,
      );
      expect(result.success).toBe(true);

      const damaged = result.state.cards.get(tgt.cardId)!;
      expect(damaged.damage).toBeGreaterThanOrEqual(10);

      const sba = checkStateBasedActions(result.state);
      const graveyard = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(tgt.cardId);
    });
  });
});
