/**
 * Escape-cost parsing (CR 702.138): exile-count resolution and the escape info.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { ParsedManaCost, parseManaCost } from './mana-cost';

/**
 * Result of detecting Escape (CR 702.138).
 */
export interface EscapeInfo {
  hasEscape: boolean;
  escapeCost: ParsedManaCost | null;
  /** Number of other graveyard cards that must be exiled (CR 702.138a). */
  exileCount: number;
  description: string;
}

/**
 * Default exile count for the legacy "Escape—[cost]" form that omits the
 * explicit "Exile N other cards" clause. The most common historical value
 * across printed escape cards is 4 (e.g. the Theros Beyond Death core set),
 * so we fall back to 4 to keep partial / reminder-text-only oracle strings
 * parsing instead of failing.
 */
const DEFAULT_ESCAPE_EXILE_COUNT = 4;

/**
 * Parse the per-card exile count N from an Escape card's oracle text.
 *
 * Real-world Escape cards phrase the cost in two ways:
 *   • "Exile four other cards from your graveyard" (English number word)
 *   • "Exile 5 other cards from your graveyard"   (Arabic digit)
 *
 * Both forms are matched; neither is case-sensitive. If neither form is
 * found, the historical default (4) is returned so partial oracle text
 * still parses.
 */
export function parseEscapeExileCount(oracleText: string): number {
  if (!oracleText) {
    return DEFAULT_ESCAPE_EXILE_COUNT;
  }
  // Prefer the Arabic-digit form; fall back to the spelled-out English number
  // word. Anchored on "exile ... other cards from your graveyard" so unrelated
  // mentions of "exile" elsewhere on the card do not skew the count.
  const digitMatch = oracleText.match(
    /exile\s+(\d+)\s+other\s+cards\s+from\s+your\s+graveyard/i,
  );
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const wordMatch = oracleText.match(
    /exile\s+([a-z]+)\s+other\s+cards\s+from\s+your\s+graveyard/i,
  );
  if (wordMatch) {
    const n = wordMap[wordMatch[1].toLowerCase()];
    if (n !== undefined) {
      return n;
    }
  }
  return DEFAULT_ESCAPE_EXILE_COUNT;
}

/**
 * Parse the Escape keyword from oracle text.
 *
 * CR 702.138: "Escape—[cost], Exile N other cards from your graveyard."
 * is a static ability that functions while the card is in its owner's
 * graveyard. It offers an alternative cost: the spell's controller may pay
 * [cost] rather than the printed mana cost AND exile N other cards from
 * their graveyard (CR 702.138a). The spell's mana value is unchanged and
 * other additional costs/taxes still apply (same treatment as
 * Blitz/Foretell/Spectacle). On resolution, if the spell would leave the
 * stack for anywhere but the battlefield, it is exiled instead (CR
 * 702.138c) — handled by the spell-completion path in `spell-casting.ts`.
 *
 * Example oracle texts:
 *   • "Escape—{4}{R}, Exile three other cards from your graveyard."
 *     (Pondering Mage variant — spelled-out count)
 *   • "Escape—{3}{R}{W}, Exile 5 other cards from your graveyard."
 *     (Chrome Courier — digit count)
 *   • "Escape—{4}{G}" (no exile clause — falls back to default N=4)
 */
export function parseEscape(oracleText: string): EscapeInfo {
  if (!oracleText) {
    return {
      hasEscape: false,
      escapeCost: null,
      exileCount: DEFAULT_ESCAPE_EXILE_COUNT,
      description: "",
    };
  }

  // Escape oracle text is "Escape—{cost}" with an em dash, en dash, or
  // hyphen separator. Tolerate all three.
  const escapeMatch = oracleText.match(
    /escape\s*[—–-]\s*(\{[^}]+\}(?:\{[^}]+\})*)/i,
  );

  if (!escapeMatch) {
    return {
      hasEscape: false,
      escapeCost: null,
      exileCount: DEFAULT_ESCAPE_EXILE_COUNT,
      description: "",
    };
  }

  const escapeCost = parseManaCost(escapeMatch[1]);
  const exileCount = parseEscapeExileCount(oracleText);

  return {
    hasEscape: true,
    escapeCost,
    exileCount,
    description: `Escape ${escapeMatch[1]}`,
  };
}

