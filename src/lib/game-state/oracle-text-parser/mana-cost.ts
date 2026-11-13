/**
 * Mana-cost parsing and math: parse/format/equality, mana value, and {X} cost info.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from '../types';

/**
 * Per-pip bookkeeping for a parsed mana cost (issue #2966).
 *
 * The flat color counters on {@link ParsedManaCost} cannot express hybrid or
 * phyrexian symbols unambiguously: a hybrid pip is split across two color
 * counters (0.5 each) and a phyrexian pip has no color counter at all. This
 * structure keeps one entry per pip so that mana value (CR 202.3) can be
 * counted per pip and so that a parsed cost can be formatted/compared
 * losslessly.
 */
export interface ManaCostPips {
  /** Monocolored colored pips, e.g. `{W}` — one mana value each (CR 202.3a). */
  colored: number;
  /** Two-color hybrid pips, e.g. `{W/U}` — one mana value each (CR 202.3b). */
  hybrid: number;
  /** Monocolored hybrid pips, e.g. `{2/W}` — two mana value each (CR 202.3b). */
  monocoloredHybrid: number;
  /** Phyrexian pips, e.g. `{W/P}` — one mana value each (CR 202.3c). */
  phyrexian: number;
  /** Generic mana contributed by `{N}` symbols and by `{2/COLOR}` symbols. */
  generic: number;
  /** Colorless pips, e.g. `{C}` — one mana value each (CR 202.3a). */
  colorless: number;
  /** Snow pips, e.g. `{S}` — one mana value each (CR 202.3a). */
  snow: number;
  /** The recognized symbols, in source order, without the surrounding braces. */
  symbols: string[];
}

/**
 * Mana cost parsed from text
 */
export interface ParsedManaCost {
  generic: number;
  colorless: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  X: number | null;
  snow: number;
  /**
   * Optional per-pip bookkeeping (issue #2966). Absent on hand-built cost
   * objects, which keeps every existing literal construction valid.
   */
  pips?: ManaCostPips;
}

/** Color letters that may appear in a mana symbol (CR 202). */
const COLOR_LETTERS = ["W", "U", "B", "R", "G"];

/**
 * Phyrexian mana symbols, e.g. `{W/P}`.
 *
 * The set mirrors the symbol regex used by the card preview
 * (`src/components/custom-card-preview.tsx`: `/\{[WUBRG]\/P\}/gi`) — one
 * symbol per color letter. `{C/P}` is not part of that set and does not occur
 * anywhere in the repository, so it is not parsed as a phyrexian symbol.
 */
const PHYREXIAN_SYMBOLS = COLOR_LETTERS.map((color) => `${color}/P`);

/**
 * Parse mana cost string into structured format
 */
export function parseManaCost(costString: string): ParsedManaCost | null {
  if (!costString || costString === "") {
    return null;
  }

  const cost: ParsedManaCost = {
    generic: 0,
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    X: null,
    snow: 0,
  };

  const pips: ManaCostPips = {
    colored: 0,
    hybrid: 0,
    monocoloredHybrid: 0,
    phyrexian: 0,
    generic: 0,
    colorless: 0,
    snow: 0,
    symbols: [],
  };

  // Match mana symbols
  const manaMatches = costString.match(/{[^}]+}/g) || [];

  for (const match of manaMatches) {
    const symbol = match.slice(1, -1); // Remove { and }

    // Handle generic mana
    if (/^\d+$/.test(symbol)) {
      const amount = parseInt(symbol, 10);
      cost.generic += amount;
      pips.generic += amount;
      pips.symbols.push(symbol);
      continue;
    }

    // Handle X
    if (symbol === "X" || symbol === "x") {
      cost.X = 0;
      pips.symbols.push("X");
      continue;
    }

    // Handle colorless
    if (symbol === "C") {
      cost.colorless += 1;
      pips.colorless += 1;
      pips.symbols.push(symbol);
      continue;
    }

    // Handle phyrexian mana (CR 202.3c): e.g. {W/P}. A phyrexian pip is one
    // pip worth one mana value; it is not a colored pip, so it gets its own
    // counter instead of being folded into the color counters.
    if (PHYREXIAN_SYMBOLS.includes(symbol)) {
      pips.phyrexian += 1;
      pips.symbols.push(symbol);
      continue;
    }

    // Handle colored mana
    switch (symbol) {
      case "W":
        cost.white += 1;
        pips.colored += 1;
        pips.symbols.push(symbol);
        break;
      case "U":
        cost.blue += 1;
        pips.colored += 1;
        pips.symbols.push(symbol);
        break;
      case "B":
        cost.black += 1;
        pips.colored += 1;
        pips.symbols.push(symbol);
        break;
      case "R":
        cost.red += 1;
        pips.colored += 1;
        pips.symbols.push(symbol);
        break;
      case "G":
        cost.green += 1;
        pips.colored += 1;
        pips.symbols.push(symbol);
        break;
      case "W/U":
      case "U/B":
      case "B/R":
      case "R/G":
      case "G/W":
      case "U/W":
      case "B/U":
      case "R/B":
      case "G/R":
      case "W/G":
        // Hybrid mana - add to both colors. The pip itself is a single pip
        // for mana-value purposes (CR 202.3b), which the pip counters keep
        // track of independently of the split color counters.
        if (symbol.includes("/")) {
          const colorParts = symbol.split("/");
          for (const c of colorParts) {
            if (c === "W") cost.white += 0.5;
            else if (c === "U") cost.blue += 0.5;
            else if (c === "B") cost.black += 0.5;
            else if (c === "R") cost.red += 0.5;
            else if (c === "G") cost.green += 0.5;
          }
          pips.hybrid += 1;
          pips.symbols.push(symbol);
        }
        break;
      case "2/W":
      case "2/U":
      case "2/B":
      case "2/R":
      case "2/G":
        // Monocolored hybrid: two generic plus a colored option (CR 202.3b).
        cost.generic += 2;
        pips.generic += 2;
        pips.monocoloredHybrid += 1;
        pips.symbols.push(symbol);
        break;
      case "S":
        cost.snow += 1;
        pips.snow += 1;
        pips.symbols.push(symbol);
        break;
      case "P":
        // Phyrexian mana - add generic cost
        cost.generic += 1;
        pips.generic += 1;
        pips.symbols.push(symbol);
        break;
    }
  }

  // If no mana symbols found, return null
  if (
    cost.generic === 0 &&
    cost.colorless === 0 &&
    cost.white === 0 &&
    cost.blue === 0 &&
    cost.black === 0 &&
    cost.red === 0 &&
    cost.green === 0 &&
    cost.X === null &&
    cost.snow === 0 &&
    pips.colored === 0 &&
    pips.hybrid === 0 &&
    pips.monocoloredHybrid === 0 &&
    pips.phyrexian === 0
  ) {
    return null;
  }

  cost.pips = pips;

  return cost;
}

/**
 * Format a mana cost for display
 */
export function formatManaCost(cost: ParsedManaCost | null): string {
  if (!cost) return "";

  // A parsed cost keeps its symbols, so hybrid/phyrexian pips survive the
  // round-trip instead of being flattened into single-color pips (issue #2966).
  const symbols = cost.pips?.symbols;
  if (symbols && symbols.length > 0) {
    return symbols.map((symbol) => `{${symbol}}`).join("");
  }

  let result = "";

  if (cost.X !== null) {
    result += "{X}";
  }

  if (cost.generic > 0) {
    result += `{${cost.generic}}`;
  }

  for (let i = 0; i < cost.white; i++) result += "{W}";
  for (let i = 0; i < cost.blue; i++) result += "{U}";
  for (let i = 0; i < cost.black; i++) result += "{B}";
  for (let i = 0; i < cost.red; i++) result += "{R}";
  for (let i = 0; i < cost.green; i++) result += "{G}";
  for (let i = 0; i < cost.colorless; i++) result += "{C}";
  for (let i = 0; i < cost.snow; i++) result += "{S}";

  return result;
}

/**
 * Canonical form of a single mana symbol, used for cost comparison.
 * The order of the halves of a hybrid/phyrexian symbol does not matter
 * (`{W/U}` and `{U/W}` are the same symbol), but the colors themselves do
 * (`{W/P}` and `{U/P}` are not).
 */
function canonicalSymbol(symbol: string): string {
  return symbol.includes("/") ? symbol.split("/").sort().join("/") : symbol;
}

/**
 * Compare two mana costs for equality
 */
export function manaCostsEqual(
  a: ParsedManaCost | null,
  b: ParsedManaCost | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  if (
    !(
      a.generic === b.generic &&
      a.colorless === b.colorless &&
      a.white === b.white &&
      a.blue === b.blue &&
      a.black === b.black &&
      a.red === b.red &&
      a.green === b.green &&
      a.X === b.X &&
      a.snow === b.snow
    )
  ) {
    return false;
  }

  // When both costs carry their symbols, compare those too: the flat
  // counters cannot tell `{W/P}` and `{U/P}` apart (issue #2966).
  const aSymbols = a.pips?.symbols;
  const bSymbols = b.pips?.symbols;
  if (aSymbols && bSymbols) {
    const aCanonical = aSymbols.map(canonicalSymbol).sort();
    const bCanonical = bSymbols.map(canonicalSymbol).sort();
    if (aCanonical.length !== bCanonical.length) return false;
    for (let i = 0; i < aCanonical.length; i++) {
      if (aCanonical[i] !== bCanonical[i]) return false;
    }
  }

  return true;
}

/**
 * Get the total mana value of a cost
 *
 * Per CR 202.3 the mana value of a mana cost is the sum of the mana values
 * of its symbols: generic mana is worth its number, and a colored, hybrid,
 * monocolored-hybrid, phyrexian or colorless symbol is worth 1 (a
 * monocolored hybrid `{2/COLOR}` is worth 2, and is already accounted for in
 * the generic counter). `{X}` adds nothing until it is resolved.
 */
export function getManaValue(cost: ParsedManaCost | null): number {
  if (!cost) return 0;

  const pips = cost.pips;
  if (pips) {
    return (
      pips.generic +
      pips.colorless +
      pips.snow +
      pips.colored +
      pips.hybrid +
      pips.phyrexian
    );
  }

  // Fallback for hand-built costs that carry no pip bookkeeping.
  let total = cost.generic + cost.colorless;

  // Colored mana counts as 1 each
  total += Math.ceil(cost.white);
  total += Math.ceil(cost.blue);
  total += Math.ceil(cost.black);
  total += Math.ceil(cost.red);
  total += Math.ceil(cost.green);

  // X adds nothing to mana value until resolved
  // Snow is generic
  total += cost.snow;

  return total;
}

/**
 * Result of detecting X-cost spell
 */
export interface XCostInfo {
  hasX: boolean;
  maxX: number;
  description: string;
}

/**
 * Check if a card has an X cost and return info about it
 * X cost is determined by {X} in mana_cost
 * Max X is determined by available mana (returned as a suggestion)
 */
export function parseXCost(
  card: ScryfallCard,
  availableMana: number = 10,
): XCostInfo {
  const manaCost = parseManaCost(card.mana_cost || "");
  if (!manaCost || manaCost.X === null) {
    return { hasX: false, maxX: 0, description: "" };
  }

  // Parse the oracle text to find X value description
  const oracleText = card.oracle_text || "";
  let description = "Choose a value for X";

  // Try to find context about what X does
  const xMatch = oracleText.match(
    /(?:create|deal|draw|put|add|remove|choose)\s+(?:x|a\s+x|x\s+[a-z]+)/i,
  );
  if (xMatch) {
    description = `X: ${xMatch[0]}`;
  }

  // Max X is limited by available mana after paying other costs
  const otherCosts = getManaValue(manaCost);
  const maxX = Math.max(0, availableMana - otherCosts);

  return {
    hasX: true,
    maxX,
    description,
  };
}

