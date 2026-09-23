import type { ManaPool } from "../types";

export function parseManaFromEffect(effectText: string): Partial<ManaPool> {
  const mana: Partial<ManaPool> = {};
  const text = effectText.toLowerCase();

  const symbolRegex = /\{([^}]+)\}/g;
  let match;
  while ((match = symbolRegex.exec(text)) !== null) {
    const sym = match[1].toUpperCase();
    if (sym === "W") mana.white = (mana.white || 0) + 1;
    else if (sym === "U") mana.blue = (mana.blue || 0) + 1;
    else if (sym === "B") mana.black = (mana.black || 0) + 1;
    else if (sym === "R") mana.red = (mana.red || 0) + 1;
    else if (sym === "G") mana.green = (mana.green || 0) + 1;
    else if (sym === "C") mana.colorless = (mana.colorless || 0) + 1;
    else if (/^\d+$/.test(sym))
      mana.generic = (mana.generic || 0) + parseInt(sym, 10);
  }

  return mana;
}
