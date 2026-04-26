
import type { GameState, PlayerId, CardInstanceId } from './types';
import { replacementEffectManager } from './replacement-effects';

/**
 * Apply damage to a player
 */
export function dealDamageToPlayer(
  state: GameState,
  playerId: PlayerId,
  damage: number,
  isCombatDamage: boolean = false,
  sourceId?: CardInstanceId,
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Check for replacement/prevention effects
  const replacementEvent = {
    type: "damage" as const,
    timestamp: Date.now(),
    sourceId,
    targetId: playerId,
    amount: damage,
    isCombatDamage,
    damageTypes: (isCombatDamage ? ["combat"] : ["noncombat"]) as (
      | "combat"
      | "noncombat"
    )[],
  };

  const processedEvent =
    replacementEffectManager.processEvent(replacementEvent);
  const actualDamage = processedEvent.amount;

  if (actualDamage <= 0) return state;

  const updatedPlayer = {
    ...player,
    life: Math.max(0, player.life - actualDamage),
  };

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Lose life (not damage)
 * Bypasses damage prevention, does not trigger "when dealt damage" abilities
 */
export function loseLife(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  _sourceId?: CardInstanceId,
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  if (amount <= 0) return state;

  const updatedPlayer = {
    ...player,
    life: Math.max(0, player.life - amount),
  };

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Gain life
 */
export function gainLife(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  sourceId?: CardInstanceId,
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Check for replacement effects (e.g., "If you would gain life, gain twice that much instead")
  const replacementEvent = {
    type: "life_gain" as const,
    timestamp: Date.now(),
    sourceId,
    targetId: playerId,
    amount: amount,
  };

  const processedEvent =
    replacementEffectManager.processEvent(replacementEvent);
  const actualAmount = processedEvent.amount;

  if (actualAmount <= 0) return state;

  const updatedPlayer = {
    ...player,
    life: player.life + actualAmount,
  };

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Draw a card
 */
export function drawCard(state: GameState, playerId: PlayerId): GameState {
  const libraryZoneKey = `${playerId}-library`;
  const handZoneKey = `${playerId}-hand`;

  const library = state.zones.get(libraryZoneKey);
  const hand = state.zones.get(handZoneKey);

  if (!library || !hand) {
    throw new Error(`Library or hand zone not found for player ${playerId}`);
  }

  if (library.cardIds.length === 0) {
    // Player loses when they can't draw (handled by state-based actions)
    return state;
  }

  const cardId = library.cardIds[library.cardIds.length - 1];

  const updatedLibrary = {
    ...library,
    cardIds: library.cardIds.slice(0, -1),
  };

  const updatedHand = {
    ...hand,
    cardIds: [...hand.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(libraryZoneKey, updatedLibrary);
  updatedZones.set(handZoneKey, updatedHand);

  return {
    ...state,
    zones: updatedZones,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Concede the game
 */
export function concede(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const updatedPlayer = {
    ...player,
    hasLost: true,
    lossReason: "Conceded the game",
  };

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  const updatedState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  // Win condition check should be done by the caller or a central check function
  // to avoid circular dependency back to game-state.ts
  return updatedState;
}
