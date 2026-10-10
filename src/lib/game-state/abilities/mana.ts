import type { CardInstance, ManaPool } from "../types";

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

/**
 * Substitute "the chosen color" (Heraldic Banner's "{T}: Add one mana
 * of the chosen color.") into a literal `{W}`-style symbol so the
 * existing `parseManaFromEffect` can read it (#2594 follow-up, Wave
 * 4.7 lane 41). Returns the original effect text unchanged when the
 * source has no `chosenColor` (the player hasn't answered the enter
 * choice yet) — the caller's `parseManaFromEffect` will then produce
 * an empty mana pool and the activated ability no-ops.
 *
 * The substitution is case-insensitive on "the chosen color"; the
 * standard oracle phrasing "{T}: Add one mana of the chosen color."
 * is the v1 use case. The rewrite emits `{W}`/`{U}`/`{B}`/`{R}`/`{G}`
 * directly, the same shape `parseManaFromEffect` already parses.
 */
export function substituteChosenColorInEffect(
  effectText: string,
  source: CardInstance,
): string {
  if (!source.chosenColor) return effectText;
  const sym = `{${source.chosenColor}}`;
  return effectText.replace(/the chosen color/gi, sym);
}
