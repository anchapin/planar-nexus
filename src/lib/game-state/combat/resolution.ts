/**
 * Combat System
 * Implements the MTG combat system for declaring attackers, blockers, and resolving combat damage.
 * Reference: Comprehensive Rules 506-510
 * Issue #817: First Strike and Double Strike combat implementation (CR 702.7, CR 702.4)
 */

import { scriptRuleActive } from "../keyword-actions/scripted-statics";
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { Phase, isOnBattlefield } from "../types";
import { isCreature, getPower } from "../card-instance";
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
  hasFirstStrike,
  hasDoubleStrike,
  hasTrample,
  hasLifelink,
} from "../evergreen-keywords";

/**
 * Result of a combat action
 */
import type { CombatActionResult } from "./declaration";
import { detectTriggeredAbilities } from "../abilities/triggered";
import type { TriggeredAbilityInstance } from "../abilities/types";
import { putTriggersOnStack } from "../trigger-system/stack-ops";

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
  // Attackers that dealt combat damage to a player this step, for
  // "whenever this creature deals combat damage to a player" (#2428).
  const combatDamageToPlayerSources = new Set<CardInstanceId>();

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
    // The declaration-time flags miss first or double strike granted
    // after attackers were declared (Pedal to the Metal, #2552), so the
    // creature as it is now counts too, as blockers already do below.
    const liveCard = state.cards.get(attacker.cardId);
    const doubleStrike =
      attacker.hasDoubleStrike ||
      (liveCard !== undefined && hasDoubleStrike(liveCard));
    if (isFirstStrikeStep) {
      // First strike step: only first strike or double strike
      return (
        attacker.hasFirstStrike ||
        doubleStrike ||
        (liveCard !== undefined && hasFirstStrike(liveCard))
      );
    } else {
      // Regular damage step: only double strike OR no first strike
      // First-strike-only creatures are excluded (they already dealt damage;
      // the first-strike step sets hasFirstStrike on every attacker that
      // dealt damage in it). Double strikers that survived deal again.
      return !attacker.hasFirstStrike || doubleStrike;
    }
  });

  // Process each attacker that should deal damage this step
  for (const attacker of attackersDealingDamage) {
    const attackerCard = updatedState.cards.get(attacker.cardId);
    if (!attackerCard) continue;

    const attackerPower = getEffectivePower(attackerCard, layerSystem);
    // CR 702.3 — trample detection. Issue #2326: defer to the strict
    // parsed-keywords helper `evergreen-keywords.hasTrample`, which
    // consults the parsed `keywords` array first and only falls back to
    // the substring `oracle_text` for cards missing the keyword tag.
    // Replaces the prior inline substring fallback (false-positive on
    // flavor / grant-effect mentions of the word "trample").
    const attackerHasTrample = hasTrample(attackerCard);

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
        if (defender && damage > 0) {
          combatDamageToPlayerSources.add(attacker.cardId);
        }
        if (defender) {
          // Check for lifelink on attacker (CR 702.15).
          // Issue #2332: defer to canonical `hasLifelink` (now strict-first,
          // then substring fallback) so flavor-word "lifelink" mentions in
          // oracle text do not false-positive a real lifelink grant.
          const attackerHasLifelink = hasLifelink(attackerCard);

          // Check if attacker is a commander
          const isAttackerCommander = isCommander(attackerCard);

          // Check for infect (CR 702.90) and toxic (CR 702.95)
          const attackerHasInfect = hasInfect(attackerCard);
          const attackerToxicLevel = getToxicLevel(attackerCard);

          // Apply damage to player
          // CR 702.90b (Infect): damage this deals to a player is dealt as that
          // many poison counters instead of as life loss
          // CR 702.95 (Toxic): player also gets poison counters equal to the
          // toxic level, IN ADDITION to the damage
          if (attackerHasInfect) {
            // Infect converts damage to poison - no life loss occurs (CR 702.90b)
            let updatedDefender = {
              ...defender,
              poisonCounters: defender.poisonCounters + damage,
            };

            // If creature also has toxic, add toxic poison as well (CR 702.95)
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

            // Toxic gives additional poison counters per CR 702.95
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

          if (
            attackerHasLifelink &&
            !scriptRuleActive(updatedState, "players_cant_gain_life")
          ) {
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
      // CR 702.90c: damage this deals to creatures is dealt as -1/-1 counters
      // instead of being marked on them. Handled inside `dealDamageToCard`
      // (issue #2351) so the replacement/prevention pipeline runs first.
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
        const blockerHasLifelink = hasLifelink(blockerCard);

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

        // CR 702.90c: when the attacker has infect, this call places -1/-1
        // counters on the blocker instead of marking damage. Issue #2351 moved
        // that conversion into `dealDamageToCard` so it also applies to
        // non-combat damage (CR 702.90e) and so protection / replacement
        // effects get to run first. This branch stays a thin caller.
        const damageResult = dealDamageToCard(
          updatedState,
          blocker.cardId,
          damage,
          true,
          attacker.cardId,
        );
        updatedState = damageResult.state;

        // Check for lifelink on blocker (CR 702.15). Independent of whether the
        // damage became counters — lifelink keys off the damage the blocker
        // *assigns* in the assignment step, and infect on the *attacker* does
        // not change what the blocker is lifelinked for.
        if (
          blockerHasLifelink &&
          !scriptRuleActive(updatedState, "players_cant_gain_life")
        ) {
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
          attackerHasInfect
            ? `${attackerCard.cardData.name} deals ${damage} infect damage (${damage} -1/-1 counters) to ${blockerCard.cardData.name}`
            : `${attackerCard.cardData.name} deals ${damage} to ${blockerCard.cardData.name}`,
        );

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
            combatDamageToPlayerSources.add(attacker.cardId);
            // Check for infect on the attacker for trample excess
            const attackerHasInfect = hasInfect(attackerCard);

            if (attackerHasInfect) {
              // Excess trample damage from an infect source becomes poison
              // counters (CR 702.90b). Issue #2351: toxic used to be omitted
              // here while the *unblocked* path stacked both, so a creature with
              // infect + toxic N + trample gave fewer poison counters when it
              // was blocked than when it was not. Ruling: "Creatures that have
              // both infect and Toxic can add poison counters from both
              // abilities." (CR 702.95 for the toxic half.)
              const infectToxicLevel = getToxicLevel(attackerCard);
              const updatedDefender = {
                ...defender,
                poisonCounters:
                  defender.poisonCounters + remainingDamage + infectToxicLevel,
              };
              updatedState = {
                ...updatedState,
                players: new Map(updatedState.players).set(
                  attacker.defenderId as PlayerId,
                  updatedDefender,
                ),
              };
              damageEvents.push(
                infectToxicLevel > 0
                  ? `${attackerCard.cardData.name} tramples ${remainingDamage} poison to ${defender.name} and ${infectToxicLevel} toxic poison`
                  : `${attackerCard.cardData.name} tramples ${remainingDamage} poison to ${defender.name}`,
              );
            } else {
              let updatedDefender = {
                ...defender,
                life: Math.max(0, defender.life - remainingDamage),
              };
              // CR 702.95 (Toxic): any combat damage to a player from a toxic
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

        // Check if this blocker should deal damage in the current step.
        // CR 702.7 / CR 702.4 — blocker first strike / double strike
        // detection. Issue #2326: defer to the strict parsed-keywords
        // helpers `evergreen-keywords.hasFirstStrike` /
        // `hasDoubleStrike`. The `blocker.hasFirstStrike` /
        // `blocker.hasDoubleStrike` shape flags (set at block declaration
        // time, see `declaration.ts`) are still consulted so a blocker
        // whose keyword was granted by a continuous effect after
        // declaration is correctly identified via the strict check on
        // the current `blockerCard` (which carries the granted keyword
        // post-layer).
        const blockerHasFirstStrike =
          blocker.hasFirstStrike || hasFirstStrike(blockerCard);
        const blockerHasDoubleStrike =
          blocker.hasDoubleStrike || hasDoubleStrike(blockerCard);

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

        // CR 702.90c: a blocker with infect places -1/-1 counters on the
        // attacker instead of marking damage. Issue #2351: the conversion lives
        // in `dealDamageToCard`, which also handles the deathtouch interaction
        // (a deathtouch blocker with infect must NOT mark lethal damage on top
        // of the counters — 702.90c says the damage "isn't marked").
        const blockerHasInfect = hasInfect(blockerCard);
        const damageResult = dealDamageToCard(
          updatedState,
          attacker.cardId,
          blockerPower,
          true,
          blocker.cardId,
        );
        updatedState = damageResult.state;
        damageEvents.push(
          blockerHasInfect
            ? `${blockerCard.cardData.name} deals ${blockerPower} infect damage (${blockerPower} -1/-1 counters) to ${attackerCard.cardData.name}`
            : `${blockerCard.cardData.name} deals ${blockerPower} to ${attackerCard.cardData.name}`,
        );
      }
    }
  }

  // After all combat damage is dealt, check state-based actions
  // This handles creatures with lethal damage dying, players losing, etc.
  // CR 603.10a: detect combat-damage triggers before state-based actions so
  // a source that died from the same damage still "looks back" and triggers.
  const combatDamageTriggers: TriggeredAbilityInstance[] = [];
  for (const sourceCardId of combatDamageToPlayerSources) {
    combatDamageTriggers.push(
      ...detectTriggeredAbilities(updatedState, "dealsCombatDamageToPlayer", {
        sourceCardId,
      }),
    );
  }

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
      // Keep attackers for second pass. An attacker that dealt first-strike
      // damage is marked so it sits out the regular step unless it has
      // double strike (CR 702.7c: losing or gaining first strike after this
      // step doesn't change that).
      attackers: state.combat.attackers.map((a) =>
        !a.hasFirstStrike &&
        attackersDealingDamage.some((d) => d.cardId === a.cardId)
          ? { ...a, hasFirstStrike: true }
          : a,
      ),
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

  let finalState: GameState = {
    ...updatedState,
    combat: clearedCombat,
    lastModifiedAt: Date.now(),
  };
  if (combatDamageTriggers.length > 0) {
    finalState = putTriggersOnStack(finalState, combatDamageTriggers).state;
  }

  return {
    success: true,
    state: finalState,
    description: `Combat resolved: ${damageEvents.join(", ")}`,
  };
}

/**
 * Get all available attackers for a player
 * Returns creatures that could attack if a defender were specified
 */
