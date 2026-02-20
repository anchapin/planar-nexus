/**
 * @fileOverview Auto-save configuration and settings
 * 
 * Issue #269: Auto-save functionality for game states
 * 
 * Provides:
 * - Auto-save configuration settings
 * - Settings persistence in localStorage
 * - Default configuration values
 */

/**
 * Auto-save trigger events
 */
export type AutoSaveTrigger =
  | 'end_of_turn'        // Auto-save at end of each turn
  | 'after_combat'       // Auto-save after combat phase completes
  | 'pass_priority'      // Auto-save when passing priority
  | 'before_modal'       // Auto-save before showing modal dialogs
  | 'card_played'        // Auto-save after playing a card
  | 'spell_resolved'     // Auto-save after a spell resolves
  | 'player_gained_life' // Auto-save after life gain
  | 'creature_died'      // Auto-save after a creature dies
  | 'manual';            // Manual save (not auto)

/**
 * Auto-save configuration
 */
export interface AutoSaveConfig {
  /** Enable/disable auto-save */
  enabled: boolean;
  /** Which triggers are active */
  triggers: AutoSaveTrigger[];
  /** Maximum number of auto-saves to keep */
  maxAutoSaves: number;
  /** Auto-save slot rotation (circular buffer) */
  useSlotRotation: boolean;
  /** Show visual indicator when auto-saving */
  showIndicator: boolean;
  /** Auto-save interval in milliseconds (for periodic saves) */
  periodicIntervalMs: number | null;
  /** Enable periodic auto-save */
  enablePeriodic: boolean;
  /** Sound effect on auto-save */
  playSound: boolean;
  /** Auto-cleanup old auto-saves when game ends */
  autoCleanup: boolean;
}

/**
 * Default auto-save configuration
 */
export const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
  enabled: true,
  triggers: ['end_of_turn', 'after_combat', 'pass_priority', 'before_modal'],
  maxAutoSaves: 3,
  useSlotRotation: true,
  showIndicator: true,
  periodicIntervalMs: null,
  enablePeriodic: false,
  playSound: false,
  autoCleanup: true,
};

const STORAGE_KEY = 'planar_nexus_auto_save_config';

/**
 * Get auto-save configuration from localStorage
 */
export function getAutoSaveConfig(): AutoSaveConfig {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_AUTO_SAVE_CONFIG;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_AUTO_SAVE_CONFIG;
    }

    const parsed = JSON.parse(stored) as Partial<AutoSaveConfig>;
    return {
      ...DEFAULT_AUTO_SAVE_CONFIG,
      ...parsed,
    };
  } catch (e) {
    console.error('Failed to parse auto-save config:', e);
    return DEFAULT_AUTO_SAVE_CONFIG;
  }
}

/**
 * Save auto-save configuration to localStorage
 */
export function setAutoSaveConfig(config: Partial<AutoSaveConfig>): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    const current = getAutoSaveConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save auto-save config:', e);
  }
}

/**
 * Check if a specific trigger is enabled
 */
export function isTriggerEnabled(trigger: AutoSaveTrigger): boolean {
  const config = getAutoSaveConfig();
  return config.enabled && config.triggers.includes(trigger);
}

/**
 * Toggle a specific trigger on/off
 */
export function toggleTrigger(trigger: AutoSaveTrigger): void {
  const config = getAutoSaveConfig();
  const triggers = config.triggers.includes(trigger)
    ? config.triggers.filter(t => t !== trigger)
    : [...config.triggers, trigger];
  
  setAutoSaveConfig({ triggers });
}

/**
 * Reset auto-save configuration to defaults
 */
export function resetAutoSaveConfig(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
