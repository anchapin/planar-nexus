/**
 * @fileOverview Game state serialization for save/load functionality
 *
 * Issue #31: Phase 2.3: Implement game state serialization
 *
 * Provides:
 * - Serialize game state to JSON
 * - Include all zones and card states
 * - Handle random number generator state
 * - Timestamp and metadata
 * - Version handling for backwards compatibility
 */

import type { GameState, CardInstance, Player, Zone, StackObject, Turn, Combat, WaitingChoice, ManaPool } from './types';

/**
 * Current serialization version
 */
export const SERIALIZATION_VERSION = '1.0.0';

/**
 * Minimum supported version for migrations
 */
export const MIN_SUPPORTED_VERSION = '1.0.0';

/**
 * Serialized game state metadata
 */
export interface SerializedGameMetadata {
  /** Version of the serialization format */
  version: string;
  /** When the save was created */
  savedAt: number;
  /** When the game was originally created */
  gameCreatedAt: number;
  /** When the game was last modified */
  gameLastModifiedAt: number;
  /** Description of the save */
  description?: string;
}

/**
 * Complete serialized game state
 */
export interface SerializedGameState {
  /** Metadata about the save */
  metadata: SerializedGameMetadata;
  /** The serialized game state */
  state: SerializedGameStateData;
}

/**
 * Serializable game state data (without Maps)
 */
export interface SerializedGameStateData {
  /** Unique game identifier */
  gameId: string;
  /** All players in the game */
  players: SerializedPlayer[];
  /** All card instances */
  cards: SerializedCardInstance[];
  /** All zones */
  zones: SerializedZone[];
  /** Objects currently on the stack */
  stack: SerializedStackObject[];
  /** Current turn state */
  turn: SerializedTurn;
  /** Combat state */
  combat: SerializedCombat;
  /** Current choice waiting for player input */
  waitingChoice: SerializedWaitingChoice | null;
  /** Player who has priority */
  priorityPlayerId: string | null;
  /** Number of consecutive passes */
  consecutivePasses: number;
  /** Game status */
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  /** Winner(s) of the game */
  winners: string[];
  /** How the game ended */
  endReason: string | null;
  /** Game format */
  format: string;
}

/**
 * Serializable player data
 */
export interface SerializedPlayer {
  id: string;
  name: string;
  life: number;
  poisonCounters: number;
  commanderDamage: [string, number][];
  maxHandSize: number;
  currentHandSizeModifier: number;
  hasLost: boolean;
  lossReason: string | null;
  landsPlayedThisTurn: number;
  maxLandsPerTurn: number;
  manaPool: SerializedManaPool;
  isInCommandZone: boolean;
  experienceCounters: number;
  commanderCastCount: number;
  hasPassedPriority: boolean;
  hasActivatedManaAbility: boolean;
  additionalCombatPhase: boolean;
  additionalMainPhase: boolean;
  hasOfferedDraw: boolean;
  hasAcceptedDraw: boolean;
}

/**
 * Serializable mana pool
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
 * Serializable card instance
 */
export interface SerializedCardInstance {
  id: string;
  oracleId: string;
  cardData: unknown; // ScryfallCard - serialized as-is
  currentFaceIndex: number;
  isFaceDown: boolean;
  controllerId: string;
  ownerId: string;
  isTapped: boolean;
  isFlipped: boolean;
  isTurnedFaceUp: boolean;
  isPhasedOut: boolean;
  hasSummoningSickness: boolean;
  counters: { type: string; count: number }[];
  damage: number;
  toughnessModifier: number;
  powerModifier: number;
  attachedToId: string | null;
  attachedCardIds: string[];
  enteredBattlefieldTimestamp: number;
  attachedTimestamp: number | null;
  isToken: boolean;
  tokenData: unknown | null;
}

/**
 * Serializable zone
 */
export interface SerializedZone {
  id: string;
  type: string;
  playerId: string | null;
  cardIds: string[];
  isRevealed: boolean;
  visibleTo: string[];
}

/**
 * Serializable stack object
 */
export interface SerializedStackObject {
  id: string;
  type: 'spell' | 'ability';
  sourceCardId: string | null;
  controllerId: string;
  name: string;
  text: string;
  manaCost: string | null;
  targets: { type: string; targetId: string; isValid: boolean }[];
  chosenModes: string[];
  variableValues: [string, number][];
  isCountered: boolean;
  timestamp: number;
}

/**
 * Serializable turn
 */
export interface SerializedTurn {
  activePlayerId: string;
  currentPhase: string;
  turnNumber: number;
  extraTurns: number;
  isFirstTurn: boolean;
  startedAt: number;
}

/**
 * Serializable combat
 */
export interface SerializedCombat {
  inCombatPhase: boolean;
  attackers: SerializedAttacker[];
  blockers: [string, SerializedBlocker[]][];
  remainingCombatPhases: number;
}

/**
 * Serializable attacker
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
 * Serializable blocker
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
 * Serializable waiting choice
 */
export interface SerializedWaitingChoice {
  type: string;
  playerId: string;
  stackObjectId: string | null;
  prompt: string;
  choices: { label: string; value: unknown; isValid: boolean }[];
  minChoices: number;
  maxChoices: number;
  presentedAt: number;
}

/**
 * Serialize a player to JSON-compatible format
 */
function serializePlayer(player: Player): SerializedPlayer {
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    poisonCounters: player.poisonCounters,
    commanderDamage: Array.from(player.commanderDamage.entries()),
    maxHandSize: player.maxHandSize,
    currentHandSizeModifier: player.currentHandSizeModifier,
    hasLost: player.hasLost,
    lossReason: player.lossReason,
    landsPlayedThisTurn: player.landsPlayedThisTurn,
    maxLandsPerTurn: player.maxLandsPerTurn,
    manaPool: serializeManaPool(player.manaPool),
    isInCommandZone: player.isInCommandZone,
    experienceCounters: player.experienceCounters,
    commanderCastCount: player.commanderCastCount,
    hasPassedPriority: player.hasPassedPriority,
    hasActivatedManaAbility: player.hasActivatedManaAbility,
    additionalCombatPhase: player.additionalCombatPhase,
    additionalMainPhase: player.additionalMainPhase,
    hasOfferedDraw: player.hasOfferedDraw,
    hasAcceptedDraw: player.hasAcceptedDraw,
  };
}

/**
 * Serialize a mana pool
 */
function serializeManaPool(manaPool: ManaPool): SerializedManaPool {
  return {
    colorless: manaPool.colorless,
    white: manaPool.white,
    blue: manaPool.blue,
    black: manaPool.black,
    red: manaPool.red,
    green: manaPool.green,
    generic: manaPool.generic,
  };
}

/**
 * Serialize a card instance
 */
function serializeCardInstance(card: CardInstance): SerializedCardInstance {
  return {
    id: card.id,
    oracleId: card.oracleId,
    cardData: card.cardData,
    currentFaceIndex: card.currentFaceIndex,
    isFaceDown: card.isFaceDown,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    isTapped: card.isTapped,
    isFlipped: card.isFlipped,
    isTurnedFaceUp: card.isTurnedFaceUp,
    isPhasedOut: card.isPhasedOut,
    hasSummoningSickness: card.hasSummoningSickness,
    counters: card.counters.map(c => ({ type: c.type, count: c.count })),
    damage: card.damage,
    toughnessModifier: card.toughnessModifier,
    powerModifier: card.powerModifier,
    attachedToId: card.attachedToId,
    attachedCardIds: Array.from(card.attachedCardIds),
    enteredBattlefieldTimestamp: card.enteredBattlefieldTimestamp,
    attachedTimestamp: card.attachedTimestamp,
    isToken: card.isToken,
    tokenData: card.tokenData,
  };
}

/**
 * Serialize a zone
 */
function serializeZone(zone: Zone, id: string): SerializedZone {
  return {
    id,
    type: zone.type,
    playerId: zone.playerId,
    cardIds: [...zone.cardIds],
    isRevealed: zone.isRevealed,
    visibleTo: [...zone.visibleTo],
  };
}

/**
 * Serialize a stack object
 */
function serializeStackObject(obj: StackObject): SerializedStackObject {
  return {
    id: obj.id,
    type: obj.type,
    sourceCardId: obj.sourceCardId,
    controllerId: obj.controllerId,
    name: obj.name,
    text: obj.text,
    manaCost: obj.manaCost,
    targets: obj.targets.map(t => ({ type: t.type, targetId: t.targetId, isValid: t.isValid })),
    chosenModes: [...obj.chosenModes],
    variableValues: Array.from(obj.variableValues.entries()),
    isCountered: obj.isCountered,
    timestamp: obj.timestamp,
  };
}

/**
 * Serialize a turn
 */
function serializeTurn(turn: Turn): SerializedTurn {
  return {
    activePlayerId: turn.activePlayerId,
    currentPhase: turn.currentPhase,
    turnNumber: turn.turnNumber,
    extraTurns: turn.extraTurns,
    isFirstTurn: turn.isFirstTurn,
    startedAt: turn.startedAt,
  };
}

/**
 * Serialize combat
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
    blockers: Array.from(combat.blockers.entries()),
    remainingCombatPhases: combat.remainingCombatPhases,
  };
}

/**
 * Serialize waiting choice
 */
function serializeWaitingChoice(choice: WaitingChoice | null): SerializedWaitingChoice | null {
  if (!choice) return null;

  return {
    type: choice.type,
    playerId: choice.playerId,
    stackObjectId: choice.stackObjectId,
    prompt: choice.prompt,
    choices: choice.choices.map(c => ({
      label: c.label,
      value: c.value,
      isValid: c.isValid,
    })),
    minChoices: choice.minChoices,
    maxChoices: choice.maxChoices,
    presentedAt: choice.presentedAt,
  };
}

/**
 * Serialize game state to JSON-compatible format
 */
export function serializeGameState(
  state: GameState,
  description?: string
): SerializedGameState {
  const serializedData: SerializedGameStateData = {
    gameId: state.gameId,
    players: Array.from(state.players.values()).map(serializePlayer),
    cards: Array.from(state.cards.values()).map(serializeCardInstance),
    zones: Array.from(state.zones.entries()).map(([id, zone]) => serializeZone(zone, id)),
    stack: state.stack.map(serializeStackObject),
    turn: serializeTurn(state.turn),
    combat: serializeCombat(state.combat),
    waitingChoice: serializeWaitingChoice(state.waitingChoice),
    priorityPlayerId: state.priorityPlayerId,
    consecutivePasses: state.consecutivePasses,
    status: state.status,
    winners: [...state.winners],
    endReason: state.endReason,
    format: state.format,
  };

  return {
    metadata: {
      version: SERIALIZATION_VERSION,
      savedAt: Date.now(),
      gameCreatedAt: state.createdAt,
      gameLastModifiedAt: state.lastModifiedAt,
      description,
    },
    state: serializedData,
  };
}

/**
 * Serialize game state to JSON string
 */
export function serializeToJSON(state: GameState, description?: string): string {
  return JSON.stringify(serializeGameState(state, description), null, 2);
}

/**
 * Deserialize a mana pool
 */
function deserializeManaPool(data: SerializedManaPool): ManaPool {
  return {
    colorless: data.colorless,
    white: data.white,
    blue: data.blue,
    black: data.black,
    red: data.red,
    green: data.green,
    generic: data.generic,
  };
}

/**
 * Deserialize a player
 */
function deserializePlayer(data: SerializedPlayer): Player {
  return {
    id: data.id,
    name: data.name,
    life: data.life,
    poisonCounters: data.poisonCounters,
    commanderDamage: new Map(data.commanderDamage),
    maxHandSize: data.maxHandSize,
    currentHandSizeModifier: data.currentHandSizeModifier,
    hasLost: data.hasLost,
    lossReason: data.lossReason,
    landsPlayedThisTurn: data.landsPlayedThisTurn,
    maxLandsPerTurn: data.maxLandsPerTurn,
    manaPool: deserializeManaPool(data.manaPool),
    isInCommandZone: data.isInCommandZone,
    experienceCounters: data.experienceCounters,
    commanderCastCount: data.commanderCastCount,
    hasPassedPriority: data.hasPassedPriority,
    hasActivatedManaAbility: data.hasActivatedManaAbility,
    additionalCombatPhase: data.additionalCombatPhase,
    additionalMainPhase: data.additionalMainPhase,
    hasOfferedDraw: data.hasOfferedDraw,
    hasAcceptedDraw: data.hasAcceptedDraw,
  };
}

/**
 * Deserialize a card instance
 */
function deserializeCardInstance(data: SerializedCardInstance): CardInstance {
  return {
    id: data.id,
    oracleId: data.oracleId,
    cardData: data.cardData as CardInstance['cardData'],
    currentFaceIndex: data.currentFaceIndex,
    isFaceDown: data.isFaceDown,
    controllerId: data.controllerId,
    ownerId: data.ownerId,
    isTapped: data.isTapped,
    isFlipped: data.isFlipped,
    isTurnedFaceUp: data.isTurnedFaceUp,
    isPhasedOut: data.isPhasedOut,
    hasSummoningSickness: data.hasSummoningSickness,
    counters: data.counters,
    damage: data.damage,
    toughnessModifier: data.toughnessModifier,
    powerModifier: data.powerModifier,
    attachedToId: data.attachedToId,
    attachedCardIds: Array.from(data.attachedCardIds),
    enteredBattlefieldTimestamp: data.enteredBattlefieldTimestamp,
    attachedTimestamp: data.attachedTimestamp,
    isToken: data.isToken,
    tokenData: data.tokenData as CardInstance['tokenData'],
  };
}

/**
 * Deserialize a zone
 */
function deserializeZone(data: SerializedZone): Zone {
  return {
    type: data.type as Zone['type'],
    playerId: data.playerId,
    cardIds: data.cardIds,
    isRevealed: data.isRevealed,
    visibleTo: data.visibleTo,
  };
}

/**
 * Deserialize a stack object
 */
function deserializeStackObject(data: SerializedStackObject): StackObject {
  return {
    id: data.id,
    type: data.type,
    sourceCardId: data.sourceCardId,
    controllerId: data.controllerId,
    name: data.name,
    text: data.text,
    manaCost: data.manaCost,
    targets: data.targets.map(t => ({
      type: t.type as StackObject['targets'][0]['type'],
      targetId: t.targetId,
      isValid: t.isValid,
    })),
    chosenModes: Array.from(data.chosenModes),
    variableValues: new Map(data.variableValues),
    isCountered: data.isCountered,
    timestamp: data.timestamp,
  };
}

/**
 * Deserialize a turn
 */
function deserializeTurn(data: SerializedTurn, _Phase: { [key: string]: string }): Turn {
  return {
    activePlayerId: data.activePlayerId,
    currentPhase: data.currentPhase as Turn['currentPhase'],
    turnNumber: data.turnNumber,
    extraTurns: data.extraTurns,
    isFirstTurn: data.isFirstTurn,
    startedAt: data.startedAt,
  };
}

/**
 * Deserialize combat
 */
function deserializeCombat(data: SerializedCombat): Combat {
  return {
    inCombatPhase: data.inCombatPhase,
    attackers: data.attackers.map(a => ({
      cardId: a.cardId,
      defenderId: a.defenderId,
      isAttackingPlaneswalker: a.isAttackingPlaneswalker,
      damageToDeal: a.damageToDeal,
      hasFirstStrike: a.hasFirstStrike,
      hasDoubleStrike: a.hasDoubleStrike,
    })),
    blockers: new Map(data.blockers),
    remainingCombatPhases: data.remainingCombatPhases,
  };
}

/**
 * Deserialize waiting choice
 */
function deserializeWaitingChoice(data: SerializedWaitingChoice | null): WaitingChoice | null {
  if (!data) return null;

  return {
    type: data.type as WaitingChoice['type'],
    playerId: data.playerId,
    stackObjectId: data.stackObjectId,
    prompt: data.prompt,
    choices: data.choices.map(c => ({
      label: c.label,
      value: c.value as WaitingChoice['choices'][0]['value'],
      isValid: c.isValid,
    })),
    minChoices: data.minChoices,
    maxChoices: data.maxChoices,
    presentedAt: data.presentedAt,
  };
}

/**
 * Deserialize game state from serialized data
 */
export function deserializeGameState(data: SerializedGameState): GameState {
  // Validate version
  const version = data.metadata.version;
  if (versionCompare(version, MIN_SUPPORTED_VERSION) < 0) {
    throw new Error(`Cannot load game state: version ${version} is no longer supported. Minimum supported version is ${MIN_SUPPORTED_VERSION}`);
  }

  const state = data.state;

  return {
    gameId: state.gameId,
    players: new Map(state.players.map(p => [p.id, deserializePlayer(p)])),
    cards: new Map(state.cards.map(c => [c.id, deserializeCardInstance(c)])),
    zones: new Map(state.zones.map(z => [z.id, deserializeZone(z)])),
    stack: state.stack.map(deserializeStackObject),
    turn: deserializeTurn(state.turn, {}),
    combat: deserializeCombat(state.combat),
    waitingChoice: deserializeWaitingChoice(state.waitingChoice),
    priorityPlayerId: state.priorityPlayerId,
    consecutivePasses: state.consecutivePasses,
    status: state.status,
    winners: state.winners,
    endReason: state.endReason,
    format: state.format,
    createdAt: data.metadata.gameCreatedAt,
    lastModifiedAt: data.metadata.gameLastModifiedAt,
  };
}

/**
 * Deserialize game state from JSON string
 */
export function deserializeFromJSON(json: string): GameState {
  const data = JSON.parse(json) as SerializedGameState;
  return deserializeGameState(data);
}

/**
 * Validate serialized game state structure
 */
export function validateSerializedState(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Data must be an object'] };
  }

  const state = data as SerializedGameState;

  // Check metadata
  if (!state.metadata) {
    errors.push('Missing metadata');
  } else {
    if (!state.metadata.version) {
      errors.push('Missing metadata.version');
    }
    if (!state.metadata.savedAt) {
      errors.push('Missing metadata.savedAt');
    }
  }

  // Check state
  if (!state.state) {
    errors.push('Missing state');
    return { valid: false, errors };
  }

  const s = state.state;

  if (!s.gameId) errors.push('Missing state.gameId');
  if (!s.players) errors.push('Missing state.players');
  if (!s.cards) errors.push('Missing state.cards');
  if (!s.zones) errors.push('Missing state.zones');
  if (!s.turn) errors.push('Missing state.turn');
  if (!s.combat) errors.push('Missing state.combat');
  if (!s.status) errors.push('Missing state.status');
  if (!s.format) errors.push('Missing state.format');

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Compare semantic versions
 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function versionCompare(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Migrate serialized state to current version
 * This would be extended for future version migrations
 */
export function migrateToCurrentVersion(data: SerializedGameState): SerializedGameState {
  const version = data.metadata.version;

  // If already current version, return as-is
  if (version === SERIALIZATION_VERSION) {
    return data;
  }

  // Add migration logic here for future versions
  // Example:
  // if (versionCompare(version, '2.0.0') < 0) {
  //   data = migrateToV2(data);
  // }

  return data;
}
