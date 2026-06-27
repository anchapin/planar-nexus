/**
 * @fileoverview AI Telegraph System (issue #993)
 *
 * A beginner-friendly coaching layer that surfaces *why* the AI is making each
 * decision, in plain language, so new players can learn from the opponent.
 *
 * Design:
 *   - Verbosity is difficulty-gated via {@link TelegraphLevel} (0/1/2), which
 *     lives on {@link AIDifficultyConfig.telegraphLevel} and is resolved through
 *     the canonical difficulty taxonomy (issue #1064/#1192). Easy = 2 (detailed
 *     coaching), expert = 0 (silent — never reveal strategy to a player who
 *     wants a challenge).
 *   - The decision path already computes rich internal "reasoning" strings
 *     (combat decision tree, threat assessment). These generators translate that
 *     internal reasoning + a board {@link TelegraphContext} (ahead/behind) into
 *     human-readable telegraphs that reference the *real* reason (pressing an
 *     advantage, racing back, removing a threat, holding a blocker, accepting a
 *     trade) — never generic filler.
 *   - Every generator is pure and returns `null` at level 0, so callers can
 *     unconditionally pipe the result into a commentary callback and stay silent
 *     at expert difficulty with no extra branching.
 */

import {
  resolveDifficultyConfig,
  type DifficultyLevel,
  type DifficultyFormat,
} from "./ai-difficulty";

/** Telegraph verbosity tiers. */
export const TELEGRAPH_NONE = 0 as const;
export const TELEGRAPH_BASIC = 1 as const;
export const TELEGRAPH_DETAILED = 2 as const;
export type TelegraphLevel = 0 | 1 | 2;

/**
 * Resolve the active telegraph level for a (difficulty, format) pair from the
 * canonical difficulty config. Out-of-range / malformed values clamp to a valid
 * tier (defensive — persisted config or a partial format override could supply
 * anything), defaulting to "none" so a misconfiguration never leaks strategy.
 */
export function getTelegraphLevel(
  difficulty: DifficultyLevel,
  format?: DifficultyFormat,
): TelegraphLevel {
  const raw = resolveDifficultyConfig(difficulty, format).telegraphLevel;
  if (raw >= 2) return TELEGRAPH_DETAILED;
  if (raw >= 1) return TELEGRAPH_BASIC;
  return TELEGRAPH_NONE;
}

/** Whether *any* telegraph output should be produced at this level. */
export function shouldTelegraph(level: TelegraphLevel): boolean {
  return level !== TELEGRAPH_NONE;
}

/**
 * The board-level "why" that makes telegraphs meaningful instead of generic.
 *
 * `aiAhead` / `aiBehind` are derived from life totals + board presence (see
 * {@link classifyStanding}) and drive the motive clause of every telegraph
 * ("to press its advantage" vs "trying to claw back into the game").
 */
export interface TelegraphContext {
  /** True when the AI is clearly ahead on life + board. */
  aiAhead: boolean;
  /** True when the AI is clearly behind / under pressure. */
  aiBehind: boolean;
  /** AI life total (used for low-life framing when available). */
  aiLife?: number;
  /** Opponent life total (for context). */
  opponentLife?: number;
}

/**
 * Low-life threshold (per side). Below this the AI is in "survival" framing,
 * which overrides the generic ahead/behind motive in the telegraph copy.
 */
export const LOW_LIFE_THRESHOLD = 8;

/**
 * Classify the AI's standing into a {@link TelegraphContext} from the raw
 * ingredients the turn loop already has lying around (life totals + creature
 * counts on each side of the board). Pure and allocation-free so it can run
 * every turn without measurable cost.
 *
 * `maxCreatureDelta` clamps how much a board-count lead can swing the standing
 * so a single extra token never reads as "far ahead".
 */
export function classifyStanding(
  aiLife: number,
  opponentLife: number,
  aiCreatures: number,
  opponentCreatures: number,
  maxCreatureDelta = 3,
): TelegraphContext {
  // Life differential (per side): each point of life is worth a small, bounded
  // contribution; board presence contributes up to the delta cap.
  const lifeDiff = aiLife - opponentLife;
  const creatureDiff = Math.max(
    -maxCreatureDelta,
    Math.min(maxCreatureDelta, aiCreatures - opponentCreatures),
  );
  // Combined "advantage score": life and board on the same scale. The +2 hyst
  // deadband means trivially close boards read as "neutral" rather than
  // flip-flopping ahead/behind every turn.
  const score = lifeDiff * 0.6 + creatureDiff * 3;
  const ahead = score >= 3;
  const behind = score <= -3;
  return {
    aiAhead: ahead,
    aiBehind: behind,
    aiLife,
    opponentLife,
  };
}

/** Whether the AI is in survival range (low life) for a given context. */
export function isLowLife(ctx: TelegraphContext): boolean {
  return ctx.aiLife !== undefined && ctx.aiLife <= LOW_LIFE_THRESHOLD;
}

/**
 * The motive clause attached to detailed telegraphs — the part that makes the
 * explanation reference the *real* strategic reason instead of being generic.
 */
export function motiveClause(ctx: TelegraphContext): string {
  if (isLowLife(ctx)) return " to stay alive";
  if (ctx.aiAhead) return " to press its advantage";
  if (ctx.aiBehind) return " trying to claw back into the game";
  return " to develop its position";
}

// ---------------------------------------------------------------------------
// Per-kind telegraph generators. Each is pure, level-gated (returns null at 0)
// and at level 2 references the real reason via the internal reasoning string
// + the standing context.
// ---------------------------------------------------------------------------

/**
 * Parse the combat decision tree's internal attack reasoning into a
 * beginner-readable quality descriptor ("a strong attack", etc.).
 */
function attackQuality(internalReasoning: string): {
  quality: string;
  evasion: boolean;
} {
  const r = internalReasoning.toLowerCase();
  const evasion =
    /evasion|flying|unblockable|menace|trample|shadow|intimidate/.test(r);
  let quality = "an attack";
  if (/high value/.test(r)) quality = "a strong attack";
  else if (/good attack/.test(r)) quality = "a good attack";
  else if (/worthwhile/.test(r)) quality = "a worthwhile attack";
  return { quality, evasion };
}

/** Common options for a per-kind telegraph generator. */
export interface TelegraphOptions {
  /** Display name of the acting subject (creature / spell). */
  subject: string;
  /** The decision path's internal reasoning string (parsed for the "why"). */
  internalReasoning?: string;
  /** Board standing — supplies the motive clause. */
  context: TelegraphContext;
  /** Target of the action (attacker blocked, threat removed), for copy. */
  target?: string;
  /** True when the spell removes a permanent (removal framing). */
  isRemoval?: boolean;
}

/**
 * Telegraph for an attacking creature.
 *
 * - level 0 → none
 * - level 1 → "AI attacks with {subject}." (action only)
 * - level 2 → beginner coaching: quality + evasion + motive ("AI sends Grizzly
 *   Bears into combat — it looks like a strong attack, and it's hard to block
 *   (evasion), to press its advantage.")
 */
export function generateAttackTelegraph(
  opts: TelegraphOptions,
  level: TelegraphLevel,
): string | null {
  if (level === TELEGRAPH_NONE) return null;
  const { subject, internalReasoning, context } = opts;
  if (level === TELEGRAPH_BASIC) return `AI attacks with ${subject}.`;

  const { quality, evasion } = attackQuality(internalReasoning ?? "");
  const evasionClause = evasion ? ", and it's hard to block (evasion)" : "";
  return `AI sends ${subject} into combat — it looks like ${quality}${evasionClause}${motiveClause(context)}.`;
}

/**
 * Telegraph for a creature the AI chose NOT to attack with (held back).
 *
 * Holds are tactical ("held as a blocker") and the most instructive for
 * beginners, so they are surfaced only at the detailed (easy) level — the basic
 * tier stays quiet rather than narrating every non-action.
 */
export function generateHoldTelegraph(
  opts: TelegraphOptions,
  level: TelegraphLevel,
): string | null {
  if (level !== TELEGRAPH_DETAILED) return null;
  const { subject, internalReasoning, context } = opts;
  const r = internalReasoning ?? "";
  let body: string;
  if (/too risky|would likely die|likely die/.test(r)) {
    body = `attacking would likely get ${subject} killed for nothing`;
  } else if (/hold for defense|hold .* defense/.test(r)) {
    body = `${subject} is more valuable staying back as a blocker to stay safe`;
  } else if (/not worth attacking|low value/.test(r)) {
    body = `there's no profitable attack for ${subject} this turn`;
  } else {
    body = isLowLife(context)
      ? `${subject} stays back to defend while the AI is low on life`
      : `${subject} is held back this turn`;
  }
  return `AI keeps ${subject} in reserve — ${body}.`;
}

/**
 * Telegraph for the AI blocking an attacker (defensive side of combat).
 *
 * - level 1 → "AI blocks with {subject}."
 * - level 2 → references the trade outcome ("wins the fight and survives",
 *   "accepting a trade", "chump-blocks to stop the damage").
 */
export function generateBlockTelegraph(
  opts: TelegraphOptions,
  level: TelegraphLevel,
): string | null {
  if (level === TELEGRAPH_NONE) return null;
  const { subject, internalReasoning, target } = opts;
  const targetName = target ?? "your attacker";
  if (level === TELEGRAPH_BASIC) {
    return `AI blocks ${targetName} with ${subject}.`;
  }
  const r = internalReasoning ?? "";
  let outcome: string;
  if (/kills .* and survives|and survives/.test(r)) {
    outcome = `it wins the fight and survives`;
  } else if (/trades/.test(r)) {
    outcome = `accepting a trade`;
  } else if (/chump/.test(r)) {
    outcome = `chump-blocking to stop the damage`;
  } else {
    outcome = `to stop the attack`;
  }
  return `AI blocks ${targetName} with ${subject} — ${outcome}.`;
}

/**
 * Telegraph for the AI casting a spell.
 *
 * Removal is the most instructive case for beginners ("cast to remove your
 * biggest threat"), so it is detected from the spell text when the caller does
 * not pass an explicit {@link TelegraphOptions.isRemoval} flag.
 *
 * - level 1 → "AI casts {subject}."
 * - level 2 → removal: "AI casts Doom Blade to remove your Grave Titan — it
 *   sees it as the biggest threat."; otherwise motive-driven coaching.
 */
export function generateCastTelegraph(
  opts: TelegraphOptions,
  level: TelegraphLevel,
): string | null {
  if (level === TELEGRAPH_NONE) return null;
  const { subject, context, target } = opts;
  if (level === TELEGRAPH_BASIC) return `AI casts ${subject}.`;

  const removal = opts.isRemoval ?? false;
  if (removal) {
    const threatClause = target
      ? ` to remove your ${target} — it sees it as the biggest threat`
      : ` to get your most dangerous permanent off the board`;
    return `AI casts ${subject}${threatClause}.`;
  }
  return `AI casts ${subject}${motiveClause(context)}.`;
}

/**
 * Detect whether a spell reads as removal, from its type line and oracle text.
 *
 * Used by the turn loop when it does not have a structured spell classification
 * handy: instants/sorceries whose text destroys/exiles/-X/-N damages a
 * permanent count as removal so the cast telegraph gets the instructive
 * "removing your threat" framing. Conservative — false negatives fall back to a
 * generic develop-the-board telegraph, which is still meaningful.
 */
export function isRemovalSpell(
  typeLine: string | undefined,
  oracleText: string | undefined,
): boolean {
  const t = (typeLine ?? "").toLowerCase();
  if (!t.includes("instant") && !t.includes("sorcery")) return false;
  const o = (oracleText ?? "").toLowerCase();
  return /\bdestroy\b|\bexile\b|\bdestroy target\b|\bdeals? .* damage to target creature|\b-?\d+\/-?\d+|target creature gets -/.test(
    o,
  );
}

/**
 * Unified dispatcher: pick the right generator for a decision kind. Keeps the
 * turn loop's call sites to a single function and gives tests one entry point
 * for "representative decision" coverage.
 */
export type TelegraphKind = "attack" | "hold" | "block" | "cast";

export function generateTelegraph(
  kind: TelegraphKind,
  opts: TelegraphOptions,
  level: TelegraphLevel,
): string | null {
  switch (kind) {
    case "attack":
      return generateAttackTelegraph(opts, level);
    case "hold":
      return generateHoldTelegraph(opts, level);
    case "block":
      return generateBlockTelegraph(opts, level);
    case "cast":
      return generateCastTelegraph(opts, level);
    default:
      return null;
  }
}
