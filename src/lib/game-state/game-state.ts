/**
 * Main GameState class for managing the complete game state
 */

import type {
  CardInstanceId,
  CardInstance,
  GameState,
  PlayerId,
  StackObjectId,
  GameAction,
  Zone,
  Player,
} from "./types";
import type { ScryfallCard } from "@/app/actions";
import {
  createCardInstance,
  generateCardInstanceId,
  isCreature,
  hasLethalDamage,
} from "./card-instance";
import { createPlayerZones, createSharedZones, createZone } from "./zones";
import { createTurn, advancePhase, startNextTurn } from "./turn-phases";

/**
 * Generate a unique player ID
 */
function generatePlayerId(): PlayerId {
  return `player-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique game ID
 */
function generateGameId(): string {
  return `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique stack object ID
 */
function generateStackObjectId(): StackObjectId {
  return `stack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new player
 */
function createPlayer(
  name: string,
  startingLife: number = 20,
  isCommander: boolean = false
): Player {
  const playerId = generatePlayerId();

  return {
    id: playerId,
    name,
    life: startingLife,
    poisonCounters: 0,
    commanderDamage: new Map<PlayerId, number>(),
    maxHandSize: 7,
    currentHandSizeModifier: 0,
    hasLost: false,
    lossReason: null,
    landsPlayedThisTurn: 0,
    maxLandsPerTurn: 1,
    manaPool: {
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: 0,
    },
    isInCommandZone: false,
    experienceCounters: 0,
    commanderCastCount: 0,
    hasPassedPriority: false,
    hasActivatedManaAbility: false,
    additionalCombatPhase: false,
    additionalMainPhase: false,
    hasOfferedDraw: false,
    hasAcceptedDraw: false,
  };
}

/**
 * Create initial game state
 */
export function createInitialGameState(
  playerNames: string[],
  startingLife: number = 20,
  isCommander: boolean = false
): GameState {
  const gameId = generateGameId();
  const players = new Map<PlayerId, Player>();
  const zones = new Map<string, Zone>();
  const cards = new Map<CardInstanceId, CardInstance>();

  // Create players
  const playerIds: PlayerId[] = [];
  playerNames.forEach((name) => {
    const player = createPlayer(name, startingLife, isCommander);
    players.set(player.id, player);
    playerIds.push(player.id);

    // Create player zones (will be populated when decks are loaded)
    const playerZones = createPlayerZones(player.id, []);
    playerZones.forEach((zone, zoneId) => {
      zones.set(zoneId, zone);
    });
  });

  // Create shared zones
  const sharedZones = createSharedZones();
  sharedZones.forEach((zone, zoneId) => {
    zones.set(zoneId, zone);
  });

  const firstPlayerId = playerIds[0];

  return {
    gameId,
    players,
    cards,
    zones,
    stack: [],
    turn: createTurn(firstPlayerId, 1, true),
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: firstPlayerId,
    consecutivePasses: 0,
    status: "not_started",
    winners: [],
    endReason: null,
    format: "standard",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  };
}

/**
 * Load a deck for a player
 * Note: deckCards should be individual card entries with quantity handled by the caller
 * For a 60-card deck, pass 60 individual ScryfallCard objects
 */
export function loadDeckForPlayer(
  state: GameState,
  playerId: PlayerId,
  deckCards: ScryfallCard[]
): GameState {
  const libraryCards: CardInstanceId[] = [];
  const updatedCards = new Map(state.cards);

  // Create card instances for each card in deck
  deckCards.forEach((cardData) => {
    const cardInstance = createCardInstance(cardData, playerId, playerId);
    libraryCards.push(cardInstance.id);
    updatedCards.set(cardInstance.id, cardInstance);
  });

  // Shuffle and add to library zone
  const libraryZoneKey = `${playerId}-library`;
  const library = state.zones.get(libraryZoneKey);

  if (!library) {
    throw new Error(`Library zone not found for player ${playerId}`);
  }

  // Shuffle library
  const shuffled = [...libraryCards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const updatedLibrary = { ...library, cardIds: shuffled };

  const updatedZones = new Map(state.zones);
  updatedZones.set(libraryZoneKey, updatedLibrary);

  return {
    ...state,
    cards: updatedCards,
    zones: updatedZones,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Start the game
 */
export function startGame(state: GameState): GameState {
  let updatedState: GameState = { ...state, status: "in_progress" };

  // Each player draws their starting hand
  updatedState.players.forEach((player, playerId) => {
    if (playerId !== state.turn.activePlayerId) {
      // Non-starting players draw 7 cards
      for (let i = 0; i < 7; i++) {
        updatedState = drawCard(updatedState, playerId);
      }
    } else {
      // Starting player draws 7 cards (in real rules, they would draw later,
      // but for simplicity we draw now and they don't draw on their first turn)
      for (let i = 0; i < 7; i++) {
        updatedState = drawCard(updatedState, playerId);
      }
    }
  });

  return updatedState;
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
 * Pass priority
 */
export function passPriority(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const updatedPlayer = { ...player, hasPassedPriority: true };
  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  const consecutivePasses = state.consecutivePasses + 1;

  // Check if all players have passed
  const allPassed = Array.from(state.players.values()).every(
    (p) => p.hasPassedPriority
  );

  if (allPassed && state.stack.length === 0) {
    // All players passed with empty stack - advance phase
    return advanceToNextPhase(state);
  }

  if (allPassed && state.stack.length > 0) {
    // All players passed - resolve top of stack
    return resolveTopOfStack(state);
  }

  // Pass priority to next player
  const currentPlayerIndex = Array.from(state.players.keys()).indexOf(
    state.priorityPlayerId!
  );
  const nextPlayerIndex =
    (currentPlayerIndex + 1) % state.players.size;
  const nextPlayerId = Array.from(state.players.keys())[nextPlayerIndex];

  return {
    ...state,
    players: updatedPlayers,
    priorityPlayerId: nextPlayerId,
    consecutivePasses,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Advance to the next phase
 */
function advanceToNextPhase(state: GameState): GameState {
  const nextPhase = advancePhase(state.turn);

  // Reset priority passes
  const updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((player) => {
    updatedPlayers.set(player.id, { ...player, hasPassedPriority: false });
  });

  // Check if turn is ending
  if (nextPhase.currentPhase === state.turn.currentPhase) {
    // Need to advance to next player's turn
    const currentPlayerIndex = Array.from(state.players.keys()).indexOf(
      state.turn.activePlayerId
    );
    const nextPlayerIndex =
      (currentPlayerIndex + 1) % state.players.size;
    const nextPlayerId = Array.from(state.players.keys())[nextPlayerIndex];

    const newTurn = startNextTurn(state.turn, nextPlayerId, false);

    return {
      ...state,
      turn: newTurn,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    };
  }

  return {
    ...state,
    turn: nextPhase,
    players: updatedPlayers,
    priorityPlayerId: state.turn.activePlayerId,
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Resolve the top object on the stack
 */
function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    return state;
  }

  // Remove top of stack
  const updatedStack = state.stack.slice(0, -1);

  // Reset priority passes
  const updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((player) => {
    updatedPlayers.set(player.id, { ...player, hasPassedPriority: false });
  });

  return {
    ...state,
    stack: updatedStack,
    players: updatedPlayers,
    priorityPlayerId: state.turn.activePlayerId,
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Check state-based actions
 * (creatures with lethal damage, 0 life, etc.)
 */
export function checkStateBasedActions(state: GameState): GameState {
  let updatedState = { ...state };
  let hasChanges = false;

  // Check each player
  updatedState.players.forEach((player, playerId) => {
    if (player.hasLost) {
      return;
    }

    // Check for 0 or less life
    if (player.life <= 0) {
      const updatedPlayer = {
        ...player,
        hasLost: true,
        lossReason: "Life total reached 0 or less",
      };
      updatedState.players.set(playerId, updatedPlayer);
      hasChanges = true;
    }

    // Check for 20 or more poison counters
    if (player.poisonCounters >= 20) {
      const updatedPlayer = {
        ...player,
        hasLost: true,
        lossReason: "Accumulated 20 poison counters",
      };
      updatedState.players.set(playerId, updatedPlayer);
      hasChanges = true;
    }

    // Check for empty library when trying to draw
    // (This is a simplification - real implementation would track draw attempts)
    const libraryZoneKey = `${playerId}-library`;
    const library = updatedState.zones.get(libraryZoneKey);
    if (library && library.cardIds.length === 0) {
      // In a real implementation, we'd track whether they attempted to draw
      // For now, this is a placeholder
    }
  });

  // Check creatures with lethal damage
  updatedState.cards.forEach((card, cardId) => {
    if (!isCreature(card)) {
      return;
    }

    if (hasLethalDamage(card)) {
      // Creature should be destroyed
      // This would normally trigger a "destroy" event
      hasChanges = true;
    }
  });

  if (hasChanges) {
    updatedState = checkWinCondition(updatedState);
  }

  return updatedState;
}

/**
 * Check if the game has ended
 */
function checkWinCondition(state: GameState): GameState {
  const activePlayers = Array.from(state.players.values()).filter(
    (p) => !p.hasLost
  );

  if (activePlayers.length === 1) {
    return {
      ...state,
      status: "completed",
      winners: [activePlayers[0].id],
      endReason: "All other players have lost the game",
      lastModifiedAt: Date.now(),
    };
  }

  if (activePlayers.length === 0) {
    // Draw game
    return {
      ...state,
      status: "completed",
      winners: [],
      endReason: "All players lost the game simultaneously",
      lastModifiedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Apply damage to a player
 */
export function dealDamageToPlayer(
  state: GameState,
  playerId: PlayerId,
  damage: number
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const updatedPlayer = {
    ...player,
    life: Math.max(0, player.life - damage),
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
  amount: number
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const updatedPlayer = {
    ...player,
    life: player.life + amount,
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

  return checkWinCondition(updatedState);
}

/**
 * Get a player's library zone
 */
export function getPlayerLibrary(state: GameState, playerId: PlayerId): Zone | null {
  return state.zones.get(`${playerId}-library`) || null;
}

/**
 * Get a player's hand zone
 */
export function getPlayerHand(state: GameState, playerId: PlayerId): Zone | null {
  return state.zones.get(`${playerId}-hand`) || null;
}

/**
 * Get a player's battlefield zone
 */
export function getPlayerBattlefield(state: GameState, playerId: PlayerId): Zone | null {
  return state.zones.get(`${playerId}-battlefield`) || null;
}

/**
 * Get a player's graveyard zone
 */
export function getPlayerGraveyard(state: GameState, playerId: PlayerId): Zone | null {
  return state.zones.get(`${playerId}-graveyard`) || null;
}

/**
 * Get a player's exile zone
 */
export function getPlayerExile(state: GameState, playerId: PlayerId): Zone | null {
  return state.zones.get(`${playerId}-exile`) || null;
}

/**
 * Offer a draw
 * @param state - Current game state
 * @param playerId - ID of the player offering the draw
 * @returns Updated game state
 */
export function offerDraw(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  if (state.status !== "in_progress") {
    throw new Error("Cannot offer a draw when the game is not in progress");
  }

  const updatedPlayer = {
    ...player,
    hasOfferedDraw: true,
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
 * Accept a draw offer
 * @param state - Current game state
 * @param playerId - ID of the player accepting the draw
 * @returns Updated game state (game ends in a draw)
 */
export function acceptDraw(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Check if there is an active draw offer from another player
  const hasDrawOffer = Array.from(state.players.values()).some(
    (p) => p.id !== playerId && p.hasOfferedDraw
  );

  if (!hasDrawOffer) {
    throw new Error("No active draw offer to accept");
  }

  if (state.status !== "in_progress") {
    throw new Error("Cannot accept a draw when the game is not in progress");
  }

  // Game ends in a draw
  return {
    ...state,
    status: "completed",
    winners: [],
    endReason: "Players agreed to a draw",
    lastModifiedAt: Date.now(),
  };
}

/**
 * Decline a draw offer
 * @param state - Current game state
 * @param playerId - ID of the player declining the draw
 * @returns Updated game state
 */
export function declineDraw(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Clear all draw offers when any player declines
  const updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((p) => {
    updatedPlayers.set(p.id, {
      ...p,
      hasOfferedDraw: false,
      hasAcceptedDraw: false,
    });
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Check if a draw can be offered
 * @param state - Current game state
 * @param playerId - ID of the player
 * @returns true if the player can offer a draw
 */
export function canOfferDraw(state: GameState, playerId: PlayerId): boolean {
  if (state.status !== "in_progress") return false;
  
  const player = state.players.get(playerId);
  if (!player || player.hasLost) return false;
  
  // Can't offer draw if you already offered one
  if (player.hasOfferedDraw) return false;
  
  return true;
}

/**
 * Check if a draw can be accepted
 * @param state - Current game state
 * @param playerId - ID of the player
 * @returns true if the player can accept a draw
 */
export function canAcceptDraw(state: GameState, playerId: PlayerId): boolean {
  if (state.status !== "in_progress") return false;
  
  const player = state.players.get(playerId);
  if (!player || player.hasLost) return false;
  
  // Check if there's an offer from another player
  const hasOfferFromOthers = Array.from(state.players.values()).some(
    (p) => p.id !== playerId && p.hasOfferedDraw
  );
  
  return hasOfferFromOthers;
}
