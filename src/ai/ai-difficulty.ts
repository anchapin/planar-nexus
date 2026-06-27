/**
 * AI Difficulty Tuning System
 *
 * Provides configurable difficulty levels for AI opponents.
 * Controls randomness, lookahead depth, and evaluation accuracy.
 *
 * Issue #252: Phase 3.1 - Implement AI difficulty tuning system
 */

import { EvaluationWeights, DefaultWeights } from "./game-state-evaluator";

/**
 * The canonical difficulty taxonomy — the single source of truth for AI
 * difficulty tiers across the whole codebase (issue #1064).
 *
 * Both the combat/evaluator config in this module AND the advisory adaptive
 * service in `src/lib/adaptive-difficulty.ts` reference this one union, so the
 * two can never drift again. The companion {@link DIFFICULTY_LEVELS} array is
 * the runtime source the type is derived from; the {@link DIFFICULTY_CONFIGS}
 * map below (`Record<DifficultyLevel, …>`) doubles as a compile-time
 * exhaustiveness guard — adding or removing a tier here fails the build until
 * every keyed site is updated.
 *
 * Note: `DifficultyTier` in `src/ai/game-state-evaluator.ts` is the same
 * four-value set used to key the evaluator's static weights; it is kept as a
 * distinct type because it names a different concern (weight-owner vs.
 * UI-level), and `toDifficultyTier` in `src/ai/weight-learning.ts` is the
 * documented bridge between the two.
 */
export const DIFFICULTY_LEVELS = ["easy", "medium", "hard", "expert"] as const;

/**
 * Difficulty levels available in the game (canonical, issue #1064).
 */
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/**
 * Legacy / archival difficulty names that older persisted data may still carry,
 * mapped onto the canonical {@link DifficultyLevel} set. This mirrors the
 * `TIER_ALIAS` collapse already performed by `toDifficultyTier` in
 * `src/ai/weight-learning.ts` so there is exactly one normalization rule in
 * effect (issue #1064).
 *
 * - `beginner` → `easy`
 * - `normal`   → `medium`
 * - `master`   → `expert`
 */
export const LEGACY_DIFFICULTY_ALIASES: Readonly<
  Record<string, DifficultyLevel>
> = {
  beginner: "easy",
  normal: "medium",
  master: "expert",
};

/**
 * Normalize any UI / archival difficulty string onto the canonical
 * {@link DifficultyLevel} set.
 *
 * Canonical values pass through unchanged. Known legacy names (see
 * {@link LEGACY_DIFFICULTY_ALIASES}) are mapped to their canonical equivalent.
 * Anything unrecognised (including `null`/`undefined`/`""`) falls back to
 * `medium` — the evaluator's own default — so callers reading free-form
 * persisted data (e.g. `GameRecord.difficulty`) never throw and never silently
 * invent a non-existent tier (issue #1064).
 */
export function normalizeDifficultyLevel(
  level: string | null | undefined,
): DifficultyLevel {
  const key = String(level ?? "").toLowerCase();
  if ((DIFFICULTY_LEVELS as readonly string[]).includes(key)) {
    return key as DifficultyLevel;
  }
  return LEGACY_DIFFICULTY_ALIASES[key] ?? "medium";
}

/**
 * Format families the AI difficulty system tunes for.
 *
 * The detailed game-mode {@link Format} (from `@/lib/game-rules`) is a union of
 * many variant IDs ("legendary-commander", "constructed-core", ...). For
 * difficulty calibration those collapse into three families whose pacing, life
 * totals and win conditions differ enough to warrant distinct tuning:
 *
 * - `commander`   — 100-card singleton, 40 life, multiplayer, 21 commander damage
 * - `constructed` — 60-card tuned/competitive, 20 life
 * - `limited`     — 40-card draft/sealed, lower power, creature-combat driven
 *
 * Issue #1069: per-format difficulty config overrides.
 */
export type DifficultyFormat = "commander" | "constructed" | "limited";

/**
 * Configuration for AI difficulty
 */
export interface AIDifficultyConfig {
  /** Difficulty level identifier */
  level: DifficultyLevel;
  /** Display name */
  displayName: string;
  /** Description of this difficulty */
  description: string;
  /** Randomness factor: 0 = perfect play, 1 = completely random */
  randomnessFactor: number;
  /** How many turns to look ahead in decision making */
  lookaheadDepth: number;
  /** Evaluation weights for game state assessment */
  evaluationWeights: EvaluationWeights;
  /** Whether to consider future states */
  useLookahead: boolean;
  /** Blunder chance: probability of making suboptimal moves */
  blunderChance: number;
  /** Tempo consideration: how much AI prioritizes immediate vs long-term advantage */
  tempoPriority: number;
  /** Risk tolerance: higher = more willing to take risks */
  riskTolerance: number;
  /**
   * Beginner-friendly "telegraph" verbosity (issue #993):
   *   - 0 = none   — no AI reasoning surfaced (expert / challenge play)
   *   - 1 = basic  — action-only one-liners ("AI attacks with Grizzly Bears")
   *   - 2 = detailed — beginner coaching that explains the *why* ("AI holds
   *                   Grizzly Bears back as a blocker to stay safe")
   *
   * Easy defaults to 2 (learn the game), expert to 0 (don't hand-hold). Like
   * the other knobs it is resolved through {@link resolveDifficultyConfig} so
   * the per-format overrides can tune it, and it lives on this config so the
   * single canonical difficulty taxonomy (issue #1064/#1192) stays the one
   * source of truth.
   */
  telegraphLevel: number;
}

/**
 * A partial difficulty config used as a per-format override delta.
 *
 * Only the knobs that differ from the base {@link DIFFICULTY_CONFIGS} entry need
 * to be supplied. `evaluationWeights` is itself partial, so individual weights
 * can be tuned without duplicating the whole weights object — the resolver
 * deep-merges it over the base weights (issue #1069).
 */
export interface AIDifficultyConfigOverride {
  randomnessFactor?: number;
  lookaheadDepth?: number;
  useLookahead?: boolean;
  blunderChance?: number;
  tempoPriority?: number;
  riskTolerance?: number;
  /** Beginner-friendly telegraph verbosity override (0/1/2), see AIDifficultyConfig. */
  telegraphLevel?: number;
  evaluationWeights?: Partial<EvaluationWeights>;
}

/**
 * Complete difficulty configurations
 *
 * Each difficulty level is tuned to provide a distinct challenge level:
 * - Easy: Beginner-friendly, makes obvious mistakes, prioritizes survival
 * - Medium: Balanced opponent, reasonable plays with occasional errors
 * - Hard: Challenging for experienced players, values advantage and tempo
 * - Expert: Near-optimal play, punishes mistakes, deep strategic thinking
 *
 * Target win rates (player vs AI):
 * - Easy: ~80% player win rate
 * - Medium: ~60% player win rate
 * - Hard: ~40% player win rate
 * - Expert: ~25% player win rate
 */
export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, AIDifficultyConfig> = {
  easy: {
    level: "easy",
    displayName: "Easy",
    description:
      "Makes frequent mistakes and random plays. Perfect for learning the game.",
    randomnessFactor: 0.4,
    lookaheadDepth: 1,
    evaluationWeights: {
      // Easy AI prioritizes survival over strategic advantage
      // Low weights mean it ignores long-term planning
      lifeScore: 1.5, // High: strongly values staying alive
      poisonScore: 3.0, // Low: doesn't understand poison threat well
      cardAdvantage: 0.3, // Low: ignores card advantage
      handQuality: 0.2, // Low: doesn't evaluate hand quality
      libraryDepth: 0.1, // Low: ignores mill risk
      creaturePower: 0.5, // Low: undervalues attacking power
      creatureToughness: 0.3, // Low: ignores creature survivability
      creatureCount: 0.3, // Low: doesn't value board presence
      permanentAdvantage: 0.3, // Low: ignores permanent advantage
      manaAvailable: 0.2, // Low: inefficient mana usage
      tempoAdvantage: 0.2, // Low: doesn't understand tempo
      commanderDamageWeight: 1.0, // Low: ignores commander damage
      commanderPresence: 0.3, // Low: undervalues commander
      cardSelection: 0.2, // Low: poor card evaluation
      graveyardValue: 0.1, // Low: ignores graveyard resources
      synergy: 0.1, // Low: doesn't recognize synergies
      winConditionProgress: 0.5, // Low: slow to close games
      inevitability: 0.3, // Low: doesn't plan for long game
      stackPressureScore: 0.1, // Low: ignores stack dynamics
      castedSequenceScore: 0.1, // Low: ignores mana sequencing
      tempoSwingScore: 0.1, // Low: ignores tempo swings
    },
    useLookahead: false,
    blunderChance: 0.25,
    tempoPriority: 0.3,
    riskTolerance: 0.2,
    telegraphLevel: 2, // Beginner coaching: explain the "why" of every decision
  },
  medium: {
    level: "medium",
    displayName: "Medium",
    description:
      "Balanced opponent. Makes reasonable plays but can be outsmarted.",
    randomnessFactor: 0.2,
    lookaheadDepth: 2,
    evaluationWeights: {
      // Medium AI has balanced evaluation - understands basics but not advanced strategy
      lifeScore: 1.0, // Moderate: values life but not obsessed
      poisonScore: 6.0, // Moderate: respects poison threat
      cardAdvantage: 0.8, // Moderate: understands card advantage basics
      handQuality: 0.5, // Moderate: evaluates hand somewhat
      libraryDepth: 0.2, // Low-moderate: aware of mill risk
      creaturePower: 1.0, // Moderate: values attacking power
      creatureToughness: 0.8, // Moderate: considers creature survivability
      creatureCount: 0.8, // Moderate: values board presence
      permanentAdvantage: 1.0, // Moderate: understands permanent advantage
      manaAvailable: 0.6, // Moderate: decent mana efficiency
      tempoAdvantage: 0.5, // Moderate: understands tempo basics
      commanderDamageWeight: 2.5, // Moderate: respects commander damage
      commanderPresence: 0.8, // Moderate: values commander
      cardSelection: 0.6, // Moderate: decent card evaluation
      graveyardValue: 0.4, // Low-moderate: some graveyard awareness
      synergy: 0.3, // Low: basic synergy recognition
      winConditionProgress: 1.5, // Moderate: pushes win conditions
      inevitability: 0.8, // Moderate: plans ahead somewhat
      stackPressureScore: 0.5, // Moderate: basic stack awareness
      castedSequenceScore: 0.3, // Moderate: basic sequencing
      tempoSwingScore: 0.3, // Moderate: basic tempo swing awareness
    },
    useLookahead: true,
    blunderChance: 0.1,
    tempoPriority: 0.5,
    riskTolerance: 0.5,
    telegraphLevel: 1, // Basic action-only telegraph for the middle tier
  },
  hard: {
    level: "hard",
    displayName: "Hard",
    description: "Skilled opponent. Makes few mistakes and punishes errors.",
    randomnessFactor: 0.1,
    lookaheadDepth: 3,
    evaluationWeights: {
      // Hard AI values strategic advantage and tempo - challenging for experienced players
      lifeScore: 0.8, // Lower: willing to trade life for advantage
      poisonScore: 9.0, // High: very respectful of poison
      cardAdvantage: 1.5, // High: strongly values card advantage
      handQuality: 0.9, // High: good hand evaluation
      libraryDepth: 0.4, // Moderate: manages library carefully
      creaturePower: 1.5, // High: values aggressive positioning
      creatureToughness: 1.2, // High: considers creature trades carefully
      creatureCount: 1.2, // High: values board control
      permanentAdvantage: 1.8, // High: fights for permanent advantage
      manaAvailable: 1.0, // High: efficient mana usage
      tempoAdvantage: 1.0, // High: understands tempo importance
      commanderDamageWeight: 4.0, // High: uses commander damage strategically
      commanderPresence: 1.5, // High: leverages commander well
      cardSelection: 1.0, // High: excellent card evaluation
      graveyardValue: 0.7, // Moderate-high: utilizes graveyard
      synergy: 0.7, // Moderate-high: recognizes synergies
      winConditionProgress: 2.5, // High: aggressively pursues wins
      inevitability: 1.5, // High: plans for long game
      stackPressureScore: 1.0, // High: exploits stack windows
      castedSequenceScore: 0.6, // High: optimizes sequencing
      tempoSwingScore: 0.6, // High: anticipates tempo swings
    },
    useLookahead: true,
    blunderChance: 0.05,
    tempoPriority: 0.7,
    riskTolerance: 0.7,
    telegraphLevel: 1, // Basic telegraph — experienced players still get the gist
  },
  expert: {
    level: "expert",
    displayName: "Expert",
    description:
      "Near-perfect play. Deep lookahead and optimal decision-making.",
    randomnessFactor: 0.05,
    lookaheadDepth: 4,
    evaluationWeights: {
      // Expert AI has near-optimal weight distribution - minimal weaknesses
      lifeScore: 0.6, // Optimized: trades life efficiently for value
      poisonScore: 12.0, // Maximum: understands poison is lethal
      cardAdvantage: 2.0, // Maximum: card advantage is king
      handQuality: 1.5, // High: excellent hand assessment
      libraryDepth: 0.8, // High: manages deck resources optimally
      creaturePower: 2.0, // High: maximizes combat advantage
      creatureToughness: 1.5, // High: optimal creature trading
      creatureCount: 2.0, // High: dominates board states
      permanentAdvantage: 2.5, // Maximum: controls battlefield
      manaAvailable: 1.5, // High: perfect mana efficiency
      tempoAdvantage: 1.2, // High: tempo-focused play
      commanderDamageWeight: 5.0, // Maximum: lethal commander math
      commanderPresence: 2.0, // High: commander-centric strategy
      cardSelection: 1.5, // High: best card choices
      graveyardValue: 1.0, // High: full graveyard utilization
      synergy: 1.0, // High: maximizes card synergies
      winConditionProgress: 4.0, // Maximum: closes games efficiently
      inevitability: 2.5, // Maximum: unbeatable in long games
      stackPressureScore: 2.0, // Maximum: master of stack manipulation
      castedSequenceScore: 1.0, // Maximum: perfect mana sequencing
      tempoSwingScore: 1.0, // Maximum: perfectly predicts tempo swings
    },
    useLookahead: true,
    blunderChance: 0.02,
    tempoPriority: 0.9,
    riskTolerance: 0.85,
    telegraphLevel: 0, // No hand-holding at the top tier — keep strategy hidden
  },
};

/**
 * Per-format difficulty override deltas (issue #1069).
 *
 * Each entry is a sparse map of `{ tier -> override delta }`. Only the knobs
 * that meaningfully differ from the base {@link DIFFICULTY_CONFIGS} are listed;
 * {@link resolveDifficultyConfig} deep-merges a delta over the base config, with
 * the format delta winning wherever it is present. Tiers without an explicit
 * delta fall back to the base config unchanged.
 *
 * Tuning rationale per format family:
 *
 * - commander — 100-card singleton, 40 starting life, multiplayer, 21 commander
 *   damage. Life is plentiful so `lifeScore` is relaxed, but the commander is a
 *   permanent, always-available threat → `commanderDamageWeight` and
 *   `commanderPresence` are raised substantially. Games are long and
 *   synergy/graveyard-driven, so `synergy`, `graveyardValue` and `inevitability`
 *   rise while `tempoAdvantage`/`tempoPriority` relax.
 *
 * - constructed — 60-card tuned/competitive, 20 life. This is the competitive
 *   reference the base config was calibrated against, so deltas are deliberately
 *   small: a mild lift to the interaction/tempo weights (`cardAdvantage`,
 *   `tempoAdvantage`, `stackPressureScore`) and a mild relaxation of `lifeScore`
 *   reflecting tight competitive life-as-resource play.
 *
 * - limited — 40-card draft/sealed, lower power, creature-combat driven. Creatures
 *   and curve decide games → `creaturePower`/`creatureCount`/`creatureToughness`,
 *   `manaAvailable`, `tempoAdvantage` and `castedSequenceScore` rise, while the
 *   commander-specific weights (irrelevant here) and `synergy`/`libraryDepth`
 *   drop. `tempoPriority` rises because curving out is decisive.
 */
export const FORMAT_DIFFICULTY_OVERRIDES: Record<
  DifficultyFormat,
  Partial<Record<DifficultyLevel, AIDifficultyConfigOverride>>
> = {
  commander: {
    easy: {
      tempoPriority: 0.2,
      evaluationWeights: {
        lifeScore: 0.9,
        tempoAdvantage: 0.1,
        commanderDamageWeight: 2.0,
        commanderPresence: 0.6,
        synergy: 0.3,
        graveyardValue: 0.3,
        inevitability: 0.6,
      },
    },
    medium: {
      tempoPriority: 0.4,
      evaluationWeights: {
        lifeScore: 0.6,
        tempoAdvantage: 0.3,
        commanderDamageWeight: 4.5,
        commanderPresence: 1.4,
        synergy: 0.6,
        graveyardValue: 0.7,
        inevitability: 1.3,
      },
    },
    hard: {
      tempoPriority: 0.55,
      evaluationWeights: {
        lifeScore: 0.5,
        tempoAdvantage: 0.6,
        commanderDamageWeight: 6.5,
        commanderPresence: 2.2,
        synergy: 1.1,
        graveyardValue: 1.1,
        inevitability: 2.2,
      },
    },
    expert: {
      tempoPriority: 0.7,
      evaluationWeights: {
        lifeScore: 0.4,
        tempoAdvantage: 0.7,
        commanderDamageWeight: 8.0,
        commanderPresence: 2.8,
        synergy: 1.5,
        graveyardValue: 1.5,
        inevitability: 3.5,
      },
    },
  },
  constructed: {
    easy: {
      evaluationWeights: {
        lifeScore: 1.2,
        cardAdvantage: 0.4,
        tempoAdvantage: 0.3,
        stackPressureScore: 0.2,
      },
    },
    medium: {
      evaluationWeights: {
        lifeScore: 0.8,
        cardAdvantage: 1.0,
        tempoAdvantage: 0.6,
        stackPressureScore: 0.7,
      },
    },
    hard: {
      evaluationWeights: {
        lifeScore: 0.6,
        cardAdvantage: 1.8,
        tempoAdvantage: 1.2,
        stackPressureScore: 1.3,
      },
    },
    expert: {
      evaluationWeights: {
        lifeScore: 0.5,
        cardAdvantage: 2.4,
        tempoAdvantage: 1.4,
        stackPressureScore: 2.4,
      },
    },
  },
  limited: {
    easy: {
      tempoPriority: 0.4,
      evaluationWeights: {
        creaturePower: 0.8,
        creatureToughness: 0.5,
        creatureCount: 0.5,
        manaAvailable: 0.4,
        tempoAdvantage: 0.4,
        castedSequenceScore: 0.3,
        commanderDamageWeight: 0.2,
        commanderPresence: 0.05,
        synergy: 0.05,
        libraryDepth: 0.05,
      },
    },
    medium: {
      tempoPriority: 0.6,
      evaluationWeights: {
        creaturePower: 1.4,
        creatureToughness: 1.1,
        creatureCount: 1.1,
        manaAvailable: 0.9,
        tempoAdvantage: 0.8,
        castedSequenceScore: 0.7,
        commanderDamageWeight: 0.3,
        commanderPresence: 0.1,
        synergy: 0.2,
        libraryDepth: 0.1,
      },
    },
    hard: {
      tempoPriority: 0.8,
      evaluationWeights: {
        creaturePower: 2.0,
        creatureToughness: 1.6,
        creatureCount: 1.6,
        manaAvailable: 1.3,
        tempoAdvantage: 1.3,
        castedSequenceScore: 1.0,
        commanderDamageWeight: 0.4,
        commanderPresence: 0.15,
        synergy: 0.4,
        libraryDepth: 0.2,
      },
    },
    expert: {
      tempoPriority: 0.95,
      evaluationWeights: {
        creaturePower: 2.6,
        creatureToughness: 2.0,
        creatureCount: 2.6,
        manaAvailable: 1.8,
        tempoAdvantage: 1.6,
        castedSequenceScore: 1.4,
        commanderDamageWeight: 0.5,
        commanderPresence: 0.2,
        synergy: 0.6,
        libraryDepth: 0.3,
      },
    },
  },
};

/**
 * Deep-merge a format override delta onto a base difficulty config.
 *
 * Scalar knobs are taken from the override when present, otherwise the base.
 * `evaluationWeights` is merged key-by-key so a delta only needs to name the
 * weights it changes (format wins; base fills the rest). The returned object is
 * always a fresh copy — the inputs are never mutated.
 */
export function mergeDifficultyConfig(
  base: AIDifficultyConfig,
  override: AIDifficultyConfigOverride,
): AIDifficultyConfig {
  return {
    ...base,
    ...override,
    // Re-state scalar-only fields so the override type (which omits level /
    // displayName / description / evaluationWeights) cannot clobber the identity
    // fields on the base config.
    level: base.level,
    displayName: base.displayName,
    description: base.description,
    evaluationWeights: {
      ...base.evaluationWeights,
      ...(override.evaluationWeights ?? {}),
    },
  } as AIDifficultyConfig;
}

/**
 * Resolve the effective difficulty config for a (level, format) pair.
 *
 * Resolution is "format override merged over base, format wins". When `format`
 * is omitted, unknown, or has no override delta for the given tier, the base
 * {@link DIFFICULTY_CONFIGS} entry is returned unchanged — keeping the call
 * fully backward compatible for existing callers (issue #1069).
 */
export function resolveDifficultyConfig(
  level: DifficultyLevel,
  format?: DifficultyFormat,
): AIDifficultyConfig {
  const base = DIFFICULTY_CONFIGS[level];
  if (!format) return base;
  const override = FORMAT_DIFFICULTY_OVERRIDES[format]?.[level];
  if (!override) return base;
  return mergeDifficultyConfig(base, override);
}

/**
 * Classify a game format/mode identifier into a difficulty format family.
 *
 * Accepts both detailed game-mode IDs ("legendary-commander",
 * "constructed-core", ...) and legacy aliases ("commander", "modern", ...).
 * Returns `undefined` for anything that cannot be mapped to a family, in which
 * case {@link resolveDifficultyConfig} falls back to the base config.
 */
export function classifyDifficultyFormat(
  format?: string | null,
): DifficultyFormat | undefined {
  if (!format) return undefined;
  const f = format.toLowerCase();
  if (f.includes("commander")) return "commander";
  if (f.includes("limited") || f.includes("sealed") || f.includes("draft"))
    return "limited";
  if (f.includes("constructed")) return "constructed";
  // Legacy constructed family aliases (see FORMAT_NAME_MAPPINGS in game-rules).
  if (
    f === "modern" ||
    f === "standard" ||
    f === "legacy" ||
    f === "vintage" ||
    f === "pioneer" ||
    f === "pauper"
  ) {
    return "constructed";
  }
  return undefined;
}

/**
 * Manages AI difficulty settings throughout the game
 */
export class AIDifficultyManager {
  private currentDifficulty: AIDifficultyConfig;
  private currentFormat?: DifficultyFormat;
  private playerSelectedDifficulty: Map<string, DifficultyLevel> = new Map();

  constructor(
    difficulty: DifficultyLevel = "medium",
    format?: DifficultyFormat,
  ) {
    this.currentDifficulty = DIFFICULTY_CONFIGS[difficulty];
    this.currentFormat = format;
  }

  /**
   * Set difficulty level for a specific AI opponent
   */
  setDifficulty(difficulty: DifficultyLevel, playerId?: string): void {
    if (playerId) {
      this.playerSelectedDifficulty.set(playerId, difficulty);
    } else {
      this.currentDifficulty = DIFFICULTY_CONFIGS[difficulty];
    }
  }

  /**
   * Set the active format family so difficulty resolution applies the
   * per-format overrides (issue #1069). Pass `undefined` to clear overrides and
   * revert to base behavior.
   */
  setFormat(format?: DifficultyFormat): void {
    this.currentFormat = format;
  }

  /**
   * Get the active format family, if any.
   */
  getFormat(): DifficultyFormat | undefined {
    return this.currentFormat;
  }

  /**
   * Get difficulty for a specific AI opponent. The per-format overrides for the
   * active {@link currentFormat} are applied (format is game-wide, so it affects
   * per-player difficulty too).
   */
  getDifficulty(playerId?: string): AIDifficultyConfig {
    if (playerId && this.playerSelectedDifficulty.has(playerId)) {
      return resolveDifficultyConfig(
        this.playerSelectedDifficulty.get(playerId)!,
        this.currentFormat,
      );
    }
    return resolveDifficultyConfig(
      this.currentDifficulty.level,
      this.currentFormat,
    );
  }

  /**
   * Get current difficulty level
   */
  getLevel(): DifficultyLevel {
    return this.currentDifficulty.level;
  }

  /**
   * Apply randomness to a decision (lower difficulty = more random)
   */
  applyRandomness<T>(options: T[], playerId?: string): T {
    const difficulty = this.getDifficulty(playerId);
    const randomFactor = difficulty.randomnessFactor;

    // Sometimes make a random choice based on difficulty
    if (Math.random() < randomFactor) {
      return options[Math.floor(Math.random() * options.length)];
    }

    // Otherwise return first option (will be evaluated properly)
    return options[0];
  }

  /**
   * Determine if AI should make a "blunder" (mistake)
   */
  shouldBlunder(playerId?: string): boolean {
    const difficulty = this.getDifficulty(playerId);
    return Math.random() < difficulty.blunderChance;
  }

  /**
   * Get lookahead depth for decision making
   */
  getLookaheadDepth(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.lookaheadDepth;
  }

  /**
   * Check if lookahead should be used
   */
  shouldUseLookahead(playerId?: string): boolean {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.useLookahead;
  }

  /**
   * Get evaluation weights for game state assessment
   */
  getEvaluationWeights(playerId?: string): EvaluationWeights {
    const difficulty = this.getDifficulty(playerId);
    return { ...difficulty.evaluationWeights };
  }

  /**
   * Get tempo priority for decisions
   */
  getTempoPriority(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.tempoPriority;
  }

  /**
   * Get risk tolerance for decisions
   */
  getRiskTolerance(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.riskTolerance;
  }

  /**
   * Get all available difficulty levels
   */
  getAvailableDifficulties(): AIDifficultyConfig[] {
    return Object.values(DIFFICULTY_CONFIGS);
  }

  /**
   * Create a modified difficulty config with custom parameters
   */
  createCustomDifficulty(
    baseLevel: DifficultyLevel,
    overrides: Partial<AIDifficultyConfig>,
  ): AIDifficultyConfig {
    const base = DIFFICULTY_CONFIGS[baseLevel];
    return {
      ...base,
      ...overrides,
      level: "medium" as DifficultyLevel, // Default to medium for custom
      displayName: overrides.displayName || `Custom (${base.displayName})`,
    };
  }
}

// Global instance for game-wide AI difficulty management
export const aiDifficultyManager = new AIDifficultyManager();

/**
 * Utility function to get difficulty config by level.
 *
 * When `format` is supplied, the per-format override delta is merged over the
 * base config for that tier (format wins). Omitting `format` — or passing one
 * with no override for the tier — returns the base config unchanged, preserving
 * backward compatibility for existing callers (issue #1069).
 */
export function getDifficultyConfig(
  level: DifficultyLevel,
  format?: DifficultyFormat,
): AIDifficultyConfig {
  return resolveDifficultyConfig(level, format);
}

/**
 * Validate a difficulty level string against the canonical
 * {@link DifficultyLevel} set (issue #1064).
 *
 * Returns `true` only for the four canonical tiers. Legacy archival names
 * (`beginner`/`normal`/`master`) are intentionally *not* considered valid
 * canonical levels — feed them through {@link normalizeDifficultyLevel} first.
 */
export function isValidDifficulty(level: string): level is DifficultyLevel {
  return (DIFFICULTY_LEVELS as readonly string[]).includes(level);
}
