/**
 * AI Neighbor Logic
 *
 * Provides heuristic-based card selection for AI draft opponents.
 * NEIB-02: AI picks cards using heuristic logic
 * NEIB-03: Easy = random, Medium = color-focused
 */

import type {
  DraftPack,
  DraftCard,
  PoolCard,
  AiNeighbor,
  AiDifficulty,
  AiNeighborState,
  ArchetypeSignal,
  CurveShift,
} from "./limited/types";
import { ARCHETYPE_SIGNAL_BUFFER_SIZE } from "./limited/types";
import type { ScryfallCard, DeckCard } from "@/app/actions";
import { classifyArchetypeAxis } from "@/ai/archetype-detector";

/**
 * Card color score for evaluation
 */
export type CardColorScore = {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
};

/**
 * Extract color information from a Scryfall card
 */
export function getCardColors(card: ScryfallCard | DraftCard): string[] {
  // Use colors array if available, otherwise check color_identity
  return card.colors || card.color_identity || [];
}

const COLOR_LETTER_TO_NAME: Record<string, keyof CardColorScore> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

/**
 * Evaluate colors from a pool of cards and return dominant colors.
 * Accepts both single-letter ('R') and full-name ('red') color tags; Scryfall
 * returns letters, internal callers sometimes pass names.
 */
export function evaluateCardColors(pool: PoolCard[]): CardColorScore {
  const score: CardColorScore = {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };

  if (pool.length === 0) {
    // Default to colorless (no preference) for empty pool
    return score;
  }

  // Count colors in pool
  for (const card of pool) {
    const colors = getCardColors(card);
    if (colors.length === 0) {
      score.colorless += 1;
    } else {
      for (const color of colors) {
        const letter = color.toUpperCase();
        const name = (COLOR_LETTER_TO_NAME[letter] ??
          color.toLowerCase()) as keyof CardColorScore;
        if (name in score) {
          score[name] += 1;
        }
      }
    }
  }

  return score;
}

/**
 * Get the dominant color from a pool (most frequent)
 */
export function getDominantColor(pool: PoolCard[]): string | null {
  const score = evaluateCardColors(pool);

  let maxColor: string | null = null;
  let maxCount = 0;

  for (const [color, count] of Object.entries(score)) {
    if (count > maxCount) {
      maxCount = count;
      maxColor = color;
    }
  }

  // Only return a color if we have meaningful counts
  return maxCount > 0 ? maxColor : null;
}

/**
 * Pick a random available card from the pack (Easy difficulty).
 * Mutates `aiState` to record an ArchetypeSignal describing what the pick
 * telegraphed to a learning observer (issue #1404).
 */
export function pickRandomCard(
  pack: DraftPack,
  aiState: AiNeighborState,
): DraftCard | null {
  // Get unpicked cards
  const availableCards = pack.cards.filter(
    (card) => !pack.pickedCardIds.includes(card.id),
  );

  if (availableCards.length === 0) {
    return null;
  }

  // Pick random card
  const randomIndex = Math.floor(Math.random() * availableCards.length);
  const picked = availableCards[randomIndex];

  emitArchetypeSignal(aiState, aiState.pool, picked, "random");

  return picked;
}

/**
 * Pick a card based on color preference (Medium difficulty)
 * Prioritizes cards matching the dominant color in AI's pool.
 * Mutates `aiState` to record an ArchetypeSignal (issue #1404).
 */
export function pickColorFocusedCard(
  pack: DraftPack,
  aiPool: PoolCard[],
  aiState: AiNeighborState,
): DraftCard | null {
  // Get unpicked cards
  const availableCards = pack.cards.filter(
    (card) => !pack.pickedCardIds.includes(card.id),
  );

  if (availableCards.length === 0) {
    return null;
  }

  // Get dominant color from pool
  const dominantColor = getDominantColor(aiPool);

  let picked: DraftCard | null = null;

  if (!dominantColor) {
    // No color preference, fall back to random (still emit a 'color-fix'
    // signal because the picker was color-focused in intent).
    picked = pickRandomCardNoSignal(pack);
  } else {
    // Score each card by how well it matches dominant color
    const scoredCards = availableCards.map((card) => {
      const cardColors = getCardColors(card);
      let score = 0;

      if (cardColors.includes(dominantColor.toUpperCase())) {
        // Perfect match - primary color
        score += 10;
      } else if (cardColors.length === 0) {
        // Colorless card - neutral, low score
        score += 1;
      } else {
        // Multi-color or off-color - small penalty
        score -= cardColors.length;
      }

      return { card, score };
    });

    // Sort by score descending
    scoredCards.sort((a, b) => b.score - a.score);

    // Pick from top candidates with some randomness
    const topCandidates = scoredCards.filter(
      (c) => c.score === scoredCards[0].score,
    );
    const randomTopIndex = Math.floor(Math.random() * topCandidates.length);

    picked = topCandidates[randomTopIndex].card;
  }

  if (picked) {
    emitArchetypeSignal(aiState, aiPool, picked, "color-fix");
  }

  return picked;
}

/**
 * Internal: pick random card without re-emitting a signal. Used by the
 * color-focused picker when it has no dominant color to anchor on yet.
 */
function pickRandomCardNoSignal(pack: DraftPack): DraftCard | null {
  const availableCards = pack.cards.filter(
    (card) => !pack.pickedCardIds.includes(card.id),
  );
  if (availableCards.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * availableCards.length);
  return availableCards[randomIndex];
}

/**
 * Select a card for the AI neighbor to pick.
 * Dispatches to appropriate difficulty-based logic.
 * Issue #1404: also writes an ArchetypeSignal onto `aiNeighbor.state`.
 */
export function selectAiPick(
  pack: DraftPack,
  aiNeighbor: AiNeighbor,
): DraftCard | null {
  const { difficulty, state } = aiNeighbor;

  switch (difficulty) {
    case "easy":
      return pickRandomCard(pack, state);

    case "medium":
      return pickColorFocusedCard(pack, state.pool, state);

    default:
      // Unknown difficulty, fall back to random
      console.warn(`Unknown AI difficulty: ${difficulty}, using random`);
      return pickRandomCard(pack, state);
  }
}

// ============================================================================
// Archetype Signal Pipeline (issue #1404)
// ============================================================================

/**
 * Convert a PoolCard / DraftCard / ScryfallCard into a DeckCard-shaped
 * DeckCard for the archetype detector. We need `count` (the detector
 * assumes inventory) so we tag each pool entry with count=1.
 */
function toDeckCards(pool: PoolCard[]): DeckCard[] {
  return pool.map((card) => ({
    ...card,
    count: 1,
  }));
}

/**
 * Compute average CMC across a pool (lands excluded — they have CMC 0 but
 * would skew the curve).
 */
function averageCmc(pool: PoolCard[]): number {
  if (pool.length === 0) return 0;
  const nonLands = pool.filter((c) => !/land/i.test(c.type_line ?? ""));
  if (nonLands.length === 0) return 0;
  const sum = nonLands.reduce(
    (acc, c) => acc + (typeof c.cmc === "number" ? c.cmc : 0),
    0,
  );
  return sum / nonLands.length;
}

/**
 * Emit an ArchetypeSignal describing what the AI's latest pick telegraphed.
 * Mutates `aiState.lastPickReason` and appends to `aiState.archetypeSignals`,
 * capping the buffer at ARCHETYPE_SIGNAL_BUFFER_SIZE.
 *
 * Public so callers that pre-select a card (e.g. test fixtures, future
 * worker-based dispatch) can produce a signal without going through a
 * pickRandom/pickColorFocused call.
 */
export function emitArchetypeSignal(
  aiState: AiNeighborState,
  poolBeforePick: PoolCard[],
  picked: DraftCard,
  reason: ArchetypeSignal["reason"],
): ArchetypeSignal {
  const poolAfter = [...poolBeforePick, picked];

  const { axis, confidence, primary } = classifyArchetypeAxis(
    toDeckCards(poolAfter),
  );
  const dominantColor = getDominantColor(poolAfter);

  // Curve shift: compare average CMC before vs after this pick.
  const avgBefore = averageCmc(poolBeforePick);
  const avgAfter = averageCmc(poolAfter);
  let curveShift: CurveShift = "flat";
  if (poolBeforePick.length === 0) {
    curveShift = "flat";
  } else if (avgAfter < avgBefore - 0.05) {
    curveShift = "faster";
  } else if (avgAfter > avgBefore + 0.05) {
    curveShift = "slower";
  }

  const signal: ArchetypeSignal = {
    archetypeAxis: axis,
    dominantColor,
    confidence,
    curveShift,
    reason,
    pickedAt: Date.now(),
    pickNumber: poolBeforePick.length + 1,
  };

  aiState.lastPickReason = signal;
  const next = [...aiState.archetypeSignals, signal];
  if (next.length > ARCHETYPE_SIGNAL_BUFFER_SIZE) {
    next.splice(0, next.length - ARCHETYPE_SIGNAL_BUFFER_SIZE);
  }
  aiState.archetypeSignals = next;

  return signal;
}
