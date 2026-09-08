/**
 * Cycling parsing (CR 702.18 and variants): cycling info records and variant-name normalization.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { ParsedManaCost, parseManaCost } from './mana-cost';

/**
 * Cycling variants (CR 702.30-31).
 *
 * "Cycling {cost}" is the base form: from your hand, pay {cost} + discard the
 * card, draw a card (CR 702.30a).
 *
 * "Typecycling" / "[Type]cycling {cost}" (e.g. Wizardcycling, Creaturecycling)
 * replaces the draw with a search of your library for a card of the named type
 * (CR 702.31a).
 *
 * "Landcycling {cost}" and "Basic landcycling {cost}" search for a land / a
 * basic land respectively (CR 702.31b / 702.31c). "Landcycling" allows any land
 * matching the basic type if printed; "Basic landcycling" restricts to basic
 * lands of the named type.
 *
 * All variants share the same activated-ability structure: cost = {cost} +
 * discard this card; effect = draw / search for [Type] / search for (basic)
 * land.
 */
export enum CyclingVariant {
  /** Base cycling — pay cost, discard, draw a card (CR 702.30). */
  CYCLING = "cycling",
  /** Typecycling — search library for a card of the named type (CR 702.31). */
  TYPECYCLING = "typecycling",
  /** Landcycling — search library for a land of the named type (CR 702.31). */
  LANDCYCLING = "landcycling",
  /** Basic landcycling — search library for a basic land of the named type. */
  BASIC_LANDCYCLING = "basic_landcycling",
}

/**
 * Result of parsing a Cycling / Typecycling / Landcycling keyword from oracle
 * text (CR 702.30-31).
 */
export interface CyclingInfo {
  /** Whether the oracle text contains a recognised cycling variant. */
  hasCycling: boolean;
  /** Which cycling variant was matched. */
  variant: CyclingVariant | null;
  /** The cycling mana cost (e.g. `{2}`, `{1}{U}`). */
  cost: ParsedManaCost | null;
  /** Cost rendered back to its printed string form (e.g. `{2}`). */
  costString: string | null;
  /** For Typecycling: the named card type (e.g. `Wizard`). */
  type: string | null;
  /** For Landcycling / Basic landcycling: the basic land type (e.g. `Island`). */
  basicLandType: string | null;
  /** Human-readable description (e.g. `Cycling {2}` or `Wizardcycling {1}{U}`). */
  description: string;
}

/** Empty CyclingInfo singleton for fallthrough returns. */
const NO_CYCLING: CyclingInfo = {
  hasCycling: false,
  variant: null,
  cost: null,
  costString: null,
  type: null,
  basicLandType: null,
  description: "",
};

/**
 * Parse a Cycling / Typecycling / Landcycling keyword from oracle text.
 *
 * CR 702.30a: "Cycling {cost}" — from hand, pay {cost} + discard this card,
 * draw a card.
 * CR 702.31: Typecycling / Landcycling / Basic landcycling — same cost shape
 * but the effect searches the library for a card of the named type instead of
 * drawing.
 *
 * The parser handles three distinct forms, each anchored as a whole word to
 * avoid matching substrings:
 *
 *  - "Basic landcycling {cost}"          → variant=BASIC_LANDCYCLING,
 *                                            basicLandType=null (general)
 *  - "[Type] landcycling {cost}"         → variant=LANDCYCLING,
 *                                            basicLandType=<Type>
 *                                            (e.g. "Island landcycling")
 *  - "Landcycling {cost}"                → variant=LANDCYCLING,
 *                                            basicLandType=null (general)
 *  - "[Type]cycling {cost}"              → variant=TYPECYCLING,
 *                                            type=<Type>
 *                                            (e.g. "Wizardcycling")
 *  - "Cycling {cost}"                    → variant=CYCLING, type=null
 *
 * The order of checks matters: "Basic landcycling" must be tested before
 * "landcycling", and any "[Type]cycling" before the bare "Cycling" anchor.
 *
 * Examples seen in print:
 *  - "Cycling {2}"                           (e.g. Aven Riftwatcher)
 *  - "Wizardcycling {2}"                     (e.g. Galeprowler)
 *  - "Plainscycling {1}{W}"                  (e.g. Krosan Verge)
 *  - "Islandcycling {1}{U}"                  (e.g. Flooded Strand)
 *  - "Basic landcycling {1}"                 (e.g. Terminal Moraine)
 */
export function parseCycling(oracleText: string): CyclingInfo {
  if (!oracleText) {
    return { ...NO_CYCLING };
  }

  // Capture the cycling mana cost in braces (one or more {…} groups, like
  // {1}{U}). The regex is intentionally not anchored on cost — anchoring on
  // the keyword word is done below for each variant.
  const costPattern = "(\\{[^}]+\\}(?:\\{[^}]+\\})*)";

  // 1) "Basic landcycling {cost}" — most specific; must precede plain
  //    "landcycling" / "cycling" matches.
  const basicLandMatch = oracleText.match(
    new RegExp(`\\bbasic landcycling\\s*${costPattern}`, "i"),
  );
  if (basicLandMatch) {
    const costString = basicLandMatch[1];
    return {
      hasCycling: true,
      variant: CyclingVariant.BASIC_LANDCYCLING,
      cost: parseManaCost(costString),
      costString,
      type: null,
      basicLandType: null,
      description: `Basic landcycling ${costString}`,
    };
  }

  // 2) "[Type] landcycling {cost}" — landcycling restricted to a basic land
  //    subtype. The [Type] word is captured separately.
  const typedLandMatch = oracleText.match(
    new RegExp(`\\b([A-Za-z]+)\\s+landcycling\\s*${costPattern}`, "i"),
  );
  if (typedLandMatch) {
    const basicLandType = capitalizeFirst(typedLandMatch[1]);
    const costString = typedLandMatch[2];
    return {
      hasCycling: true,
      variant: CyclingVariant.LANDCYCLING,
      cost: parseManaCost(costString),
      costString,
      type: null,
      basicLandType,
      description: `${basicLandType} landcycling ${costString}`,
    };
  }

  // 3) "Landcycling {cost}" — generic landcycling, no basic type.
  const landMatch = oracleText.match(
    new RegExp(`\\blandcycling\\s*${costPattern}`, "i"),
  );
  if (landMatch) {
    const costString = landMatch[1];
    return {
      hasCycling: true,
      variant: CyclingVariant.LANDCYCLING,
      cost: parseManaCost(costString),
      costString,
      type: null,
      basicLandType: null,
      description: `Landcycling ${costString}`,
    };
  }

  // 4) "[Type]cycling {cost}" — typecycling. The [Type] word is captured
  //    separately. Reject words that are clearly not card types so we don't
  //    mis-parse unrelated tokens.
  const typedCycleMatch = oracleText.match(
    new RegExp(`\\b([A-Za-z]+)cycling\\s*${costPattern}`, "i"),
  );
  if (typedCycleMatch) {
    const typeWord = capitalizeFirst(typedCycleMatch[1]);
    if (isLikelyCardTypeWord(typeWord)) {
      const costString = typedCycleMatch[2];
      return {
        hasCycling: true,
        variant: CyclingVariant.TYPECYCLING,
        cost: parseManaCost(costString),
        costString,
        type: typeWord,
        basicLandType: null,
        description: `${typeWord}cycling ${costString}`,
      };
    }
  }

  // 5) "Cycling {cost}" — the base form. Word-bounded so "recycling" or
  //    "tricycling" do not match.
  const cyclingMatch = oracleText.match(
    new RegExp(`\\bcycling\\s*${costPattern}`, "i"),
  );
  if (cyclingMatch) {
    const costString = cyclingMatch[1];
    return {
      hasCycling: true,
      variant: CyclingVariant.CYCLING,
      cost: parseManaCost(costString),
      costString,
      type: null,
      basicLandType: null,
      description: `Cycling ${costString}`,
    };
  }

  return { ...NO_CYCLING };
}

/**
 * Capitalise the first character of `s`, leaving the rest unchanged. Used to
 * normalise captured type words from the cycling regex.
 */
function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Best-effort check that a captured word preceding "cycling" is a plausible
 * card type word. The MTG rules permit almost any noun to be used as a type
 * qualifier for Typecycling (Wizards of the Coast have printed dozens of
 * variants: Wizardcycling, Slivercycling, etc.), so we accept any alphabetic
 * word of length >= 3 to remain lenient while rejecting trivial 1-2 letter
 * tokens that almost certainly are not card types.
 */
function isLikelyCardTypeWord(word: string): boolean {
  if (!word) return false;
  if (!/^[A-Za-z]+$/.test(word)) return false;
  return word.length >= 3;
}

// ===========================================================================
// Renown (CR 702.100)
//
// CR 702.100a: "Renown N" means "When this creature deals combat damage to a
// player, if it isn't renowned, put N +1/+1 counters on it and it becomes
// renowned."
//
// CR 702.100b: "A creature is renowned if it has one or more +1/+1 counters
// on it as a result of its renown ability." (Read literally, the printed
// "becomes renowned" flag persists for the rest of the game — a creature
// that is renowned remains renowned even if the +1/+1 counters are later
// removed, and it can never re-trigger its own Renown. See also entry on
// https://blogs.magicjudges.org/rules/cr702/ under "Renown".)
//
// The parser surfaces only the integer N. The ETB-style "is it renowned?"
// gating and the +1/+1 counter application live in keyword-actions.ts and
// trigger-system.ts.
//
// Printed form: "Renown N" — typically followed by reminder text in
// parentheses, which the leading keyword word always precedes. Example:
//   "Renown 1 (When this creature deals combat damage to a player, if it
//   isn't renowned, put a +1/+1 counter on it.)"
//
// NOTE on issue #1412 scope: the issue text frames Renown as an ETB
// triggered ability for engine purposes. The CR's literal trigger condition
// is combat-damage-to-a-player; the engine surfaces a synthetic ETB-style
// hook here so the same renown-counters application path can fire from
// either an ETB context (e.g., testing / scripting) or the rules-correct
// combat-damage context wired by trigger-system.ts. The flag
// `card.renowned === true` is the authoritative "has this permanent already
// become renowned" guard — once set it never resets for the same card
// instance, surviving zone changes (CR 702.100b).
// ===========================================================================

/** Result of detecting Renown (CR 702.100). */
