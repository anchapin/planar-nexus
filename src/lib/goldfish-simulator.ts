/**
 * @fileOverview Pure opening-hand "goldfish" simulator for the deck builder.
 *
 * A goldfish simulator repeatedly deals opening hands from a deck, applies a
 * mulligan heuristic, then plays out the first several turns of land drops
 * against a passive opponent (a "goldfish"). Aggregated over many trials it
 * reports mana-curve / playability statistics — average lands by turn,
 * on-curve cast percentage per CMC, mulligan rate, and an opening-land
 * histogram — so a player can validate their mana curve without full
 * play-testing. See issue #1439.
 *
 * Everything here is pure: all randomness flows through an injectable RNG,
 * so a given seed reproduces the exact same set of trials. The rules engine
 * (`src/lib/game-state/`) is intentionally untouched; this module only reads
 * the deck model read-only.
 */

import type { DeckCard } from "@/app/actions";

/**
 * Pseudorandom number generator producing floats in `[0, 1)`.
 * Injected everywhere randomness is needed so trials are reproducible.
 */
export type Rng = () => number;

/**
 * Seedable PRNG (mulberry32). Same seed → same deterministic sequence,
 * which is what makes a simulation run reproducible across reloads.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build an RNG. Omit `seed` to fall back to `Math.random` (non-deterministic).
 */
export function createRng(seed?: number): Rng {
  if (seed === undefined) return Math.random;
  return mulberry32(seed);
}

/**
 * A single physical card slot used by the simulator. Derived (read-only)
 * from {@link DeckCard}: each copy in a deck-list entry expands to one slot.
 */
export interface SimCard {
  /** Stable, per-copy id (`<cardId>-<copyIndex>`). */
  id: string;
  name: string;
  cmc: number;
  isLand: boolean;
  typeLine: string;
  colors: string[];
}

/**
 * Flatten a deck (and optionally a sideboard) into one slot per physical card,
 * classifying each as land or spell by its type line. Lands are detected by a
 * case-insensitive "land" substring in `type_line`, matching the convention
 * used across the rest of the deck builder.
 */
export function buildSimulationDeck(
  cards: readonly DeckCard[],
  sideboard: readonly DeckCard[] = [],
  includeSideboard = false,
): SimCard[] {
  const pool = includeSideboard ? [...cards, ...sideboard] : cards;
  const deck: SimCard[] = [];
  for (const card of pool) {
    const count = Math.max(0, Math.floor(card.count || 0));
    const typeLine = card.type_line ?? "";
    const isLand = typeLine.toLowerCase().includes("land");
    const colors = card.colors ? [...card.colors] : [];
    for (let i = 0; i < count; i++) {
      deck.push({
        id: `${card.id}-${i}`,
        name: card.name,
        cmc: card.cmc ?? 0,
        isLand,
        typeLine,
        colors,
      });
    }
  }
  return deck;
}

/**
 * Fisher–Yates shuffle driven by an injectable RNG. Returns a new array; the
 * input is never mutated. With a seeded RNG the result is fully deterministic.
 */
export function shuffle<T>(array: readonly T[], rng: Rng = Math.random): T[] {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Tunable keep/mulligan heuristic. Every field is optional and falls back to
 * a sensible, hand-size-relative default.
 */
export interface MulliganPolicy {
  /** Minimum land count required to keep (default scales with hand size). */
  minLands?: number;
  /** Maximum land count considered keepable (default scales with hand size). */
  maxLands?: number;
  /** Minimum non-land spells required to keep (default 1). */
  minSpells?: number;
}

/**
 * Default keepable land bounds for a hand of `handSize` cards, derived from
 * the classic ~2–5 land keep for a 7-card opener and scaled down for smaller
 * mulligan hands.
 */
export function defaultLandBounds(handSize: number): {
  minLands: number;
  maxLands: number;
} {
  const minLands = Math.max(1, Math.round(handSize * (2 / 7)));
  const maxLands = Math.max(minLands, Math.round(handSize * (5 / 7)));
  return { minLands, maxLands };
}

/**
 * Decide whether to keep an opening hand under the given policy. A hand is
 * kept when its land count falls within `[minLands, maxLands]` and it holds at
 * least `minSpells` non-land cards (guards against all-land / spell-starved
 * openers).
 */
export function decideKeep(
  hand: readonly SimCard[],
  policy: MulliganPolicy = {},
): boolean {
  const handSize = hand.length;
  const bounds = defaultLandBounds(handSize);
  const minLands = policy.minLands ?? bounds.minLands;
  const maxLands = policy.maxLands ?? bounds.maxLands;
  const minSpells = policy.minSpells ?? 1;
  const lands = hand.filter((c) => c.isLand).length;
  const spells = handSize - lands;
  if (lands < minLands) return false;
  if (lands > maxLands) return false;
  if (spells < minSpells) return false;
  return true;
}

/**
 * Result of dealing an opening hand, including the library remainder from the
 * same shuffle so the turn simulation can draw through it.
 */
export interface OpeningHandResult {
  /** The kept opening hand. */
  hand: SimCard[];
  /** Full shuffled library from which `hand` was dealt (hand sits at the top). */
  library: SimCard[];
  /** Final hand size (reduced by each mulligan). */
  handSize: number;
  /** Number of mulligans taken before keeping. */
  mulligansTaken: number;
  /** Land count in the kept hand. */
  openingLands: number;
}

/**
 * Options controlling a single opening-hand deal.
 */
export interface OpeningHandOptions {
  /** Initial hand size (default 7). */
  startingHandSize?: number;
  /** Never mulligan below this size (default 5). */
  minHandSize?: number;
  /** Keep/mulligan heuristic. */
  mulligan?: MulliganPolicy;
  /** RNG driving each shuffle. */
  rng?: Rng;
}

/**
 * Deal an opening hand with mulligans (Vancouver/Paris-style: each mulligan
 * re-shuffles and re-deals one fewer card). The hand is forced kept once it
 * reaches `minHandSize`. Returns the kept hand plus the remaining library
 * (same shuffle) so turns can be played out.
 */
export function simulateOpening(
  deck: readonly SimCard[],
  options: OpeningHandOptions = {},
): OpeningHandResult {
  const starting = options.startingHandSize ?? 7;
  const minHand = Math.max(1, options.minHandSize ?? 5);
  const rng = options.rng ?? Math.random;
  const policy = options.mulligan ?? {};
  let handSize = starting;
  let mulligansTaken = 0;
  let library: SimCard[] = [];
  let hand: SimCard[] = [];

  while (handSize >= minHand) {
    library = shuffle(deck, rng);
    hand = library.slice(0, Math.min(handSize, library.length));
    const forceKeep = handSize <= minHand;
    if (forceKeep || decideKeep(hand, policy)) {
      break;
    }
    handSize -= 1;
    mulligansTaken += 1;
  }

  return {
    hand,
    library,
    handSize,
    mulligansTaken,
    openingLands: hand.filter((c) => c.isLand).length,
  };
}

/**
 * Result of playing out land drops over the first several turns.
 */
export interface TurnSimulationResult {
  /** `landsByTurn[i]` = lands in play at the end of turn `i + 1`. */
  landsByTurn: number[];
  /** Number of cards drawn from the library during the simulated turns. */
  drewCards: number;
}

/**
 * Options controlling the turn-by-turn simulation.
 */
export interface TurnSimulationOptions {
  /** Number of turns to play (default 6). */
  turns?: number;
  /** On the play skips the turn-1 draw; on the draw draws every turn. */
  onThePlay?: boolean;
}

/**
 * Play out `turns` turns against a goldfish: draw (when applicable) then make
 * the land drop if a land is in hand. Accumulates lands in play turn by turn.
 * Mana color is intentionally ignored (a documented simplification); this
 * validates curve/density rather than colored-pip requirements.
 */
export function simulateTurns(
  opening: OpeningHandResult,
  options: TurnSimulationOptions = {},
): TurnSimulationResult {
  const turns = options.turns ?? 6;
  const onThePlay = options.onThePlay ?? true;
  const hand = opening.hand.slice();
  const drawPile = opening.library.slice(opening.hand.length);
  let drawIndex = 0;
  let landsInPlay = 0;
  const landsByTurn: number[] = [];

  for (let turn = 1; turn <= turns; turn++) {
    const skipFirstDraw = onThePlay && turn === 1;
    if (!skipFirstDraw && drawIndex < drawPile.length) {
      hand.push(drawPile[drawIndex]);
      drawIndex += 1;
    }
    const landIdx = hand.findIndex((c) => c.isLand);
    if (landIdx >= 0) {
      landsInPlay += 1;
      hand.splice(landIdx, 1);
    }
    landsByTurn.push(landsInPlay);
  }

  return { landsByTurn, drewCards: drawIndex };
}

/**
 * Whether a spell of the given CMC is "on curve" castable: a CMC-N spell is
 * on curve when you reach N lands by turn N. Returns false for CMCs beyond
 * the simulated turn count.
 */
export function onCurveCastable(
  landsByTurn: readonly number[],
  cmc: number,
): boolean {
  if (cmc < 1 || cmc > landsByTurn.length) return false;
  return landsByTurn[cmc - 1] >= cmc;
}

/**
 * Configuration for a full simulated sample run.
 */
export interface GoldfishConfig {
  /** Number of trials to aggregate (default 100). */
  iterations?: number;
  /** Seed for the master RNG (default `Date.now()`). */
  seed?: number;
  /** Initial hand size (default 7). */
  startingHandSize?: number;
  /** Never mulligan below this size (default 5). */
  minHandSize?: number;
  /** Turns to play per trial (default 6). */
  turns?: number;
  /** On the play (default true). */
  onThePlay?: boolean;
  /** Keep/mulligan heuristic overrides. */
  mulligan?: MulliganPolicy;
}

/**
 * Aggregated mana-curve / playability statistics over many trials.
 */
export interface GoldfishStats {
  iterations: number;
  seed: number;
  /** The kept opening hand of the first trial, for display. */
  sampleHand: SimCard[];
  /** Mean land count across kept opening hands. */
  avgOpeningLands: number;
  /** Population standard deviation of opening-hand land counts. */
  openingLandsStdDev: number;
  /** `landHistogram[i]` = number of kept hands with exactly `i` lands (0..7). */
  landHistogram: number[];
  /** Fraction of trials that took at least one mulligan. */
  mulliganRate: number;
  /** Mean mulligans per trial. */
  avgMulligans: number;
  /** Fraction of trials kept at the full starting hand size. */
  keepAtSevenRate: number;
  /** `avgLandsByTurn[i]` = mean lands in play at end of turn `i + 1`. */
  avgLandsByTurn: number[];
  /** `onCurveCastPercent[cmc]` = % of trials on-curve for that CMC. */
  onCurveCastPercent: Record<number, number>;
  /** `finalHandSizeCounts[n]` = number of trials ending at hand size `n`. */
  finalHandSizeCounts: number[];
}

/**
 * Run `iterations` goldfish trials and aggregate the statistics. Each trial
 * draws its own sub-seed from the master (seeded) RNG, so a given `seed`
 * reproduces the entire run deterministically. Throws when the deck cannot
 * fill an opening hand (the UI enforces the format min-cards guard before
 * calling).
 */
export function runGoldfishSimulation(
  deck: readonly SimCard[],
  config: GoldfishConfig = {},
): GoldfishStats {
  const iterations = config.iterations ?? 100;
  const seed = config.seed ?? Date.now();
  const turns = config.turns ?? 6;
  const startingHandSize = config.startingHandSize ?? 7;
  const minHandSize = config.minHandSize ?? 5;
  const onThePlay = config.onThePlay ?? true;

  if (deck.length < startingHandSize) {
    throw new Error(
      `Cannot simulate: deck has ${deck.length} cards, need at least ${startingHandSize}.`,
    );
  }

  const masterRng = mulberry32(seed);
  let sampleHand: SimCard[] = [];

  let totalOpeningLands = 0;
  let totalMulligans = 0;
  let mulliganHands = 0;
  let keptAtSeven = 0;
  const landHistogram = new Array(8).fill(0);
  const sumLandsByTurn = new Array(turns).fill(0);
  const onCurveHits: Record<number, number> = {};
  for (let cmc = 1; cmc <= turns; cmc++) onCurveHits[cmc] = 0;
  const finalHandSizeCounts: number[] = [];
  const openingLandsSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const trialSeed = Math.floor(masterRng() * 0x100000000);
    const trialRng = mulberry32(trialSeed);
    const opening = simulateOpening(deck, {
      startingHandSize,
      minHandSize,
      mulligan: config.mulligan,
      rng: trialRng,
    });
    if (i === 0) sampleHand = opening.hand;

    const lands = opening.openingLands;
    totalOpeningLands += lands;
    openingLandsSamples.push(lands);
    landHistogram[Math.min(7, Math.max(0, lands))] += 1;
    totalMulligans += opening.mulligansTaken;
    if (opening.mulligansTaken > 0) mulliganHands += 1;
    if (opening.mulligansTaken === 0) keptAtSeven += 1;
    finalHandSizeCounts[opening.handSize] =
      (finalHandSizeCounts[opening.handSize] ?? 0) + 1;

    const turnSim = simulateTurns(opening, { turns, onThePlay });
    for (let t = 0; t < turns; t++) {
      sumLandsByTurn[t] += turnSim.landsByTurn[t];
    }
    for (let cmc = 1; cmc <= turns; cmc++) {
      if (onCurveCastable(turnSim.landsByTurn, cmc)) onCurveHits[cmc] += 1;
    }
  }

  const avgOpeningLands = totalOpeningLands / iterations;
  const variance =
    openingLandsSamples.reduce(
      (sum, x) => sum + (x - avgOpeningLands) ** 2,
      0,
    ) / iterations;
  const openingLandsStdDev = Math.sqrt(variance);
  const avgLandsByTurn = sumLandsByTurn.map((s) => s / iterations);
  const onCurveCastPercent: Record<number, number> = {};
  for (let cmc = 1; cmc <= turns; cmc++) {
    onCurveCastPercent[cmc] = (onCurveHits[cmc] / iterations) * 100;
  }

  return {
    iterations,
    seed,
    sampleHand,
    avgOpeningLands,
    openingLandsStdDev,
    landHistogram,
    mulliganRate: mulliganHands / iterations,
    avgMulligans: totalMulligans / iterations,
    keepAtSevenRate: keptAtSeven / iterations,
    avgLandsByTurn,
    onCurveCastPercent,
    finalHandSizeCounts,
  };
}

/**
 * Render a {@link GoldfishStats} as a plain-text summary suitable for copying
 * to the clipboard (and pasting into chat or the AI coach).
 */
export function formatGoldfishSummary(stats: GoldfishStats): string {
  const lines: string[] = [];
  lines.push(
    `Goldfish simulation — ${stats.iterations} trials (seed ${stats.seed})`,
  );
  lines.push(
    `Opening lands: avg ${stats.avgOpeningLands.toFixed(2)} (σ ${stats.openingLandsStdDev.toFixed(2)})`,
  );
  lines.push(`Mulligan rate: ${(stats.mulliganRate * 100).toFixed(0)}%`);
  lines.push(`Keep at 7: ${(stats.keepAtSevenRate * 100).toFixed(0)}%`);
  lines.push(
    `Lands by turn: ${stats.avgLandsByTurn.map((v, i) => `T${i + 1} ${v.toFixed(2)}`).join(", ")}`,
  );
  const onCurve = Object.entries(stats.onCurveCastPercent)
    .map(([cmc, pct]) => `${cmc}-drop ${pct.toFixed(0)}%`)
    .join(", ");
  lines.push(`On-curve castable: ${onCurve}`);
  lines.push(`Opening land histogram (0-7): ${stats.landHistogram.join(", ")}`);
  return lines.join("\n");
}
