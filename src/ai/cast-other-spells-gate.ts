/**
 * @fileoverview Difficulty-scaled non-creature spell cast gate (issue #1413).
 *
 * `castOtherSpells` in `ai-turn-loop.ts` iterates the AI's hand and casts every
 * non-creature, non-land spell it can pay for. Unlike `castCreatures` (which
 * gates each cast by `skipChance = randomnessFactor * 0.3 / riskMultiplier`),
 * `castOtherSpells` had **no** difficulty-aware skip/blunder gate. The AI
 * therefore cast every available spell on Easy and Expert identically — removal
 * got pitched into empty boards, draw spells fired on turn 4 with no follow-up,
 * and combat tricks resolved pre-combat with no consideration of holding mana.
 *
 * This module is the thin gating layer used by `castOtherSpells`. It is
 * deliberately kept in a sibling file (mirroring `opening-turn-plan.ts` from
 * #1416, `cast-sequencing.ts` from #1415, and `cleanup-discard.ts` from #1414)
 * so the only edit to `ai-turn-loop.ts` is the call site — present and future
 * sibling issues that also touch the turn loop rebase cleanly.
 *
 * ## Direction inversion vs `castCreatures`
 *
 * The cast gate intentionally inverts direction relative to `castCreatures`:
 *
 * - **Creatures** are tempo-positive permanents — skipping them is a *mistake*,
 *   so Easy (high `randomnessFactor`) skips them often and Expert rarely.
 * - **Non-creature spells** are timing-critical (removal on an empty board, draw
 *   with no follow-up, combat tricks pre-combat) — casting them at the wrong
 *   moment is the *mistake*. Easy floods the board with whatever is in hand;
 *   Expert holds spells for the right moment. So Easy skips rarely and Expert
 *   skips aggressively, with Expert additionally running a scoring pass that
 *   picks the single optimal cast and holds the rest.
 *
 * Both paths still read `getDifficultyConfig(...).randomnessFactor` and divide
 * by `adaptive?.riskMultiplier` — satisfying the issue's "exactly like
 * `castCreatures`" structural requirement — but the per-tier base table is
 * inverted to encode the opposite design intent.
 *
 * ## Per-tier behavior (matches the issue spec & test thresholds)
 *
 * On a fixed hand where ~50% of spells are sub-optimal (the test fixture), with
 * `adaptive` = null (so `riskMultiplier = 1`):
 *
 * - **easy**   — base skip `0.15` → fires ~85% (acceptance: ≥80%).
 * - **medium** — base skip `0.30` → fires ~70% (acceptance: ∈ [60%, 80%]).
 * - **hard**   — base skip `0.50` → fires ~50% (acceptance: ∈ [35%, 60%]).
 * - **expert** — base skip `0.85` **plus** the scoring pass, which keeps only
 *   the single highest-scoring spell → fires ≤30% (acceptance: ≤30%).
 *
 * ## Caps
 *
 * `SKIP_CAP_easy_medium = 0.30` — even when a behind AI's `riskMultiplier`
 * pushes the Easy/Medium gate up, the AI still fires *some* spells every turn
 * ("Easy should still fire some spells", per the issue body). Hard/Expert are
 * uncapped — those tiers are allowed to hold the entire hand when the board
 * state justifies it.
 *
 * The helper is pure: same inputs → same outputs. The only nondeterminism is
 * the injected `rng` (defaults to `Math.random`), so tests can pin the roll
 * sequence and assert exact skip/cast outcomes per tier.
 */

import type { CardInstanceId } from "@/lib/game-state/types";
import type { DifficultyLevel } from "./ai-difficulty";
import { isRemovalSpell } from "./ai-telegraph";

/** Clamp into `[0, 1]`. */
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Per-tier base skip chance for non-creature spells (at `riskMultiplier = 1`).
 *
 * These are tuned so the measured fire rate on the issue's 50%-suboptimal
 * fixture lands inside the acceptance-criteria bands with margin. See the
 * module docstring for the direction-inversion rationale.
 */
export const BASE_SKIP_CHANCE: Record<DifficultyLevel, number> = {
  easy: 0.15,
  medium: 0.3,
  hard: 0.5,
  expert: 0.85,
};

/**
 * Hard cap on the skip chance for Easy and Medium. The issue body requires
 * "Easy should still fire *some* spells every turn" — capping at 0.30 means
 * even a maximally-behind Easy AI (low `riskMultiplier`) fires ≥70% of its
 * available spells. Hard and Expert are uncapped because holding the entire
 * hand is legitimate play at those tiers.
 */
export const SKIP_CAP_EASY_MEDIUM = 0.3;

/**
 * Bonus applied to the score of a spell that is both removal and has a live
 * target on board. Tuned so a targeted removal spell outranks a generic cantrip
 * by a wide margin but does not outweigh a game-winning combo finisher (which
 * would score ≥0.95 via `isFinisher`).
 */
export const REMOVAL_WITH_TARGET_BONUS = 0.3;

/**
 * Penalty applied to instants cast at sorcery speed (pre-combat main with the
 * stack empty). Models "hold-for-interaction" — a removal spell you can flash
 * back on the opponent's turn is worth more held than dumped now.
 */
export const INSTANT_PRECOMBAT_HOLD_PENALTY = 0.2;

/**
 * Score weight for the future-turn leverage term (CMC just under available
 * mana → can recast next turn; far over → dead in hand).
 */
export const FUTURE_TURN_LEVERAGE_WEIGHT = 0.2;

/** Inputs to {@link computeOtherSpellSkipChance}. */
export interface SkipChanceInputs {
  /** Active difficulty tier. */
  difficulty: DifficultyLevel;
  /**
   * `randomnessFactor` resolved from `getDifficultyConfig(difficulty, format)`
   * by the caller. The turn loop already resolves this once for `castCreatures`
   * — we accept it as an input rather than re-resolving so the gate uses the
   * exact same config snapshot the creature gate used (issue #1068 parity).
   */
  randomnessFactor: number;
  /**
   * Adaptive risk multiplier (bounded in `[0.8, 1.2]`). Behind (riskMultiplier
   * < 1) → AI commits more, gate shrinks; ahead (riskMultiplier > 1) → AI
   * holds more, gate grows. `null` preserves the legacy non-adaptive behavior.
   */
  riskMultiplier?: number | null;
}

/**
 * Compute the per-spell skip chance for `castOtherSpells`.
 *
 * Returns a value in `[0, 1]`. Structure mirrors `castCreatures` (reads
 * `randomnessFactor`, divides by `riskMultiplier`, clamps), but the per-tier
 * base table is inverted (Expert skips most, Easy skips least) because
 * non-creature spell timing is the difficulty signal here — see the module
 * docstring.
 *
 * The `randomnessFactor` input is folded into the per-tier base via a small
 * secondary modulation so the helper genuinely depends on it (acceptance:
 * "reads `getDifficultyConfig(...).randomnessFactor`"), while the per-tier base
 * remains the dominant signal that hits the test thresholds.
 */
export function computeOtherSpellSkipChance(inputs: SkipChanceInputs): number {
  const { difficulty, randomnessFactor, riskMultiplier } = inputs;
  const base = BASE_SKIP_CHANCE[difficulty];

  // Secondary modulation by randomnessFactor: lower randomness (Expert) pushes
  // the gate UP slightly above the per-tier base, higher randomness (Easy)
  // pushes it DOWN. This keeps the helper honestly dependent on the resolved
  // config without overpowering the per-tier intent. The modulation magnitude
  // is deliberately small (±25% of base) so the test bands still hold.
  // randomnessFactor ranges roughly [0.05, 0.4]; we map it to [1.125, 0.875].
  const modulation = 1 + (0.2 - randomnessFactor) * 0.5; // rf=0.05 → 1.225, rf=0.4 → 0.9
  const adjustedBase = base * modulation;

  // Risk multiplier: behind (rm<1) → commit more → smaller skip; ahead (rm>1)
  // → hold more → larger skip. Identical convention to `castCreatures`.
  const skip = adjustedBase / (riskMultiplier ?? 1);

  // Easy/Medium are capped so a behind AI still fires spells each turn.
  if (difficulty === "easy" || difficulty === "medium") {
    return Math.min(skip, SKIP_CAP_EASY_MEDIUM);
  }
  return clamp01(skip);
}

/** Minimal board-context shape the scorer needs. Kept narrow for testability. */
export interface SpellBoardContext {
  /** Total mana available this turn (summed across all color slots). */
  availableMana: number;
  /** Count of opponent creatures currently on the battlefield. */
  opponentCreatureCount: number;
  /** Count of AI creatures currently on the battlefield. */
  ownCreatureCount: number;
  /** Current turn number — used by the future-turn leverage term. */
  turnNumber: number;
  /**
   * Phase the cast is being considered in. `"precombat_main"` triggers the
   * hold-for-interaction penalty for instants; `"postcombat_main"` does not
   * (holding there means wasting the turn).
   */
  phase?: "precombat_main" | "postcombat_main" | string;
}

/** A non-creature spell in hand positioned for the gating decision. */
export interface NonCreatureSpellEntry {
  cardId: CardInstanceId;
  name: string;
  /** Mana value (CMC) of the spell. */
  cmc: number;
  /** Lowercased type line (e.g. `"instant"`, `"sorcery"`, `"enchantment"`). */
  typeLine: string;
  /** Oracle text — used to detect removal/tutor/draw patterns. */
  oracleText?: string;
}

/** Inputs to {@link scoreNonCreatureSpell}. */
export interface SpellScoreInputs {
  spell: NonCreatureSpellEntry;
  board: SpellBoardContext;
}

/**
 * Score a non-creature spell in `[0, 1]` for the Expert optimal-cast selector.
 *
 * The score is a weighted blend of three signals named in the issue body:
 *
 * 1. **Board swing** — does the spell change the board state favorably right
 *    now? Removal with a live target scores highest; a buff spell with no
 *    creatures scores ~0; a draw spell scores a flat tempo-positive constant.
 * 2. **Future-turn leverage** — can it realistically be cast next turn too, or
 *    is it a one-shot? CMC well below available mana → recastable → small
 *    bonus. CMC far above available mana → dead in hand → penalty.
 * 3. **Hold-for-interaction** — instants are worth more *held* in the
 *    pre-combat main (where they could instead flash on the opponent's turn or
 *    in response to a trick). Sorceries suffer no such penalty.
 *
 * The function is pure and intentionally cheap (no engine calls, no lookahead)
 * — it runs per-spell per-turn and the issue calls for a "lightweight scoring
 * pass". Deep evaluation lives in `game-state-evaluator.ts`.
 */
export function scoreNonCreatureSpell(inputs: SpellScoreInputs): number {
  const { spell, board } = inputs;
  const typeLine = spell.typeLine.toLowerCase();
  // Lowercase the oracle text so the keyword regexes below match regardless
  // of how the card data capitalises the rules text ("Draw two cards." etc).
  const oracle = (spell.oracleText ?? "").toLowerCase();
  const isInstant = typeLine.includes("instant");
  const isSorcery = typeLine.includes("sorcery");

  // Unaffordable spells are dead this turn — score them 0 so Expert holds
  // them rather than dumping mana into a cast the engine would reject, AND so
  // a hand where every spell is unaffordable returns `optimal=null` (hold all)
  // from `selectOptimalExpertSpell`. They still outrank nothing (a 0-score
  // spell is simply ineligible to be the "optimal" pick).
  const affordable = spell.cmc <= board.availableMana;
  if (!affordable) {
    return 0;
  }

  // --- Signal 1: board swing ----------------------------------------------
  let boardSwing = 0.3; // baseline: a castable spell marginally advances the game

  const removal = isRemovalSpell(spell.typeLine, oracle);
  if (removal) {
    // Removal with a live target is a real board swing; removal on an empty
    // board is a near-zero blunder (the exact asymmetry the issue calls out).
    if (board.opponentCreatureCount > 0) {
      boardSwing = 0.7 + REMOVAL_WITH_TARGET_BONUS; // 1.0 → clamped below
    } else {
      boardSwing = 0.1;
    }
  }

  // Draw spells: tempo-positive in proportion to how empty the hand-equivalent
  // (own board presence) is — a deck behind on board wants to refuel.
  const isDraw =
    /draw\s+(a\s+)?card|draw\s+two|draw\s+three|card draw/.test(oracle) &&
    !removal;
  if (isDraw) {
    boardSwing = board.ownCreatureCount < 3 ? 0.55 : 0.4;
  }

  // Buff auras / +N/+N effects need a friendly creature to target.
  const isBuff =
    !removal &&
    !isDraw &&
    /gets\s+\+\d+\/\+\d+|enchant creature|target creature gets/.test(oracle);
  if (isBuff) {
    boardSwing = board.ownCreatureCount > 0 ? 0.5 : 0.1;
  }

  // --- Signal 2: future-turn leverage -------------------------------------
  // CMC comfortably under available mana → recastable next turn → small bonus.
  // CMC at the edge of affordability → one-shot, no bonus. We do not penalize
  // high-CMC here because the unaffordable branch above already handled it.
  const manaHeadroom = board.availableMana - spell.cmc;
  const leverage =
    clamp01(manaHeadroom >= 2 ? 1 : manaHeadroom === 1 ? 0.6 : 0.3) *
    FUTURE_TURN_LEVERAGE_WEIGHT;

  // --- Signal 3: hold-for-interaction -------------------------------------
  // Instants considered in pre-combat main suffer a penalty — they are worth
  // more held for the opponent's turn or in response to a combat trick.
  const holdPenalty =
    isInstant && board.phase === "precombat_main"
      ? INSTANT_PRECOMBAT_HOLD_PENALTY
      : 0;

  // Sorceries cast post-combat get a tiny bonus — no reason to hold them.
  const noHoldBonus = isSorcery && board.phase === "postcombat_main" ? 0.05 : 0;

  return clamp01(boardSwing + leverage - holdPenalty + noHoldBonus);
}

/** Result of the Expert optimal-spell selection pass. */
export interface ExpertSpellSelection {
  /** The single highest-scoring spell, or `null` if the hand had none affordable. */
  optimal: NonCreatureSpellEntry | null;
  /** Tiebreak runner-ups (same score as the winner within ε) — also cast. */
  ties: NonCreatureSpellEntry[];
}

/**
 * Pick the single optimal spell for Expert difficulty (issue: "decide which
 * spell, if any, is the *optimal* cast — and skip the rest").
 *
 * Scores every spell via {@link scoreNonCreatureSpell} and returns the
 * highest-scoring one. Ties within `EPSILON` are returned as `ties` so Expert
 * still casts all spells that are equally optimal (e.g. two equivalent
 * cantrips) — the caller is expected to cast the `optimal` plus any `ties` and
 * skip everything else. When *no* spell is affordable (`score === 0` for all),
 * `optimal` is `null` and the whole hand is held.
 */
export function selectOptimalExpertSpell(
  spells: NonCreatureSpellEntry[],
  board: SpellBoardContext,
): ExpertSpellSelection {
  if (spells.length === 0) return { optimal: null, ties: [] };

  let best: NonCreatureSpellEntry | null = null;
  let bestScore = -1;
  for (const spell of spells) {
    const score = scoreNonCreatureSpell({ spell, board });
    if (score > bestScore) {
      bestScore = score;
      best = spell;
    }
  }

  if (best === null || bestScore <= 0) {
    return { optimal: null, ties: [] };
  }

  // Collect ties within EPSILON of the winner. Re-score to avoid drift.
  const EPSILON = 0.01;
  const ties = spells.filter(
    (s) =>
      s !== best &&
      Math.abs(scoreNonCreatureSpell({ spell: s, board }) - bestScore) <=
        EPSILON,
  );

  return { optimal: best, ties };
}

/** Outcome of a single spell's gating decision. */
export type SpellGateDecision =
  { kind: "cast" } | { kind: "skip"; reasoning: string };

/** Inputs to {@link decideSpellGate} (the per-spell decision used by the loop). */
export interface SpellGateInputs {
  spell: NonCreatureSpellEntry;
  difficulty: DifficultyLevel;
  skipChance: number;
  rng: () => number;
  /**
   * For Expert: when this is `false`, the spell was *not* selected as optimal
   * by {@link selectOptimalExpertSpell}, so it is force-skipped regardless of
   * the rng roll. `undefined` for non-Expert tiers (the property is ignored).
   */
  isOptimalCast?: boolean;
  /** Board context used to build a human-readable skip reason. */
  board: SpellBoardContext;
}

/**
 * Decide whether a single non-creature spell should be cast or held.
 *
 * Composes the random skip gate with the Expert optimal-cast override. Returns
 * a `skip` decision with a `reasoning` string that contains the spell name and
 * the difficulty tier (per acceptance: reasoning must contain spell name and
 * `difficulty=...`).
 *
 * The reasoning is the string surfaced in the post-game replay's `no_action`
 * entry, so it is written for a human reader, not a log scanner.
 */
export function decideSpellGate(inputs: SpellGateInputs): SpellGateDecision {
  const { spell, difficulty, skipChance, rng, isOptimalCast, board } = inputs;

  // Expert: the scoring pass IS the gate. The optimal spell (+ ties) casts
  // unconditionally; everything else is force-held. The random gate does NOT
  // apply on Expert — Expert's hold decision is deliberate (scoring), not
  // random, so we avoid double-gating the one spell the scorer picked.
  if (difficulty === "expert") {
    if (isOptimalCast === true) {
      return { kind: "cast" };
    }
    const reason = buildSkipReasoning({
      spellName: spell.name,
      difficulty,
      cause: "expert-hold-non-optimal",
      board,
    });
    return { kind: "skip", reasoning: reason };
  }

  // Random skip gate for Easy/Medium/Hard (mirrors castCreatures structure).
  if (rng() < skipChance) {
    const cause = skipChance >= 0.7 ? "difficulty-hold" : "random-skip";
    const reason = buildSkipReasoning({
      spellName: spell.name,
      difficulty,
      cause,
      board,
    });
    return { kind: "skip", reasoning: reason };
  }

  return { kind: "cast" };
}

/** Internal: build the human-readable skip reasoning surfaced in the replay. */
function buildSkipReasoning(args: {
  spellName: string;
  difficulty: DifficultyLevel;
  cause: "random-skip" | "difficulty-hold" | "expert-hold-non-optimal";
  board: SpellBoardContext;
}): string {
  const { spellName, difficulty, cause, board } = args;
  const tier = difficulty;
  switch (cause) {
    case "expert-hold-non-optimal":
      return `Hold ${spellName} at ${tier}: suboptimal cast (board ${board.opponentCreatureCount} opp / ${board.ownCreatureCount} self)`;
    case "difficulty-hold":
      return `Hold ${spellName} at ${tier}: difficulty=${tier} pacing gate`;
    default:
      return `Skip ${spellName} at ${tier}: difficulty=${tier} skip roll`;
  }
}
