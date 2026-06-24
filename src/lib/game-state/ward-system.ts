/**
 * Ward Keyword System — CR 702.21
 *
 * Ward is a triggered ability: "Whenever this permanent becomes the target of a
 * spell or ability an opponent controls, counter that spell or ability unless its
 * controller pays [cost]."
 *
 * This module implements the ward lifecycle:
 *  1. Parse a card's ward cost (mana or life) into a payable descriptor.
 *  2. Detect ward triggers for a targeted spell/ability on the stack.
 *  3. Provide the payment API (pay / decline) used by players and the AI.
 *  4. Decide, at resolution time, whether a spell/ability is countered for
 *     non-payment of any ward cost.
 *
 * The countering itself is enforced in `resolveTopOfStack` (spell-casting.ts),
 * which calls `applyWardResolution` before applying any effects.
 */

import { spendMana } from "./mana";
import { getWardCost, hasWard, isProtectedByWard } from "./evergreen-keywords";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  Player,
  PlayerId,
  StackObject,
  WaitingChoice,
} from "./types";
import { isOnBattlefield } from "./types";

/**
 * A payable ward cost. Ward costs are either a mana cost (e.g. "{2}", "{1}{U}")
 * or a life cost ("Ward—Pay 3 life").
 */
export type WardCostDescriptor =
  | {
      kind: "mana";
      generic: number;
      white: number;
      blue: number;
      black: number;
      red: number;
      green: number;
    }
  | { kind: "life"; amount: number };

/**
 * A single ward trigger raised against a spell/ability on the stack.
 */
export interface WardTrigger {
  /** The stack object being countered (unless its ward is paid). */
  stackObjectId: string;
  /** The warded permanent that was targeted. */
  targetCardId: CardInstanceId;
  /** Controller of the warded permanent (an opponent of the caster). */
  wardControllerId: PlayerId;
  /** The cost the caster must pay to stop the counter. */
  cost: WardCostDescriptor;
}

/** Result of checking ward at resolution time. */
export interface WardResolutionResult {
  /** True when at least one unpaid ward counter the stack object. */
  countered: boolean;
  /** The triggers that were detected (paid and unpaid). */
  triggers: WardTrigger[];
  /** The unpaid triggers that caused the counter. */
  unpaidTriggers: WardTrigger[];
}

/**
 * Parse a ward cost string (as produced by `getWardCost`) into a payable
 * descriptor. Returns null when there is no cost to parse.
 *
 *  - Mana string e.g. "{2}" or "{2}{U}"  -> { kind: "mana", ... }
 *  - Life string  e.g. "3"               -> { kind: "life", amount: 3 }
 */
export function parseWardCostString(
  costStr: string | null,
): WardCostDescriptor | null {
  if (costStr === null) {
    return null;
  }

  const trimmed = costStr.trim();

  // Mana cost: contains one or more {...} symbols
  if (/\{[^}]*\}/.test(trimmed)) {
    const mana = {
      generic: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
    };
    const tokens = trimmed.match(/\{[^}]*\}/g) || [];
    for (const token of tokens) {
      const symbol = token.slice(1, -1).toUpperCase();
      if (/^\d+$/.test(symbol)) {
        mana.generic += parseInt(symbol, 10);
      } else if (symbol === "W") {
        mana.white += 1;
      } else if (symbol === "U") {
        mana.blue += 1;
      } else if (symbol === "B") {
        mana.black += 1;
      } else if (symbol === "R") {
        mana.red += 1;
      } else if (symbol === "G") {
        mana.green += 1;
      }
      // Unknown symbols (e.g. X, hybrid) are ignored for ward purposes.
    }
    return { kind: "mana", ...mana };
  }

  // Life cost: a bare number (e.g. "3")
  if (/^\d+$/.test(trimmed)) {
    return { kind: "life", amount: parseInt(trimmed, 10) };
  }

  return null;
}

/**
 * Get the payable ward cost descriptor for a card, or null if it has no ward.
 */
export function getWardCostDescriptor(
  card: CardInstance,
): WardCostDescriptor | null {
  if (!hasWard(card)) {
    return null;
  }
  return parseWardCostString(getWardCost(card));
}

/**
 * Check whether a player can currently pay a ward cost.
 *
 * Mana ward: colored pips must be present in the pool; the generic portion may be
 * paid with any mana (generic, colorless, or leftover colored). Mirrors the
 * canonical `spendMana` rules in mana.ts.
 *
 * Life ward: the player must have at least that much life (CR 118.4 — a player
 * cannot pay more life than their current life total).
 */
export function canPayWardCost(
  player: Player,
  cost: WardCostDescriptor,
): boolean {
  if (cost.kind === "life") {
    return player.life >= cost.amount;
  }

  const pool = player.manaPool;

  // Colored requirements must be met by like-colored mana.
  if (
    pool.white < cost.white ||
    pool.blue < cost.blue ||
    pool.black < cost.black ||
    pool.red < cost.red ||
    pool.green < cost.green
  ) {
    return false;
  }

  // Generic portion can be paid with generic + colorless + any leftover colored mana.
  const leftoverColored =
    pool.white -
    cost.white +
    (pool.blue - cost.blue) +
    (pool.black - cost.black) +
    (pool.red - cost.red) +
    (pool.green - cost.green);
  const availableForGeneric = pool.generic + pool.colorless + leftoverColored;

  return availableForGeneric >= cost.generic;
}

/**
 * Detect all ward triggers raised by a spell/ability's targets.
 *
 * A trigger is raised for each target that is a permanent with ward controlled
 * by an opponent of the stack object's controller (CR 702.21). Only `card`
 * targets that are actual permanents raise ward — players, stack objects, and
 * zones never do.
 */
export function detectWardTriggers(
  state: GameState,
  stackObject: StackObject,
): WardTrigger[] {
  const triggers: WardTrigger[] = [];

  for (const target of stackObject.targets) {
    if (target.type !== "card") {
      continue;
    }
    const card = state.cards.get(target.targetId);
    if (!card) {
      continue;
    }
    // Ward only protects permanents on the battlefield (CR 702.21).
    if (!isOnBattlefield(state, card.id)) {
      continue;
    }
    // Ward only protects opposing permanents from being targeted.
    if (!isProtectedByWard(card, stackObject.controllerId)) {
      continue;
    }
    const cost = getWardCostDescriptor(card);
    if (!cost) {
      continue;
    }
    triggers.push({
      stackObjectId: stackObject.id,
      targetCardId: card.id,
      wardControllerId: card.controllerId,
      cost,
    });
  }

  return triggers;
}

/**
 * Resolve ward for a stack object that is about to resolve.
 *
 * Returns whether the object is countered: if ANY warded opponent target was
 * not paid for, the spell/ability is countered in full (CR 702.21). This is a
 * pure decision — it does not mutate the game state; the caller removes the
 * countered object.
 *
 * @param state Current game state (used to look up targets)
 * @param stackObject The spell/ability resolving
 */
export function applyWardResolution(
  state: GameState,
  stackObject: StackObject,
): WardResolutionResult {
  const triggers = detectWardTriggers(state, stackObject);
  if (triggers.length === 0) {
    return { countered: false, triggers: [], unpaidTriggers: [] };
  }

  const paidIds = stackObject.wardPaidTargetIds ?? [];
  const unpaidTriggers = triggers.filter(
    (t) => !paidIds.includes(t.targetCardId),
  );

  return {
    countered: unpaidTriggers.length > 0,
    triggers,
    unpaidTriggers,
  };
}

/**
 * Pay the ward cost for a specific targeted permanent, recording the payment on
 * the stack object so the spell/ability can resolve.
 *
 * Spends mana / life from the casting player's pool. Returns success=false if
 * the stack object or target cannot be found, the target is not warded, the
 * cost has already been paid, or the player cannot afford the cost.
 *
 * @param state Current game state
 * @param stackObjectId The spell/ability whose ward cost is being paid
 * @param targetCardId The warded permanent being paid for
 */
export function payWardCost(
  state: GameState,
  stackObjectId: string,
  targetCardId: CardInstanceId,
): { success: boolean; state: GameState; error?: string } {
  const stackObject = state.stack.find((s) => s.id === stackObjectId);
  if (!stackObject) {
    return { success: false, state, error: "Stack object not found" };
  }

  const card = state.cards.get(targetCardId);
  if (!card) {
    return { success: false, state, error: "Target card not found" };
  }

  if (!isProtectedByWard(card, stackObject.controllerId)) {
    return {
      success: false,
      state,
      error: "Target is not protected by ward against this spell",
    };
  }

  const cost = getWardCostDescriptor(card);
  if (!cost) {
    return { success: false, state, error: "Target has no ward cost" };
  }

  const payerId = stackObject.controllerId;
  const payer = state.players.get(payerId);
  if (!payer) {
    return { success: false, state, error: "Paying player not found" };
  }

  if (!canPayWardCost(payer, cost)) {
    return { success: false, state, error: "Cannot afford ward cost" };
  }

  // Spend the cost.
  let currentState = state;
  if (cost.kind === "mana") {
    const spendResult = spendMana(currentState, payerId, {
      white: cost.white,
      blue: cost.blue,
      black: cost.black,
      red: cost.red,
      green: cost.green,
      generic: cost.generic,
    });
    if (!spendResult.success) {
      return { success: false, state, error: "Failed to spend ward mana" };
    }
    currentState = spendResult.state;
  } else {
    // Life cost: reduce the payer's life total.
    const updatedPlayers = new Map(currentState.players);
    updatedPlayers.set(payerId, {
      ...payer,
      life: payer.life - cost.amount,
    });
    currentState = { ...currentState, players: updatedPlayers };
  }

  // Record the payment on the stack object.
  const alreadyPaid = stackObject.wardPaidTargetIds ?? [];
  if (alreadyPaid.includes(targetCardId)) {
    // Defensive: shouldn't happen given checks above.
    return { success: true, state: currentState };
  }
  const updatedStack = currentState.stack.map((obj) =>
    obj.id === stackObjectId
      ? {
          ...obj,
          wardPaidTargetIds: [...alreadyPaid, targetCardId],
        }
      : obj,
  );

  return {
    success: true,
    state: { ...currentState, stack: updatedStack },
  };
}

/**
 * Explicitly decline to pay the ward cost for a targeted permanent.
 *
 * Declining is the default (absence from `wardPaidTargetIds`), so this is a
 * no-op kept for API symmetry and clarity of intent for callers/AI.
 */
export function declineWardPayment(
  state: GameState,
  _stackObjectId: string,
  _targetCardId: CardInstanceId,
): { success: boolean; state: GameState } {
  return { success: true, state };
}

/**
 * Build a player-facing payment choice for a ward trigger.
 *
 * Consumers (UI / AI) present this so the casting player can choose to pay the
 * ward cost or let their spell/ability be countered.
 */
export function createWardPaymentChoice(
  _state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  prompt: string,
): WaitingChoice {
  return {
    type: "payment",
    playerId,
    stackObjectId,
    prompt,
    choices: [
      { label: "Pay ward cost", value: "pay", isValid: true },
      {
        label: "Do not pay (spell is countered)",
        value: "decline",
        isValid: true,
      },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}
