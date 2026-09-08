/**
 * Renown and Tribute parsing (CR 702.112/702.131).
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */

export interface RenownInfo {
  hasRenown: boolean;
  /** The parsed N value from "Renown N". Undefined when `hasRenown` is false. */
  renownCount?: number;
  /** Human-readable description (e.g. `Renown 2`). */
  description: string;
}

/**
 * Parse the Renown keyword from oracle text.
 *
 * CR 702.100a: "Renown N" — case-insensitive, word-bounded on both sides
 * so "Renown 2" matches but "Unrenowned" / "Renowned" do not. Captures the
 * integer N immediately following the keyword word.
 *
 * Examples:
 *  - "Renown 1" → { hasRenown: true, renownCount: 1, description: "Renown 1" }
 *  - "Renown 3 (When this creature deals combat damage...)" → renownCount 3
 *  - "Knight of the Pilgrim's Road" / "Valeron Wardens" (real cards)
 */
export function parseRenown(oracleText: string): RenownInfo {
  if (!oracleText) {
    return { hasRenown: false, description: "" };
  }

  // Word-bounded both sides; capture the integer N that follows. Reject
  // matches where the captured N is not a digit (e.g. "Renown — when this
  // creature..." which is reminder prose, not the keyword).
  const match = oracleText.match(/\brenown\s+(\d+)\b/i);
  if (!match) {
    return { hasRenown: false, description: "" };
  }

  const count = parseInt(match[1], 10);
  if (isNaN(count) || count < 0) {
    return { hasRenown: false, description: "" };
  }

  return {
    hasRenown: true,
    renownCount: count,
    description: `Renown ${count}`,
  };
}

// ===========================================================================
// Tribute (CR 702.101)
//
// CR 702.101a: "Tribute N" means "As this creature enters the battlefield,
// an opponent of your choice may pay N life or have this creature enter the
// battlefield with N +1/+1 counters on it." (Engine interpretation: the
// opponent chooses whether to pay the Tribute cost; if they do, the
// "tribute not paid" effect does not fire; if they decline, the printed
// "When [this creature] enters the battlefield, if its tribute wasn't paid,
// [effect]" triggered ability fires.)
//
// CR 702.101b: "A creature's tribute is paid if a player chose to pay tribute
// for it as it entered the battlefield." This is the suppression flag for the
// secondary "tribute wasn't paid" trigger.
//
// Printed form: "Tribute N" followed by the secondary triggered ability:
//   "When this creature enters the battlefield, if its tribute wasn't paid,
//    [effect]."
//
// The parser surfaces only the integer N. The opponent-choice / pay-or-decline
// flow lives in keyword-actions.ts (processTributeOnEtb /
// resolveTributeChoice); the trigger wiring lives in trigger-system.ts.
// ===========================================================================

/** Result of detecting Tribute (CR 702.101). */
export interface TributeInfo {
  hasTribute: boolean;
  /** The parsed N value from "Tribute N". Undefined when `hasTribute` is false. */
  tributeCount?: number;
  /** Human-readable description (e.g. `Tribute 2`). */
  description: string;
}

/**
 * Parse the Tribute keyword from oracle text.
 *
 * CR 702.101a: "Tribute N" — case-insensitive, word-bounded on both sides
 * so "Tribute 2" matches but "Tributes" / "Tributeborn" do not. Captures the
 * integer N immediately following the keyword word.
 *
 * Examples:
 *  - "Tribute 1" → { hasTribute: true, tributeCount: 1, ... }
 *  - "Tribute 3 (As this creature enters the battlefield, ...)" → count 3
 *  - "Fanatic of Rhonas" / "Arbor Colossus" (real cards with Tribute)
 */
export function parseTribute(oracleText: string): TributeInfo {
  if (!oracleText) {
    return { hasTribute: false, description: "" };
  }

  const match = oracleText.match(/\btribute\s+(\d+)\b/i);
  if (!match) {
    return { hasTribute: false, description: "" };
  }

  const count = parseInt(match[1], 10);
  if (isNaN(count) || count < 0) {
    return { hasTribute: false, description: "" };
  }

  return {
    hasTribute: true,
    tributeCount: count,
    description: `Tribute ${count}`,
  };
}

