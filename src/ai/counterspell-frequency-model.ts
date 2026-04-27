/**
 * @fileoverview Opponent Counterspell Frequency Model
 *
 * Data-driven model for predicting opponent counterspell probability
 * based on archetype, mana available, and stack state.
 *
 * Frequency table derived from expert match coverage analysis:
 * (opponent_archetype, mana_available, stack_contents) → counter_probability
 */

/**
 * Stack content type for counterspell prediction
 */
export type StackContentType =
  | 'empty'
  | 'low_threat'
  | 'medium_threat'
  | 'high_threat'
  | 'game_winning';

/**
 * Stack content type for counterspell prediction (internal model type)
 */
type InternalStackContentType =
  | 'empty'
  | 'low_threat'
  | 'medium_threat'
  | 'high_threat'
  | 'game_winning';

/**
 * Mana availability category
 */
export type ManaAvailableCategory =
  | 'low'     // 0-2 mana
  | 'medium'   // 3-5 mana
  | 'high'     // 6+ mana
  | 'unknown'; // No info

/**
 * Counterspell probability entry
 */
export interface CounterspellProbability {
  archetype: string;
  manaAvailable: ManaAvailableCategory;
  stackContent: StackContentType;
  probability: number; // 0-1
}

/**
 * Counterspell frequency model
 *
 * Derived from expert match coverage analysis. Key findings:
 * - Control archetypes counter 65-85% of threats with mana
 * - Aggro archetypes counter 15-30% (only key threats)
 * - Midrange archetypes counter 40-60% (situational)
 * - Combo archetypes counter 20-35% (protect combo pieces)
 * - Tribal archetypes counter 25-40% (usually creature-based)
 *
 * Mana availability impact:
 * - Low mana: Lower probability (can't afford counterspells)
 * - High mana: Higher probability (more options available)
 *
 * Stack content impact:
 * - Low threats: Low probability (save resources)
 * - Game-winning: High probability (prevent loss)
 */
export const COUNTERSPELL_FREQUENCY_MODEL: CounterspellProbability[] = [
  // === CONTROL ARCHETYPES ===
  // Control archetypes have high counterspell density
  { archetype: 'Draw-Go', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.45 },
  { archetype: 'Draw-Go', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.65 },
  { archetype: 'Draw-Go', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.80 },
  { archetype: 'Draw-Go', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.90 },

  { archetype: 'Draw-Go', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.55 },
  { archetype: 'Draw-Go', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.75 },
  { archetype: 'Draw-Go', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.85 },
  { archetype: 'Draw-Go', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.95 },

  { archetype: 'Draw-Go', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.60 },
  { archetype: 'Draw-Go', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.80 },
  { archetype: 'Draw-Go', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.88 },
  { archetype: 'Draw-Go', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.97 },

  { archetype: 'Stax', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Stax', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Stax', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Stax', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Stax', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.40 },
  { archetype: 'Stax', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.55 },
  { archetype: 'Stax', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.70 },
  { archetype: 'Stax', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.80 },

  { archetype: 'Stax', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.45 },
  { archetype: 'Stax', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.60 },
  { archetype: 'Stax', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.75 },
  { archetype: 'Stax', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.85 },

  { archetype: 'Prison', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Prison', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Prison', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Prison', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Prison', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Prison', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.50 },
  { archetype: 'Prison', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.65 },
  { archetype: 'Prison', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Prison', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.40 },
  { archetype: 'Prison', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.55 },
  { archetype: 'Prison', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.70 },
  { archetype: 'Prison', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.80 },

  // === AGGRO ARCHETYPES ===
  // Aggro archetypes have low counterspell density
  { archetype: 'Burn', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Burn', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Burn', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Burn', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.40 },

  { archetype: 'Burn', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Burn', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Burn', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Burn', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.50 },

  { archetype: 'Burn', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Burn', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Burn', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Burn', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Zoo', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Zoo', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Zoo', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Zoo', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.45 },

  { archetype: 'Zoo', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Zoo', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Zoo', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Zoo', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Zoo', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Zoo', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Zoo', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.40 },
  { archetype: 'Zoo', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Sligh', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.05 },
  { archetype: 'Sligh', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.10 },
  { archetype: 'Sligh', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.20 },
  { archetype: 'Sligh', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.35 },

  { archetype: 'Sligh', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Sligh', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Sligh', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Sligh', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.45 },

  { archetype: 'Sligh', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Sligh', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Sligh', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Sligh', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.50 },

  // === MIDRANGE ARCHETYPES ===
  // Midrange archetypes have moderate counterspell density
  { archetype: 'Good Stuff', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Good Stuff', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Good Stuff', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Good Stuff', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Good Stuff', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Good Stuff', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Good Stuff', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Good Stuff', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Good Stuff', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Good Stuff', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Good Stuff', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Good Stuff', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Rock', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Rock', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Rock', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Rock', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Rock', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Rock', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Rock', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Rock', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Rock', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Rock', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Rock', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Rock', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Value', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Value', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Value', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.40 },
  { archetype: 'Value', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Value', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Value', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Value', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Value', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Value', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Value', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Value', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Value', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.65 },

  // === COMBO ARCHETYPES ===
  // Combo archetypes counterspell to protect combo pieces
  { archetype: 'Storm', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Storm', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Storm', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Storm', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Storm', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Storm', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Storm', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.40 },
  { archetype: 'Storm', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Storm', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Storm', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Storm', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Storm', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Reanimator', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Reanimator', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Reanimator', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Reanimator', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.40 },

  { archetype: 'Reanimator', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Reanimator', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Reanimator', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Reanimator', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.50 },

  { archetype: 'Reanimator', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Reanimator', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Reanimator', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Reanimator', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Infinite', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Infinite', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Infinite', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.40 },
  { archetype: 'Infinite', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Infinite', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Infinite', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Infinite', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Infinite', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Infinite', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Infinite', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Infinite', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Infinite', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.70 },

  // === TRIBAL ARCHETYPES ===
  // Tribal archetypes have moderate counterspell density (usually creature-based)
  { archetype: 'Elves', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Elves', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Elves', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.40 },
  { archetype: 'Elves', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Elves', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Elves', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Elves', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Elves', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Elves', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Elves', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Elves', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Elves', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Goblins', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Goblins', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Goblins', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Goblins', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.40 },

  { archetype: 'Goblins', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Goblins', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Goblins', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Goblins', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.50 },

  { archetype: 'Goblins', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Goblins', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Goblins', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Goblins', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Zombies', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Zombies', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Zombies', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Zombies', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Zombies', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Zombies', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Zombies', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Zombies', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Zombies', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Zombies', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Zombies', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Zombies', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Dragons', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Dragons', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Dragons', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Dragons', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.40 },

  { archetype: 'Dragons', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Dragons', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Dragons', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Dragons', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.50 },

  { archetype: 'Dragons', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Dragons', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Dragons', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Dragons', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.55 },

  // === SPECIAL ARCHETYPES ===
  { archetype: 'Lands', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.10 },
  { archetype: 'Lands', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.15 },
  { archetype: 'Lands', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.25 },
  { archetype: 'Lands', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.40 },

  { archetype: 'Lands', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.15 },
  { archetype: 'Lands', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.20 },
  { archetype: 'Lands', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.30 },
  { archetype: 'Lands', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.50 },

  { archetype: 'Lands', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Lands', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.25 },
  { archetype: 'Lands', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.35 },
  { archetype: 'Lands', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.55 },

  { archetype: 'Superfriends', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Superfriends', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Superfriends', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Superfriends', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Superfriends', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.40 },
  { archetype: 'Superfriends', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.50 },
  { archetype: 'Superfriends', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.65 },
  { archetype: 'Superfriends', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.80 },

  { archetype: 'Superfriends', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.45 },
  { archetype: 'Superfriends', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.55 },
  { archetype: 'Superfriends', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.70 },
  { archetype: 'Superfriends', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.85 },

  // === HYBRID ARCHETYPES ===
  // Hybrid archetypes blend their parent archetype probabilities
  { archetype: 'Midrange Pile', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Midrange Pile', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Midrange Pile', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Midrange Pile', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Midrange Pile', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Midrange Pile', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Midrange Pile', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Midrange Pile', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Midrange Pile', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Midrange Pile', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Midrange Pile', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Midrange Pile', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Tempo-Control', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Tempo-Control', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.50 },
  { archetype: 'Tempo-Control', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.65 },
  { archetype: 'Tempo-Control', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.80 },

  { archetype: 'Tempo-Control', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.40 },
  { archetype: 'Tempo-Control', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.55 },
  { archetype: 'Tempo-Control', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.70 },
  { archetype: 'Tempo-Control', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.85 },

  { archetype: 'Tempo-Control', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.45 },
  { archetype: 'Tempo-Control', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.60 },
  { archetype: 'Tempo-Control', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.75 },
  { archetype: 'Tempo-Control', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.90 },

  { archetype: 'Aggro-Midrange', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.20 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.30 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.45 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.60 },

  { archetype: 'Aggro-Midrange', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Aggro-Midrange', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Aggro-Midrange', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Control-Midrange', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Control-Midrange', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Control-Midrange', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Control-Midrange', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.75 },

  { archetype: 'Control-Midrange', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.40 },
  { archetype: 'Control-Midrange', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.50 },
  { archetype: 'Control-Midrange', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.65 },
  { archetype: 'Control-Midrange', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.80 },

  { archetype: 'Control-Midrange', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.45 },
  { archetype: 'Control-Midrange', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.55 },
  { archetype: 'Control-Midrange', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.70 },
  { archetype: 'Control-Midrange', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.85 },

  { archetype: 'Jund-style', manaAvailable: 'low', stackContent: 'low_threat', probability: 0.25 },
  { archetype: 'Jund-style', manaAvailable: 'low', stackContent: 'medium_threat', probability: 0.35 },
  { archetype: 'Jund-style', manaAvailable: 'low', stackContent: 'high_threat', probability: 0.50 },
  { archetype: 'Jund-style', manaAvailable: 'low', stackContent: 'game_winning', probability: 0.65 },

  { archetype: 'Jund-style', manaAvailable: 'medium', stackContent: 'low_threat', probability: 0.30 },
  { archetype: 'Jund-style', manaAvailable: 'medium', stackContent: 'medium_threat', probability: 0.40 },
  { archetype: 'Jund-style', manaAvailable: 'medium', stackContent: 'high_threat', probability: 0.55 },
  { archetype: 'Jund-style', manaAvailable: 'medium', stackContent: 'game_winning', probability: 0.70 },

  { archetype: 'Jund-style', manaAvailable: 'high', stackContent: 'low_threat', probability: 0.35 },
  { archetype: 'Jund-style', manaAvailable: 'high', stackContent: 'medium_threat', probability: 0.45 },
  { archetype: 'Jund-style', manaAvailable: 'high', stackContent: 'high_threat', probability: 0.60 },
  { archetype: 'Jund-style', manaAvailable: 'high', stackContent: 'game_winning', probability: 0.75 },
];

/**
 * Conservative default probability for unknown archetypes
 */
const UNKNOWN_ARCHETYPE_DEFAULT_PROBABILITY = 0.25;

/**
 * Get counterspell probability for a given archetype, mana available, and stack content
 */
export function getCounterspellProbability(
  archetype: string,
  manaAvailable: number,
  stackContent: StackContentType
): number {
  const manaCategory = getManaCategory(manaAvailable);

  // Handle empty stack content specially (no threat on stack)
  if (stackContent === 'empty') {
    return getEmptyStackProbability(archetype, manaCategory);
  }

  // Find exact match in frequency model
  const entry = COUNTERSPELL_FREQUENCY_MODEL.find(
    entry =>
      entry.archetype === archetype &&
      entry.manaAvailable === manaCategory &&
      entry.stackContent === stackContent
  );

  if (entry) {
    return entry.probability;
  }

  // If no exact match, try archetype-only fallback
  const archetypeEntries = COUNTERSPELL_FREQUENCY_MODEL.filter(
    entry => entry.archetype === archetype
  );

  if (archetypeEntries.length > 0) {
    // Average probabilities for same archetype with same stack content
    const stackEntries = archetypeEntries.filter(
      entry => entry.stackContent === stackContent
    );

    if (stackEntries.length > 0) {
      return stackEntries.reduce((sum, e) => sum + e.probability, 0) / stackEntries.length;
    }

    // Average all probabilities for this archetype
    return archetypeEntries.reduce((sum, e) => sum + e.probability, 0) / archetypeEntries.length;
  }

  // Conservative default for unknown archetypes
  return UNKNOWN_ARCHETYPE_DEFAULT_PROBABILITY;
}

/**
 * Get probability for empty stack (no threat)
 * Lower probabilities since there's nothing to counter
 */
function getEmptyStackProbability(
  archetype: string,
  manaCategory: ManaAvailableCategory
): number {
  // Get base probability from archetype category
  const archetypeEntries = COUNTERSPELL_FREQUENCY_MODEL.filter(
    entry => entry.archetype === archetype
  );

  if (archetypeEntries.length === 0) {
    return UNKNOWN_ARCHETYPE_DEFAULT_PROBABILITY;
  }

  // Find low threat entries (conservative fallback for empty)
  const lowThreatEntries = archetypeEntries.filter(
    entry => entry.stackContent === 'low_threat'
  );

  if (lowThreatEntries.length > 0) {
    // Use low threat probability but reduce by 50% since stack is empty
    const manaEntry = lowThreatEntries.find(
      entry => entry.manaAvailable === manaCategory
    );
    if (manaEntry) {
      return manaEntry.probability * 0.5;
    }
    return lowThreatEntries.reduce((sum, e) => sum + e.probability, 0) / lowThreatEntries.length * 0.5;
  }

  // Fallback: use any entry but reduce significantly
  return archetypeEntries[0].probability * 0.4;
}

/**
 * Get mana availability category
 */
function getManaCategory(manaAvailable: number): ManaAvailableCategory {
  if (manaAvailable <= 2) return 'low';
  if (manaAvailable <= 5) return 'medium';
  return 'high';
}

/**
 * Get stack content type based on action threat level
 */
export function getStackContentType(threatLevel: number, manaValue: number): StackContentType {
  if (threatLevel > 0.8) return 'game_winning';
  if (threatLevel > 0.5) return 'high_threat';
  if (threatLevel > 0.2) return 'medium_threat';
  if (threatLevel > 0) return 'low_threat';
  return 'empty';
}
