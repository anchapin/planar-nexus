/**
 * @fileOverview Heuristic-powered post-game analysis system.
 *
 * Issue #446: Remove AI provider dependencies
 * Issue #565: Enforce strict typing in AI flows and state transitions
 * Issue #1235: Cross-game replay diffing (surface repeated-loss matchup
 *             patterns and turn-of-death trends so the player sees
 *             "you keep losing to X at turn Y" instead of just the AI
 *             silently retuning weights).
 * Replaced Genkit-based AI flows with heuristic algorithms.
 *
 * Provides:
 * - analyzeGame - Analyzes a completed game and provides improvement suggestions
 * - identifyKeyMoments - Identifies key turning points in the game
 * - generateImprovementTips - Provides actionable improvement advice
 * - diffReplayHistory - Aggregates many replays into a cross-game
 *   {@link ReplayDiffReport} keyed by opponent archetype. Used by the
 *   play-history surface and consumed by {@link WeightLearner} to scale
 *   its nudges when an outcomeTrend is `worsening`.
 */

// Types for game replay data (used for type documentation)
// These interfaces describe the expected structure of replay data

import type { TurnData, GameReplay, CardSuggestion, GameAnalysisTurn } from '@/ai/types';

// Input schema for game analysis
interface GameAnalysisInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for game analysis
export interface GameAnalysisOutput {
  gameSummary: string;
  keyMoments: Array<{
    turn: number;
    description: string;
    impact: 'positive' | 'negative' | 'neutral';
    alternativeAction?: string;
  }>;
  mistakes: Array<{
    turn: number;
    description: string;
    severity: 'major' | 'minor';
    suggestion: string;
  }>;
  strengths: string[];
  improvementAreas: string[];
  deckSuggestions: Array<{
    card: string;
    reason: string;
  }>;
  overallRating: number;
  tips: string[];
}

// Input schema for key moments identification
interface KeyMomentsInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for key moments
interface KeyMomentsOutput {
  moments: Array<{
    turn: number;
    description: string;
    type: 'game_change' | 'mistake' | 'great_play' | 'missed_opportunity';
    whatHappened: string;
    couldHaveHappened?: string;
  }>;
  summary: string;
}

// Input schema for quick tips
interface QuickTipsInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for quick tips
interface QuickTipsOutput {
  tips: string[];
  focusAreas: string[];
}

/**
 * Type guard to check if a value is a valid GameAnalysisTurn
 */
function isGameAnalysisTurn(turn: unknown): turn is GameAnalysisTurn {
  return (
    typeof turn === 'object' &&
    turn !== null &&
    'turnNumber' in turn &&
    typeof (turn as Record<string, unknown>).turnNumber === 'number'
  );
}

/**
 * Type guard to check if a value is a valid GameReplay
 */
function isGameReplay(replay: unknown): replay is GameReplay {
  return (
    typeof replay === 'object' &&
    replay !== null &&
    'turns' in replay &&
    Array.isArray((replay as Record<string, unknown>).turns)
  );
}

/**
 * Safely extract player life from replay
 */
function getPlayerLife(replay: GameReplay, playerName: string): number {
  const playerLife = replay.playerLife;
  return typeof playerLife === 'number' ? playerLife : 20;
}

/**
 * Safely extract opponent life from replay
 */
function getOpponentLife(replay: GameReplay): number {
  const opponentLife = replay.opponentLife;
  return typeof opponentLife === 'number' ? opponentLife : 20;
}

/**
 * Safely extract turns from replay
 */
function getTurns(replay: GameReplay): GameAnalysisTurn[] {
  const turns = replay.turns;
  if (!Array.isArray(turns)) return [];
  return turns.filter(isGameAnalysisTurn);
}

/**
 * Analyzes a completed game and provides comprehensive feedback.
 */
export async function analyzeGame(
  input: GameAnalysisInput
): Promise<GameAnalysisOutput> {
  const result = analyzeGameHeuristic(input);
  return result;
}

/**
 * Identifies key moments in a game that determined the outcome.
 */
export async function identifyKeyMoments(
  input: KeyMomentsInput
): Promise<KeyMomentsOutput> {
  const result = identifyKeyMomentsHeuristic(input);
  return result;
}

/**
 * Generates quick actionable tips from a game.
 */
export async function generateQuickTips(
  input: QuickTipsInput
): Promise<QuickTipsOutput> {
  const result = generateQuickTipsHeuristic(input);
  return result;
}

// Helper functions

function analyzeGameHeuristic(input: GameAnalysisInput): GameAnalysisOutput {
  const { replay, playerName } = input;

  // Analyze replay data (simplified heuristic analysis)
  const gameSummary = generateGameSummary(replay, playerName);
  const keyMoments = identifyKeyMomentsInReplay(replay, playerName);
  const mistakes = identifyMistakes(replay, playerName);
  const strengths = identifyStrengths(replay, playerName);
  const improvementAreas = identifyImprovementAreas(replay, playerName);
  const deckSuggestions = generateDeckSuggestions(replay, playerName);
  const overallRating = calculateOverallRating(replay, playerName);
  const tips = generateTips(replay, playerName);

  return {
    gameSummary,
    keyMoments,
    mistakes,
    strengths,
    improvementAreas,
    deckSuggestions,
    overallRating,
    tips,
  };
}

function identifyKeyMomentsHeuristic(input: KeyMomentsInput): KeyMomentsOutput {
  const { replay, playerName } = input;

  const moments: KeyMomentsOutput['moments'] = identifyKeyMomentsInReplay(replay, playerName).map(moment => ({
    turn: moment.turn,
    description: moment.description,
    type: moment.impact === 'positive' ? 'great_play' :
           moment.impact === 'negative' ? 'mistake' : 'missed_opportunity',
    whatHappened: moment.description,
    couldHaveHappened: moment.alternativeAction,
  }));

  const summary = `Identified ${moments.length} key moments in the game.`;

  return {
    moments,
    summary,
  };
}

function generateQuickTipsHeuristic(input: QuickTipsInput): QuickTipsOutput {
  const { replay, playerName } = input;

  const tips = generateTips(replay, playerName);
  const focusAreas = identifyImprovementAreas(replay, playerName);

  return {
    tips,
    focusAreas,
  };
}

function generateGameSummary(replay: GameReplay, playerName: string): string {
  // Simplified game summary generation
  const turns = getTurns(replay);
  const totalTurns = turns.length;

  const playerLife = getPlayerLife(replay, playerName);
  const opponentLife = getOpponentLife(replay);

  let summary = `Game lasted ${totalTurns} turns. `;

  if (playerLife > opponentLife) {
    summary += `${playerName} won with ${playerLife} life vs opponent's ${opponentLife} life. `;
    summary += "Strong board presence and card advantage contributed to victory.";
  } else if (playerLife < opponentLife) {
    summary += `${playerName} lost with ${playerLife} life vs opponent's ${opponentLife} life. `;
    summary += "Opponent gained advantage through tempo and pressure.";
  } else {
    summary += "Game ended in a draw.";
  }

  return summary;
}

function identifyKeyMomentsInReplay(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['keyMoments'] {
  const moments: GameAnalysisOutput['keyMoments'] = [];
  const turns = getTurns(replay);

  turns.forEach((turn, index) => {
    // Look for significant life changes
    if (turn.lifeChanges) {
      const playerLifeChange = turn.lifeChanges[playerName];
      if (typeof playerLifeChange === 'number' && Math.abs(playerLifeChange) >= 5) {
        moments.push({
          turn: index + 1,
          description: `Significant life change: ${playerLifeChange > 0 ? '+' : ''}${playerLifeChange}`,
          impact: playerLifeChange > 0 ? 'positive' : 'negative',
          alternativeAction: "Consider preventative measures in similar situations",
        });
      }
    }

    // Look for card advantage shifts
    if (turn.cardAdvantage) {
      const playerCardAdvantage = turn.cardAdvantage[playerName];
      if (typeof playerCardAdvantage === 'number' && Math.abs(playerCardAdvantage) >= 2) {
        moments.push({
          turn: index + 1,
          description: `Card advantage shift: ${playerCardAdvantage > 0 ? '+' : ''}${playerCardAdvantage}`,
          impact: playerCardAdvantage > 0 ? 'positive' : 'negative',
          alternativeAction: "Focus on card draw and selection",
        });
      }
    }
  });

  // Limit to top 5 moments
  return moments.slice(0, 5);
}

function identifyMistakes(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['mistakes'] {
  const mistakes: GameAnalysisOutput['mistakes'] = [];
  const turns = getTurns(replay);

  turns.forEach((turn, index) => {
    // Identify missed opportunities
    if (turn.missedOpportunities && turn.missedOpportunities[playerName]) {
      const missed = turn.missedOpportunities[playerName];
      if (Array.isArray(missed)) {
        missed.forEach((opportunity) => {
          if (opportunity && typeof opportunity === 'object' && 'card' in opportunity && 'threat' in opportunity) {
            const opp = opportunity as unknown as Record<string, unknown>;
            const cardName = String(opp.card || 'Unknown');
            const threatDesc = String(opp.threat || 'Unknown threat');
            mistakes.push({
              turn: index + 1,
              description: `${cardName}: ${threatDesc}`,
              severity: 'minor',
              suggestion: "Consider all available options before making decisions",
            });
          }
        });
      }
    }

    // Identify suboptimal plays
    if (turn.suboptimalPlays && turn.suboptimalPlays[playerName]) {
      const suboptimal = turn.suboptimalPlays[playerName];
      if (Array.isArray(suboptimal)) {
        suboptimal.forEach((play) => {
          if (typeof play === 'string') {
            mistakes.push({
              turn: index + 1,
              description: play,
              severity: 'major',
              suggestion: "Evaluate all cards in hand and board state before acting",
            });
          }
        });
      }
    }
  });

  return mistakes.slice(0, 5);
}

function identifyStrengths(
  replay: GameReplay,
  playerName: string
): string[] {
  const strengths: string[] = [];

  const playerLife = getPlayerLife(replay, playerName);
  const opponentLife = getOpponentLife(replay);

  if (playerLife > opponentLife) {
    strengths.push("Maintained healthy life total throughout the game");
  }

  const turns = getTurns(replay);
  const playerCardAdvantage = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    if (turn.cardAdvantage && typeof turn.cardAdvantage[playerName] === 'number') {
      return sum + turn.cardAdvantage[playerName];
    }
    return sum;
  }, 0);

  if (playerCardAdvantage > 0) {
    strengths.push("Generated card advantage through effective play");
  }

  strengths.push("Good mana management and development");

  return strengths;
}

function identifyImprovementAreas(
  replay: GameReplay,
  playerName: string
): string[] {
  const areas: string[] = [];

  const playerLife = getPlayerLife(replay, playerName);

  if (playerLife < 15) {
    areas.push("Improve defensive strategies to preserve life total");
  }

  const turns = getTurns(replay);
  const missedOpportunities = turns.reduce((count: number, turn: GameAnalysisTurn) => {
    if (turn.missedOpportunities && Array.isArray(turn.missedOpportunities[playerName])) {
      return count + turn.missedOpportunities[playerName].length;
    }
    return count;
  }, 0);

  if (missedOpportunities > 3) {
    areas.push("Consider all available options more carefully before making decisions");
  }

  areas.push("Work on timing of spells and abilities");
  areas.push("Develop better understanding of opponent's deck");

  return areas;
}

function generateDeckSuggestions(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['deckSuggestions'] {
  const suggestions: GameAnalysisOutput['deckSuggestions'] = [];

  const playerLife = getPlayerLife(replay, playerName);

  if (playerLife < 15) {
    suggestions.push({
      card: "Life gain cards (e.g., lifelink creatures, healing spells)",
      reason: "To improve sustainability and survive longer games",
    });
  }

  const turns = getTurns(replay);
  const averageManaCost = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    if (typeof turn.manaCost === 'number') {
      return sum + turn.manaCost;
    }
    return sum;
  }, 0) / (turns.length || 1);

  if (averageManaCost > 3.5) {
    suggestions.push({
      card: "Lower-cost cards (2-3 CMC)",
      reason: "To improve curve and early-game consistency",
    });
  }

  suggestions.push({
    card: "Card draw options",
    reason: "To maintain card advantage throughout the game",
  });

  return suggestions.slice(0, 3);
}

function calculateOverallRating(
  replay: GameReplay,
  playerName: string
): number {
  const playerLife = getPlayerLife(replay, playerName);
  const opponentLife = getOpponentLife(replay);

  let rating = 5; // Base rating

  // Adjust based on life difference
  const lifeDiff = playerLife - opponentLife;
  rating += lifeDiff * 0.2;

  // Adjust based on card advantage
  const turns = getTurns(replay);
  const playerCardAdvantage = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    if (turn.cardAdvantage && typeof turn.cardAdvantage[playerName] === 'number') {
      return sum + turn.cardAdvantage[playerName];
    }
    return sum;
  }, 0);
  rating += playerCardAdvantage * 0.5;

  // Ensure rating is between 1 and 10
  return Math.min(Math.max(rating, 1), 10);
}

function generateTips(
  replay: GameReplay,
  playerName: string
): string[] {
  const tips: string[] = [];

  tips.push("Always consider all cards in your hand before making a decision");
  tips.push("Pay attention to opponent's mana and possible responses");
  tips.push("Plan your turns ahead - think about what you want to accomplish");
  tips.push("Don't be afraid to take risks when the payoff is high");
  tips.push("Learn from your mistakes and analyze why a play didn't work out");

  const playerLife = getPlayerLife(replay, playerName);
  if (playerLife < 15) {
    tips.push("Prioritize survival over aggression when life is low");
  }

  return tips;
}

// ============================================================================
// ISSUE #1235 — Cross-game replay diffing
// ============================================================================

/**
 * A single game outcome, from the *player's* perspective.
 *
 * Re-exported locally so callers of {@link diffReplayHistory} don't have to
 * depend on `@/lib/game-history` (which lives in the storage layer).
 */
export type ReplayOutcome = "win" | "loss" | "draw";

/**
 * Cross-game trend classification.
 *
 *   - `improving`        — recent win-rate is materially better than earlier
 *                          games against the same archetype.
 *   - `worsening`        — recent win-rate is materially worse than earlier
 *                          games against the same archetype. Drives the
 *                          player-facing "you keep losing to X" signal.
 *   - `stable`           — recent win-rate is within the noise band.
 *   - `insufficient_data` — fewer than {@link MIN_GAMES_FOR_TREND} games
 *                          against the archetype, so we refuse to claim a
 *                          trend.
 */
export type OutcomeTrend =
  | "improving"
  | "worsening"
  | "stable"
  | "insufficient_data";

/**
 * Minimum number of replays against the SAME archetype before we compute a
 * trend. Locked at 5 (the acceptance criterion for #1235) — fewer games
 * would produce too many false positives.
 */
export const MIN_GAMES_FOR_TREND = 5;

/**
 * Half-bucket in the win-rate difference that has to be exceeded for a trend
 * to flip from `stable` to `improving`/`worsening`. ±20% win-rate delta is
 * large enough to be a real signal but small enough that close wins/losses
 * don't read as a streak.
 */
export const TREND_DELTA_THRESHOLD = 0.2;

/**
 * A replay with the minimum metadata {@link diffReplayHistory} needs.
 *
 * Extends the read-only {@link GameReplay} (kept backward-compatible with the
 * single-game analyser's input) with the few fields a cross-game diff must
 * observe:
 *
 *   - `outcome`              — who won from the player's POV.
 *   - `opponentArchetype`    — optional; replays without one bucket under
 *                              "Unknown".
 *   - `id` / `date`          — used for chronological ordering (older games
 *                              first) and stable identity in the persisted
 *                              {@link ReplayDiffReport}.
 *   - `turnOfDeath`          — optional pre-computed value; when absent we
 *                              derive it from `playerLife <= 0` and the
 *                              final turn's number.
 *   - `mistakes` / `strengths` — optional per-game signal lists; surfaced
 *                              in the report as `recurringMistakes` /
 *                              `recurringStrengths` when they repeat in
 *                              ≥ half the games in a bucket.
 *
 * All fields except `replay` are optional so the function stays forgiving
 * against partially-migrated game-history rows.
 */
export interface ReplayForDiffing {
  /** The underlying {@link GameReplay}; only the analysis-relevant parts are read. */
  replay: GameReplay;
  /** Outcome from the player's perspective. */
  outcome?: ReplayOutcome;
  /** Detected opponent archetype (e.g. "UW Control"); defaults to "Unknown". */
  opponentArchetype?: string;
  /** Stable identifier for the game; defaults to `replay-${index}` if absent. */
  id?: string;
  /** Unix-ms timestamp used for chronological sorting. */
  date?: number;
  /**
   * Pre-computed turn of death from the player's POV. When undefined we
   * derive it (see {@link deriveTurnOfDeath}). Stored explicitly so callers
   * that already computed it can avoid double work.
   */
  turnOfDeath?: number | null;
  /** Free-form per-game mistake strings (overlap → recurringMistakes). */
  mistakes?: string[];
  /** Free-form per-game strength strings (overlap → recurringStrengths). */
  strengths?: string[];
}

/** A histogram bucket keyed by turn number. */
export interface TurnOfDeathBucket {
  turn: number;
  count: number;
}

/**
 * Per-game summary kept inside a bucket so the UI can render "you died on
 * turn 7 three times" without re-scanning the input array.
 */
export interface ReplaySummary {
  id: string;
  outcome: ReplayOutcome;
  turnOfDeath: number | null;
  date: number;
}

/** A repeated textual pattern inside a bucket. */
export interface RecurringPattern {
  description: string;
  /** How many games in the bucket mentioned this pattern. */
  frequency: number;
  /** `frequency` divided by bucket size, clamped to [0, 1]. */
  ratio: number;
}

/** Statistics for a single opponent-archetype bucket. */
export interface ArchetypeBucketReport {
  archetype: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Lifetime win-rate for this bucket, 0..1. */
  winRate: number;
  /** Win-rate over the last 3 games against this archetype, 0..1. */
  recentWinRate: number;
  /**
   * Trend computed by splitting the chronological game list in half and
   * comparing second-half vs first-half win-rate. `insufficient_data` when
   * the bucket has fewer than {@link MIN_GAMES_FOR_TREND} games.
   */
  outcomeTrend: OutcomeTrend;
  /**
   * Signed delta = second-half win-rate − first-half win-rate. Ranges from
   * −1 (every game lost after the midpoint) to +1 (every game won after the
   * midpoint). Always defined; only the trend label depends on the magnitude.
   */
  outcomeTrendDelta: number;
  /** Mean of `turnOfDeath` for losses only; null if no losses had a known turn. */
  avgTurnOfDeath: number | null;
  /** Histogram of player-turn-of-death across every game in the bucket. */
  turnOfDeathHistogram: TurnOfDeathBucket[];
  /** Mistakes that recur in ≥ half the games in the bucket, sorted by frequency. */
  recurringMistakes: RecurringPattern[];
  /** Strengths that recur in ≥ half the games in the bucket, sorted by frequency. */
  recurringStrengths: RecurringPattern[];
  /** Per-game summaries, chronological (oldest → newest). */
  replays: ReplaySummary[];
}

/** Top-level {@link diffReplayHistory} output. */
export interface ReplayDiffReport {
  playerName: string;
  /** Unix-ms timestamp the report was generated. */
  generatedAt: number;
  /** Total replays that contributed to the report (after filtering). */
  totalGames: number;
  /** Number of distinct archetypes (including "Unknown") that contributed. */
  archetypeCount: number;
  /** Per-archetype buckets, sorted by games played (descending). */
  byArchetype: ArchetypeBucketReport[];
  /** Lifetime win-rate across every replay. */
  overallWinRate: number;
  /** Recent (last 3 games) win-rate across every replay. */
  overallRecentWinRate: number;
  /** Aggregate trend across all buckets, weighted by game count. */
  overallOutcomeTrend: OutcomeTrend;
  /** Aggregate turn-of-death histogram across every bucket. */
  overallTurnOfDeathHistogram: TurnOfDeathBucket[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the player's turn-of-death from a single replay.
 *
 * Rule:
 *   1. If the player is at non-positive life, the turn of death is the
 *      number of the LAST turn in the replay (we use the actual turn
 *      number, falling back to 1-based positional index when missing).
 *   2. If life is positive, the player is still alive — return null. A
 *      draw where the game ends on equal life also returns null because
 *      "death" is undefined.
 *
 * Exported for unit testing.
 */
export function deriveTurnOfDeath(
  replay: GameReplay,
  playerName: string,
): number | null {
  const life = getPlayerLife(replay, playerName);
  if (life > 0) return null;

  const turns = getTurns(replay);
  if (turns.length === 0) return 1;
  const last = turns[turns.length - 1];
  return typeof last.turnNumber === "number" && last.turnNumber > 0
    ? last.turnNumber
    : turns.length;
}

/**
 * Determine the {@link OutcomeTrend} for a chronologically-ordered slice of
 * replay summaries.
 *
 * Algorithm:
 *   - Requires at least {@link MIN_GAMES_FOR_TREND} games; otherwise
 *     `insufficient_data`.
 *   - Splits the list in half (rounding the midpoint UP so a 5-game list
 *     produces a 2/3 split — the "loses later games" pattern still reads
 *     correctly).
 *   - Computes the win-rate of each half (a draw counts as 0.5).
 *   - If second-half − first-half ≤ −TREND_DELTA_THRESHOLD → `worsening`.
 *   - If second-half − first-half ≥ +TREND_DELTA_THRESHOLD → `improving`.
 *   - Otherwise → `stable`.
 *
 * Exported for unit testing.
 */
export function computeOutcomeTrend(summaries: ReplaySummary[]): {
  trend: OutcomeTrend;
  delta: number;
} {
  if (summaries.length < MIN_GAMES_FOR_TREND) {
    return { trend: "insufficient_data", delta: 0 };
  }
  const midpoint = Math.ceil(summaries.length / 2);
  const first = summaries.slice(0, midpoint);
  const second = summaries.slice(midpoint);
  const wr = (xs: ReplaySummary[]): number => {
    if (xs.length === 0) return 0;
    const total = xs.reduce((acc, s) => {
      if (s.outcome === "win") return acc + 1;
      if (s.outcome === "draw") return acc + 0.5;
      return acc;
    }, 0);
    return total / xs.length;
  };
  const delta = wr(second) - wr(first);
  let trend: OutcomeTrend;
  if (delta <= -TREND_DELTA_THRESHOLD) trend = "worsening";
  else if (delta >= TREND_DELTA_THRESHOLD) trend = "improving";
  else trend = "stable";
  return { trend, delta };
}

/**
 * Roll per-game textual patterns (mistakes / strengths) into the top
 * recurring entries for a bucket. A pattern must appear in ≥ half the
 * games in the bucket to surface — that keeps the list short and
 * signal-dense.
 *
 * Exported for unit testing.
 */
export function aggregateRecurringPatterns(
  perGame: Array<string[] | undefined>,
): RecurringPattern[] {
  const totals = new Map<string, number>();
  let gamesWithAny = 0;
  for (const list of perGame) {
    if (!Array.isArray(list) || list.length === 0) continue;
    gamesWithAny++;
    // Dedup within a single game so a mistake mentioned twice in one
    // game counts as one occurrence, not two.
    const unique = new Set(list.map((s) => String(s).trim()).filter(Boolean));
    for (const item of unique) totals.set(item, (totals.get(item) ?? 0) + 1);
  }
  if (gamesWithAny === 0) return [];
  const threshold = Math.ceil(gamesWithAny / 2);
  const out: RecurringPattern[] = [];
  for (const [description, frequency] of totals) {
    if (frequency < threshold) continue;
    out.push({
      description,
      frequency,
      ratio: Math.min(1, frequency / gamesWithAny),
    });
  }
  out.sort((a, b) => b.frequency - a.frequency || a.description.localeCompare(b.description));
  return out;
}

/**
 * Build a turn-of-death histogram from a list of turn numbers. Turns are
 * bucketed by their integer value (no binning) so the player can see
 * exactly which turns repeatedly kill them.
 *
 * Exported for unit testing.
 */
export function buildTurnOfDeathHistogram(
  turns: Array<number | null>,
): TurnOfDeathBucket[] {
  const counts = new Map<number, number>();
  for (const t of turns) {
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([turn, count]) => ({ turn, count }))
    .sort((a, b) => a.turn - b.turn);
}

/**
 * Internal: shape a single {@link ReplayForDiffing} into a
 * {@link ReplaySummary}, deriving `turnOfDeath` if not provided.
 */
function toReplaySummary(
  entry: ReplayForDiffing,
  index: number,
): ReplaySummary {
  const playerName = entry.replay?.players?.[0] ?? "";
  const turnOfDeath =
    entry.turnOfDeath !== undefined
      ? entry.turnOfDeath
      : deriveTurnOfDeath(entry.replay, playerName);
  return {
    id: entry.id ?? `replay-${index}`,
    outcome: entry.outcome ?? "draw",
    turnOfDeath,
    date: typeof entry.date === "number" ? entry.date : 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Aggregate a history of replays into a cross-game
 * {@link ReplayDiffReport}, grouped by opponent archetype.
 *
 * Behaviour:
 *   - Pure function — does NOT touch storage; persistence is handled
 *     separately (see `src/lib/replay-diff-storage.ts`).
 *   - Stable input → stable output (except for `generatedAt`); replays are
 *     sorted by `date` ascending inside each bucket.
 *   - Defensive: malformed entries are silently skipped (no throws).
 *
 * @param replays    The replay history to diff.
 * @param playerName The player whose perspective the report is built for.
 *                   Currently used for labelling; downstream callers may
 *                   use it as the persistence key.
 *
 * @example
 *   const report = diffReplayHistory(myReplayHistory, "Alex");
 *   // report.byArchetype[0] is the bucket for the most-played archetype.
 *   // report.byArchetype[0].outcomeTrend === 'worsening' means the
 *   // player's recent games against that archetype are materially worse.
 */
export async function diffReplayHistory(
  replays: ReplayForDiffing[],
  playerName: string,
): Promise<ReplayDiffReport> {
  const safeReplays = Array.isArray(replays) ? replays : [];

  // Group by archetype (defaulting to "Unknown"). We keep the bucket key
  // exactly as the caller wrote it (after trim) so the UI can group on it
  // verbatim, but we DO fall back to "Unknown" for falsy entries.
  const buckets = new Map<string, ReplayForDiffing[]>();
  safeReplays.forEach((entry, index) => {
    if (!entry || !entry.replay) return;
    const key = (entry.opponentArchetype ?? "Unknown").trim() || "Unknown";
    const list = buckets.get(key) ?? [];
    list.push({ ...entry, _index: index } as ReplayForDiffing & {
      _index: number;
    });
    buckets.set(key, list);
  });

  const byArchetype: ArchetypeBucketReport[] = [];
  for (const [archetype, entries] of buckets.entries()) {
    // Sort chronologically (stable for entries without a date: insertion
    // order is preserved by Array.prototype.sort with a typed comparator
    // returning 0).
    const sorted = entries
      .map((e, i) => ({ entry: e, originalIndex: i }))
      .sort((a, b) => {
        const da = a.entry.date ?? 0;
        const db = b.entry.date ?? 0;
        if (da !== db) return da - db;
        return a.originalIndex - b.originalIndex;
      })
      .map((x) => x.entry);

    const summaries = sorted.map((e, i) => toReplaySummary(e, i));

    let wins = 0;
    let losses = 0;
    let draws = 0;
    const playerNameForDeath = sorted[0]?.replay?.players?.[0] ?? playerName;
    const turnOfDeaths: Array<number | null> = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = summaries[i];
      if (s.outcome === "win") wins++;
      else if (s.outcome === "loss") losses++;
      else draws++;
      // Use the explicitly-provided turnOfDeath when present, otherwise
      // derive it from the replay.
      const explicit = sorted[i].turnOfDeath;
      turnOfDeaths.push(
        explicit !== undefined
          ? explicit
          : deriveTurnOfDeath(sorted[i].replay, playerNameForDeath),
      );
    }
    const games = wins + losses + draws;
    const winRate = games === 0 ? 0 : wins / games;
    const recent = summaries.slice(-3);
    const recentWinRate = recent.length === 0
      ? 0
      : recent.reduce((acc, s) => {
          if (s.outcome === "win") return acc + 1;
          if (s.outcome === "draw") return acc + 0.5;
          return acc;
        }, 0) / recent.length;

    const { trend, delta } = computeOutcomeTrend(summaries);

    const lossTurns = turnOfDeaths.filter(
      (t, i) => summaries[i].outcome === "loss" && typeof t === "number",
    ) as number[];
    const avgTurnOfDeath =
      lossTurns.length === 0
        ? null
        : Number(
            (
              lossTurns.reduce((a, b) => a + b, 0) / lossTurns.length
            ).toFixed(2),
          );

    const recurringMistakes = aggregateRecurringPatterns(
      sorted.map((e) => e.mistakes),
    );
    const recurringStrengths = aggregateRecurringPatterns(
      sorted.map((e) => e.strengths),
    );

    byArchetype.push({
      archetype,
      games,
      wins,
      losses,
      draws,
      winRate,
      recentWinRate,
      outcomeTrend: trend,
      outcomeTrendDelta: delta,
      avgTurnOfDeath,
      turnOfDeathHistogram: buildTurnOfDeathHistogram(turnOfDeaths),
      recurringMistakes,
      recurringStrengths,
      replays: summaries,
    });
  }

  // Sort buckets by game count (most-played first) — that's the most
  // signal-dense ordering for the player UI.
  byArchetype.sort((a, b) => b.games - a.games || a.archetype.localeCompare(b.archetype));

  // Overall aggregates.
  const overallGames = byArchetype.reduce((acc, b) => acc + b.games, 0);
  const overallWins = byArchetype.reduce((acc, b) => acc + b.wins, 0);
  const overallRecentWinRate =
    overallGames === 0
      ? 0
      : byArchetype.reduce((acc, b) => acc + b.recentWinRate * b.games, 0) /
        overallGames;
  const overallWinRate =
    overallGames === 0 ? 0 : overallWins / overallGames;
  const overallTurnOfDeathHistogram = buildTurnOfDeathHistogram(
    byArchetype.flatMap((b) =>
      b.replays.map((r) => r.turnOfDeath),
    ),
  );

  // Weighted aggregate trend: average the bucket deltas by game count.
  // If every bucket is `insufficient_data`, the overall trend is too.
  let overallOutcomeTrend: OutcomeTrend = "insufficient_data";
  if (overallGames >= MIN_GAMES_FOR_TREND) {
    const weightedDelta =
      byArchetype.reduce(
        (acc, b) => acc + b.outcomeTrendDelta * b.games,
        0,
      ) / overallGames;
    if (weightedDelta <= -TREND_DELTA_THRESHOLD) overallOutcomeTrend = "worsening";
    else if (weightedDelta >= TREND_DELTA_THRESHOLD) overallOutcomeTrend = "improving";
    else overallOutcomeTrend = "stable";
  }

  return {
    playerName,
    generatedAt: Date.now(),
    totalGames: overallGames,
    archetypeCount: byArchetype.length,
    byArchetype,
    overallWinRate,
    overallRecentWinRate,
    overallOutcomeTrend,
    overallTurnOfDeathHistogram,
  };
}
