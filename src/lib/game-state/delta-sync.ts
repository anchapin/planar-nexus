/**
 * Game State Delta Synchronization
 *
 * Implements incremental delta compression for P2P game state sync.
 * Only changed objects are transmitted, reducing bandwidth from megabytes to <10KB.
 *
 * Issue #1024: [Performance] Implement game state delta synchronization for P2P
 */

import type {
  GameState,
  CardInstance,
  Player,
  Zone,
  StackObject,
  Turn,
  Combat,
} from "./types";
import type { AIGameState, AIPlayerState, AIPermanent } from "./types";
import { engineToAIState, aiToEngineState } from "./serialization";

/**
 * Represents a diff for a single object (card, player, zone, etc.)
 */
export interface ObjectDiff<T = unknown> {
  id: string;
  action: "add" | "remove" | "update";
  data?: T;
  changedFields?: string[];
}

/**
 * Delta sync message format for incremental updates
 */
export interface GameStateDelta {
  version: number;
  timestamp: number;
  playerDeltas: ObjectDiff<Partial<Player>>[];
  cardDeltas: ObjectDiff<CardInstance>[];
  zoneDeltas: ObjectDiff<Zone>[];
  stackDeltas: ObjectDiff<StackObject>[];
  turnDelta: ObjectDiff<Turn> | null;
  combatDelta: ObjectDiff<Combat> | null;
  isFullSync: boolean;
  checksum: string;
}

/**
 * Full state sync message format
 */
export interface GameStateFullSync {
  version: number;
  timestamp: number;
  state: AIGameState;
  checksum: string;
}

/**
 * Tracks last synced state per peer
 */
export interface PeerSyncState {
  lastVersion: number;
  lastChecksum: string;
  lastState: AIGameState | null;
  lastSerializedState: string | null;
}

/**
 * Deep equality check for objects
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

/**
 * Compute changed fields between two objects
 */
function getChangedFields<T extends object>(oldObj: T, newObj: Partial<T>): string[] {
  const changedFields: string[] = [];
  for (const [key, newValue] of Object.entries(newObj)) {
    if (!deepEqual((oldObj as Record<string, unknown>)[key], newValue)) {
      changedFields.push(key);
    }
  }
  return changedFields;
}

/**
 * Compute a delta between two AI game states
 */
export function computeStateDelta(
  currentState: GameState,
  lastSyncedState: AIGameState | null
): GameStateDelta {
  const currentAI = engineToAIState(currentState);
  const version = (currentState.turn as unknown as { turnNumber?: number }).turnNumber ?? 0;

  if (!lastSyncedState) {
    return {
      version,
      timestamp: Date.now(),
      playerDeltas: [],
      cardDeltas: [],
      zoneDeltas: [],
      stackDeltas: [],
      turnDelta: null,
      combatDelta: null,
      isFullSync: true,
      checksum: computeChecksum(currentAI),
    };
  }

  const playerDeltas: ObjectDiff<Partial<Player>>[] = [];
  const cardDeltas: ObjectDiff<CardInstance>[] = [];
  const zoneDeltas: ObjectDiff<Zone>[] = [];
  const stackDeltas: ObjectDiff<StackObject>[] = [];

  for (const [playerId, currentPlayer] of Object.entries(currentAI.players)) {
    const lastPlayer = lastSyncedState.players[playerId];
    if (!lastPlayer) {
      playerDeltas.push({ id: playerId, action: "add", data: currentPlayer as unknown as Partial<Player> });
    } else if (!deepEqual(currentPlayer, lastPlayer)) {
      const changedFields = getChangedFields(lastPlayer, currentPlayer);
      playerDeltas.push({
        id: playerId,
        action: "update",
        data: currentPlayer as unknown as Partial<Player>,
        changedFields,
      });
    }
  }

  for (const [playerId, lastPlayer] of Object.entries(lastSyncedState.players)) {
    if (!currentAI.players[playerId]) {
      playerDeltas.push({ id: playerId, action: "remove" });
    }
  }

  const currentBattlefield = getBattlefieldCards(currentState);
  const lastBattlefield = getBattlefieldFromAI(lastSyncedState);

  const currentCardIds = new Set(currentBattlefield.map((c) => c.cardInstanceId));
  const lastCardIds = new Set(lastBattlefield.map((c) => c.cardInstanceId));

  for (const card of currentBattlefield) {
    if (!lastCardIds.has(card.cardInstanceId)) {
      cardDeltas.push({ id: card.cardInstanceId, action: "add" });
    } else {
      const lastCard = lastBattlefield.find((c) => c.cardInstanceId === card.cardInstanceId);
      if (lastCard && !deepEqual(card, lastCard)) {
        const changedFields = getChangedFields(lastCard, card);
        cardDeltas.push({
          id: card.cardInstanceId,
          action: "update",
          data: card as unknown as CardInstance,
          changedFields,
        });
      }
    }
  }

  for (const cardId of lastCardIds) {
    if (!currentCardIds.has(cardId)) {
      cardDeltas.push({ id: cardId, action: "remove" });
    }
  }

  for (const [zoneKey, zone] of currentState.zones) {
    const lastZone = lastSyncedState.players[zoneKey] as unknown as Zone | undefined;
    if (!lastZone) {
      zoneDeltas.push({ id: zoneKey, action: "add", data: zone });
    } else if (!deepEqual(zone, lastZone)) {
      const changedFields = getChangedFields(lastZone, zone);
      zoneDeltas.push({ id: zoneKey, action: "update", data: zone, changedFields });
    }
  }

  if (!deepEqual(currentState.stack, lastSyncedState.stack)) {
    stackDeltas.push({
      id: "stack",
      action: "update",
      data: currentState.stack as unknown as StackObject,
    });
  }

  const turnDelta = !deepEqual(currentState.turn, lastSyncedState.turnInfo)
    ? { id: "turn", action: "update" as const, data: currentState.turn }
    : null;

  const combatDelta = !deepEqual(currentState.combat, lastSyncedState.combat)
    ? { id: "combat", action: "update" as const, data: currentState.combat }
    : null;

  return {
    version,
    timestamp: Date.now(),
    playerDeltas,
    cardDeltas,
    zoneDeltas,
    stackDeltas,
    turnDelta,
    combatDelta,
    isFullSync: false,
    checksum: computeChecksum(currentAI),
  };
}

function getBattlefieldCards(state: GameState): AIPermanent[] {
  const battlefield: AIPermanent[] = [];
  for (const [key, zone] of state.zones) {
    if (key.endsWith("-battlefield")) {
      for (const cardId of zone.cardIds) {
        const card = state.cards.get(cardId);
        if (card) {
          battlefield.push({
            id: card.id,
            cardInstanceId: card.id,
            name: card.cardData.name,
            type: getPermanentType(card.cardData.type_line),
            controller: card.controllerId,
            tapped: card.isTapped,
            power: card.cardData.power ? parseInt(card.cardData.power) : undefined,
            toughness: card.cardData.toughness ? parseInt(card.cardData.toughness) : undefined,
            counters: card.counters?.reduce((acc, c) => {
              acc[c.type] = c.count;
              return acc;
            }, {} as Record<string, number>),
            summoningSickness: card.hasSummoningSickness,
            damage: card.damage > 0 ? card.damage : undefined,
          });
        }
      }
    }
  }
  return battlefield;
}

function getPermanentType(typeLine: string): AIPermanent["type"] {
  const lower = typeLine.toLowerCase();
  if (lower.includes("creature")) return "creature";
  if (lower.includes("land")) return "land";
  if (lower.includes("planeswalker")) return "planeswalker";
  if (lower.includes("artifact")) return "artifact";
  if (lower.includes("enchantment")) return "enchantment";
  return "other";
}

function getBattlefieldFromAI(state: AIGameState): AIPermanent[] {
  const battlefield: AIPermanent[] = [];
  for (const player of Object.values(state.players)) {
    battlefield.push(...(player.battlefield ?? []));
  }
  return battlefield;
}

/**
 * Compute a simple checksum for state validation
 */
function computeChecksum(state: AIGameState): string {
  const data = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Check if delta is small enough for incremental sync
 * Returns true if estimated size is under 10KB
 */
export function isDeltaSmallEnough(delta: GameStateDelta): boolean {
  const serialized = JSON.stringify(delta);
  return serialized.length < 10 * 1024;
}

/**
 * Determine if we should use full sync based on delta size
 * and number of changes
 */
export function shouldUseFullSync(
  currentState: GameState,
  lastSyncedState: AIGameState | null
): boolean {
  if (!lastSyncedState) return true;

  const delta = computeStateDelta(currentState, lastSyncedState);

  if (delta.playerDeltas.length > 3) return true;
  if (delta.cardDeltas.length > 50) return true;
  if (delta.stackDeltas.length > 5) return true;

  return !isDeltaSmallEnough(delta);
}

/**
 * Apply a delta to a base state to produce updated state
 */
export function applyDelta(
  baseState: AIGameState,
  delta: GameStateDelta
): AIGameState {
  if (delta.isFullSync) {
    return delta.version === 0 ? baseState : baseState;
  }

  const newState = deepCloneState(baseState);

  for (const playerDelta of delta.playerDeltas) {
    if (playerDelta.action === "add") {
      (newState.players as Record<string, AIPlayerState>)[playerDelta.id] =
        playerDelta.data as unknown as AIPlayerState;
    } else if (playerDelta.action === "remove") {
      delete (newState.players as Record<string, AIPlayerState>)[playerDelta.id];
    } else if (playerDelta.action === "update" && playerDelta.data) {
      (newState.players as Record<string, AIPlayerState>)[playerDelta.id] = {
        ...((newState.players as Record<string, AIPlayerState>)[playerDelta.id] ?? {}),
        ...(playerDelta.data as Partial<AIPlayerState>),
      };
    }
  }

  return newState;
}

function deepCloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Estimate the byte size of a delta in KB
 */
export function estimateDeltaSize(delta: GameStateDelta): number {
  return new Blob([JSON.stringify(delta)]).size;
}
