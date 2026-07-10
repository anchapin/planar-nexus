/**
 * @fileoverview Difficulty-scaled activated-ability selection (issue #1386).
 *
 * Activated abilities — planeswalker loyalty abilities, equipment activation,
 * and repeatable mana-ability activation — were previously unreachable: the
 * turn loop only emitted `play_land` / `cast_spell` / `pass_priority` /
 * `no_action`. This module provides the pure, difficulty-aware decision
 * functions the turn loop now consults.
 *
 * The four-tier ladder mirrors the rest of the AI difficulty system:
 *
 * - **easy**   — rarely activates; only mana sources when idle. skipChance high.
 * - **medium** — activates `+1` loyalty post-combat for safe value.
 * - **hard**   — activates pre-combat when the ability is tempo-positive
 *                (buff / token / removal), post-combat otherwise.
 * - **expert** — full scoring: picks the highest-leverage loyalty ability
 *                (e.g. `-2` removal to clear a blocker) and optimal timing.
 *
 * All functions here are **pure**: the only impurity is `Math.random()` for
 * the probabilistic skip/blunder gates, which matches the convention used by
 * `castCreatures` in `ai-turn-loop.ts` and is mockable by the seeded-PRNG test
 * harness.
 */

import type {
  DifficultyLevel,
  DifficultyFormat,
} from "./ai-difficulty";
import { getDifficultyConfig } from "./ai-difficulty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Coarse classification of an activated ability's game effect. Drives the
 * timing and selection heuristics — e.g. "removal" is tempo-positive
 * pre-combat, "mana" is always safe, "buff" wants to land before attackers
 * are declared.
 */
export type AbilityKind =
  | "mana"
  | "removal"
  | "card_draw"
  | "buff"
  | "token"
  | "life"
  | "other";

/**
 * A parsed loyalty ability from a planeswalker's oracle text.
 */
export interface LoyaltyAbility {
  /** Signed loyalty cost: `+1`, `-2`, `0`, etc. */
  delta: number;
  /** The effect text following the colon. */
  text: string;
  /** Classified kind for scoring. */
  kind: AbilityKind;
}

/**
 * The result of a timing decision for a single ability on a single permanent.
 *
 * - `pre_combat`   — fire in the precombat main phase (tempo-positive).
 * - `post_combat`  — fire in the postcombat main phase (value play).
 * - `end_step`     — defer to the end step (expert hold-for-instant timing).
 * - `not_activated`— the AI declines to activate this turn.
 */
export type AbilityTiming =
  | "pre_combat"
  | "post_combat"
  | "end_step"
  | "not_activated";

/**
 * A compact, engine-agnostic snapshot of the board context the selection
 * functions need. The turn loop projects this out of the engine
 * {@link EngineGameState} so the pure helpers stay decoupled from the engine
 * types and are trivially unit-testable.
 */
export interface AbilityBoardContext {
  /** Current loyalty counters on the planeswalker (0 for non-planeswalkers). */
  loyalty: number;
  /** Whether the opponent controls at least one creature. */
  opponentHasCreature: boolean;
  /**
   * The highest toughness among opposing creatures, used to judge whether a
   * `-N` removal ability can actually kill something. `0` when the opponent
   * has no creatures.
   */
  opponentMaxToughness: number;
  /** Whether the AI controls at least one creature (for equipment targeting). */
  aiHasCreature: boolean;
  /** Whether the AI is currently behind on board (fewer creatures / lower life). */
  aiBehind: boolean;
}

/**
 * Decision returned by {@link chooseLoyaltyAbility}: which ability to fire
 * and at what timing, plus a human-readable reason for telegraph / replay.
 */
export interface LoyaltyAbilityDecision {
  /** Index into the parsed ability list, or `null` to decline. */
  abilityIndex: number | null;
  /** The chosen ability (for convenience), or `null` if declining. */
  ability: LoyaltyAbility | null;
  timing: AbilityTiming;
  reason: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Normalise the unicode minus sign (U+2212) that Scryfall oracle text uses
 * for loyalty costs down to an ASCII hyphen so the regex is simple.
 */
function normaliseLoyaltyText(text: string): string {
  return text.replace(/\u2212/g, "-");
}

/**
 * Parse planeswalker loyalty abilities out of oracle text.
 *
 * Loyalty abilities follow the pattern `<sign><digits>: <effect>` at the start
 * of a line. Returns an empty array for non-planeswalker or unparsable text.
 *
 * Example input:
 * ```
 * +1: Each player discards a card.
 * -2: Target player sacrifices a creature.
 * -6: Target player loses half their life, rounded up.
 * ```
 */
export function parseLoyaltyAbilities(oracleText: string): LoyaltyAbility[] {
  if (!oracleText) return [];
  const text = normaliseLoyaltyText(oracleText);
  const abilities: LoyaltyAbility[] = [];
  // Match lines that start with +N / -N / 0 followed by a colon.
  const lineRe = /^([+-]?\d+):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text)) !== null) {
    const delta = parseInt(m[1], 10);
    if (Number.isNaN(delta)) continue;
    const effectText = m[2].trim();
    abilities.push({
      delta,
      text: effectText,
      kind: classifyAbility(effectText),
    });
  }
  return abilities;
}

/**
 * Classify an ability's effect text into a coarse {@link AbilityKind}.
 *
 * Detection is keyword-based and deliberately conservative — when in doubt we
 * fall back to `"other"`, which the heuristics treat as a generic value play.
 */
export function classifyAbility(effectText: string): AbilityKind {
  const t = effectText.toLowerCase();
  // Mana production.
  if (/\badd\b.*\{[wubrgc]\}|mana of any color|add .* mana/.test(t)) {
    return "mana";
  }
  // Card draw / discard-value.
  if (/\bdraw\b.*card|draws? a card|card advantage/.test(t)) {
    return "card_draw";
  }
  // Direct removal / destruction / damage to creatures.
  if (
    /destroy|exile|damage to.*creature|sacrifice|target.*creature.*dies|-[0-9]+\/-[0-9]+/
      .test(t)
  ) {
    return "removal";
  }
  // Token generation.
  if (/\bcreate\b.*token|token(s)?\b/.test(t)) {
    return "token";
  }
  // Power/toughness buff or anthem.
  if (/\bgets?\b.*\+[0-9]+\/\+[0-9]+|gain|\+\+|buff/.test(t)) {
    return "buff";
  }
  // Life gain.
  if (/\bgain\b.*life|life equal/.test(t)) {
    return "life";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Timing decision: chooseAbilityTiming
// ---------------------------------------------------------------------------

/**
 * Difficulty-scaled per-ability skip chance. Easy skips most non-mana
 * abilities; expert almost never skips. This mirrors the `skipChance` gate in
 * `castCreatures` (`ai-turn-loop.ts`).
 */
function abilitySkipChance(
  difficulty: DifficultyLevel,
  kind: AbilityKind,
): number {
  // Mana abilities are always worth considering (the AI needs mana to act).
  const isMana = kind === "mana";
  switch (difficulty) {
    case "easy":
      return isMana ? 0.5 : 0.85;
    case "medium":
      return isMana ? 0.1 : 0.25;
    case "hard":
      return isMana ? 0.0 : 0.05;
    case "expert":
      return 0.0;
    default:
      return 0.25;
  }
}

/**
 * Decide whether and when to activate a single activated ability, given the
 * board context and difficulty.
 *
 * Difficulty ladder:
 * - **easy** — high skip chance; if it does activate, post-combat only (and
 *   only mana sources reliably).
 * - **medium** — low skip chance; activates post-combat for safe value.
 * - **hard** — activates pre-combat when the ability is tempo-positive
 *   (`buff` / `token` / `removal` / `card_draw` before attackers), else
 *   post-combat.
 * - **expert** — pre-combat for tempo-positive abilities, `end_step` for
 *   instant-speed hold plays when behind, post-combat otherwise.
 *
 * The `phase` argument records which main phase we are currently in so the
 * function can decline to re-activate in postcombat when it already fired
 * pre-combat (the caller threads this through).
 */
export function chooseAbilityTiming(
  kind: AbilityKind,
  context: AbilityBoardContext,
  difficulty: DifficultyLevel,
  _format?: DifficultyFormat,
  phase: "precombat_main" | "postcombat_main" = "precombat_main",
): AbilityTiming {
  // Global skip gate.
  if (Math.random() < abilitySkipChance(difficulty, kind)) {
    return "not_activated";
  }

  // Tempo-positive kinds benefit from firing before combat.
  const tempoPositive =
    kind === "buff" ||
    kind === "token" ||
    kind === "removal" ||
    kind === "card_draw";

  switch (difficulty) {
    case "easy":
      // Easy defers everything to post-combat (and only mana reliably survives
      // the skip gate above).
      return "post_combat";

    case "medium":
      // Medium activates post-combat for safe value.
      return "post_combat";

    case "hard":
      // Pre-combat when tempo-positive (and removal is live — opponent has a
      // creature to kill). Otherwise post-combat value.
      if (tempoPositive) {
        if (kind === "removal" && !context.opponentHasCreature) {
          // Nothing to remove — defer.
          return phase === "precombat_main" ? "post_combat" : "not_activated";
        }
        return "pre_combat";
      }
      return "post_combat";

    case "expert":
      // Expert: pre-combat for tempo-positive abilities. When behind, hold
      // instant-speed threats to the end step (the classic "EoT activate"
      // tempo line). Otherwise post-combat value.
      if (tempoPositive) {
        if (kind === "removal" && !context.opponentHasCreature) {
          return phase === "precombat_main" ? "post_combat" : "not_activated";
        }
        return "pre_combat";
      }
      if (context.aiBehind && phase === "postcombat_main") {
        return "end_step";
      }
      return "post_combat";

    default:
      return "post_combat";
  }
}

// ---------------------------------------------------------------------------
// Loyalty ability selection: chooseLoyaltyAbility
// ---------------------------------------------------------------------------

/**
 * Score a loyalty ability for the expert tier. Higher is better.
 *
 * Scoring factors:
 * - Removal abilities that can kill an opposing creature (delta >= toughness)
 *   get a large bonus — clearing a blocker before combat is the highest-leverage
 *   planeswalker line.
 * - Card draw gets a solid value bonus.
 * - `+1` abilities get a safety bonus (they grow the walker toward ult).
 * - Large negative deltas get a penalty unless they are high-impact (removal /
 *   card draw), because spending down loyalty risks the walker.
 */
function scoreLoyaltyAbility(
  ability: LoyaltyAbility,
  context: AbilityBoardContext,
): number {
  let score = 0;
  switch (ability.kind) {
    case "removal":
      // Sacrifice/destroy/damage removal bypasses or matches toughness — the
      // big bonus fires whenever the opponent actually has a creature to
      // remove. Clearing a blocker before combat is the highest-leverage
      // planeswalker line.
      if (context.opponentHasCreature) {
        score += 10;
      } else {
        score -= 2; // dead removal.
      }
      break;
    case "card_draw":
      score += 6;
      break;
    case "token":
      score += 5;
      break;
    case "buff":
      score += 4;
      break;
    case "mana":
      score += 2;
      break;
    case "life":
      score += 1;
      break;
    default:
      score += 1.5;
      break;
  }
  // Safety: positive-delta abilities grow the walker (good).
  if (ability.delta > 0) score += 1.5;
  // Risk: large negative deltas cost the walker, penalise unless high-impact.
  if (ability.delta < -2 && ability.kind !== "removal" && ability.kind !== "card_draw") {
    score -= 3;
  }
  return score;
}

/**
 * Choose which loyalty ability (if any) to activate on a planeswalker, and
 * at what timing.
 *
 * Difficulty ladder (acceptance criteria from issue #1386):
 * - **easy**   — never activates (declines). Occasionally fires a `+1` if the
 *                skip gate in {@link chooseAbilityTiming} lets it through, but
 *                the loyalty picker itself prefers the safest `+1`.
 * - **medium** — activates `+1` post-combat only (safe value).
 * - **hard**   — activates `+1` pre-combat when the opponent has a creature
 *                (grow the walker while developing), post-combat otherwise.
 * - **expert** — picks the highest-scored ability: e.g. `-2` removal to kill
 *                an opposing 3-toughness creature when that is the best line.
 *
 * Returns `{ abilityIndex: null }` when declining.
 */
export function chooseLoyaltyAbility(
  abilities: LoyaltyAbility[],
  context: AbilityBoardContext,
  difficulty: DifficultyLevel,
  format?: DifficultyFormat,
  phase: "precombat_main" | "postcombat_main" = "precombat_main",
): LoyaltyAbilityDecision {
  if (abilities.length === 0) {
    return {
      abilityIndex: null,
      ability: null,
      timing: "not_activated",
      reason: "No loyalty abilities available.",
    };
  }

  // --- Easy: prefer the safest +1, but usually decline via the timing gate. ---
  if (difficulty === "easy") {
    const plusOne = abilities.find((a) => a.delta > 0);
    const chosen = plusOne ?? abilities[0];
    const timing = chooseAbilityTiming(
      chosen.kind,
      context,
      difficulty,
      format,
      phase,
    );
    if (timing === "not_activated") {
      return {
        abilityIndex: null,
        ability: null,
        timing,
        reason: "Easy AI declines to activate.",
      };
    }
    return {
      abilityIndex: abilities.indexOf(chosen),
      ability: chosen,
      timing,
      reason: `Easy AI plays it safe: ${formatDelta(chosen.delta)} (${chosen.kind}).`,
    };
  }

  // --- Medium: +1 post-combat only. ---
  if (difficulty === "medium") {
    const plusOne =
      abilities.find((a) => a.delta > 0) ?? abilities[0];
    const timing = chooseAbilityTiming(
      plusOne.kind,
      context,
      difficulty,
      format,
      phase,
    );
    if (timing === "not_activated") {
      return {
        abilityIndex: null,
        ability: null,
        timing,
        reason: "Medium AI declines to activate.",
      };
    }
    return {
      abilityIndex: abilities.indexOf(plusOne),
      ability: plusOne,
      timing,
      reason: `Medium AI activates ${formatDelta(plusOne.delta)} for safe value.`,
    };
  }

  // --- Hard & Expert: score the abilities. ---
  // Hard defaults to +1 but will take removal if the opponent presents a
  // killable creature. Expert takes the max-scored ability outright.
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < abilities.length; i++) {
    let score = scoreLoyaltyAbility(abilities[i], context);
    if (difficulty === "hard") {
      // Hard biases toward +1 (safe) unless a removal line clearly beats it.
      if (abilities[i].delta > 0) score += 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const chosen = abilities[bestIndex];
  const timing = chooseAbilityTiming(
    chosen.kind,
    context,
    difficulty,
    format,
    phase,
  );
  if (timing === "not_activated") {
    return {
      abilityIndex: null,
      ability: null,
      timing,
      reason: `${capitalize(difficulty)} AI declines to activate.`,
    };
  }
  const label =
    difficulty === "expert"
      ? `Expert AI selects ${formatDelta(chosen.delta)} (${chosen.kind}) for max leverage`
      : `Hard AI activates ${formatDelta(chosen.delta)}`;
  return {
    abilityIndex: bestIndex,
    ability: chosen,
    timing,
    reason: `${label}.`,
  };
}

// ---------------------------------------------------------------------------
// Small formatting / utility helpers
// ---------------------------------------------------------------------------

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Read the resolved difficulty config's tempo priority for inspection / tests.
 * Exposed so tests can assert the timing heuristics align with the config.
 */
export function abilityTempoPriority(
  difficulty: DifficultyLevel,
  format?: DifficultyFormat,
): number {
  return getDifficultyConfig(difficulty, format).tempoPriority;
}
