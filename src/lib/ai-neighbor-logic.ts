/**
 * AI Neighbor Logic
 *
 * Provides heuristic-based card selection for AI draft opponents.
 * NEIB-02: AI picks cards using heuristic logic
 * NEIB-03: Easy = random, Medium = color-focused
 *
 * Issue #1443: extended to the canonical 4-tier difficulty taxonomy
 * (`'easy' | 'medium' | 'hard' | 'expert'`). Hard picks use a synergy-aware
 * scorer with a curve-fill term; expert picks use a deck-evaluator-style
 * score with a top-3 random tiebreak. The randomnessFactor / blunderChance
 * knobs are pulled from {@link DIFFICULTY_CONFIGS}[tier] so the per-format
 * override (`FORMAT_DIFFICULTY_OVERRIDES`, issue #1069) propagates
 * transparently into the picker.
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
import { detectSynergies } from "@/ai/synergy-detector";
import {
  resolveDifficultyConfig,
  type DifficultyLevel,
} from "@/ai/ai-difficulty";
import { DefaultWeights } from "@/ai/game-state-evaluator";
import { normalizeAiDifficulty } from "./limited/types";

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

// ============================================================================
// Tier-aware pickers (issue #1443)
// ============================================================================

/**
 * Convert a `PoolCard` / `DraftCard` shim into a `DeckCard` for the
 * synergy-detector / mana-sequencing pipeline. Used by the
 * hard/expert pickers; mirrors {@link toDeckCards} but takes a single card
 * so callers can score "pool + candidate" combinations cheaply.
 */
function toDeckCardShim(card: ScryfallCard | DraftCard | PoolCard): DeckCard {
  return { ...card, count: 1 } as DeckCard;
}

/**
 * Sum of {@link detectSynergies} scores for a deck-as-DeckCard[].
 * Lower `minScore` (0) is used so the picker can still react to low-magnitude
 * signals when the pool is small.
 */
function sumSynergyScore(deck: DeckCard[]): number {
  if (deck.length === 0) return 0;
  return detectSynergies(deck, 0).reduce((acc, s) => acc + s.score, 0);
}

/**
 * Marginal synergy contribution of a single candidate card given the
 * current pool. We compute `score(pool + candidate) - score(pool)` so the
 * contribution of "filling the curve with this slot" is captured even when
 * the pool is too small to fire standalone synergies.
 */
function marginalSynergyScore(pool: PoolCard[], candidate: DraftCard): number {
  const poolAsDeck = pool.map(toDeckCardShim);
  const before = sumSynergyScore(poolAsDeck);
  const after = sumSynergyScore([...poolAsDeck, toDeckCardShim(candidate)]);
  return after - before;
}

/**
 * Curve-fill bonus for a candidate card given the current non-land pool.
 *
 * Lower-cmc cards fill the missing curve slots at turns 2–4 most
 * aggressively (the issue's "hard picks smooth the curve" criterion). Empty
 * pool = curve is wide open, so we hand out a flat bonus for any non-land
 * card. Mirrors the (small) curve contribution in
 * `computeCurveConformance` (`src/ai/mana-sequencing.ts`).
 */
function curveFillBonus(pool: PoolCard[], candidate: DraftCard): number {
  const isLand = /land/i.test(candidate.type_line ?? "");
  if (isLand) return 0;
  const nonLands = pool.filter((c) => !/land/i.test(c.type_line ?? ""));
  if (nonLands.length === 0) {
    // Empty pool: every non-land slot is a free hit, give a flat bonus.
    return 2;
  }
  const cmc =
    typeof candidate.cmc === "number" &&
    candidate.cmc >= 1 &&
    candidate.cmc <= 4
      ? candidate.cmc
      : 0;
  const avgPoolCmc =
    nonLands.reduce(
      (acc, c) => acc + (typeof c.cmc === "number" ? c.cmc : 0),
      0,
    ) / nonLands.length;
  // Reward picks that land within ±1 of the pool's average CMC and are in
  // the 1-4 "playable" window.
  const playability = cmc > 0 && cmc <= 4 ? 3 : cmc === 5 ? 1 : 0;
  const matchBonus = cmc > 0 && Math.abs(cmc - avgPoolCmc) <= 1 ? 2 : 0;
  return playability + matchBonus;
}

/**
 * Hard tier picker (issue #1443).
 *
 * Scores each available card by marginal synergy contribution plus a
 * curve-fill bonus. Falls back to a top-3 random tiebreak weighted by score
 * to inject the small `randomnessFactor` documented in
 * {@link DIFFICULTY_CONFIGS}[tier] without sacrificing determinism in the
 * dominant case. Like the other tiers, emits an ArchetypeSignal (issue
 * #1404) describing what the pick telegraphed.
 */
export function pickSynergyAndCurveCard(
  pack: DraftPack,
  aiPool: PoolCard[],
  aiState: AiNeighborState,
  difficulty: AiDifficulty = "hard",
): DraftCard | null {
  const availableCards = pack.cards.filter(
    (card) => !pack.pickedCardIds.includes(card.id),
  );
  if (availableCards.length === 0) return null;

  const scored = availableCards.map((card) => {
    const synScore = marginalSynergyScore(aiPool, card);
    const curveScore = curveFillBonus(aiPool, card);
    return { card, score: synScore + curveScore };
  });

  // Sort by score desc, then deterministically by id so the test pick is
  // stable when scores tie.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.card.id.localeCompare(b.card.id);
  });

  const topScore = scored[0].score;
  const topCandidates = scored.filter((c) => c.score === topScore);

  // Inject a small randomnessFactor-driven wobble: if the top three are
  // within 1 point of each other, randomize among them. The wobble size is
  // scaled to `Math.random() < randomnessFactor * 3` so a higher-tier
  // `randomnessFactor` (easy=0.4, medium=0.2, hard=0.1) widens the candidate
  // window — keeping the documented monotonic-in-skill knob (issue #990)
  // honoring the picking variance. We refuse to wobble below 3 candidates
  // because the synergy scorer is otherwise deterministic.
  const knob = resolveDifficultyConfig(
    difficulty as DifficultyLevel,
    "limited",
  ).randomnessFactor;
  const wobbleCandidates =
    scored.length >= 3 && Math.random() < knob * 3
      ? scored.slice(0, Math.min(3, scored.length))
      : topCandidates;
  const pickIndex = Math.floor(Math.random() * wobbleCandidates.length);
  const picked = wobbleCandidates[pickIndex].card;

  emitArchetypeSignal(aiState, aiPool, picked, "premium");
  return picked;
}

/**
 * Expert tier picker (issue #1443).
 *
 * Orders candidates by a deck-evaluator-style score computed from
 * {@link DefaultWeights}[expert] (creature power / toughness /
 * card-advantage / hand-quality weights from
 * `src/ai/game-state-evaluator.ts`). The blunderChance from
 * {@link DIFFICULTY_CONFIGS}[expert] is applied as a top-3 random tiebreak
 * so an expert AI can still occasionally take a slower line.
 */
export function pickHighestTierValueCard(
  pack: DraftPack,
  aiPool: PoolCard[],
  aiState: AiNeighborState,
  difficulty: AiDifficulty = "expert",
): DraftCard | null {
  const availableCards = pack.cards.filter(
    (card) => !pack.pickedCardIds.includes(card.id),
  );
  if (availableCards.length === 0) return null;

  const w = DefaultWeights.expert;

  const powerToughnessBonus = (card: DraftCard): number => {
    const p = parseInt(card.power ?? "0", 10) || 0;
    const t = parseInt(card.toughness ?? "0", 10) || 0;
    return p * w.creaturePower + t * w.creatureToughness;
  };

  const rarityBonus = (card: DraftCard): number => {
    switch ((card.rarity ?? "common").toLowerCase()) {
      case "mythic":
        return w.cardSelection * 6;
      case "rare":
        return w.cardSelection * 4;
      case "uncommon":
        return w.cardSelection * 2;
      default:
        return w.cardSelection * 1;
    }
  };

  const scored = availableCards.map((card) => {
    const isCreature = /creature/i.test(card.type_line ?? "");
    const cmc = typeof card.cmc === "number" ? card.cmc : 0;
    const creaturesAlreadyInPool = aiPool.filter((c) =>
      /creature/i.test(c.type_line ?? ""),
    ).length;
    const creatureCountBoost = isCreature
      ? (w.creatureCount * Math.max(0, 4 - creaturesAlreadyInPool)) / 4
      : 0;
    const score =
      powerToughnessBonus(card) +
      rarityBonus(card) +
      creatureCountBoost +
      (cmc >= 2 && cmc <= 4 ? w.manaAvailable * 2 : 0) +
      (cmc >= 5 ? -w.tempoAdvantage : 0);
    return { card, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.card.id.localeCompare(b.card.id);
  });

  // Pull the expert-tier blunderChance from the canonical config so any
  // per-format override (#1069) propagates transparently.
  const resolved = resolveDifficultyConfig(
    difficulty as DifficultyLevel,
    "limited",
  );
  const blunderChance = Math.max(0, Math.min(1, resolved.blunderChance));

  let picked: DraftCard;
  const topCandidates = scored.slice(0, Math.min(3, scored.length));

  if (topCandidates.length > 1 && Math.random() < blunderChance * 10) {
    // Occasional slump: choose a non-top tier-1 option within the top 3.
    // Math.random() < blunderChance * 10 turns blunderChance=0.02 into a
    // ~20% chance to slip from #1 to #2/#3 — large enough to be testable
    // without diluting the expert tier. Documented in PR description.
    const idx = 1 + Math.floor(Math.random() * (topCandidates.length - 1));
    picked = topCandidates[idx].card;
  } else {
    picked = topCandidates[0].card;
  }

  emitArchetypeSignal(aiState, aiPool, picked, "premium");
  return picked;
}

/**
 * Map an arbitrary incoming string to the canonical {@link DifficultyLevel}
 * set, then resolve its effective `randomnessFactor` / `blunderChance` for
 * the limited-format tier. Centralized so a future change to either the
 * taxonomy or the per-format override delta (issue #1069) only touches
 * one place.
 */
function difficultyKnobs(difficulty: unknown): {
  randomnessFactor: number;
  blunderChance: number;
} {
  const level: DifficultyLevel = normalizeAiDifficulty(
    difficulty,
  ) as DifficultyLevel;
  const cfg = resolveDifficultyConfig(level, "limited");
  return {
    randomnessFactor: cfg.randomnessFactor,
    blunderChance: cfg.blunderChance,
  };
}

/**
 * Apply the documented randomness knob for the active tier: with
 * probability `randomnessFactor` (`DIFFICULTY_CONFIGS[tier]`), fall back to
 * a random pick; otherwise return the scored pick. Used by the high-end
 * tiers so the canonical error-rate knob reaches the draft picker without
 * threading per-tier callbacks.
 */
function maybeApplyRandomness(
  pack: DraftPack,
  scored: DraftCard,
  randomnessFactor: number,
): DraftCard {
  if (Math.random() < randomnessFactor) {
    const availableCards = pack.cards.filter(
      (card) => !pack.pickedCardIds.includes(card.id),
    );
    if (availableCards.length === 0) return scored;
    const r = Math.floor(Math.random() * availableCards.length);
    return availableCards[r];
  }
  return scored;
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
 * Issue #1443: dispatches across all four canonical tiers
 * (`easy | medium | hard | expert`). The `hard` and `expert` cases reuse
 * the synergy-detector / mana-sequencing integrations; the `randomnessFactor`
 * knob from {@link DIFFICULTY_CONFIGS} is folded in via
 * {@link maybeApplyRandomness} so per-format overrides (issue #1069)
 * propagate transparently.
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
    // 'hard' / 'expert' tiers also reuse `pickFromCommunalPool` for now;
    // the synergy-aware expert extension is intentionally left for the
    // community-pool follow-up (issue #1444 follow-ups).
    if (difficulty === "easy") {
      return pickFromCommunalPool(pack.cards as PoolCard[], tableRead, state);
    }
    return pickFromCommunalPool(pack.cards as PoolCard[], tableRead, state);
  }

  switch (difficulty) {
    case "easy":
      return pickRandomCard(pack, state);

    case "medium":
      return pickColorFocusedCard(pack, state.pool, state);

    case "hard": {
      const picked = pickSynergyAndCurveCard(
        pack,
        state.pool,
        state,
        difficulty,
      );
      if (picked === null) return null;
      const { randomnessFactor } = difficultyKnobs(difficulty);
      return maybeApplyRandomness(pack, picked, randomnessFactor);
    }

    case "expert": {
      const picked = pickHighestTierValueCard(
        pack,
        state.pool,
        state,
        difficulty,
      );
      if (picked === null) return null;
      const { randomnessFactor } = difficultyKnobs(difficulty);
      return maybeApplyRandomness(pack, picked, randomnessFactor);
    }

    default: {
      // Pre-#1443 the type was narrow enough that this branch was
      // unreachable. After widening to the canonical 4-tier union, the
      // only string that could land here is an archival alias like
      // `'beginner' | 'normal' | 'master'` that escaped normalization —
      // fall back to random so we never silently drop into a non-existent
      // picker.
      console.warn(`Unknown AI difficulty: ${difficulty}, using random`);
      return pickRandomCard(pack, state);
    }
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
