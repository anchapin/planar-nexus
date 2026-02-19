/**
 * Combat System
 * Implements the MTG combat system for declaring attackers, blockers, and resolving combat damage.
 * Reference: Comprehensive Rules 506-510
 */

import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from './types';
import {
  createCardInstance,
  isCreature,
  getPower,
  getToughness,
  hasLethalDamage,
} from './card-instance';
import { dealDamageToCard, destroyCard } from './keyword-actions';
import { replacementEffectManager } from './replacement-effects';
import { checkStateBasedActions } from './state-based-actions';
import { dealCommanderDamage, isCommander } from './commander-damage';

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
  defenderId?: PlayerId | CardInstanceId
): { canAttack: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return { canAttack: false, reason: 'Card not found' };
  }

  // Must be a creature
  if (!isCreature(card)) {
    return { canAttack: false, reason: 'Only creatures can attack' };
  }

  // Must be on the battlefield
  const battlefieldZoneKey = `${card.controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  if (!battlefield || !battlefield.cardIds.includes(cardId)) {
    return { canAttack: false, reason: 'Card must be on the battlefield' };
  }

  // Must not be tapped (unless has vigilance)
  if (card.isTapped) {
    const hasVigilance = card.cardData.keywords?.includes('Vigilance') ||
      card.cardData.oracle_text?.toLowerCase().includes('vigilance');
    if (!hasVigilance) {
      return { canAttack: false, reason: 'Creature is tapped' };
    }
  }

  // Must not have summoning sickness (unless haste)
  if (card.hasSummoningSickness) {
    const hasHaste = card.cardData.keywords?.includes('Haste') ||
      card.cardData.oracle_text?.toLowerCase().includes('haste');
    if (!hasHaste) {
      return { canAttack: false, reason: 'Summoning sickness (haste not granted)' };
    }
  }

  // Must have a defender
  if (!defenderId) {
    return { canAttack: false, reason: 'No defender specified' };
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
  attackerId?: CardInstanceId
): { canBlock: boolean; reason?: string } {
  const blocker = state.cards.get(blockerId);
  
  if (!blocker) {
    return { canBlock: false, reason: 'Card not found' };
  }

  // Must be a creature
  if (!isCreature(blocker)) {
    return { canBlock: false, reason: 'Only creatures can block' };
  }

  // Must be on the battlefield
  const battlefieldZoneKey = `${blocker.controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  if (!battlefield || !battlefield.cardIds.includes(blockerId)) {
    return { canBlock: false, reason: 'Card must be on the battlefield' };
  }

  // Must not be tapped
  if (blocker.isTapped) {
    return { canBlock: false, reason: 'Creature is tapped' };
  }

  // If there's an attacker, check if it can be blocked (flying, reach, etc.)
  if (attackerId) {
    const attacker = state.cards.get(attackerId);
    if (attacker && isCreature(attacker)) {
      // Check flying
      const attackerHasFlying = attacker.cardData.keywords?.includes('Flying') ||
        attacker.cardData.oracle_text?.toLowerCase().includes('flying');
      const blockerHasFlying = blocker.cardData.keywords?.includes('Flying') ||
        blocker.cardData.oracle_text?.toLowerCase().includes('flying');
      const blockerHasReach = blocker.cardData.keywords?.includes('Reach') ||
        blocker.cardData.oracle_text?.toLowerCase().includes('reach');

      if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
        return { canBlock: false, reason: 'Cannot block flying creatures without flying or reach' };
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
  attackerIds: Array<{ cardId: CardInstanceId; defenderId: PlayerId | CardInstanceId }>
): CombatActionResult {
  const errors: string[] = [];
  const validAttackers: Array<{ cardId: CardInstanceId; defenderId: PlayerId | CardInstanceId }> = [];

  // Must be in combat phase
  const combatPhase = state.turn.currentPhase;
  const validCombatPhases = ['declare_attackers', 'begin_combat'];
  if (!validCombatPhases.includes(combatPhase)) {
    return {
      success: false,
      state,
      description: '',
      errors: ['Can only declare attackers during the declare attackers step'],
    };
  }

  // Check each attacker
  for (const attack of attackerIds) {
    const { canAttack: can, reason } = canAttack(state, attack.cardId, attack.defenderId);
    if (can) {
      validAttackers.push(attack);
    } else {
      errors.push(`${state.cards.get(attack.cardId)?.cardData.name || attack.cardId}: ${reason}`);
    }
  }

  // If no valid attackers, return error
  if (validAttackers.length === 0 && attackerIds.length > 0) {
    return {
      success: false,
      state,
      description: '',
      errors: ['No valid attackers declared'],
    };
  }

  // Create attacker objects
  const attackers: import('./types').Attacker[] = validAttackers.map((attack) => {
    const attackerCard = state.cards.get(attack.cardId);
    const hasFirstStrike = attackerCard ? (
      attackerCard.cardData.keywords?.includes('First Strike') ||
      attackerCard.cardData.oracle_text?.toLowerCase().includes('first strike')
    ) : false;
    const hasDoubleStrike = attackerCard ? (
      attackerCard.cardData.keywords?.includes('Double Strike') ||
      attackerCard.cardData.oracle_text?.toLowerCase().includes('double strike')
    ) : false;

    return {
      cardId: attack.cardId,
      defenderId: attack.defenderId,
      isAttackingPlaneswalker: typeof attack.defenderId === 'string' && attack.defenderId.startsWith('card-'),
      damageToDeal: attackerCard ? getPower(attackerCard) : 0,
      hasFirstStrike: hasFirstStrike || false,
      hasDoubleStrike: hasDoubleStrike || false,
    };
  });

  // Tap attacking creatures
  const updatedState = { ...state };
  const updatedCards = new Map(updatedState.cards);
  
  for (const attacker of attackers) {
    const card = updatedCards.get(attacker.cardId);
    if (card) {
      // Check for vigilance - if creature has vigilance, don't tap
      const hasVigilance = card.cardData.keywords?.includes('Vigilance') ||
        card.cardData.oracle_text?.toLowerCase().includes('vigilance');
      
      if (!hasVigilance) {
        updatedCards.set(attacker.cardId, { ...card, isTapped: true });
      }
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
    description: `Declared ${attackers.length} attacker${attackers.length !== 1 ? 's' : ''}`,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Declare blockers
 */
export function declareBlockers(
  state: GameState,
  blockerAssignments: Map<CardInstanceId, CardInstanceId[]>
): CombatActionResult {
  const errors: string[] = [];
  const validBlockers = new Map<CardInstanceId, CardInstanceId[]>();

  // Must be in combat phase with attackers declared
  if (!state.combat.inCombatPhase || state.combat.attackers.length === 0) {
    return {
      success: false,
      state,
      description: '',
      errors: ['No attackers declared'],
    };
  }

  // Check each blocker's assignment
  const allBlockerIds: CardInstanceId[] = [];
  for (const [attackerId, blockerIds] of blockerAssignments) {
    const validBlockerIds: CardInstanceId[] = [];
    
    for (const blockerId of blockerIds) {
      const { canBlock: can, reason } = canBlock(state, blockerId, attackerId);
      if (can) {
        validBlockerIds.push(blockerId);
        allBlockerIds.push(blockerId);
      } else {
        errors.push(`${state.cards.get(blockerId)?.cardData.name || blockerId}: ${reason}`);
      }
    }
    
    if (validBlockerIds.length > 0) {
      validBlockers.set(attackerId, validBlockerIds);
    }
  }

  // Create blocker objects with order
  const blockers = new Map<CardInstanceId, Array<{
    cardId: CardInstanceId;
    attackerId: CardInstanceId;
    damageToDeal: number;
    blockerOrder: number;
    hasFirstStrike: boolean;
    hasDoubleStrike: boolean;
  }>>();

  for (const [attackerId, blockerIds] of validBlockers) {
    const attacker = state.cards.get(attackerId);
    const attackerPower = attacker ? getPower(attacker) : 0;
    const attackerHasFirstStrike = attacker ? (
      attacker.cardData.keywords?.includes('First Strike') ||
      attacker.cardData.oracle_text?.toLowerCase().includes('first strike')
    ) : false;
    const attackerHasDoubleStrike = attacker ? (
      attacker.cardData.keywords?.includes('Double Strike') ||
      attacker.cardData.oracle_text?.toLowerCase().includes('double strike')
    ) : false;

    const blockerObjects: import('./types').Blocker[] = blockerIds.map((blockerId, index) => {
      const blocker = state.cards.get(blockerId);
      const blockerPower = blocker ? getPower(blocker) : 0;
      const blockerHasFirstStrike = blocker ? (
        blocker.cardData.keywords?.includes('First Strike') ||
        blocker.cardData.oracle_text?.toLowerCase().includes('first strike')
      ) : false;
      const blockerHasDoubleStrike = blocker ? (
        blocker.cardData.keywords?.includes('Double Strike') ||
        blocker.cardData.oracle_text?.toLowerCase().includes('double strike')
      ) : false;

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
    });

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
      description: 'No combat to resolve',
    };
  }

  let updatedState = { ...state };
  const damageEvents: string[] = [];

  // Process each attacker
  for (const attacker of state.combat.attackers) {
    const attackerCard = updatedState.cards.get(attacker.cardId);
    if (!attackerCard) continue;

    const attackerPower = getPower(attackerCard);
    const attackerHasTrample = attackerCard.cardData.keywords?.includes('Trample') ||
      attackerCard.cardData.oracle_text?.toLowerCase().includes('trample');

    const assignedBlockers = state.combat.blockers.get(attacker.cardId);

    // Check if attacker is blocked
    if (!assignedBlockers || assignedBlockers.length === 0) {
      // Unblocked - damage goes to defender
      if (attacker.isAttackingPlaneswalker) {
        // Damage to planeswalker would need planeswalker damage handling
        damageEvents.push(`${attackerCard.cardData.name} deals ${attackerPower} to planeswalker`);
      } else {
        // Damage to player
        const defender = updatedState.players.get(attacker.defenderId as PlayerId);
        if (defender) {
          // Check for lifelink on attacker
          const attackerHasLifelink = attackerCard.cardData.keywords?.includes('Lifelink') ||
            attackerCard.cardData.oracle_text?.toLowerCase().includes('lifelink');

          // Check if attacker is a commander
          const isAttackerCommander = isCommander(attackerCard);

          // Apply damage to player
          updatedState = {
            ...updatedState,
            players: new Map(updatedState.players).set(attacker.defenderId as PlayerId, {
              ...defender,
              life: Math.max(0, defender.life - attackerPower),
            }),
          };

          // Track commander damage if applicable
          if (isAttackerCommander) {
            const commanderDamageResult = dealCommanderDamage(
              updatedState,
              attacker.cardId,
              attacker.defenderId as PlayerId,
              attackerPower
            );
            if (commanderDamageResult.success) {
              updatedState = commanderDamageResult.state;
              if (commanderDamageResult.playerLost) {
                damageEvents.push(`${attackerCard.cardData.name} dealt lethal commander damage to ${defender.name}`);
              }
            }
          }

          if (attackerHasLifelink) {
            // Gain life equal to damage dealt
            const attackerController = updatedState.players.get(attackerCard.controllerId);
            if (attackerController) {
              updatedState = {
                ...updatedState,
                players: new Map(updatedState.players).set(attackerCard.controllerId!, {
                  ...attackerController,
                  life: attackerController.life + attackerPower,
                }),
              };
            }
            damageEvents.push(`${attackerCard.cardData.name} deals ${attackerPower} to ${defender.name} and controller gains ${attackerPower} life`);
          } else {
            damageEvents.push(`${attackerCard.cardData.name} deals ${attackerPower} to ${defender.name}`);
          }
        }
      }
    } else {
      // Blocked - damage is assigned to blockers
      let remainingDamage = attackerPower;

      // Sort blockers by order
      const sortedBlockers = [...assignedBlockers].sort((a, b) => a.blockerOrder - b.blockerOrder);

      for (const blocker of sortedBlockers) {
        if (remainingDamage <= 0) break;

        const blockerCard = updatedState.cards.get(blocker.cardId);
        if (!blockerCard) continue;

        const blockerToughness = getToughness(blockerCard);
        const blockerHasDeathtouch = blockerCard.cardData.keywords?.includes('Deathtouch') ||
          blockerCard.cardData.oracle_text?.toLowerCase().includes('deathtouch');
        const blockerHasLifelink = blockerCard.cardData.keywords?.includes('Lifelink') ||
          blockerCard.cardData.oracle_text?.toLowerCase().includes('lifelink');

        // Calculate damage to deal to this blocker
        let damage = Math.min(remainingDamage, blockerToughness);
        if (blockerHasDeathtouch && damage > 0) {
          damage = Math.max(damage, blockerToughness);
        }

        // Apply damage to blocker
        const damageResult = dealDamageToCard(
          updatedState,
          blocker.cardId,
          damage,
          true,
          attacker.cardId
        );
        updatedState = damageResult.state;

        // Check for lifelink on blocker
        if (blockerHasLifelink) {
          const blockerController = updatedState.players.get(blockerCard.controllerId);
          if (blockerController) {
            updatedState = {
              ...updatedState,
              players: new Map(updatedState.players).set(blockerCard.controllerId!, {
                ...blockerController,
                life: blockerController.life + damage,
              }),
            };
          }
        }

        remainingDamage -= damage;
        damageEvents.push(`${attackerCard.cardData.name} deals ${damage} to ${blockerCard.cardData.name}`);
      }

      // Handle trample excess damage
      if (remainingDamage > 0 && attackerHasTrample) {
        const defender = updatedState.players.get(attacker.defenderId as PlayerId);
        if (defender) {
          updatedState = {
            ...updatedState,
            players: new Map(updatedState.players).set(attacker.defenderId as PlayerId, {
              ...defender,
              life: Math.max(0, defender.life - remainingDamage),
            }),
          };
          damageEvents.push(`${attackerCard.cardData.name} tramples ${remainingDamage} to ${defender.name}`);
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

  // Clear combat state
  const clearedCombat = {
    ...updatedState.combat,
    inCombatPhase: false,
    attackers: [],
    blockers: new Map(),
  };

  return {
    success: true,
    state: {
      ...updatedState,
      combat: clearedCombat,
      lastModifiedAt: Date.now(),
    },
    description: `Combat resolved: ${damageEvents.join(', ')}`,
  };
}

/**
 * Get all available attackers for a player
 */
export function getAvailableAttackers(
  state: GameState,
  playerId: PlayerId
): CardInstanceId[] {
  const battlefieldZoneKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  
  if (!battlefield) return [];

  return battlefield.cardIds.filter((cardId) => {
    const { canAttack: can } = canAttack(state, cardId);
    return can;
  });
}

/**
 * Get all available blockers for a player
 */
export function getAvailableBlockers(
  state: GameState,
  playerId: PlayerId
): CardInstanceId[] {
  const battlefieldZoneKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  
  if (!battlefield) return [];

  return battlefield.cardIds.filter((cardId) => {
    const { canBlock: can } = canBlock(state, cardId);
    return can;
  });
}
