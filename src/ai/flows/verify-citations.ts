/**
 * @fileOverview Local citation verification for AI Coach advice (issue #1072).
 *
 * The conversational coach and the heuristic/AI deck review both produce
 * *output* that names cards. An LLM (or, rarely, a heuristic) can hallucinate
 * card data — citing cards that do not exist, or asserting wrong attributes
 * (mana cost, type, oracle text) for real cards. Hallucinated card advice is
 * the highest-trust-erosion failure mode for a deck coach.
 *
 * This module is a **local-only post-generation verification gate**. It never
 * makes a network call: every cited card is resolved against the user's local
 * card database (`src/lib/card-database.ts`, the Orama + IndexedDB store from
 * #1025/#1085). On resolution it either:
 *
 *   - confirms the citation (`verified`),
 *   - corrects mismatched attributes from the authoritative DB record
 *     (`mismatch` + per-field `corrections`), or
 *   - flags / strikes the citation when the card is absent from a populated
 *     database (`not-found` — almost certainly a hallucination).
 *
 * When the local database is EMPTY (the default state — users import their own
 * data) citations cannot be confirmed or refuted, so they are reported as
 * `unverifiable` and left intact rather than aggressively stripped: removing
 * every suggestion just because the user has not imported card data would
 * break legitimate advice.
 *
 * The core {@link verifyCitations} function is pure given an injectable
 * {@link CardLookupFn}, which keeps it fully unit-testable without IndexedDB.
 */

import {
  getCardByName,
  getDatabaseStatus,
  type MinimalCard,
} from "@/lib/card-database";

/** Outcome of resolving a single cited card against the local database. */
export type CitationStatus =
  /** Card found in the DB and every asserted attribute matches. */
  | "verified"
  /** Card found, but one or more asserted attributes differ from the DB. */
  | "mismatch"
  /** DB contains cards but this name did not resolve — likely hallucinated. */
  | "not-found"
  /** DB is empty/unavailable; the claim can be neither confirmed nor refuted. */
  | "unverifiable";

/** A card attribute that the advice can make a verifiable claim about. */
export type CitationField = "manaCost" | "type" | "oracleText" | "cmc";

/** A card as cited by the advice, with whatever attributes it asserts. */
export interface CitedCard {
  name: string;
  manaCost?: string;
  type?: string;
  oracleText?: string;
  cmc?: number;
}

/** A single attribute that disagreed with the authoritative DB record. */
export interface CitationFieldCorrection {
  field: CitationField;
  /** What the advice claimed. */
  claimed: unknown;
  /** The authoritative value from the local card database. */
  actual: unknown;
}

/** The verification result for one cited card. */
export interface CitationVerification {
  /** The cited card exactly as the advice produced it. */
  cited: CitedCard;
  status: CitationStatus;
  /** The authoritative DB record, when the card resolved. */
  resolved?: MinimalCard;
  /** Per-field mismatches (empty unless `status === "mismatch"`). */
  corrections: CitationFieldCorrection[];
  /** Human-readable explanation suitable for surfacing to the user. */
  note: string;
}

/** Result returned by a {@link CardLookupFn}. */
export interface CitationLookupResult {
  /** True when the DB holds cards AND this name resolved to one. */
  found: boolean;
  /** The resolved card (present when `found`). */
  card?: MinimalCard;
  /** Whether the local DB contains ANY cards. */
  dbHasCards: boolean;
}

/**
 * Resolves a cited card name against the local card database.
 *
 * Injected into {@link verifyCitations} so the verification logic stays pure
 * and testable; the default {@link createLocalCardLookup} wires up the real
 * IndexedDB-backed store.
 */
export type CardLookupFn = (name: string) => Promise<CitationLookupResult>;

/**
 * Aggregate confidence summary for a batch of citations, used to surface a
 * per-message indicator such as "7/8 cited cards verified".
 */
export interface CitationSummary {
  total: number;
  verified: number;
  mismatched: number;
  notFound: number;
  unverifiable: number;
  /** Entries that did not pass cleanly (anything that is not `verified`). */
  flagged: CitationVerification[];
}

/**
 * Build the default LOCAL card resolver. Resolves names through the Orama +
 * IndexedDB store (`getCardByName`) and probes database population once via
 * `getDatabaseStatus`. No network is involved.
 *
 * The lookup is defensive: any IndexedDB failure (e.g. the store is not yet
 * initialised, or the runtime lacks IndexedDB) collapses to
 * `{ found: false, dbHasCards: false }` so the verification gate degrades to
 * "unverifiable" instead of crashing the coaching pipeline.
 */
export function createLocalCardLookup(): CardLookupFn {
  // Probe population a single time per resolver instance; the population
  // answer does not change within one verification pass and re-querying the
  // count for every citation would be wasteful.
  let populationPromise: Promise<boolean> | null = null;
  const dbHasCards = (): Promise<boolean> => {
    if (!populationPromise) {
      populationPromise = (async () => {
        try {
          const status = await getDatabaseStatus();
          return status.cardCount > 0;
        } catch {
          return false;
        }
      })();
    }
    return populationPromise;
  };

  return async (name: string): Promise<CitationLookupResult> => {
    try {
      const [hasCards, card] = await Promise.all([
        dbHasCards(),
        getCardByName(name),
      ]);
      return {
        found: Boolean(card),
        card: card ?? undefined,
        dbHasCards: hasCards,
      };
    } catch {
      return { found: false, dbHasCards: false };
    }
  };
}

/** Collapse whitespace and lowercase for case-insensitive text comparison. */
function norm(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Mana costs are compared ignoring spaces and case: "{1}{R}" == "{1} {r}". */
function normMana(value: unknown): string {
  return norm(value).replace(/\s+/g, "");
}

/**
 * Diff the claimed attributes of a cited card against the authoritative DB
 * record. Only fields the citation actually asserted are compared, so a
 * name-only citation (no claimed attributes) always produces zero corrections.
 */
function diffAttributes(
  cited: CitedCard,
  resolved: MinimalCard,
): CitationFieldCorrection[] {
  const corrections: CitationFieldCorrection[] = [];

  if (cited.manaCost !== undefined) {
    if (normMana(cited.manaCost) !== normMana(resolved.mana_cost)) {
      corrections.push({
        field: "manaCost",
        claimed: cited.manaCost,
        actual: resolved.mana_cost,
      });
    }
  }

  if (cited.type !== undefined) {
    if (norm(cited.type) !== norm(resolved.type_line)) {
      corrections.push({
        field: "type",
        claimed: cited.type,
        actual: resolved.type_line,
      });
    }
  }

  if (cited.oracleText !== undefined) {
    if (norm(cited.oracleText) !== norm(resolved.oracle_text)) {
      corrections.push({
        field: "oracleText",
        claimed: cited.oracleText,
        actual: resolved.oracle_text,
      });
    }
  }

  if (cited.cmc !== undefined) {
    const claimedCmc = Number(cited.cmc);
    if (
      Number.isFinite(claimedCmc) &&
      claimedCmc !== Number(resolved.cmc)
    ) {
      corrections.push({
        field: "cmc",
        claimed: cited.cmc,
        actual: resolved.cmc,
      });
    }
  }

  return corrections;
}

function noteFor(status: CitationStatus, name: string): string {
  switch (status) {
    case "verified":
      return `"${name}" verified against the local card database.`;
    case "mismatch":
      return `"${name}" exists but some cited attributes differ from the local database; corrected to authoritative values.`;
    case "not-found":
      return `"${name}" was not found in the local card database and is likely fabricated; citation flagged.`;
    case "unverifiable":
      return `"${name}" could not be verified because the local card database is empty.`;
  }
}

/**
 * Verify a batch of cited cards against the local card database via the
 * supplied lookup function. Pure with respect to `lookup` — pass a stub in
 * tests, pass {@link createLocalCardLookup} in production.
 *
 * Resolution policy:
 *   - DB empty/unavailable → `unverifiable` (claim left intact downstream).
 *   - DB populated, name unresolved → `not-found` (hallucination candidate).
 *   - Resolved but attributes differ → `mismatch` with corrections.
 *   - Resolved and attributes agree → `verified`.
 */
export async function verifyCitations(
  citations: ReadonlyArray<CitedCard>,
  lookup: CardLookupFn,
): Promise<CitationVerification[]> {
  const safe = Array.isArray(citations) ? citations : [];

  return Promise.all(
    safe.map(async (cited): Promise<CitationVerification> => {
      const result = await lookup(cited.name);

      if (!result.dbHasCards) {
        return {
          cited,
          status: "unverifiable",
          corrections: [],
          note: noteFor("unverifiable", cited.name),
        };
      }

      if (!result.found || !result.card) {
        return {
          cited,
          status: "not-found",
          corrections: [],
          note: noteFor("not-found", cited.name),
        };
      }

      const corrections = diffAttributes(cited, result.card);
      if (corrections.length > 0) {
        return {
          cited,
          status: "mismatch",
          resolved: result.card,
          corrections,
          note: noteFor("mismatch", cited.name),
        };
      }

      return {
        cited,
        status: "verified",
        resolved: result.card,
        corrections: [],
        note: noteFor("verified", cited.name),
      };
    }),
  );
}

/**
 * Reduce a list of verifications into a confidence summary. Drives the
 * per-message "N/M cited cards verified" indicator.
 */
export function summarizeVerifications(
  verifications: ReadonlyArray<CitationVerification>,
): CitationSummary {
  const safe = Array.isArray(verifications) ? verifications : [];
  const counts = { verified: 0, mismatched: 0, notFound: 0, unverifiable: 0 };
  const flagged: CitationVerification[] = [];

  for (const v of safe) {
    switch (v.status) {
      case "verified":
        counts.verified += 1;
        break;
      case "mismatch":
        counts.mismatched += 1;
        flagged.push(v);
        break;
      case "not-found":
        counts.notFound += 1;
        flagged.push(v);
        break;
      case "unverifiable":
        counts.unverifiable += 1;
        flagged.push(v);
        break;
    }
  }

  return {
    total: safe.length,
    ...counts,
    flagged,
  };
}

/**
 * Patterns that delimit an explicitly-cited card name in free-text advice.
 * Kept conservative on purpose: pulling every capitalised phrase would
 * produce a flood of false positives (e.g. "The opponent", "Your Turn").
 * The supported forms are the unambiguous ones an LLM is likely to emit:
 *
 *   - `[[Lightning Bolt]]`   (MTG wiki-link notation)
 *   - `"Lightning Bolt"`     (double-quoted)
 *   - `` `Lightning Bolt` `` (backtick / code span)
 *   - `**Lightning Bolt**`   (bold markdown)
 *
 * The coach system prompt is encouraged to cite cards using one of these
 * forms so extraction is deterministic; unmarked mentions are intentionally
 * left unverified rather than guessed at.
 */
const CITED_CARD_PATTERNS: ReadonlyArray<RegExp> = [
  /\[\[([^[\]]+?)\]\]/g, // [[ ... ]]
  /"([^"\n]+?)"/g, // " ..."
  /`([^`\n]+?)`/g, // ` ... `
  /\*\*([^*\n]+?)\*\*/g, // ** ... **
];

/**
 * Extract explicitly-cited card names from free-text coach advice.
 *
 * Returns de-duplicated {@link CitedCard} entries (name only — free text does
 * not carry reliably-parseable attribute claims, so only existence is checked
 * downstream). Casing of the first occurrence is preserved.
 */
export function extractCitedCards(text: string): CitedCard[] {
  if (typeof text !== "string" || text.length === 0) return [];

  // Collect every match across all delimiter styles together with its text
  // position, so de-duplication can preserve the FIRST occurrence in reading
  // order rather than favouring whichever pattern happens to run first.
  const hits: Array<{ index: number; name: string }> = [];

  for (const pattern of CITED_CARD_PATTERNS) {
    // Reset lastIndex because the regex objects are module-level singletons
    // and `g`-flagged regexes carry state between `.exec`/matchAll calls.
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] || "").trim();
      const name = raw.replace(/\s+/g, " ");
      if (!name) continue;
      // Filter out trivially-non-card matches (single letters, pure digits,
      // very short tokens that are almost certainly emphasis, not card names).
      if (name.length < 2 || /^\d+$/.test(name)) continue;
      hits.push({ index: match.index ?? 0, name });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const ordered: CitedCard[] = [];
  for (const hit of hits) {
    const key = hit.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push({ name: hit.name });
  }

  return ordered;
}

/**
 * Result of annotating a free-text reply with its citation verification.
 */
export interface AnnotatedAdvice {
  /** The (possibly annotated) advice text. */
  text: string;
  /** Number of cited cards that passed verification. */
  verifiedCount: number;
  /** Total cited cards discovered in the text. */
  totalCount: number;
  /** The underlying per-citation verifications. */
  verifications: CitationVerification[];
}

/**
 * Annotate free-text coach advice with the citation verification outcome.
 *
 * - Hallucinated (`not-found`) names are tagged inline with ` ⚠ [unverified]`
 *   at their first occurrence so the user is never shown a fabricated card as
 *   though it were real.
 * - A compact footer is appended reporting the per-message confidence
 *   ("N/M cited cards verified against the local card database") and listing
 *   any flagged citations.
 *
 * When there are no explicit citations the text is returned unchanged.
 */
export function annotateAdviceWithVerification(
  text: string,
  verifications: ReadonlyArray<CitationVerification>,
): AnnotatedAdvice {
  if (typeof text !== "string" || text.length === 0) {
    return { text: text ?? "", verifiedCount: 0, totalCount: 0, verifications: [] };
  }

  const verifs = Array.isArray(verifications) ? verifications : [];
  if (verifs.length === 0) {
    return { text, verifiedCount: 0, totalCount: 0, verifications: [] };
  }

  const summary = summarizeVerifications(verifs);
  let annotated = text;

  const flagged = verifs.filter((v) => v.status === "not-found");
  for (const v of flagged) {
    // Only mark the FIRST occurrence to avoid cluttering repeated mentions.
    const needle = v.cited.name;
    const idx = annotated.indexOf(needle);
    if (idx !== -1) {
      annotated =
        annotated.slice(0, idx + needle.length) +
        " ⚠ [unverified]" +
        annotated.slice(idx + needle.length);
    }
  }

  if (summary.total > 0) {
    const lines: string[] = [
      "",
      "---",
      `*Citation check: ${summary.verified}/${summary.total} cited cards verified against your local card database.*`,
    ];
    for (const v of summary.flagged) {
      if (v.status === "not-found") {
        lines.push(`- ⚠ ${v.cited.name}: not found in local database`);
      } else if (v.status === "mismatch") {
        const fields = v.corrections
          .map((c) => `${c.field}: "${String(c.claimed)}" → "${String(c.actual)}"`)
          .join("; ");
        lines.push(`- ⚠ ${v.cited.name}: corrected (${fields})`);
      } else if (v.status === "unverifiable") {
        lines.push(`- ${v.cited.name}: local database empty — unverified`);
      }
    }
    annotated += "\n" + lines.join("\n");
  }

  return {
    text: annotated,
    verifiedCount: summary.verified,
    totalCount: summary.total,
    verifications: verifs,
  };
}
