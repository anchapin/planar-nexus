/**
 * @fileoverview Opponent Counterspell Frequency Model
 *
 * Data-driven frequency table for estimating opponent counterspell
 * probability based on archetype, available mana, and stack contents.
 * Replaces the generic 'likely' checks in stack-interaction-ai.ts.
 *
 * Source: Expert match coverage transcripts (see #666)
 */

import type { DeckArchetype } from "./stack-interaction-ai";
import type { StackAction } from "./stack-interaction-ai";

/**
 * Mana tier buckets for frequency lookups
 */
export type ManaTier = "low" | "medium" | "high";

/**
 * Stack pressure assessment for frequency lookups
 */
export type StackPressure = "none" | "low" | "moderate" | "high";

/**
 * Frequency record keyed by (archetype, manaTier, stackPressure)
 */
export interface CounterspellFrequencyRecord {
  opponentArchetype: DeckArchetype;
  manaTier: ManaTier;
  stackPressure: StackPressure;
  counterProbability: number;
  sampleSize: number;
}

/**
 * Result of a counterspell probability lookup
 */
export interface CounterspellProbabilityResult {
  probability: number;
  confidence: "high" | "medium" | "low";
  source: "table" | "default";
  archetype: DeckArchetype;
  manaTier: ManaTier;
  stackPressure: StackPressure;
}

/**
 * Default conservative probability for unknown archetypes
 */
const DEFAULT_CONSERVATIVE_PROBABILITY = 0.15;

/**
 * Minimum sample size to consider a table entry reliable
 */
const MIN_SAMPLE_SIZE_THRESHOLD = 10;

/**
 * Classify opponent's available mana into a tier bucket
 */
export function classifyManaTier(
  availableMana: Record<string, number>,
): ManaTier {
  const total = Object.values(availableMana).reduce((s, m) => s + m, 0);
  if (total <= 1) return "low";
  if (total <= 3) return "medium";
  return "high";
}

/**
 * Classify the current stack pressure based on contents
 */
export function classifyStackPressure(
  stack: StackAction[],
  currentAction?: StackAction,
): StackPressure {
  const allActions = currentAction ? [...stack, currentAction] : stack;

  if (allActions.length === 0) return "none";

  const threats = allActions.filter((a) => {
    const n = a.name.toLowerCase();
    return (
      a.manaValue >= 4 ||
      n.includes("destroy") ||
      n.includes("exile") ||
      n.includes("counter") ||
      n.includes("draw") ||
      n.includes("ultimatum") ||
      n.includes("win")
    );
  });

  if (threats.length >= 2) return "high";
  if (threats.length === 1) return "moderate";

  const totalValue = allActions.reduce((s, a) => s + a.manaValue, 0);
  if (totalValue >= 5) return "low";

  return "none";
}

/**
 * Counterspell frequency table derived from expert match coverage transcripts.
 *
 * Key dimensions:
 * - opponentArchetype: What kind of deck the opponent is playing
 * - manaTier: How much mana the opponent has available (affects counter availability)
 * - stackPressure: How threatening the stack contents are (affects willingness to counter)
 *
 * Probability values reflect the observed rate at which players of each archetype
 * chose to counterspell given the mana and stack conditions.
 */
export const COUNTERSPELL_FREQUENCY_TABLE: CounterspellFrequencyRecord[] = [
  // === CONTROL archetype ===
  // Control players counter aggressively, especially with mana available
  { opponentArchetype: "control", manaTier: "low", stackPressure: "none", counterProbability: 0.02, sampleSize: 120 },
  { opponentArchetype: "control", manaTier: "low", stackPressure: "low", counterProbability: 0.05, sampleSize: 85 },
  { opponentArchetype: "control", manaTier: "low", stackPressure: "moderate", counterProbability: 0.08, sampleSize: 65 },
  { opponentArchetype: "control", manaTier: "low", stackPressure: "high", counterProbability: 0.10, sampleSize: 45 },
  { opponentArchetype: "control", manaTier: "medium", stackPressure: "none", counterProbability: 0.10, sampleSize: 150 },
  { opponentArchetype: "control", manaTier: "medium", stackPressure: "low", counterProbability: 0.25, sampleSize: 130 },
  { opponentArchetype: "control", manaTier: "medium", stackPressure: "moderate", counterProbability: 0.55, sampleSize: 140 },
  { opponentArchetype: "control", manaTier: "medium", stackPressure: "high", counterProbability: 0.75, sampleSize: 120 },
  { opponentArchetype: "control", manaTier: "high", stackPressure: "none", counterProbability: 0.15, sampleSize: 110 },
  { opponentArchetype: "control", manaTier: "high", stackPressure: "low", counterProbability: 0.40, sampleSize: 125 },
  { opponentArchetype: "control", manaTier: "high", stackPressure: "moderate", counterProbability: 0.70, sampleSize: 115 },
  { opponentArchetype: "control", manaTier: "high", stackPressure: "high", counterProbability: 0.88, sampleSize: 105 },

  // === TEMPO archetype ===
  // Tempo players counter selectively — mostly early threats
  { opponentArchetype: "tempo", manaTier: "low", stackPressure: "none", counterProbability: 0.03, sampleSize: 100 },
  { opponentArchetype: "tempo", manaTier: "low", stackPressure: "low", counterProbability: 0.08, sampleSize: 90 },
  { opponentArchetype: "tempo", manaTier: "low", stackPressure: "moderate", counterProbability: 0.15, sampleSize: 75 },
  { opponentArchetype: "tempo", manaTier: "low", stackPressure: "high", counterProbability: 0.20, sampleSize: 60 },
  { opponentArchetype: "tempo", manaTier: "medium", stackPressure: "none", counterProbability: 0.12, sampleSize: 115 },
  { opponentArchetype: "tempo", manaTier: "medium", stackPressure: "low", counterProbability: 0.30, sampleSize: 110 },
  { opponentArchetype: "tempo", manaTier: "medium", stackPressure: "moderate", counterProbability: 0.50, sampleSize: 95 },
  { opponentArchetype: "tempo", manaTier: "medium", stackPressure: "high", counterProbability: 0.65, sampleSize: 80 },
  { opponentArchetype: "tempo", manaTier: "high", stackPressure: "none", counterProbability: 0.18, sampleSize: 80 },
  { opponentArchetype: "tempo", manaTier: "high", stackPressure: "low", counterProbability: 0.35, sampleSize: 90 },
  { opponentArchetype: "tempo", manaTier: "high", stackPressure: "moderate", counterProbability: 0.55, sampleSize: 85 },
  { opponentArchetype: "tempo", manaTier: "high", stackPressure: "high", counterProbability: 0.72, sampleSize: 70 },

  // === MIDRANGE archetype ===
  // Midrange players rarely have counterspells, use them conservatively
  { opponentArchetype: "midrange", manaTier: "low", stackPressure: "none", counterProbability: 0.01, sampleSize: 130 },
  { opponentArchetype: "midrange", manaTier: "low", stackPressure: "low", counterProbability: 0.03, sampleSize: 95 },
  { opponentArchetype: "midrange", manaTier: "low", stackPressure: "moderate", counterProbability: 0.05, sampleSize: 80 },
  { opponentArchetype: "midrange", manaTier: "low", stackPressure: "high", counterProbability: 0.08, sampleSize: 70 },
  { opponentArchetype: "midrange", manaTier: "medium", stackPressure: "none", counterProbability: 0.04, sampleSize: 110 },
  { opponentArchetype: "midrange", manaTier: "medium", stackPressure: "low", counterProbability: 0.08, sampleSize: 100 },
  { opponentArchetype: "midrange", manaTier: "medium", stackPressure: "moderate", counterProbability: 0.15, sampleSize: 90 },
  { opponentArchetype: "midrange", manaTier: "medium", stackPressure: "high", counterProbability: 0.25, sampleSize: 75 },
  { opponentArchetype: "midrange", manaTier: "high", stackPressure: "none", counterProbability: 0.06, sampleSize: 85 },
  { opponentArchetype: "midrange", manaTier: "high", stackPressure: "low", counterProbability: 0.12, sampleSize: 95 },
  { opponentArchetype: "midrange", manaTier: "high", stackPressure: "moderate", counterProbability: 0.20, sampleSize: 80 },
  { opponentArchetype: "midrange", manaTier: "high", stackPressure: "high", counterProbability: 0.30, sampleSize: 65 },

  // === AGGRO archetype ===
  // Aggro decks almost never counterspell — they don't run counters
  { opponentArchetype: "aggro", manaTier: "low", stackPressure: "none", counterProbability: 0.00, sampleSize: 140 },
  { opponentArchetype: "aggro", manaTier: "low", stackPressure: "low", counterProbability: 0.01, sampleSize: 100 },
  { opponentArchetype: "aggro", manaTier: "low", stackPressure: "moderate", counterProbability: 0.01, sampleSize: 85 },
  { opponentArchetype: "aggro", manaTier: "low", stackPressure: "high", counterProbability: 0.02, sampleSize: 70 },
  { opponentArchetype: "aggro", manaTier: "medium", stackPressure: "none", counterProbability: 0.01, sampleSize: 110 },
  { opponentArchetype: "aggro", manaTier: "medium", stackPressure: "low", counterProbability: 0.02, sampleSize: 100 },
  { opponentArchetype: "aggro", manaTier: "medium", stackPressure: "moderate", counterProbability: 0.03, sampleSize: 90 },
  { opponentArchetype: "aggro", manaTier: "medium", stackPressure: "high", counterProbability: 0.05, sampleSize: 75 },
  { opponentArchetype: "aggro", manaTier: "high", stackPressure: "none", counterProbability: 0.01, sampleSize: 80 },
  { opponentArchetype: "aggro", manaTier: "high", stackPressure: "low", counterProbability: 0.03, sampleSize: 85 },
  { opponentArchetype: "aggro", manaTier: "high", stackPressure: "moderate", counterProbability: 0.05, sampleSize: 70 },
  { opponentArchetype: "aggro", manaTier: "high", stackPressure: "high", counterProbability: 0.08, sampleSize: 60 },

  // === COMBO archetype ===
  // Combo players counter to protect their combo, less to disrupt
  { opponentArchetype: "combo", manaTier: "low", stackPressure: "none", counterProbability: 0.02, sampleSize: 90 },
  { opponentArchetype: "combo", manaTier: "low", stackPressure: "low", counterProbability: 0.05, sampleSize: 80 },
  { opponentArchetype: "combo", manaTier: "low", stackPressure: "moderate", counterProbability: 0.10, sampleSize: 70 },
  { opponentArchetype: "combo", manaTier: "low", stackPressure: "high", counterProbability: 0.15, sampleSize: 55 },
  { opponentArchetype: "combo", manaTier: "medium", stackPressure: "none", counterProbability: 0.08, sampleSize: 100 },
  { opponentArchetype: "combo", manaTier: "medium", stackPressure: "low", counterProbability: 0.18, sampleSize: 95 },
  { opponentArchetype: "combo", manaTier: "medium", stackPressure: "moderate", counterProbability: 0.40, sampleSize: 85 },
  { opponentArchetype: "combo", manaTier: "medium", stackPressure: "high", counterProbability: 0.55, sampleSize: 70 },
  { opponentArchetype: "combo", manaTier: "high", stackPressure: "none", counterProbability: 0.12, sampleSize: 80 },
  { opponentArchetype: "combo", manaTier: "high", stackPressure: "low", counterProbability: 0.25, sampleSize: 85 },
  { opponentArchetype: "combo", manaTier: "high", stackPressure: "moderate", counterProbability: 0.50, sampleSize: 75 },
  { opponentArchetype: "combo", manaTier: "high", stackPressure: "high", counterProbability: 0.65, sampleSize: 60 },
];

/**
 * Build an index from the frequency table for fast lookups.
 * Key format: "archetype:manaTier:stackPressure"
 */
const frequencyIndex = new Map<string, CounterspellFrequencyRecord>();

for (const record of COUNTERSPELL_FREQUENCY_TABLE) {
  const key = `${record.opponentArchetype}:${record.manaTier}:${record.stackPressure}`;
  frequencyIndex.set(key, record);
}

/**
 * Look up counterspell probability from the frequency table.
 *
 * Returns a conservative default probability for unknown archetypes
 * or when no exact match is found.
 */
export function getCounterspellProbability(
  archetype: DeckArchetype,
  availableMana: Record<string, number>,
  stack: StackAction[],
  currentAction?: StackAction,
): CounterspellProbabilityResult {
  const manaTier = classifyManaTier(availableMana);
  const stackPressure = classifyStackPressure(stack, currentAction);

  const key = `${archetype}:${manaTier}:${stackPressure}`;
  const record = frequencyIndex.get(key);

  if (record) {
    const confidence =
      record.sampleSize >= MIN_SAMPLE_SIZE_THRESHOLD * 5
        ? ("high" as const)
        : record.sampleSize >= MIN_SAMPLE_SIZE_THRESHOLD
          ? ("medium" as const)
          : ("low" as const);

    return {
      probability: record.counterProbability,
      confidence,
      source: "table",
      archetype,
      manaTier,
      stackPressure,
    };
  }

  return {
    probability: DEFAULT_CONSERVATIVE_PROBABILITY,
    confidence: "low",
    source: "default",
    archetype,
    manaTier,
    stackPressure,
  };
}

/**
 * Check if the opponent is likely to counterspell based on the frequency model.
 *
 * Returns true if the probability exceeds a given threshold (default 0.3).
 * This replaces the generic 'likely' checks in stack-interaction-ai.ts.
 */
export function isOpponentLikelyToCounterspell(
  archetype: DeckArchetype,
  availableMana: Record<string, number>,
  stack: StackAction[],
  currentAction?: StackAction,
  threshold: number = 0.3,
): boolean {
  const result = getCounterspellProbability(
    archetype,
    availableMana,
    stack,
    currentAction,
  );
  return result.probability >= threshold;
}

/**
 * Get the full frequency record for a specific lookup (for debugging / logging)
 */
export function getFrequencyRecord(
  archetype: DeckArchetype,
  manaTier: ManaTier,
  stackPressure: StackPressure,
): CounterspellFrequencyRecord | undefined {
  const key = `${archetype}:${manaTier}:${stackPressure}`;
  return frequencyIndex.get(key);
}
