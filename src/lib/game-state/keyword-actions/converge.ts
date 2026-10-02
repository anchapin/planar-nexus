/**
 * Converge ability word (issue #2300, Standard remainder slice).
 *
 * "Converge — ..., where X is the number of colors of mana spent to cast
 * this spell." Converge has no rules meaning of its own (CR 207.2c). The
 * count is the number of distinct colors (W, U, B, R, G) among the mana
 * actually spent, including mana that paid generic costs (CR 601.2h).
 * `castSpell` records it on the stack object as `colorsSpent` and, for
 * converge X spells, seeds `variableValues.X` with it.
 */
import type { ManaPool } from "../types";

const COLORS = ["white", "blue", "black", "red", "green"] as const;

/** Distinct colors of mana that left the pool between `before` and `after`. */
export function countColorsSpent(before: ManaPool, after: ManaPool): number {
  let count = 0;
  for (const color of COLORS) {
    if ((before[color] ?? 0) > (after[color] ?? 0)) count++;
  }
  return count;
}

/** Matches "X is the number of colors of mana spent to cast this spell/it". */
export const CONVERGE_X =
  /\bx is the number of colors of mana spent to cast (?:this (?:spell|creature)|it)\b/i;

/** True when the oracle text defines X by converge. */
export function isConvergeX(oracleText: string | undefined): boolean {
  return CONVERGE_X.test(oracleText ?? "");
}
