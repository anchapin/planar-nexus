/**
 * Mutate keyword action (CR 702.140): the "you may cast this creature for its
 * mutate cost, merging it onto a target creature you control" ability.
 *
 * Issue #2346 — evergreen keyword enforcement (mutate).
 *
 * Before this change, `mutate` had **two** `hasMutate` exports under the same
 * name, in two modules, with different signatures and different keyword-arm
 * semantics:
 *
 *   1. `mutate.ts`      -> `card.keywords?.includes("Mutate")`  (case-SENSITIVE)
 *                          || `oracle_text.includes("mutate")`  (unanchored)
 *   2. `evergreen-keywords.ts` -> `hasKeyword(card, "mutate")`
 *                          -> case-INSENSITIVE exact keyword match
 *                          || same unanchored text arm
 *
 * They disagreed: for `keywords: ["mutate"]` (lowercase) with no oracle text,
 * the `evergreen-keywords` copy returned `true` while the `mutate.ts` copy — the
 * one actually wired into the casting path — returned `false`. The live gate was
 * the stricter *and* buggier of the two, because its keyword arm was
 * case-sensitive. Neither is strict, and both fall back to an **unanchored**
 * substring scan.
 *
 * The unanchored arm matches the substring `mutate` inside `mutates`,
 * `Unmutated` and `commutates`, and inside the negation "This creature can't be
 * mutated." — none of which is the keyword.
 *
 * Blast radius is bounded, and deliberately so: in `castSpell` the loose gate is
 * reached only after `parseMutate` (cast.ts:489) has matched the strict cost
 * regex `/mutate\s*(\{[^}]+\}...)/i` against the oracle text, so a card that is
 * not genuinely a mutate card is rejected before this check runs. This is why
 * #2346 is graded low — a public-surface consolidation, not a P0 gap.
 *
 * NOTE — deliberately out of scope: the two regexes in
 * `oracle-text-parser/alternative-costs.ts` that match
 * `/mutate\s*(\{[^}]+\}(?:\{[^}]+\})*)/i` are **cost extraction**, not
 * keyword-presence detection. Their job is to capture the mana symbols after
 * the word. They must NOT be converted to the strict-keyword pattern.
 *
 * `hasMutateStrict` below establishes the canonical contract — consult ONLY
 * the parsed `keywords` array — mirroring `hasProwessStrict`, `hasHasteStrict`,
 * `hasShroudStrict`, `hasPersistStrict`, and the other strict checks here.
 *
 * This module is a **pure leaf**: it does not import `evergreen-keywords` or
 * `mutate`, so the reference edges stay one-way and no module cycle is
 * introduced.
 */
import type { CardInstance } from "../types";

/**
 * CR 702.140 — strict check for the Mutate keyword.
 *
 * True iff the parsed `keywords` array contains "mutate" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasProwessStrict` / `hasHasteStrict` in consulting only the parsed keyword
 * list, never the raw oracle text.
 *
 * The word-boundary anchor matters: a keyword entry of "mutates" is a
 * *mention*, not the keyword, and must not grant mutate. The check is also
 * case-insensitive, which the previous `mutate.ts` keyword arm was not — that
 * gap made the live casting gate reject a card tagged `keywords: ["mutate"]`.
 */
export function hasMutateStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^mutate\b/i.test(k.trim()));
}
