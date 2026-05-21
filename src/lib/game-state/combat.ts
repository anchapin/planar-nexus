/**
 * Combat System
 * Implements the MTG combat system for declaring attackers, blockers, and resolving combat damage.
 * Reference: Comprehensive Rules 506-510
 */

import type { GameState, CardInstanceId, PlayerId } from "./types";
import { Phase } from "./types";
import { isCreature, getPower, getToughness } from "./card-instance";
import { dealDamageToCard } from "./keyword-actions";
import { checkStateBasedActions } from "./state-based-actions";
import { dealCommanderDamage, isCommander } from "./commander-damage";
import {
  layerSystem,
  getEffectivePower,
  getEffectiveToughness,
} from "./layer-system";
import {
  markCreatureAttackedForBoast,
  hasInfect,
  hasDeathtouch,
  getToxicLevel,
} from "./evergreen-keywords";

/**
 * Result of a combat action
 */
export interface CombatActionResult {
  success: boolean;
  state: GameState;
  description: string;
  errors?: string[];
}

/**
 * Check if a creature can attack
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

  // If there's an attacker, check if it can be blocked (flying, reach, etc.)
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
    }
  }

  return { canBlock: true };
}

/**
 * Declare attackers
 * Phase 1.2 Issue #9: Implement combat system
 */
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
  const attackers: import("./types").Attacker[] = validAttackers.map(
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

    if (validBlockerIds.length > 0) {
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
    const blockerObjects: import("./types").Blocker[] = blockerIds.map(
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
 * Resolve combat damage
 * After dealing damage, state-based actions are checked to handle:
 * - Creatures with lethal damage dying
 * - Players losing from damage/commander damage/poison
 * Issue #267: State-based actions (SBA) system
 */
export function resolveCombatDamage(state: GameState): CombatActionResult {
  if (!state.combat.inCombatPhase || state.combat.attackers.length === 0) {
    return {
      success: false,
      state,
      description: "No combat to resolve",
    };
  }

  const currentPhase = state.turn.currentPhase;
  const isFirstStrikeStep = currentPhase === Phase.COMBAT_DAMAGE_FIRST_STRIKE;

  let updatedState = { ...state };
  const damageEvents: string[] = [];

  // Determine which attackers should deal damage this step
  // CR 702.4b: Double strike creatures deal damage in BOTH steps
  // In first strike step: creatures with first strike OR double strike deal damage
  // In regular damage step: surviving creatures with double strike OR regular creatures deal damage
  const attackersDealingDamage = state.combat.attackers.filter((attacker) => {
    if (isFirstStrikeStep) {
      // First strike step: only first strike or double strike
      return attacker.hasFirstStrike || attacker.hasDoubleStrike;
    } else {
      // Regular damage step: only double strike OR no first strike
      // Exclude creatures that died in first strike step (they won't be on battlefield)
      return !attacker.hasFirstStrike || attacker.hasDoubleStrike;
    }
  });

  // Process each attacker that should deal damage this step
  for (const attacker of attackersDealingDamage) {
    const attackerCard = updatedState.cards.get(attacker.cardId);
    if (!attackerCard) continue;

    const attackerPower = getEffectivePower(attackerCard, layerSystem);
    const attackerHasTrample =
      attackerCard.cardData.keywords?.includes("Trample") ||
      attackerCard.cardData.oracle_text?.toLowerCase().includes("trample");

    const assignedBlockers = state.combat.blockers.get(attacker.cardId);

    // Check if attacker is blocked
    if (!assignedBlockers || assignedBlockers.length === 0) {
      // Unblocked - damage goes to defender
      // In first strike step, double striker deals full damage once
      // In regular step, double striker deals full damage again
      // Only unblocked attackers deal full damage (no multiplier in separate steps)
      const damage = attackerPower;

      if (attacker.isAttackingPlaneswalker) {
        // Damage to planeswalker would need planeswalker damage handling
        damageEvents.push(
          `${attackerCard.cardData.name} deals ${damage} to planeswalker`,
        );
      } else {
        // Damage to player
        const defender = updatedState.players.get(
          attacker.defenderId as PlayerId,
        );
        if (defender) {
          // Check for lifelink on attacker
          const attackerHasLifelink =
            attackerCard.cardData.keywords?.includes("Lifelink") ||
            attackerCard.cardData.oracle_text
              ?.toLowerCase()
              .includes("lifelink");

          // Check if attacker is a commander
          const isAttackerCommander = isCommander(attackerCard);

          // Check for infect (CR 702.93) and toxic (CR 702.94)
          const attackerHasInfect = hasInfect(attackerCard);
          const attackerToxicLevel = getToxicLevel(attackerCard);

          // Apply damage to player
          // CR 702.93 (Infect): ALL damage to players is dealt as poison counters, not life loss
          // CR 702.94 (Toxic): Player gets poison counters equal to toxic level IN ADDITION to damage
          if (attackerHasInfect) {
            // Infect converts damage to poison - no life loss occurs (CR 702.93)
            let updatedDefender = {
              ...defender,
              poisonCounters: defender.poisonCounters + damage,
            };

            // If creature also has toxic, add toxic poison as well (CR 702.94)
            if (attackerToxicLevel > 0) {
              updatedDefender = {
                ...updatedDefender,
                poisonCounters:
                  updatedDefender.poisonCounters + attackerToxicLevel,
              };
            }

            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(
                attacker.defenderId as PlayerId,
                updatedDefender,
              ),
            };

            if (attackerToxicLevel > 0) {
              damageEvents.push(
                `${attackerCard.cardData.name} deals ${damage} poison to ${defender.name} and ${attackerToxicLevel} toxic poison`,
              );
            } else {
              damageEvents.push(
                `${attackerCard.cardData.name} deals ${damage} poison to ${defender.name}`,
              );
            }
          } else {
            // Normal damage - applies as life loss
            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(
                attacker.defenderId as PlayerId,
                {
                  ...defender,
                  life: Math.max(0, defender.life - damage),
                },
              ),
            };

            // Toxic gives additional poison counters per CR 702.94
            if (attackerToxicLevel > 0) {
              const currentDefender = updatedState.players.get(
                attacker.defenderId as PlayerId,
              )!;
              const updatedDefender = {
                ...currentDefender,
                poisonCounters:
                  currentDefender.poisonCounters + attackerToxicLevel,
              };
              updatedState = {
                ...updatedState,
                players: new Map(updatedState.players).set(
                  attacker.defenderId as PlayerId,
                  updatedDefender,
                ),
              };
              damageEvents.push(
                `${attackerCard.cardData.name} deals ${damage} to ${defender.name} and ${attackerToxicLevel} toxic poison`,
              );
            } else {
              damageEvents.push(
                `${attackerCard.cardData.name} deals ${damage} to ${defender.name}`,
              );
            }
          }

          // Track commander damage if applicable
          if (isAttackerCommander) {
            const commanderDamageResult = dealCommanderDamage(
              updatedState,
              attacker.cardId,
              attacker.defenderId as PlayerId,
              damage,
            );
            if (commanderDamageResult.success) {
              updatedState = commanderDamageResult.state;
              if (commanderDamageResult.playerLost) {
                damageEvents.push(
                  `${attackerCard.cardData.name} dealt lethal commander damage to ${defender.name}`,
                );
              }
            }
          }

          if (attackerHasLifelink) {
            // Gain life equal to damage dealt
            const attackerController = updatedState.players.get(
              attackerCard.controllerId,
            );
            if (attackerController) {
              updatedState = {
                ...updatedState,
                players: new Map(updatedState.players).set(
                  attackerCard.controllerId!,
                  {
                    ...attackerController,
                    life: attackerController.life + damage,
                  },
                ),
              };
            }
            damageEvents.push(
              `${attackerCard.cardData.name} deals ${damage} to ${defender.name} and controller gains ${damage} life`,
            );
          } else {
            damageEvents.push(
              `${attackerCard.cardData.name} deals ${damage} to ${defender.name}`,
            );
          }
        }
      }
    } else {
      // Blocked - damage is assigned to blockers
      let remainingDamage = attackerPower;

      // Sort blockers by order
      const sortedBlockers = [...assignedBlockers].sort(
        (a, b) => a.blockerOrder - b.blockerOrder,
      );

      const attackerHasDeathtouch = hasDeathtouch(attackerCard);

      // Deal damage from attacker to blockers
      for (const blocker of sortedBlockers) {
        if (remainingDamage <= 0) break;

        const blockerCard = updatedState.cards.get(blocker.cardId);
        if (!blockerCard) continue;

        const blockerToughness = getEffectiveToughness(
          blockerCard,
          layerSystem,
        );
        const blockerHasDeathtouch = hasDeathtouch(blockerCard);
        const blockerHasLifelink =
          blockerCard.cardData.keywords?.includes("Lifelink") ||
          blockerCard.cardData.oracle_text?.toLowerCase().includes("lifelink");

        // Calculate damage to deal to this blocker
        let damage: number;
        if (attackerHasDeathtouch && remainingDamage > 0) {
          // CR 702.2b: Any nonzero amount of damage from a deathtouch source is lethal
          // Assign only 1 damage to each blocker to maximize trample excess
          damage = 1;
        } else if (blockerHasDeathtouch && remainingDamage > 0) {
          // Blocker has deathtouch — ensure we assign lethal to kill it if we can
          damage = Math.min(remainingDamage, blockerToughness);
          if (damage > 0) {
            damage = Math.max(damage, blockerToughness);
          }
        } else {
          damage = Math.min(remainingDamage, blockerToughness);
        }

        // Apply damage to blocker
        const damageResult = dealDamageToCard(
          updatedState,
          blocker.cardId,
          damage,
          true,
          attacker.cardId,
        );
        updatedState = damageResult.state;

        // Check for lifelink on blocker
        if (blockerHasLifelink) {
          const blockerController = updatedState.players.get(
            blockerCard.controllerId,
          );
          if (blockerController) {
            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(
                blockerCard.controllerId!,
                {
                  ...blockerController,
                  life: blockerController.life + damage,
                },
              ),
            };
          }
        }

        remainingDamage -= damage;
        damageEvents.push(
          `${attackerCard.cardData.name} deals ${damage} to ${blockerCard.cardData.name}`,
        );
      }

      // Handle trample excess damage
      if (remainingDamage > 0 && attackerHasTrample) {
        const defender = updatedState.players.get(
          attacker.defenderId as PlayerId,
        );
        if (defender) {
          // Check for infect on the attacker for trample excess
          const attackerHasInfect = hasInfect(attackerCard);

          if (attackerHasInfect) {
            // Excess trample damage with infect also applies as poison
            const updatedDefender = {
              ...defender,
              poisonCounters: defender.poisonCounters + remainingDamage,
            };
            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(
                attacker.defenderId as PlayerId,
                updatedDefender,
              ),
            };
            damageEvents.push(
              `${attackerCard.cardData.name} tramples ${remainingDamage} poison to ${defender.name}`,
            );
          } else {
            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(
                attacker.defenderId as PlayerId,
                {
                  ...defender,
                  life: Math.max(0, defender.life - remainingDamage),
                },
              ),
            };
            damageEvents.push(
              `${attackerCard.cardData.name} tramples ${remainingDamage} to ${defender.name}`,
            );
          }
        }
      }

      // Now deal damage from blockers to attacker
      // CR 702.4b: Blockers with first strike deal damage in first strike step
      // CR 702.4b: Blockers with double strike deal damage in BOTH steps
      // In regular step: Only surviving blockers deal damage
      for (const blocker of sortedBlockers) {
        const blockerCard = updatedState.cards.get(blocker.cardId);
        if (!blockerCard) continue;

        // Check if this blocker should deal damage in the current step
        const blockerHasFirstStrike =
          blocker.hasFirstStrike ||
          blockerCard.cardData.keywords?.includes("First Strike") ||
          blockerCard.cardData.oracle_text
            ?.toLowerCase()
            .includes("first strike");
        const blockerHasDoubleStrike =
          blocker.hasDoubleStrike ||
          blockerCard.cardData.keywords?.includes("Double Strike") ||
          blockerCard.cardData.oracle_text
            ?.toLowerCase()
            .includes("double strike");

        if (isFirstStrikeStep) {
          // First strike step: only blockers with first strike or double strike
          if (!blockerHasFirstStrike && !blockerHasDoubleStrike) {
            continue;
          }
        } else {
          // Regular damage step: blockers with only first strike don't get a second attack
          // (they already dealt damage in first strike step)
          // Double strikers that survived can deal again
          if (blockerHasFirstStrike && !blockerHasDoubleStrike) {
            continue;
          }
          // Note: We don't check for lethal damage here because in regular combat
          // damage step, creatures deal damage simultaneously and then SBA checks
          // for destruction. A creature with lethal damage marked can still deal
          // damage in the regular step (CR 702.4 - no first strike rules).
        }

        const blockerPower = getEffectivePower(blockerCard, layerSystem);
        if (blockerPower <= 0) continue;

        // Apply damage from blocker to attacker
        const damageResult = dealDamageToCard(
          updatedState,
          attacker.cardId,
          blockerPower,
          true,
          blocker.cardId,
        );
        updatedState = damageResult.state;
        damageEvents.push(
          `${blockerCard.cardData.name} deals ${blockerPower} to ${attackerCard.cardData.name}`,
        );
      }
    }
  }

  // After all combat damage is dealt, check state-based actions
  // This handles creatures with lethal damage dying, players losing, etc.
  const sbaResult = checkStateBasedActions(updatedState);
  updatedState = sbaResult.state;

  // Add SBA descriptions to damage events
  for (const desc of sbaResult.descriptions) {
    damageEvents.push(desc);
  }

  // Only clear combat state after the regular combat damage step
  // In first strike step, keep combat state intact for the second pass
  let clearedCombat;
  if (isFirstStrikeStep) {
    // First strike step complete - keep combat state for regular damage step
    clearedCombat = {
      ...updatedState.combat,
      attackers: state.combat.attackers, // Keep attackers for second pass
      blockers: state.combat.blockers, // Keep blockers for second pass
    };
  } else {
    // Regular damage step complete - clear combat state
    clearedCombat = {
      ...updatedState.combat,
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
    };
  }

  return {
    success: true,
    state: {
      ...updatedState,
      combat: clearedCombat,
      lastModifiedAt: Date.now(),
    },
    description: `Combat resolved: ${damageEvents.join(", ")}`,
  };
}

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
