/**
 * Terminology Translation Layer
 *
 * Translates Magic: The Gathering-specific terminology to generic equivalents
 * for legal and design reasons. This ensures the game remains legally distinct
 * while maintaining the core gameplay mechanics.
 *
 * Issue #442: Unit 8 - Terminology Translation Layer
 */

/**
 * Mapping of MTG terms to generic equivalents
 * Used for UI display and user-facing text
 */
export const TERMINOLOGY_MAPPING: Record<string, string> = {
  // Card states and actions
  'tap': 'activate',
  'untap': 'deactivate',
  'tapped': 'activated',
  'untapped': 'deactivated',
  'tapping': 'activating',
  'untapping': 'deactivating',

  // Zones
  'battlefield': 'play area',
  'graveyard': 'discard pile',
  'library': 'deck',
  'hand': 'hand',
  'exile': 'void',
  'stack': 'action stack',
  'command zone': 'reserve zone',

  // Game mechanics
  'summoning sickness': 'deployment restriction',
  'cast': 'play',
  'casting': 'playing',
  'spell': 'card effect',
  'counter': 'marker',

  // Card types (generic equivalents)
  'planeswalker': 'champion',
  'planeswalkers': 'champions',

  // Game phases (kept internally, mapped for display)
  'untap step': 'reactivation step',
  'upkeep': 'maintenance',
  'upkeep step': 'maintenance step',

  // Mana and resources
  'mana pool': 'energy pool',
  'mana': 'energy',
};

/**
 * Reverse mapping for backward compatibility with legacy code
 */
const REVERSE_MAPPING: Record<string, string> = {};
for (const [generic, specific] of Object.entries(TERMINOLOGY_MAPPING)) {
  REVERSE_MAPPING[specific] = generic;
}

/**
 * Translates text containing MTG terminology to generic equivalents
 *
 * @param text - Text containing MTG terminology
 * @returns Text with generic terminology
 */
export function translateToGeneric(text: string): string {
  let translated = text;

  // Sort terms by length (longest first) to avoid partial replacements
  const terms = Object.entries(TERMINOLOGY_MAPPING)
    .sort(([a], [b]) => b.length - a.length);

  for (const [mtgTerm, genericTerm] of terms) {
    // Use word boundaries to avoid partial matches
    // Use a replacement function to preserve case
    const regex = new RegExp(`\\b${mtgTerm}\\b`, 'gi');
    translated = translated.replace(regex, (match) => {
      // Preserve the case of the original match
      if (match === match.toUpperCase()) {
        return genericTerm.toUpperCase();
      } else if (match[0] === match[0].toUpperCase()) {
        return genericTerm.charAt(0).toUpperCase() + genericTerm.slice(1);
      } else {
        return genericTerm;
      }
    });
  }

  return translated;
}

/**
 * Translates generic terminology back to MTG terminology
 * Used for internal processing and backward compatibility
 *
 * @param text - Text containing generic terminology
 * @returns Text with MTG terminology
 */
export function translateFromGeneric(text: string): string {
  let translated = text;

  const terms = Object.entries(REVERSE_MAPPING)
    .sort(([a], [b]) => b.length - a.length);

  for (const [genericTerm, mtgTerm] of terms) {
    const regex = new RegExp(`\\b${genericTerm}\\b`, 'gi');
    translated = translated.replace(regex, (match) => {
      // Preserve the case of the original match
      if (match === match.toUpperCase()) {
        return mtgTerm.toUpperCase();
      } else if (match[0] === match[0].toUpperCase()) {
        return mtgTerm.charAt(0).toUpperCase() + mtgTerm.slice(1);
      } else {
        return mtgTerm;
      }
    });
  }

  return translated;
}

/**
 * Translates a single term to its generic equivalent
 *
 * @param term - MTG term to translate
 * @returns Generic equivalent, or original term if no mapping exists
 */
export function translateTerm(term: string): string {
  const lowerTerm = term.toLowerCase();
  return TERMINOLOGY_MAPPING[lowerTerm] || term;
}

/**
 * Translates a zone type to its generic equivalent for UI display
 *
 * @param zoneType - Internal zone type (e.g., 'battlefield', 'graveyard')
 * @returns Generic zone name for display
 */
export function translateZone(zoneType: string): string {
  const zoneMap: Record<string, string> = {
    'library': 'Deck',
    'hand': 'Hand',
    'battlefield': 'Play Area',
    'graveyard': 'Discard Pile',
    'exile': 'Void',
    'stack': 'Action Stack',
    'command': 'Reserve Zone',
    'sideboard': 'Sideboard',
    'anticipate': 'Anticipate Zone',
  };

  return zoneMap[zoneType] || zoneType;
}

/**
 * Translates a phase name to its generic equivalent for UI display
 *
 * @param phase - Internal phase name (e.g., 'untap', 'upkeep')
 * @returns Generic phase name for display
 */
export function translatePhase(phase: string): string {
  const phaseMap: Record<string, string> = {
    'untap': 'Reactivation',
    'upkeep': 'Maintenance',
    'draw': 'Draw',
    'precombat_main': 'Pre-Combat Main',
    'begin_combat': 'Begin Combat',
    'declare_attackers': 'Declare Attackers',
    'declare_blockers': 'Declare Blockers',
    'combat_damage_first_strike': 'First Strike Damage',
    'combat_damage': 'Combat Damage',
    'end_combat': 'End Combat',
    'postcombat_main': 'Post-Combat Main',
    'end': 'End',
    'cleanup': 'Cleanup',
  };

  return phaseMap[phase] || phase;
}

/**
 * Translates an action type to its generic equivalent for UI display
 *
 * @param actionType - Internal action type (e.g., 'tap_card', 'untap_card')
 * @returns Generic action description for display
 */
export function translateAction(actionType: string): string {
  const actionMap: Record<string, string> = {
    'cast_spell': 'Play card effect',
    'activate_ability': 'Activate ability',
    'pass_priority': 'Pass priority',
    'declare_attackers': 'Declare attackers',
    'declare_blockers': 'Declare blockers',
    'play_land': 'Play land',
    'draw_card': 'Draw card',
    'discard_card': 'Discard card',
    'tap_card': 'Activate card',
    'untap_card': 'Deactivate card',
    'destroy_card': 'Destroy card',
    'exile_card': 'Send to void',
    'sacrifice_card': 'Sacrifice card',
    'create_token': 'Create token',
    'add_counter': 'Add marker',
    'remove_counter': 'Remove marker',
    'move_card': 'Move card',
    'gain_life': 'Gain life',
    'lose_life': 'Lose life',
    'deal_damage': 'Deal damage',
    'pay_mana': 'Pay energy',
    'add_mana': 'Add energy',
    'mulligan': 'Mulligan',
    'concede': 'Concede',
    'undo': 'Undo',
  };

  return actionMap[actionType] || actionType;
}

/**
 * Translates card state to generic terminology
 *
 * @param state - Card state object with boolean flags
 * @returns Object with translated state descriptions
 */
export function translateCardState(state: {
  isTapped: boolean;
  hasSummoningSickness: boolean;
  isPhasedOut: boolean;
}): {
  activation: 'activated' | 'deactivated';
  deployment: 'restricted' | 'ready';
  visibility: 'visible' | 'phased out';
} {
  return {
    activation: state.isTapped ? 'activated' : 'deactivated',
    deployment: state.hasSummoningSickness ? 'restricted' : 'ready',
    visibility: state.isPhasedOut ? 'phased out' : 'visible',
  };
}

/**
 * Gets a human-readable description of a card's state
 *
 * @param state - Card state object
 * @returns Human-readable description
 */
export function getCardStateDescription(state: {
  isTapped: boolean;
  hasSummoningSickness: boolean;
}): string {
  const descriptions: string[] = [];

  if (state.isTapped) {
    descriptions.push('Activated');
  }

  if (state.hasSummoningSickness) {
    descriptions.push('Has deployment restriction');
  }

  return descriptions.length > 0 ? descriptions.join(', ') : 'Ready';
}

/**
 * Translates game rule descriptions to generic terminology
 *
 * @param ruleText - Original rule text with MTG terminology
 * @returns Translated rule text with generic terminology
 */
export function translateRuleText(ruleText: string): string {
  return translateToGeneric(ruleText);
}

/**
 * Batch translate an array of strings
 *
 * @param texts - Array of texts to translate
 * @returns Array of translated texts
 */
export function translateBatch(texts: string[]): string[] {
  return texts.map(text => translateToGeneric(text));
}

/**
 * Checks if a term is an MTG-specific term that needs translation
 *
 * @param term - Term to check
 * @returns True if term needs translation
 */
export function isMTGTerm(term: string): boolean {
  return term.toLowerCase() in TERMINOLOGY_MAPPING;
}

/**
 * Gets all MTG terms that need translation
 *
 * @returns Array of MTG terms
 */
export function getAllMTGTerms(): string[] {
  return Object.keys(TERMINOLOGY_MAPPING);
}
