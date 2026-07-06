/**
 * @fileOverview Structured deck analysis for the conversational AI coach.
 *
 * Issue #923: the conversational coach previously received a RAW card list
 * (one line per card) which produced shallow advice. This module pre-processes
 * a deck into a STRUCTURED analysis — archetype, synergy clusters, mana curve,
 * role distribution, key cards, and strengths/gaps — that the coach prompt can
 * reason about directly.
 *
 * It deliberately REUSES the existing analysers rather than duplicating logic:
 *   - detectArchetype / calculateDeckStats  (src/ai/archetype-*.ts)
 *   - detectSynergies / detectMissingSynergies (src/ai/synergy-detector.ts)
 */

import type { DeckCard } from "@/app/actions";
import { detectArchetype } from "@/ai/archetype-detector";
import {
  calculateDeckStats,
  type ArchetypeResult,
  type DeckStats,
} from "@/ai/archetype-signatures";
import {
  detectMissingSynergies,
  type SynergyResult,
  type MissingSynergy,
} from "@/ai/synergy-detector";
import { detectSynergiesAsync } from "@/ai/worker/synergy-worker-bridge";
import {
  getAllManaBaseRecommendations,
  type ManaBaseRecommendation,
} from "@/lib/anti-meta";

/** A single synergy cluster surfaced to the coach. */
export interface SynergyCluster {
  name: string;
  category: string;
  score: number;
  cards: string[];
  description: string;
}

/** Count of cards assigned to each functional role. */
export interface RoleDistribution {
  threats: number;
  ramp: number;
  removal: number;
  cardDraw: number;
  disruption: number;
  lands: number;
  other: number;
}

/** A standout card with the reason it matters for this deck. */
export interface KeyCard {
  name: string;
  role: string;
  reason: string;
}

/**
 * Per-CMC-bucket over/under-loaded status vs an archetype-appropriate target.
 *
 * Issue #1239 asks the coach to STOP merely describing the curve and START
 * recommending concrete over/under-loaded buckets and what to do about them.
 *
 * `cmc === 0` represents lands and is included so the UI can render a complete
 * row; for the bucket-distribution analysis lands are excluded because the
 * per-bucket action list is about non-land plays.
 */
export interface CurveBucketStatus {
  /** CMC bucket index (0..7, where 7 represents the "7+" bucket). */
  cmc: number;
  /** Display label for the bucket ("0", "1", ..., "7+"). */
  label: string;
  /** Cards the deck currently has in this bucket (lands included at cmc=0). */
  actual: number;
  /** Archetype-target number of cards for this bucket (lands excluded). */
  target: number;
  /** Difference `actual - target`. Positive = over-loaded, negative = under-loaded. */
  delta: number;
  /** Coarse status: "over" / "under" / "balanced" / "lands". */
  status: "over" | "under" | "balanced" | "lands";
  /** Human-readable suggestion ("add 2", "cut 1") or null when balanced. */
  advice: string | null;
}

/**
 * Concrete mana-curve and land-count recommendation for a deck.
 *
 * Added in issue #1239 so the coach no longer just describes the curve
 * (`assessCurve`) — it now RECOMMENDS concrete land counts vs the archetype's
 * `recommendedLands` (consumed from `src/lib/anti-meta.ts` when available)
 * and flags CMC buckets that are over- or under-loaded relative to an
 * archetype-appropriate target shape (consumed from `src/lib/mana-curve.ts`).
 */
export interface CurveRecommendation {
  /**
   * Archetype the recommendation was built against. Defaults to the detected
   * primary archetype; falls back to a strategy profile when no per-archetype
   * mana-base data exists in `anti-meta.ts`.
   */
  archetypeTarget: string;
  /**
   * Where the recommendation came from.
   *  - "archetype": per-archetype `recommendedLands` + bucket profile by name
   *  - "strategy": generic aggro/midrange/control/combo fallback profile
   */
  source: "archetype" | "strategy";
  /** Recommended land count for the archetype (mid-point of `min`/`max`). */
  recommendedLands: number;
  /** Lower bound on the acceptable land count. */
  minLands: number;
  /** Upper bound on the acceptable land count. */
  maxLands: number;
  /** Actual land count in the deck. */
  actualLands: number;
  /** `actualLands - recommendedLands`. Positive = over, negative = under. */
  landDelta: number;
  /** Short prose assessment of the land count ("within range", "add 2", ...). */
  landAssessment: string;
  /** Per-CMC-bucket over/under-loaded status vs the archetype target. */
  bucketStatus: CurveBucketStatus[];
  /** Concrete suggestions ("add 2 1-drops", "cut 1 5-drop"). */
  actions: string[];
  /** One-sentence summary for the coach prompt and the UI. */
  summary: string;
}

/** The full structured analysis handed to the coach. */
export interface StructuredDeckAnalysis {
  archetype: string;
  secondaryArchetype?: string;
  archetypeConfidence: number;
  colorIdentity: string[];
  totalCards: number;
  averageCmc: number;
  manaCurve: number[];
  curveAssessment: string;
  roleDistribution: RoleDistribution;
  synergyClusters: SynergyCluster[];
  gaps: string[];
  strengths: string[];
  keyCards: KeyCard[];
  /**
   * Actionable mana-curve + land-count recommendation block (issue #1239).
   * Always present so downstream consumers can rely on it.
   */
  curveRecommendation: CurveRecommendation;
}

const MAX_SYNERGY_CLUSTERS = 5;
const MAX_KEY_CARDS = 8;
const MANA_CURVE_BUCKETS = 8; // indices 0..7 where 7 == "7+"

/**
 * Classify a card into a functional role based on its type line, keywords and
 * oracle text. The first matching role wins; lands are handled by the caller.
 *
 * Exported (issue #1076) so the per-matchup sideboard planner can reuse the
 * SAME role taxonomy instead of inventing its own.
 */
export function classifyRole(card: DeckCard): keyof RoleDistribution {
  const type = (card.type_line || "").toLowerCase();
  const text = `${card.name} ${card.oracle_text || ""}`.toLowerCase();

  if (type.includes("land")) return "lands";

  // Removal
  if (
    /(destroy|exile|damage to.*creature|-[0-9]+\/-[0-9]+|deals .* damage|kill)/.test(
      text,
    ) &&
    type.includes("creature") === false
  ) {
    if (/creature|permanent/.test(text)) return "removal";
  }
  if (/(destroy|exile).*creature/.test(text)) return "removal";

  // Counterspells / hand disruption
  if (/counter target spell|counter .* spell/.test(text)) return "disruption";
  if (/target (player|opponent) discards|look at .* hand/.test(text))
    return "disruption";

  // Ramp
  if (
    /search your library for .* land|add .* mana|add one mana of any color|ramp/.test(
      text,
    ) ||
    type.includes("land")
  ) {
    if (/add .* mana|search your library for .* land/.test(text)) return "ramp";
  }

  // Card draw
  if (
    /draw (a card|[0-9]+ cards|two cards|three cards)|draw cards equal to/.test(
      text,
    )
  )
    return "cardDraw";

  // Creatures & planeswalkers are threats
  if (type.includes("creature") || type.includes("planeswalker"))
    return "threats";

  return "other";
}

function buildRoleDistribution(
  deck: DeckCard[],
  stats: DeckStats,
): RoleDistribution {
  const dist: RoleDistribution = {
    threats: 0,
    ramp: 0,
    removal: 0,
    cardDraw: 0,
    disruption: 0,
    lands: stats.landCount,
    other: 0,
  };

  for (const card of deck) {
    if ((card.type_line || "").toLowerCase().includes("land")) continue;
    const role = classifyRole(card);
    dist[role] += card.count;
  }

  return dist;
}

function assessCurve(
  manaCurve: number[],
  creatureCount: number,
  totalNonLand: number,
): string {
  if (totalNonLand === 0) return "No non-land cards to evaluate.";
  // Weighted average CMC from the curve buckets (0..6, 7+ counted as 7).
  let weighted = 0;
  for (let i = 0; i < manaCurve.length; i++) {
    weighted += manaCurve[i] * Math.min(i, 7);
  }
  const avg = weighted / Math.max(totalNonLand, 1);

  if (avg <= 1.8) return "Very low / aggressive — front-loaded to win early.";
  if (avg <= 2.6) return "Low — fast, curves out quickly.";
  if (avg <= 3.5) return "Balanced midrange curve.";
  if (avg <= 4.5) return "Top-heavy — leans on the late game.";
  return "Very high / slow — risks falling behind aggressive decks.";
}

function deriveStrengthsAndGaps(
  stats: DeckStats,
  roles: RoleDistribution,
  synergies: SynergyResult[],
  missing: MissingSynergy[],
): { strengths: string[]; gaps: string[] } {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const nonLand = Math.max(stats.totalCards - stats.landCount, 1);

  // Synergy density
  if (synergies.length >= 2) {
    strengths.push(
      `Coherent plan: ${synergies.length} identifiable synergy cluster(s) (${synergies
        .slice(0, 3)
        .map((s) => s.name)
        .join(", ")}).`,
    );
  } else if (synergies.length === 0) {
    gaps.push(
      "No strong synergy clusters detected — cards may not compound each other.",
    );
  }

  // Ramp
  if (roles.ramp >= 6)
    strengths.push(
      `Strong ramp package (${roles.ramp} ramp sources) enables early big plays.`,
    );
  else if (roles.ramp < 3 && stats.avgCmc > 3)
    gaps.push(
      `Little ramp (${roles.ramp}) for a ${stats.avgCmc.toFixed(1)} avg CMC deck — likely too slow.`,
    );

  // Removal
  if (roles.removal >= 6)
    strengths.push(`Healthy removal density (${roles.removal} answers).`);
  else if (roles.removal < 3)
    gaps.push(
      `Light on interaction (${roles.removal} removal spells) — struggles vs opposing threats.`,
    );

  // Card draw
  if (roles.cardDraw >= 5)
    strengths.push(
      `Good card-draw engine (${roles.cardDraw} sources) to refuel.`,
    );
  else if (roles.cardDraw < 2)
    gaps.push(`Thin card draw (${roles.cardDraw}) — may run out of gas.`);

  // Creature count
  const creaturePct = stats.creatureCount / nonLand;
  if (creaturePct >= 0.5)
    strengths.push(
      `Dense creature base (${Math.round(creaturePct * 100)}% of non-land cards).`,
    );
  else if (
    creaturePct < 0.2 &&
    synergies.every((s) => s.category !== "control")
  )
    gaps.push(
      `Few creatures (${Math.round(creaturePct * 100)}% of non-lands) — limited board presence.`,
    );

  // Land ratio
  const landPct = stats.landCount / Math.max(stats.totalCards, 1);
  if (landPct < 0.33)
    gaps.push(
      `Low land ratio (${Math.round(landPct * 100)}%) — high mana-screw risk.`,
    );
  else if (landPct >= 0.45)
    strengths.push(
      `Solid land base (${Math.round(landPct * 100)}%) for consistency.`,
    );

  // Colour balance
  const colorValues = Object.values(stats.colorDistribution);
  if (colorValues.length >= 2) {
    const dominant = Math.max(...colorValues);
    const total = colorValues.reduce((a, b) => a + b, 0) || 1;
    if (dominant / total > 0.8) {
      gaps.push(
        `Colour imbalance — one colour dominates (${Math.round((dominant / total) * 100)}%); splash may be inconsistent.`,
      );
    }
  }

  // Missing synergy suggestions
  for (const m of missing.slice(0, 3)) {
    if (m.impact === "high" || m.impact === "medium") {
      gaps.push(`${m.missing}: ${m.suggestion}`);
    }
  }

  return { strengths: strengths.slice(0, 6), gaps: gaps.slice(0, 6) };
}

function buildKeyCards(
  deck: DeckCard[],
  roles: RoleDistribution,
  synergies: SynergyResult[],
): KeyCard[] {
  const synergyCardRank: Record<string, number> = {};
  for (const s of synergies) {
    for (const name of s.cards) {
      synergyCardRank[name] = (synergyCardRank[name] || 0) + s.score;
    }
  }

  const ranked = [...deck]
    .filter((c) => !(c.type_line || "").toLowerCase().includes("land"))
    .sort((a, b) => {
      const sa = synergyCardRank[a.name] || 0;
      const sb = synergyCardRank[b.name] || 0;
      if (sb !== sa) return sb - sa;
      return b.count - a.count;
    });

  return ranked.slice(0, MAX_KEY_CARDS).map((card) => {
    const role = classifyRole(card);
    const inSynergy = synergyCardRank[card.name] !== undefined;
    const reason = inSynergy
      ? `Core to the ${synergies.find((s) => s.cards.includes(card.name))?.name ?? "main"} engine.`
      : `${role} role; ${card.count}x copies.`;
    return { name: card.name, role, reason };
  });
}

/**
 * Format a CMC bucket index as a human label.
 *
 * Index 7 represents the rolled-up "7+" bucket so the UI can render it without
 * a fake eighth slot.
 */
function bucketLabel(cmc: number): string {
  return cmc >= MANA_CURVE_BUCKETS - 1 ? `${MANA_CURVE_BUCKETS - 1}+` : `${cmc}`;
}

/**
 * Look up per-archetype mana-base data from `src/lib/anti-meta.ts` by matching
 * the coach-detected archetype name against the archetype-name field of each
 * `ManaBaseRecommendation` entry across all formats.
 *
 * The coach does not always know the deck's format (issue #1239), so we return
 * the FIRST match across formats. This is good enough for a recommendation
 * block: a "Burn" deck wants ~20 lands whether it's Modern or Standard; the
 * bucket-distribution analysis that follows uses strategy profiles that are
 * format-agnostic.
 *
 * Returns `null` when no entry matches — the caller falls back to a generic
 * strategy-based profile.
 */
function lookupArchetypeManaProfile(
  archetypeName: string,
): { rec: ManaBaseRecommendation; format: string } | null {
  if (!archetypeName || archetypeName.toLowerCase() === "unknown") return null;
  const needle = archetypeName.toLowerCase();
  const formats: Array<"standard" | "modern" | "commander"> = [
    "standard",
    "modern",
    "commander",
  ];
  for (const fmt of formats) {
    const all = getAllManaBaseRecommendations(fmt);
    const hit = all.find((r) => r.archetypeName.toLowerCase() === needle);
    if (hit) return { rec: hit, format: fmt };
  }
  return null;
}

/**
 * Choose the strategy profile (`aggro`/`midrange`/`control`/`combo`) the
 * recommendation block should target. Re-uses `mana-curve.ts`'s heuristic so
 * coach and dashboard agree on what "midrange" means.
 */
function pickStrategyProfile(archetypeName: string): {
  key: "aggro" | "midrange" | "control" | "combo";
  description: string;
} {
  const lc = (archetypeName || "").toLowerCase();
  if (
    lc.includes("aggro") ||
    lc.includes("burn") ||
    lc.includes("zoo") ||
    lc.includes("sligh")
  ) {
    return { key: "aggro", description: "low curve, win early" };
  }
  if (
    lc.includes("control") ||
    lc.includes("prison") ||
    lc.includes("draw") ||
    lc.includes("stax")
  ) {
    return { key: "control", description: "go late, win with big spells" };
  }
  if (
    lc.includes("combo") ||
    lc.includes("twin") ||
    lc.includes("storm") ||
    lc.includes("reanimator")
  ) {
    return { key: "combo", description: "execute the combo quickly" };
  }
  return { key: "midrange", description: "balance early plays with top-end" };
}

/**
 * The ideal non-land distribution per CMC bucket, derived from
 * `src/lib/mana-curve.ts` `STRATEGY_CURVES`. Inlined so the coach's
 * recommendation logic does not add a runtime dependency on the dashboard's
 * mana-curve module — and so it stays trivially testable.
 *
 * Values are normalised to a 20-non-land-card deck so they can be scaled to
 * the actual deck size with a single multiply.
 */
const IDEAL_DISTRIBUTION: Record<
  "aggro" | "midrange" | "control" | "combo",
  number[]
> = {
  // indices 0..7 representing CMC 0..7 (where 7 = "7+").
  // CMC 0 is included for shape-completeness but should remain 0 (no 0-CMC
  // non-land spells in any of the standard profiles).
  aggro: [0, 8, 6, 3, 1, 0, 0, 0],
  midrange: [0, 4, 6, 5, 3, 2, 1, 1],
  control: [0, 2, 4, 4, 5, 4, 3, 2],
  combo: [0, 4, 5, 3, 2, 2, 2, 2],
};

/**
 * How aggressively to flag a bucket as over- or under-loaded. A delta of
 * `BUCKET_TOLERANCE` cards in either direction still counts as "balanced" —
 * smaller differences are not worth a coach suggestion.
 */
const BUCKET_TOLERANCE = 2;

/**
 * How many cards a bucket can differ from the recommended LAND COUNT before
 * we say the deck is "off" the archetype target. ±1 is normal variance.
 */
const LAND_TOLERANCE = 1;

/**
 * Build the {@link CurveRecommendation} block (issue #1239).
 *
 * Two sources of truth feed the recommendation:
 *
 *  1. Per-archetype mana-base data from `src/lib/anti-meta.ts` (preferred).
 *     Provides a specific `recommendedLands` + `minLands`/`maxLands` range
 *     when we recognise the detected archetype name in any format.
 *
 *  2. The generic strategy curve profile from `src/lib/mana-curve.ts`
 *     (`aggro` / `midrange` / `control` / `combo`). Provides the per-bucket
 *     ideal distribution and the fallback land-count formula when no
 *     archetype-specific data exists.
 *
 * The output is the actionable coaching block the prompt + UI consume:
 * concrete land-count delta, per-bucket over/under status, and a short list
 * of "add N 1-drop" / "cut M 5-drop" style actions.
 */
export function buildCurveRecommendation(
  deck: DeckCard[],
  components: ResolvedAnalysisComponents,
): CurveRecommendation {
  const safeDeck = Array.isArray(deck) ? deck : [];
  const { archetype, stats } = components;
  const archetypeName = archetype.primary || "Unknown";

  // Ensure we have 8 buckets available even when the upstream stats array is
  // shorter, so the bucket loop is unconditional.
  const curveBuckets = (stats.manaCurve || []).slice(0, MANA_CURVE_BUCKETS);
  while (curveBuckets.length < MANA_CURVE_BUCKETS) curveBuckets.push(0);

  const actualLands = stats.landCount || 0;
  const totalCards = stats.totalCards || 0;
  const nonLandCount = Math.max(totalCards - actualLands, 0);

  const archetypeHit = lookupArchetypeManaProfile(archetypeName);
  const strategy = pickStrategyProfile(archetypeName);
  const idealBuckets = IDEAL_DISTRIBUTION[strategy.key];

  // Land-count math: prefer the archetype-specific value, fall back to a
  // formula on the strategy profile.
  let recommendedLands: number;
  let minLands: number;
  let maxLands: number;
  let source: "archetype" | "strategy";

  if (archetypeHit) {
    const r = archetypeHit.rec;
    recommendedLands = r.recommendedLands;
    minLands = r.manaCurve.minLands;
    maxLands = r.manaCurve.maxLands;
    source = "archetype";
  } else {
    // Generic formula, mirroring `getLandCountRecommendations` in mana-curve.ts
    // but kept here so the coach has no module-level coupling to the dashboard.
    const avg = stats.avgCmc || 0;
    let base: number;
    let reasoning: string;
    if (avg < 2.0) {
      base = Math.min(20, Math.floor(totalCards * 0.2));
      reasoning = "low curve aggro — fewer lands needed";
    } else if (avg < 3.0) {
      base = Math.floor(totalCards * 0.23);
      reasoning = "aggro-midrange — standard land count";
    } else if (avg < 4.0) {
      base = Math.floor(totalCards * 0.25);
      reasoning = "midrange — more lands for bigger spells";
    } else {
      base = Math.min(30, Math.floor(totalCards * 0.28));
      reasoning = "control — lands for expensive spells";
    }
    if (strategy.key === "aggro") base = Math.min(20, base);
    if (strategy.key === "control") base = Math.max(24, base);
    // Final clamp ensures the +/- 2 range stays inside the global bounds
    // (17–35). Without this, a tiny `base` (e.g. 13 from a 60-card aggro
    // midrange) yields minLands=17, maxLands=15 — an impossible range.
    recommendedLands = Math.max(17, Math.min(35, base));
    minLands = Math.max(17, recommendedLands - 2);
    maxLands = Math.min(35, recommendedLands + 2);
    source = "strategy";
    // `reasoning` is exposed via `landAssessment` below so we don't store it.
    void reasoning;
  }

  // Land-count assessment prose.
  const landDelta = actualLands - recommendedLands;
  let landAssessment: string;
  if (actualLands >= minLands && actualLands <= maxLands) {
    landAssessment = `Land count within archetype range (${minLands}–${maxLands}).`;
  } else if (landDelta < 0) {
    const need = Math.abs(landDelta);
    landAssessment = `Add ${need} land${need === 1 ? "" : "s"} to hit ${recommendedLands} for this archetype (target ${minLands}–${maxLands}).`;
  } else {
    const cut = landDelta;
    landAssessment = `Cut ${cut} land${cut === 1 ? "" : "s"} to hit ${recommendedLands} for this archetype (target ${minLands}–${maxLands}).`;
  }

  // Per-bucket analysis vs the ideal distribution (non-land cards only).
  // Scale the ideal (which is normalised to 20 non-lands) up to the actual
  // non-land count. Round to the nearest integer so the comparison stays
  // integer-friendly.
  const scale = nonLandCount > 0 ? nonLandCount / 20 : 0;
  const bucketStatus: CurveBucketStatus[] = [];
  const actions: string[] = [];

  for (let i = 0; i < MANA_CURVE_BUCKETS; i++) {
    const label = bucketLabel(i);
    const isLandBucket = i === 0;
    const actual = curveBuckets[i] || 0;
    if (isLandBucket) {
      // Lands are tracked at bucket 0 by `calculateDeckStats`. We render them
      // as a row but mark `status: "lands"` so the UI knows not to show an
      // add/cut suggestion for them.
      bucketStatus.push({
        cmc: i,
        label,
        actual,
        target: 0,
        delta: actual,
        status: "lands",
        advice: null,
      });
      continue;
    }

    const target = Math.round((idealBuckets[i] || 0) * scale);
    const delta = actual - target;
    let status: CurveBucketStatus["status"] = "balanced";
    let advice: string | null = null;

    if (delta > BUCKET_TOLERANCE) {
      status = "over";
      advice = `cut ${delta} ${label}-drop${delta === 1 ? "" : "s"}`;
      actions.push(`Cut ${delta} ${label}-drop${delta === 1 ? "" : "s"}.`);
    } else if (delta < -BUCKET_TOLERANCE) {
      status = "under";
      const need = Math.abs(delta);
      advice = `add ${need} ${label}-drop${need === 1 ? "" : "s"}`;
      actions.push(`Add ${need} ${label}-drop${need === 1 ? "" : "s"}.`);
    }

    bucketStatus.push({
      cmc: i,
      label,
      actual,
      target,
      delta,
      status,
      advice,
    });
  }

  // Push the land-count delta as a top-priority action so it isn't lost in the
  // per-bucket noise.
  if (Math.abs(landDelta) > LAND_TOLERANCE) {
    const verb = landDelta < 0 ? "Add" : "Cut";
    const n = Math.abs(landDelta);
    actions.unshift(
      `${verb} ${n} land${n === 1 ? "" : "s"} to reach ${recommendedLands} (target for ${archetypeName}).`,
    );
  }

  // Trim the action list so the prompt doesn't drown in marginal suggestions.
  const trimmedActions = actions.slice(0, 6);

  // One-sentence summary suitable for the prompt + the UI title.
  let summary: string;
  if (nonLandCount === 0) {
    summary = "No non-land cards to compare against the archetype curve.";
  } else if (
    Math.abs(landDelta) <= LAND_TOLERANCE &&
    bucketStatus.filter((b) => b.status === "over" || b.status === "under")
      .length === 0
  ) {
    summary = `Curve matches the ${archetypeName} target (${recommendedLands} lands).`;
  } else {
    const issueCount =
      bucketStatus.filter(
        (b) => b.status === "over" || b.status === "under",
      ).length + (Math.abs(landDelta) > LAND_TOLERANCE ? 1 : 0);
    summary = `${issueCount} curve adjustment${issueCount === 1 ? "" : "s"} suggested for ${archetypeName} (target ${recommendedLands} lands).`;
  }

  return {
    archetypeTarget: archetypeName,
    source,
    recommendedLands,
    minLands,
    maxLands,
    actualLands,
    landDelta,
    landAssessment,
    bucketStatus,
    actions: trimmedActions,
    summary,
  };
}

/**
 * The independently-computable analyses that feed a structured deck analysis.
 *
 * `archetype`, `stats` and `synergies` have NO inter-dependencies and can be
 * resolved in parallel. Only `missing` depends on `archetype.primary`.
 * Separating them here lets the context pre-fetcher (issue #928) run the
 * independent pieces concurrently and hand the results in, avoiding both
 * serial execution and duplicate work.
 */
export interface ResolvedAnalysisComponents {
  archetype: ArchetypeResult;
  stats: DeckStats;
  synergies: SynergyResult[];
  missing: MissingSynergy[];
}

/**
 * Assemble a {@link StructuredDeckAnalysis} from already-resolved analysis
 * components. Pure / synchronous — does no detection of its own. Both the
 * serial {@link buildStructuredDeckAnalysis} and the parallel context
 * pre-fetcher (issue #928) funnel through here so the assembly logic is
 * defined exactly once.
 */
export function assembleStructuredAnalysis(
  deck: DeckCard[],
  components: ResolvedAnalysisComponents,
): StructuredDeckAnalysis {
  const safeDeck = Array.isArray(deck) ? deck : [];
  const { archetype, stats, synergies, missing } = components;

  const roleDistribution = buildRoleDistribution(safeDeck, stats);
  const nonLand = Math.max(stats.totalCards - stats.landCount, 0);

  const synergyClusters: SynergyCluster[] = synergies
    .slice(0, MAX_SYNERGY_CLUSTERS)
    .map((s: SynergyResult) => ({
      name: s.name,
      category: s.category,
      score: s.score,
      cards: s.cards,
      description: s.description,
    }));

  const { strengths, gaps } = deriveStrengthsAndGaps(
    stats,
    roleDistribution,
    synergies,
    missing,
  );
  const keyCards = buildKeyCards(safeDeck, roleDistribution, synergies);

  const curveBuckets = stats.manaCurve.slice(0, MANA_CURVE_BUCKETS);
  while (curveBuckets.length < MANA_CURVE_BUCKETS) curveBuckets.push(0);

  // Actionable curve + land-count recommendation (issue #1239). Always
  // present so downstream consumers (coach prompt, UI) can rely on the
  // shape without optional chaining.
  const curveRecommendation = buildCurveRecommendation(safeDeck, components);

  return {
    archetype: archetype.primary,
    secondaryArchetype: archetype.secondary,
    archetypeConfidence: archetype.confidence,
    colorIdentity: Object.keys(stats.colorDistribution),
    totalCards: stats.totalCards,
    averageCmc: Number(stats.avgCmc.toFixed(2)),
    manaCurve: curveBuckets,
    curveAssessment: assessCurve(curveBuckets, stats.creatureCount, nonLand),
    roleDistribution,
    synergyClusters,
    gaps,
    strengths,
    keyCards,
    curveRecommendation,
  };
}

/**
 * Resolve the four underlying analyses SERIALLY. Kept for synchronous callers
 * and backward compatibility. New, latency-sensitive callers should use the
 * context pre-fetcher in `./coach-context-prefetch` (issue #928), which
 * resolves the independent pieces in parallel and caches the result.
 *
 * Synergy detection runs through the AI Web Worker bridge (`issue #1079`) so
 * the CPU-heavy scoring is offloaded off the main thread, with an identical
 * main-thread fallback if the worker is unavailable. This makes the function
 * async — callers must `await` it.
 */
export async function buildStructuredDeckAnalysis(
  deck: DeckCard[],
): Promise<StructuredDeckAnalysis> {
  const safeDeck = Array.isArray(deck) ? deck : [];

  const archetype = detectArchetype(safeDeck);
  const stats = calculateDeckStats(safeDeck);
  const synergies = await detectSynergiesAsync(safeDeck);
  const missing = detectMissingSynergies(safeDeck, archetype.primary);

  return assembleStructuredAnalysis(safeDeck, {
    archetype,
    stats,
    synergies,
    missing,
  });
}

/**
 * Render a StructuredDeckAnalysis as a compact, LLM-friendly markdown block.
 * This is what the coach prompt receives INSTEAD of a raw card-by-card list.
 */
export function formatStructuredAnalysisForLLM(
  a: StructuredDeckAnalysis,
): string {
  if (!a) return "";

  const lines: string[] = ["### Structured Deck Analysis"];

  lines.push(
    `**Archetype**: ${a.archetype}${a.secondaryArchetype ? ` (secondary: ${a.secondaryArchetype})` : ""} — confidence ${Math.round(a.archetypeConfidence * 100)}%`,
  );
  lines.push(
    `**Colours**: ${a.colorIdentity.length ? a.colorIdentity.join("/") : "—"} | **${a.totalCards} cards** | **Avg CMC ${a.averageCmc.toFixed(2)}**`,
  );

  // Mana curve
  const curveLabels = a.manaCurve.map(
    (count, i) => `${i === 7 ? "7+" : i}cmc:${count}`,
  );
  lines.push(
    `**Mana Curve**: ${curveLabels.join("  ")} — _${a.curveAssessment}_`,
  );

  // Actionable curve + land-count recommendation (issue #1239). Surfaces
  // concrete land-count delta vs archetype target and per-bucket over/under
  // status so the model can give specific suggestions ("add 2 1-drops")
  // rather than only describing the curve.
  const cr = a.curveRecommendation;
  lines.push(
    `**Mana-Curve Recommendation (${cr.archetypeTarget})**: ${cr.actualLands} lands vs target ${cr.recommendedLands} (${cr.minLands}–${cr.maxLands}) — _${cr.landAssessment}_`,
  );
  const overUnder = cr.bucketStatus
    .filter((b) => b.status === "over" || b.status === "under")
    .map((b) => `${b.label}cmc:${b.actual}/${b.target} (${b.advice})`);
  if (overUnder.length > 0) {
    lines.push(`**Over/Under CMC Buckets**: ${overUnder.join("  ")}`);
  }
  if (cr.actions.length > 0) {
    lines.push("**Curve Actions**:");
    for (const action of cr.actions) lines.push(`- ${action}`);
  }

  // Role distribution
  const r = a.roleDistribution;
  lines.push(
    `**Role Mix**: Threats ${r.threats} · Ramp ${r.ramp} · Removal ${r.removal} · Draw ${r.cardDraw} · Disruption ${r.disruption} · Lands ${r.lands} · Other ${r.other}`,
  );

  // Synergy clusters
  if (a.synergyClusters.length > 0) {
    lines.push("**Synergy Clusters**:");
    for (const s of a.synergyClusters) {
      lines.push(
        `- _${s.name}_ (${s.category}, score ${s.score}): ${s.cards.slice(0, 6).join(", ")} — ${s.description}`,
      );
    }
  } else {
    lines.push("**Synergy Clusters**: none detected above threshold.");
  }

  // Key cards
  if (a.keyCards.length > 0) {
    lines.push("**Key Cards**:");
    for (const k of a.keyCards) {
      lines.push(`- ${k.name} [${k.role}] — ${k.reason}`);
    }
  }

  // Strengths & gaps
  if (a.strengths.length > 0) {
    lines.push("**Strengths**:");
    for (const s of a.strengths) lines.push(`- ${s}`);
  }
  if (a.gaps.length > 0) {
    lines.push("**Gaps / Improvement Targets**:");
    for (const g of a.gaps) lines.push(`- ${g}`);
  }

  return lines.join("\n");
}

/* -----------------------------------------------------------------------------
 * Deck-signature LRU cache (issue #1237).
 *
 * The conversational coach route (#928 → `src/app/api/chat/coach/route.ts`)
 * calls `buildStructuredDeckAnalysis` + `formatStructuredAnalysisForLLM` on
 * every chat message. Both pipelines run `detectArchetype`,
 * `calculateDeckStats`, `detectSynergies`, and `detectMissingSynergies` —
 * all heavy — even though the deck does not change across a multi-turn
 * conversation. A long coaching session over a fixed deck therefore
 * recomputes identical analysis dozens of times.
 *
 * This block adds a small LRU keyed by a STABLE deck signature so that:
 *   - identical decks (regardless of card ordering) share one cache entry
 *   - the cache is BOUNDED (16 entries, LRU eviction) so long-lived sessions
 *     across many decks cannot leak memory
 *   - `route.ts` (via `prefetchCoachContext`) consults the LRU before
 *     rebuilding the analysis, cutting the dominant recompute cost on
 *     repeat turns
 *
 * Signature algorithm: 32-bit `djb2` over the lexicographically-sorted list
 * `name:count|…|name:count`. djb2 was chosen (over a heavier hash) because it
 * is O(n) in deck size, allocation-free, and produces a fixed-width hex key —
 * bounded even for 99-card Commander decks. Collisions on distinct decks are
 * vanishingly unlikely at <2^32 signatures, and a colliding signature would
 * still yield a *correct* analysis (we re-run the builder on miss and
 * cache-stomp); the cache only loses a hit, never correctness.
 * --------------------------------------------------------------------------- */

/** Maximum number of distinct deck signatures kept warm in the LRU. */
export const DECK_ANALYSIS_LRU_MAX_ENTRIES = 16;

/**
 * TTL for cached deck analyses. Long enough to span a normal coaching
 * conversation (turns typically arrive seconds-to-minutes apart), short
 * enough that a deck viewed an hour ago does not poison a fresh analysis
 * without explicit invalidation.
 */
export const DECK_ANALYSIS_CACHE_TTL_MS = 5 * 60_000;

/** One LRU slot. `lastAccess` is bumped on read AND write so the LRU prefers
 *  decks the active coaching session keeps touching. */
interface DeckAnalysisCacheEntry {
  signature: string;
  value: StructuredDeckAnalysis;
  expiresAt: number;
  lastAccess: number;
}

/**
 * LRU keyed by deck signature. Backed by `Map` whose JavaScript spec
 * guarantees insertion-order iteration, so "delete + re-set" is enough to
 * promote an entry to the most-recently-used position.
 */
const deckAnalysisCache = new Map<string, DeckAnalysisCacheEntry>();

/** Indirection over the clock so tests can advance time deterministically. */
let deckAnalysisClock: () => number = () => Date.now();

/**
 * Stable, order-independent signature for a decklist.
 *
 * Sorts `name:count` pairs lexicographically and walks the resulting string
 * through a 32-bit `djb2` hash (issue #1237). The returned key is a
 * fixed-width `deck:xxxxxxxx` token — bounded even for 99-card Commander
 * decks, unlike the legacy sorted-join fingerprint which grows linearly.
 *
 * Empty / non-array inputs collapse to `deck:empty` so they share a key.
 */
export function computeDeckSignature(deck: ReadonlyArray<DeckCard>): string {
  if (!Array.isArray(deck) || deck.length === 0) return "deck:empty";

  const pairs: string[] = [];
  for (const card of deck) {
    if (!card || typeof card.name !== "string") continue;
    const count = Number(card.count) || 1;
    pairs.push(`${card.name}:${count}`);
  }
  if (pairs.length === 0) return "deck:empty";

  pairs.sort();

  // 32-bit djb2 (`h * 33 ^ c`) using `Math.imul` for safe 32-bit overflow.
  let h = 5381;
  const text = pairs.join("|");
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return `deck:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Look up a cached structured analysis by signature.
 *
 * Returns `undefined` on miss so callers can branch without try/catch.
 * Promotes the entry to the most-recently-used position on read. Expired
 * entries are evicted transparently.
 */
export function getCachedStructuredAnalysis(
  signature: string,
): StructuredDeckAnalysis | undefined {
  const entry = deckAnalysisCache.get(signature);
  if (!entry) return undefined;
  const now = deckAnalysisClock();
  if (entry.expiresAt <= now) {
    deckAnalysisCache.delete(signature);
    return undefined;
  }
  // LRU touch: re-insert to move to the back of the insertion order.
  entry.lastAccess = now;
  deckAnalysisCache.delete(signature);
  deckAnalysisCache.set(signature, entry);
  return entry.value;
}

/**
 * Store a structured analysis under its deck signature. Promotes the entry
 * to the most-recently-used position and evicts the LRU until the cache is
 * within the size bound.
 */
export function setCachedStructuredAnalysis(
  signature: string,
  value: StructuredDeckAnalysis,
  ttlMs: number = DECK_ANALYSIS_CACHE_TTL_MS,
): void {
  const now = deckAnalysisClock();
  // Re-set promotes overwrite to MRU.
  if (deckAnalysisCache.has(signature)) {
    deckAnalysisCache.delete(signature);
  }
  deckAnalysisCache.set(signature, {
    signature,
    value,
    expiresAt: now + ttlMs,
    lastAccess: now,
  });
  while (deckAnalysisCache.size > DECK_ANALYSIS_LRU_MAX_ENTRIES) {
    const oldestKey = deckAnalysisCache.keys().next().value;
    if (oldestKey === undefined) break;
    deckAnalysisCache.delete(oldestKey);
  }
}

/**
 * Resolve the structured analysis for a deck, returning a cached copy when
 * the signature matches an LRU entry and otherwise computing + caching it.
 *
 * This is the public, route-friendly entry point that satisfies issue
 * #1237's acceptance criterion: "Repeated requests with an identical deck
 * reuse cached structured analysis (assert builder invoked once across N
 * turns)". The format-scoping in `prefetchCoachContext` still applies on
 * top — this function keys by deck signature alone.
 */
export async function getOrBuildStructuredAnalysis(
  deck: ReadonlyArray<DeckCard>,
): Promise<StructuredDeckAnalysis> {
  const safeDeck = Array.isArray(deck) ? deck : [];
  const signature = computeDeckSignature(safeDeck);

  const cached = getCachedStructuredAnalysis(signature);
  if (cached) return cached;

  const analysis = await buildStructuredDeckAnalysis(safeDeck);
  setCachedStructuredAnalysis(signature, analysis);
  return analysis;
}

/** Clear the LRU cache. Intended for tests and explicit resets. */
export function clearDeckAnalysisCache(): void {
  deckAnalysisCache.clear();
}

/** @internal Replace the clock used for TTL evaluation (tests only). */
export function _setDeckAnalysisClock(fn: () => number): () => void {
  const prev = deckAnalysisClock;
  deckAnalysisClock = fn;
  return () => {
    deckAnalysisClock = prev;
  };
}

/** @internal Inspect live cache size (tests/telemetry only). */
export function _deckAnalysisCacheSize(): number {
  return deckAnalysisCache.size;
}
