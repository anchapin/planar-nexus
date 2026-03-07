/**
 * Game System Adapter
 *
 * ISSUE #435: Unit 1 - Generic Card Game Framework Core
 *
 * This module provides an abstraction layer that allows the generic card game
 * framework to support different game systems. It adapts the internal game state
 * to different rule sets, resource systems, and win conditions.
 *
 * The adapter pattern enables:
 * 1. Multiple game systems to coexist in the same codebase
 * 2. Easy addition of new game systems without modifying core logic
 * 3. Clean separation between generic framework and specific implementations
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ManaPool,
  ResourcePool,
  ResourceCost,
  LegendaryLeader,
} from './types';

/**
 * Game system configuration interface
 * Defines the parameters that make each game system unique
 */
export interface GameSystemConfig {
  /** Unique identifier for this game system */
  id: string;
  /** Display name for this game system */
  name: string;
  /** Description of this game system */
  description: string;

  // Resource system
  /** Type of resource system (e.g., 'mana', 'energy', 'action-points') */
  resourceType: string;
  /** Maximum resources per turn */
  maxResourcesPerTurn: number;
  /** Resources empty at end of turn? */
  emptyResourcesAtEndOfTurn: boolean;

  // Win conditions
  /** Starting life total */
  startingLife: number;
  /** Damage threshold for leader defeat (if applicable) */
  leaderDamageThreshold: number | null;
  /** Poison counter threshold (if applicable) */
  poisonThreshold: number | null;
  /** Deck out loss condition? */
  loseOnEmptyDeck: boolean;

  // Deck construction
  /** Minimum deck size */
  minDeckSize: number;
  /** Maximum deck size */
  maxDeckSize: number;
  /** Maximum copies per card */
  maxCopiesPerCard: number;
  /** Uses legendary leader? */
  usesLeader: boolean;
  /** Leader zone name */
  leaderZoneName: string;

  // Card types
  /** Card type mapping (internal → display) */
  cardTypeMappings: Record<string, string>;
  /** Card types that are resources */
  resourceCardTypes: string[];
}

/**
 * Default game system configuration (MTG-like)
 */
export const DEFAULT_GAME_SYSTEM: GameSystemConfig = {
  id: 'mtg-like',
  name: 'Resource-Based Card Game',
  description: 'A card game with resource system, legendary leaders, and strategic combat',

  resourceType: 'mana',
  maxResourcesPerTurn: 1,
  emptyResourcesAtEndOfTurn: true,

  startingLife: 20,
  leaderDamageThreshold: 21,
  poisonThreshold: 10,
  loseOnEmptyDeck: true,

  minDeckSize: 60,
  maxDeckSize: Infinity,
  maxCopiesPerCard: 4,
  usesLeader: false,
  leaderZoneName: 'reserve',

  cardTypeMappings: {
    'land': 'source',
    'planeswalker': 'champion',
    'commander': 'legendary leader',
  },
  resourceCardTypes: ['land'],
};

/**
 * Legendary Commander game system configuration
 */
export const LEGENDARY_COMMANDER_SYSTEM: GameSystemConfig = {
  ...DEFAULT_GAME_SYSTEM,
  id: 'legendary-commander',
  name: 'Legendary Commander',
  description: 'Leader-based format with 100-card decks and 40 starting life',

  startingLife: 40,
  leaderDamageThreshold: 21,
  minDeckSize: 100,
  maxDeckSize: 100,
  maxCopiesPerCard: 1,
  usesLeader: true,
  leaderZoneName: 'reserve',
};

/**
 * Game System Registry
 * Stores all available game systems
 */
const gameSystemRegistry = new Map<string, GameSystemConfig>();

/**
 * Register a game system configuration
 */
export function registerGameSystem(config: GameSystemConfig): void {
  gameSystemRegistry.set(config.id, config);
}

/**
 * Get a game system configuration by ID
 */
export function getGameSystem(id: string): GameSystemConfig | undefined {
  return gameSystemRegistry.get(id);
}

/**
 * Get all registered game systems
 */
export function getAllGameSystems(): GameSystemConfig[] {
  return Array.from(gameSystemRegistry.values());
}

/**
 * Initialize default game systems
 */
export function initializeDefaultGameSystems(): void {
  registerGameSystem(DEFAULT_GAME_SYSTEM);
  registerGameSystem(LEGENDARY_COMMANDER_SYSTEM);
}

// Auto-initialize default systems
initializeDefaultGameSystems();

/**
 * Adapt ManaPool to generic ResourcePool interface
 * Converts MTG-like mana system to generic resource system
 */
export function adaptManaPoolToResourcePool(manaPool: ManaPool): ResourcePool {
  const resources = new Map<string, number>();
  resources.set('colorless', manaPool.colorless);
  resources.set('white', manaPool.white);
  resources.set('blue', manaPool.blue);
  resources.set('black', manaPool.black);
  resources.set('red', manaPool.red);
  resources.set('green', manaPool.green);
  resources.set('generic', manaPool.generic);

  return {
    type: 'mana',
    total: getTotalMana(manaPool),
    resources,
    maximum: Infinity,
  };
}

/**
 * Calculate total mana in a pool
 */
function getTotalMana(manaPool: ManaPool): number {
  return (
    manaPool.colorless +
    manaPool.white +
    manaPool.blue +
    manaPool.black +
    manaPool.red +
    manaPool.green +
    manaPool.generic
  );
}

/**
 * Adapt generic ResourcePool back to ManaPool
 * Converts generic resource system to MTG-like mana system
 */
export function adaptResourcePoolToManaPool(resourcePool: ResourcePool): ManaPool {
  return {
    colorless: resourcePool.resources.get('colorless') || 0,
    white: resourcePool.resources.get('white') || 0,
    blue: resourcePool.resources.get('blue') || 0,
    black: resourcePool.resources.get('black') || 0,
    red: resourcePool.resources.get('red') || 0,
    green: resourcePool.resources.get('green') || 0,
    generic: resourcePool.resources.get('generic') || 0,
  };
}

/**
 * Check if a resource cost can be paid with available resources
 * Generic function that works with any resource system
 */
export function canPayResourceCost(
  available: ResourcePool,
  cost: ResourceCost
): boolean {
  // Check if resource type matches
  if (available.type !== cost.resourceType) {
    return false;
  }

  // Check total amount
  if (available.total < cost.amount) {
    return false;
  }

  // Check specific requirements
  for (const [requirementType, requiredAmount] of cost.requirements.entries()) {
    const availableAmount = available.resources.get(requirementType) || 0;
    if (availableAmount < requiredAmount) {
      return false;
    }
  }

  return true;
}

/**
 * Get resource cost for a card
 * Abstracts the cost calculation for different game systems
 */
export function getCardResourceCost(
  card: { mana_cost?: string; cost?: string },
  gameSystem: GameSystemConfig
): ResourceCost {
  const manaCost = card.mana_cost || card.cost || '';
  const requirements = new Map<string, number>();

  // Parse mana cost string (MTG-like format)
  const matches = manaCost.match(/{[^}]+}/g) || [];
  let totalAmount = 0;

  for (const match of matches) {
    const symbol = match.slice(1, -1).toUpperCase();

    if (/^\d+$/.test(symbol)) {
      // Generic mana cost
      totalAmount += parseInt(symbol, 10);
    } else if (symbol === 'W') {
      requirements.set('white', (requirements.get('white') || 0) + 1);
      totalAmount += 1;
    } else if (symbol === 'U') {
      requirements.set('blue', (requirements.get('blue') || 0) + 1);
      totalAmount += 1;
    } else if (symbol === 'B') {
      requirements.set('black', (requirements.get('black') || 0) + 1);
      totalAmount += 1;
    } else if (symbol === 'R') {
      requirements.set('red', (requirements.get('red') || 0) + 1);
      totalAmount += 1;
    } else if (symbol === 'G') {
      requirements.set('green', (requirements.get('green') || 0) + 1);
      totalAmount += 1;
    } else if (symbol === 'C') {
      requirements.set('colorless', (requirements.get('colorless') || 0) + 1);
      totalAmount += 1;
    }
  }

  return {
    resourceType: gameSystem.resourceType,
    amount: totalAmount,
    requirements,
  };
}

/**
 * Check if a player can play a resource source card
 * Generic function that works with any game system
 */
export function canPlayResourceSource(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  gameSystem: GameSystemConfig
): boolean {
  const player = state.players.get(playerId);
  if (!player) {
    return false;
  }

  // Check if player has resource plays remaining
  if (player.landsPlayedThisTurn >= gameSystem.maxResourcesPerTurn) {
    return false;
  }

  // Verify card is a resource source type
  const card = state.cards.get(cardId);
  if (!card) {
    return false;
  }

  const typeLine = card.cardData.type_line?.toLowerCase() || '';
  const isResourceSource = gameSystem.resourceCardTypes.some(type =>
    typeLine.includes(type)
  );

  if (!isResourceSource) {
    return false;
  }

  return true;
}

/**
 * Get legendary leader for a player (if applicable)
 * Generic function that works with leader-based formats
 */
export function getPlayerLegendaryLeader(
  state: GameState,
  playerId: PlayerId,
  gameSystem: GameSystemConfig
): LegendaryLeader | null {
  if (!gameSystem.usesLeader) {
    return null;
  }

  const player = state.players.get(playerId);
  if (!player) {
    return null;
  }

  // Find commander in commander damage map
  const commanderId = Array.from(player.commanderDamage.keys())[0];
  if (!commanderId) {
    return null;
  }

  const commander = state.cards.get(commanderId);
  if (!commander) {
    return null;
  }

  return {
    id: commanderId,
    name: commander.cardData.name,
    ownerId: playerId,
    identity: commander.cardData.colors || [],
    damageDealt: player.commanderDamage,
    castCount: player.commanderCastCount,
    isInReserveZone: player.isInCommandZone,
  };
}

/**
 * Check win conditions for a player
 * Generic function that checks all applicable win conditions
 */
export interface WinConditionCheck {
  hasWon: boolean;
  reason: string | null;
}

export function checkWinConditions(
  state: GameState,
  playerId: PlayerId,
  gameSystem: GameSystemConfig
): WinConditionCheck {
  const player = state.players.get(playerId);
  if (!player) {
    return { hasWon: false, reason: null };
  }

  // Check if player has already lost
  if (player.hasLost) {
    return { hasWon: false, reason: null };
  }

  // Count active players
  const activePlayers = Array.from(state.players.values()).filter(p => !p.hasLost);

  // If only one player remains, they win
  if (activePlayers.length === 1 && activePlayers[0].id === playerId) {
    return {
      hasWon: true,
      reason: 'All opponents defeated',
    };
  }

  // Check leader damage win condition
  if (gameSystem.leaderDamageThreshold !== null) {
    for (const [opponentId, opponent] of state.players) {
      if (opponentId !== playerId && !opponent.hasLost) {
        // Check if player's leader has dealt enough damage
        const damageFromPlayer = opponent.commanderDamage.get(playerId) || 0;
        if (damageFromPlayer >= gameSystem.leaderDamageThreshold) {
          return {
            hasWon: false,
            reason: null,
          };
        }
      }
    }
  }

  // No win condition met yet
  return { hasWon: false, reason: null };
}

/**
 * Check loss conditions for a player
 * Generic function that checks all applicable loss conditions
 */
export interface LossConditionCheck {
  hasLost: boolean;
  reason: string | null;
}

export function checkLossConditions(
  state: GameState,
  playerId: PlayerId,
  gameSystem: GameSystemConfig
): LossConditionCheck {
  const player = state.players.get(playerId);
  if (!player) {
    return { hasLost: true, reason: 'Player not found' };
  }

  // Check life total
  if (player.life <= 0) {
    return {
      hasLost: true,
      reason: 'Life total reached 0',
    };
  }

  // Check poison counters
  if (gameSystem.poisonThreshold !== null && player.poisonCounters >= gameSystem.poisonThreshold) {
    return {
      hasLost: true,
      reason: 'Poison counter threshold reached',
    };
  }

  // Check deck out
  if (gameSystem.loseOnEmptyDeck) {
    const libraryZone = state.zones.get(`${playerId}-library`);
    if (libraryZone && libraryZone.cardIds.length === 0) {
      return {
        hasLost: true,
        reason: 'Deck depleted',
      };
    }
  }

  // Check leader damage taken
  if (gameSystem.leaderDamageThreshold !== null) {
    for (const [, damage] of player.commanderDamage) {
      if (damage >= gameSystem.leaderDamageThreshold) {
        return {
          hasLost: true,
          reason: 'Legendary leader damage threshold reached',
        };
      }
    }
  }

  // No loss condition met
  return { hasLost: false, reason: null };
}

/**
 * Translate game system-specific terminology
 * Converts internal MTG-like terminology to game-specific terminology
 */
export function translateGameSystemTerm(
  term: string,
  gameSystem: GameSystemConfig
): string {
  // Apply card type mappings
  for (const [internal, display] of Object.entries(gameSystem.cardTypeMappings)) {
    if (term.toLowerCase() === internal.toLowerCase()) {
      return display;
    }
  }

  // Default to original term
  return term;
}

/**
 * Get game system for a game state
 * Determines the game system based on the format
 */
export function getGameSystemForState(state: GameState): GameSystemConfig {
  // Map format IDs to game system IDs
  const formatToSystem: Record<string, string> = {
    'legendary-commander': 'legendary-commander',
    'commander': 'legendary-commander',
    'constructed-core': 'mtg-like',
    'standard': 'mtg-like',
    'constructed-legacy': 'mtg-like',
    'modern': 'mtg-like',
    'constructed-vintage': 'mtg-like',
    'vintage': 'mtg-like',
  };

  const systemId = formatToSystem[state.format] || 'mtg-like';
  return getGameSystem(systemId) || DEFAULT_GAME_SYSTEM;
}
