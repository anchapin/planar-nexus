/**
 * Predefined tokens (CR 111.10, issue #2544): Treasure, Food and Clue.
 *
 * Each is a colorless artifact token whose ability is its rules text. Food
 * and Clue abilities come from the normal oracle-text ability parser; the
 * Treasure mana ability is handled by `parseManaAbility` (sacrifice-self
 * mana abilities).
 */
export const PREDEFINED_TOKEN_KINDS = ["treasure", "food", "clue"] as const;
export type PredefinedTokenKind = (typeof PREDEFINED_TOKEN_KINDS)[number];

export const PREDEFINED_TOKENS: Record<
  PredefinedTokenKind,
  { name: string; type_line: string; oracle_text: string }
> = {
  // CR 111.10a
  treasure: {
    name: "Treasure",
    type_line: "Token Artifact — Treasure",
    oracle_text: "{T}, Sacrifice this token: Add one mana of any color.",
  },
  // CR 111.10b
  food: {
    name: "Food",
    type_line: "Token Artifact — Food",
    oracle_text: "{2}, {T}, Sacrifice this token: You gain 3 life.",
  },
  // CR 111.10f
  clue: {
    name: "Clue",
    type_line: "Token Artifact — Clue",
    oracle_text: "{2}, Sacrifice this token: Draw a card.",
  },
};
