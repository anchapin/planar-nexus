/**
 * @fileOverview Auto-save integration helpers for game actions
 * 
 * Issue #269: Auto-save functionality for game states
 * 
 * Provides:
 * - Helper functions to integrate auto-save with game actions
 * - Wrappers for common game events
 * - Game lifecycle management for auto-save cleanup
 */

import type { GameState } from './game-state/types';
import type { Replay } from './game-state/replay';
import type { UseAutoSaveReturn } from '@/hooks/use-auto-save';
import type { AutoSaveTrigger } from './auto-save-config';

/**
 * Game action wrapper that triggers auto-save
 */
export interface GameActionWithAutoSave<T extends unknown[]> {
  (...args: T): Promise<unknown>;
}

/**
 * Create a wrapped game action that triggers auto-save after execution
 */
export function withAutoSaveAfter<T extends unknown[]>(
  action: (...args: T) => Promise<unknown> | unknown,
  autoSave: UseAutoSaveReturn,
  trigger: AutoSaveTrigger,
  getGameState: () => GameState | null,
  getReplay: () => Replay | null
): GameActionWithAutoSave<T> {
  return async (...args: T) => {
    // Execute the action
    const result = await action(...args);
    
    // Trigger auto-save after action completes
    const gameState = getGameState();
    if (gameState) {
      await autoSave.triggerAutoSave(trigger, gameState, getReplay());
    }
    
    return result;
  };
}

/**
 * Create a wrapped game action that triggers auto-save before execution
 */
export function withAutoSaveBefore<T extends unknown[]>(
  action: (...args: T) => Promise<unknown> | unknown,
  autoSave: UseAutoSaveReturn,
  trigger: AutoSaveTrigger,
  getGameState: () => GameState | null,
  getReplay: () => Replay | null
): GameActionWithAutoSave<T> {
  return async (...args: T) => {
    // Trigger auto-save before action executes
    const gameState = getGameState();
    if (gameState) {
      await autoSave.triggerAutoSave(trigger, gameState, getReplay());
    }
    
    // Execute the action
    return action(...args);
  };
}

/**
 * Game lifecycle manager for auto-save
 */
export class AutoSaveGameLifecycle {
  private autoSave: UseAutoSaveReturn;
  private getGameState: () => GameState | null;
  private getReplay: () => Replay | null;
  private cleanupOnEnd: boolean;

  constructor(
    autoSave: UseAutoSaveReturn,
    getGameState: () => GameState | null,
    getReplay: () => Replay | null,
    cleanupOnEnd: boolean = true
  ) {
    this.autoSave = autoSave;
    this.getGameState = getGameState;
    this.getReplay = getReplay;
    this.cleanupOnEnd = cleanupOnEnd;
  }

  /**
   * Handle end of turn - trigger auto-save
   */
  async onTurnEnd() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('end_of_turn', gameState, this.getReplay());
    }
  }

  /**
   * Handle combat phase end - trigger auto-save
   */
  async onCombatEnd() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('after_combat', gameState, this.getReplay());
    }
  }

  /**
   * Handle priority pass - trigger auto-save
   */
  async onPassPriority() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('pass_priority', gameState, this.getReplay());
    }
  }

  /**
   * Handle modal display - trigger auto-save before showing
   */
  async onBeforeModal() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('before_modal', gameState, this.getReplay());
    }
  }

  /**
   * Handle card played - trigger auto-save
   */
  async onCardPlayed() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('card_played', gameState, this.getReplay());
    }
  }

  /**
   * Handle spell resolved - trigger auto-save
   */
  async onSpellResolved() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('spell_resolved', gameState, this.getReplay());
    }
  }

  /**
   * Handle player gained life - trigger auto-save
   */
  async onPlayerGainedLife() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('player_gained_life', gameState, this.getReplay());
    }
  }

  /**
   * Handle creature died - trigger auto-save
   */
  async onCreatureDied() {
    const gameState = this.getGameState();
    if (gameState) {
      await this.autoSave.triggerAutoSave('creature_died', gameState, this.getReplay());
    }
  }

  /**
   * Handle game end - cleanup auto-saves
   */
  async onGameEnd() {
    if (this.cleanupOnEnd) {
      this.autoSave.cleanupAutoSaves();
    }
  }

  /**
   * Handle game quit - cleanup auto-saves
   */
  async onGameQuit() {
    if (this.cleanupOnEnd) {
      this.autoSave.cleanupAutoSaves();
    }
  }
}

/**
 * Create auto-save integration for a game session
 */
export function createAutoSaveIntegration(
  autoSave: UseAutoSaveReturn,
  getGameState: () => GameState | null,
  getReplay: () => Replay | null,
  cleanupOnEnd: boolean = true
): AutoSaveGameLifecycle {
  return new AutoSaveGameLifecycle(autoSave, getGameState, getReplay, cleanupOnEnd);
}

/**
 * Auto-save event types for game board integration
 */
export type AutoSaveEvent =
  | 'turn_end'
  | 'combat_end'
  | 'pass_priority'
  | 'before_modal'
  | 'card_played'
  | 'spell_resolved'
  | 'player_gained_life'
  | 'creature_died'
  | 'game_end'
  | 'game_quit';

/**
 * Map event types to triggers
 */
export const EVENT_TO_TRIGGER: Record<AutoSaveEvent, AutoSaveTrigger | null> = {
  'turn_end': 'end_of_turn',
  'combat_end': 'after_combat',
  'pass_priority': 'pass_priority',
  'before_modal': 'before_modal',
  'card_played': 'card_played',
  'spell_resolved': 'spell_resolved',
  'player_gained_life': 'player_gained_life',
  'creature_died': 'creature_died',
  'game_end': null, // Handled separately
  'game_quit': null, // Handled separately
};
