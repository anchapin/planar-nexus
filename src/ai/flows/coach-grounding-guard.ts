/**
 * @fileOverview Post-generation grounding guard for the conversational coach
 * (issue #1419).
 *
 * The guard runs DETERMINISTICALLY on the completed assistant message BEFORE
 * it is persisted. It never makes an LLM call: every check is a regex/numeric
 * comparison against the {@link EvidenceLedger} built from the structured
 * analysis.
 *
 * ## What it checks
 *
 *  1. **Citation tag validity** — every `[E:<id>]` tag in the message must
 *     reference an entry id present in the ledger. Tags pointing at
 *     non-existent evidence are the most direct grounding failure.
 *  2. **Numeric contradiction** — quantitative claims about land count,
 *     average CMC, role counts (threats / ramp / removal / card draw /
 *     disruption), and curve buckets are extracted by regex and compared
 *     to the ledger's numeric facts. A claim whose value falls outside the
 *     fact's `tolerance` is flagged.
 *  3. **Insufficient-category assertion** — when the model asserts a
 *     factual claim in a category the ledger marks `insufficient` (e.g.
 *     matchup / meta without external data), the guard flags it. The match
 *     is keyword-driven (`win? rate`, `matchup`, `meta`, `folds to`, etc.)
 *     and conservative — generic advice wording is not flagged.
 *
 * ## What it does NOT check
 *
 * Card-name hallucinations — already covered by `verify-citations.ts`
 * (issue #1072). The guard deliberately stays out of that lane to avoid
 * double-flagging.
 *
 * ## Failure handling
 *
 * On any failure the guard returns a {@link GroundingVerdict} with
 * `lowConfidence: true` and a tier-specific `caveat` string. The caller
 * (the coach route) emits a `grounding` SSE event; the client appends the
 * caveat to the assistant message and sets `lowConfidence` /
 * `needsReview` on the persisted record. The original message text is
 * never deleted — the user keeps their answer, just clearly marked.
 */

import { type DifficultyLevel } from "@/ai/ai-difficulty";
import type { EvidenceLedger, NumericFact } from "./coach-evidence-ledger";

/** A single grounding failure surfaced to the user via the caveat. */
export interface GroundingFailure {
  /** Heuristic that produced the failure. */
  kind:
    "missing-evidence-tag" | "numeric-contradiction" | "insufficient-category";
  /** Stable id / key the failure is about (evidence id, numeric key, category). */
  ref: string;
  /** Human-readable detail. */
  detail: string;
}

/** The guard's verdict on a completed assistant message. */
export interface GroundingVerdict {
  /** True when every check passed — the message may be persisted as-is. */
  grounded: boolean;
  /** True when at least one check failed — the message is marked low-confidence. */
  lowConfidence: boolean;
  /** Alias for `lowConfidence` — matches the issue's `needsReview` terminology. */
  needsReview: boolean;
  /** Per-failure detail, surfaced to the caller for the caveat footer. */
  failures: GroundingFailure[];
  /**
   * Tier-appropriate caveat text appended to the message body. Empty when
   * the message is grounded.
   */
  caveat: string;
}

/**
 * Inputs to {@link runGroundingGuard}. The ledger is required (possibly empty
 * — every category is then `insufficient`); the difficulty tier selects
 * caveat wording.
 */
export interface GroundingGuardInputs {
  /** The completed assistant message text (post-stream, pre-persist). */
  message: string;
  /** Evidence ledger built from the same context that fed the prompt. */
  ledger: EvidenceLedger;
  /** Difficulty tier for caveat wording. Defaults to `medium`. */
  difficulty?: DifficultyLevel;
}

/**
 * Regex extracting `[E:<id>]` citation tags from assistant text. Ids are
 * restricted to `[A-Za-z0-9_-]+` — the ledger never emits anything else.
 * Anchored inside brackets so markdown emphasis or quotes do not fool it.
 */
const EVIDENCE_TAG_PATTERN = /\[E:([A-Za-z0-9_-]+)\]/g;

/**
 * Numeric claim patterns. Each entry pairs a regex (with one capture group
 * for the numeric value) to a numeric-fact key from the ledger. Patterns
 * are anchored with word boundaries so surrounding prose does not throw the
 * match off.
 *
 * Order matters: more specific patterns (`average CMC`, `avg CMC`) are listed
 * before generic ones so a single claim is not double-counted against two
 * facts.
 */
interface NumericClaimPattern {
  factKey: string;
  // Optional because some heuristics share a regex pool but only some apply.
  pattern: RegExp;
}

const NUMERIC_CLAIM_PATTERNS: ReadonlyArray<NumericClaimPattern> = [
  // Average CMC — accept "average CMC is 3.5", "avg. CMC of 3.5", "average mana value of 3.5".
  // The `g` flag is REQUIRED for `String.matchAll` (enforced by the spec).
  {
    factKey: "avgCmc",
    pattern:
      /(?:average|avg\.?|mean)\s*(?:cmc|mana\s*(?:value|cost)|converted\s*mana\s*cost)\s*(?:is|of|equals?|=)?\s*(\d+(?:\.\d+)?)/gi,
  },
  // Land count — "you have 24 lands", "land count is 24", "24 land cards".
  {
    factKey: "lands",
    pattern:
      /(?:(\d+)\s*(?:lands|land\s*cards|land\s*count)|(?:land\s*count|lands)\s*(?:is|of|equals?|=)?\s*(\d+))/gi,
  },
  // Threats — "you run 20 threats", "threats: 20".
  {
    factKey: "threats",
    pattern:
      /(?:(\d+)\s*(?:threats|threat\s*cards|creatures?)|(?:threats|creatures?)\s*(?::|is|of|equals?|=)\s*(\d+))/gi,
  },
  // Ramp — "12 ramp sources", "ramp: 12".
  {
    factKey: "ramp",
    pattern:
      /(?:(\d+)\s*(?:ramp(?:\s*(?:sources?|spells?|cards?))?|mana\s*dorks?|mana\s*producer[s]?)|ramp\s*(?::|is|of|equals?|=)\s*(\d+))/gi,
  },
  // Removal — "6 removal spells", "removal: 6".
  {
    factKey: "removal",
    pattern:
      /(?:(\d+)\s*(?:removal(?:\s*(?:spells?|cards?|answers?))?|answers?)|removal\s*(?::|is|of|equals?|=)\s*(\d+))/gi,
  },
  // Card draw — "5 card draw spells", "card draw: 5".
  {
    factKey: "cardDraw",
    pattern:
      /(?:(\d+)\s*(?:card[-\s]?draw(?:\s*(?:spells?|sources?|cards?))?|draw\s*spells?)|card[-\s]?draw\s*(?::|is|of|equals?|=)\s*(\d+))/gi,
  },
  // Disruption — "4 disruption spells".
  {
    factKey: "disruption",
    pattern:
      /(?:(\d+)\s*(?:disruption(?:\s*(?:spells?|cards?|pieces?))?|counterspells?)|disruption\s*(?::|is|of|equals?|=)\s*(\d+))/gi,
  },
  // Total cards — "60 cards", "deck of 60".
  {
    factKey: "totalCards",
    pattern:
      /(?:(\d+)\s*(?:cards|total\s*cards)|(?:total|deck(?:\s*of)?)\s*(?::|is|equals?|=)?\s*(\d+)\s*cards)/gi,
  },
];

/**
 * Patterns that suggest a categorical matchup/meta claim the ledger cannot
 * ground (it has no external meta snapshot). Matched against the message;
 * the existence of any match in an `insufficient` category triggers a flag.
 * Patterns are deliberately conservative — generic advice ("consider your
 * matchup") does not match; only concrete assertions do.
 */
const MATCHUP_ASSERTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:win\s*rate|winrate)\s*(?:is|of|around|approx(?:imately)?|=)?\s*(\d+(?:\.\d+)?)\s*%/i,
  /\b(?:folds?\s*to|loses?\s*to|beats?|beaten\s*by|strong\s*against|weak\s*against|favou?red?\s*against)\s+/i,
  /\b(?:good|bad|favorable|unfavourable|unfavorable)\s+matchup\s+(?:against|vs\.?|versus)\s+/i,
];

const META_ASSERTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:in\s+the\s+current\s+meta|meta(?:game)?\s+(?:is|right\s+now|currently))\b/i,
  /\b(?:top\s+tier|tier[-\s]?1|meta\s+deck)\b/i,
];

/**
 * Build a quick lookup of `factKey → NumericFact` from the ledger. Multiple
 * entries can contribute the same key (e.g. two curve entries each expose
 * `avgCmc`); we keep the first so the lookup is deterministic.
 */
function indexNumericFacts(ledger: EvidenceLedger): Map<string, NumericFact> {
  const out = new Map<string, NumericFact>();
  for (const entry of ledger.entries) {
    if (!entry.numericFacts) continue;
    for (const fact of entry.numericFacts) {
      if (!out.has(fact.key)) out.set(fact.key, fact);
    }
  }
  return out;
}

/** Extract every numeric claim the guard can validate. */
function extractNumericClaims(
  message: string,
  facts: Map<string, NumericFact>,
): Array<{ factKey: string; claimed: number; fact: NumericFact }> {
  const out: Array<{ factKey: string; claimed: number; fact: NumericFact }> =
    [];
  if (typeof message !== "string" || message.length === 0) return out;

  for (const { factKey, pattern } of NUMERIC_CLAIM_PATTERNS) {
    const fact = facts.get(factKey);
    if (!fact) continue; // Ledger has no opinion — skip.

    // Reset lastIndex defensively in case a caller handed us a sticky regex.
    pattern.lastIndex = 0;
    const matches = message.matchAll(pattern as RegExp);
    for (const match of matches) {
      // Patterns have one OR two capture groups (so they can match either
      // "N <noun>" or "<noun>: N"). Pick the first defined group.
      const raw = match[1] ?? match[2] ?? null;
      if (raw == null) continue;
      const claimed = Number(raw);
      if (!Number.isFinite(claimed)) continue;
      out.push({ factKey, claimed, fact });
    }
  }

  return out;
}

/** Extract every `[E:<id>]` tag in the message. */
function extractEvidenceTags(message: string): string[] {
  if (typeof message !== "string" || message.length === 0) return [];
  EVIDENCE_TAG_PATTERN.lastIndex = 0;
  const out: string[] = [];
  for (const match of message.matchAll(EVIDENCE_TAG_PATTERN)) {
    out.push(match[1]);
  }
  return out;
}

/**
 * Tier-appropriate caveat wording. Every tier's caveat makes the
 * low-confidence status explicit; the difference is the depth of the
 * explanation (issue #1419: easy/medium/hard/expert all block unsupported
 * factual certainty, but use different wording).
 */
const TIER_CAVEATS: Record<
  DifficultyLevel,
  (failures: GroundingFailure[]) => string
> = {
  easy: (failures) =>
    [
      "",
      "---",
      "⚠️ **Heads up — some of this advice couldn't be checked against your deck's data.**",
      "Please double-check these points before acting on them:",
      ...failures.slice(0, 3).map((f) => `- ${f.detail}`),
      "When in doubt, ask me to explain the numbers from your deck's analysis.",
    ].join("\n"),
  medium: (failures) =>
    [
      "",
      "---",
      "⚠️ **Caveat — partial grounding failure.**",
      "The following claims could not be verified against the structured analysis:",
      ...failures.slice(0, 4).map((f) => `- ${f.detail}`),
      "Treat them as coach opinion, not as established facts about your deck.",
    ].join("\n"),
  hard: (failures) =>
    [
      "",
      "---",
      "⚠️ **Grounding failure — needs review.**",
      "The following assertions contradict or go beyond the evidence ledger:",
      ...failures.slice(0, 5).map((f) => `- [${f.kind}] ${f.detail}`),
      "Re-derive these from the structured analysis before relying on them.",
    ].join("\n"),
  expert: (failures) =>
    [
      "",
      "---",
      "⚠️ **Grounding failure — needs review.**",
      "Unsupported assertions detected (guard is heuristic; verify manually):",
      ...failures.slice(0, 6).map((f) => `- [${f.kind}/${f.ref}] ${f.detail}`),
      "Source-of-truth is the structured deck analysis; do not act on these without confirming.",
    ].join("\n"),
};

/**
 * Build the caveat footer for the given tier + failures. Pure / deterministic
 * — same failures ⇒ same caveat byte-for-byte.
 */
export function buildGroundingCaveat(
  difficulty: DifficultyLevel,
  failures: ReadonlyArray<GroundingFailure>,
): string {
  const fn = TIER_CAVEATS[difficulty] ?? TIER_CAVEATS.medium;
  return fn([...failures]);
}

/**
 * Run the deterministic post-generation grounding guard.
 *
 * Returns a {@link GroundingVerdict}. The caller is responsible for
 * appending `verdict.caveat` to the assistant message and setting
 * `lowConfidence` / `needsReview` on the persisted record when
 * `verdict.lowConfidence` is true.
 */
export function runGroundingGuard(
  inputs: GroundingGuardInputs,
): GroundingVerdict {
  const { message, ledger } = inputs;
  const difficulty = inputs.difficulty ?? "medium";

  const failures: GroundingFailure[] = [];
  const validIds = new Set(ledger.entries.map((e) => e.id));

  // 1) Citation tag validity.
  const tags = extractEvidenceTags(message);
  for (const tag of tags) {
    if (!validIds.has(tag)) {
      failures.push({
        kind: "missing-evidence-tag",
        ref: tag,
        detail: `Cited evidence id "${tag}" is not in the ledger.`,
      });
    }
  }

  // 2) Numeric contradiction.
  const facts = indexNumericFacts(ledger);
  const claims = extractNumericClaims(message, facts);
  for (const { factKey, claimed, fact } of claims) {
    const delta = Math.abs(claimed - fact.value);
    if (delta > fact.tolerance) {
      failures.push({
        kind: "numeric-contradiction",
        ref: factKey,
        detail: `Claimed ${fact.label} ${claimed}; ledger says ${fact.value} (±${fact.tolerance}).`,
      });
    }
  }

  // 3) Insufficient-category assertion. Only run the keyword scan against
  //    categories the ledger explicitly marks insufficient, so a deck with
  //    rich curve data does not get penalized for mentioning "curve".
  const insufficientSet = new Set(ledger.insufficientCategories);
  if (insufficientSet.has("matchup")) {
    for (const pattern of MATCHUP_ASSERTION_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(message)) {
        failures.push({
          kind: "insufficient-category",
          ref: "matchup",
          detail:
            "Matchup assertion is not grounded — no matchup data in the ledger.",
        });
        break;
      }
    }
  }
  if (insufficientSet.has("meta")) {
    for (const pattern of META_ASSERTION_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(message)) {
        failures.push({
          kind: "insufficient-category",
          ref: "meta",
          detail:
            "Meta assertion is not grounded — no metagame snapshot in the ledger.",
        });
        break;
      }
    }
  }

  const grounded = failures.length === 0;
  const caveat = grounded ? "" : buildGroundingCaveat(difficulty, failures);

  return {
    grounded,
    lowConfidence: !grounded,
    needsReview: !grounded,
    failures,
    caveat,
  };
}
