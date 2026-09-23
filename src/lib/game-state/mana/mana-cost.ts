interface SpellManaCostResult {
  generic: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
}

export interface SpellManaCost extends SpellManaCostResult {
  hasX: boolean;
}

function parseManaCostString(manaCost: string): SpellManaCostResult {
  const result = { generic: 0, white: 0, blue: 0, black: 0, red: 0, green: 0 };

  const matches = manaCost.match(/{[^}]+}/g) || [];

  for (const match of matches) {
    const symbol = match.slice(1, -1).toUpperCase();

    if (/^\d+$/.test(symbol)) {
      result.generic += parseInt(symbol, 10);
    } else if (symbol === "W") {
      result.white += 1;
    } else if (symbol === "U") {
      result.blue += 1;
    } else if (symbol === "B") {
      result.black += 1;
    } else if (symbol === "R") {
      result.red += 1;
    } else if (symbol === "G") {
      result.green += 1;
    }
  }

  return result;
}

export function getSpellManaCost(card: { mana_cost?: string }): SpellManaCost {
  const manaCost = card.mana_cost || "";
  const parsed = parseManaCostString(manaCost);
  const hasX = (manaCost.toUpperCase().match(/X/g) || []).length > 0;
  return {
    generic: parsed.generic,
    white: parsed.white,
    blue: parsed.blue,
    black: parsed.black,
    red: parsed.red,
    green: parsed.green,
    hasX,
  };
}
