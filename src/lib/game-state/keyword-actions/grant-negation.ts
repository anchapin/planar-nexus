/**
 * Grant/negation-aware oracle-text detection (issue #2348).
 *
 * This module is the **generalization** of the two identical phrase lists that
 * previously lived inline in `keyword-actions/infect.ts` (#2351) and
 * `keyword-actions/indestructible.ts` (#2350). Both were byte-identical modulo
 * the keyword literal — the same five phrasing classes, differing only in the
 * word they were interpolated around:
 *
 *     /\bgains?\s+KW\b/i     "This creature gains KW until end of turn."
 *     /\blose[sd]?\s+KW\b/i  "Creatures your opponents control lose KW."
 *     /\bhave\s+KW\b/i       "Other creatures you control have KW."
 *     /\bwith\s+KW\b/i       "Creatures you control with KW get +1/+1 ..."
 *     /\bhas\s+KW\s+as\s+long\s+as\b/i
 *
 * A second copy is a liability, not just duplication: when #2350 diverged from
 * #2351 the drift was not subtle (a case-sensitive keyword arm on one side), and
 * a divergent second copy of a gate has been the root cause of an epic issue
 * twice now (#2350 indestructible, #2346 mutate).
 *
 * WHY A SEPARATE MECHANISM FROM `hasXStrict`
 *
 * The strict checks answer "is the keyword in the parsed `keywords` array". This
 * module answers the *semantic* question the fallback arm cannot: given oracle
 * text that contains the standalone word, is that word this card's own keyword,
 * or the object of a grant/negation aimed at other objects? **Anchoring cannot
 * close this gap** — `"Other creatures you control have mutate"` contains the
 * standalone word `mutate`, so any `\bmutate\b` anchor matches it by design. It
 * takes a phrase shape to tell the two apart.
 *
 * DELIBERATE SCOPE — this is a *phrase* guard, not a grant parse. It does NOT
 * model continuous-effect layers or activation payments. An untagged card with a
 * written-out **self**-grant ("{B}: This creature gains infect until end of
 * turn") reads `false`, which is the correct answer until the activation is
 * actually paid. A genuine keyword card carries `keywords: ["Hexproof"]`, so the
 * strict arm answers first and this guard is **unreachable for it** — the guard
 * can only ever fire on cards whose keyword tag is missing.
 *
 * FALSE-NEGATIVE DIRECTION IS THE EXPENSIVE ONE. Bare "has KW" is therefore
 * deliberately NOT in the list, so a written-out "This creature has indestructible."
 * still resolves `true`. The guard rejects only the unambiguous cases where the
 * keyword is provably aimed at something else.
 *
 * This module is a **pure leaf**: no engine imports, so reference edges stay
 * one-way and no module cycle is introduced. `keywords` is a compile-time set of
 * literals (never user input), so the regex cache below is bounded in practice.
 */

/** Matches every RegExp metacharacter so a keyword is embedded literally. */
const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

function escapeForRegExp(literal: string): string {
  return literal.replace(REGEXP_METACHARACTERS, "\\$&");
}

/**
 * Per-keyword compiled patterns. These gates run once per blocker per damage
 * step in live combat, so the regexes are built once and reused rather than
 * re-compiled on every call.
 */
const phrasePatternCache = new Map<string, readonly RegExp[]>();
const ownKeywordPatternCache = new Map<string, RegExp>();

/**
 * The five grant/negation/reference phrasing classes, compiled for one keyword.
 *
 * One entry per class, anchored on the verb that precedes the word:
 *
 *   - `gains? KW`      "This creature gains KW until end of turn."
 *   - `lose[sd]? KW`   "Creatures your opponents control lose KW."
 *   - `have KW`        "Other creatures you control have KW."
 *   - `with KW`        "Creatures you control with KW get +1/+1 ..."
 *   - `has KW as long as`
 *                      "... has KW as long as an opponent is poisoned." — a
 *                      conditional self-grant, which is why the conditional is
 *                      required rather than a bare `has KW`
 */
function phrasePatternsFor(keyword: string): readonly RegExp[] {
  const cached = phrasePatternCache.get(keyword);
  if (cached) {
    return cached;
  }
  const k = escapeForRegExp(keyword);
  const patterns: readonly RegExp[] = [
    new RegExp(`\\bgains?\\s+${k}\\b`, "i"),
    new RegExp(`\\blose[sd]?\\s+${k}\\b`, "i"),
    new RegExp(`\\bhave\\s+${k}\\b`, "i"),
    new RegExp(`\\bwith\\s+${k}\\b`, "i"),
    new RegExp(`\\bhas\\s+${k}\\s+as\\s+long\\s+as\\b`, "i"),
  ];
  phrasePatternCache.set(keyword, patterns);
  return patterns;
}

/**
 * True iff `oracleText` mentions `keyword` only as the object of a grant, a
 * negation, or a reference to *other* keyword-bearing objects — never as the
 * keyword of the card being read.
 *
 * Callers apply this ONLY as a rejection guard on the oracle-text fallback
 * (after the strict `hasXStrict` check has already said no) — never as a way to
 * strip a keyword from a parsed `keywords` array.
 *
 * `oracleTextDeclaresOwnKeyword` composes this with the anchored match and is
 * what gates should normally call; this is exported for the rare caller that
 * needs the guard on its own (and for pinning the phrase classes directly).
 */
export function isKeywordGrantOrNegationPhrase(
  keyword: string,
  oracleText: string,
): boolean {
  if (!oracleText) {
    return false;
  }
  return phrasePatternsFor(keyword.toLowerCase()).some((re) =>
    re.test(oracleText),
  );
}

/**
 * The shared oracle-text **fallback arm** for a strict-first keyword gate.
 *
 * True iff `oracleText` contains `keyword` as a standalone word AND does so as
 * the reading card's own keyword rather than as a grant/negation of it.
 *
 * This is exactly the `!isGrantOrNegation && /\bKW\b/i.test(text)` pair that
 * #2351 and #2350 each hand-rolled, now written once. Gates that use it:
 *
 *     return hasXStrict(card) || oracleTextDeclaresOwnKeyword("x", oracleText);
 *
 * A card carrying `keywords: ["X"]` never reaches the fallback, so this can
 * only reject cards whose keyword tag is missing — the cheap direction.
 */
export function oracleTextDeclaresOwnKeyword(
  keyword: string,
  oracleText: string,
): boolean {
  if (!oracleText) {
    return false;
  }
  const normalized = keyword.toLowerCase();
  if (isKeywordGrantOrNegationPhrase(normalized, oracleText)) {
    return false;
  }
  let anchored = ownKeywordPatternCache.get(normalized);
  if (!anchored) {
    anchored = new RegExp(`\\b${escapeForRegExp(normalized)}\\b`, "i");
    ownKeywordPatternCache.set(normalized, anchored);
  }
  return anchored.test(oracleText);
}
