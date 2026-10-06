/**
 * Cast-time choices: mode selection (modal / choose-two), X-value, and generic waiting-choice resolution.
 *
 * Mechanically extracted from spell-casting.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type {
  GameState,
  PlayerId,
  WaitingChoice,
  ChoiceOption,
} from "../types";
import { completeHandTargeting } from "../hand-targeting";

/**
 * Resolver for a "you may pay" offer (Corpse, Tribute, graveyard attack
 * returns): takes the chosen option value and returns the new state.
 */
export type OfferChoiceResolver = (
  state: GameState,
  playerId: PlayerId,
  chosenValue: string,
) => { success: boolean; state: GameState; description?: string };

/**
 * Offer resolvers register themselves from their own modules instead of being
 * imported here. A static import pulled the whole rules engine into every
 * client route that touches resolveWaitingChoice (issue #2470). An offer can
 * only exist once the module that created it has loaded, so its resolver is
 * always registered by the time the choice needs answering.
 */
const offerResolvers = new Map<string, OfferChoiceResolver>();

export function registerOfferResolver(
  type: string,
  resolver: OfferChoiceResolver,
): void {
  offerResolvers.set(type, resolver);
}

/**
 * Resolver for a choice answered with a list of cards (cleanup discard to
 * maximum hand size, issue #2446). Registered by the module that creates the
 * choice, for the same bundle reason as `registerOfferResolver`.
 */
export type CardListChoiceResolver = (
  state: GameState,
  playerId: PlayerId,
  chosenCardIds: readonly string[],
) => { success: boolean; state: GameState; description?: string };

const cardListResolvers = new Map<string, CardListChoiceResolver>();

export function registerCardListResolver(
  type: string,
  resolver: CardListChoiceResolver,
): void {
  cardListResolvers.set(type, resolver);
}

/**
 * Create a waiting choice for choosing modes
 * For modal spells like "Choose one" or "Choose two"
 * CR 700.2: Modal spells have multiple modes
 */
export function createModeChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
  minChoices: number = 1,
  maxChoices: number = 1,
): WaitingChoice {
  return {
    type: "choose_mode",
    playerId,
    stackObjectId,
    prompt:
      minChoices > 1
        ? `Choose ${minChoices} modes for ${spellName}:`
        : `Choose mode for ${spellName}:`,
    choices: availableModes.map((mode) => ({
      label: mode,
      value: mode,
      isValid: true,
    })),
    minChoices,
    maxChoices,
    presentedAt: Date.now(),
  };
}

/**
 * Create a mode choice for choose-two style modal spells
 * CR 700.2 Example: "Choose two — Create a 1/1 white Soldier token. / Create a 1/1 white Soldier token. / Create a 1/1 white Soldier token."
 */
export function createChooseTwoModeChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
): WaitingChoice {
  return createModeChoice(
    state,
    playerId,
    stackObjectId,
    spellName,
    availableModes,
    2,
    2,
  );
}

/**
 * Create a mode choice for modal spells with any valid number of modes
 */
export function createModalSpellChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
  modeCount: number,
): WaitingChoice {
  return createModeChoice(
    state,
    playerId,
    stackObjectId,
    spellName,
    availableModes,
    modeCount,
    modeCount,
  );
}

/**
 * Create a waiting choice for X value
 */
export function createXValueChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  maxX: number,
): WaitingChoice {
  const choices: ChoiceOption[] = [];
  for (let i = 0; i <= maxX; i++) {
    choices.push({
      label: i.toString(),
      value: i,
      isValid: true,
    });
  }

  return {
    type: "choose_value",
    playerId,
    stackObjectId,
    prompt: `Choose value for X in ${spellName}:`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Normalize a choose_mode payload into a `string[]` regardless of whether the
 * UI passed a single value or an array. Multi-select modal spells
 * (`choose_two`, `choose_three`) pass an array; legacy callers passing a
 * single string still work for `choose_one` spells. Returns null if the
 * payload cannot be normalized.
 */
function normalizeModeSelection(
  selectedValue: unknown,
  minChoices: number,
  maxChoices: number,
): string[] | null {
  let raw: string[] = [];
  if (Array.isArray(selectedValue)) {
    raw = selectedValue.map((v) => String(v));
  } else if (
    typeof selectedValue === "string" ||
    typeof selectedValue === "number" ||
    typeof selectedValue === "boolean"
  ) {
    raw = [String(selectedValue)];
  } else {
    return null;
  }
  // Distinguish between duplicates ("same mode twice") and unselected slots.
  // Modal rules (CR 700.2) require distinct modes for choose-N when N > 1, so
  // we collapse dupes defensively and treat the resulting count as the chosen
  // set.
  const unique = Array.from(new Set(raw));
  if (unique.length > maxChoices || unique.length < minChoices) {
    return null;
  }
  return unique;
}

/**
 * Resolve a waiting choice made by the player
 * Called when player selects cards/options in a choice dialog
 *
 * Modal-spell (CR 700.2) payloads are widened to also accept a `string[]` so
 * that choose-two / choose-three choices deliver the full set of selected
 * modes — see `normalizeModeSelection`. The single string form is preserved
 * for backward compatibility with choose-one callers and existing tests.
 */
export function resolveWaitingChoice(
  state: GameState,
  playerId: PlayerId,
  selectedValue: string | readonly string[] | number | boolean,
): { success: boolean; state: GameState; error?: string } {
  if (!state.waitingChoice) {
    return { success: false, state, error: "No waiting choice to resolve" };
  }

  if (state.waitingChoice.playerId !== playerId) {
    return {
      success: false,
      state,
      error: "Not this player's turn to make a choice",
    };
  }

  const { type, stackObjectId, minChoices, maxChoices } = state.waitingChoice;

  // "You may pay" offers (Corpse, Tribute, graveyard attack returns) answer
  // with a single option value. Before issue #2428 these could only be
  // resolved by calling their module directly, so the game board's choice
  // dialog had no way to answer them.
  if (
    type === "corpse_offer" ||
    type === "tribute_offer" ||
    type === "attack_return_offer"
  ) {
    const value = Array.isArray(selectedValue)
      ? selectedValue[0]
      : selectedValue;
    if (typeof value !== "string") {
      return { success: false, state, error: "Expected an option value" };
    }
    const resolver = offerResolvers.get(type);
    if (!resolver) {
      return {
        success: false,
        state,
        error: `No resolver registered for ${type}`,
      };
    }
    const result = resolver(state, playerId, value);
    return result.success
      ? { success: true, state: result.state }
      : { success: false, state, error: result.description };
  }

  // Issue #2446: cleanup discard to maximum hand size. Accepts the chosen
  // card ids as an array, or a single id when only one card is discarded.
  // Issue #2536: a scripted discard is answered the same way.
  if (type === "discard_to_hand_size" || type === "discard_cards") {
    const ids = Array.isArray(selectedValue)
      ? (selectedValue as readonly string[])
      : typeof selectedValue === "string"
        ? [selectedValue]
        : null;
    if (!ids) {
      return { success: false, state, error: "Expected a list of cards" };
    }
    const resolver = cardListResolvers.get(type);
    if (!resolver) {
      return {
        success: false,
        state,
        error: `No resolver registered for ${type}`,
      };
    }
    const result = resolver(state, playerId, ids);
    return result.success
      ? { success: true, state: result.state }
      : { success: false, state, error: result.description };
  }

  if (type === "choose_value" && typeof selectedValue === "number") {
    const stackObj = state.stack.find((s) => s.id === stackObjectId);

    if (!stackObj) {
      return { success: false, state, error: "Stack object not found" };
    }

    const newVariableValues = new Map(stackObj.variableValues);
    newVariableValues.set("X", selectedValue);

    const newState = {
      ...state,
      waitingChoice: null,
      stack: state.stack.map((obj) =>
        obj.id === stackObjectId
          ? { ...obj, variableValues: newVariableValues }
          : obj,
      ),
    };

    return { success: true, state: newState };
  }

  if (type === "choose_cards" && typeof selectedValue === "string") {
    const castingPlayerId = playerId;
    const opponentId = Array.from(state.players.keys()).find(
      (pid) => pid !== castingPlayerId && !state.players.get(pid)?.hasLost,
    );

    if (!opponentId) {
      return { success: false, state, error: "No opponent found" };
    }

    const result = completeHandTargeting(
      state,
      castingPlayerId,
      opponentId,
      selectedValue,
      stackObjectId || "",
    );

    if (!result.success) {
      return { success: false, state, error: result.error };
    }

    if (!result.state) {
      return {
        success: false,
        state,
        error: "completeHandTargeting returned no state",
      };
    }

    return { success: true, state: result.state };
  }

  if (type === "choose_mode") {
    const stackObj = state.stack.find((s) => s.id === stackObjectId);

    if (!stackObj) {
      return { success: false, state, error: "Stack object not found" };
    }

    const chosenModes = normalizeModeSelection(
      selectedValue,
      minChoices,
      maxChoices,
    );
    if (!chosenModes) {
      return {
        success: false,
        state,
        error: `choose_mode requires between ${minChoices} and ${maxChoices} distinct modes`,
      };
    }

    const newState = {
      ...state,
      waitingChoice: null,
      stack: state.stack.map((obj) =>
        obj.id === stackObjectId ? { ...obj, chosenModes } : obj,
      ),
    };

    return { success: true, state: newState };
  }

  return {
    success: false,
    state,
    error: `Unsupported waiting choice type: ${type}`,
  };
}
