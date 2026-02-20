/**
 * @fileOverview Auto-save hook for game states
 * 
 * Issue #269: Auto-save functionality for game states
 * 
 * Provides:
 * - React hook for auto-save functionality
 * - Integration with game state changes
 * - Visual feedback for auto-save status
 * - Error handling for save failures
 */

"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState } from '@/lib/game-state/types';
import type { Replay } from '@/lib/game-state/replay';
import { savedGamesManager } from '@/lib/saved-games';
import {
  getAutoSaveConfig,
  setAutoSaveConfig,
  isTriggerEnabled,
  type AutoSaveTrigger,
  type AutoSaveConfig,
} from '@/lib/auto-save-config';
import { useToast } from '@/hooks/use-toast';

/**
 * Auto-save status
 */
export type AutoSaveStatus =
  | 'idle'           // No auto-save in progress
  | 'saving'         // Currently saving
  | 'success'        // Last auto-save succeeded
  | 'error';         // Last auto-save failed

/**
 * Auto-save result
 */
export interface AutoSaveResult {
  success: boolean;
  savedGameId?: string;
  error?: string;
  timestamp: number;
}

/**
 * Hook options
 */
export interface UseAutoSaveOptions {
  /** Callback when auto-save starts */
  onSaveStart?: () => void;
  /** Callback when auto-save completes */
  onSaveComplete?: (result: AutoSaveResult) => void;
  /** Callback when auto-save fails */
  onSaveError?: (error: Error) => void;
  /** Game ID for tracking */
  gameId?: string;
}

/**
 * Auto-save hook return value
 */
export interface UseAutoSaveReturn {
  /** Current auto-save status */
  status: AutoSaveStatus;
  /** Whether auto-save is enabled */
  isEnabled: boolean;
  /** Configuration */
  config: AutoSaveConfig;
  /** Last save result */
  lastResult: AutoSaveResult | null;
  /** Trigger auto-save manually */
  triggerAutoSave: (trigger: AutoSaveTrigger, gameState: GameState, replay?: Replay | null) => Promise<boolean>;
  /** Update configuration */
  updateConfig: (config: Partial<AutoSaveConfig>) => void;
  /** Reset status to idle */
  resetStatus: () => void;
  /** Clean up old auto-saves */
  cleanupAutoSaves: () => void;
  /** Check if a trigger should cause auto-save */
  shouldAutoSave: (trigger: AutoSaveTrigger) => boolean;
}

/**
 * Auto-save hook for game states
 */
export function useAutoSave(options: UseAutoSaveOptions = {}): UseAutoSaveReturn {
  const { onSaveStart, onSaveComplete, onSaveError, gameId: _gameId } = options;
  const { toast } = useToast();
  
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [config, setConfig] = useState<AutoSaveConfig>(() => getAutoSaveConfig());
  const [lastResult, setLastResult] = useState<AutoSaveResult | null>(null);
  
  // Track pending saves to avoid duplicates
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const saveDebounceMs = 500; // Minimum time between auto-saves

  // Update config when it changes in localStorage
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'planar_nexus_auto_save_config') {
        setConfig(getAutoSaveConfig());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  /**
   * Check if auto-save should trigger for given event
   */
  const shouldAutoSave = useCallback((trigger: AutoSaveTrigger): boolean => {
    return isTriggerEnabled(trigger);
  }, []);

  /**
   * Update configuration
   */
  const updateConfig = useCallback((newConfig: Partial<AutoSaveConfig>) => {
    setAutoSaveConfig(newConfig);
    setConfig(getAutoSaveConfig());
  }, []);

  /**
   * Clean up old auto-saves
   */
  const cleanupAutoSaves = useCallback(() => {
    if (!config.autoCleanup) return;

    try {
      const autoSaves = savedGamesManager.getAutoSaves();
      const savesToDelete = autoSaves.slice(config.maxAutoSaves);
      
      for (const save of savesToDelete) {
        savedGamesManager.deleteGame(save.id);
      }

      if (savesToDelete.length > 0) {
        console.log(`Cleaned up ${savesToDelete.length} old auto-saves`);
      }
    } catch (error) {
      console.error('Failed to cleanup auto-saves:', error);
    }
  }, [config.autoCleanup, config.maxAutoSaves]);

  /**
   * Reset status to idle
   */
  const resetStatus = useCallback(() => {
    setStatus('idle');
    setLastResult(null);
  }, []);

  /**
   * Trigger auto-save
   */
  const triggerAutoSave = useCallback(
    async (
      trigger: AutoSaveTrigger,
      gameState: GameState,
      replay: Replay | null = null
    ): Promise<boolean> => {
      // Check if auto-save is enabled for this trigger
      if (!shouldAutoSave(trigger)) {
        return false;
      }

      // Check if we're already saving
      if (pendingSaveRef.current) {
        return pendingSaveRef.current;
      }

      // Check debounce
      const now = Date.now();
      if (now - lastSaveTimeRef.current < saveDebounceMs) {
        return false;
      }

      // Check if auto-save is enabled at all
      if (!config.enabled) {
        return false;
      }

      lastSaveTimeRef.current = now;
      setStatus('saving');
      onSaveStart?.();

      try {
        // Perform the save
        const savedGame = savedGamesManager.autoSave(gameState, replay);
        
        // Clean up old saves
        cleanupAutoSaves();

        const result: AutoSaveResult = {
          success: true,
          savedGameId: savedGame.id,
          timestamp: Date.now(),
        };

        setLastResult(result);
        setStatus('success');
        onSaveComplete?.(result);

        // Show success toast if enabled
        if (config.showIndicator) {
          toast({
            title: 'Game Auto-Saved',
            description: `Triggered by: ${trigger.replace(/_/g, ' ')}`,
            duration: 2000,
          });
        }

        // Reset to idle after delay
        setTimeout(() => {
          setStatus('idle');
        }, 2000);

        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        const result: AutoSaveResult = {
          success: false,
          error: errorMessage,
          timestamp: Date.now(),
        };

        setLastResult(result);
        setStatus('error');
        onSaveError?.(error instanceof Error ? error : new Error(errorMessage));

        // Show error toast
        toast({
          variant: 'destructive',
          title: 'Auto-Save Failed',
          description: errorMessage,
          duration: 5000,
        });

        // Reset to idle after delay
        setTimeout(() => {
          setStatus('idle');
        }, 3000);

        return false;
      } finally {
        pendingSaveRef.current = null;
      }
    },
    [config.enabled, config.showIndicator, shouldAutoSave, cleanupAutoSaves, onSaveStart, onSaveComplete, onSaveError, toast]
  );

  return {
    status,
    isEnabled: config.enabled,
    config,
    lastResult,
    triggerAutoSave,
    updateConfig,
    resetStatus,
    cleanupAutoSaves,
    shouldAutoSave,
  };
}

/**
 * Helper to create auto-save wrapper for game actions
 */
export function createAutoSaveWrapper(
  autoSave: UseAutoSaveReturn,
  trigger: AutoSaveTrigger
) {
  return async (gameState: GameState, replay?: Replay | null) => {
    return autoSave.triggerAutoSave(trigger, gameState, replay);
  };
}
