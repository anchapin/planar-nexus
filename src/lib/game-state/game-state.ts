/**
 * Main GameState class for managing the complete game state
 */

import type {
  CardInstanceId,
  CardInstance,
  GameState,
  PlayerId,
  Zone,
  Player,
} from "./types";
import { Phase } from "./types";
import type { ScryfallCard } from "@/app/actions";
import {
  createCardInstance,
  isCreature,
  hasLethalDamage,
  untapCard,
} from "./card-instance";
import { createPlayerZones, createSharedZones } from "./zones";
import {
  createTurn,
  advancePhase,
  startNextTurn,
  playerDrawsCard,
  shouldHaveFirstStrikeStep,
} from "./turn-phases";
import { emptyAllManaPools } from "./mana";
import {
  resolveTopOfStack as resolveSpellStack,
  castSpell,
  resolveTopOfStack,
} from "./spell-casting";
import { ReplacementEffectManager } from "./replacement-effects";
import { LayerSystem } from "./layer-system";
import {
  checkStateBasedActions as checkSBAs,
  type StateBasedActionResult,
} from "./state-based-actions";
import { hasLifelink, clearProwessBoosts } from "./evergreen-keywords";
import { detectUntapStepTriggers, putTriggersOnStack } from "./trigger-system";
import type { TriggeredAbilityInstance } from "./abilities";

export { castSpell, resolveTopOfStack };

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
 * Create a new player
 */
function createPlayer(
  name: string,
  startingLife: number = 20,
  _isCommander: boolean = false,
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
    foretoldThisTurn: 0,
    spellsCastThisTurn: 0,
    dungeonProgress: null,
    completedDungeonIds: [],
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
    isMonarch: false,
    lastCombatDamageFromPlayer: null,
  };
}

/**
 * Create initial game state
 */
export function createInitialGameState(
  playerNames: string[],
  startingLife: number = 20,
  isCommander: boolean = false,
): GameState {
  // Create a new replacement effect manager for this game instance
  const rem = new ReplacementEffectManager();

  // Create a new layer system for this game instance
  const layerSystem = new LayerSystem();

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
    replacementEffectManager: rem,
    layerSystem,
    linkedEffectRegistry: {
      effects: [],
      bySourceCard: new Map(),
    },
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
  deckCards: ScryfallCard[],
  shuffle = true,
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
  const libraryCardIds = shuffle ? [...libraryCards] : libraryCards;
  if (shuffle) {
    for (let i = libraryCardIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [libraryCardIds[i], libraryCardIds[j]] = [
        libraryCardIds[j],
        libraryCardIds[i],
      ];
    }
  }

  const updatedLibrary = { ...library, cardIds: libraryCardIds };

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
 * Get players in APNAP (Active Player, Non-Active Player) order per CR 101.4.
 * Active player is first, then non-active players in turn order.
 *
 * CR 101.4: Multiplayer formats use a system of "priority" that determines
 * the order in which players may cast spells and abilities.
 * The active player gets priority first at the beginning of each phase/step.
 * Then each other player in turn order (going clockwise in a multiplayer game)
 * gets priority. This continues until all players have passed.
 *
 * @param state - Current game state
 * @returns Array of player IDs in APNAP order
 */
export function getAPNAPOrder(state: GameState): PlayerId[] {
  const activePlayerId = state.turn.activePlayerId;
  // Filter out players who have lost the game (they don't participate in APNAP)
  const activePlayerIds = Array.from(state.players.keys()).filter(
    (id) => !state.players.get(id)!.hasLost,
  );

  // Find active player's position in the active player order
  const activeIndex = activePlayerIds.indexOf(activePlayerId);

  // Build APNAP order: active player first, then others in turn order
  const apnapOrder: PlayerId[] = [activePlayerId];

  // Add remaining players in clockwise order starting from the player after active
  for (let i = 1; i < activePlayerIds.length; i++) {
    const nextIndex = (activeIndex + i) % activePlayerIds.length;
    const nextPlayerId = activePlayerIds[nextIndex];
    apnapOrder.push(nextPlayerId);
  }

  return apnapOrder;
}

/**
 * Get the next player in APNAP order after the current priority holder
 *
 * @param state - Current game state
 * @returns ID of the next player in APNAP order, or null if no valid player
 */
function getNextAPNAPPlayer(state: GameState): PlayerId | null {
  const apnapOrder = getAPNAPOrder(state);
  const currentIndex = apnapOrder.indexOf(state.priorityPlayerId!);

  if (currentIndex === -1) {
    // Priority player not found in APNAP order (shouldn't happen), default to active
    return state.turn.activePlayerId;
  }

  // Find the next player who hasn't passed and hasn't lost
  for (let i = 1; i < apnapOrder.length; i++) {
    const nextIndex = (currentIndex + i) % apnapOrder.length;
    const nextPlayerId = apnapOrder[nextIndex];
    const nextPlayer = state.players.get(nextPlayerId);

    if (nextPlayer && !nextPlayer.hasLost && !nextPlayer.hasPassedPriority) {
      return nextPlayerId;
    }
  }

  // No valid next player found
  return null;
}

/**
 * Pass priority
 */
export function passPriority(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Verify this player has priority
  if (state.priorityPlayerId !== playerId) {
    throw new Error(`Player ${playerId} does not have priority`);
  }

  const updatedPlayer = { ...player, hasPassedPriority: true };
  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  const consecutivePasses = state.consecutivePasses + 1;

  const newState: GameState = {
    ...state,
    players: updatedPlayers,
    consecutivePasses,
    lastModifiedAt: Date.now(),
  };

  // Check if all players have passed
  const activePlayers = Array.from(updatedPlayers.values()).filter(
    (p) => !p.hasLost,
  );
  const allPassed = activePlayers.every((p) => p.hasPassedPriority);

  // Check state-based actions after each priority pass
  // SBAs must be checked before advancing phase or passing to next player
  const sbaResult = checkSBAs(newState);
  const stateAfterSBA = sbaResult.state;

  if (allPassed && stateAfterSBA.stack.length === 0) {
    // All players passed with empty stack - advance phase
    return advanceToNextPhase(stateAfterSBA);
  }

  if (allPassed && stateAfterSBA.stack.length > 0) {
    // All players passed - resolve top of stack
    return resolveSpellStack(stateAfterSBA);
  }

  // Pass priority to next player in APNAP order
  const nextPlayerId = getNextAPNAPPlayer(stateAfterSBA);

  if (nextPlayerId === null) {
    // No valid next player - all remaining players have passed
    // This shouldn't happen in normal flow but handle it gracefully
    return advanceToNextPhase(stateAfterSBA);
  }

  return {
    ...stateAfterSBA,
    priorityPlayerId: nextPlayerId,
  };
}

/**
 * Result of processing the discrete untap step.
 */
export interface UntapStepResult {
  state: GameState;
  /** "Beginning of untap step" triggers that were put on the stack (CR 502.3) */
  triggeredAbilities: TriggeredAbilityInstance[];
  /** Human-readable descriptions of the triggers */
  descriptions: string[];
}

/**
 * Process the discrete UNTAP step (CR 502).
 *
 * This is the single hook point for the untap step. It:
 *   1. Fires "at the beginning of your untap step" triggered abilities (CR 502.3).
 *   2. Determines which permanents the active player controls untap, respecting
 *      untap-modifying effects such as "doesn't untap during your untap step"
 *      (`doesNotUntapDuringUntapStep`) (CR 502.2).
 *   3. Untaps those permanents (CR 502.3).
 *   4. Clears summoning sickness for the active player's permanents (CR 302.3).
 *
 * Per CR 502.3 no player receives priority during the untap step; triggers detected
 * here are put on the stack and receive priority at the start of the upkeep step.
 */
export function processUntapStep(state: GameState): UntapStepResult {
  const activePlayerId = state.turn.activePlayerId;
  const battlefieldZoneKey = `${activePlayerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  // 1. Fire "beginning of untap step" triggers (CR 502.3)
  const triggers = detectUntapStepTriggers(state, activePlayerId);
  let currentState = state;
  let descriptions: string[] = [];
  if (triggers.length > 0) {
    const triggerResult = putTriggersOnStack(state, triggers);
    currentState = triggerResult.state;
    descriptions = triggerResult.descriptions;
  }

  // 2 & 3. Untap permanents respecting untap-modifying effects (CR 502.2), and
  //        clear summoning sickness at start of controller's turn (CR 302.3)
  const updatedCards = new Map(currentState.cards);
  if (battlefield) {
    for (const cardId of battlefield.cardIds) {
      const card = updatedCards.get(cardId);
      if (!card) continue;

      // Untap-modifying effect: "doesn't untap during your untap step" (CR 502.2)
      if (card.doesNotUntapDuringUntapStep) continue;

      let updatedCard = card;
      if (card.isTapped) {
        updatedCard = untapCard(updatedCard);
      }
      if (card.hasSummoningSickness) {
        updatedCard = { ...updatedCard, hasSummoningSickness: false };
      }

      if (updatedCard !== card) {
        updatedCards.set(cardId, updatedCard);
      }
    }
  }

  return {
    state: {
      ...currentState,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    triggeredAbilities: triggers,
    descriptions,
  };
}

/**
 * Advance to the next phase
 */
function advanceToNextPhase(state: GameState): GameState {
  let nextPhase = advancePhase(state.turn);

  // CR 510.5 (First Strike step skipping): if we are about to enter the
  // first-strike combat damage step but no attacker or blocker has first
  // strike or double strike, skip it and advance directly to the regular
  // combat damage step. Issue #969.
  if (
    nextPhase.currentPhase === Phase.COMBAT_DAMAGE_FIRST_STRIKE &&
    !shouldHaveFirstStrikeStep(state)
  ) {
    const skipped = advancePhase(nextPhase);
    if (skipped.currentPhase !== nextPhase.currentPhase) {
      nextPhase = skipped;
    }
  }

  // Reset priority passes
  let updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((player) => {
    updatedPlayers.set(player.id, { ...player, hasPassedPriority: false });
  });

  // Empty all mana pools at the end of each phase/step (CR 500.4)
  let newState: GameState = {
    ...state,
    players: updatedPlayers,
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };
  newState = emptyAllManaPools(newState);
  updatedPlayers = new Map(newState.players);

  // Check if turn is ending
  if (nextPhase.currentPhase === state.turn.currentPhase) {
    // Need to advance to next player's turn
    const currentPlayerIndex = Array.from(state.players.keys()).indexOf(
      state.turn.activePlayerId,
    );
    const nextPlayerIndex = (currentPlayerIndex + 1) % state.players.size;
    const nextPlayerId = Array.from(state.players.keys())[nextPlayerIndex];

    const newTurn = startNextTurn(state.turn, nextPlayerId, false);

    // The new turn begins at the UNTAP step. Process it as a discrete step:
    // fire "beginning of untap step" triggers, untap permanents (respecting
    // untap-modifying effects), and clear summoning sickness (CR 502, CR 302.3).
    const untapResult = processUntapStep({
      ...newState,
      turn: newTurn,
      priorityPlayerId: nextPlayerId,
    });
    const resultState = untapResult.state;
    let updatedCards = new Map(resultState.cards);
    updatedPlayers = new Map(resultState.players);

    // Reset land plays for all players at the start of a new turn
    for (const playerId of updatedPlayers.keys()) {
      const player = updatedPlayers.get(playerId)!;
      updatedPlayers.set(playerId, {
        ...player,
        landsPlayedThisTurn: 0,
        foretoldThisTurn: 0,
        spellsCastThisTurn: 0,
      });
    }

    // Reset Boast tracking (CR 702.131) - clear attackedLastTurn for all creatures
    // so that at the next upkeep we can check if creature attacked "previous turn"
    for (const cardId of resultState.zones.get(`${nextPlayerId}-battlefield`)
      ?.cardIds || []) {
      const card = updatedCards.get(cardId);
      if (card && card.attackedLastTurn) {
        updatedCards.set(cardId, { ...card, attackedLastTurn: false });
      }
    }

    // CR 702.108 - Prowess: the +1/+1 bonus lasts "until end of turn". Clear
    // every active prowess bonus as the new turn begins (end-of-turn cleanup).
    const prowessCleared = clearProwessBoosts({
      ...resultState,
      cards: updatedCards,
    });
    updatedCards = prowessCleared.cards;

    return {
      ...resultState,
      players: updatedPlayers,
      cards: updatedCards,
    };
  }

  // Draw a card when entering the draw step (unless it's the first turn of the game)
  if (nextPhase.currentPhase === "draw" && playerDrawsCard(state.turn)) {
    newState = drawCard(newState, state.turn.activePlayerId);
    updatedPlayers = new Map(newState.players);
  }

  return {
    ...newState,
    turn: nextPhase,
    players: updatedPlayers,
    priorityPlayerId: state.turn.activePlayerId,
  };
}

function resolveStackTop(state: GameState): GameState {
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

    // Check for 10 or more poison counters
    if (player.poisonCounters >= 10) {
      const updatedPlayer = {
        ...player,
        hasLost: true,
        lossReason: "Accumulated 10 poison counters",
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
  updatedState.cards.forEach((card) => {
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
    (p) => !p.hasLost,
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
      "combat" | "noncombat"
    )[],
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
  const actualDamage = processedEvent.amount;

  if (actualDamage <= 0) return state;

  // Monarchy tracking (CR 704.5p): remember the most recent opponent who
  // dealt COMBAT damage to this player. The state-based action that
  // transfers the monarchy reads this field.
  let lastCombatDamageFromPlayer = player.lastCombatDamageFromPlayer ?? null;
  if (isCombatDamage && sourceId) {
    const sourceCard = state.cards.get(sourceId);
    if (sourceCard && sourceCard.controllerId !== playerId) {
      lastCombatDamageFromPlayer = sourceCard.controllerId;
    }
  }

  const updatedPlayer = {
    ...player,
    life: Math.max(0, player.life - actualDamage),
    lastCombatDamageFromPlayer,
  };

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, updatedPlayer);

  // CR 608.2c: Lifelink modifies damage from the source
  // Lifelink applies to ALL damage from the source (not just combat damage)
  // Effects that say "as though it were combat damage" are treated as combat for this purpose
  let stateAfterDamage = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  if (sourceId) {
    const sourceCard = state.cards.get(sourceId);
    if (sourceCard && hasLifelink(sourceCard)) {
      const sourceController = state.players.get(sourceCard.controllerId);
      if (sourceController) {
        const updatedController = {
          ...sourceController,
          life: sourceController.life + actualDamage,
        };
        stateAfterDamage = {
          ...stateAfterDamage,
          players: new Map(stateAfterDamage.players).set(
            sourceCard.controllerId,
            updatedController,
          ),
        };
      }
    }
  }

  return stateAfterDamage;
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

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
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
export function getPlayerLibrary(
  state: GameState,
  playerId: PlayerId,
): Zone | null {
  return state.zones.get(`${playerId}-library`) || null;
}

/**
 * Get a player's hand zone
 */
export function getPlayerHand(
  state: GameState,
  playerId: PlayerId,
): Zone | null {
  return state.zones.get(`${playerId}-hand`) || null;
}

/**
 * Get a player's battlefield zone
 */
export function getPlayerBattlefield(
  state: GameState,
  playerId: PlayerId,
): Zone | null {
  return state.zones.get(`${playerId}-battlefield`) || null;
}

/**
 * Get a player's graveyard zone
 */
export function getPlayerGraveyard(
  state: GameState,
  playerId: PlayerId,
): Zone | null {
  return state.zones.get(`${playerId}-graveyard`) || null;
}

/**
 * Get a player's exile zone
 */
export function getPlayerExile(
  state: GameState,
  playerId: PlayerId,
): Zone | null {
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
    (p) => p.id !== playerId && p.hasOfferedDraw,
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
      isMonarch: false,
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
    (p) => p.id !== playerId && p.hasOfferedDraw,
  );

  return hasOfferFromOthers;
}
