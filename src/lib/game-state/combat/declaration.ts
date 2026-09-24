/**
 * Combat System
 * Implements the MTG combat system for declaring attackers, blockers, and resolving combat damage.
 * Reference: Comprehensive Rules 506-510
 * Issue #817: First Strike and Double Strike combat implementation (CR 702.7, CR 702.4)
 */

import type { GameState, CardInstanceId, PlayerId } from "../types";
import { Phase, isOnBattlefield } from "../types";
import { canBlock, canAttack } from "./queries";
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
export interface CombatActionResult {
  success: boolean;
  state: GameState;
  description: string;
  errors?: string[];
}

export function declareAttackers(
  state: GameState,
  attackerIds: Array<{
    cardId: CardInstanceId;
    defenderId: PlayerId | CardInstanceId;
  }>,
): CombatActionResult {
  const errors: string[] = [];
  const validAttackers: Array<{
    cardId: CardInstanceId;
    defenderId: PlayerId | CardInstanceId;
  }> = [];

  // Must be in combat phase
  const combatPhase = state.turn.currentPhase;
  const validCombatPhases = ["declare_attackers", "begin_combat"];
  if (!validCombatPhases.includes(combatPhase)) {
    return {
      success: false,
      state,
      description: "",
      errors: ["Can only declare attackers during the declare attackers step"],
    };
  }

  // Check each attacker
  for (const attack of attackerIds) {
    const { canAttack: can, reason } = canAttack(
      state,
      attack.cardId,
      attack.defenderId,
    );
    if (can) {
      validAttackers.push(attack);
    } else {
      errors.push(
        `${state.cards.get(attack.cardId)?.cardData.name || attack.cardId}: ${reason}`,
      );
    }
  }

  // If no valid attackers, return error
  if (validAttackers.length === 0 && attackerIds.length > 0) {
    return {
      success: false,
      state,
      description: "",
      errors: ["No valid attackers declared"],
    };
  }

  // Create attacker objects
  const attackers: import("../types").Attacker[] = validAttackers.map(
    (attack) => {
      const attackerCard = state.cards.get(attack.cardId);
      const hasFirstStrike = attackerCard
        ? attackerCard.cardData.keywords?.includes("First Strike") ||
          attackerCard.cardData.oracle_text
            ?.toLowerCase()
            .includes("first strike")
        : false;
      const hasDoubleStrike = attackerCard
        ? attackerCard.cardData.keywords?.includes("Double Strike") ||
          attackerCard.cardData.oracle_text
            ?.toLowerCase()
            .includes("double strike")
        : false;

      return {
        cardId: attack.cardId,
        defenderId: attack.defenderId,
        isAttackingPlaneswalker:
          typeof attack.defenderId === "string" &&
          attack.defenderId.startsWith("card-"),
        damageToDeal: attackerCard
          ? getEffectivePower(attackerCard, layerSystem)
          : 0,
        hasFirstStrike: hasFirstStrike || false,
        hasDoubleStrike: hasDoubleStrike || false,
      };
    },
  );

  // Tap attacking creatures
  const updatedState = { ...state };
  const updatedCards = new Map(updatedState.cards);

  for (const attacker of attackers) {
    const card = updatedCards.get(attacker.cardId);
    if (card) {
      const updatedCard = { ...card };

      // Check for vigilance - if creature has vigilance, don't tap
      const hasVigilance =
        card.cardData.keywords?.includes("Vigilance") ||
        card.cardData.oracle_text?.toLowerCase().includes("vigilance");

      if (!hasVigilance) {
        updatedCard.isTapped = true;
      }

      // Mark creature as having attacked for Boast keyword (CR 702.131)
      // This flag is set when the creature attacks and is checked at the
      // beginning of the owner's next upkeep to determine if Boast triggers
      updatedCard.attackedLastTurn = true;

      updatedCards.set(attacker.cardId, updatedCard);
    }
  }

  // Update combat state
  const updatedCombat = {
    ...updatedState.combat,
    inCombatPhase: true,
    attackers,
    blockers: new Map(), // Clear any previous blockers
    remainingCombatPhases: updatedState.combat.remainingCombatPhases,
  };

  return {
    success: true,
    state: {
      ...updatedState,
      cards: updatedCards,
      combat: updatedCombat,
      lastModifiedAt: Date.now(),
    },
    description: `Declared ${attackers.length} attacker${attackers.length !== 1 ? "s" : ""}`,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Declare blockers
 */
export function declareBlockers(
  state: GameState,
  blockerAssignments: Map<CardInstanceId, CardInstanceId[]>,
): CombatActionResult {
  const errors: string[] = [];
  const validBlockers = new Map<CardInstanceId, CardInstanceId[]>();

  // Must be in combat phase with attackers declared
  if (!state.combat.inCombatPhase || state.combat.attackers.length === 0) {
    return {
      success: false,
      state,
      description: "",
      errors: ["No attackers declared"],
    };
  }

  // Check each blocker's assignment
  for (const [attackerId, blockerIds] of blockerAssignments) {
    const validBlockerIds: CardInstanceId[] = [];

    for (const blockerId of blockerIds) {
      const { canBlock: can, reason } = canBlock(state, blockerId, attackerId);
      if (can) {
        validBlockerIds.push(blockerId);
      } else {
        errors.push(
          `${state.cards.get(blockerId)?.cardData.name || blockerId}: ${reason}`,
        );
      }
    }

    // Menace enforcement (CR 702.70): a creature with menace can't be blocked
    // except by two or more creatures. If the attacker requires more blockers
    // than were validly assigned, reject the entire assignment for this
    // attacker (it remains unblocked) and surface an error.
    // Note: 0 blockers is always legal (the attacker is simply unblocked);
    // only a partial assignment (fewer than the minimum) is rejected.
    // Issue #968
    if (validBlockerIds.length > 0) {
      const attacker = state.cards.get(attackerId);
      if (attacker && isCreature(attacker)) {
        const minRequired = getMenaceMinimumBlockers(attacker);
        if (validBlockerIds.length < minRequired) {
          errors.push(
            `${attacker.cardData.name || attackerId}: can't be blocked by fewer than ${minRequired} creature${minRequired !== 1 ? "s" : ""} (menace)`,
          );
          continue;
        }
      }
      validBlockers.set(attackerId, validBlockerIds);
    }
  }

  // Create blocker objects with order
  const blockers = new Map<
    CardInstanceId,
    Array<{
      cardId: CardInstanceId;
      attackerId: CardInstanceId;
      damageToDeal: number;
      blockerOrder: number;
      hasFirstStrike: boolean;
      hasDoubleStrike: boolean;
    }>
  >();

  for (const [attackerId, blockerIds] of validBlockers) {
    const blockerObjects: import("../types").Blocker[] = blockerIds.map(
      (blockerId, index) => {
        const blocker = state.cards.get(blockerId);
        const blockerPower = blocker
          ? getEffectivePower(blocker, layerSystem)
          : 0;
        const blockerHasFirstStrike = blocker
          ? blocker.cardData.keywords?.includes("First Strike") ||
            blocker.cardData.oracle_text?.toLowerCase().includes("first strike")
          : false;
        const blockerHasDoubleStrike = blocker
          ? blocker.cardData.keywords?.includes("Double Strike") ||
            blocker.cardData.oracle_text
              ?.toLowerCase()
              .includes("double strike")
          : false;

        // Calculate damage to deal
        let damageToDeal = blockerPower;
        if (blockerHasFirstStrike || blockerHasDoubleStrike) {
          // First strike damage is dealt in first strike step
          damageToDeal = blockerPower;
        }

        return {
          cardId: blockerId,
          attackerId,
          damageToDeal,
          blockerOrder: index,
          hasFirstStrike: blockerHasFirstStrike || false,
          hasDoubleStrike: blockerHasDoubleStrike || false,
        };
      },
    );

    blockers.set(attackerId, blockerObjects);
  }

  // Update combat state
  const updatedCombat = {
    ...state.combat,
    blockers,
  };

  return {
    success: true,
    state: {
      ...state,
      combat: updatedCombat,
      lastModifiedAt: Date.now(),
    },
    description: `Declared ${Array.from(validBlockers.values()).flat().length} blocker(s)`,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Set the attacker's chosen damage assignment order among its blockers.
 *
 * CR 508.2: After blockers are declared, the active player announces, for each
 * attacking creature, the order in which it will assign its combat damage to
 * the creatures blocking it. CR 510.1c: that order is then used in BOTH the
 * first-strike and regular combat damage steps — lethal damage must be
 * assigned to the first blocker in the order before any damage is assigned to
 * the next.
 *
 * Issue #979: When an attacker with first strike (or double strike) is blocked
 * by multiple creatures, this announced order is what governs damage flow in
 * the first-strike step. `declareBlockers` seeds a default insertion order
 * (the order the defending player declared blockers); this function lets the
 * attacker override that with their own chosen sequence. The actual
 * lethal-in-order assignment lives in `resolveCombatDamage`, which simply
 * sorts blockers by `blockerOrder` in each damage step — so setting the order
 * here is sufficient for it to be applied correctly in the first-strike step.
 *
 * This only touches the assignment-ORDERING data; the two-step damage gating
 * (which attackers act in which step) is a separate concern.
 */
export function setDamageAssignmentOrder(
  state: GameState,
  attackerId: CardInstanceId,
  orderedBlockerIds: CardInstanceId[],
): CombatActionResult {
  // Must be in an active combat with attackers declared
  if (!state.combat.inCombatPhase || state.combat.attackers.length === 0) {
    return {
      success: false,
      state,
      description: "",
      errors: ["No active combat to set damage assignment order for"],
    };
  }

  // The attacker must be part of the current combat
  const attacker = state.combat.attackers.find((a) => a.cardId === attackerId);
  if (!attacker) {
    return {
      success: false,
      state,
      description: "",
      errors: [`Creature is not attacking in this combat`],
    };
  }

  const currentBlockers = state.combat.blockers.get(attackerId);

  // An order is only meaningful when the attacker is actually blocked
  if (!currentBlockers || currentBlockers.length === 0) {
    return {
      success: false,
      state,
      description: "",
      errors: [`Attacker is not blocked; no damage assignment order to set`],
    };
  }

  // The announced order must be an exact permutation of the blockers
  // currently assigned to this attacker. Reject missing blockers, extras, and
  // duplicates so the engine never silently reorders or drops a creature.
  const currentIds = new Set(currentBlockers.map((b) => b.cardId));
  if (orderedBlockerIds.length !== currentIds.size) {
    return {
      success: false,
      state,
      description: "",
      errors: [
        `Damage assignment order must include every blocker exactly once (expected ${currentIds.size}, got ${orderedBlockerIds.length})`,
      ],
    };
  }

  const seen = new Set<CardInstanceId>();
  for (const id of orderedBlockerIds) {
    if (!currentIds.has(id)) {
      return {
        success: false,
        state,
        description: "",
        errors: [`Creature is not blocking this attacker`],
      };
    }
    if (seen.has(id)) {
      return {
        success: false,
        state,
        description: "",
        errors: [
          `Creature appears more than once in the damage assignment order`,
        ],
      };
    }
    seen.add(id);
  }

  // Re-key each blocker's `blockerOrder` to the attacker's announced sequence.
  // `resolveCombatDamage` sorts by this field in each damage step, so updating
  // it here is enough to make the chosen order govern damage flow in both the
  // first-strike and regular steps (CR 510.1c).
  const idToPosition = new Map<CardInstanceId, number>();
  orderedBlockerIds.forEach((id, index) => idToPosition.set(id, index));

  const reorderedBlockers = currentBlockers.map((blocker) => ({
    ...blocker,
    blockerOrder: idToPosition.get(blocker.cardId)!,
  }));

  const updatedBlockersMap = new Map(state.combat.blockers);
  updatedBlockersMap.set(attackerId, reorderedBlockers);

  return {
    success: true,
    state: {
      ...state,
      combat: {
        ...state.combat,
        blockers: updatedBlockersMap,
      },
      lastModifiedAt: Date.now(),
    },
    description: `Set damage assignment order for attacker (blockers in chosen order)`,
  };
}

/**
 * Resolve combat damage
 * After dealing damage, state-based actions are checked to handle:
 * - Creatures with lethal damage dying
 * - Players losing from damage/commander damage/poison
 * Issue #267: State-based actions (SBA) system
 */
