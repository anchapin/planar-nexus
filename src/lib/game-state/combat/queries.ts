/**
 * Combat System
 * Implements the MTG combat system for declaring attackers, blockers, and resolving combat damage.
 * Reference: Comprehensive Rules 506-510
 * Issue #817: First Strike and Double Strike combat implementation (CR 702.7, CR 702.4)
 */

import type { GameState, CardInstanceId, PlayerId } from "../types";
import { Phase, isOnBattlefield } from "../types";
import {
  isCreature,
  getPower,
  getToughness,
  addCounters,
} from "../card-instance";
import { dealDamageToCard } from "../keyword-actions";
import { checkStateBasedActions } from "../state-based-actions";
import { dealCommanderDamage, isCommander } from "../commander-damage";
import {
  layerSystem,
  getEffectivePower,
  getEffectiveToughness,
} from "../layer-system";
import {
  markCreatureAttackedForBoast,
  hasInfect,
  hasDeathtouch,
  getToxicLevel,
  getProtectionQualities,
  getMenaceMinimumBlockers,
  getLandwalkTypes,
} from "../evergreen-keywords";

/**
 * Result of a combat action
 */
export function canAttack(
  state: GameState,
  cardId: CardInstanceId,
  defenderId?: PlayerId | CardInstanceId,
): { canAttack: boolean; reason?: string } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { canAttack: false, reason: "Card not found" };
  }

  // Must be a creature
  if (!isCreature(card)) {
    return { canAttack: false, reason: "Only creatures can attack" };
  }

  // Must be on the battlefield
  const battlefieldZoneKey = `${card.controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  if (!battlefield || !battlefield.cardIds.includes(cardId)) {
    return { canAttack: false, reason: "Card must be on the battlefield" };
  }

  // Must not be tapped (unless has vigilance)
  if (card.isTapped) {
    const hasVigilance =
      card.cardData.keywords?.includes("Vigilance") ||
      card.cardData.oracle_text?.toLowerCase().includes("vigilance");
    if (!hasVigilance) {
      return { canAttack: false, reason: "Creature is tapped" };
    }
  }

  // Must not have summoning sickness (unless haste)
  if (card.hasSummoningSickness) {
    const hasHaste =
      card.cardData.keywords?.includes("Haste") ||
      card.cardData.oracle_text?.toLowerCase().includes("haste");
    if (!hasHaste) {
      return {
        canAttack: false,
        reason: "Summoning sickness (haste not granted)",
      };
    }
  }

  // Must have a defender
  if (!defenderId) {
    return { canAttack: false, reason: "No defender specified" };
  }

  // Check for defender being a planeswalker or player
  // This is handled by the UI layer

  return { canAttack: true };
}

/**
 * Check if a creature can block
 */
export function canBlock(
  state: GameState,
  blockerId: CardInstanceId,
  attackerId?: CardInstanceId,
): { canBlock: boolean; reason?: string } {
  const blocker = state.cards.get(blockerId);

  if (!blocker) {
    return { canBlock: false, reason: "Card not found" };
  }

  // Must be a creature
  if (!isCreature(blocker)) {
    return { canBlock: false, reason: "Only creatures can block" };
  }

  // Must be on the battlefield
  const battlefieldZoneKey = `${blocker.controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  if (!battlefield || !battlefield.cardIds.includes(blockerId)) {
    return { canBlock: false, reason: "Card must be on the battlefield" };
  }

  // Must not be tapped
  if (blocker.isTapped) {
    return { canBlock: false, reason: "Creature is tapped" };
  }

  // If there's an attacker, check if it can be blocked (flying, reach, protection, etc.)
  if (attackerId) {
    const attacker = state.cards.get(attackerId);
    if (attacker && isCreature(attacker)) {
      // Check flying
      const attackerHasFlying =
        attacker.cardData.keywords?.includes("Flying") ||
        attacker.cardData.oracle_text?.toLowerCase().includes("flying");
      const blockerHasFlying =
        blocker.cardData.keywords?.includes("Flying") ||
        blocker.cardData.oracle_text?.toLowerCase().includes("flying");
      const blockerHasReach =
        blocker.cardData.keywords?.includes("Reach") ||
        blocker.cardData.oracle_text?.toLowerCase().includes("reach");

      if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
        return {
          canBlock: false,
          reason: "Cannot block flying creatures without flying or reach",
        };
      }

      // CR 702.16D: Check protection - creatures with protection from attacker's color can't block
      const attackerColors = attacker.cardData.colors || [];
      for (const color of attackerColors) {
        const protectionQualities = getProtectionQualities(blocker);
        if (
          protectionQualities.some(
            (q) => q.toLowerCase() === color.toLowerCase(),
          )
        ) {
          return {
            canBlock: false,
            reason: `Cannot block creatures with ${color} protection`,
          };
        }
      }

      // CR 702.14 (Landwalk): A creature with a basic-landwalk variant
      // (swampwalk, islandwalk, plainswalk, mountainwalk, forestwalk) can't
      // be blocked if the defending player controls a land with the matching
      // basic land subtype. The defender is the blocker's controller — only
      // the player being attacked can block, so blocker.controllerId is the
      // relevant defender for this attacker.
      // Issue #971
      const landwalkTypes = getLandwalkTypes(attacker);
      if (landwalkTypes.length > 0) {
        const defenderId = blocker.controllerId;
        const defenderBattlefield = state.zones.get(
          `${defenderId}-battlefield`,
        );
        const defenderCardIds = defenderBattlefield?.cardIds || [];
        for (const landType of landwalkTypes) {
          const controlsMatchingLand = defenderCardIds.some((id) => {
            const landCard = state.cards.get(id);
            if (!landCard) return false;
            const typeLine = landCard.cardData.type_line?.toLowerCase() || "";
            // Must be a land, and either have the basic land subtype in its
            // type line or be designated as that basic land type via a
            // continuous effect (chosenBasicLandType).
            if (!typeLine.includes("land")) return false;
            return (
              typeLine.includes(landType) ||
              landCard.chosenBasicLandType?.toLowerCase() === landType
            );
          });
          if (controlsMatchingLand) {
            return {
              canBlock: false,
              reason: `Cannot block ${landType}walk creature while controlling a ${landType}`,
            };
          }
        }
      }
    }
  }

  return { canBlock: true };
}

/**
 * Declare attackers
 * Phase 1.2 Issue #9: Implement combat system
/**
 * Get all available attackers for a player
 * Returns creatures that could attack if a defender were specified
 */
export function getAvailableAttackers(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  const battlefieldZoneKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) return [];

  return battlefield.cardIds.filter((cardId) => {
    const card = state.cards.get(cardId);

    if (!card) return false;

    // Must be a creature
    if (!isCreature(card)) return false;

    // Must not be tapped (unless has vigilance)
    if (card.isTapped) {
      const hasVigilance =
        card.cardData.keywords?.includes("Vigilance") ||
        card.cardData.oracle_text?.toLowerCase().includes("vigilance");
      if (!hasVigilance) return false;
    }

    // Must not have summoning sickness (unless haste)
    if (card.hasSummoningSickness) {
      const hasHaste =
        card.cardData.keywords?.includes("Haste") ||
        card.cardData.oracle_text?.toLowerCase().includes("haste");
      if (!hasHaste) return false;
    }

    return true;
  });
}
/**
 * Get all available blockers for a player
 */
export function getAvailableBlockers(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  const battlefieldZoneKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) return [];

  return battlefield.cardIds.filter((cardId) => {
    const { canBlock: can } = canBlock(state, cardId);
    return can;
  });
}
