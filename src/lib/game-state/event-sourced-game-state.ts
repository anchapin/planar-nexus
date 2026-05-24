/**
 * Event-Sourced Game State Wrapper
 * Issue #761: Wire EventSourcingGameState into all game-state.ts mutations
 *
 * This module provides wrapper functions that emit events through EventSourcingGameState
 * whenever game state mutations occur. Every state change is recorded in the event log
 * for replay/verification and multiplayer sync.
 */

import type {
  GameState,
  GameAction,
  CardInstanceId,
  PlayerId,
  ScryfallCard,
} from "./types";
import {
  EventSourcingGameState,
  withEventEmission,
  type StateMutationContext,
} from "./event-sourcing";

// Re-export EventSourcingGameState for consumers
export { EventSourcingGameState } from "./event-sourcing";
export type { StateMutationContext } from "./event-sourcing";

// Import original mutation functions
import {
  drawCard as originalDrawCard,
  dealDamageToPlayer as originalDealDamageToPlayer,
  gainLife as originalGainLife,
  concede as originalConcede,
  passPriority as originalPassPriority,
  startGame as originalStartGame,
  loadDeckForPlayer as originalLoadDeckForPlayer,
} from "./game-state";

import {
  moveCardToZone as originalMoveCardToZone,
  createTokenCard as originalCreateTokenCard,
  addCounterToCard as originalAddCounterToCard,
  removeCounterFromCard as originalRemoveCounterFromCard,
  destroyCard as originalDestroyCard,
  exileCard as originalExileCard,
  sacrificeCard as originalSacrificeCard,
} from "./keyword-actions";

import { createToken as createTokenCard } from "./card-instance";

import {
  declareAttackers as originalDeclareAttackers,
  declareBlockers as originalDeclareBlockers,
} from "./combat";

// Map to store original functions for mutation applier
const mutationFunctions = {
  originalDeclareAttackers,
  originalDeclareBlockers,
  originalDrawCard,
  originalDealDamageToPlayer,
  originalGainLife,
  originalConcede,
  originalPassPriority,
  originalMoveCardToZone,
  originalCreateTokenCard,
  originalAddCounterToCard,
  originalRemoveCounterFromCard,
  originalDestroyCard,
  originalExileCard,
  originalSacrificeCard,
};

/**
 * Create an event-sourced game state wrapper
 */
export function createEventSourcedState(
  initialState: GameState,
  sessionId: string,
  localPlayerId: PlayerId,
): EventSourcingGameState {
  const esState = new EventSourcingGameState(initialState, sessionId, localPlayerId);

  // Register the mutation applier for event replay
  // This enables getStateAtIndex() to correctly reconstruct state
  esState.setMutationApplier((state, action) => {
    return applyActionToState(state, action, mutationFunctions);
  });

  return esState;
}

/**
 * Apply an action to state for event replay
 * This is used by EventSourcingGameState.getStateAtIndex() to reconstruct state
 */
function applyActionToState(
  state: GameState,
  action: GameAction,
  fns: typeof mutationFunctions
): GameState {
  const { type, data } = action;

  switch (type) {
    case "declare_attackers": {
      const attackerData = data as { attackers: Array<{ cardId: CardInstanceId; defenderId: PlayerId | CardInstanceId }> };
      const result = fns.originalDeclareAttackers(state, attackerData.attackers);
      return result.success ? result.state : state;
    }
    case "declare_blockers": {
      const blockerData = data as { blockers: Array<{ cardId: CardInstanceId; attackerId: CardInstanceId }> };
      // Convert array format to Map format for the original function
      const blockerAssignments = new Map<CardInstanceId, CardInstanceId[]>();
      for (const b of blockerData.blockers) {
        const existing = blockerAssignments.get(b.attackerId) || [];
        existing.push(b.cardId);
        blockerAssignments.set(b.attackerId, existing);
      }
      const result = fns.originalDeclareBlockers(state, blockerAssignments);
      return result.success ? result.state : state;
    }
    case "draw_card": {
      const { targetId } = data as { targetId: PlayerId };
      return fns.originalDrawCard(state, targetId);
    }
    case "deal_damage": {
      const { amount, targetId, sourceId, isCombatDamage } = data as { amount: number; targetId: string | PlayerId; sourceId?: CardInstanceId; isCombatDamage?: boolean };
      return fns.originalDealDamageToPlayer(state, targetId as PlayerId, amount, isCombatDamage ?? false, sourceId);
    }
    case "gain_life": {
      const { amount, targetId, sourceId } = data as { amount: number; targetId: string | PlayerId; sourceId?: CardInstanceId };
      return fns.originalGainLife(state, targetId as PlayerId, amount, sourceId);
    }
    case "concede": {
      return fns.originalConcede(state, action.playerId);
    }
    case "pass_priority": {
      return fns.originalPassPriority(state, action.playerId);
    }
    case "move_card": {
      const { cardId, targetId } = data as { cardId: CardInstanceId; targetId: string };
      const keywordResult = fns.originalMoveCardToZone(state, cardId, targetId as any);
      return keywordResult.state;
    }
    case "add_counter": {
      const { counterType, amount, cardId } = data as { counterType: string; amount: number; cardId: CardInstanceId };
      const keywordResult = fns.originalAddCounterToCard(state, cardId, counterType, amount);
      return keywordResult.state;
    }
    case "remove_counter": {
      const { counterType, amount, cardId } = data as { counterType: string; amount: number; cardId: CardInstanceId };
      const keywordResult = fns.originalRemoveCounterFromCard(state, cardId, counterType, amount);
      return keywordResult.state;
    }
    case "destroy_card": {
      const { cardId } = data as { cardId: CardInstanceId };
      const keywordResult = fns.originalDestroyCard(state, cardId);
      return keywordResult.state;
    }
    case "exile_card": {
      const { cardId } = data as { cardId: CardInstanceId };
      const keywordResult = fns.originalExileCard(state, cardId);
      return keywordResult.state;
    }
    case "sacrifice_card": {
      const { cardId } = data as { cardId: CardInstanceId };
      const keywordResult = fns.originalSacrificeCard(state, cardId);
      return keywordResult.state;
    }
    default:
      // For unhandled action types, return state unchanged
      return state;
  }
}

/**
 * Draw a card with event emission
 */
export function drawCard(
  esState: EventSourcingGameState,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "draw_card",
    playerId,
    timestamp: Date.now(),
    data: { targetId: playerId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => originalDrawCard(state, playerId),
    action,
  );

  return { state: result, context };
}

/**
 * Deal damage to a player with event emission
 */
export function dealDamageToPlayer(
  esState: EventSourcingGameState,
  playerId: PlayerId,
  damage: number,
  isCombatDamage: boolean = false,
  sourceId?: CardInstanceId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "deal_damage",
    playerId,
    timestamp: Date.now(),
    data: {
      amount: damage,
      targetId: playerId,
      sourceId,
      isCombatDamage,
    },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) =>
      originalDealDamageToPlayer(
        state,
        playerId,
        damage,
        isCombatDamage,
        sourceId,
      ),
    action,
  );

  return { state: result, context };
}

/**
 * Gain life with event emission
 */
export function gainLife(
  esState: EventSourcingGameState,
  playerId: PlayerId,
  amount: number,
  sourceId?: CardInstanceId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "gain_life",
    playerId,
    timestamp: Date.now(),
    data: {
      amount,
      targetId: playerId,
      sourceId,
    },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => originalGainLife(state, playerId, amount, sourceId),
    action,
  );

  return { state: result, context };
}

/**
 * Concede the game with event emission
 */
export function concede(
  esState: EventSourcingGameState,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "concede",
    playerId,
    timestamp: Date.now(),
    data: {},
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => originalConcede(state, playerId),
    action,
  );

  return { state: result, context };
}

/**
 * Pass priority with event emission
 */
export function passPriority(
  esState: EventSourcingGameState,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "pass_priority",
    playerId,
    timestamp: Date.now(),
    data: {},
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => originalPassPriority(state, playerId),
    action,
  );

  return { state: result, context };
}

/**
 * Move a card to a zone with event emission
 */
export function moveCardToZone(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  targetZoneType: "graveyard" | "exile" | "hand" | "library" | "battlefield",
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "move_card",
    playerId,
    timestamp: Date.now(),
    data: { cardId, targetId: targetZoneType },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalMoveCardToZone(
        state,
        cardId,
        targetZoneType,
      );
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Create a token with event emission
 */
export function createToken(
  esState: EventSourcingGameState,
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
  count: number = 1,
): {
  state: GameState;
  context: StateMutationContext;
  tokenIds: CardInstanceId[];
} {
  // Pre-compute token IDs so the action data is accurate
  const tokenIds: CardInstanceId[] = [];
  for (let i = 0; i < count; i++) {
    const token = createTokenCard(tokenData, controllerId, ownerId);
    tokenIds.push(token.id);
  }

  const action: GameAction = {
    type: "create_token",
    playerId: controllerId,
    timestamp: Date.now(),
    data: {
      cardId: ownerId, // Will be updated with actual token IDs in result
      targetId: controllerId,
      tokenIds,
    },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalCreateTokenCard(
        state,
        tokenData,
        controllerId,
        ownerId,
        count,
      );
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context, tokenIds };
}

/**
 * Add counter to a card with event emission
 */
export function addCounterToCard(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "add_counter",
    playerId,
    timestamp: Date.now(),
    data: { counterType, amount: count, cardId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalAddCounterToCard(
        state,
        cardId,
        counterType,
        count,
      );
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Remove counter from a card with event emission
 */
export function removeCounterFromCard(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "remove_counter",
    playerId,
    timestamp: Date.now(),
    data: { counterType, amount: count, cardId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalRemoveCounterFromCard(
        state,
        cardId,
        counterType,
        count,
      );
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Destroy a card with event emission
 */
export function destroyCard(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "destroy_card",
    playerId,
    timestamp: Date.now(),
    data: { cardId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalDestroyCard(state, cardId);
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Exile a card with event emission
 */
export function exileCard(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "exile_card",
    playerId,
    timestamp: Date.now(),
    data: { cardId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalExileCard(state, cardId);
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Sacrifice a card with event emission
 */
export function sacrificeCard(
  esState: EventSourcingGameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "sacrifice_card",
    playerId,
    timestamp: Date.now(),
    data: { cardId },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const keywordResult = originalSacrificeCard(state, cardId);
      return keywordResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Declare attackers with event emission
 */
export function declareAttackers(
  esState: EventSourcingGameState,
  playerId: PlayerId,
  attackerIds: Array<{
    cardId: CardInstanceId;
    defenderId: PlayerId | CardInstanceId;
  }>,
): { state: GameState; context: StateMutationContext } {
  const action: GameAction = {
    type: "declare_attackers",
    playerId,
    timestamp: Date.now(),
    data: { attackers: attackerIds },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const combatResult = originalDeclareAttackers(state, attackerIds);
      return combatResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Declare blockers with event emission
 */
export function declareBlockers(
  esState: EventSourcingGameState,
  playerId: PlayerId,
  blockerAssignments: Map<CardInstanceId, CardInstanceId[]>,
): { state: GameState; context: StateMutationContext } {
  // Convert Map to array format for action data
  const blockersArray = Array.from(blockerAssignments.entries()).flatMap(
    ([attackerId, blockerIds]) =>
      blockerIds.map((blockerId) => ({
        cardId: blockerId,
        attackerId,
      })),
  );

  const action: GameAction = {
    type: "declare_blockers",
    playerId,
    timestamp: Date.now(),
    data: { blockers: blockersArray },
  };

  const { result, context } = withEventEmission(
    esState,
    (state) => {
      const combatResult = originalDeclareBlockers(state, blockerAssignments);
      return combatResult.state;
    },
    action,
  );

  return { state: result, context };
}

/**
 * Load deck for player (doesn't emit events - setup phase)
 * This is typically not part of the event log since it's setup
 */
export function loadDeckForPlayer(
  state: GameState,
  playerId: PlayerId,
  deckCards: ScryfallCard[],
  shuffle?: boolean,
): GameState {
  return originalLoadDeckForPlayer(state, playerId, deckCards, shuffle);
}

/**
 * Start game (doesn't emit events - initial state only)
 */
export function startGame(state: GameState): GameState {
  return originalStartGame(state);
}
