/**
 * Casting-modifier keyword parsing: convoke, delve, storm, split second, prowess, attraction.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */

/**
 * Result of detecting Split second (CR 702.60).
 */
export interface SplitSecondInfo {
  hasSplitSecond: boolean;
  description: string;
}

/**
 * Parse the Split second keyword from oracle text.
 *
 * CR 702.60: "Split second" is a static ability that functions only while the
 * spell with split second is on the stack. It has no parameters and no cost,
 * so a simple, case-insensitive, word-boundary anchored match is sufficient.
 * The reminder text variant ("(As you cast this spell, ...)") is matched too
 * because the leading keyword word is always present regardless.
 *
 * Example oracle text: "Split second" (Sudden Shock, Krosan Grip, Wipe Away).
 */
export function parseSplitSecond(oracleText: string): SplitSecondInfo {
  if (!oracleText) {
    return { hasSplitSecond: false, description: "" };
  }

  // Word-boundary anchored so "split second" matches but a hypothetical
  // "splitsecondish" would not. Case-insensitive to be tolerant of casing.
  const hasSplitSecond = /\bsplit second\b/i.test(oracleText);

  return {
    hasSplitSecond,
    description: hasSplitSecond ? "Split second" : "",
  };
}

/**
 * Result of detecting Storm (CR 702.41).
 */
export interface StormInfo {
  hasStorm: boolean;
  description: string;
}

/**
 * Parse the Storm keyword from oracle text.
 *
 * CR 702.41: "Storm" is a triggered ability that functions only while the
 * spell is on the stack. It reads, "When you cast this spell, copy it for each
 * spell cast before it this turn. If the spell has any targets, you may choose
 * new targets for any of the copies." Storm has no parameters and no cost, so
 * a simple, word-boundary anchored, case-insensitive match is sufficient. The
 * reminder-text variant is tolerated because the leading keyword word is
 * always present regardless.
 *
 * Example oracle text: "Storm" (Grapeshot, Tendrils of Agony, Empty the Warrens).
 */
export function parseStorm(oracleText: string): StormInfo {
  if (!oracleText) {
    return { hasStorm: false, description: "" };
  }

  // Word-boundary anchored on both sides: "Storm" matches, but "Brainstorm"
  // (no boundary before the 's') and a hypothetical "stormbound" (no boundary
  // after the 'm') do not. Case-insensitive to be tolerant of casing.
  const hasStorm = /\bstorm\b/i.test(oracleText);

  return {
    hasStorm,
    description: hasStorm ? "Storm" : "",
  };
}

/**
 * Result of detecting Prowess (CR 702.108).
 */
export interface ProwessInfo {
  hasProwess: boolean;
  description: string;
}

/**
 * Parse the Prowess keyword from oracle text.
 *
 * CR 702.108a: Prowess is a triggered ability. "Whenever you cast a noncreature
 * spell, this creature gets +1/+1 until end of turn." Prowess has no parameters,
 * so a word-boundary anchored, case-insensitive match is sufficient. The
 * reminder-text variant is tolerated because the leading keyword word is always
 * present regardless.
 *
 * Example oracle text: "Prowess" (e.g. Monastery Mentor, Soul-Scar Mage,
 * Adeliz, the Cinder Wind).
 */
export function parseProwess(oracleText: string): ProwessInfo {
  if (!oracleText) {
    return { hasProwess: false, description: "" };
  }

  // Word-boundary anchored on both sides: "Prowess" matches, but substrings
  // inside other words do not. Case-insensitive to be tolerant of casing.
  const hasProwess = /\bprowess\b/i.test(oracleText);

  return {
    hasProwess,
    description: hasProwess ? "Prowess" : "",
  };
}

/**
 * Result of detecting Convoke (CR 702.93).
 */
export interface ConvokeInfo {
  hasConvoke: boolean;
  description: string;
}

/**
 * Parse the Convoke keyword from oracle text.
 *
 * CR 702.93a: "Convoke" is a static ability that functions while the spell with
 * convoke is on the stack. "Your creatures can help cast this spell. Each
 * creature you tap while casting this spell pays for {1} or one mana of that
 * creature's color."
 *
 * Convoke carries no parsed cost: the colored-pip reduction comes from the
 * tapped creatures' colors at cast time (see the `case "convoke"` branch in
 * `castSpell`). Detection is a word-boundary anchored, case-insensitive match
 * so "Convoke" matches while a hypothetical "convokedout" would not. The
 * reminder-text variant is tolerated because the leading keyword word is
 * always present regardless.
 *
 * Example oracle text: "Convoke" (e.g. Stoke the Flames, Satyr Enchanter,
 * Venerated Rotpriest).
 */
export function parseConvoke(oracleText: string): ConvokeInfo {
  if (!oracleText) {
    return { hasConvoke: false, description: "" };
  }

  // Word-boundary anchored on both sides: "Convoke" matches, but substrings
  // inside other words do not. Case-insensitive to be tolerant of casing.
  const hasConvoke = /\bconvoke\b/i.test(oracleText);

  return {
    hasConvoke,
    description: hasConvoke ? "Convoke" : "",
  };
}

/**
 * Result of detecting Delve (CR 702.61).
 */
export interface DelveInfo {
  hasDelve: boolean;
  description: string;
}

/**
 * Parse the Delve keyword from oracle text.
 *
 * CR 702.61a: "Delve" is a static ability that functions while the spell with
 * delve is on the stack. "For each card you exile from your graveyard while
 * casting this spell, you may pay {1} rather than pay that card's mana cost."
 * Each exiled card reduces the GENERIC portion of the cost by {1} — delve
 * cannot pay colored pips (unlike Convoke). Detection is a word-boundary
 * anchored, case-insensitive match so "Delve" matches while a hypothetical
 * "delvedout" would not.
 *
 * Example oracle text: "Delve" (e.g. Treasure Cruise, Tasigur, the Golden
 * Fang, Murderous Cut, Temporal Trespass).
 */
export function parseDelve(oracleText: string): DelveInfo {
  if (!oracleText) {
    return { hasDelve: false, description: "" };
  }

  // Word-boundary anchored on both sides: "Delve" matches, but substrings
  // inside other words do not. Case-insensitive to be tolerant of casing.
  const hasDelve = /\bdelve\b/i.test(oracleText);

  return {
    hasDelve,
    description: hasDelve ? "Delve" : "",
  };
}

/**
 * Result of detecting Attraction mechanic
 */
export interface AttractionInfo {
  hasAttraction: boolean;
  spinResult: number;
  description: string;
}

/**
 * Check if a card has the Attraction mechanic
 * Attraction cards trigger when you roll/spin a specific result and reveal cards
 * from the top of your library until you match that result.
 */
export function parseAttraction(oracleText: string): AttractionInfo {
  if (!oracleText) {
    return { hasAttraction: false, spinResult: 0, description: "" };
  }

  // Check for Attraction keyword
  const hasAttraction = oracleText.toLowerCase().includes("attraction");

  if (!hasAttraction) {
    return { hasAttraction: false, spinResult: 0, description: "" };
  }

  return {
    hasAttraction: true,
    spinResult: 0, // Will be determined by user action (spin/roll)
    description: "Spin the Attraction die to reveal cards",
  };
}

