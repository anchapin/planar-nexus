/**
 * Game State Serialization
 *
 * Defines schema and provides serialization for game states.
 * Used for test fixture generation in GH#684.
 */

import type {
  GameState,
  CardInstance,
  Player,
  Zone,
  StackObject,
  Turn,
  Combat,
  WaitingChoice,
} from './types';

/**
 * Serialized game state format for test fixtures
 * Simplified version focused on test-relevant data
 */
export interface SerializedGameState {
  metadata: {
    gameId: string;
    format: string;
    createdAt: string;
    source?: string;
    complexityScore: number;
    description: string;
  };
  players: SerializedPlayer[];
  battlefield: SerializedCard[];
  hands: SerializedCard[];
  graveyards: SerializedCard[];
  stack: SerializedStackObject[];
  turn: SerializedTurn;
  combat?: SerializedCombat;
  waitingChoice?: SerializedWaitingChoice;
  status: string;
}

/**
 * Serialized player state
 */
export interface SerializedPlayer {
  id: string;
  name: string;
  life: number;
  poisonCounters: number;
  commanderDamage: { [playerId: string]: number };
  manaPool: SerializedManaPool;
  landsPlayedThisTurn: number;
  maxLandsPerTurn: number;
  handSize: number;
  hasPassedPriority: boolean;
}

/**
 * Serialized mana pool
 */
export interface SerializedManaPool {
  colorless: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  generic: number;
}

/**
 * Serialized card instance
 */
export interface SerializedCard {
  id: string;
  name: string;
  type: string;
  colors: string[];
  manaValue: number;
  oracleText: string;
  controllerId: string;
  ownerId: string;
  location: string;
  isTapped: boolean;
  counters: SerializedCounter[];
  damage: number;
  power?: number;
  toughness?: number;
  loyalty?: number;
  keywords: string[];
  isToken: boolean;
}

/**
 * Serialized counter on a card
 */
export interface SerializedCounter {
  type: string;
  count: number;
}

/**
 * Serialized stack object
 */
export interface SerializedStackObject {
  id: string;
  type: 'spell' | 'ability';
  name: string;
  text: string;
  manaCost: string | null;
  controllerId: string;
  targets: SerializedTarget[];
  timestamp: number;
}

/**
 * Serialized target
 */
export interface SerializedTarget {
  type: string;
  targetId: string;
}

/**
 * Serialized turn state
 */
export interface SerializedTurn {
  activePlayerId: string;
  currentPhase: string;
  turnNumber: number;
  extraTurns: number;
  isFirstTurn: boolean;
}

/**
 * Serialized combat state
 */
export interface SerializedCombat {
  inCombatPhase: boolean;
  attackers: SerializedAttacker[];
  blockers: SerializedBlocker[];
}

/**
 * Serialized attacker
 */
export interface SerializedAttacker {
  cardId: string;
  defenderId: string;
  isAttackingPlaneswalker: boolean;
  damageToDeal: number;
  hasFirstStrike: boolean;
  hasDoubleStrike: boolean;
}

/**
 * Serialized blocker
 */
export interface SerializedBlocker {
  cardId: string;
  attackerId: string;
  damageToDeal: number;
  blockerOrder: number;
  hasFirstStrike: boolean;
  hasDoubleStrike: boolean;
}

/**
 * Serialized waiting choice
 */
export interface SerializedWaitingChoice {
  type: string;
  playerId: string;
  prompt: string;
  minChoices: number;
  maxChoices: number;
}

/**
 * Fixture generation options
 */
export interface FixtureGenerationOptions {
  source?: string;
  description?: string;
  complexityThreshold?: number;
  includeFullState?: boolean;
}

/**
 * Default fixture generation options
 */
const DEFAULT_OPTIONS: FixtureGenerationOptions = {
  includeFullState: true,
  complexityThreshold: 0.5,
};

/**
 * Calculate complexity score of a game state
 * Higher score = more complex, better for edge case testing
 */
export function calculateComplexityScore(state: GameState): number {
  let score = 0;

  // Stack size adds complexity
  score += Math.min(state.stack.length * 0.2, 0.6);

  // Stack depth (spells targeting spells) adds complexity
  let stackDepth = 0;
  for (const obj of state.stack) {
    if (obj.targets.some(t => state.stack.some(s => s.id === t.targetId))) {
      stackDepth++;
    }
  }
  score += Math.min(stackDepth * 0.15, 0.3);

  // Complex combat adds complexity
  if (state.combat.inCombatPhase) {
    score += 0.2;
    if (state.combat.attackers.length > 2) score += 0.1;
    if (state.combat.blockers.size > 0) score += 0.15;
  }

  // Counters on cards add complexity
  let totalCounters = 0;
  for (const card of state.cards.values()) {
    totalCounters += card.counters.length;
  }
  score += Math.min(totalCounters * 0.05, 0.15);

  // Unique card types add complexity
  const uniqueTypes = new Set(
    Array.from(state.cards.values()).map(c => c.cardData.type_line)
  ).size;
  score += Math.min(uniqueTypes * 0.03, 0.15);

  // Waiting choice adds complexity
  if (state.waitingChoice) score += 0.2;

  return Math.min(score, 1.0);
}

/**
 * Serialize a mana pool
 */
function serializeManaPool(manaPool: any): SerializedManaPool {
  return {
    colorless: manaPool.colorless || 0,
    white: manaPool.white || 0,
    blue: manaPool.blue || 0,
    black: manaPool.black || 0,
    red: manaPool.red || 0,
    green: manaPool.green || 0,
    generic: manaPool.generic || 0,
  };
}

/**
 * Extract keywords from a card's data
 */
function extractKeywords(card: CardInstance): string[] {
  const keywords: string[] = [];

  // Keywords array
  if (card.cardData.keywords && Array.isArray(card.cardData.keywords)) {
    keywords.push(...card.cardData.keywords);
  }

  // Keywords from oracle text
  const oracleText = card.cardData.oracle_text || '';
  const keywordPatterns = [
    'Flying', 'First strike', 'Double strike', 'Deathtouch', 'Hexproof',
    'Indestructible', 'Lifelink', 'Trample', 'Vigilance', 'Haste',
    'Flash', 'Reach', 'Menace', 'Skulk', 'Prowess', 'Menace'
  ];

  for (const keyword of keywordPatterns) {
    if (oracleText.includes(keyword) && !keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  return keywords;
}

/**
 * Get card power/toughness
 */
function getCardPowerToughness(card: CardInstance): { power?: number; toughness?: number } {
  const pt = card.cardData.power || card.cardData.toughness
    ? {
        power: parseInt(card.cardData.power || '0', 10) + card.powerModifier,
        toughness: parseInt(card.cardData.toughness || '0', 10) + card.toughnessModifier - card.damage,
      }
    : {};

  return pt;
}

/**
 * Serialize a card instance
 */
function serializeCard(
  card: CardInstance,
  location: string
): SerializedCard {
  const pt = getCardPowerToughness(card);

  return {
    id: card.id,
    name: card.cardData.name,
    type: card.cardData.type_line,
    colors: card.cardData.colors || [],
    manaValue: card.cardData.cmc || 0,
    oracleText: card.cardData.oracle_text || '',
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    location,
    isTapped: card.isTapped,
    counters: card.counters.map(c => ({ type: c.type, count: c.count })),
    damage: card.damage,
    ...pt,
    keywords: extractKeywords(card),
    isToken: card.isToken,
  };
}

/**
 * Serialize a player state
 */
function serializePlayer(player: Player): SerializedPlayer {
  const commanderDamageObj: { [key: string]: number } = {};
  player.commanderDamage.forEach((damage, playerId) => {
    commanderDamageObj[playerId] = damage;
  });

  return {
    id: player.id,
    name: player.name,
    life: player.life,
    poisonCounters: player.poisonCounters,
    commanderDamage: commanderDamageObj,
    manaPool: serializeManaPool(player.manaPool),
    landsPlayedThisTurn: player.landsPlayedThisTurn,
    maxLandsPerTurn: player.maxLandsPerTurn,
    handSize: player.currentHandSizeModifier,
    hasPassedPriority: player.hasPassedPriority,
  };
}

/**
 * Serialize a stack object
 */
function serializeStackObject(obj: StackObject): SerializedStackObject {
  return {
    id: obj.id,
    type: obj.type,
    name: obj.name,
    text: obj.text,
    manaCost: obj.manaCost,
    controllerId: obj.controllerId,
    targets: obj.targets.map(t => ({
      type: t.type,
      targetId: t.targetId,
    })),
    timestamp: obj.timestamp,
  };
}

/**
 * Serialize combat state
 */
function serializeCombat(combat: Combat): SerializedCombat {
  return {
    inCombatPhase: combat.inCombatPhase,
    attackers: combat.attackers.map(a => ({
      cardId: a.cardId,
      defenderId: a.defenderId,
      isAttackingPlaneswalker: a.isAttackingPlaneswalker,
      damageToDeal: a.damageToDeal,
      hasFirstStrike: a.hasFirstStrike,
      hasDoubleStrike: a.hasDoubleStrike,
    })),
    blockers: Array.from(combat.blockers.values()).flat().map(b => ({
      cardId: b.cardId,
      attackerId: b.attackerId,
      damageToDeal: b.damageToDeal,
      blockerOrder: b.blockerOrder,
      hasFirstStrike: b.hasFirstStrike,
      hasDoubleStrike: b.hasDoubleStrike,
    })),
  };
}

/**
 * Serialize turn state
 */
function serializeTurn(turn: Turn): SerializedTurn {
  return {
    activePlayerId: turn.activePlayerId,
    currentPhase: turn.currentPhase,
    turnNumber: turn.turnNumber,
    extraTurns: turn.extraTurns,
    isFirstTurn: turn.isFirstTurn,
  };
}

/**
 * Serialize waiting choice
 */
function serializeWaitingChoice(choice: WaitingChoice): SerializedWaitingChoice {
  return {
    type: choice.type,
    playerId: choice.playerId,
    prompt: choice.prompt,
    minChoices: choice.minChoices,
    maxChoices: choice.maxChoices,
  };
}

/**
 * Serialize a complete game state
 */
export function serializeGameState(
  state: GameState,
  options: FixtureGenerationOptions = {}
): SerializedGameState {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const complexityScore = calculateComplexityScore(state);

  const battlefield: SerializedCard[] = [];
  const hands: SerializedCard[] = [];
  const graveyards: SerializedCard[] = [];

  // Collect cards by location
  for (const [zoneId, zone] of state.zones.entries()) {
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId);
      if (!card) continue;

      const serialized = serializeCard(card, zoneId);

      switch (zone.type) {
        case 'battlefield':
          battlefield.push(serialized);
          break;
        case 'hand':
          hands.push(serialized);
          break;
        case 'graveyard':
          graveyards.push(serialized);
          break;
      }
    }
  }

  // Serialize all components
  return {
    metadata: {
      gameId: state.gameId,
      format: state.format,
      createdAt: new Date(state.createdAt).toISOString(),
      source: opts.source,
      complexityScore,
      description: opts.description || `Complex game state (${complexityScore.toFixed(2)})`,
    },
    players: Array.from(state.players.values()).map(serializePlayer),
    battlefield,
    hands,
    graveyards,
    stack: state.stack.map(serializeStackObject),
    turn: serializeTurn(state.turn),
    combat: state.combat.inCombatPhase ? serializeCombat(state.combat) : undefined,
    waitingChoice: state.waitingChoice ? serializeWaitingChoice(state.waitingChoice) : undefined,
    status: state.status,
  };
}

/**
 * Deserialize a game state (for loading test fixtures)
 */
export function deserializeGameState(
  serialized: SerializedGameState
): Partial<GameState> {
  // Implementation would reverse the serialization
  // For now, return minimal partial state
  return {
    gameId: serialized.metadata.gameId,
    format: serialized.metadata.format,
    createdAt: new Date(serialized.metadata.createdAt).getTime(),
    status: serialized.status as any,
  };
}

/**
 * Generate a test fixture description
 */
export function generateFixtureDescription(state: GameState): string {
  const parts: string[] = [];

  // Stack description
  if (state.stack.length > 0) {
    parts.push(`${state.stack.length} objects on stack`);
  }

  // Combat description
  if (state.combat.inCombatPhase) {
    const attackers = state.combat.attackers.length;
    const blockers = state.combat.blockers.size;
    parts.push(`${attackers} attackers, ${blockers} blockers`);
  }

  // Card description
  const battlefieldCount = Array.from(state.zones.values())
    .filter(z => z.type === 'battlefield')
    .reduce((sum, z) => sum + z.cardIds.length, 0);
  parts.push(`${battlefieldCount} permanents`);

  return parts.join(', ');
}
