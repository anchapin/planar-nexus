/**
 * Monarchy (CR 114): becoming/losing the monarch and the end-step draw trigger.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, PlayerId } from '../types';
import { ZoneType } from '../types';
import { drawCards } from './draw';

/**
 * Result of a monarchy mutation. Carries enough context for callers to detect
 * that the monarchy ACTUALLY changed so they can fire triggers/auditors
 * without having to diff the full player map again.
 */
export interface MonarchyChangeResult {
  success: boolean;
  state: GameState;
  /** ID of the player who IS the monarch after the operation (null if cleared) */
  monarchId: PlayerId | null;
  /** True iff this call changed who held the monarchy. */
  changed: boolean;
  description: string;
  error?: string;
}

/**
 * Resolve the current monarch id (or `null` if no monarch is set).
 *
 * At most one player should hold the monarchy at any time. We defensively
 * pick the lowest-id holder when something already corrupted the state so
 * downstream SBAs can still converge.
 */
export function getMonarchId(state: GameState): PlayerId | null {
  let firstMonarch: PlayerId | null = null;
  for (const [id, player] of state.players) {
    if (player.isMonarch) {
      if (firstMonarch === null) {
        firstMonarch = id;
      } else {
        return id;
      }
    }
  }
  return firstMonarch;
}

/**
 * Set the given player as the monarch, clearing the flag from every other
 * player. This is the single write-path for `isMonarch` — all monarchy
 * transitions route through it so that downstream subsystems (triggers,
 * state-hash diffs, history) only need to observe one well-defined API.
 *
 * Returns `changed=false` if the requested player was already monarch.
 */
export function setMonarch(
  state: GameState,
  newMonarchId: PlayerId,
): MonarchyChangeResult {
  const newMonarch = state.players.get(newMonarchId);
  if (!newMonarch) {
    return {
      success: false,
      state,
      monarchId: getMonarchId(state),
      changed: false,
      description: `Monarchy unchanged: player ${newMonarchId} not found`,
      error: `Player ${newMonarchId} not found`,
    };
  }

  const previousMonarchId = getMonarchId(state);
  if (previousMonarchId === newMonarchId) {
    return {
      success: true,
      state,
      monarchId: newMonarchId,
      changed: false,
      description: `${newMonarch.name} is already the monarch`,
    };
  }

  const updatedPlayers = new Map(state.players);
  if (previousMonarchId !== null) {
    const previousMonarch = updatedPlayers.get(previousMonarchId);
    if (previousMonarch) {
      updatedPlayers.set(previousMonarchId, {
        ...previousMonarch,
        isMonarch: false,
      });
    }
  }
  updatedPlayers.set(newMonarchId, {
    ...newMonarch,
    isMonarch: true,
  });

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: nextState,
    monarchId: newMonarchId,
    changed: true,
    description: `${newMonarch.name} becomes the monarch`,
  };
}

/**
 * Clear the monarchy flag from every player. Used when the game advances out
 * of monarchy territory (formats that don't use it, the active player
 * intentionally resigned the designation, etc.).
 */
export function clearMonarch(state: GameState): MonarchyChangeResult {
  const previousMonarchId = getMonarchId(state);
  if (previousMonarchId === null) {
    return {
      success: true,
      state,
      monarchId: null,
      changed: false,
      description: "No monarch to clear",
    };
  }

  const updatedPlayers = new Map(state.players);
  for (const [id, player] of updatedPlayers) {
    if (player.isMonarch) {
      updatedPlayers.set(id, { ...player, isMonarch: false });
    }
  }

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: nextState,
    monarchId: null,
    changed: true,
    description: "Monarchy cleared",
  };
}

/**
 * Reset per-turn monarchy tracking on every player so old "who last hit me"
 * memory doesn't survive turn boundaries.
 *
 * Called by turn-phase transitions (end of turn / cleanup step) so the
 * CR 704.5p SBA does not transfer the monarchy based on stale damage.
 * Optional internal callers (tests, the SBA implementation) can invoke
 * `setMonarch` directly without touching this counter.
 */
export function resetMonarchyTracking(state: GameState): GameState {
  let mutated = false;
  const updatedPlayers = new Map(state.players);
  for (const [id, player] of updatedPlayers) {
    if (player.lastCombatDamageFromPlayer != null) {
      updatedPlayers.set(id, {
        ...player,
        lastCombatDamageFromPlayer: null,
      });
      mutated = true;
    }
  }
  if (!mutated) return state;
  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Result of resolving the monarchy end-step draw.
 */
export interface MonarchEndStepDrawResult {
  state: GameState;
  /** True iff the monarch drew a card during this call. */
  drewCard: boolean;
  description: string;
  /** Number of cards actually drawn (0 if no monarch / deck was empty). */
  drawnCount: number;
}

/**
 * Apply the CR 714.3 "monarch draws" effect at the beginning of the
 * monarch's end step.
 *
 * Callers invoke this once per turn transition into the `END` phase for the
 * player who currently holds the monarchy. If no monarch exists, this is a
 * no-op (the rule is conditional on a player being the monarch).
 *
 * We deliberately funnel the draw through `drawCards` so replacement
 * effects ("If you would draw a card, draw two instead") still apply.
 */
export function applyMonarchEndStepDraw(
  state: GameState,
): MonarchEndStepDrawResult {
  const monarchId = getMonarchId(state);
  if (monarchId === null) {
    return {
      state,
      drewCard: false,
      description: "No monarch — end step draw skipped",
      drawnCount: 0,
    };
  }
  const monarch = state.players.get(monarchId);
  if (!monarch) {
    return {
      state,
      drewCard: false,
      description: "Monarch id not found — end step draw skipped",
      drawnCount: 0,
    };
  }
  const libraryKey = `${monarchId}-${ZoneType.LIBRARY}`;
  const library = state.zones.get(libraryKey);
  const beforeHandSize =
    state.zones.get(`${monarchId}-${ZoneType.HAND}`)?.cardIds.length ?? 0;
  if (!library || library.cardIds.length === 0) {
    return {
      state,
      drewCard: false,
      description: `${monarch.name} (monarch) cannot draw from empty library`,
      drawnCount: 0,
    };
  }

  const drawResult = drawCards(state, monarchId, 1);
  const afterHandSize =
    drawResult.state.zones.get(`${monarchId}-${ZoneType.HAND}`)?.cardIds
      .length ?? beforeHandSize;
  const drawn = afterHandSize > beforeHandSize;
  return {
    state: drawResult.state,
    drewCard: drawn,
    drawnCount: drawn ? 1 : 0,
    description: drawn
      ? `${monarch.name} draws a card at end step (CR 714.3, the monarch)`
      : `${monarch.name} (monarch) did not draw`,
  };
}

// ===========================================================================
// Renown (CR 702.100)
//
// CR 702.100a: "Renown N" means "When this creature deals combat damage to a
// player, if it isn't renowned, put N +1/+1 counters on it and it becomes
// renowned."
//
// CR 702.100b: A creature is renowned for the rest of the game for THIS card
// instance once its renown ability has resolved. The `card.renowned` flag is
// the authoritative guard; once set it never resets, even if the counters are
// later removed or the card flickers and re-enters as the same instance.
//
// Issue #1412 frames Renown as an ETB-style trigger for engine integration.
// `processRenownOnEtb` is the SBA/hook-style entry: it gates on
// `!card.renowned`, applies N +1/+1 counters via the existing counter path,
// and flips `card.renowned = true`. Idempotent — calling it twice on the
// same card is a no-op (CR 702.100b's "no second trigger" guarantee).
// ===========================================================================

/** Waiting-choice type value used for the Tribute ETB offer (CR 702.101). */
