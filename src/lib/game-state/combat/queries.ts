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
  hasDeathtouch,
  getToxicLevel,
  getProtectionQualities,
  getMenaceMinimumBlockers,
  getLandwalkTypes,
  hasHaste,
} from "../evergreen-keywords";
import { hasDefenderStrict } from "../keyword-actions/defender";
import { hasFlyingStrict } from "../keyword-actions/flying";
import { hasReachStrict } from "../keyword-actions/reach";
import { hasVigilanceStrict } from "../keyword-actions/vigilance";
import { isThresholdUnblockable } from "../keyword-actions/threshold";
import { cantBeBlockedThisTurn } from "../pt-until-end-of-turn";

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
  // Issue #2328: defer to the strict `hasVigilanceStrict` check so a
  // card whose oracle text merely mentions "vigilance" as a flavor word
  // or continuous-effect grant reference cannot attack from the tap zone.
  // The canonical `hasVigilance` (from `evergreen-keywords`) preserves
  // the substring fallback for cards with missing keyword tags.
  if (card.isTapped) {
    if (!hasVigilanceStrict(card)) {
      return { canAttack: false, reason: "Creature is tapped" };
    }
  }

  // Must not have summoning sickness (unless haste)
  //
  // CR 702.10 / 302.6 — haste waives summoning sickness. Issue #2334:
  // replaced the inline substring oracle-text fallback
  // (`keywords?.includes("Haste") || oracle_text.toLowerCase().includes("haste")`)
  // with the canonical `hasHaste`, which defers to `hasHasteStrict`
  // (parsed keywords only) first. The old substring check could grant
  // haste to a card whose oracle text merely mentions "haste" (flavor
  // word, "creatures you control have haste" grant reference), silently
  // letting it attack the turn it entered.
  if (card.hasSummoningSickness) {
    if (!hasHaste(card)) {
      return {
        canAttack: false,
        reason: "Summoning sickness (haste not granted)",
      };
    }
  }

  // CR 702.13 — defender: this creature can't attack.
  // Consult the strict parsed-keywords check (not substring oracle text) so
  // a card whose oracle text merely mentions "defender" (e.g. a continuous
  // effect grant) is not incorrectly rejected. Issue #2293.
  if (hasDefenderStrict(card)) {
    return {
      canAttack: false,
      reason: "Creature has defender (CR 702.13)",
    };
  }

  // CR 303.4 / Pacifism-style scripted Auras (issue #2568): an attached
  // Aura with `static.restrictAttack` forbids the enchanted permanent
  // from attacking. The list of source Auras is refreshed by
  // `refreshAuraBonuses` alongside `auraPT` / `auraKeywords`.
  if (card.auraRestrictAttack && card.auraRestrictAttack.length > 0) {
    return {
      canAttack: false,
      reason: `${card.auraRestrictAttack.join(", ")} prevents attacking`,
    };
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

  // CR 303.4 / Pacifism-style scripted Auras (issue #2568): an attached
  // Aura with `static.restrictBlock` forbids the enchanted permanent
  // from blocking. Mirrors the `canAttack` check above.
  if (blocker.auraRestrictBlock && blocker.auraRestrictBlock.length > 0) {
    return {
      canBlock: false,
      reason: `${blocker.auraRestrictBlock.join(", ")} prevents blocking`,
    };
  }

  // If there's an attacker, check if it can be blocked (flying, reach, protection, etc.)
  if (attackerId) {
    const attacker = state.cards.get(attackerId);
    if (attacker && isCreature(attacker)) {
      // Threshold "can't be blocked" (issue #2300).
      // "Can't be blocked this turn" from a resolved effect (#2614).
      if (isThresholdUnblockable(attacker) || cantBeBlockedThisTurn(attacker)) {
        return { canBlock: false, reason: "Attacker can't be blocked" };
      }
      // CR 702.9 / 702.12 — flying evasion, with reach as the exception.
      // Issue #2324: replaces the prior substring oracle-text fallback with
      // strict parsed-keyword detection (hasFlyingStrict / hasReachStrict)
      // so flavor-word mentions of "flying" / "reach" no longer false-positive.
      const attackerHasFlying = hasFlyingStrict(attacker);
      const blockerHasFlying = hasFlyingStrict(blocker);
      const blockerHasReach = hasReachStrict(blocker);

      if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
        return {
          canBlock: false,
          reason: "Cannot block flying creatures without flying or reach",
        };
      }

      // CR 702.110 — menace. Note: menace is NOT enforced here because
      // `canBlock` answers "can this individual blocker block this
      // attacker?" — any single blocker *can* block a menace attacker on
      // its own. The minimum-two-blocker requirement is enforced at
      // declaration time in combat/declaration.ts::declareBlockers (which
      // uses `getMenaceMinimumBlockers` to reject partial assignments).
      // Issue #2324.

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
    // Issue #2328: defer to the strict `hasVigilanceStrict` check (see
    // `canAttack` above for the rationale).
    if (card.isTapped) {
      if (!hasVigilanceStrict(card)) return false;
    }

    // Must not have summoning sickness (unless haste)
    //
    // CR 702.10 / 302.6 — issue #2334: canonical `hasHaste` (strict
    // parsed-keywords first) replaces the inline substring oracle-text
    // check; see the matching comment in `canAttack` for the rationale.
    if (card.hasSummoningSickness) {
      if (!hasHaste(card)) return false;
    }

    // CR 702.13 — defender creatures cannot attack. Issue #2293.
    if (hasDefenderStrict(card)) return false;

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
