/**
 * @fileOverview Archetype detection algorithm for Magic: The Gathering decks
 *
 * Implements scoring-based archetype detection using deck statistics
 * and predefined archetype signatures.
 */

import type { DeckCard } from "@/app/actions";
import {
  ARCHETYPE_SIGNATURES,
  ArchetypeSignature,
  ArchetypeResult,
  DeckStats,
  HybridArchetype,
  calculateDeckStats,
} from "./archetype-signatures";

const HYBRID_BLEND_THRESHOLD = 40;

function detectHybridArchetypes(
  normalizedScores: Array<{ name: string; score: number; category: string }>,
): HybridArchetype[] {
  if (normalizedScores.length < 2) return [];

  const primary = normalizedScores[0];
  const secondaries: typeof normalizedScores = [];

  for (let i = 1; i < normalizedScores.length; i++) {
    const candidate = normalizedScores[i];
    if (
      candidate.score > 0 &&
      primary.score - candidate.score <= HYBRID_BLEND_THRESHOLD
    ) {
      secondaries.push(candidate);
    }
  }

  if (secondaries.length === 0) return [];

  return secondaries.map((sec) => ({
    primary: primary.name,
    secondary: sec.name,
    hybridBlend:
      Math.round((sec.score / (primary.score + sec.score)) * 100) / 100,
  }));
}

/**
 * Normalize scores to 0-100 scale
 */
function normalizeScores(
  scores: Array<{ name: string; score: number; category: string }>,
): Array<{ name: string; score: number; category: string }> {
  if (scores.length === 0) return [];

  const maxScore = Math.max(...scores.map((s) => s.score), 1);
  const minScore = Math.min(...scores.map((s) => s.score));
  const range = maxScore - minScore || 1;

  return scores.map((s) => ({
    ...s,
    score: Math.round(((s.score - minScore) / range) * 100),
  }));
}

/**
 * Calculate confidence score based on score gap and absolute score
 */
function calculateConfidence(
  primaryScore: number,
  secondaryScore: number,
  allScores: Array<{ name: string; score: number; category: string }>,
): number {
  if (allScores.length === 0) return 0;

  const maxScore = Math.max(...allScores.map((s) => s.score), 1);
  const avgScore =
    allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length;

  // Base confidence from absolute score (0-50 points)
  const absoluteConfidence = Math.min(50, (primaryScore / maxScore) * 50);

  // Gap confidence from score difference (0-50 points)
  const gapConfidence =
    secondaryScore > 0
      ? Math.min(50, ((primaryScore - secondaryScore) / primaryScore) * 50 + 25)
      : 50;

  // Combined confidence (0-100)
  const confidence = absoluteConfidence + gapConfidence;

  return Math.round(confidence) / 100; // Return as 0-1 decimal
}

/**
 * Detect archetype for a deck
 *
 * @param deck - Array of cards in the deck
 * @returns Archetype detection result with primary, secondary, and confidence
 */
export function detectArchetype(deck: DeckCard[]): ArchetypeResult {
  if (deck.length === 0) {
    return {
      primary: "Unknown",
      confidence: 0,
      allScores: [],
    };
  }

  // Calculate deck statistics
  const stats = calculateDeckStats(deck);

  // Score against each archetype
  const scores: Array<{ name: string; score: number; category: string }> = [];

  for (const signature of ARCHETYPE_SIGNATURES) {
    try {
      const score = signature.scoreFunction(deck, stats);
      scores.push({
        name: signature.name,
        score,
        category: signature.category,
      });
    } catch (error) {
      console.error(`Error scoring archetype ${signature.name}:`, error);
      scores.push({
        name: signature.name,
        score: 0,
        category: signature.category,
      });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Normalize scores
  const normalizedScores = normalizeScores(scores);

  // Get primary and secondary
  const primary = normalizedScores[0];
  const secondary = normalizedScores[1];

  // Handle edge case - all zero scores
  if (!primary || primary.score === 0) {
    return {
      primary: "Unknown",
      confidence: 0,
      secondary: undefined,
      secondaryConfidence: undefined,
      allScores: normalizedScores,
    };
  }

  // Calculate confidence
  const confidence = calculateConfidence(
    primary.score,
    secondary?.score || 0,
    normalizedScores,
  );

  // Build result
  const result: ArchetypeResult = {
    primary: primary.name,
    confidence,
    allScores: normalizedScores,
  };

  // Add secondary if significant (within 30 points)
  if (
    secondary &&
    secondary.score >= primary.score - 30 &&
    secondary.score > 0
  ) {
    result.secondary = secondary.name;
    result.secondaryConfidence = calculateConfidence(
      secondary.score,
      normalizedScores[2]?.score || 0,
      normalizedScores.slice(1),
    );
  }

  const hybrids = detectHybridArchetypes(normalizedScores);
  if (hybrids.length > 0) {
    result.hybridArchetypes = hybrids;
  }

  return result;
}

/**
 * Get archetype details by name
 */
export function getArchetypeDetails(
  name: string,
): ArchetypeSignature | undefined {
  return ARCHETYPE_SIGNATURES.find(
    (a) => a.name.toLowerCase() === name.toLowerCase(),
  );
}

/**
 * Get all archetypes
 */
export function getAllArchetypes(): ArchetypeSignature[] {
  return [...ARCHETYPE_SIGNATURES];
}

/**
 * Get archetypes by category
 */
export function getArchetypesByCategory(
  category: string,
): ArchetypeSignature[] {
  return ARCHETYPE_SIGNATURES.filter((a) => a.category === category);
}

/**
 * Quick archetype check - returns true if deck matches archetype above threshold
 */
export function isArchetype(
  deck: DeckCard[],
  archetypeName: string,
  threshold: number = 0.7,
): boolean {
  const result = detectArchetype(deck);
  if (result.primary.toLowerCase() !== archetypeName.toLowerCase()) {
    return false;
  }
  return result.confidence >= threshold;
}

/**
 * Coarse-grained archetype-axis classification used by the AI-neighbor
 * draft-time signal pipeline (issue #1404).
 *
 * Reuses the existing `detectArchetype` pipeline and collapses its `category`
 * field into one of the five archetype axes the Limited UX surfaces:
 * `'aggro' | 'control' | 'midrange' | 'combo' | 'undecided'`.
 *
 * 'tribal' and 'special' archetype categories are folded into `'midrange'`
 * because they don't fit cleanly into the four core axes; the draft-time UI
 * only needs to telegraph the macro-archetype. Sparse pools (or any pool that
 * `detectArchetype` returns `'Unknown'` for) report `'undecided'`.
 *
 * Returns `{ axis, confidence }` — the caller can render either value or
 * both. `confidence` is the underlying `detectArchetype` confidence, so the
 * UI can show "AI signaling: red aggro (confidence 0.7)".
 */
export function classifyArchetypeAxis(deck: DeckCard[]): {
  axis: import("@/lib/limited/types").ArchetypeAxis;
  confidence: number;
  primary: string;
} {
  const result = detectArchetype(deck);

  if (!result || result.primary === "Unknown" || result.confidence === 0) {
    return { axis: "undecided", confidence: 0, primary: "Unknown" };
  }

  const category = (
    result.allScores.find((s) => s.name === result.primary)?.category ?? ""
  ).toLowerCase();

  let axis: import("@/lib/limited/types").ArchetypeAxis;
  switch (category) {
    case "aggro":
      axis = "aggro";
      break;
    case "control":
      axis = "control";
      break;
    case "combo":
      axis = "combo";
      break;
    case "midrange":
    case "tribal":
    case "special":
      axis = "midrange";
      break;
    default:
      axis = "undecided";
  }

  return { axis, confidence: result.confidence, primary: result.primary };
}

/**
 * Get deck statistics without archetype detection
 */
export function getDeckStats(deck: DeckCard[]): DeckStats {
  return calculateDeckStats(deck);
}
