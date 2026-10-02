/**
 * Ferocious ability word (issue #2300, Standard remainder slice).
 *
 * Ferocious has no rules meaning of its own (CR 207.2c); the cards gate on
 * whether their controller controls a creature with power 4 or greater. The
 * seven Standard cards (2026-10-01 snapshot) use two shapes:
 *
 * - Intervening-if (CR 603.4): "At the beginning of combat on your turn, if
 *   you control a creature with power 4 or greater, ..." (Flamewake Phoenix,
 *   Nasty Little Rabbit). Read by `evaluateInterveningIfClause`, checked when
 *   the ability triggers and again on resolution.
 * - Trigger condition: "Whenever this creature attacks while you control a
 *   creature with power 4 or greater, ..." (Nighthowl Pursuer, Ravening Warg,
 *   The Chief Warg, Wargling, Wilderland Scrounger). The "while" clause is part
 *   of the trigger event (CR 603.2), so it is checked only when the attack
 *   happens, not again on resolution. Read by `evaluateTriggerWhileCondition`.
 *
 * Power is the creature's current power: printed power plus the instance's
 * power modifier (counters and pump effects), via `getPower`.
 */
import type { GameState, PlayerId } from "../types";
import { isOnBattlefield } from "../types";
import { getPower } from "../card-instance";

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** Matches "you control a creature with power 4 (or four) or greater". */
export const FEROCIOUS_CONDITION =
  /\byou control a creature with power (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten) or greater\b/;

/** Parse the power threshold out of a ferocious condition, or null. */
export function ferociousThreshold(condition: string): number | null {
  const m = condition.toLowerCase().match(FEROCIOUS_CONDITION);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUMBER_WORDS.indexOf(m[1]);
}

/** True when the player controls a creature on the battlefield with power >= n. */
export function controlsCreatureWithPowerAtLeast(
  state: GameState,
  playerId: PlayerId,
  n: number,
): boolean {
  for (const [cardId, card] of state.cards) {
    if (card.controllerId !== playerId) continue;
    if (!isOnBattlefield(state, cardId)) continue;
    const typeLine = (card.cardData.type_line ?? "").toLowerCase();
    if (!typeLine.includes("creature")) continue;
    if (getPower(card) >= n) return true;
  }
  return false;
}

/**
 * Evaluate a trigger's "while <condition>" clause at trigger time.
 *
 * Returns `undefined` for conditions this engine does not recognise yet, so
 * callers keep their previous behaviour (trigger unconditionally) rather than
 * silently suppressing abilities on cards outside this slice.
 */
export function evaluateTriggerWhileCondition(
  condition: string,
  state: GameState,
  controllerId: PlayerId,
): boolean | undefined {
  const n = ferociousThreshold(condition);
  if (n !== null)
    return controlsCreatureWithPowerAtLeast(state, controllerId, n);
  return undefined;
}
