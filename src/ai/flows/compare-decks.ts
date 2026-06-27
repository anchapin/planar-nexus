/**
 * @fileOverview Multi-deck comparison and meta-positioning report (issue #1075).
 *
 * Users deciding which of several builds to bring to an event currently have to
 * run the coach N times and mentally diff the outputs. This module produces a
 * side-by-side comparison of 2-3 decks — or one deck + a meta archetype — and a
 * META-POSITIONING report: how each build stacks up against the field.
 *
 * LOCAL-FIRST and HEURISTIC-GROUNDED, mirroring `sideboard-plan.ts` (#1076):
 *   - Per-deck archetype detection, statistics, role mix and synergy clusters
 *     are REUSED verbatim from `coach-deck-analysis` and `archetype-*` — no
 *     detection logic is duplicated.
 *   - The projected matchup matrix is derived from a documented category
 *     rock-paper-scissors model (the same 6 categories the archetype
 *     signatures and per-matchup sideboard planner use).
 *   - No network/LLM call is required for the core report; an optional async
 *     wrapper (`compareDecksAsync`) enriches synergy clusters via the AI Web
 *     Worker bridge (#1079/#1175) when latency permits.
 *
 * The output is deterministic for a given input set, which keeps it testable
 * and offline-capable.
 */

import type { DeckCard } from "@/app/actions";
import { detectArchetype } from "@/ai/archetype-detector";
import {
  calculateDeckStats,
  getArchetypeByName,
} from "@/ai/archetype-signatures";
import {
  assembleStructuredAnalysis,
  buildStructuredDeckAnalysis,
  type RoleDistribution,
  type SynergyCluster,
} from "@/ai/flows/coach-deck-analysis";

/** All archetype categories the detection system emits. */
type Category = "aggro" | "control" | "midrange" | "combo" | "tribal" | "special";

/** Keys of {@link RoleDistribution}, reused from the per-deck analysis. */
type RoleKey = keyof RoleDistribution;

/**
 * A single deck (or meta-archetype) participating in the comparison.
 *
 * Either provide `cards` for a real decklist, or omit cards and set
 * `archetypeOverride` to compare a deck against a META ARCHETYPE signature
 * (e.g. "Burn", "Draw-Go") without owning a list for it.
 */
export interface DeckComparisonEntry {
  /** Stable id (e.g. the saved deck id); optional, used only for identity. */
  id?: string;
  /** Display name for this column/row. */
  name: string;
  /** The decklist. May be empty when {@link archetypeOverride} is supplied. */
  cards?: DeckCard[];
  /**
   * Force a specific detected archetype NAME (resolved via the archetype
   * signatures). Enables the "one deck + meta archetype" comparison path:
   * pass `{ name: "Burn", archetypeOverride: "Burn" }` with no cards.
   */
  archetypeOverride?: string;
}

/** One cell of the projected matchup matrix (row deck attacking col deck). */
export interface MatchupCell {
  rowDeck: string;
  colDeck: string;
  rowArchetype: string;
  colArchetype: string;
  /** Estimated win probability for the ROW deck vs the COL deck (0..1). */
  winProbability: number;
  rationale: string;
}

/** Card overlap between a pair of decks. */
export interface DeckOverlap {
  a: string;
  b: string;
  /** Shared-card percentage over the multiset union (0..100). */
  overlapPercent: number;
  sharedCards: string[];
}

/** Functional-role distribution diff between a pair of decks. */
export interface RoleDiff {
  a: string;
  b: string;
  /** Signed difference `count[a] - count[b]` for each role. */
  diff: Record<RoleKey, number>;
}

/** Mana-curve diff between a pair of decks (one entry per CMC bucket). */
export interface CurveDiff {
  a: string;
  b: string;
  /** Signed difference `count[a] - count[b]` per CMC bucket. */
  diff: number[];
}

/** A concrete swap suggestion to convert one deck toward another. */
export interface ConversionSwap {
  fromDeck: string;
  toDeck: string;
  cardsToAdd: Array<{ name: string; quantity: number }>;
  cardsToRemove: Array<{ name: string; quantity: number }>;
  rationale: string;
}

/** Per-deck headline used in the comparison table + meta-positioning. */
export interface ComparedDeck {
  name: string;
  archetype: string;
  secondaryArchetype?: string;
  archetypeConfidence: number;
  category: Category;
  averageCmc: number;
  colorIdentity: string[];
  roleDistribution: RoleDistribution;
  manaCurve: number[];
  synergyClusters: SynergyCluster[];
}

/** How one deck is positioned against the field. */
export interface DeckMetaPosition {
  name: string;
  archetype: string;
  category: Category;
  /** Average projected win-rate vs the field meta archetypes (0..1). */
  metaScore: number;
  /** 1 = best positioned. Ties share the lower rank. */
  rank: number;
  strengths: string[];
  weaknesses: string[];
}

/** The full comparison + meta-positioning report. */
export interface DeckComparisonReport {
  /** Whether enough decks were supplied to compute a comparison. */
  sufficient: boolean;
  /** Human-readable note (e.g. why no matrix could be produced). */
  note?: string;
  decks: ComparedDeck[];
  /** Pairwise win-probability matrix (rows attack columns). */
  matchupMatrix: MatchupCell[];
  overlaps: DeckOverlap[];
  roleDiffs: RoleDiff[];
  curveDiffs: CurveDiff[];
  metaPositioning: DeckMetaPosition[];
  recommendation: {
    /** Name of the best-positioned deck, or "" when insufficient. */
    bestDeck: string;
    reasoning: string;
    /** How to nudge the weakest build toward the recommended one. */
    swapsTowardBest?: ConversionSwap;
  };
}

/** Options controlling the comparison + meta-positioning computation. */
export interface CompareDecksOptions {
  /**
   * The set of archetype categories that represent "the field" for
   * meta-positioning. Defaults to one of each category (equal prevalence).
   */
  metaField?: Category[];
}

/**
 * Projected win probability for a deck of category `row` facing a deck of
 * category `col` (the row deck's perspective). Grounded in the classic MTG
 * archetype rock-paper-scissors (aggro races combo, control stabilises against
 * aggro, midrange grinds, etc.) and tuned to be antisymmetric:
 * `M[a][b] + M[b][a] === 1` and `M[a][a] === 0.5`.
 *
 * The 6 categories mirror those emitted by `archetype-signatures.ts` and used
 * by the per-matchup sideboard planner (#1076), so the matrix is consistent
 * with the rest of the coach.
 */
const CATEGORY_MATCHUP: Record<Category, Record<Category, number>> = {
  aggro: { aggro: 0.5, control: 0.42, midrange: 0.48, combo: 0.63, tribal: 0.55, special: 0.5 },
  control: { aggro: 0.58, control: 0.5, midrange: 0.55, combo: 0.61, tribal: 0.53, special: 0.52 },
  midrange: { aggro: 0.52, control: 0.45, midrange: 0.5, combo: 0.46, tribal: 0.55, special: 0.5 },
  combo: { aggro: 0.37, control: 0.39, midrange: 0.54, combo: 0.5, tribal: 0.58, special: 0.52 },
  tribal: { aggro: 0.45, control: 0.47, midrange: 0.45, combo: 0.42, tribal: 0.5, special: 0.48 },
  special: { aggro: 0.5, control: 0.48, midrange: 0.5, combo: 0.48, tribal: 0.52, special: 0.5 },
};

const ALL_CATEGORIES: Category[] = ["aggro", "control", "midrange", "combo", "tribal", "special"];

/** Friendly prose per category pair, for the matrix cell rationale. */
const MATCHUP_NOTES: Partial<Record<Category, Partial<Record<Category, string>>>> = {
  aggro: {
    combo: "Aggro goldfishes before the combo deck assembles its kill.",
    control: "Control stabilises and turns the corner once the early pressure fades.",
    tribal: "Aggro's cheaper threats race the tribal lords off the start.",
  },
  control: {
    aggro: "Removal sweepers and countermagic overwhelm the early board.",
    combo: "Counterspells and interaction deny the combo window.",
    midrange: "Card advantage and answers outlast the one-for-one trading.",
  },
  midrange: {
    aggro: "Efficient blockers and spot removal absorb the early rush.",
    combo: "Limited early interaction leaves the combo window open.",
    tribal: "Bigger midgame threats outclass the synergistic swarm.",
  },
  combo: {
    control: "Disruption and countermagic cut off the combo turn.",
    aggro: "The aggro clock kills before the combo can go off.",
    tribal: "Combo ignores the board and wins a turn ahead of the swarm.",
  },
  tribal: {
    control: "Mass removal resets the lord-stacking board state.",
    aggro: "Tribal lords come online a turn behind the aggro curve.",
  },
  special: {},
};

/** Empty-role helper used to seed the comparison of archetype-only entries. */
function emptyRoleDistribution(): RoleDistribution {
  return { threats: 0, ramp: 0, removal: 0, cardDraw: 0, disruption: 0, lands: 0, other: 0 };
}

/** Category for an archetype name, defaulting to midrange when unknown. */
function categoryOf(archetypeName: string | undefined): Category {
  const cat = getArchetypeByName(archetypeName || "")?.category;
  return (ALL_CATEGORIES.includes(cat as Category) ? cat : "midrange") as Category;
}

/** Normalize a category string to one of the 6 known values. */
function normalizeCategory(cat: string | undefined): Category {
  return ALL_CATEGORIES.includes(cat as Category)
    ? (cat as Category)
    : "midrange";
}

/**
 * Resolve an entry into a {@link ComparedDeck}. Reuses `detectArchetype`,
 * `calculateDeckStats` and `assembleStructuredAnalysis` (which itself reuses
 * `classifyRole`) for real decks; for the meta archetype path it reads the
 * archetype signature directly.
 */
function resolveDeck(
  entry: DeckComparisonEntry,
  synergyClusters: SynergyCluster[],
): ComparedDeck {
  const cards = Array.isArray(entry.cards) ? entry.cards : [];

  // Meta-archetype path: no owned list, just a signature.
  if (entry.archetypeOverride && cards.length === 0) {
    const sig = getArchetypeByName(entry.archetypeOverride);
    const archetype = sig?.name ?? entry.archetypeOverride;
    return {
      name: entry.name,
      archetype,
      archetypeConfidence: sig ? 1 : 0,
      category: normalizeCategory(sig?.category),
      averageCmc: 0,
      colorIdentity: [],
      roleDistribution: emptyRoleDistribution(),
      manaCurve: [],
      synergyClusters: [],
    };
  }

  const detected = detectArchetype(cards);
  const archetype = entry.archetypeOverride ?? detected.primary;
  const stats = calculateDeckStats(cards);

  // `assembleStructuredAnalysis` is the single source of truth for the headline
  // fields; we feed it the already-detected archetype + stats (synergies were
  // resolved by the caller, if at all) so nothing is recomputed.
  const structured = assembleStructuredAnalysis(cards, {
    archetype: detected,
    stats,
    synergies: [],
    missing: [],
  });

  return {
    name: entry.name,
    archetype,
    secondaryArchetype: detected.secondary,
    archetypeConfidence: detected.confidence,
    category: categoryOf(archetype),
    averageCmc: structured.averageCmc,
    colorIdentity: structured.colorIdentity,
    roleDistribution: structured.roleDistribution,
    manaCurve: structured.manaCurve,
    synergyClusters,
  };
}

/** Quantize a multiset of card names -> name -> count. */
function nameMultiset(deck: DeckCard[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of deck) {
    const key = c.name.toLowerCase();
    map.set(key, (map.get(key) ?? 0) + (c.count ?? 0));
  }
  return map;
}

/** Jaccard-style overlap (%) over the card-name multiset union. */
function computeOverlap(a: ComparedDeck, aCards: DeckCard[], b: ComparedDeck, bCards: DeckCard[]): DeckOverlap {
  const setA = nameMultiset(aCards);
  const setB = nameMultiset(bCards);
  let intersection = 0;
  let union = 0;
  const shared: string[] = [];

  const keys = new Set<string>([...setA.keys(), ...setB.keys()]);
  for (const key of keys) {
    const ca = setA.get(key) ?? 0;
    const cb = setB.get(key) ?? 0;
    intersection += Math.min(ca, cb);
    union += Math.max(ca, cb);
    if (ca > 0 && cb > 0) shared.push(key);
  }

  const overlapPercent = union > 0 ? Math.round((intersection / union) * 1000) / 10 : 0;
  return { a: a.name, b: b.name, overlapPercent, sharedCards: shared };
}

/** Signed diff `count[a] - count[b]` across all role keys. */
function computeRoleDiff(a: ComparedDeck, b: ComparedDeck): RoleDiff {
  const diff = emptyRoleDistribution();
  (Object.keys(diff) as RoleKey[]).forEach((k) => {
    diff[k] = (a.roleDistribution[k] ?? 0) - (b.roleDistribution[k] ?? 0);
  });
  return { a: a.name, b: b.name, diff };
}

/** Signed diff per CMC bucket, padded to equal length. */
function computeCurveDiff(a: ComparedDeck, b: ComparedDeck): CurveDiff {
  const len = Math.max(a.manaCurve.length, b.manaCurve.length);
  const diff: number[] = [];
  for (let i = 0; i < len; i++) {
    diff.push((a.manaCurve[i] ?? 0) - (b.manaCurve[i] ?? 0));
  }
  return { a: a.name, b: b.name, diff };
}

/** Projected win probability for the row deck vs the col deck. */
function getCategoryMatchup(row: Category, col: Category): number {
  return CATEGORY_MATCHUP[row]?.[col] ?? 0.5;
}

/** One-line rationale for a category matchup. */
function matchupRationale(row: Category, col: Category, rowName: string, colName: string): string {
  if (row === col) {
    return `Mirror of two ${row} builds — a coin-flip decided by play skill and sideboard tech.`;
  }
  const note = MATCHUP_NOTES[row]?.[col];
  const prob = getCategoryMatchup(row, col);
  const leans = prob > 0.5 ? "favours" : "hurts";
  return note
    ? `${note} (${leans} ${rowName} vs ${colName}.)`
    : `Category matchup (${row} vs ${col}) ${leans} ${rowName}.`;
}

/**
 * Meta-positioning for a deck: average projected win-rate vs the field.
 * Strengths/weaknesses list the field categories the deck is favoured/unfavoured against.
 */
function computeMetaPosition(
  deck: ComparedDeck,
  field: Category[],
  rank: number,
): DeckMetaPosition {
  let sum = 0;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const opponentCategory of field) {
    const p = getCategoryMatchup(deck.category, opponentCategory);
    sum += p;
    if (p > 0.52) strengths.push(`${opponentCategory} field (${Math.round(p * 100)}%)`);
    else if (p < 0.48) weaknesses.push(`${opponentCategory} field (${Math.round(p * 100)}%)`);
  }
  const metaScore = field.length > 0 ? Math.round((sum / field.length) * 1000) / 1000 : 0;
  return {
    name: deck.name,
    archetype: deck.archetype,
    category: deck.category,
    metaScore,
    rank,
    strengths,
    weaknesses,
  };
}

/** True when a card is a land (basic or otherwise) — excluded from swap advice. */
function isLandCard(card: DeckCard): boolean {
  return (card.type_line || "").toLowerCase().includes("land");
}

/**
 * Name multiset difference: cards to add/remove to turn `from` into `to`.
 * Lands are excluded — a manabase delta is not a meaningful archetype pivot,
 * and surfacing "add 12 Plains, remove 12 Islands" drowns out the strategic
 * swaps the coach should actually recommend.
 */
function conversionSwaps(
  fromName: string,
  fromCards: DeckCard[],
  toName: string,
  toCards: DeckCard[],
  archetype: string,
): ConversionSwap {
  const from = nameMultiset(fromCards.filter((c) => !isLandCard(c)));
  const to = nameMultiset(toCards.filter((c) => !isLandCard(c)));
  const names = new Set<string>([...from.keys(), ...to.keys()]);

  const toAdd: Array<{ name: string; quantity: number }> = [];
  const toRemove: Array<{ name: string; quantity: number }> = [];
  for (const name of names) {
    const delta = (to.get(name) ?? 0) - (from.get(name) ?? 0);
    if (delta > 0) toAdd.push({ name, quantity: delta });
    else if (delta < 0) toRemove.push({ name, quantity: -delta });
  }
  // Highest-impact swaps first (largest quantity delta), capped at the 3 most impactful of each.
  const byQty = (a: { quantity: number }, b: { quantity: number }) => b.quantity - a.quantity;
  toAdd.sort(byQty);
  toRemove.sort(byQty);

  return {
    fromDeck: fromName,
    toDeck: toName,
    cardsToAdd: toAdd.slice(0, 3),
    cardsToRemove: toRemove.slice(0, 3),
    rationale: `Highest-impact swaps to pivot ${fromName} toward the ${archetype} shell of ${toName}.`,
  };
}

/**
 * Compare 2-3 decks (or one deck + a meta archetype) and produce a
 * meta-positioning report.
 *
 * Pure and deterministic: the same inputs always yield the same output, with
 * no network or LLM dependency. Per-deck archetype detection, statistics and
 * role classification are REUSED from the existing coach analysers.
 *
 * @param entries  2-3 deck entries (real decks via `cards`, or a meta archetype
 *                 via `archetypeOverride` with no cards).
 * @param options  Field composition for meta-positioning (defaults to one of
 *                 each category).
 */
export function compareDecks(
  entries: DeckComparisonEntry[],
  options: CompareDecksOptions = {},
): DeckComparisonReport {
  const safeEntries = Array.isArray(entries) ? entries : [];

  // Resolve every entry. Synergy clusters require the async worker and are left
  // empty here; `compareDecksAsync` enriches them.
  const decks = safeEntries.map((e) => resolveDeck(e, []));
  const cardsByIdx = safeEntries.map((e) => (Array.isArray(e.cards) ? e.cards : []));

  if (decks.length < 2) {
    return {
      sufficient: false,
      note: "Select at least two decks (or one deck and a meta archetype) to compare.",
      decks,
      matchupMatrix: [],
      overlaps: [],
      roleDiffs: [],
      curveDiffs: [],
      metaPositioning: [],
      recommendation: { bestDeck: "", reasoning: "Need two or more decks to recommend a build." },
    };
  }

  // Projected matchup matrix (rows attack columns; diagonal is a mirror).
  const matchupMatrix: MatchupCell[] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = 0; j < decks.length; j++) {
      const row = decks[i];
      const col = decks[j];
      matchupMatrix.push({
        rowDeck: row.name,
        colDeck: col.name,
        rowArchetype: row.archetype,
        colArchetype: col.archetype,
        winProbability: getCategoryMatchup(row.category, col.category),
        rationale: matchupRationale(row.category, col.category, row.name, col.name),
      });
    }
  }

  // Pairwise overlap / role / curve diffs across every unordered pair.
  const overlaps: DeckOverlap[] = [];
  const roleDiffs: RoleDiff[] = [];
  const curveDiffs: CurveDiff[] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      overlaps.push(computeOverlap(decks[i], cardsByIdx[i], decks[j], cardsByIdx[j]));
      roleDiffs.push(computeRoleDiff(decks[i], decks[j]));
      curveDiffs.push(computeCurveDiff(decks[i], decks[j]));
    }
  }

  // Meta-positioning: average projected win-rate vs the field, ranked.
  const field = options.metaField && options.metaField.length > 0 ? options.metaField : ALL_CATEGORIES;
  const positions = decks.map((d) => computeMetaPosition(d, field, 0));
  // Rank by metaScore desc using standard competition ranking (ties share the
  // lower rank), stable on input order so identical inputs are deterministic.
  const ranked = positions
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => b.p.metaScore - a.p.metaScore || a.idx - b.idx);
  let lastScore: number | null = null;
  let lastRank = 0;
  ranked.forEach((entry, i) => {
    if (lastScore === null || Math.abs(entry.p.metaScore - lastScore) > 1e-9) {
      lastRank = i + 1;
      lastScore = entry.p.metaScore;
    }
    positions[entry.idx].rank = lastRank;
  });

  // Recommendation: the best-positioned build, with the rationale grounded in
  // its archetype + meta score + strengths/weaknesses, plus a swap plan to
  // nudge the weakest owned build toward it.
  const best = positions.find((p) => p.rank === 1)!;
  const reasoningParts = [
    `${best.name} (${best.archetype}) is the best-positioned build for the current meta`,
    `with an average projected win-rate of ${Math.round(best.metaScore * 100)}% across the field.`,
  ];
  if (best.strengths.length > 0) reasoningParts.push(`Favoured vs ${best.strengths.join(", ")}.`);
  if (best.weaknesses.length > 0) reasoningParts.push(`Watch out for ${best.weaknesses.join(", ")}.`);

  // Pick the weakest OWNED deck (has cards) to convert toward the best build.
  let swapsTowardBest: ConversionSwap | undefined;
  const ownedIdx = safeEntries
    .map((e, idx) => ({ e, idx }))
    .filter((o) => o.e.name !== best.name && (o.e.cards?.length ?? 0) > 0)
    .sort((a, b) => {
      const ra = positions[a.idx].rank;
      const rb = positions[b.idx].rank;
      return rb - ra; // weakest (highest rank number) first
    });
  if (ownedIdx.length > 0) {
    const weak = ownedIdx[0];
    swapsTowardBest = conversionSwaps(
      weak.e.name,
      cardsByIdx[weak.idx],
      best.name,
      cardsByIdx[decks.findIndex((d) => d.name === best.name)],
      best.archetype,
    );
  }

  return {
    sufficient: true,
    decks,
    matchupMatrix,
    overlaps,
    roleDiffs,
    curveDiffs,
    metaPositioning: positions,
    recommendation: {
      bestDeck: best.name,
      reasoning: reasoningParts.join(" "),
      swapsTowardBest,
    },
  };
}

/**
 * Async variant that enriches each deck's synergy clusters by running the
 * per-deck analysis through the AI Web Worker bridge (#1079/#1175), then
 * delegates the comparison to the synchronous {@link compareDecks} core.
 *
 * Synergy detection is the only async piece; the rest of the report stays
 * deterministic and offline-capable. If the worker is unavailable the bridge
 * falls back to a main-thread implementation, so this never throws on env.
 */
export async function compareDecksAsync(
  entries: DeckComparisonEntry[],
  options: CompareDecksOptions = {},
): Promise<DeckComparisonReport> {
  const safeEntries = Array.isArray(entries) ? entries : [];

  // Pre-resolve synergy clusters for every real deck in parallel.
  const synergyResults = await Promise.all(
    safeEntries.map(async (entry) => {
      const cards = Array.isArray(entry.cards) ? entry.cards : [];
      if (cards.length === 0 || entry.archetypeOverride) return [];
      try {
        const structured = await buildStructuredDeckAnalysis(cards);
        return structured.synergyClusters;
      } catch {
        return [];
      }
    }),
  );

  const report = compareDecks(safeEntries, options);

  // Splice the richer synergy clusters back into the resolved decks.
  report.decks = report.decks.map((d, idx) => ({
    ...d,
    synergyClusters: synergyResults[idx] ?? [],
  }));

  return report;
}
