/**
 * @fileoverview AI Turn Loop
 *
 * This module manages the AI's complete turn, from untap to end phase.
 * It coordinates all AI decision-making and action execution.
 *
 * This module now uses the unified AIGameState format and provides
 * conversion functions to work with the engine's GameState format.
 */

import type { GameState as EngineGameState, PlayerId, CardInstanceId, AIGameState } from '@/lib/game-state/types';
import { Phase } from '@/lib/game-state/types';
import { executeAIAction, type AIAction, getAvailableAttackers, getAIGameState } from './ai-action-executor';
import { DIFFICULTY_CONFIGS, type DifficultyLevel } from './ai-difficulty';
import { advancePhase as engineAdvancePhase } from '@/lib/game-state/turn-phases';
import { drawCard as engineDrawCard } from '@/lib/game-state/game-state';
import { engineToAIState } from '@/lib/game-state/serialization';

/**
 * AI Turn configuration
 */
export interface AITurnConfig {
  difficulty: DifficultyLevel;
  delayMs: number; // Delay between actions for natural pacing
  skipPhases?: Phase[]; // Phases to skip (for testing)
  onCommentary?: (text: string) => void; // Callback for commentary generation
}

/**
 * AI Turn result
 */
export interface AITurnResult {
  success: boolean;
  actionsTaken: AIAction[];
  finalState?: EngineGameState;
  error?: string;
  phase?: string;
}

/**
 * Run AI's complete turn
 */
export async function runAITurn(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<AITurnResult> {
  const actionsTaken: AIAction[] = [];
  let currentState = gameState;
  
  try {
    // Phase 1: Untap
    const untapResult = await runUntapPhase(currentState, aiPlayerId, config);
    if (untapResult.success) {
      actionsTaken.push(...untapResult.actions);
      currentState = untapResult.newState || currentState;
    }

    // Phase 2: Upkeep
    const upkeepResult = await runUpkeepPhase(currentState, aiPlayerId, config);
    if (upkeepResult.success) {
      actionsTaken.push(...upkeepResult.actions);
      currentState = upkeepResult.newState || currentState;
    }

    // Phase 3: Draw
    const drawResult = await runDrawPhase(currentState, aiPlayerId, config);
    if (drawResult.success) {
      actionsTaken.push(...drawResult.actions);
      currentState = drawResult.newState || currentState;
    }

    // Phase 4: Main Phase 1
    const main1Result = await runMainPhase(currentState, aiPlayerId, config, 'precombat_main');
    if (main1Result.success) {
      actionsTaken.push(...main1Result.actions);
      currentState = main1Result.newState || currentState;
    }

    // Phase 5: Combat
    const combatResult = await runCombatPhase(currentState, aiPlayerId, config);
    if (combatResult.success) {
      actionsTaken.push(...combatResult.actions);
      currentState = combatResult.newState || currentState;
    }

    // Phase 6: Main Phase 2
    const main2Result = await runMainPhase(currentState, aiPlayerId, config, 'postcombat_main');
    if (main2Result.success) {
      actionsTaken.push(...main2Result.actions);
      currentState = main2Result.newState || currentState;
    }

    // Phase 7: End Phase
    const endResult = await runEndPhase(currentState, aiPlayerId, config);
    if (endResult.success) {
      actionsTaken.push(...endResult.actions);
      currentState = endResult.newState || currentState;
    }

    return {
      success: true,
      actionsTaken,
      finalState: currentState,
      phase: 'complete',
    };
  } catch (error) {
    return {
      success: false,
      actionsTaken,
      error: error instanceof Error ? error.message : 'Unknown error',
      finalState: currentState,
    };
  }
}

/**
 * Run untap phase
 */
async function runUntapPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  // Untap all permanents automatically (game rules)
  const actions: AIAction[] = [];
  let currentState = gameState;

  const battlefield = gameState.zones.get(`${aiPlayerId}-battlefield`);
  if (battlefield) {
    for (const cardId of battlefield.cardIds) {
      const card = currentState.cards.get(cardId);
      if (card && card.isTapped) {
        // Untap card
        const result = await executeAIAction(currentState, { type: 'untap_card', cardId }, aiPlayerId);
        if (result.success && result.newState) {
          currentState = result.newState;
          actions.push({ type: 'untap_card', cardId, reasoning: 'Untap during untap phase' });
          config.onCommentary?.(`${card.cardData.name} untaps`);
        }
      }
    }
  }

  // Advance to upkeep
  const advancedTurn = engineAdvancePhase(currentState.turn);
  currentState = { ...currentState, turn: advancedTurn };

  return { success: true, actions, newState: currentState };
}

/**
 * Run upkeep phase
 */
async function runUpkeepPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  _config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  // Handle upkeep triggers (none for basic implementation)
  await delay(500);
  
  return { success: true, actions: [], newState: gameState };
}

/**
 * Run draw phase
 */
async function runDrawPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  // Draw card for turn
  const newState = engineDrawCard(gameState, aiPlayerId);

  config.onCommentary?.('Draws a card');

  return {
    success: true,
    actions: [{ type: 'no_action', reasoning: 'Drew card for turn' }],
    newState
  };
}

/**
 * Run main phase (pre or post combat)
 */
async function runMainPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  _phase: 'precombat_main' | 'postcombat_main'
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  const actions: AIAction[] = [];
  let currentState = gameState;
  
  // Step 1: Play land if available
  const landResult = await playLandIfAvailable(currentState, aiPlayerId, config);
  if (landResult.success && landResult.action) {
    actions.push(landResult.action);
    currentState = landResult.newState || currentState;
    await delay(config.delayMs);
  }

  // Step 2: Cast creatures (priority based on curve)
  const creatureResult = await castCreatures(currentState, aiPlayerId, config);
  if (creatureResult.success) {
    actions.push(...creatureResult.actions);
    currentState = creatureResult.newState || currentState;
    for (let i = 0; i < creatureResult.actions.length; i++) {
      await delay(config.delayMs);
    }
  }

  // Step 3: Cast other spells
  const spellResult = await castOtherSpells(currentState, aiPlayerId, config);
  if (spellResult.success) {
    actions.push(...spellResult.actions);
    currentState = spellResult.newState || currentState;
    for (let i = 0; i < spellResult.actions.length; i++) {
      await delay(config.delayMs);
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Run combat phase
 */
async function runCombatPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Convert to unified AI format for decision-making
  const aiState = engineToAIState(currentState);
  
  // Use CombatDecisionTree for intelligent attack decisions
  // Import dynamically to avoid circular dependencies
  const { CombatDecisionTree } = await import('./decision-making/combat-decision-tree');
  const combatAI = new CombatDecisionTree(aiState, aiPlayerId, config.difficulty);
  
  // Generate attack plan using unified format
  const attackPlan = combatAI.generateAttackPlan();
  
  // Execute attack decisions
  for (const attackDecision of attackPlan.attacks) {
    if (attackDecision.shouldAttack && attackDecision.target !== 'none') {
      const result = await executeAIAction(
        currentState,
        {
          type: 'attack',
          cardId: attackDecision.creatureId,
          targetId: attackDecision.target,
          reasoning: attackDecision.reasoning
        },
        aiPlayerId
      );

      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: 'attack',
          cardId: attackDecision.creatureId,
          reasoning: attackDecision.reasoning
        });
        const creature = currentState.cards.get(attackDecision.creatureId);
        if (creature) {
          config.onCommentary?.(`Attacks with ${creature.cardData.name}`);
        }
        await delay(config.delayMs * 1.5); // Slightly longer delay for combat
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Run end phase
 */
async function runEndPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  // Pass priority and end turn
  const result = await executeAIAction(
    gameState,
    { type: 'pass_priority', reasoning: 'End of turn' },
    aiPlayerId
  );

  config.onCommentary?.('Ends turn');

  return {
    success: result.success,
    actions: [{ type: 'pass_priority', reasoning: 'End of turn' }],
    newState: result.newState
  };
}

/**
 * Play a land if available and appropriate
 */
async function playLandIfAvailable(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; action?: AIAction; newState?: EngineGameState }> {
  // Get lands from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: false };

  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes('land')) {
      const result = await executeAIAction(
        gameState,
        { type: 'play_land', cardId, reasoning: 'Play land for turn' },
        aiPlayerId
      );

      if (result.success) {
        config.onCommentary?.(`Plays ${card.cardData.name}`);
        return { success: true, action: { type: 'play_land', cardId }, newState: result.newState };
      }
    }
  }

  return { success: false };
}

/**
 * Cast creatures based on curve and strategy
 */
async function castCreatures(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  const actions: AIAction[] = [];
  let currentState = gameState;
  
  // Get creatures from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: true, actions: [] };

  // Sort creatures by CMC (cast cheaper first)
  const creatures: Array<{ cardId: CardInstanceId; cmc: number }> = [];
  
  for (const cardId of handZone.cardIds) {
    const card = currentState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes('creature')) {
      creatures.push({ cardId, cmc: card.cardData.cmc });
    }
  }

  creatures.sort((a, b) => a.cmc - b.cmc);

  // Cast creatures we can afford
  for (const { cardId, cmc } of creatures) {
    // Check if we should cast based on difficulty randomness
    // Higher difficulty = more likely to cast optimal creatures
    const difficultyConfig = DIFFICULTY_CONFIGS[config.difficulty];
    if (Math.random() < difficultyConfig.randomnessFactor * 0.3) {
      continue; // Skip some creatures based on difficulty
    }

    const result = await executeAIAction(
      currentState,
      { type: 'cast_spell', cardId, reasoning: `Cast creature (CMC ${cmc})` },
      aiPlayerId
    );

    if (result.success && result.newState) {
      currentState = result.newState;
      actions.push({ type: 'cast_spell', cardId, reasoning: `Cast creature (CMC ${cmc})` });
      const card = currentState.cards.get(cardId);
      if (card) {
        config.onCommentary?.(`Casts ${card.cardData.name}`);
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Cast other spells (instants, sorceries, etc.)
 */
async function castOtherSpells(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig
): Promise<{ success: boolean; actions: AIAction[]; newState?: EngineGameState }> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Get non-creature spells from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: true, actions: [] };

  for (const cardId of handZone.cardIds) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;

    const typeLine = card.cardData.type_line.toLowerCase();
    const isCreature = typeLine.includes('creature');
    const isLand = typeLine.includes('land');

    if (!isCreature && !isLand) {
      const result = await executeAIAction(
        currentState,
        { type: 'cast_spell', cardId, reasoning: `Cast ${card.cardData.name}` },
        aiPlayerId
      );

      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({ type: 'cast_spell', cardId, reasoning: `Cast ${card.cardData.name}` });
        config.onCommentary?.(`Casts ${card.cardData.name}`);
        await delay(config.delayMs);
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Get opponent player ID
 */
function getOpponentId(gameState: EngineGameState, playerId: PlayerId): PlayerId {
  const playerIds = Array.from(gameState.players.keys());
  return playerIds.find(id => id !== playerId) || playerId;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
