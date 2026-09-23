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
import type { CombatActionResult } from "./declaration";

/**
 * Check if a creature can attack
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
  // CR 510.1c: A creature that has left the battlefield cannot deal combat damage.
  // Issue #969: creatures that died in the first-strike step must NOT deal damage
  // again in the regular step, even if they have double strike.
  const attackersDealingDamage = state.combat.attackers.filter((attacker) => {
    // A creature no longer on the battlefield cannot deal combat damage.
    // This gates the regular step against creatures killed in the first-strike
    // step, and also guards against any creature removed mid-combat.
    if (!isOnBattlefield(state, attacker.cardId)) {
      return false;
    }
    if (isFirstStrikeStep) {
      // First strike step: only first strike or double strike
      return attacker.hasFirstStrike || attacker.hasDoubleStrike;
    } else {
      // Regular damage step: only double strike OR no first strike
      // First-strike-only creatures are excluded (they already dealt damage).
      // Double-strike creatures that survived the first-strike step deal again.
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
        // CR 306.7: Damage to planeswalker is handled via dealDamageToCard
        // which reduces loyalty counters (CR 119.3c)
        const damageResult = dealDamageToCard(
          updatedState,
          attacker.defenderId as CardInstanceId,
          damage,
          true,
          attacker.cardId,
        );
        updatedState = damageResult.state;
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
      // CR 702.93 (Infect): damage to creatures from a source with infect
      // is dealt as -1/-1 counters instead of marked damage.
      const attackerHasInfect = hasInfect(attackerCard);

      // Deal damage from attacker to blockers
      for (const blocker of sortedBlockers) {
        if (remainingDamage <= 0) break;

        const blockerCard = updatedState.cards.get(blocker.cardId);
        if (!blockerCard) continue;

        const blockerToughness = getEffectiveToughness(
          blockerCard,
          layerSystem,
        );
        const blockerHasLifelink =
          blockerCard.cardData.keywords?.includes("Lifelink") ||
          blockerCard.cardData.oracle_text?.toLowerCase().includes("lifelink");

        // Calculate damage to assign to this blocker.
        // CR 702.19b (trample) + CR 510.1c (general combat): the attacker must
        // assign lethal damage to each blocker in the chosen order before any
        // remaining damage can be assigned to the next blocker or (with trample)
        // to the defending player.
        //
        // Lethal damage to a blocker equals its toughness (minus damage already
        // marked on it — CR 702.19c). The blocker's own deathtouch does NOT
        // change how much damage the attacker must assign to it; only the
        // attacker's deathtouch is relevant (CR 702.2b: any nonzero amount from
        // a deathtouch source counts as lethal, so a deathtouch attacker
        // assigns only 1 per blocker and tramples the rest).
        let damage: number;
        if (attackerHasDeathtouch && remainingDamage > 0) {
          damage = 1;
        } else {
          damage = Math.min(remainingDamage, blockerToughness);
        }

        if (attackerHasInfect) {
          // CR 702.93b: Infect damage to a creature is dealt as -1/-1
          // counters; it is NOT marked as damage on the creature.
          const blockerWithCounters = addCounters(blockerCard, "-1/-1", damage);
          let finalBlocker = blockerWithCounters;
          // CR 702.2b + 702.93b: A source with both infect and deathtouch
          // still counts as a deathtouch source — any nonzero infect damage
          // is lethal, so mark lethal damage to trigger SBA destruction.
          if (attackerHasDeathtouch && damage > 0) {
            const lethalDamage = getToughness(blockerWithCounters);
            finalBlocker = {
              ...blockerWithCounters,
              damage: Math.max(blockerWithCounters.damage, lethalDamage),
            };
          }
          updatedState = {
            ...updatedState,
            cards: new Map(updatedState.cards).set(
              blocker.cardId,
              finalBlocker,
            ),
            lastModifiedAt: Date.now(),
          };
          damageEvents.push(
            `${attackerCard.cardData.name} deals ${damage} infect damage (${damage} -1/-1 counters) to ${blockerCard.cardData.name}`,
          );
        } else {
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
          damageEvents.push(
            `${attackerCard.cardData.name} deals ${damage} to ${blockerCard.cardData.name}`,
          );
        }

        remainingDamage -= damage;
      }

      // Handle trample excess damage
      if (remainingDamage > 0 && attackerHasTrample) {
        if (attacker.isAttackingPlaneswalker) {
          // CR 306.7 + CR 702.19b: Trample excess to planeswalker reduces loyalty
          const damageResult = dealDamageToCard(
            updatedState,
            attacker.defenderId as CardInstanceId,
            remainingDamage,
            true,
            attacker.cardId,
          );
          updatedState = damageResult.state;
          damageEvents.push(
            `${attackerCard.cardData.name} tramples ${remainingDamage} to planeswalker`,
          );
        } else {
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
              let updatedDefender = {
                ...defender,
                life: Math.max(0, defender.life - remainingDamage),
              };
              // CR 702.94 (Toxic): any combat damage to a player from a toxic
              // source adds toxic-level poison counters in addition to life loss.
              const toxicLevel = getToxicLevel(attackerCard);
              if (toxicLevel > 0) {
                updatedDefender = {
                  ...updatedDefender,
                  poisonCounters: updatedDefender.poisonCounters + toxicLevel,
                };
              }
              updatedState = {
                ...updatedState,
                players: new Map(updatedState.players).set(
                  attacker.defenderId as PlayerId,
                  updatedDefender,
                ),
              };
              damageEvents.push(
                toxicLevel > 0
                  ? `${attackerCard.cardData.name} tramples ${remainingDamage} to ${defender.name} and ${toxicLevel} toxic poison`
                  : `${attackerCard.cardData.name} tramples ${remainingDamage} to ${defender.name}`,
              );
            }
          }
        }
      }

      // Now deal damage from blockers to attacker
      // CR 702.4b: Blockers with first strike deal damage in first strike step
      // CR 702.4b: Blockers with double strike deal damage in BOTH steps
      // In regular step: Only surviving blockers deal damage
      // Issue #969: blockers that died in the first-strike step must NOT deal
      // damage in the regular step, even if they have double strike.
      for (const blocker of sortedBlockers) {
        // A blocker no longer on the battlefield cannot deal combat damage.
        // This gates the regular step against blockers killed in the
        // first-strike step (CR 510.1c).
        if (!isOnBattlefield(updatedState, blocker.cardId)) {
          continue;
        }

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

        // CR 702.93 (Infect): a blocker with infect deals damage to the
        // attacker as -1/-1 counters instead of marked damage.
        const blockerHasInfect = hasInfect(blockerCard);
        if (blockerHasInfect) {
          const currentAttacker = updatedState.cards.get(attacker.cardId);
          if (currentAttacker) {
            const attackerWithCounters = addCounters(
              currentAttacker,
              "-1/-1",
              blockerPower,
            );
            let finalAttacker = attackerWithCounters;
            // CR 702.2b + 702.93b: infect + deathtouch is lethal.
            const blockerHasDeathtouch = hasDeathtouch(blockerCard);
            if (blockerHasDeathtouch && blockerPower > 0) {
              const lethalDamage = getToughness(attackerWithCounters);
              finalAttacker = {
                ...attackerWithCounters,
                damage: Math.max(attackerWithCounters.damage, lethalDamage),
              };
            }
            updatedState = {
              ...updatedState,
              cards: new Map(updatedState.cards).set(
                attacker.cardId,
                finalAttacker,
              ),
              lastModifiedAt: Date.now(),
            };
            damageEvents.push(
              `${blockerCard.cardData.name} deals ${blockerPower} infect damage (${blockerPower} -1/-1 counters) to ${attackerCard.cardData.name}`,
            );
          }
        } else {
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
