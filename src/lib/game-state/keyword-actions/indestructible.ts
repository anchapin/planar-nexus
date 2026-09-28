/**
 * Indestructible keyword action (CR 702.12).
 *
 * Issue #2350 — evergreen keyword enforcement (indestructible). The engine had
 * **two** copies of the indestructible gate, and they disagreed:
 *
 *   - `keyword-actions/removal.ts::hasIndestructible`
 *       `keywords.includes("Indestructible") || oracleText.includes("indestructible")`
 *       The keyword arm is **case-SENSITIVE** and the oracle arm is
 *       **unanchored**.
 *   - `evergreen-keywords.ts::isIndestructible`
 *       `hasKeyword(card, "indestructible")`
 *       The keyword arm is a correct case-INSENSITIVE exact match, but
 *       `hasKeyword`'s oracle arm is likewise **unanchored**.
 *
 * Unlike flash (#2340) or defender (#2341) nothing filtered these gates
 * upstream — they are read directly on the correctness path, and the removal
 * copy is the gate for **every** "destroy" effect in the engine as well as the
 * lethal-damage state-based action.
 *
 * Measured defects (all pinned in `__tests__/keyword-indestructible.test.ts`):
 *
 *   1. **Case-sensitivity killed a real permanent.** Scryfall's `keywords`
 *      array is title-case, but imported decks, tokens, and hand-built card
 *      data are not, so `keywords: ["indestructible"]` missed the strict arm
 *      AND (with no matching oracle text) the fallback — SBA 704.5g destroyed
 *      a genuinely indestructible creature. The two copies also disagreed with
 *      each other on exactly this input: removal said `false`, evergreen said
 *      `true`.
 *   2. **Grant phrases read as indestructible.** The unanchored oracle arm
 *      matched "Other creatures you control have indestructible." — pinning a
 *      card that only *grants* the keyword to others as itself being unkillable.
 *   3. **0-toughness SBAs were blocked** (see `state-based-actions.ts`; the
 *      CR 702.12b half of this rule). The gate itself is not wrong — the SBA
 *      apply site was routing non-destruction "put into a graveyard" actions
 *      through it.
 *
 * `hasIndestructibleStrict` establishes the canonical contract — consult ONLY
 * the parsed `keywords` array — mirroring `hasInfectStrict`, `hasMutateStrict`,
 * `hasProwessStrict`, `hasDeathtouchStrict`, and the other strict checks here.
 *
 * The second half of the fix is the oracle fallback's grant/negation rejection,
 * for the same reason it exists for infect (#2351): **anchoring alone does not
 * close the grant/negation false positives.** `/\bindestructible\b/i` still
 * matches inside "gains indestructible" and "lose indestructible" — the word
 * appears there as the object of a grant or a negation aimed at other objects,
 * never as this card's own keyword. #2348 generalized this module's former
 * private `INDESTRUCTIBLE_GRANT_OR_NEGATION_PHRASES` list (which was identical
 * to infect's, modulo the keyword) into the shared
 * `oracleTextDeclaresOwnKeyword` helper in `./grant-negation`.
 *
 * DELIBERATE SCOPE (see `grant-negation.ts`): the guard is phrase-shaped, not a
 * grant parse. An untagged card with a *written-out* self-grant of indestructible
 * still reads `false`, which is the correct answer until the grant is actually
 * paid. A genuine indestructible card carries `keywords: ["Indestructible"]`, so
 * the strict arm answers first and the guard is unreachable for it. Bare
 * "has indestructible" is deliberately NOT in the list so that a written-out
 * "This creature has indestructible." still resolves true — the false-negative
 * direction is the expensive one.
 *
 * This module is a **pure leaf**: it does not import `evergreen-keywords` or
 * `card-instance`, so the reference edges stay one-way and no module cycle is
 * introduced. Unlike the infect split, indestructible also exports the composed
 * gate (`hasIndestructibleKeyword`) because its two historical callers must
 * agree — a divergent second copy is the defect being fixed, so the composition
 * lives here once and both call sites delegate.
 */
import { oracleTextDeclaresOwnKeyword } from "./grant-negation";
import type { CardInstance } from "../types";

/**
 * CR 702.12 — strict check for the Indestructible keyword.
 *
 * True iff the parsed `keywords` array contains "indestructible" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasInfectStrict` / `hasDeathtouchStrict` in consulting only the parsed
 * keyword list, never the raw oracle text.
 *
 * The word-boundary anchor matters: a keyword entry of "indestructibility" is a
 * *mention*, not the keyword, and must not grant indestructible.
 */
export function hasIndestructibleStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^indestructible\b/i.test(k.trim()));
}

/**
 * The single canonical indestructible gate: strict parsed-keywords first, then
 * grant/negation rejection, then an **anchored** oracle-text fallback for cards
 * whose `keywords` array is missing the tag.
 *
 * This is the shape established by `hasInfect` (#2351) and `hasHexproof`
 * (#2331). Both historical callers — `keyword-actions/removal.ts` and
 * `evergreen-keywords.ts` — delegate here so they cannot drift apart again.
 * #2348 factored the fallback arm itself out to the shared
 * `oracleTextDeclaresOwnKeyword` in `./grant-negation`, so shroud, hexproof,
 * mutate and prowess now reject grant/negation phrases through the same code.
 *
 * SCOPE — DESTRUCTION ONLY (CR 702.12a vs 702.12b). This gate answers "is this
 * permanent protected from *destruction*", nothing more. Per 702.12b
 * indestructible does **not** prevent a permanent from being put into a
 * graveyard directly, so it must NOT be consulted for:
 *
 *   - SBA 704.5f (toughness 0 or less → put into owner's graveyard)
 *   - SBA 704.5m (Aura enchanting nothing → put into owner's graveyard)
 *   - SBA 704.5n (Equipment/Fortification attached to an illegal object)
 *   - sacrifice, exile, or any "put into a graveyard" effect
 *
 * `state-based-actions.ts` applies those via `destroyCard(..., true)`; see the
 * comment at that call site. Using this gate as a general "cannot leave the
 * battlefield" check is the 702.12b bug, not a use of this function.
 */
export function hasIndestructibleKeyword(card: CardInstance): boolean {
  if (hasIndestructibleStrict(card)) {
    return true;
  }
  return oracleTextDeclaresOwnKeyword(
    "indestructible",
    card.cardData.oracle_text ?? "",
  );
}
