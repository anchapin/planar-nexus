/**
 * Tests for the Phasing System (CR 702.19)
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import type { GameState, CardInstance, CardInstanceId } from "../types";
import {
  createCardInstance,
} from "../card-instance";
import {
  hasPhasing,
  isPhasedOut,
  hasBeenPhasedOut,
  phaseOutWithAttachments,
  phaseInPermanent,
  phaseInWithAttachments,
  canBeTargeted,
  canParticipateInCombat,
  getVisiblePermanents,
  getCardsThatPhaseWithHost,
  processPhasingAtUntapStep,
  processPhasingInAtUntapStep,
} from "../phasing";
import {
  ZoneType,
  createInitialGameState,
  startGame,
} from "../game-state";

// Counter for unique mock card IDs
let mockCardCounter = 0;

/**
 * Helper to create a test creature with optional phasing keyword
 */
function createTestCreature(
  gameState: GameState,
  playerId: string,
  hasPhasingKeyword: boolean = false
): CardInstance {
  mockCardCounter++;
  const mockCard = {
    id: `test-oracle-id-${mockCardCounter}`,
    name: hasPhasingKeyword ? "Phasing Creature" : "Test Creature",
    type_line: "Creature",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_indicator: null,
    colors_indicator: null,
    oracle_text: hasPhasingKeyword ? "Phasing" : "",
    power: "2",
    toughness: "2",
    loyalty: null,
    keywords: hasPhasingKeyword ? ["Phasing"] : [],
    card_faces: null,
    legalities: null,
    produced_mana: null,
  } as any;

  const card = createCardInstance(mockCard, playerId, playerId);
  card.currentZoneKey = `${playerId}-battlefield`;
  return card;
}

describe("Phasing System", () => {
  let gameState: GameState;
  let player1Id: string;
  let player2Id: string;

  beforeEach(() => {
    gameState = createInitialGameState(["Player1", "Player2"], 20, false);
    startGame(gameState);
    const playerIds = Array.from(gameState.players.keys());
    player1Id = playerIds[0];
    player2Id = playerIds[1];
  });

  describe("hasPhasing", () => {
    it("should return true for cards with phasing keyword", () => {
      const phasingCard = createTestCreature(gameState, player1Id, true);
      const normalCard = createTestCreature(gameState, player1Id, false);

      expect(hasPhasing(phasingCard)).toBe(true);
      expect(hasPhasing(normalCard)).toBe(false);
    });
  });

  describe("isPhasedOut", () => {
    it("should return false for cards that are not phased out", () => {
      const card = createTestCreature(gameState, player1Id);

      expect(isPhasedOut(card)).toBe(false);
    });

    it("should return true for cards that are phased out", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };

      expect(isPhasedOut(phasedCard)).toBe(true);
    });
  });

  describe("phaseOutWithAttachments", () => {
    it("should phase out a card and mark it as phased out", () => {
      const card = createTestCreature(gameState, player1Id);
      gameState.cards.set(card.id, card);
      gameState.zones.get(`${player1Id}-battlefield`)!.cardIds.push(card.id);

      const result = phaseOutWithAttachments(gameState, card.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(card.id)!.isPhasedOut).toBe(true);
      expect(result.phasedCardIds).toContain(card.id);
    });

    it("should also phase out attachments to the card", () => {
      const hostCard = createTestCreature(gameState, player1Id);
      const attachedCard = createTestCreature(gameState, player1Id);

      // Set up attachment relationship
      const hostWithAttachment = {
        ...hostCard,
        attachedCardIds: [attachedCard.id],
      };
      const attachedToHost = {
        ...attachedCard,
        attachedToId: hostCard.id,
      };

      gameState.cards.set(hostCard.id, hostWithAttachment);
      gameState.cards.set(attachedCard.id, attachedToHost);
      const bf = gameState.zones.get(`${player1Id}-battlefield`)!;
      bf.cardIds.push(hostCard.id, attachedCard.id);

      const result = phaseOutWithAttachments(gameState, hostCard.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(hostCard.id)!.isPhasedOut).toBe(true);
      expect(result.state.cards.get(attachedCard.id)!.isPhasedOut).toBe(true);
      expect(result.phasedCardIds).toContain(attachedCard.id);
    });

    it("should return failure for already phased out cards", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };
      gameState.cards.set(card.id, phasedCard);

      const result = phaseOutWithAttachments(gameState, card.id);

      expect(result.success).toBe(false);
    });
  });

  describe("phaseInPermanent", () => {
    it("should phase in a card and restore visibility", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };
      gameState.cards.set(card.id, phasedCard);
      gameState.zones.get(`${player1Id}-battlefield`)!.cardIds.push(card.id);

      const result = phaseInPermanent(gameState, card.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(card.id)!.isPhasedOut).toBe(false);
    });

    it("should preserve hasBeenPhasedOut status after phasing in", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = {
        ...card,
        isPhasedOut: true,
        _hasBeenPhasedOut: true,
      } as any;
      gameState.cards.set(card.id, phasedCard);

      const result = phaseInPermanent(gameState, card.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(card.id)!.isPhasedOut).toBe(false);
      expect(hasBeenPhasedOut(result.state.cards.get(card.id)!)).toBe(true);
    });

    it("should return failure for cards that are not phased out", () => {
      const card = createTestCreature(gameState, player1Id);
      gameState.cards.set(card.id, card);

      const result = phaseInPermanent(gameState, card.id);

      expect(result.success).toBe(false);
    });
  });

  describe("canBeTargeted", () => {
    it("should return false for phased out cards", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };
      gameState.cards.set(card.id, phasedCard);

      const result = canBeTargeted(gameState, card.id);

      expect(result.canTarget).toBe(false);
      expect(result.reason).toBe("Card is phased out");
    });

    it("should return true for cards that are not phased out", () => {
      const card = createTestCreature(gameState, player1Id);
      gameState.cards.set(card.id, card);

      const result = canBeTargeted(gameState, card.id);

      expect(result.canTarget).toBe(true);
    });
  });

  describe("canParticipateInCombat", () => {
    it("should return false for phased out cards", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };
      gameState.cards.set(card.id, phasedCard);

      const result = canParticipateInCombat(gameState, card.id);

      expect(result.canParticipate).toBe(false);
      expect(result.reason).toBe("Card is phased out");
    });

    it("should return true for cards that are not phased out", () => {
      const card = createTestCreature(gameState, player1Id);
      gameState.cards.set(card.id, card);

      const result = canParticipateInCombat(gameState, card.id);

      expect(result.canParticipate).toBe(true);
    });
  });

  describe("getVisiblePermanents", () => {
    it("should only return non-phased permanents", () => {
      const card1 = createTestCreature(gameState, player1Id);
      const card2 = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card2, isPhasedOut: true };

      gameState.cards.set(card1.id, card1);
      gameState.cards.set(card2.id, phasedCard);
      const bf = gameState.zones.get(`${player1Id}-battlefield`)!;
      bf.cardIds.push(card1.id, card2.id);

      const visible = getVisiblePermanents(gameState, player1Id);

      expect(visible.length).toBe(1);
      expect(visible[0].id).toBe(card1.id);
    });
  });

  describe("processPhasingAtUntapStep", () => {
    it("should phase out permanents with phasing keyword", () => {
      const phasingCard = createTestCreature(gameState, player1Id, true);
      const normalCard = createTestCreature(gameState, player1Id, false);

      gameState.cards.set(phasingCard.id, phasingCard);
      gameState.cards.set(normalCard.id, normalCard);
      const bf = gameState.zones.get(`${player1Id}-battlefield`)!;
      bf.cardIds.push(phasingCard.id, normalCard.id);

      const result = processPhasingAtUntapStep(gameState, player1Id);

      expect(result.descriptions.length).toBeGreaterThan(0);
      expect(result.state.cards.get(phasingCard.id)!.isPhasedOut).toBe(true);
      expect(result.state.cards.get(normalCard.id)!.isPhasedOut).toBe(false);
    });
  });

  describe("processPhasingInAtUntapStep", () => {
    it("should phase in previously phased out permanents", () => {
      const card = createTestCreature(gameState, player1Id);
      const phasedCard = { ...card, isPhasedOut: true };

      gameState.cards.set(card.id, phasedCard);
      gameState.zones.get(`${player1Id}-battlefield`)!.cardIds.push(card.id);

      const result = processPhasingInAtUntapStep(gameState, player1Id);

      expect(result.descriptions.length).toBe(1);
      expect(result.state.cards.get(card.id)!.isPhasedOut).toBe(false);
    });
  });

  describe("hasBeenPhasedOut", () => {
    it("should track that a card has been phased out even after it phases back in", () => {
      const card = createTestCreature(gameState, player1Id);
      // Add card to state
      gameState.cards.set(card.id, card);
      gameState.zones.get(`${player1Id}-battlefield`)!.cardIds.push(card.id);

      // Phase out
      const afterPhaseOut = phaseOutWithAttachments(gameState, card.id);
      const afterPhaseOutCard = afterPhaseOut.state.cards.get(card.id)!;
      expect(afterPhaseOutCard.isPhasedOut).toBe(true);

      // Phase in
      const afterPhaseIn = phaseInPermanent(afterPhaseOut.state, card.id);
      const afterPhaseInCard = afterPhaseIn.state.cards.get(card.id)!;
      expect(afterPhaseInCard.isPhasedOut).toBe(false);
      expect(hasBeenPhasedOut(afterPhaseInCard)).toBe(true);
    });
  });

  describe("recursive attachment phasing", () => {
    it("should phase out nested attachments (attachment to attachment)", () => {
      const hostCard = createTestCreature(gameState, player1Id);
      const attachment1 = createTestCreature(gameState, player1Id);
      const attachment2 = createTestCreature(gameState, player1Id);

      // attachment2 attached to attachment1, attachment1 attached to host
      const attachment1ToHost = {
        ...attachment1,
        attachedToId: hostCard.id,
        attachedCardIds: [attachment2.id],
      };
      const attachment2ToAttachment1 = {
        ...attachment2,
        attachedToId: attachment1.id,
        attachedCardIds: [],
      };

      gameState.cards.set(hostCard.id, {
        ...hostCard,
        attachedCardIds: [attachment1.id],
      });
      gameState.cards.set(attachment1.id, attachment1ToHost);
      gameState.cards.set(attachment2.id, attachment2ToAttachment1);
      const bf = gameState.zones.get(`${player1Id}-battlefield`)!;
      bf.cardIds.push(hostCard.id, attachment1.id, attachment2.id);

      const result = phaseOutWithAttachments(gameState, hostCard.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(hostCard.id)!.isPhasedOut).toBe(true);
      expect(result.state.cards.get(attachment1.id)!.isPhasedOut).toBe(true);
      expect(result.state.cards.get(attachment2.id)!.isPhasedOut).toBe(true);
    });
  });
});