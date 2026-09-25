/**
 * AI Contract Types
 *
 * These types define the stable interface between the game engine and AI components.
 * The engine exposes this minimal contract (card-id list + board zones + game-phase only)
 * to avoid leaking internal engine structures to the AI layer.
 *
 * AI components should import AIContract from @/lib/game-state (the barrel).
 * The existing engineToAIState function returns AIGameState for backward compatibility.
 * New code should prefer engineToAIContract which returns this simplified interface.
 */

/**
 * Minimal card representation - just ID and owner for card-id lists
 */
export interface AIContractCard {
  id: string;
  ownerId: string;
}

/**
 * Minimal player representation for AI decision making
 */
export interface AIContractPlayer {
  id: string;
  life: number;
  poisonCounters: number;
  hasPassedPriority: boolean;
  library: AIContractCard[];
  hand: AIContractCard[];
  battlefield: AIContractCard[];
  graveyard: AIContractCard[];
  exile: AIContractCard[];
}

/**
 * Minimal turn info for AI decision making
 */
export interface AIContractTurnInfo {
  turnNumber: number;
  activePlayerId: string;
  phase: string;
  step: string;
  priorityHolderId: string;
}

/**
 * Minimal stack object representation
 */
export interface AIContractStackObject {
  id: string;
  cards: AIContractCard[];
  controllerId: string;
  sourceId: string;
}

/**
 * Minimal combat representation
 */
export interface AIContractCombat {
  attackers: string[];
  blockers: { [attackerId: string]: string[] };
  damagePending: boolean;
}

/**
 * Stable AI Contract - the minimal interface the engine exposes to AI components
 *
 * This is NOT the engine's internal AIGameState type. It's a simplified representation
 * that only includes what the AI layer needs: card-id lists, board zones, and game phase.
 *
 * AI modules should import this type from @/lib/game-state (the barrel).
 */
export interface AIContract {
  gameId: string;
  players: { [playerId: string]: AIContractPlayer };
  turnInfo: AIContractTurnInfo;
  stack: AIContractStackObject[];
  combat: AIContractCombat | null;
}
