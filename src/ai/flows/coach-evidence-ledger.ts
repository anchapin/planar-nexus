/**
 * @fileOverview Evidence ledger for the conversational AI coach (issue #1419).
 *
 * Card-name hallucinations are guarded by the local citation verifier
 * (`verify-citations.ts`, issue #1072). NON-card claims — about the deck's
 * curve, role mix, win conditions, matchup profile, or synergy gaps — slip
 * past that verifier because they sound plausible and never touch the local
 * card database. This module is the deterministic grounding layer for those
 * factual deck claims.
 *
 * The ledger is built from three sources (in priority order):
 *
 *   1. The structured deck analysis (`StructuredDeckAnalysis` from
 *      `coach-deck-analysis.ts`) — primary source for curve, role mix,
 *      synergy clusters, strengths, gaps, key cards. Always preferred when
 *      available because the analysers are deterministic and already cached.
 *   2. The digested context shipped by the AI worker for large/Commander
 *      decks (`DigestedCoachContext`). Used as a fallback when no structured
 *      analysis is present (small-deck digest path).
 *   3. The latest user turn — never carries factual deck data, but it lets
 *      the ledger note "user asked about X" so the prompt can instruct the
 *      model to ground only X-related claims.
 *
 * The output is a compact list of {@link EvidenceEntry} records, each with a
 * STABLE id (e.g. `curve-lands`, `role-threats`) so the model can cite
 * `[E:curve-lands]` after a factual claim and the post-generation guard can
 * verify the citation deterministically.
 *
 * Design constraints:
 *   - **Deterministic** — same analysis in ⇒ same ledger out. No LLM call.
 *   - **Cheap** — O(deck size) via the structured analysis already computed.
 *   - **Bounded** — at most a few dozen entries even for 100-card decks.
 *   - **Zod-validated** — the ledger is produced and consumed across module
 *     boundaries; the schema is the contract.
 */

import { z } from "zod";
import type { StructuredDeckAnalysis } from "./coach-deck-analysis";

/**
 * The categories of factual deck claims the ledger can ground. Mirrors the
 * acceptance criteria of issue #1419: curve, role mix, strengths, gaps,
 * synergies, win conditions, matchup/meta facts.
 *
 * `insufficient` is the catch-all for claim types the structured analysis
 * cannot currently support (notably matchup / meta). When the ONLY available
 * evidence for a category is `insufficient`, the prompt instructs the model
 * to say the context is insufficient rather than assert a fact.
 */
export const EVIDENCE_CATEGORIES = [
  "curve",
  "roleMix",
  "winCondition",
  "synergy",
  "strength",
  "gap",
  "matchup",
  "meta",
  "insufficient",
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/**
 * Numeric fact exposed by an evidence entry. The post-generation guard
 * extracts numeric claims from the assistant message ("you have 24 lands",
 * "avg CMC is 3.5", "12 threats") and compares them to these values
 * deterministically — see `coach-grounding-guard.ts`.
 *
 * `tolerance` is the absolute delta allowed before a numeric claim is flagged
 * as contradicted (e.g. ±1 for land counts, ±0.2 for average CMC).
 */
export interface NumericFact {
  /** Stable key, e.g. `lands`, `avgCmc`, `threats`. */
  key: string;
  /** Human label, e.g. "land count". */
  label: string;
  /** The numeric value from the structured analysis. */
  value: number;
  /** Absolute tolerance before a contradiction is flagged. */
  tolerance: number;
}

/**
 * A single evidence entry the model can cite (`[E:<id>]`) and the guard can
 * verify against. Numeric facts let the guard validate quantitative claims
 * even when the model omits the tag.
 */
export interface EvidenceEntry {
  /** Stable identifier, e.g. `curve-lands`, `role-threats`. */
  id: string;
  /** Claim category (drives prompt grouping + guard routing). */
  category: EvidenceCategory;
  /** Short human summary of the fact, suitable for prompt injection. */
  summary: string;
  /** Numeric facts the guard can validate against (optional). */
  numericFacts?: ReadonlyArray<NumericFact>;
  /**
   * Categorical values the guard can validate against (e.g. archetype name,
   * detected win-condition card names). Each entry is a lowercased canonical
   * token; the guard treats the message as grounded if it contains any
   * token from this list when making a categorical claim in this category.
   */
  categoricalFacts?: ReadonlyArray<string>;
}

/**
 * Zod schema for a single {@link EvidenceEntry}. Used to validate the ledger
 * at module boundaries (production build, future cross-worker transport).
 */
export const NumericFactSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().finite(),
  tolerance: z.number().finite().nonnegative(),
});

export const EvidenceEntrySchema = z.object({
  id: z.string().min(1),
  category: z.enum(EVIDENCE_CATEGORIES),
  summary: z.string().min(1),
  numericFacts: z.array(NumericFactSchema).optional(),
  categoricalFacts: z.array(z.string()).optional(),
});

/**
 * Zod schema for the full {@link EvidenceLedger}. The `checksum` is a stable
 * short hash of the entry ids + values so two ledgers built from the same
 * analysis are structurally equal (useful for cache keys / equality asserts
 * in tests).
 */
export const EvidenceLedgerSchema = z.object({
  entries: z.array(EvidenceEntrySchema),
  checksum: z.string(),
  /** Categories where the analysis cannot support any factual claim. */
  insufficientCategories: z.array(z.enum(EVIDENCE_CATEGORIES)),
});

export interface EvidenceLedger {
  entries: ReadonlyArray<EvidenceEntry>;
  checksum: string;
  insufficientCategories: ReadonlyArray<EvidenceCategory>;
}

/**
 * Subset of {@link StructuredDeckAnalysis} fields the ledger reads. Defining
 * it as an interface (rather than importing the whole type) keeps this module
 * decoupled from incidental analysis-shape changes and lets tests build a
 * minimal fixture without constructing the full structure.
 */
export interface AnalysisSource {
  archetype: string;
  secondaryArchetype?: string;
  totalCards: number;
  averageCmc: number;
  manaCurve: number[];
  roleDistribution: {
    threats: number;
    ramp: number;
    removal: number;
    cardDraw: number;
    disruption: number;
    lands: number;
    other: number;
  };
  synergyClusters: Array<{
    name: string;
    category: string;
    score: number;
    cards: string[];
    description: string;
  }>;
  gaps: string[];
  strengths: string[];
  keyCards: Array<{ name: string; role: string; reason: string }>;
  curveRecommendation: {
    archetypeTarget: string;
    recommendedLands: number;
    minLands: number;
    maxLands: number;
    actualLands: number;
    landDelta: number;
  };
}

/**
 * Minimal view of `DigestedCoachContext` (the worker-produced digest) the
 * ledger can fall back on when no full structured analysis is available.
 * Field names mirror `formatDigestedContextForLLM` in `context-builder.ts`.
 */
export interface DigestedContextSource {
  deckSummary?: {
    totalCards?: number;
    averageCmc?: number;
    manaCurve?: number[];
    colors?: string[];
    keyCards?: string[];
    typeCounts?: Record<string, number>;
  };
  /**
   * The structured-analysis text carried through the digest path
   * (`structuredAnalysisText` on `DigestedCoachContext`). When present, the
   * ledger surfaces an `analysis-text` entry so the model knows the
   * grounding is verbatim text rather than structured facts.
   */
  structuredAnalysisText?: string;
}

/** Inputs to {@link buildEvidenceLedger}. */
export interface EvidenceLedgerInputs {
  /** Primary source — full structured analysis. Optional but preferred. */
  analysis?: AnalysisSource | null;
  /** Fallback source — digest carried by the worker for large decks. */
  digestedContext?: DigestedContextSource | null;
  /** Latest user turn (sanitized). Used only to mark "insufficient" categories. */
  userTurn?: string;
}

/**
 * Build a stable short checksum from the ledger entries so two ledgers built
 * from the same inputs compare equal. Uses a 32-bit `djb2` over the entry
 * ids + primary numeric value, mirroring the deck-signature approach in
 * `coach-deck-analysis.ts` for consistency.
 */
function ledgerChecksum(entries: ReadonlyArray<EvidenceEntry>): string {
  let h = 5381;
  const text = entries
    .map((e) => {
      const nums = (e.numericFacts ?? [])
        .map((n) => `${n.key}=${n.value}`)
        .join(",");
      const cats = (e.categoricalFacts ?? []).join(",");
      return `${e.id}|${e.category}|${nums}|${cats}`;
    })
    .join("||");
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return `ev:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Build the curve entries from a structured analysis: land count, average
 * CMC, and per-bucket counts. Always emitted when an analysis is available
 * because numeric curve claims ("you have 24 lands") are the most common
 * ungrounded assertion the guard sees.
 */
function buildCurveEntries(analysis: AnalysisSource): Array<EvidenceEntry> {
  const entries: Array<EvidenceEntry> = [];
  const cr = analysis.curveRecommendation;

  entries.push({
    id: "curve-lands",
    category: "curve",
    summary: `Land count: ${cr.actualLands} (target ${cr.recommendedLands}, range ${cr.minLands}–${cr.maxLands}).`,
    numericFacts: [
      {
        key: "lands",
        label: "land count",
        value: cr.actualLands,
        tolerance: 1,
      },
      {
        key: "recommendedLands",
        label: "recommended land count",
        value: cr.recommendedLands,
        tolerance: 1,
      },
    ],
  });

  entries.push({
    id: "curve-avgcmc",
    category: "curve",
    summary: `Average CMC ${analysis.averageCmc.toFixed(2)}.`,
    numericFacts: [
      {
        key: "avgCmc",
        label: "average CMC",
        value: analysis.averageCmc,
        tolerance: 0.2,
      },
    ],
  });

  // Per-bucket counts. Indices 0..7 mirror `manaCurve` (7 == "7+").
  const bucketLabels = ["0", "1", "2", "3", "4", "5", "6", "7+"];
  const bucketParts: string[] = [];
  const numericFacts: NumericFact[] = [];
  for (
    let i = 0;
    i < analysis.manaCurve.length && i < bucketLabels.length;
    i++
  ) {
    const count = analysis.manaCurve[i] ?? 0;
    bucketParts.push(`${bucketLabels[i]}cmc:${count}`);
    numericFacts.push({
      key: `bucket-${i}`,
      label: `${bucketLabels[i]}-cmc cards`,
      value: count,
      tolerance: 1,
    });
  }
  entries.push({
    id: "curve-buckets",
    category: "curve",
    summary: `Mana curve — ${bucketParts.join("  ")}.`,
    numericFacts,
  });

  entries.push({
    id: "curve-total",
    category: "curve",
    summary: `Total cards: ${analysis.totalCards}.`,
    numericFacts: [
      {
        key: "totalCards",
        label: "total card count",
        value: analysis.totalCards,
        tolerance: 1,
      },
    ],
  });

  return entries;
}

/**
 * Build the role-mix entry from a structured analysis. Mirrors the role
 * taxonomy in `coach-deck-analysis.ts` so the guard can validate "you have
 * N threats" style claims against the same numbers the prompt advertised.
 */
function buildRoleMixEntries(analysis: AnalysisSource): Array<EvidenceEntry> {
  const r = analysis.roleDistribution;
  const parts: string[] = [
    `Threats ${r.threats}`,
    `Ramp ${r.ramp}`,
    `Removal ${r.removal}`,
    `Draw ${r.cardDraw}`,
    `Disruption ${r.disruption}`,
    `Lands ${r.lands}`,
    `Other ${r.other}`,
  ];

  return [
    {
      id: "role-mix",
      category: "roleMix",
      summary: `Role mix — ${parts.join(" · ")}.`,
      numericFacts: [
        { key: "threats", label: "threats", value: r.threats, tolerance: 1 },
        { key: "ramp", label: "ramp sources", value: r.ramp, tolerance: 1 },
        {
          key: "removal",
          label: "removal spells",
          value: r.removal,
          tolerance: 1,
        },
        {
          key: "cardDraw",
          label: "card-draw sources",
          value: r.cardDraw,
          tolerance: 1,
        },
        {
          key: "disruption",
          label: "disruption spells",
          value: r.disruption,
          tolerance: 1,
        },
      ],
    },
  ];
}

/**
 * Build win-condition entries. The structured analysis does not have an
 * explicit `winConditions` field; we derive them from the key threats +
 * primary archetype + synergy clusters so the guard can validate "your deck
 * wins by X" claims against an evidence-backed list.
 */
function buildWinConditionEntries(
  analysis: AnalysisSource,
): Array<EvidenceEntry> {
  const threatCards = analysis.keyCards
    .filter((k) => k.role === "threats")
    .map((k) => k.name);
  const finishers = threatCards.slice(0, 4);
  const synergies = analysis.synergyClusters.slice(0, 2).map((s) => s.name);

  const categorical = [
    analysis.archetype.toLowerCase(),
    ...(analysis.secondaryArchetype
      ? [analysis.secondaryArchetype.toLowerCase()]
      : []),
    ...finishers.map((n) => n.toLowerCase()),
    ...synergies.map((s) => s.toLowerCase()),
  ];

  if (finishers.length === 0 && synergies.length === 0) {
    return [
      {
        id: "wincondition-derived",
        category: "winCondition",
        summary: `No explicit win-condition data; archetype is "${analysis.archetype}".`,
        categoricalFacts: categorical,
      },
    ];
  }

  return [
    {
      id: "wincondition-derived",
      category: "winCondition",
      summary: `Likely win conditions derived from key threats (${finishers.join(
        ", ",
      )}) and top synergy clusters (${synergies.join(", ")}).`,
      categoricalFacts: categorical,
    },
  ];
}

/** Build synergy entries — one per cluster, capped at 5 to stay bounded. */
function buildSynergyEntries(analysis: AnalysisSource): Array<EvidenceEntry> {
  return analysis.synergyClusters.slice(0, 5).map((s, i) => ({
    id: `synergy-${i + 1}`,
    category: "synergy",
    summary: `${s.name} (${s.category}, score ${s.score}): ${s.cards.slice(0, 6).join(", ")} — ${s.description}`,
    categoricalFacts: [
      s.name.toLowerCase(),
      ...s.cards.slice(0, 6).map((c) => c.toLowerCase()),
    ],
  }));
}

/** Build strength + gap entries — one summary entry per category (bounded). */
function buildStrengthAndGapEntries(
  analysis: AnalysisSource,
): Array<EvidenceEntry> {
  const entries: Array<EvidenceEntry> = [];

  if (analysis.strengths.length > 0) {
    entries.push({
      id: "strengths-summary",
      category: "strength",
      summary: analysis.strengths
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s}`)
        .join(" "),
    });
  }
  if (analysis.gaps.length > 0) {
    entries.push({
      id: "gaps-summary",
      category: "gap",
      summary: analysis.gaps
        .slice(0, 6)
        .map((g, i) => `${i + 1}. ${g}`)
        .join(" "),
    });
  }

  return entries;
}

/**
 * Build a minimal "context only" ledger from a digested context, used on the
 * Commander / large-deck digest path when no structured analysis is present.
 * Numeric facts are emitted only for fields the digest reliably carries; the
 * model is told via the prompt that the rest of the ledger is insufficient.
 */
function buildDigestEntries(
  digest: DigestedContextSource,
): Array<EvidenceEntry> {
  const entries: Array<EvidenceEntry> = [];
  const ds = digest.deckSummary;
  if (ds) {
    if (typeof ds.totalCards === "number") {
      entries.push({
        id: "curve-total",
        category: "curve",
        summary: `Total cards: ${ds.totalCards}.`,
        numericFacts: [
          {
            key: "totalCards",
            label: "total card count",
            value: ds.totalCards,
            tolerance: 1,
          },
        ],
      });
    }
    if (typeof ds.averageCmc === "number") {
      entries.push({
        id: "curve-avgcmc",
        category: "curve",
        summary: `Average CMC ${ds.averageCmc.toFixed(2)}.`,
        numericFacts: [
          {
            key: "avgCmc",
            label: "average CMC",
            value: ds.averageCmc,
            tolerance: 0.2,
          },
        ],
      });
    }
    if (Array.isArray(ds.manaCurve)) {
      const bucketLabels = ["0", "1", "2", "3", "4", "5", "6", "7+"];
      const parts: string[] = [];
      const numericFacts: NumericFact[] = [];
      for (let i = 0; i < ds.manaCurve.length && i < bucketLabels.length; i++) {
        const v = ds.manaCurve[i] ?? 0;
        parts.push(`${bucketLabels[i]}cmc:${v}`);
        numericFacts.push({
          key: `bucket-${i}`,
          label: `${bucketLabels[i]}-cmc cards`,
          value: v,
          tolerance: 1,
        });
      }
      if (parts.length > 0) {
        entries.push({
          id: "curve-buckets",
          category: "curve",
          summary: `Mana curve — ${parts.join("  ")}.`,
          numericFacts,
        });
      }
    }
    if (Array.isArray(ds.keyCards) && ds.keyCards.length > 0) {
      entries.push({
        id: "wincondition-derived",
        category: "winCondition",
        summary: `Notable cards: ${ds.keyCards.slice(0, 8).join(", ")}.`,
        categoricalFacts: ds.keyCards.slice(0, 8).map((c) => c.toLowerCase()),
      });
    }
  }
  if (
    typeof digest.structuredAnalysisText === "string" &&
    digest.structuredAnalysisText
  ) {
    entries.push({
      id: "analysis-text",
      category: "insufficient",
      summary:
        "A structured analysis text was carried by the digest but is not parsed into discrete facts here; treat its prose as the authoritative context.",
    });
  }
  return entries;
}

/**
 * Build the evidence ledger from the supplied inputs. Deterministic: the
 * same inputs in any order produce the same ledger (the entries are emitted
 * in a fixed category order, not insertion order).
 *
 * When neither a structured analysis nor a digest is supplied the ledger is
 * empty and EVERY category is marked insufficient — the guard then flags
 * any factual deck claim as ungrounded, which is the safe behaviour.
 */
export function buildEvidenceLedger(
  inputs: EvidenceLedgerInputs,
): EvidenceLedger {
  const { analysis, digestedContext, userTurn } = inputs;
  const entries: EvidenceEntry[] = [];
  const insufficient: EvidenceCategory[] = [];

  if (analysis) {
    entries.push(...buildCurveEntries(analysis));
    entries.push(...buildRoleMixEntries(analysis));
    entries.push(...buildWinConditionEntries(analysis));
    entries.push(...buildSynergyEntries(analysis));
    entries.push(...buildStrengthAndGapEntries(analysis));
  } else if (digestedContext) {
    entries.push(...buildDigestEntries(digestedContext));
  }

  // Determine which categories have NO evidence so the prompt can tell the
  // model "do not assert facts in these categories; say context insufficient".
  const present = new Set(entries.map((e) => e.category));
  for (const cat of EVIDENCE_CATEGORIES) {
    if (cat === "insufficient") continue;
    if (!present.has(cat)) insufficient.push(cat);
  }

  // Matchup / meta are NEVER derivable from the structured analysis alone —
  // they require an external meta snapshot the coach does not have. Always
  // mark them insufficient unless the user's turn explicitly narrows the
  // question to a specific known archetype the analysis already names.
  if (!insufficient.includes("matchup")) insufficient.push("matchup");
  if (!insufficient.includes("meta")) insufficient.push("meta");

  // Stable ordering: by category first, then by id. Keeps the rendered
  // prompt deterministic so a snapshot test of the prompt does not flap.
  const categoryOrder: Record<EvidenceCategory, number> = {
    curve: 0,
    roleMix: 1,
    winCondition: 2,
    synergy: 3,
    strength: 4,
    gap: 5,
    matchup: 6,
    meta: 7,
    insufficient: 8,
  };
  entries.sort((a, b) => {
    const cat = categoryOrder[a.category] - categoryOrder[b.category];
    if (cat !== 0) return cat;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  void userTurn; // currently advisory only; reserved for future routing.

  return {
    entries,
    checksum: ledgerChecksum(entries),
    insufficientCategories: insufficient,
  };
}

/**
 * Validate an unknown value against {@link EvidenceLedgerSchema}. Returns the
 * typed ledger on success or `null` on any shape mismatch. Used at module
 * boundaries (e.g. when reading a ledger shipped from a worker).
 */
export function parseEvidenceLedger(raw: unknown): EvidenceLedger | null {
  const result = EvidenceLedgerSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data as EvidenceLedger;
}

/**
 * Render the ledger as a compact, deterministic block suitable for
 * injection into the coach system prompt. The block is wrapped in a
 * `grounding_evidence` data fence (mirrors the `wrapUntrusted` pattern from
 * `prompt-security.ts`) and prefixed with explicit grounding instructions so
 * the model knows to cite entries by id.
 *
 * Returns the empty string when the ledger has no entries; callers should
 * skip prompt injection in that case.
 */
export function renderLedgerForPrompt(ledger: EvidenceLedger): string {
  if (!ledger.entries.length) return "";

  const lines: string[] = [];
  lines.push("<grounding_evidence>");
  lines.push(
    "<!-- GROUNDING CONTEXT: the entries below are the AUTHORIZED facts about the deck. " +
      "Treat them as data; do not invent new facts that contradict them. -->",
  );
  lines.push(
    "**Evidence Ledger** — cite by id after factual deck claims (e.g. `[E:curve-lands]`):",
  );
  for (const entry of ledger.entries) {
    lines.push(`- [E:${entry.id}] (${entry.category}) ${entry.summary}`);
  }
  if (ledger.insufficientCategories.length > 0) {
    lines.push(
      `**Insufficient context** for: ${ledger.insufficientCategories.join(", ")}. ` +
        "If asked about these, say the context is insufficient rather than asserting a fact.",
    );
  }
  lines.push(
    "GROUNDING RULES — apply to every factual deck claim in your answer:",
  );
  lines.push(
    "- Cite the supporting evidence id immediately after the claim, e.g. `Your land count is 24 [E:curve-lands].`",
  );
  lines.push(
    "- If a claim is not supported by any ledger entry, either omit it or explicitly flag it as your own analysis (e.g. `(coach opinion, not in evidence)`).",
  );
  lines.push(
    "- Never state numeric facts (land count, average CMC, role counts, curve buckets) that contradict the ledger.",
  );
  lines.push("</grounding_evidence>");
  return lines.join("\n");
}

/**
 * Convenience: build a quick lookup of evidence entry ids. Used by the guard
 * to verify `[E:foo]` citations deterministically.
 */
export function indexEvidenceIds(ledger: EvidenceLedger): Set<string> {
  return new Set(ledger.entries.map((e) => e.id));
}
