/**
 * Infect keyword action (CR 702.90).
 *
 * Issue #2351 — evergreen keyword enforcement (infect). Infect was the only
 * keyword left in this arm with **no** `keyword-actions/` module, no
 * `hasInfectStrict`, and no anchored oracle-text fallback. Its single gate was
 * `evergreen-keywords.hasInfect` -> `hasKeyword(card, "infect")`, whose text arm
 * is an **unanchored** `oracleText.includes("infect")`:
 *
 *     keywords.some(exact) || oracleText.includes("infect")
 *
 * Unlike mutate (#2346) nothing filtered that gate upstream — `hasInfect` is
 * read directly at four sites in live combat resolution
 * (`combat/resolution.ts`: attacker -> player, attacker -> blocker, trample
 * excess -> player, blocker -> attacker), so the permissiveness was live.
 *
 * Measured false positives on **real** permanents with a real `keywords: []`
 * (Scryfall `oracle:infect -keyword:Infect` returns 21 cards, 11 permanents):
 *
 *   - Vector Asp              "{B}: This creature gains infect until end of turn."
 *   - Pestilent Souleater     "{B/P}: This creature gains infect until end of turn."
 *   - Melira, Sylvok Outcast  "Creatures your opponents control lose infect."
 *   - Viridian Betrayers      "... has infect as long as an opponent is poisoned."
 *   - Triumph of the Hordes   "Creatures you control with infect get +1/+1 ..."
 *   - Genestealer Patriarch   "... for each infection."          (substring)
 *   - Inkmoth Nexus           "This land is a creature ... infect ..." (unanchored)
 *   - Abby, Merciless Soldier token named "Cordyceps Infected"  (substring)
 *
 * In the combat path a Vector Asp that never paid its `{B}` and a Melira —
 * whose entire purpose is to *remove* infect — both dealt poison instead of
 * life loss and put -1/-1 counters on blockers. The card's meaning is inverted,
 * which is why #2351 is graded high rather than low like #2340/#2341/#2346.
 *
 * `hasInfectStrict` below establishes the canonical contract — consult ONLY the
 * parsed `keywords` array — mirroring `hasMutateStrict`, `hasProwessStrict`,
 * `hasHasteStrict`, `hasShroudStrict`, and the other strict checks here.
 *
 * `isInfectGrantOrNegationPhrase` is the second half of the fix, and it exists
 * because **anchoring alone does not close the two live combat FPs**. `/\binfect\b/i`
 * still matches inside "This creature gains infect until end of turn" and
 * "Creatures your opponents control lose infect" — the word appears there as
 * the *object of a grant or a negation aimed at other objects*, never as this
 * card's own keyword. So the oracle fallback in `evergreen-keywords.hasInfect`
 * rejects a grant/negation phrase before it accepts the anchored match.
 *
 * DELIBERATE SCOPE (see #2348 for the generalization): this exclusion list is
 * infect-only and phrase-shaped. It does NOT attempt to parse grants — an
 * untagged card with a *written-out* self-grant of infect still reads `false`,
 * which is the correct answer until the grant is actually paid. A genuine
 * infect card carries `keywords: ["Infect"]`, so the strict arm answers first
 * and this list is unreachable for it. The one accepted trade-off is a card
 * that both carries real infect *and* mentions granting it to others; it will
 * false-negative until #2348 models grants. Bare "has infect" is deliberately
 * NOT in the list so that a written-out "This creature has infect." still
 * resolves true (the false-negative direction is the expensive one).
 *
 * This module is a **pure leaf**: it does not import `evergreen-keywords` or
 * `mutate`, so the reference edges stay one-way and no module cycle is
 * introduced.
 *
 * OUT OF SCOPE: `oracle-text-parser/keywords.ts:72` carries the same unanchored
 * `combinedText.includes("infect")` over its ~90-name evergreen list, so
 * card-display keyword chips inherit the same permissiveness. Its output feeds
 * the search/display surface, not `cardData.keywords`, so it is not on the
 * gameplay path and is NOT widened here.
 */
import type { CardInstance } from "../types";

/**
 * CR 702.90 — strict check for the Infect keyword.
 *
 * True iff the parsed `keywords` array contains "infect" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasMutateStrict` / `hasProwessStrict` / `hasHasteStrict` in consulting only
 * the parsed keyword list, never the raw oracle text.
 *
 * The word-boundary anchor matters: a keyword entry of "infects" is a
 * *mention*, not the keyword, and must not grant infect.
 */
export function hasInfectStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^infect\b/i.test(k.trim()));
}

/**
 * Oracle-text phrases where the standalone word "infect" is the object of a
 * grant, a negation, or a reference to *other* infect-bearing objects — never
 * the keyword of the card being read.
 *
 * One entry per phrasing class, anchored on the verb that precedes the word:
 *
 *   - `gains? infect`      "This creature gains infect until end of turn."
 *                          (Vector Asp, Pestilent Souleater, Corpsejack Menace,
 *                          Phyrexian Unlife, Grafted Exoskeleton)
 *   - `lose[sd]? infect`   "Creatures your opponents control lose infect."
 *                          (Melira, Sylvok Outcast)
 *   - `have infect`        "Other creatures you control have infect."
 *   - `with infect`        "Creatures you control with infect get +1/+1 ..."
 *                          (Triumph of the Hordes), and the "creature with
 *                          infect" reference form
 *   - `has infect as long as`
 *                          "... has infect as long as an opponent is poisoned."
 *                          (Viridian Betrayers) — a conditional self-grant, which
 *                          is why the conditional is required rather than a bare
 *                          `has infect`
 */
const INFECT_GRANT_OR_NEGATION_PHRASES: readonly RegExp[] = [
  /\bgains?\s+infect\b/i,
  /\blose[sd]?\s+infect\b/i,
  /\bhave\s+infect\b/i,
  /\bwith\s+infect\b/i,
  /\bhas\s+infect\s+as\s+long\s+as\b/i,
];

/**
 * True iff `oracleText` mentions infect only as a grant/negation/reference
 * aimed at other objects, so the standalone word must not be read as the
 * reading card's own keyword.
 *
 * Callers apply this ONLY as a rejection guard on the oracle-text fallback
 * (after `hasInfectStrict` has already said no) — never as a way to strip a
 * keyword from a parsed `keywords` array.
 */
export function isInfectGrantOrNegationPhrase(oracleText: string): boolean {
  return INFECT_GRANT_OR_NEGATION_PHRASES.some((re) => re.test(oracleText));
}
