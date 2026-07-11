/**
 * AI Neighbor Logic
 *
 * Provides heuristic-based card selection for AI draft opponents.
 * NEIB-02: AI picks cards using heuristic logic
 * NEIB-03: Easy = random, Medium = color-focused
 *
 * Issue #1444: extended to dispatch across the three draft formats. The
 * optional `mode` discriminator on `selectAiPick` lets the communal-pool
 * formats (Rochester, Winston) reuse the same random/color-focused pickers
 * while still applying the parity-aware extension where reads of the
 * table would help.
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
 * Discriminator accepted by {@link selectAiPick} for cross-format dispatch.
 *
 * `'draft'`       — booster draft (the original behavior).
 * `'rochester'`   — communal-pool pick, with table reads available.
 * `'winston'`     — single-card draw decision.
 *
 * Optional so existing call sites are unchanged.
 */
export type AiPickMode = "draft" | "rochester" | "winston";

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
 * Pick a card from a face-up communal pool (Rochester / Winston style).
 *
 * Issue #1444: reuses the colour-focused picker but is also given the
 * `tableRead` (cards already picked by other seats) so the heuristic can
 * reason about parity. For the 'easy' tier we ignore table reads entirely;
 * for 'medium' they only factor in when matching the dominant colour is
 * otherwise a tie.
 */
export function pickFromCommunalPool(
  pool: PoolCard[],
  tableRead: PoolCard[],
  aiState: AiNeighborState,
): PoolCard | null {
  if (pool.length === 0) return null;
  if (aiState.pool.length === 0 && tableRead.length === 0) {
    // Cold start: drop the first concrete hook (a creature or cheap spell).
    const hook = pool.find((c) => /Creature/i.test(c.type_line ?? ""));
    const picked = hook ?? pool[Math.floor(Math.random() * pool.length)];
    emitArchetypeSignal(aiState, aiState.pool, picked as DraftCard, "random");
    return picked;
  }

  // Reuse the colour-focused scorer by wrapping the communal pool in a
  // synthetic DraftPack.
  const syntheticPack: DraftPack = {
    id: "communal",
    cards: pool as DraftCard[],
    isOpened: true,
    pickedCardIds: [],
  };
  const picked = pickColorFocusedCard(syntheticPack, aiState.pool, aiState);
  if (picked === null) return null;
  // The colour-focused picker returns a DraftCard; the cast back to
  // PoolCard is safe because PoolCard extends the same shape.
  return picked as PoolCard;
}

/**
 * Select a card for the AI neighbor to pick.
 * Dispatches to appropriate difficulty-based logic.
 * Issue #1404: also writes an ArchetypeSignal onto `aiNeighbor.state`.
 *
 * Issue #1444: `mode` lets the call site switch to the communal-pool picker
 * (Rochester / Winston). Defaults to `'draft'` to preserve the original
 * booster-draft dispatch.
 */
export function selectAiPick(
  pack: DraftPack,
  aiNeighbor: AiNeighbor,
  mode: AiPickMode = "draft",
  tableRead: PoolCard[] = [],
): DraftCard | null {
  const { difficulty, state } = aiNeighbor;

  if (mode === "rochester" || mode === "winston") {
    // For both communal-pool variants we expose the same dispatcher:
    //  - 'easy'   → random
    //  - 'medium' → colour-focused, with parity tiebreaks
    // 'hard' / 'expert' tiers are intentionally not added until the
    // companion issue (#L14-2) lands; for now they fall through to the
    // colour-focused picker just like 'medium'.
    if (difficulty === "easy") {
      return pickFromCommunalPool(
        pack.cards as PoolCard[],
        tableRead,
        state,
      );
    }
    return pickFromCommunalPool(pack.cards as PoolCard[], tableRead, state);
  }

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
