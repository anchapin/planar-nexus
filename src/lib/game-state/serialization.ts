/**
 * @fileoverview GameState Serialization and Conversion
 *
 * This module provides conversion functions between Engine GameState format
 * and AI GameState format. It enables the AI to work with real game state
 * while maintaining the engine's detailed internal representation.
 *
 * Key functions:
 * - engineToAIState: Convert Engine GameState to AI format
 * - aiToEngineState: Convert AI format back to Engine format (for action results)
 * - engineToUnified: Alias for engineToAIState
 * - unifiedToEngine: Alias for aiToEngineState
 */

import {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
  Player,
  CardInstance,
  Zone,
  StackObject,
  Phase,
  AIGameState,
  AIPlayerState,
  AIPermanent,
  AIHandCard,
  AITurnInfo,
  AIStackObject,
  AICombatState,
} from './types';
import { PHASE_MAPPING } from './types';

/**
 * Helper: Get card color identity from card data
 */
function getCardColors(cardData: CardInstance['cardData']): string[] {
  const colors: string[] = [];
  const colorMap: Record<string, string> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
  };

  if (cardData.mana_cost) {
    for (const [symbol, color] of Object.entries(colorMap)) {
      if (cardData.mana_cost.includes(`{${symbol}}`)) {
        colors.push(color);
      }
    }
  }

  // Also check color_identity if available
  if (cardData.color_identity) {
    for (const symbol of cardData.color_identity) {
      const color = colorMap[symbol];
      if (color && !colors.includes(color)) {
        colors.push(color);
      }
    }
  }

  return colors;
}

/**
 * Helper: Determine permanent type from card type line
 */
function getPermanentType(typeLine: string): AIPermanent['type'] {
  const lowerType = typeLine.toLowerCase();

  if (lowerType.includes('creature')) return 'creature';
  if (lowerType.includes('land')) return 'land';
  if (lowerType.includes('planeswalker')) return 'planeswalker';
  if (lowerType.includes('artifact')) return 'artifact';
  if (lowerType.includes('enchantment')) return 'enchantment';
  return 'other';
}

/**
 * Helper: Get step name from phase
 */
function getStepFromPhase(phase: Phase): string {
  const stepMap: Record<Phase, string> = {
    [Phase.UNTAP]: 'untap',
    [Phase.UPKEEP]: 'upkeep',
    [Phase.DRAW]: 'draw',
    [Phase.PRECOMBAT_MAIN]: 'main',
    [Phase.BEGIN_COMBAT]: 'begin_combat',
    [Phase.DECLARE_ATTACKERS]: 'declare_attackers',
    [Phase.DECLARE_BLOCKERS]: 'declare_blockers',
    [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: 'first_strike_damage',
    [Phase.COMBAT_DAMAGE]: 'combat_damage',
    [Phase.END_COMBAT]: 'end_combat',
    [Phase.POSTCOMBAT_MAIN]: 'main',
    [Phase.END]: 'end',
    [Phase.CLEANUP]: 'cleanup',
  };
  return stepMap[phase];
}

/**
 * Convert Engine Player to AI PlayerState
 */
function convertPlayerToAI(
  enginePlayer: Player,
  engineState: EngineGameState
): AIPlayerState {
  // Get player's zones
  const handZone = engineState.zones.get(`${enginePlayer.id}-hand`);
  const battlefieldZone = engineState.zones.get(`${enginePlayer.id}-battlefield`);
  const graveyardZone = engineState.zones.get(`${enginePlayer.id}-graveyard`);
  const exileZone = engineState.zones.get(`${enginePlayer.id}-exile`);
  const libraryZone = engineState.zones.get(`${enginePlayer.id}-library`);

  // Convert hand cards
  const hand: AIHandCard[] = [];
  if (handZone) {
    for (const cardId of handZone.cardIds) {
      const card = engineState.cards.get(cardId);
      if (card) {
        hand.push({
          cardInstanceId: card.id,
          name: card.cardData.name,
          type: card.cardData.type_line,
          manaValue: card.cardData.cmc,
          colors: getCardColors(card.cardData),
          oracleText: card.cardData.oracle_text,
          keywords: card.cardData.keywords,
        });
      }
    }
  }

  // Convert battlefield permanents
  const battlefield: AIPermanent[] = [];
  if (battlefieldZone) {
    for (const cardId of battlefieldZone.cardIds) {
      const card = engineState.cards.get(cardId);
      if (card && card.controllerId === enginePlayer.id) {
        battlefield.push({
          id: card.id,
          cardInstanceId: card.id,
          name: card.cardData.name,
          type: getPermanentType(card.cardData.type_line),
          controller: card.controllerId,
          tapped: card.isTapped,
          power: card.cardData.power ? parseInt(card.cardData.power) : undefined,
          toughness: card.cardData.toughness ? parseInt(card.cardData.toughness) : undefined,
          loyalty: card.cardData.loyalty ? parseInt(card.cardData.loyalty) : undefined,
          counters: card.counters?.reduce((acc, counter) => {
            acc[counter.type] = counter.count;
            return acc;
          }, {} as { [key: string]: number }),
          keywords: card.cardData.keywords,
          manaValue: card.cardData.cmc,
          summoningSickness: card.hasSummoningSickness,
          damage: card.damage > 0 ? card.damage : undefined,
        });
      }
    }
  }

  // Convert graveyard
  const graveyard: string[] = [];
  if (graveyardZone) {
    graveyard.push(...graveyardZone.cardIds);
  }

  // Convert exile
  const exile: string[] = [];
  if (exileZone) {
    exile.push(...exileZone.cardIds);
  }

  // Convert library count
  const library = libraryZone ? libraryZone.cardIds.length : 0;

  // Convert mana pool
  const manaPool: { [color: string]: number } = {
    colorless: enginePlayer.manaPool.colorless,
    white: enginePlayer.manaPool.white,
    blue: enginePlayer.manaPool.blue,
    black: enginePlayer.manaPool.black,
    red: enginePlayer.manaPool.red,
    green: enginePlayer.manaPool.green,
    generic: enginePlayer.manaPool.generic,
  };

  // Convert commander damage Map to object
  const commanderDamage: { [playerId: string]: number } = {};
  enginePlayer.commanderDamage.forEach((damage, playerId) => {
    commanderDamage[playerId] = damage;
  });

  return {
    id: enginePlayer.id,
    name: enginePlayer.name,
    life: enginePlayer.life,
    poisonCounters: enginePlayer.poisonCounters,
    commanderDamage,
    hand,
    graveyard,
    exile,
    library,
    battlefield,
    manaPool,
    landsPlayedThisTurn: enginePlayer.landsPlayedThisTurn,
    hasPassedPriority: enginePlayer.hasPassedPriority,
  };
}

/**
 * Convert Engine StackObject to AIStackObject
 */
function convertStackObjectToAI(
  engineStack: StackObject[],
  engineState: EngineGameState
): AIStackObject[] {
  return engineStack.map((stackObj) => {
    let cardInstanceId = '';
    let manaValue = 0;
    let colors: string[] | undefined;
    let name = stackObj.name;

    // Try to get card data from source
    if (stackObj.sourceCardId) {
      const card = engineState.cards.get(stackObj.sourceCardId);
      if (card) {
        cardInstanceId = card.id;
        manaValue = card.cardData.cmc;
        colors = getCardColors(card.cardData);
        name = card.cardData.name;
      }
    }

    // Convert targets to target IDs
    const targetIds = stackObj.targets?.map((t) => t.targetId);

    return {
      id: stackObj.id,
      cardInstanceId,
      controller: stackObj.controllerId,
      type: stackObj.type,
      targets: targetIds,
      name,
      manaValue,
      colors,
    };
  });
}

/**
 * Convert Engine Combat to AICombatState
 */
function convertCombatToAI(
  engineCombat: EngineGameState['combat']
): AICombatState {
  // Convert attackers
  const attackers = engineCombat.attackers.map((attacker) => ({
    cardInstanceId: attacker.cardId,
    defenderId: attacker.defenderId,
    isAttackingPlaneswalker: attacker.isAttackingPlaneswalker,
    damageToDeal: attacker.damageToDeal,
    hasFirstStrike: attacker.hasFirstStrike,
    hasDoubleStrike: attacker.hasDoubleStrike,
  }));

  // Convert blockers from Map to object
  const blockers: { [attackerId: string]: {
    cardInstanceId: string;
    attackerId: string;
    damageToDeal: number;
    blockerOrder: number;
    hasFirstStrike: boolean;
    hasDoubleStrike: boolean;
  }[] } = {};
  engineCombat.blockers.forEach((blockerList, attackerId) => {
    blockers[attackerId] = blockerList.map((blocker) => ({
      cardInstanceId: blocker.cardId,
      attackerId: blocker.attackerId,
      damageToDeal: blocker.damageToDeal,
      blockerOrder: blocker.blockerOrder,
      hasFirstStrike: blocker.hasFirstStrike,
      hasDoubleStrike: blocker.hasDoubleStrike,
    }));
  });

  return {
    inCombatPhase: engineCombat.inCombatPhase,
    attackers,
    blockers,
  };
}

/**
 * Convert Engine GameState to AI GameState format
 * This is the main conversion function used by AI modules
 */
export function engineToAIState(engineState: EngineGameState): AIGameState {
  // Convert all players
  const players: { [playerId: string]: AIPlayerState } = {};
  engineState.players.forEach((player, playerId) => {
    players[playerId] = convertPlayerToAI(player, engineState);
  });

  // Convert turn info
  const turnInfo: AITurnInfo = {
    currentTurn: engineState.turn.turnNumber,
    currentPlayer: engineState.turn.activePlayerId,
    phase: PHASE_MAPPING[engineState.turn.currentPhase],
    step: getStepFromPhase(engineState.turn.currentPhase),
    priority: engineState.priorityPlayerId || engineState.turn.activePlayerId,
  };

  // Convert stack
  const stack = convertStackObjectToAI(engineState.stack, engineState);

  // Convert combat
  const combat = convertCombatToAI(engineState.combat);

  return {
    players,
    turnInfo,
    stack,
    combat,
  };
}

/**
 * Alias for engineToAIState - converts Engine to Unified format
 */
export function engineToUnified(engineState: EngineGameState): AIGameState {
  return engineToAIState(engineState);
}

/**
 * Convert AI PlayerState back to Engine Player
 * Note: This is used when AI actions need to be validated against engine state
 * The baseEngineState is used as the source of truth for detailed data
 */
function convertAIPlayerToEngine(
  aiPlayer: AIPlayerState,
  baseEnginePlayer: Player
): Partial<Player> {
  return {
    life: aiPlayer.life,
    poisonCounters: aiPlayer.poisonCounters,
    landsPlayedThisTurn: aiPlayer.landsPlayedThisTurn,
    hasPassedPriority: aiPlayer.hasPassedPriority,
    // Mana pool conversion
    manaPool: {
      colorless: aiPlayer.manaPool.colorless || 0,
      white: aiPlayer.manaPool.white || 0,
      blue: aiPlayer.manaPool.blue || 0,
      black: aiPlayer.manaPool.black || 0,
      red: aiPlayer.manaPool.red || 0,
      green: aiPlayer.manaPool.green || 0,
      generic: aiPlayer.manaPool.generic || 0,
    },
  };
}

/**
 * Convert AI GameState back to Engine GameState
 * This is primarily used for validation - the engine state is the source of truth
 * AI actions are applied to the engine state, not converted back
 */
export function aiToEngineState(
  aiState: AIGameState,
  baseEngineState: EngineGameState
): EngineGameState {
  // Update players with AI state data
  const updatedPlayers = new Map(baseEngineState.players);
  for (const [playerId, aiPlayer] of Object.entries(aiState.players)) {
    const basePlayer = baseEngineState.players.get(playerId);
    if (basePlayer) {
      const updates = convertAIPlayerToEngine(aiPlayer, basePlayer);
      updatedPlayers.set(playerId, { ...basePlayer, ...updates });
    }
  }

  return {
    ...baseEngineState,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Alias for aiToEngineState - converts Unified to Engine format
 */
export function unifiedToEngine(
  aiState: AIGameState,
  baseEngineState: EngineGameState
): EngineGameState {
  return aiToEngineState(aiState, baseEngineState);
}

/**
 * Get a simplified view of a specific player's state for AI
 * This is useful when the AI only needs to evaluate from one player's perspective
 */
export function getAIPlayerView(
  engineState: EngineGameState,
  playerId: PlayerId
): {
  playerState: AIPlayerState;
  turnInfo: AITurnInfo;
  stack: AIStackObject[];
  combat: AICombatState | undefined;
} {
  const aiState = engineToAIState(engineState);
  return {
    playerState: aiState.players[playerId],
    turnInfo: aiState.turnInfo,
    stack: aiState.stack,
    combat: aiState.combat,
  };
}

/**
 * Compare two AI GameState objects and return differences
 * Useful for debugging and testing
 */
export function compareAIStates(state1: AIGameState, state2: AIGameState): {
  lifeDifferences: { playerId: string; state1: number; state2: number }[];
  battlefieldDifferences: { playerId: string; state1: number; state2: number }[];
  handDifferences: { playerId: string; state1: number; state2: number }[];
  phaseChanged: boolean;
  stackChanged: boolean;
  combatChanged: boolean;
} {
  const lifeDifferences: { playerId: string; state1: number; state2: number }[] = [];
  const battlefieldDifferences: { playerId: string; state1: number; state2: number }[] = [];
  const handDifferences: { playerId: string; state1: number; state2: number }[] = [];

  for (const playerId of Object.keys(state1.players)) {
    const p1 = state1.players[playerId];
    const p2 = state2.players[playerId];

    if (!p2) continue;

    if (p1.life !== p2.life) {
      lifeDifferences.push({ playerId, state1: p1.life, state2: p2.life });
    }
    if (p1.battlefield.length !== p2.battlefield.length) {
      battlefieldDifferences.push({
        playerId,
        state1: p1.battlefield.length,
        state2: p2.battlefield.length,
      });
    }
    if (p1.hand.length !== p2.hand.length) {
      handDifferences.push({
        playerId,
        state1: p1.hand.length,
        state2: p2.hand.length,
      });
    }
  }

  return {
    lifeDifferences,
    battlefieldDifferences,
    handDifferences,
    phaseChanged: state1.turnInfo.phase !== state2.turnInfo.phase,
    stackChanged: state1.stack.length !== state2.stack.length,
    combatChanged: JSON.stringify(state1.combat) !== JSON.stringify(state2.combat),
  };
}

// ============================================================================
// Backward Compatibility Exports
// ============================================================================
// These exports maintain compatibility with existing code that uses the old
// serialization function names.
// ============================================================================

/**
 * Serialized game state format for storage/transmission
 * @deprecated Use AIGameState instead
 */
export type SerializedGameState = AIGameState;

/**
 * Serialize game state for storage/transmission
 * @deprecated Use engineToAIState instead
 */
export function serializeGameState(engineState: EngineGameState): SerializedGameState {
  return engineToAIState(engineState);
}

/**
 * Deserialize game state from storage/transmission
 * @deprecated Use aiToEngineState instead
 */
export function deserializeGameState(
  serializedState: SerializedGameState,
  baseEngineState: EngineGameState
): EngineGameState {
  return aiToEngineState(serializedState, baseEngineState);
}
