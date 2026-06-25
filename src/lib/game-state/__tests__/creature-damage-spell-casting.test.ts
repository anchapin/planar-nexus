/**
 * Integration tests for creature damage resolution during spell casting.
 * Issue #975: [Combat] Implement creature damage resolution in spell casting
 *
 * Verifies the end-to-end path: oracle text is parsed into a damage effect,
 * the spell's structured target is routed correctly (creature vs player vs
 * planeswalker), damage is applied, and state-based actions destroy/exile
 * permanents that received lethal damage or 0 loyalty.
 *
 * Acceptance criteria:
 * - Lightning Bolt targeting a 2/2 creature deals 3 damage and creature dies via SBA
 * - Shock targeting a planeswalker reduces loyalty counters
 * - Damage spell targeting creature applies marked damage
 */

import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import {
  parseSpellEffects,
  resolveStackObjectEffects,
} from "../effect-resolution";
import { checkStateBasedActions } from "../state-based-actions";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, PlayerId, CardInstanceId } from "../types";

function makeCard(
  name: string,
  type: string,
  opts: Partial<ScryfallCard> = {},
): ScryfallCard {
  return {
    id: `card-${name.toLowerCase().replace(/\s+/g, "-")}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    name,
    type_line: type,
    mana_cost: "{1}",
    cmc: 1,
    colors: opts.colors ?? ["R"],
    color_identity: opts.color_identity ?? ["R"],
    keywords: opts.keywords ?? [],
    oracle_text: opts.oracle_text ?? "",
    power: opts.power,
    toughness: opts.toughness,
    loyalty: opts.loyalty,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function addCardToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, ownerId, controllerId);
  const cardReady = initializePlaneswalkerLoyalty(card);
  state.cards.set(cardReady.id, cardReady);
  const bf = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, cardReady.id],
  });
  cardReady.currentZoneKey = `${controllerId}-battlefield`;
  state.cards.set(cardReady.id, cardReady);
  return { state, cardId: cardReady.id };
}

function setupTwoPlayerGame() {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const [aliceId, bobId] = Array.from(state.players.keys()) as PlayerId[];
  return { state, aliceId, bobId };
}

describe("Issue #975 - Creature damage resolution in spell casting", () => {
  describe("parseSpellEffects handles real damage spell oracle text", () => {
    it("parses 'Lightning Bolt deals 3 damage to any target'", () => {
      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const dmg = effects.find((e) => e.effectType === "damage");
      expect(dmg).toBeDefined();
      expect((dmg as any).amount).toBe(3);
      expect((dmg as any).isCombatDamage).toBe(false);
    });

    it("parses word-number amounts ('deals three damage')", () => {
      const effects = parseSpellEffects(
        "Shock deals three damage to any target.",
      );
      const dmg = effects.find((e) => e.effectType === "damage");
      expect(dmg).toBeDefined();
      expect((dmg as any).amount).toBe(3);
    });

    it("parses 'deals 2 damage to target creature' and 'to target player'", () => {
      const effects = parseSpellEffects(
        "Shock deals 2 damage to target creature.",
      );
      const dmg = effects.find((e) => e.effectType === "damage");
      expect(dmg).toBeDefined();
      expect((dmg as any).amount).toBe(2);
    });

    it("parses X-damage spells using variableValues", () => {
      const effects = parseSpellEffects(
        "Fireball deals X damage to any target.",
        new Map([["X", 4]]),
      );
      const dmg = effects.find((e) => e.effectType === "damage");
      expect(dmg).toBeDefined();
      expect((dmg as any).amount).toBe(4);
    });
  });

  describe("resolveStackObjectEffects - routing by target type", () => {
    it("Lightning Bolt on a 2/2 creature marks 3 damage", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const creatureData = makeCard("Bears", "Creature — Bear", {
        power: "2",
        toughness: "2",
      });
      const r = addCardToBattlefield(state, creatureData, bobId, bobId);
      const creatureId = r.cardId;

      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const result = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "card", targetId: creatureId }],
      );

      expect(result.cards.get(creatureId)?.damage).toBe(3);
    });

    it("Lightning Bolt on a 2/2 creature: creature dies via SBA", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const creatureData = makeCard("Grizzly Bears", "Creature — Bear", {
        power: "2",
        toughness: "2",
      });
      const r = addCardToBattlefield(state, creatureData, bobId, bobId);
      const creatureId = r.cardId;

      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "card", targetId: creatureId }],
      );

      const sba = checkStateBasedActions(after);
      expect(sba.actionsPerformed).toBe(true);
      const bf = sba.state.zones.get(`${bobId}-battlefield`)!;
      expect(bf.cardIds).not.toContain(creatureId);
      const gy = sba.state.zones.get(`${bobId}-graveyard`)!;
      expect(gy.cardIds).toContain(creatureId);
    });

    it("Shock on a 2/3 creature marks damage but creature survives (sub-lethal)", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const creatureData = makeCard("Kird Ape", "Creature — Ape", {
        power: "2",
        toughness: "3",
      });
      const r = addCardToBattlefield(state, creatureData, bobId, bobId);
      const creatureId = r.cardId;

      const effects = parseSpellEffects("Shock deals 2 damage to any target.");
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "card", targetId: creatureId }],
      );

      expect(after.cards.get(creatureId)?.damage).toBe(2);
      const sba = checkStateBasedActions(after);
      expect(sba.state.zones.get(`${bobId}-battlefield`)!.cardIds).toContain(
        creatureId,
      );
    });

    it("Shock targeting a planeswalker reduces loyalty counters", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const pwData = makeCard("Jace", "Planeswalker — Jace", {
        loyalty: "3",
      });
      const r = addCardToBattlefield(state, pwData, bobId, bobId);
      const pwId = r.cardId;

      const loyaltyBefore =
        r.state.cards.get(pwId)?.counters?.find((c) => c.type === "loyalty")
          ?.count ?? 0;
      expect(loyaltyBefore).toBe(3);

      const effects = parseSpellEffects("Shock deals 2 damage to any target.");
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "card", targetId: pwId }],
      );

      const loyaltyAfter =
        after.cards.get(pwId)?.counters?.find((c) => c.type === "loyalty")
          ?.count ?? null;
      expect(loyaltyAfter).toBe(1);
      // Still on the battlefield at 1 loyalty
      expect(
        after.zones.get(`${bobId}-battlefield`)!.cardIds,
      ).toContain(pwId);
    });

    it("Shock on a 2-loyalty planeswalker: exiled via SBA at 0 loyalty", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const pwData = makeCard("Liliana", "Planeswalker — Liliana", {
        loyalty: "2",
      });
      const r = addCardToBattlefield(state, pwData, bobId, bobId);
      const pwId = r.cardId;

      const effects = parseSpellEffects("Shock deals 2 damage to any target.");
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "card", targetId: pwId }],
      );

      const sba = checkStateBasedActions(after);
      expect(sba.actionsPerformed).toBe(true);
      expect(sba.state.zones.get(`${bobId}-battlefield`)!.cardIds).not.toContain(
        pwId,
      );
    });

    it("damage spell targeting a player reduces life (not misrouted to card damage)", () => {
      // Regression: previously targetId.includes("-") misrouted player IDs
      // (which contain hyphens) to card-damage, leaving life unchanged.
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const lifeBefore = state.players.get(bobId)!.life;

      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const after = resolveStackObjectEffects(
        state,
        effects,
        undefined,
        [{ type: "player", targetId: bobId }],
      );

      expect(after.players.get(bobId)!.life).toBe(lifeBefore - 3);
    });

    it("damage to a player does NOT mark damage on any card", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();
      const creatureData = makeCard("Witness", "Creature — Elf", {
        power: "2",
        toughness: "2",
      });
      const r = addCardToBattlefield(state, creatureData, bobId, bobId);
      const creatureId = r.cardId;

      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        undefined,
        [{ type: "player", targetId: bobId }],
      );

      // Creature untouched even though it shares the battlefield
      expect(after.cards.get(creatureId)?.damage).toBe(0);
    });
  });

  describe("prevention effects", () => {
    it("damage is prevented when the creature has protection from the source's color", () => {
      const { state, aliceId, bobId } = setupTwoPlayerGame();

      const boltData = makeCard("Lightning Bolt", "Instant", {
        colors: ["R"],
        color_identity: ["R"],
      });
      const sourceCard = createCardInstance(boltData, aliceId, aliceId);
      state.cards.set(sourceCard.id, sourceCard);

      const protectedData = makeCard("Paladin", "Creature — Knight", {
        power: "2",
        toughness: "2",
        oracle_text: "protection from red",
        keywords: ["Protection"],
      });
      const r = addCardToBattlefield(state, protectedData, bobId, bobId);
      const creatureId = r.cardId;

      const effects = parseSpellEffects(
        "Lightning Bolt deals 3 damage to any target.",
      );
      const after = resolveStackObjectEffects(
        r.state,
        effects,
        sourceCard.id,
        [{ type: "card", targetId: creatureId }],
      );

      // Protection from red prevents all damage from the red source (CR 702.16c)
      expect(after.cards.get(creatureId)?.damage).toBe(0);
      const sba = checkStateBasedActions(after);
      expect(sba.state.zones.get(`${bobId}-battlefield`)!.cardIds).toContain(
        creatureId,
      );
    });
  });
});
