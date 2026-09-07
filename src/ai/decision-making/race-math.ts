/**
 * @fileoverview Lightweight race math for combat-strategy selection (issue #1542).
 *
 * `determineCombatStrategy` in combat-decision-tree.ts used to flip between
 * aggressive / moderate / defensive using only coarse life thresholds and
 * board-count deltas. That misses the actual question a real player asks
 * before attacking: "who is winning the race?". A board where your creatures
 * deal 10 damage per turn and the opponent's deal 2 is already decisively
 * won — even if you are at low life — and the AI should commit, not stall.
 *
 * This module provides the cheap "pure board math" half of that question:
 *
 *  - {@link untappedPower}      — sum of one player's untapped creature power.
 *  - {@link turnsToLethalSelf}  — how many attack turns the AI needs to kill
 *                                 the opponent if it never gets blocked.
 *  - {@link turnsToLethalOpponent} — the mirror: turns the opponent needs to
 *                                 kill the AI through combat damage.
 *  - {@link raceVerdict}        — coarse `ai_winning` / `ai_losing` / `even`
 *                                 signal that `determineCombatStrategy`
 *                                 consumes.
 *
 * It deliberately ignores hand cards, combat tricks, conditional blocks, and
 * other resources the rest of the combat-decision-tree reasons about. The
 * intent is to give the strategy selector a *cheap* override signal, not to
 * replicate the lookahead engine. The acceptance criterion that avgTurns-per-
 * game does not increase by more than 5% can only hold if this stays O(1) in
 * board size — which the four functions below are.
 *
 * The signal is pure-math, no RNG, fully deterministic. Easy-tier blunders
 * are layered on top inside {@link CombatDecisionTree} via the existing
 * `shouldCombatBlunder` gate, the same way issue #994 injects blunders
 * into the block decision.
 */

import type { AIPlayerState } from "@/lib/game-state";

/**
 * Sum the power of one player's untapped, non-sickened creatures.
 *
 * Tapped creatures can't attack and creatures with summoning sickness can't
 * attack either, so neither contributes to the damage clock. Creatures with
 * no declared power (vanilla 0/X walls, e.g.) contribute 0 — a 0/4 Wall is
 * real value on defense but contributes nothing to the AI's race-math
 * offensive clock. Defensive walls are reflected on the *opponent's* clock
 * (they reduce the AI's incoming damage indirectly through block-prediction,
 * which race math deliberately does not model).
 */
export function untappedPower(player: AIPlayerState): number {
  let total = 0;
  for (const permanent of player.battlefield) {
    if (permanent.type !== "creature") continue;
    if (permanent.tapped) continue;
    if (permanent.summoningSickness) continue;
    const power = permanent.power ?? 0;
    if (power > 0) total += power;
  }
  return total;
}

/**
 * Sum the effective attacker-power across every opponent. With multiple
 * opponents the AI has to race *all* of them in parallel, so we sum across
 * the entire opponent list.
 */
function totalOpponentPower(opponents: AIPlayerState[]): number {
  let total = 0;
  for (const opponent of opponents) {
    total += untappedPower(opponent);
  }
  return total;
}

/**
 * How many turns does the AI need to kill the opponent through pure combat
 * damage, assuming the opponent never blocks?
 *
 * Returns:
 *  - `0` if any opponent is already at 0 or negative life (effectively lethal
 *    on board this turn).
 *  - `Infinity` if the AI has no untapped attackers (no race clock exists).
 *  - `ceil(minOpponentLife / aiUntappedPower)` otherwise.
 */
export function turnsToLethalSelf(
  aiPlayer: AIPlayerState,
  opponents: AIPlayerState[],
): number {
  if (opponents.length === 0) return Infinity;
  const minOpponentLife = Math.min(...opponents.map((o) => o.life));
  if (minOpponentLife <= 0) return 0;
  const ownPower = untappedPower(aiPlayer);
  if (ownPower <= 0) return Infinity;
  return Math.ceil(minOpponentLife / ownPower);
}

/**
 * How many turns does the opponent need to kill the AI through pure combat
 * damage, assuming the AI never blocks? "Pure" in the sense that race math
 * does not model friendly blockers (the real blocker-assignment code does
 * that); this answers the worst-case question: if we do nothing on defense,
 * how many turns until we are dead?
 *
 * Returns:
 *  - `0` if the AI is already at 0 or negative life.
 *  - `Infinity` if no opponent has any untapped attacker power.
 *  - `ceil(aiLife / totalOpponentPower)` otherwise.
 */
export function turnsToLethalOpponent(
  aiLife: number,
  opponents: AIPlayerState[],
): number {
  if (aiLife <= 0) return 0;
  const incoming = totalOpponentPower(opponents);
  if (incoming <= 0) return Infinity;
  return Math.ceil(aiLife / incoming);
}

/**
 * Coarse verdict of who is ahead in the pure-damage race.
 *
 *  - `ai_winning` — the AI has a decisive power advantage; the existing
 *                   life-threshold heuristic would still label it defensive
 *                   when the AI happens to be low on life, which is the
 *                   bug issue #1542 documents.
 *  - `ai_losing`  — the mirror: opponent has a decisive power advantage and
 *                   the AI must hold blockers and play for time.
 *  - `even`       — neither side has a decisive advantage, OR the board is
 *                   empty. `determineCombatStrategy` falls through to the
 *                   existing life-threshold + aggression-config branches
 *                   so per-archetype tuning is preserved (AC3).
 *
 * "Decisive" is keyed off the power ratio (not raw turns-to-lethal) so that
 * symmetric boards with different life totals stay "even". The
 * archetype-differentiation tests in `combat-decision-tree.test.ts`
 * intentionally put one player at lower life to exercise the legacy
 * lifeThreshold branch — that test must keep passing, which a pure
 * turns-to-lethal approach would break.
 */
export type RaceVerdict = "ai_winning" | "ai_losing" | "even";

/**
 * Multiplier that defines "decisive" power advantage. The legacy
 * `determineCombatStrategy` already used "+1 board creature" as its delta,
 * which for two-creature vs two-creature boards is +50%. We mirror that
 * in continuous terms: a 1.5× ratio is "decisive".
 */
const DECISIVE_POWER_RATIO = 1.5;

export function raceVerdict(
  aiPlayer: AIPlayerState,
  opponents: AIPlayerState[],
): RaceVerdict {
  const ownPower = untappedPower(aiPlayer);
  const oppPower = totalOpponentPower(opponents);

  // Empty / symmetric board: race math has nothing decisive to say,
  // defer to the existing aggression-config / life-threshold branches
  // (AC3 — symmetric boards must fall through, not be relabeled).
  if (ownPower === 0 && oppPower === 0) return "even";

  // AI has board, opponent has none: AI is winning the race no matter
  // how low the AI's own life is. Acceptance criterion #1.
  if (ownPower > 0 && oppPower === 0) return "ai_winning";

  // Opponent has board, AI has none: AI is losing (only blocks can save
  // us, but race math deliberately doesn't model blocks — the verdict
  // simply says the AI is on the back foot).
  if (ownPower === 0 && oppPower > 0) return "ai_losing";

  // Both sides have board. Compare power ratios with a decisive
  // threshold so small differences don't flip the strategy every turn.
  const ratio = ownPower / oppPower;
  if (ratio >= DECISIVE_POWER_RATIO) return "ai_winning";
  if (ratio <= 1 / DECISIVE_POWER_RATIO) return "ai_losing";
  return "even";
}
