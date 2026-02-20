/**
 * Activated and Triggered Abilities System
 * 
 * This module implements the ability system for Magic: The Gathering,
 * including activated abilities, triggered abilities, and loyalty abilities.
 * 
 * Reference: CR 112 - Abilities, CR 113 - Abilities, CR 603 - Triggered Abilities
 * 
 * Issue #10: Phase 1.2: Implement activated and triggered abilities
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
} from './types';
import { Phase } from './types';
import { parseOracleText, ParsedActivatedAbility, ParsedTriggeredAbility } from './oracle-text-parser';
import { spendMana } from './mana';
import { destroyCard, discardCards } from './keyword-actions';

/**
 * Result of activating an ability
 */
export interface ActivateAbilityResult {
  success: boolean;
  state: GameState;
  description: string;
  error?: string;
}

/**
 * Result of a triggered ability check
 */
export interface TriggeredAbilityResult {
  abilities: TriggeredAbilityInstance[];
  state: GameState;
}

/**
 * An instance of a triggered ability on the stack
 */
export interface TriggeredAbilityInstance {
  id: string;
  sourceCardId: CardInstanceId;
  triggerCondition: string;
  effect: string;
  timestamp: number;
}

/**
 * Generate a unique ability ID
 */
function generateAbilityId(): string {
  return `ability-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique triggered ability ID
 */
function generateTriggeredAbilityId(): string {
  return `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a card has activated abilities
 */
export function hasActivatedAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  return card.oracle_text.includes(':');
}

// Card data interface for parsing - extends ScryfallCard with optional fields
import type { ScryfallCard } from '@/app/actions';

// Use ScryfallCard directly for parsing since parseOracleText requires it
type CardDataForParsing = ScryfallCard;

/**
 * Parse a card's activated abilities
 */
export function getActivatedAbilities(card: CardDataForParsing): ParsedActivatedAbility[] {
  if (!card.oracle_text) return [];
  return parseOracleText(card).activatedAbilities;
}

/**
 * Check if a card has triggered abilities
 */
export function hasTriggeredAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  const text = card.oracle_text.toLowerCase();
  return text.includes('when ') || text.includes('whenever ') || text.includes('at ');
}

/**
 * Parse a card's triggered abilities
 */
export function getTriggeredAbilities(card: CardDataForParsing): ParsedTriggeredAbility[] {
  if (!card.oracle_text) return [];
  return parseOracleText(card).triggeredAbilities;
}

/**
 * Check if an ability can be activated
 */
export function canActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: 'Card not found' };
  }

  // Check if player controls the card
  if (card.controllerId !== playerId) {
    return { canActivate: false, reason: 'You do not control this card' };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canActivate: false, reason: 'You do not have priority' };
  }

  // Check if card is on the battlefield
  const battlefieldZone = state.zones.get(`battlefield-${playerId}`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return { canActivate: false, reason: 'Card is not on the battlefield' };
  }

  // Check for summoning sickness (unless the ability has no tap cost)
  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];
  
  if (ability && !ability.costs.tap && card.hasSummoningSickness) {
    // Some abilities can be activated despite summoning sickness
    // This would need more sophisticated checking
  }

  // Check if ability is already being used this turn (for limits)
  // This would require tracking ability activations per card

  return { canActivate: true };
}

/**
 * Activate an ability of a card
 */
export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: { type: string; targetId: string }[] = []
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: 'Card not found',
    };
  }

  // Check if can activate
  const canActivate = canActivateAbility(state, playerId, cardId, abilityIndex);
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: '',
      error: canActivate.reason,
    };
  }

  // Get the ability from parsed Oracle text
  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: '',
      error: 'Ability not found',
    };
  }

  // Pay costs
  let currentState = state;

  // Tap the card if required
  if (ability.costs.tap) {
    const updatedCard = {
      ...card,
      isTapped: true,
    };
    const updatedCards = new Map(currentState.cards);
    updatedCards.set(cardId, updatedCard);
    currentState = {
      ...currentState,
      cards: updatedCards,
    };
  }

  // Pay mana cost
  if (ability.costs.mana) {
    const manaCost = ability.costs.mana;
    const manaPayment = {
      generic: manaCost.generic,
      white: manaCost.white,
      blue: manaCost.blue,
      black: manaCost.black,
      red: manaCost.red,
      green: manaCost.green,
    };
    const manaResult = spendMana(currentState, playerId, manaPayment);
    if (!manaResult.success) {
      return {
        success: false,
        state: currentState,
        description: '',
        error: 'Not enough mana',
      };
    }
    currentState = manaResult.state;
  }

  // Pay life cost
  if (ability.costs.payLife > 0) {
    const player = currentState.players.get(playerId);
    if (!player || player.life < ability.costs.payLife) {
      return {
        success: false,
        state: currentState,
        description: '',
        error: 'Not enough life',
      };
    }
    const updatedPlayer = {
      ...player,
      life: player.life - ability.costs.payLife,
    };
    const updatedPlayers = new Map(currentState.players);
    updatedPlayers.set(playerId, updatedPlayer);
    currentState = {
      ...currentState,
      players: updatedPlayers,
    };
  }

  // Handle sacrifice cost
  if (ability.costs.sacrifice) {
    // Move card to graveyard
    const result = destroyCard(currentState, cardId, true);
    if (result.success) {
      currentState = result.state;
    }
  }

  // Handle discard cost
  if (ability.costs.discard) {
    const result = discardCards(currentState, playerId, 1, false);
    if (result.success) {
      currentState = result.state;
    }
  }

  // Create stack object for the ability
  const stackZone = currentState.zones.get('stack');
  if (!stackZone) {
    return {
      success: false,
      state: currentState,
      description: '',
      error: 'Stack zone not found',
    };
  }

  // Move card to stack (for abilities that go on stack)
  const battlefieldZone = currentState.zones.get(`battlefield-${playerId}`);
  
  let cardMovedState = currentState;
  if (battlefieldZone && battlefieldZone.cardIds.includes(cardId)) {
    // Create stack object directly without moving the card
    const stackObject: StackObject = {
      id: generateAbilityId(),
      type: 'ability',
      sourceCardId: cardId,
      controllerId: playerId,
      name: `${card.cardData.name} ability`,
      text: ability.effect,
      manaCost: card.cardData.mana_cost ?? null,
      targets: targets.map(t => ({
        type: t.type as 'card' | 'player' | 'zone',
        targetId: t.targetId,
        isValid: true,
      })),
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
    };

    const updatedStack = [...cardMovedState.stack, stackObject];
    
    cardMovedState = {
      ...cardMovedState,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    };
  }

  // Find next player for priority (APNAP order)
  const playerIds = Array.from(cardMovedState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerIds.length;
  const nextPlayerId = playerIds[nextIndex];

  // Reset player's priority pass flag
  const updatedPlayers = new Map(cardMovedState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasPassedPriority: false,
    });
  }

  return {
    success: true,
    state: {
      ...cardMovedState,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Activated ${card.cardData.name}'s ability`,
  };
}

/**
 * Loyalty abilities for planeswalkers
 */
export interface LoyaltyAbility {
  cost: number; // Positive for adding, negative for removing
  effect: string;
}

/**
 * Get loyalty abilities for a planeswalker card
 */
export function getLoyaltyAbilities(card: { oracle_text?: string }): LoyaltyAbility[] {
  if (!card.oracle_text) return [];
  
  const abilities: LoyaltyAbility[] = [];
  const lines = card.oracle_text.split('\n');
  
  for (const line of lines) {
    // Match patterns like "+1: Draw a card" or "-3: Destroy target creature"
    const match = line.match(/^([+-]\d+):\s*(.+)/);
    if (match) {
      abilities.push({
        cost: parseInt(match[1], 10),
        effect: match[2],
      });
    }
  }
  
  return abilities;
}

/**
 * Check if a planeswalker can activate a loyalty ability
 */
export function canActivateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityCost: number
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: 'Card not found' };
  }

  // Check if card is a planeswalker
  const typeLine = card.cardData.type_line?.toLowerCase() || '';
  if (!typeLine.includes('planeswalker')) {
    return { canActivate: false, reason: 'Card is not a planeswalker' };
  }

  // Check if player controls the planeswalker
  if (card.controllerId !== playerId) {
    return { canActivate: false, reason: 'You do not control this planeswalker' };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canActivate: false, reason: 'You do not have priority' };
  }

  // Check if card is on the battlefield
  const battlefieldZone = state.zones.get(`battlefield-${playerId}`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return { canActivate: false, reason: 'Planeswalker is not on the battlefield' };
  }

  // Check if ability is being activated at a valid time
  const currentPhase = state.turn.currentPhase;
  if (currentPhase !== Phase.PRECOMBAT_MAIN && currentPhase !== Phase.POSTCOMBAT_MAIN) {
    return { canActivate: false, reason: 'Can only activate loyalty abilities during main phases' };
  }

  // Check if stack is empty
  if (state.stack.length > 0) {
    return { canActivate: false, reason: 'Stack must be empty to activate loyalty abilities' };
  }

  // Get current loyalty counter
  const loyaltyCounter = card.counters?.find(c => c.type === 'loyalty');
  const currentLoyalty = loyaltyCounter?.count || 0;

  // Check if player has enough loyalty
  if (abilityCost > 0 && currentLoyalty < abilityCost) {
    return { canActivate: false, reason: 'Not enough loyalty counters' };
  }

  return { canActivate: true };
}

/**
 * Activate a planeswalker loyalty ability
 */
export function activateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: 'Card not found',
    };
  }

  const abilities = getLoyaltyAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: '',
      error: 'Loyalty ability not found',
    };
  }

  // Check if can activate
  const canActivate = canActivateLoyaltyAbility(state, playerId, cardId, ability.cost);
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: '',
      error: canActivate.reason,
    };
  }

  let currentState = state;

  // Update loyalty counter
  const loyaltyCounter = card.counters?.find(c => c.type === 'loyalty');
  const currentLoyalty = loyaltyCounter?.count || 0;
  const newLoyalty = currentLoyalty + ability.cost;

  // Remove existing loyalty counter and add new one
  const updatedCounters = card.counters?.filter(c => c.type !== 'loyalty') || [];
  if (newLoyalty > 0) {
    updatedCounters.push({ type: 'loyalty', count: newLoyalty });
  }

  const updatedCard = {
    ...card,
    counters: updatedCounters,
  };

  const updatedCards = new Map(currentState.cards);
  updatedCards.set(cardId, updatedCard);
  currentState = {
    ...currentState,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };

  // Execute the effect based on ability.effect
  // This would parse the effect text and apply it
  const effectDescription = `Activated ${card.cardData.name} loyalty ability (${ability.cost >= 0 ? '+' : ''}${ability.cost}: ${ability.effect})`;

  // Pass priority after activating loyalty ability
  const playerIds = Array.from(currentState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerIds.length;

  return {
    success: true,
    state: currentState,
    description: effectDescription,
  };
}

/**
 * Check for triggered abilities
 * This should be called after any game event (e.g., card enters battlefield, damage is dealt)
 */
export function checkTriggeredAbilities(
  state: GameState,
  event: 'entersBattlefield' | 'leavesBattlefield' | 'damageDealt' | 'dies' | 'attacked' | 'phaseChange' | 'drawCard'
): TriggeredAbilityResult {
  const triggeredAbilities: TriggeredAbilityInstance[] = [];

  // Check each card on the battlefield for triggered abilities
  for (const [cardId, card] of state.cards) {
    // Skip if card is not on battlefield
    let isOnBattlefield = false;
    for (const [zoneKey, zone] of state.zones) {
      if (zoneKey.includes('battlefield') && zone.cardIds.includes(cardId)) {
        isOnBattlefield = true;
        break;
      }
    }
    if (!isOnBattlefield) continue;

    const abilities = getTriggeredAbilities(card.cardData);

    for (const ability of abilities) {
      let shouldTrigger = false;

      // Check if the trigger condition matches the event
      switch (event) {
        case 'entersBattlefield':
          shouldTrigger = ability.trigger.event === 'entersBattlefield';
          break;
        case 'leavesBattlefield':
          shouldTrigger = ability.trigger.event === 'leavesBattlefield' || ability.trigger.event === 'dies';
          break;
        case 'damageDealt':
          shouldTrigger = ability.trigger.event === 'damageDealt';
          break;
        case 'dies':
          shouldTrigger = ability.trigger.event === 'dies';
          break;
        case 'attacked':
          shouldTrigger = ability.trigger.event === 'attacked';
          break;
        case 'phaseChange':
          shouldTrigger = ability.trigger.event === 'phaseEnds' || ability.trigger.event === 'turnEnds' || 
                         ability.trigger.event === 'upkeep';
          break;
        case 'drawCard':
          shouldTrigger = ability.trigger.event === 'drawStep' || ability.trigger.event === 'lifeGain';
          break;
      }

      if (shouldTrigger) {
        triggeredAbilities.push({
          id: generateTriggeredAbilityId(),
          sourceCardId: cardId,
          triggerCondition: ability.trigger.event,
          effect: ability.effect,
          timestamp: Date.now(),
        });
      }
    }
  }

  // For now, triggered abilities go on the stack
  // In a full implementation, they would be queued and put on stack at the appropriate time
  let currentState = state;

  for (const trigger of triggeredAbilities) {
    const card = state.cards.get(trigger.sourceCardId);
    if (!card) continue;

    // Create stack object for the triggered ability
    const stackObject: StackObject = {
      id: trigger.id,
      type: 'ability',
      sourceCardId: trigger.sourceCardId,
      controllerId: card.controllerId,
      name: `${card.cardData.name} triggered ability`,
      text: trigger.effect,
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: trigger.timestamp,
    };

    const updatedStack = [...currentState.stack, stackObject];
    currentState = {
      ...currentState,
      stack: updatedStack,
    };
  }

  return {
    abilities: triggeredAbilities,
    state: currentState,
  };
}

/**
 * Check if a card can attack or block
 * Note: canAttack function is currently commented out pending implementation
 */
// export function canAttack(
//   state: GameState,
//   attackerId: CardInstanceId,
//   defenderId: PlayerId
// ): { canAttack: boolean; reason?: string } {
//   const card = state.cards.get(attackerId);
//   if (!card) {
//     return { canAttack: false, reason: 'Card not found' };
//   }
//   // ... (rest of implementation)
//   return { canAttack: true };
// }

/**
 * Check if a creature can block
 * Note: canBlock function is currently commented out pending implementation
 */
// export function canBlock(
//   state: GameState,
//   blockerId: CardInstanceId,
//   attackerId?: CardInstanceId
// ): { canBlock: boolean; reason?: string } {
//   const card = state.cards.get(blockerId);
//   if (!card) {
//     return { canBlock: false, reason: 'Card not found' };
//   }
//   // ... (rest of implementation)
//   return { canBlock: true };
// }
