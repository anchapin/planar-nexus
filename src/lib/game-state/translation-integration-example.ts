/**
 * Terminology Translation Layer - Integration Examples
 *
 * This file provides practical examples of how to integrate the terminology
 * translation layer throughout the application.
 *
 * Issue #442: Unit 8 - Terminology Translation Layer
 */

import {
  translateToGeneric,
  translateZone,
  translatePhase,
  translateAction,
  translateCardState,
  getCardStateDescription,
  translateRuleText,
} from './terminology-translation';

/**
 * Example 1: Translating card oracle text for display
 */
export function displayCardOracleText(oracleText: string): string {
  return translateToGeneric(oracleText);
}

/**
 * Example 2: Displaying zone names in UI
 */
export function displayZoneName(zoneType: string): string {
  return translateZone(zoneType);
}

/**
 * Example 3: Displaying phase names in turn indicator
 */
export function displayPhaseName(phase: string): string {
  return translatePhase(phase);
}

/**
 * Example 4: Displaying action descriptions in game log
 */
export function displayActionDescription(actionType: string): string {
  return translateAction(actionType);
}

/**
 * Example 5: Displaying card state in tooltip
 */
export function displayCardState(cardState: {
  isTapped: boolean;
  hasSummoningSickness: boolean;
  isPhasedOut?: boolean;
}): string {
  const state = translateCardState({
    isTapped: cardState.isTapped,
    hasSummoningSickness: cardState.hasSummoningSickness,
    isPhasedOut: cardState.isPhasedOut ?? false,
  });

  const descriptions: string[] = [];
  if (state.activation === 'activated') {
    descriptions.push('Activated');
  }
  if (state.deployment === 'restricted') {
    descriptions.push('Has deployment restriction');
  }
  if (state.visibility === 'phased out') {
    descriptions.push('Phased out');
  }

  return descriptions.length > 0 ? descriptions.join(', ') : 'Ready';
}

/**
 * Example 6: Translating game rule text for tooltips
 */
export function displayGameRule(ruleText: string): string {
  return translateRuleText(ruleText);
}

/**
 * Example 7: Creating a game log entry with translated text
 */
export interface GameLogEntry {
  timestamp: number;
  playerId: string;
  playerName: string;
  action: string;
  details: string;
}

export function createGameLogEntry(
  playerId: string,
  playerName: string,
  actionType: string,
  details: string
): GameLogEntry {
  return {
    timestamp: Date.now(),
    playerId,
    playerName,
    action: translateAction(actionType),
    details: translateToGeneric(details),
  };
}

/**
 * Example 8: Translating stack items for display
 */
export interface StackItemDisplay {
  id: string;
  name: string;
  controller: string;
  type: 'spell' | 'ability';
  oracleText?: string;
  translatedText?: string;
}

export function displayStackItem(item: StackItemDisplay): StackItemDisplay {
  return {
    ...item,
    translatedText: item.oracleText ? translateToGeneric(item.oracleText) : undefined,
  };
}

/**
 * Example 9: Translating zone viewer content
 */
export interface ZoneContent {
  zoneType: string;
  cards: Array<{
    id: string;
    name: string;
    oracleText?: string;
  }>;
}

export function displayZoneContent(zoneContent: ZoneContent): {
  zoneName: string;
  cards: Array<{
    id: string;
    name: string;
    translatedOracleText?: string;
  }>;
} {
  return {
    zoneName: translateZone(zoneContent.zoneType),
    cards: zoneContent.cards.map(card => ({
      id: card.id,
      name: card.name,
      translatedOracleText: card.oracleText ? translateToGeneric(card.oracleText) : undefined,
    })),
  };
}

/**
 * Example 10: Creating a card tooltip with translated information
 */
export interface CardTooltipInfo {
  name: string;
  typeLine: string;
  oracleText?: string;
  state?: {
    isTapped: boolean;
    hasSummoningSickness: boolean;
  };
}

export function createCardTooltip(info: CardTooltipInfo): {
  name: string;
  typeLine: string;
  translatedOracleText?: string;
  stateDescription?: string;
} {
  return {
    name: info.name,
    typeLine: info.typeLine,
    translatedOracleText: info.oracleText ? translateToGeneric(info.oracleText) : undefined,
    stateDescription: info.state ? getCardStateDescription(info.state) : undefined,
  };
}

/**
 * Example 11: Translating ability descriptions
 */
export interface Ability {
  name: string;
  text: string;
  manaCost?: string;
}

export function displayAbility(ability: Ability): {
  name: string;
  translatedText: string;
  manaCost?: string;
} {
  return {
    name: ability.name,
    translatedText: translateToGeneric(ability.text),
    manaCost: ability.manaCost,
  };
}

/**
 * Example 12: Translating combat messages
 */
export interface CombatMessage {
  attacker: string;
  blockers: string[];
  damage?: number;
}

export function displayCombatMessage(message: CombatMessage): string {
  const attackerText = message.attacker;
  const blockerText = message.blockers.join(', ');

  if (message.damage) {
    return `${attackerText} attacks ${blockerText || 'player'} for ${message.damage} damage`;
  }

  return `${attackerText} attacks ${blockerText || 'player'}`;
}

/**
 * Example 13: Translating turn phase display
 */
export interface TurnPhaseDisplay {
  phase: string;
  step?: string;
  turnNumber: number;
  activePlayer: string;
}

export function displayTurnPhase(turnPhase: TurnPhaseDisplay): string {
  const phaseName = translatePhase(turnPhase.phase);
  return `Turn ${turnPhase.turnNumber}: ${turnPhase.activePlayer}'s ${phaseName}`;
}

/**
 * Example 14: Translating deck statistics
 */
export interface DeckStatistics {
  totalCards: number;
  lands: number;
  creatures: number;
  spells: number;
  averageManaCost: number;
}

export function displayDeckStatistics(stats: DeckStatistics): {
  totalCards: string;
  landCount: string;
  creatureCount: string;
  spellCount: string;
  averageCost: string;
} {
  return {
    totalCards: `${stats.totalCards} cards`,
    landCount: `${stats.lands} lands`,
    creatureCount: `${stats.creatures} creatures`,
    spellCount: `${stats.spells} card effects`,
    averageCost: `Average energy cost: ${stats.averageManaCost.toFixed(2)}`,
  };
}

/**
 * Example 15: Translating win condition messages
 */
export function displayWinCondition(condition: 'combat' | 'poison' | 'deck'): string {
  switch (condition) {
    case 'combat':
      return 'Reduced life total to 0 or less';
    case 'poison':
      return 'Accumulated 10 poison counters';
    case 'deck':
      return 'Player attempted to draw from an empty draw pile';
  }
}

/**
 * Example 16: Translating error messages
 */
export function displayGameError(error: string): string {
  return translateToGeneric(error);
}

/**
 * Example 17: Translating instruction text
 */
export function displayInstructions(instructions: string[]): string[] {
  return instructions.map(instruction => translateToGeneric(instruction));
}

/**
 * Example 18: Translating tooltip help text
 */
export function displayTooltipHelp(helpText: string): string {
  return translateToGeneric(helpText);
}

/**
 * Example 19: Translating card type indicators
 */
export function displayCardType(typeLine: string): string {
  // Card types like "Creature", "Instant", etc. don't need translation
  // but abilities within the type line might
  return translateToGeneric(typeLine);
}

/**
 * Example 20: Translating mana cost display
 */
export function displayManaCost(manaCost: string): string {
  // Mana symbols don't need translation, but "mana" in text does
  return manaCost; // Keep as is for now - mana symbols are symbols
}

/**
 * Usage Example:
 *
 * ```typescript
 * // Display card oracle text
 * const oracleText = "Tap target creature an opponent controls.";
 * const displayText = displayCardOracleText(oracleText);
 * console.log(displayText); // "Activate target creature an opponent controls."
 *
 * // Display zone name
 * const zoneName = displayZoneName('graveyard');
 * console.log(zoneName); // "Discard Pile"
 *
 * // Display card state
 * const stateDescription = displayCardState({
 *   isTapped: true,
 *   hasSummoningSickness: true,
 *   isPhasedOut: false
 * });
 * console.log(stateDescription); // "Activated, Has deployment restriction"
 *
 * // Create game log entry
 * const logEntry = createGameLogEntry(
 *   'player-1',
 *   'Alice',
 *   'cast_spell',
 *   'Cast Lightning Bolt'
 * );
 * console.log(logEntry);
 * // { timestamp: ..., playerId: 'player-1', playerName: 'Alice',
 * //   action: 'Play card effect', details: 'Play Lightning Bolt' }
 * ```
 */
