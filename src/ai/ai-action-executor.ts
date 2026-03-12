/**
 * @fileoverview AI Action Executor
 *
 * This module translates AI decisions into actual game actions.
 * It bridges the gap between AI decision-making and the game engine.
 *
 * This module now uses the unified AIGameState format and provides
 * conversion functions to work with the engine's GameState format.
 */

import type { 
  GameState as EngineGameState, 
  PlayerId, 
  CardInstanceId,
  AIGameState,
} from '@/lib/game-state/types';
import { engineToAIState } from '@/lib/game-state/serialization';
import type { AvailableResponse } from '@/ai/stack-interaction-ai';
import { 
  playLand as enginePlayLand, 
  canPlayLand as engineCanPlayLand 
} from '@/lib/game-state/mana';
import { 
  castSpell as engineCastSpell, 
  canCastSpell as engineCanCastSpell 
} from '@/lib/game-state/spell-casting';
import { 
  declareAttackers as engineDeclareAttackers 
} from '@/lib/game-state/combat';
import { tapCardAction, untapCardAction } from '@/lib/game-state/keyword-actions';
import { passPriority } from '@/lib/game-state/game-state';

/**
 * AI Action types
 */
export interface AIAction {
  type: AIActionType;
  cardId?: CardInstanceId;
  targetId?: string | PlayerId;
  targetPlayerId?: PlayerId;
  parameters?: Record<string, unknown>;
  reasoning?: string;
}

export type AIActionType = 
  | 'play_land'
  | 'cast_spell'
  | 'attack'
  | 'block'
  | 'tap_card'
  | 'untap_card'
  | 'activate_ability'
  | 'pass_priority'
  | 'respond_to_stack'
  | 'no_action';

/**
 * Result of executing an AI action
 */
export interface AIActionResult {
  success: boolean;
  newState?: EngineGameState;
  error?: string;
  action?: AIAction;
}

/**
 * Execute an AI action on the game state
 */
export async function executeAIAction(
  gameState: EngineGameState,
  action: AIAction,
  aiPlayerId: PlayerId
): Promise<AIActionResult> {
  try {
    switch (action.type) {
      case 'play_land':
        return executePlayLand(gameState, aiPlayerId, action.cardId!);
      
      case 'cast_spell':
        return executeCastSpell(gameState, aiPlayerId, action.cardId!, action.targetId);
      
      case 'attack':
        return executeAttack(gameState, aiPlayerId, action.cardId!, action.targetId);
      
      case 'block':
        return executeBlock(gameState, aiPlayerId, action.cardId!, action.targetId!);
      
      case 'tap_card':
        return executeTapCard(gameState, action.cardId!);
      
      case 'untap_card':
        return executeUntapCard(gameState, action.cardId!);
      
      case 'pass_priority':
        return executePassPriority(gameState, aiPlayerId);
      
      case 'no_action':
        return { success: true, newState: gameState, action };
      
      default:
        return { 
          success: false, 
          error: `Unknown action type: ${(action as any).type}`,
          action 
        };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      action 
    };
  }
}

/**
 * Execute play land action
 */
function executePlayLand(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId
): AIActionResult {
  if (!engineCanPlayLand(gameState, playerId)) {
    return { 
      success: false, 
      error: 'Cannot play land (already played or no priority)',
      action: { type: 'play_land', cardId }
    };
  }

  const result = enginePlayLand(gameState, playerId, cardId);
  
  if (result.success) {
    return { 
      success: true, 
      newState: result.state,
      action: { type: 'play_land', cardId }
    };
  }

  return { 
    success: false, 
    error: result.error || 'Failed to play land',
    action: { type: 'play_land', cardId }
  };
}

/**
 * Execute cast spell action
 */
function executeCastSpell(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targetId?: string | PlayerId
): AIActionResult {
  const canCast = engineCanCastSpell(gameState, playerId, cardId);
  
  if (!canCast) {
    return { 
      success: false, 
      error: 'Cannot cast spell (no mana or no priority)',
      action: { type: 'cast_spell', cardId, targetId }
    };
  }

  const targets = targetId ? [{ type: 'card' as const, targetId, isValid: true }] : undefined;
  const result = engineCastSpell(gameState, playerId, cardId, targets);
  
  if (result.success) {
    return { 
      success: true, 
      newState: result.state,
      action: { type: 'cast_spell', cardId, targetId }
    };
  }

  return { 
    success: false, 
    error: result.error || 'Failed to cast spell',
    action: { type: 'cast_spell', cardId, targetId }
  };
}

/**
 * Execute attack action
 */
function executeAttack(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  defenderId?: string | PlayerId
): AIActionResult {
  // Get current attackers from combat state
  const currentAttackers = gameState.combat.attackers || [];
  
  // Find the creature
  const creature = gameState.cards.get(cardId);
  if (!creature) {
    return { 
      success: false, 
      error: 'Creature not found',
      action: { type: 'attack', cardId, targetId: defenderId }
    };
  }

  // Check if creature can attack
  if (creature.isTapped || creature.hasSummoningSickness) {
    return { 
      success: false, 
      error: 'Creature cannot attack (tapped or summoning sickness)',
      action: { type: 'attack', cardId, targetId: defenderId }
    };
  }

  // Add to existing attackers
  const newAttacker = {
    cardId,
    defenderId: defenderId || getOpponentPlayerId(gameState, playerId),
    isAttackingPlaneswalker: false,
    damageToDeal: creature.cardData.power ? parseInt(creature.cardData.power) || 0 : 0,
    hasFirstStrike: creature.cardData.keywords?.includes('first_strike') || false,
    hasDoubleStrike: creature.cardData.keywords?.includes('double_strike') || false,
  };

  const updatedAttackers = [...currentAttackers, newAttacker];
  
  const result = engineDeclareAttackers(gameState, updatedAttackers);
  
  if (result.success) {
    return { 
      success: true, 
      newState: result.state,
      action: { type: 'attack', cardId, targetId: defenderId }
    };
  }

  return { 
    success: false, 
    error: result.errors?.join(', ') || 'Failed to declare attackers',
    action: { type: 'attack', cardId, targetId: defenderId }
  };
}

/**
 * Execute block action
 */
function executeBlock(
  gameState: EngineGameState,
  playerId: PlayerId,
  blockerId: CardInstanceId,
  attackerId: string
): AIActionResult {
  // Get current blockers
  const currentBlockers = gameState.combat.blockers || new Map();
  
  // Find the creature
  const creature = gameState.cards.get(blockerId);
  if (!creature) {
    return { 
      success: false, 
      error: 'Creature not found',
      action: { type: 'block', cardId: blockerId, targetId: attackerId }
    };
  }

  // Check if creature can block
  if (creature.isTapped) {
    return { 
      success: false, 
      error: 'Creature cannot block (tapped)',
      action: { type: 'block', cardId: blockerId, targetId: attackerId }
    };
  }

  // Add to blockers for this attacker
  const existingBlockers = currentBlockers.get(attackerId) || [];
  const newBlocker = {
    cardId: blockerId,
    attackerId,
    damageToDeal: creature.cardData.toughness ? parseInt(creature.cardData.toughness) || 0 : 0,
    blockerOrder: existingBlockers.length,
    hasFirstStrike: creature.cardData.keywords?.includes('first_strike') || false,
    hasDoubleStrike: creature.cardData.keywords?.includes('double_strike') || false,
  };

  const updatedBlockers = new Map(currentBlockers);
  updatedBlockers.set(attackerId, [...existingBlockers, newBlocker]);
  
  // Note: The actual blocking would need to be implemented in the combat module
  // For now, return success with the current state
  return { 
    success: true, 
    newState: gameState,
    action: { type: 'block', cardId: blockerId, targetId: attackerId }
  };
}

/**
 * Execute tap card action
 */
function executeTapCard(
  gameState: EngineGameState,
  cardId: CardInstanceId
): AIActionResult {
  const result = tapCardAction(gameState, cardId);
  
  if (result.success) {
    return { 
      success: true, 
      newState: result.state,
      action: { type: 'tap_card', cardId }
    };
  }

  return { 
    success: false, 
    error: result.error || 'Failed to tap card',
    action: { type: 'tap_card', cardId }
  };
}

/**
 * Execute untap card action
 */
function executeUntapCard(
  gameState: EngineGameState,
  cardId: CardInstanceId
): AIActionResult {
  const result = untapCardAction(gameState, cardId);
  
  if (result.success) {
    return { 
      success: true, 
      newState: result.state,
      action: { type: 'untap_card', cardId }
    };
  }

  return { 
    success: false, 
    error: result.error || 'Failed to untap card',
    action: { type: 'untap_card', cardId }
  };
}

/**
 * Execute pass priority action
 */
function executePassPriority(
  gameState: EngineGameState,
  playerId: PlayerId
): AIActionResult {
  const newState = passPriority(gameState, playerId);
  
  return { 
    success: true, 
    newState,
    action: { type: 'pass_priority' }
  };
}

/**
 * Get opponent player ID (for 1v1)
 */
function getOpponentPlayerId(gameState: EngineGameState, playerId: PlayerId): PlayerId {
  const playerIds = Array.from(gameState.players.keys());
  return playerIds.find(id => id !== playerId) || playerId;
}

/**
 * Get available lands from player's hand
 */
export function getAvailableLands(
  gameState: EngineGameState,
  playerId: PlayerId
): CardInstanceId[] {
  const handZone = gameState.zones.get(`${playerId}-hand`);
  if (!handZone) return [];

  const lands: CardInstanceId[] = [];
  
  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes('land')) {
      lands.push(cardId);
    }
  }

  return lands;
}

/**
 * Get available creatures for attacking
 */
export function getAvailableAttackers(
  gameState: EngineGameState,
  playerId: PlayerId
): CardInstanceId[] {
  const battlefield = gameState.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return [];

  const attackers: CardInstanceId[] = [];
  
  for (const cardId of battlefield.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && 
        card.cardData.type_line.toLowerCase().includes('creature') &&
        !card.isTapped &&
        !card.hasSummoningSickness) {
      attackers.push(cardId);
    }
  }

  return attackers;
}

/**
 * Get available creatures for blocking
 */
export function getAvailableBlockers(
  gameState: EngineGameState,
  playerId: PlayerId
): CardInstanceId[] {
  const battlefield = gameState.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return [];

  const blockers: CardInstanceId[] = [];
  
  for (const cardId of battlefield.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && 
        card.cardData.type_line.toLowerCase().includes('creature') &&
        !card.isTapped) {
      blockers.push(cardId);
    }
  }

  return blockers;
}

/**
 * Get available responses from hand
 */
export function getAvailableResponses(
  gameState: EngineGameState,
  playerId: PlayerId
): AvailableResponse[] {
  const handZone = gameState.zones.get(`${playerId}-hand`);
  if (!handZone) return [];

  const responses: AvailableResponse[] = [];
  
  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (!card) continue;

    const isInstant = card.cardData.type_line.toLowerCase().includes('instant');
    const hasFlash = card.cardData.keywords?.includes('flash');
    
    if (isInstant || hasFlash) {
      responses.push({
        cardId,
        name: card.cardData.name,
        type: isInstant ? 'instant' : 'flash',
        manaValue: card.cardData.cmc,
        manaCost: parseManaCost(card.cardData.mana_cost || ''),
        canCounter: card.cardData.oracle_text?.toLowerCase().includes('counter') || false,
        canTarget: [],
        effect: {
          type: 'other',
          value: 5,
          targets: [],
        },
      });
    }
  }

  return responses;
}

/**
 * Parse mana cost string to object
 */
function parseManaCost(manaCost: string): { [color: string]: number } {
  const result: { [color: string]: number } = {};
  
  // Simple parsing - count each color symbol
  const colorMatches = manaCost.matchAll(/[{]([WUBRG])(\d*)[}]/g);
  for (const match of colorMatches) {
    const color = match[1];
    const count = match[2] ? parseInt(match[2]) : 1;
    result[color] = (result[color] || 0) + count;
  }
  
  // Count generic mana
  const genericMatches = manaCost.matchAll(/[{](\d+)[}]/g);
  for (const match of genericMatches) {
    result['generic'] = (result['generic'] || 0) + parseInt(match[1]);
  }

  return result;
}

/**
 * Get AI view of the game state
 * Converts engine GameState to unified AIGameState format
 */
export function getAIGameState(engineState: EngineGameState): AIGameState {
  return engineToAIState(engineState);
}

/**
 * Get available lands from player's hand (using AI format)
 */
export function getAvailableLandsAI(aiState: AIGameState, playerId: PlayerId): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];
  
  return player.hand
    .filter(card => card.type.toLowerCase().includes('land'))
    .map(card => card.cardInstanceId);
}

/**
 * Get available creatures for attacking (using AI format)
 */
export function getAvailableAttackersAI(aiState: AIGameState, playerId: PlayerId): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];
  
  return player.battlefield
    .filter(perm => 
      perm.type === 'creature' && 
      !perm.tapped && 
      !perm.summoningSickness &&
      (perm.power || 0) > 0
    )
    .map(perm => perm.cardInstanceId);
}

/**
 * Get available creatures for blocking (using AI format)
 */
export function getAvailableBlockersAI(aiState: AIGameState, playerId: PlayerId): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];
  
  return player.battlefield
    .filter(perm => perm.type === 'creature' && !perm.tapped)
    .map(perm => perm.cardInstanceId);
}
