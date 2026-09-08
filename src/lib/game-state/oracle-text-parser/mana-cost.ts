/**
 * Mana-cost parsing and math: parse/format/equality, mana value, and {X} cost info.
 *
 * Mechanically extracted from oracle-text-parser.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from '../types';

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
}

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

  // Match mana symbols
  const manaMatches = costString.match(/{[^}]+}/g) || [];

  for (const match of manaMatches) {
    const symbol = match.slice(1, -1); // Remove { and }

    // Handle generic mana
    if (/^\d+$/.test(symbol)) {
      cost.generic += parseInt(symbol, 10);
      continue;
    }

    // Handle X
    if (symbol === "X" || symbol === "x") {
      cost.X = 0;
      continue;
    }

    // Handle colorless
    if (symbol === "C") {
      cost.colorless += 1;
      continue;
    }

    // Handle colored mana
    switch (symbol) {
      case "W":
        cost.white += 1;
        break;
      case "U":
        cost.blue += 1;
        break;
      case "B":
        cost.black += 1;
        break;
      case "R":
        cost.red += 1;
        break;
      case "G":
        cost.green += 1;
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
        // Hybrid mana - add to both colors
        if (symbol.includes("/")) {
          const colorParts = symbol.split("/");
          for (const c of colorParts) {
            if (c === "W") cost.white += 0.5;
            else if (c === "U") cost.blue += 0.5;
            else if (c === "B") cost.black += 0.5;
            else if (c === "R") cost.red += 0.5;
            else if (c === "G") cost.green += 0.5;
          }
        }
        break;
      case "2/W":
      case "2/U":
      case "2/B":
      case "2/R":
      case "2/G":
        cost.generic += 2;
        break;
      case "S":
        cost.snow += 1;
        break;
      case "P":
        // Phyrexian mana - add generic cost
        cost.generic += 1;
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
    cost.snow === 0
  ) {
    return null;
  }

  return cost;
}

/**
 * Format a mana cost for display
 */
export function formatManaCost(cost: ParsedManaCost | null): string {
  if (!cost) return "";

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
 * Compare two mana costs for equality
 */
export function manaCostsEqual(
  a: ParsedManaCost | null,
  b: ParsedManaCost | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.generic === b.generic &&
    a.colorless === b.colorless &&
    a.white === b.white &&
    a.blue === b.blue &&
    a.black === b.black &&
    a.red === b.red &&
    a.green === b.green &&
    a.X === b.X &&
    a.snow === b.snow
  );
}

/**
 * Get the total mana value of a cost
 */
export function getManaValue(cost: ParsedManaCost | null): number {
  if (!cost) return 0;

  let total = cost.generic;

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

