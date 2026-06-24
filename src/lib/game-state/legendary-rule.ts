/**
 * Legendary Rule (State-Based Action)
 *
 * Implements MTG Comprehensive Rules 704.5u (the "legend rule"): when a player
 * controls two or more legendary permanents with the same name, that player
 * chooses one to keep and the rest are put into their owner's graveyard.
 *
 * Unlike most SBAs, the legend rule requires a controller CHOICE. Because the
 * engine resolves SBAs synchronously, the choice is surfaced as a pending
 * `waitingChoice` of type `"choose_legend"` on the game state. The UI (or an
 * automated/AI controller via `autoResolveLegendaryChoice`) resolves it.
 *
 * Issue #919: legendary rule SBA must let the controller choose which to keep.
 */

import type {
  GameState,
  CardInstanceId,
  PlayerId,
  WaitingChoice,
  ChoiceOption,
} from "./types";
import { isOnBattlefield } from "./types";
import { getToughness } from "./card-instance";
import { destroyCard } from "./keyword-actions";

/** Waiting-choice type value used for the legendary rule. */
export const LEGENDARY_CHOICE_TYPE = "choose_legend" as const;

/**
 * A group of same-name legendary permanents controlled by a single player
 * that violates the legend rule.
 */
export interface LegendaryViolation {
  /** Player controlling the duplicates (the one who must choose). */
  controllerId: PlayerId;
  /** Lowercased legend name shared by every candidate. */
  name: string;
  /** IDs of the offending legendary permanents (length > 1). */
  candidateIds: CardInstanceId[];
}

/**
 * Find all legend-rule violations currently on the battlefield.
 *
 * Per CR 704.5u the rule is evaluated PER CONTROLLER: two players may each
 * control a same-name legend without incident. Candidates are grouped by
 * (controllerId, lowercased name) and sorted deterministically.
 */
export function findLegendaryViolations(
  state: GameState,
): LegendaryViolation[] {
  // controllerId -> name -> candidate ids
  const byController = new Map<PlayerId, Map<string, CardInstanceId[]>>();

  for (const card of state.cards.values()) {
    if (!isOnBattlefield(state, card.id)) continue;
    const isLegendary =
      card.cardData.type_line?.toLowerCase().includes("legendary") ?? false;
    if (!isLegendary) continue;

    const name = (card.cardData.name || "").toLowerCase();
    let perName = byController.get(card.controllerId);
    if (!perName) {
      perName = new Map();
      byController.set(card.controllerId, perName);
    }
    const existing = perName.get(name) ?? [];
    existing.push(card.id);
    perName.set(name, existing);
  }

  const violations: LegendaryViolation[] = [];
  for (const [controllerId, perName] of byController) {
    for (const [name, candidateIds] of perName) {
      if (candidateIds.length > 1) {
        violations.push({
          controllerId,
          name,
          candidateIds: [...candidateIds].sort(), // deterministic ordering
        });
      }
    }
  }
  return violations;
}

/**
 * Choose which legendary permanent to keep using a deterministic heuristic.
 *
 * Used as the default for AI/automated controllers and as a stable fallback.
 * Preference order (most valuable survives):
 *   1. Most attached permanents (Auras / Equipment riding along)
 *   2. Highest toughness (most likely to survive)
 *   3. Most counters
 *   4. Longest on the battlefield (earliest timestamp)
 *   5. Lexicographically smallest id (final deterministic tiebreak)
 */
export function chooseLegendaryToKeep(
  state: GameState,
  candidateIds: CardInstanceId[],
): CardInstanceId | null {
  if (candidateIds.length === 0) return null;
  if (candidateIds.length === 1) return candidateIds[0];

  const scored = candidateIds.map((id) => {
    const card = state.cards.get(id);
    const attachments = card?.attachedCardIds.length ?? 0;
    const toughness = card ? getToughness(card) : 0;
    const counters = card
      ? card.counters.reduce((sum, c) => sum + c.count, 0)
      : 0;
    const timestamp = card?.enteredBattlefieldTimestamp ?? Infinity;
    return { id, attachments, toughness, counters, timestamp };
  });

  scored.sort((a, b) => {
    if (b.attachments !== a.attachments) return b.attachments - a.attachments;
    if (b.toughness !== a.toughness) return b.toughness - a.toughness;
    if (b.counters !== a.counters) return b.counters - a.counters;
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return scored[0].id;
}

/**
 * Build a `waitingChoice` describing the legend-rule decision for a violation.
 * The controller must select exactly one candidate to keep.
 */
export function createLegendaryWaitingChoice(
  violation: LegendaryViolation,
  state: GameState,
): WaitingChoice {
  const options: ChoiceOption[] = violation.candidateIds.map((id) => {
    const card = state.cards.get(id);
    return {
      label: card?.cardData.name ?? id,
      value: id,
      isValid: true,
    };
  });

  return {
    type: LEGENDARY_CHOICE_TYPE,
    playerId: violation.controllerId,
    stackObjectId: null,
    prompt: `Legendary rule: choose a ${
      state.cards.get(violation.candidateIds[0])?.cardData.name.toLowerCase() ??
      "legend"
    } to keep`,
    choices: options,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/** Return true when a game state already has a pending legend-rule choice. */
export function hasPendingLegendaryChoice(state: GameState): boolean {
  return state.waitingChoice?.type === LEGENDARY_CHOICE_TYPE;
}

/**
 * Resolve a pending legend-rule choice for a controller.
 *
 * `keepId` must be one of the recorded candidates. All other candidates are
 * put into their owner's graveyard (via `destroyCard` so death triggers fire).
 * The waiting choice is cleared.
 */
export function resolveLegendaryChoice(
  state: GameState,
  playerId: PlayerId,
  keepId: CardInstanceId,
): { success: boolean; state: GameState; description: string } {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== LEGENDARY_CHOICE_TYPE) {
    return {
      success: false,
      state,
      description: "No pending legendary choice",
    };
  }
  if (choice.playerId !== playerId) {
    return {
      success: false,
      state,
      description: "Not this player's choice to make",
    };
  }

  const candidateIds = choice.choices.map((c) => String(c.value)).sort();
  if (!candidateIds.includes(keepId)) {
    return {
      success: false,
      state,
      description: "Kept card is not a valid candidate",
    };
  }

  let updatedState: GameState = { ...state, waitingChoice: null };
  const descriptions: string[] = [];

  for (const id of candidateIds) {
    if (id === keepId) continue;
    const result = destroyCard(updatedState, id);
    if (result.success) {
      updatedState = result.state;
      const card = updatedState.cards.get(id);
      descriptions.push(
        `${card?.cardData.name ?? id} put into graveyard (legendary rule)`,
      );
    }
  }

  return {
    success: true,
    state: updatedState,
    description: descriptions.join("; ") || "Legendary rule resolved",
  };
}

/**
 * Automatically resolve any pending legend-rule choice using the deterministic
 * default heuristic. Intended for AI/automated controllers that do not prompt a
 * human. Safe to call when no legend choice is pending (no-op).
 */
export function autoResolveLegendaryChoice(state: GameState): {
  success: boolean;
  state: GameState;
  description: string;
} {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== LEGENDARY_CHOICE_TYPE) {
    return { success: true, state, description: "No legendary choice pending" };
  }
  const candidateIds = choice.choices.map((c) => String(c.value));
  const keepId = chooseLegendaryToKeep(state, candidateIds);
  if (!keepId) {
    return {
      success: false,
      state,
      description: "Could not determine a legend to keep",
    };
  }
  return resolveLegendaryChoice(state, choice.playerId, keepId);
}

/**
 * Move the non-kept legends for a single violation straight to the graveyard
 * without surfacing a choice. Provided for backwards-compatible / non-interactive
 * callers and tests; the interactive path goes through `resolveLegendaryChoice`.
 */
export function applyLegendaryViolation(
  state: GameState,
  violation: LegendaryViolation,
  keepId: CardInstanceId,
): { state: GameState; destroyed: CardInstanceId[] } {
  let updatedState = state;
  const destroyed: CardInstanceId[] = [];
  for (const id of violation.candidateIds) {
    if (id === keepId) continue;
    const result = destroyCard(updatedState, id);
    if (result.success) {
      updatedState = result.state;
      destroyed.push(id);
    }
  }
  return { state: updatedState, destroyed };
}
