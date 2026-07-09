/**
 * @fileoverview Opponent combo-assembly detector (issue #1232).
 *
 * The AI's own {@link ARCHETYPE_COMBAT_MODIFIERS} treat its `combo` archetype
 * conservatively (low aggression, high life threshold) and its
 * {@link LookaheadEngine} projects 1-4 turns ahead — but it never asks
 * "is the opponent *also* assembling a combo?" In real MTG, missing that
 * signal is the difference between Hard and Expert: a Thassa's Oracle /
 * Splinter Twin / Storm player who assembles unaddressed ends the game
 * before the AI realises it has lost.
 *
 * This module fills that gap with a lightweight, deterministic detector
 * keyed on the *card name patterns* the deck-archetype scorer uses
 * (`archetype-signatures.ts`). It inspects three opponent zones (hand,
 * battlefield, graveyard — collectively the "known cards" the AI has
 * observed this game) and returns one of three threat levels:
 *
 *   - `none`     — no combo signature visible. Default.
 *   - `building` — 1 piece (or strong peer support) visible. AI should
 *                 prepare disruption but not panic.
 *   - `imminent` — 2+ pieces visible AND the opponent looks to be at the
 *                 required mana to assemble next turn (or already has
 *                 mana open). AI must pressure the opponent immediately.
 *
 * The detector is `pure`: no mutation, no async, no Math.random. That
 * keeps both unit tests and per-game event emission deterministic, which
 * is what the issue requires for "post-game review".
 *
 * Combo patterns are derived from the combo archetypes in
 * `archetype-signatures.ts` (Storm, Reanimator, Infinite/Twin/Consult).
 * They intentionally ignore pure-rate card names (e.g. "Llanowar Elves")
 * because the question is "is the opponent *assembling a combo?*", not
 * "is the opponent playing a beatdown deck?". Combat-eval handles the
 * latter.
 */

import type { AIGameState, AIHandCard, AIPermanent } from "@/lib/game-state/types";
import { DIFFICULTY_LEVELS, type DifficultyLevel } from "@/ai/ai-difficulty";
import type { DeckArchetype } from "@/ai/game-state-evaluator";

/**
 * The set of known combo pieces, grouped by the canonical combo archetype
 * they enable. Members are lower-cased substrings matched against observed
 * opponent card names (`AIHandCard.name`, `AIPermanent.name`,
 * graveyard/exile string IDs are passed through unchanged so this stays a
 * single match function).
 *
 * Sources
 * -------
 *  - Storm archetype (`archetype-signatures.ts:480-506`):
 *    storm, tendrils, past in flames, dark ritual, cabal ritual,
 *    mana crypt, cantrip pattern, ritual pattern.
 *  - Reanimator archetype (`archetype-signatures.ts:507-531`):
 *    reanimate, animate dead, necromancy, exhume, entomb, griselbrand,
 *    graveyard as a *signal* (reanimation enabler).
 *  - Infinite archetype (`archetype-signatures.ts:532-556`):
 *    thassa / oracle (Consult), kiki / exarch (Kiki combo),
 *    splinter / twin (Splinter Twin), pact / protean, dramatic /
 *    reversal (dramatic reversal / salvage).
 *
 * This table is deliberately conservative: false positives hurt the AI
 * less than false negatives for this detector (it just pressures the
 * opponent a turn early), so we over-include borderline names and let
 * the tier-thresholds gate the resulting threat level.
 */
export const COMBO_PATTERNS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  storm: [
    "storm",
    "tendrils",
    "past in flames",
    "dark ritual",
    "cabal ritual",
    "mana crypt",
    "seething song",
    "pyretic ritual",
    "baral",
    "wizards sleeve",
  ],
  reanimator: [
    "reanimate",
    "animate dead",
    "necromancy",
    "exhume",
    "entomb",
    "life // death",
    "dance of the dead",
    "chancellor of the forge",
    "revan",
    "archon of absolution",
  ],
  infinite: [
    "thassa",
    "oracle",
    "kiki",
    "exarch",
    "pestermite",
    "splinter twin",
    "twin",
    "pact of negation",
    "protean hulk",
    "dramatic reversal",
    "salvage",
    "monarch",
    "biovisionary",
  ],
  consultation: [
    "consult",
    "sylvan library",
    "doomsday",
    "ledger shredder",
    "brain freeze",
  ],
};

/**
 * Per-archetype mana thresholds for an `imminent` declaration. These are
 * intentionally generous (e.g. Storm at 5 mana) — the over-trigger risk
 * here is "AI pressures a turn too early"; the under-trigger risk is
 * "AI loses to a combo it saw coming". The latter is the issue we are
 * fixing.
 */
export const COMBO_IMMINENT_MANA: Readonly<Record<string, number>> = {
  storm: 5,
  reanimator: 3,
  infinite: 4,
  consultation: 3,
};

/**
 * The result of a single threat-detection pass.
 *
 * The `archetype` field reports the combo family that scored the highest
 * (so downstream consumers can prefer pieces for the right threat); it
 * is `null` when nothing matched (threat is always `none` in that case).
 */
export interface ComboThreatAssessment {
  /**
   * Threat tier:
   *   - `imminent`: 2+ matching pieces + opponent has the mana to assemble
   *                 (or the threat is from permanents already on board).
   *   - `building` : 1 matching piece, or support (tutor / ritual) indicates
   *                 the deck is working toward a combo.
   *   - `none`     : no signal.
   */
  threat: "imminent" | "building" | "none";

  /** The combo family that scored highest (null when no signal). */
  archetype: string | null;

  /** How many distinct pieces matched (cap at 6 to keep reports compact). */
  piecesPresent: number;

  /** Summary names of the matched pieces (deduplicated, lower-case). */
  matchedPieces: string[];

  /**
   * Summary names the AI considers critical missing pieces (heuristic
   * list — the AI doesn't know the opponent's hand, only its previous
   * plays). Always empty when threat is `none`.
   */
  missingPieces: string[];

  /**
   * Detection depth used: the max number of opponent cards sampled per
   * zone. Lower difficulties use a smaller depth (and so a shallower view
   * of the opponent's possible combo) — see {@link detectionDepthForTier}.
   * Exposed primarily for tests and the event-emitting call site that
   * needs to record *why* a threat declaration was made.
   */
  detectionDepth: number;
}

/**
 * Coarse-grained options that callers can pass to {@link detectComboAssembly}.
 *
 * The full {@link ComboThreatAssessment} API takes `opponentKnownCards`
 * directly so the function stays pure and testable. This wrapping exists
 * for the live call sites that read AIGameState and want to apply a
 * per-difficulty depth cap automatically.
 */
export interface DetectComboOptions {
  /** Difficulty tier — drives detection depth and threat escalation. */
  difficulty: DifficultyLevel;
  /**
   * Override the per-zone sample cap. When undefined, the function uses
   * {@link detectionDepthForTier}.
   */
  detectionDepth?: number;
}

/**
 * Return the maximum number of opponent cards sampled per zone for the
 * given difficulty tier. Lower tiers scan fewer cards — so an Easy AI
 * will miss more pieces and declare `imminent` less often. Hard/Expert
 * widen the window so they spot the Oracle / Kiki / Past in Flames that
 * was tucked two cards deep in the opponent's hand.
 *
 * Issue #1232 / acceptance criterion #2 ("Expert-tier AI in a simulation
 * fires disruption at a higher rate than Easy on identical opponent
 * sequences") — this depth gate is the mechanical reason for the rate
 * difference, and it is what the unit test in
 * `combo-threat-detector.test.ts` exercises.
 */
export function detectionDepthForTier(difficulty: DifficultyLevel): number {
  switch (difficulty) {
    case "expert":
      return 8;
    case "hard":
      return 6;
    case "medium":
      return 4;
    case "easy":
    default:
      return 2;
  }
}

/**
 * Clamp a {@link DifficultyLevel}-like value to the canonical set. Useful
 * for persisted configs that may carry stale aliases (#1064 collapse).
 */
function normalizeDifficulty(level: DifficultyLevel | string): DifficultyLevel {
  const key = String(level ?? "").toLowerCase();
  if ((DIFFICULTY_LEVELS as readonly string[]).includes(key)) {
    return key as DifficultyLevel;
  }
  // Legacy aliases collapse the same way ai-difficulty does; we mirror
  // that here so the detector cannot drift from the canonical taxonomy.
  const aliases: Record<string, DifficultyLevel> = {
    beginner: "easy",
    normal: "medium",
    master: "expert",
  };
  return aliases[key] ?? "medium";
}

/**
 * Normalize an opponent card name for substring matching.
 *
 * Whitespace is collapsed and case is lowered so that
 * `"Splinter   Twin"` and `"splinter twin"` both match
 * `"splinter twin"`. Card-instance IDs (which are usually opaque
 * Scryfall IDs) cannot meaningfully be pattern-matched and so fall
 * through to `null`. Callers should always pass names, not IDs, when
 * they want pattern coverage.
 */
function normalizeName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  // Avoid matching against opaque alphanumeric IDs — they will
  // produce noise matches against numeric patterns like "200".
  if (/^[a-z0-9_-]{20,}$/i.test(trimmed) && !/[a-z]/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Flatten an opponent's known cards into a deduplicated array of
 * normalised names. Sources are hand, battlefield, and the graveyard /
 * exile string arrays (we cannot pattern-match IDs, so those become
 * empties — but we still honour them structurally to keep the call
 * site uniform).
 *
 * The `detectionDepth` cap is applied after de-dup so an opponent who
 * keeps replaying the same piece doesn't inflate the count.
 */
function collectOpponentNames(
  gameState: AIGameState,
  aiPlayerId: string,
  detectionDepth: number,
): string[] {
  const opponent = Object.values(gameState.players).find(
    (p) => p.id !== aiPlayerId,
  );
  if (!opponent) return [];

  const hand = (opponent.hand ?? []) as AIHandCard[];
  const battlefield = (opponent.battlefield ?? []) as AIPermanent[];

  const cap = Math.max(1, detectionDepth);

  const fromHand = hand
    .slice(0, cap)
    .map((c) => normalizeName(c?.name ?? null))
    .filter((n): n is string => n != null);

  const fromBoard = battlefield
    .slice(0, cap)
    .map((p) => normalizeName(p?.name ?? null))
    .filter((n): n is string => n != null);

  // Dedup, preserving first-seen order so the report reads "the order the
  // pieces were shown to the AI".
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...fromHand, ...fromBoard]) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Best-effort count of the opponent's available mana across all colours.
 *
 * Used to gate the `imminent` tier — 2 pieces + no mana is still
 * `building`, not `imminent`. The exact mana cost differs by combo
 * family; {@link COMBO_IMMINENT_MANA} sets the threshold.
 */
function totalOpponentMana(gameState: AIGameState, aiPlayerId: string): number {
  const opponent = Object.values(gameState.players).find(
    (p) => p.id !== aiPlayerId,
  );
  if (!opponent?.manaPool) return 0;
  const pool = opponent.manaPool;
  let total = 0;
  for (const key of Object.keys(pool)) {
    const value = pool[key];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return Math.max(0, Math.floor(total));
}

/**
 * Compute a match score for a single combo family against the opponent's
 * observed names. Each unique name counts once — replaying the same
 * piece does not double-count.
 */
function scoreComboFamily(
  family: string,
  patterns: ReadonlyArray<string>,
  observedNames: ReadonlyArray<string>,
): { score: number; matched: string[] } {
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const name of observedNames) {
    for (const pattern of patterns) {
      if (name.includes(pattern)) {
        if (!seen.has(name)) {
          seen.add(name);
          matched.push(name);
        }
        break;
      }
    }
  }
  return { score: matched.length, matched };
}

/**
 * Heuristic "missing piece" labels for a given combo family. Used purely
 * to populate the report — the AI does not need to enumerate the
 * opponent's private hand, but listing the canonical payoffs helps the
 * downstream tuner / debugger understand *what kind* of combo the AI
 * is reacting to.
 */
const FAMILY_MISSING: Readonly<Record<string, string[]>> = {
  storm: ["storm finisher (e.g. tendrils)"],
  reanimator: ["reanimation spell"],
  infinite: ["combo payoff"],
  consultation: ["consultation payoff"],
};

/**
 * Detect whether the opponent is assembling a known combo.
 *
 * The function is exported in two forms:
 *
 *   - {@link detectComboAssembly} (`gameState, aiPlayerId, options`) —
 *     the live-game form that reads the AI's own AIGameState and
 *     applies the per-difficulty depth cap.
 *   - {@link detectComboFromNames} (`observedNames, opponentMana,
 *     detectionDepth`) — the pure function unit tests exercise.
 *
 * Both report the same {@link ComboThreatAssessment} shape so callers
 * don't need to special-case.
 */
export function detectComboAssembly(
  gameState: AIGameState,
  aiPlayerId: string,
  options: DetectComboOptions,
): ComboThreatAssessment {
  const difficulty = normalizeDifficulty(options.difficulty);
  const detectionDepth =
    options.detectionDepth ?? detectionDepthForTier(difficulty);
  const observedNames = collectOpponentNames(
    gameState,
    aiPlayerId,
    detectionDepth,
  );
  const mana = totalOpponentMana(gameState, aiPlayerId);
  return detectComboFromNames(observedNames, mana, detectionDepth);
}

/**
 * Pure helper: classify a list of observed opponent card names into a
 * {@link ComboThreatAssessment}. Exported for unit tests and for any
 * future caller that already has the names / mana in hand.
 *
 * The helper is forgiving about input casing — every observed name is
 * lowercased before pattern matching, so callers can pass raw card
 * names ("Thassa's Oracle") without pre-normalising. This mirrors the
 * live {@link detectComboAssembly} path which always normalises through
 * {@link normalizeName}.
 *
 * Algorithm
 * ---------
 *  1. Lowercase the observed names.
 *  2. Score each combo family against the observed names (each unique
 *     matched name counts once).
 *  3. Pick the highest-scoring family as the reported `archetype`.
 *  4. Escalate to `imminent` if the best family scored ≥ 2 AND the
 *     opponent has the mana to assemble on the next relevant turn
 *     (per {@link COMBO_IMMINENT_MANA}).
 *  5. Otherwise escalate to `building` if the best family scored ≥ 1.
 *  6. Otherwise return `none`.
 */
export function detectComboFromNames(
  observedNames: ReadonlyArray<string>,
  opponentMana: number,
  detectionDepth: number,
): ComboThreatAssessment {
  const normalised: string[] = [];
  for (const raw of observedNames) {
    const lower = (raw ?? "").toString().trim().toLowerCase();
    if (!lower) continue;
    normalised.push(lower);
  }

  let bestFamily: string | null = null;
  let bestScore = 0;
  // Track the union of every matched name across *all* families, so the
  // reported `piecesPresent` reflects "how many combo-relevant cards
  // have we seen?" — including when a canonical combo spans multiple
  // families (Thassa's Oracle lives in `infinite`; Demonic Consultation
  // lives in `consultation`).
  const allMatchedSet = new Set<string>();

  for (const family of Object.keys(COMBO_PATTERNS)) {
    const patterns = COMBO_PATTERNS[family] ?? [];
    const { score, matched } = scoreComboFamily(
      family,
      patterns,
      normalised,
    );
    if (score > bestScore) {
      bestScore = score;
      bestFamily = family;
    }
    for (const name of matched) allMatchedSet.add(name);
  }

  const piecesPresent = Math.min(allMatchedSet.size, 6);

  // No matches → no threat. Short-circuit before touching mana.
  if (piecesPresent === 0 || bestFamily == null) {
    return {
      threat: "none",
      archetype: null,
      piecesPresent: 0,
      matchedPieces: [],
      missingPieces: [],
      detectionDepth,
    };
  }

  // Escalation uses the *total* count of distinct combo-relevant cards
  // we've seen, because a known combo often spans families
  // (e.g. Thassa's Oracle + Demonic Consultation).
  const imminentThreshold = COMBO_IMMINENT_MANA[bestFamily] ?? 4;
  const manaReady = opponentMana >= imminentThreshold;

  // 2+ pieces + mana = the opponent can assemble next turn → push hard.
  // 2+ pieces but no mana = building (race, but the AI still has time).
  // 1 piece = building regardless of mana (insufficient signal for
  //   imminent, but the AI should still bias toward disruption).
  let threat: ComboThreatAssessment["threat"];
  if (piecesPresent >= 2 && manaReady) {
    threat = "imminent";
  } else {
    threat = "building";
  }

  const missingPieces =
    threat === "imminent"
      ? // When imminent we claim no critical piece is missing — the
        // opponent can finish.
        []
      : FAMILY_MISSING[bestFamily] ?? ["combo payoff"];

  // Stabilise the matched list: trim + cap so the replay event stays
  // scannable. The report uses the all-families union so callers can
  // see the full evidence set, not just the winning family.
  const matchedPieces = Array.from(allMatchedSet).slice(0, 6);

  return {
    threat,
    archetype: bestFamily,
    piecesPresent,
    matchedPieces,
    missingPieces,
    detectionDepth,
  };
}

/**
 * Convenience predicate: did the detector classify the opponent as
 * actively threatened to combo? Used by the
 * {@link CombatDecisionTree} to inject an "apply pressure or disrupt"
 * shift into the per-tier combat plan without coupling the tree to the
 * detector's full report.
 */
export function isImminentComboThreat(assessment: ComboThreatAssessment): boolean {
  return assessment.threat === "imminent";
}

/**
 * Convert a {@link ComboThreatAssessment} into a 0-1 urgency scalar the
 * {@link LookaheadEngine} adds to its aggression modifier.
 *
 *  - `none`     → 0   (no shift, baseline behaviour preserved).
 *  - `building` → 0.15 (small disruption lean — caller-side appetite to
 *                  fire a removal spell).
 *  - `imminent` → 0.4 (the engine should reward pressure of the
 *                  opponent and punish lines that tap out / develop
 *                  instead of disrupting).
 *
 * Hard-clamped so a future bug cannot blow the modifier past [-1, 1].
 */
export function comboThreatUrgency(
  assessment: ComboThreatAssessment,
): number {
  switch (assessment.threat) {
    case "imminent":
      return 0.4;
    case "building":
      return 0.15;
    case "none":
    default:
      return 0;
  }
}

/**
 * Resolve the AI's own deck archetype to the most relevant combo
 * family. Used only when callers already know the AI's deck is in the
 * combo family and want to push detection depth accordingly (issue
 * #1232 acceptance criterion #3 says "Expert-tier AI fires
 * disruption at a higher rate than Easy", so a combo-deck AI should
 * also use Expert depth even on Easy tier).
 *
 * Currently a thin pass-through — wired so adding heavier logic later
 * does not require touching callers.
 */
export function comboDetectionDepthForArchetype(
  base: DifficultyLevel,
  archetype: DeckArchetype | undefined,
): number {
  const baseDepth = detectionDepthForTier(base);
  if (archetype === "combo") {
    // Combo-deck AIs are paranoid about OTHER combo decks (mirror
    // match): widen the depth one tier.
    if (baseDepth < 8) return baseDepth + 2;
  }
  return baseDepth;
}
