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
}

const MAX_SYNERGY_CLUSTERS = 5;
const MAX_KEY_CARDS = 8;
const MANA_CURVE_BUCKETS = 8; // indices 0..7 where 7 == "7+"

/**
 * Classify a card into a functional role based on its type line, keywords and
 * oracle text. The first matching role wins; lands are handled by the caller.
 */
function classifyRole(card: DeckCard): keyof RoleDistribution {
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
