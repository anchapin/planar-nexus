/**
 * Game Engine Hook
 * 
 * This hook provides integration between the React UI and the game state engine.
 * It manages the game state, processes actions, and handles turn progression.
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { GameState as EngineGameState, PlayerId, CardInstanceId } from "@/lib/game-state/types";
import { Phase } from "@/lib/game-state/types";
import {
  createInitialGameState as engineCreateInitialGameState,
  startGame as engineStartGame,
  drawCard as engineDrawCard,
  passPriority,
  concede as engineConcede,
  offerDraw as engineOfferDraw,
  acceptDraw as engineAcceptDraw,
  declineDraw as engineDeclineDraw,
  checkStateBasedActions,
} from "@/lib/game-state/game-state";
import { playLand as enginePlayLand, canPlayLand as engineCanPlayLand } from "@/lib/game-state/mana";
import { castSpell as engineCastSpell, canCastSpell as engineCanCastSpell } from "@/lib/game-state/spell-casting";
import { declareAttackers as engineDeclareAttackers, declareBlockers as engineDeclareBlockers } from "@/lib/game-state/combat";
import { advancePhase, startNextTurn } from "@/lib/game-state/turn-phases";
import { dealDamageToPlayer, gainLife } from "@/lib/game-state/game-state";
import { tapCardAction, untapCardAction } from "@/lib/game-state/keyword-actions";

// UI-facing types (compatible with existing UI)
import type { PlayerState, CardState, ZoneType, GameState as UIGameState } from "@/types/game";

/**
 * Convert engine GameState to UI PlayerState
 */
function convertEnginePlayerToUI(engineState: EngineGameState, playerId: PlayerId): PlayerState | null {
  const player = engineState.players.get(playerId);
  if (!player) return null;

  const convertCard = (cardId: CardInstanceId, zone: ZoneType): CardState | null => {
    const card = engineState.cards.get(cardId);
    if (!card) return null;
    return {
      id: card.id,
      card: card.cardData,
      zone,
      playerId: card.controllerId,
      tapped: card.isTapped || false,
      faceDown: card.isFaceDown || false,
      counters: card.counters.reduce((sum, c) => sum + c.count, 0),
      power: card.cardData.power ? parseInt(card.cardData.power) : undefined,
      toughness: card.cardData.toughness ? parseInt(card.cardData.toughness) : undefined,
    };
  };

  const getCardsInZone = (zoneType: string): CardState[] => {
    const zone = engineState.zones.get(`${playerId}-${zoneType}`);
    if (!zone) return [];
    const cards: CardState[] = [];
    for (const cardId of zone.cardIds) {
      const card = convertCard(cardId, zoneType as ZoneType);
      if (card) {
        cards.push(card);
      }
    }
    return cards;
  };

  const getCommandZoneCards = (): CardState[] => {
    const zone = engineState.zones.get("command");
    if (!zone) return [];
    const cards: CardState[] = [];
    for (const cardId of zone.cardIds) {
      const card = engineState.cards.get(cardId);
      if (card?.ownerId === playerId) {
        const cardState: CardState = {
          id: card.id,
          card: card.cardData,
          zone: "commandZone",
          playerId: card.controllerId,
          tapped: card.isTapped || false,
          faceDown: card.isFaceDown || false,
        };
        cards.push(cardState);
      }
    }
    return cards;
  };

  // Convert commander damage map to object
  const commanderDamageObj: { [key: string]: number } = {};
  player.commanderDamage.forEach((damage, targetId) => {
    commanderDamageObj[targetId] = damage;
  });

  return {
    id: player.id,
    name: player.name,
    lifeTotal: player.life,
    poisonCounters: player.poisonCounters,
    commanderDamage: commanderDamageObj,
    hand: getCardsInZone("hand"),
    battlefield: getCardsInZone("battlefield"),
    graveyard: getCardsInZone("graveyard"),
    exile: getCardsInZone("exile"),
    library: getCardsInZone("library"),
    commandZone: getCommandZoneCards(),
    isCurrentTurn: engineState.turn.activePlayerId === playerId,
    hasPriority: engineState.priorityPlayerId === playerId,
    landsPlayedThisTurn: player.landsPlayedThisTurn,
  };
}

/**
 * Convert engine GameState to UI GameState
 */
function convertEngineToUI(engineState: EngineGameState): UIGameState {
  const players: PlayerState[] = [];
  
  engineState.players.forEach((player, playerId) => {
    const uiPlayer = convertEnginePlayerToUI(engineState, playerId);
    if (uiPlayer) {
      players.push(uiPlayer);
    }
  });

  // Sort players to maintain consistent order (local player last)
  players.sort((a, b) => {
    if (a.id === engineState.priorityPlayerId) return 1;
    if (b.id === engineState.priorityPlayerId) return -1;
    return 0;
  });

  const currentTurnPlayerIndex = players.findIndex(
    p => p.id === engineState.turn.activePlayerId
  );

  // Convert engine phase to UI phase
  const phaseMap: Record<string, "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end"> = {
    [Phase.UNTAP]: "beginning",
    [Phase.UPKEEP]: "beginning",
    [Phase.DRAW]: "beginning",
    [Phase.PRECOMBAT_MAIN]: "precombat_main",
    [Phase.BEGIN_COMBAT]: "combat",
    [Phase.DECLARE_ATTACKERS]: "combat",
    [Phase.DECLARE_BLOCKERS]: "combat",
    [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: "combat",
    [Phase.COMBAT_DAMAGE]: "combat",
    [Phase.END_COMBAT]: "combat",
    [Phase.POSTCOMBAT_MAIN]: "postcombat_main",
    [Phase.END]: "end",
    [Phase.CLEANUP]: "end",
  };

  return {
    id: engineState.gameId,
    format: "commander",
    playerCount: players.length === 2 ? 2 : 4,
    players,
    currentTurnPlayerIndex: currentTurnPlayerIndex >= 0 ? currentTurnPlayerIndex : 0,
    currentPhase: phaseMap[engineState.turn.currentPhase] || "precombat_main",
    turnNumber: engineState.turn.turnNumber,
    stack: [], // Stack cards would need conversion
    isTeamMode: false,
  };
}

export interface UseGameEngineOptions {
  playerNames: string[];
  startingLife?: number;
  isCommander?: boolean;
  autoStart?: boolean;
}

export interface UseGameEngineReturn {
  // Game state
  gameState: UIGameState | null;
  engineState: EngineGameState | null;
  isGameStarted: boolean;
  currentPlayerId: PlayerId | null;
  
  // Game lifecycle
  initializeGame: () => void;
  startGame: () => void;
  resetGame: () => void;
  
  // Turn management
  advancePhase: () => void;
  nextTurn: () => void;
  passPriority: () => void;
  
  // Card actions
  playLand: (cardId: CardInstanceId) => { success: boolean; error?: string };
  castSpell: (cardId: CardInstanceId, targets?: Array<{ type: string; targetId: string }>) => { success: boolean; error?: string };
  tapCard: (cardId: CardInstanceId) => void;
  untapCard: (cardId: CardInstanceId) => void;
  
  // Combat
  declareAttackers: (attackers: Array<{ cardId: CardInstanceId; defenderId: string }>) => { success: boolean; error?: string };
  declareBlockers: (blockers: Map<CardInstanceId, CardInstanceId[]>) => { success: boolean; error?: string };
  
  // Life management
  damagePlayer: (playerId: PlayerId, amount: number, sourceId?: CardInstanceId) => void;
  healPlayer: (playerId: PlayerId, amount: number, sourceId?: CardInstanceId) => void;
  
  // Game end
  concede: (playerId: PlayerId) => void;
  offerDraw: (playerId: PlayerId) => void;
  acceptDraw: (playerId: PlayerId) => void;
  declineDraw: (playerId: PlayerId) => void;
  
  // Utility
  drawCard: (playerId: PlayerId) => void;
  canPlayLand: (playerId: PlayerId) => boolean;
  canCastSpell: (playerId: PlayerId, cardId: CardInstanceId) => boolean;
}

/**
 * Main game engine hook
 */
export function useGameEngine(options: UseGameEngineOptions): UseGameEngineReturn {
  const {
    playerNames,
    startingLife = 20,
    isCommander = false,
    autoStart = false,
  } = options;

  // Engine state
  const [engineState, setEngineState] = useState<EngineGameState | null>(null);
  const [isGameStarted, setIsGameStarted] = useState(false);
  
  // Ref for storing state to avoid stale closures in callbacks
  const engineStateRef = useRef<EngineGameState | null>(null);
  
  // Update ref when state changes
  useEffect(() => {
    engineStateRef.current = engineState;
  }, [engineState]);

  // Derived UI state
  const gameState = engineState ? convertEngineToUI(engineState) : null;
  const currentPlayerId = engineState?.priorityPlayerId ?? null;

  /**
   * Initialize a new game
   */
  const initializeGame = useCallback(() => {
    const newState = engineCreateInitialGameState(playerNames, startingLife, isCommander);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, [playerNames, startingLife, isCommander]);

  /**
   * Start the game (draw opening hands, etc.)
   */
  const startGame = useCallback(() => {
    if (!engineStateRef.current) return;
    
    const newState = engineStartGame(engineStateRef.current);
    setEngineState(newState);
    engineStateRef.current = newState;
    setIsGameStarted(true);
  }, []);

  /**
   * Reset the game
   */
  const resetGame = useCallback(() => {
    setEngineState(null);
    engineStateRef.current = null;
    setIsGameStarted(false);
  }, []);

  /**
   * Advance to next phase
   */
  const advancePhaseAction = useCallback(() => {
    if (!engineStateRef.current) return;
    
    const currentTurn = engineStateRef.current.turn;
    const newTurn = advancePhase(currentTurn);
    
    const newState: EngineGameState = {
      ...engineStateRef.current,
      turn: newTurn,
      priorityPlayerId: newTurn.activePlayerId,
      lastModifiedAt: Date.now(),
    };
    
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Start next turn
   */
  const nextTurn = useCallback(() => {
    if (!engineStateRef.current) return;
    
    const playerIds = Array.from(engineStateRef.current.players.keys());
    const currentIndex = playerIds.indexOf(engineStateRef.current.turn.activePlayerId);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIndex];
    
    const newTurn = startNextTurn(engineStateRef.current.turn, nextPlayerId, false);
    
    // Reset lands played for the new active player
    const updatedPlayers = new Map(engineStateRef.current.players);
    const player = updatedPlayers.get(nextPlayerId);
    if (player) {
      updatedPlayers.set(nextPlayerId, {
        ...player,
        landsPlayedThisTurn: 0,
        hasPassedPriority: false,
      });
    }
    
    const newState: EngineGameState = {
      ...engineStateRef.current,
      turn: newTurn,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      lastModifiedAt: Date.now(),
    };
    
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Pass priority
   */
  const passPriorityAction = useCallback(() => {
    if (!engineStateRef.current || !currentPlayerId) return;
    
    const newState = passPriority(engineStateRef.current, currentPlayerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, [currentPlayerId]);

  /**
   * Play a land
   */
  const playLandAction = useCallback((cardId: CardInstanceId) => {
    if (!engineStateRef.current || !currentPlayerId) {
      return { success: false, error: "Game not initialized or no priority" };
    }
    
    const result = enginePlayLand(engineStateRef.current, currentPlayerId, cardId);
    
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
    
    return result;
  }, [currentPlayerId]);

  /**
   * Cast a spell
   */
  const castSpellAction = useCallback((
    cardId: CardInstanceId,
    targets?: Array<{ type: string; targetId: string }>
  ) => {
    if (!engineStateRef.current || !currentPlayerId) {
      return { success: false, error: "Game not initialized or no priority" };
    }
    
    const result = engineCastSpell(
      engineStateRef.current,
      currentPlayerId,
      cardId,
      targets?.map(t => ({ type: t.type as "card" | "player" | "stack" | "zone", targetId: t.targetId, isValid: true })) || []
    );
    
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
    
    return result;
  }, [currentPlayerId]);

  /**
   * Tap a card
   */
  const tapCardActionHook = useCallback((cardId: CardInstanceId) => {
    if (!engineStateRef.current) return;
    
    const card = engineStateRef.current.cards.get(cardId);
    if (!card) return;
    
    const result = tapCardAction(engineStateRef.current, cardId);
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
  }, []);

  /**
   * Untap a card
   */
  const untapCardActionHook = useCallback((cardId: CardInstanceId) => {
    if (!engineStateRef.current) return;
    
    const card = engineStateRef.current.cards.get(cardId);
    if (!card) return;
    
    const result = untapCardAction(engineStateRef.current, cardId);
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
  }, []);

  /**
   * Declare attackers
   */
  const declareAttackersAction = useCallback((
    attackers: Array<{ cardId: CardInstanceId; defenderId: string }>
  ) => {
    if (!engineStateRef.current) {
      return { success: false, error: "Game not initialized" };
    }
    
    const result = engineDeclareAttackers(engineStateRef.current, attackers);
    
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
    
    return result;
  }, []);

  /**
   * Declare blockers
   */
  const declareBlockersAction = useCallback((
    blockers: Map<CardInstanceId, CardInstanceId[]>
  ) => {
    if (!engineStateRef.current) {
      return { success: false, error: "Game not initialized" };
    }
    
    const result = engineDeclareBlockers(engineStateRef.current, blockers);
    
    if (result.success) {
      setEngineState(result.state);
      engineStateRef.current = result.state;
    }
    
    return result;
  }, []);

  /**
   * Deal damage to a player
   */
  const damagePlayerAction = useCallback((
    playerId: PlayerId,
    amount: number,
    sourceId?: CardInstanceId
  ) => {
    if (!engineStateRef.current) return;
    
    const newState = dealDamageToPlayer(engineStateRef.current, playerId, amount, false, sourceId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Heal a player
   */
  const healPlayerAction = useCallback((
    playerId: PlayerId,
    amount: number,
    sourceId?: CardInstanceId
  ) => {
    if (!engineStateRef.current) return;
    
    const newState = gainLife(engineStateRef.current, playerId, amount, sourceId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Concede the game
   */
  const concedeAction = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return;
    
    const newState = engineConcede(engineStateRef.current, playerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Offer a draw
   */
  const offerDrawAction = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return;
    
    const newState = engineOfferDraw(engineStateRef.current, playerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Accept a draw
   */
  const acceptDrawAction = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return;
    
    const newState = engineAcceptDraw(engineStateRef.current, playerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Decline a draw
   */
  const declineDrawAction = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return;
    
    const newState = engineDeclineDraw(engineStateRef.current, playerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Draw a card
   */
  const drawCardAction = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return;
    
    const newState = engineDrawCard(engineStateRef.current, playerId);
    setEngineState(newState);
    engineStateRef.current = newState;
  }, []);

  /**
   * Check if a player can play a land
   */
  const canPlayLandCheck = useCallback((playerId: PlayerId) => {
    if (!engineStateRef.current) return false;
    return engineCanPlayLand(engineStateRef.current, playerId);
  }, []);

  /**
   * Check if a player can cast a spell
   */
  const canCastSpellCheck = useCallback((playerId: PlayerId, cardId: CardInstanceId) => {
    if (!engineStateRef.current) return false;
    const result = engineCanCastSpell(engineStateRef.current, playerId, cardId);
    return result.canCast;
  }, []);

  // Auto-start game if requested
  useEffect(() => {
    if (autoStart && engineState && !isGameStarted) {
      startGame();
    }
  }, [autoStart, engineState, isGameStarted, startGame]);

  return {
    // Game state
    gameState,
    engineState,
    isGameStarted,
    currentPlayerId,
    
    // Game lifecycle
    initializeGame,
    startGame,
    resetGame,
    
    // Turn management
    advancePhase: advancePhaseAction,
    nextTurn,
    passPriority: passPriorityAction,
    
    // Card actions
    playLand: playLandAction,
    castSpell: castSpellAction,
    tapCard: tapCardActionHook,
    untapCard: untapCardActionHook,
    
    // Combat
    declareAttackers: declareAttackersAction,
    declareBlockers: declareBlockersAction,
    
    // Life management
    damagePlayer: damagePlayerAction,
    healPlayer: healPlayerAction,
    
    // Game end
    concede: concedeAction,
    offerDraw: offerDrawAction,
    acceptDraw: acceptDrawAction,
    declineDraw: declineDrawAction,
    
    // Utility
    drawCard: drawCardAction,
    canPlayLand: canPlayLandCheck,
    canCastSpell: canCastSpellCheck,
  };
}
