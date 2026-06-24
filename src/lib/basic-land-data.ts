/**
 * @fileOverview Canonical basic-land seed data.
 *
 * Issue #925: The basic-land mana-ability strings (e.g. `{T}: Add {G}.`) were
 * hardcoded and duplicated across the game seed pages
 * (src/app/(app)/game/[id]/page.tsx and src/app/(app)/spectator/page.tsx).
 * This module is the single source of truth for the five Magic: The Gathering
 * basic lands, their color identities, and their tap-for-mana ability text so
 * the literals exist in exactly one place.
 *
 * Provided:
 * - BASIC_LAND_NAMES: the five basic land names, in WUBRG order
 * - BASIC_LAND_COLORS: land name -> single-character color identity code
 * - BASIC_LAND_MANA_ABILITIES: land name -> mana-ability oracle text
 * - BASIC_LAND_MANA_ABILITY_BY_COLOR: color code -> mana-ability oracle text
 * - getBasicLandColor / getBasicLandManaAbility helpers for runtime lookup
 *
 * NOTE: the ability strings intentionally OMIT the trailing period to preserve
 * the exact values previously hardcoded in the seed pages (their consumers do
 * not expect a period). Do not "fix" this without auditing every call site.
 */

/** The five Magic: The Gathering basic land names, in WUBRG order. */
export const BASIC_LAND_NAMES = [
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
] as const;

/** A basic land name. */
export type BasicLandName = (typeof BASIC_LAND_NAMES)[number];

/**
 * Single-character color identity code for each basic land.
 * W = Plains, U = Island, B = Swamp, R = Mountain, G = Forest.
 */
export const BASIC_LAND_COLORS: Readonly<Record<BasicLandName, string>> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

/**
 * Canonical mana-ability oracle text for each basic land.
 *
 * The strings omit the trailing period to match the pre-existing seed-data
 * format relied on by the game seed pages.
 */
export const BASIC_LAND_MANA_ABILITIES: Readonly<
  Record<BasicLandName, string>
> = {
  Plains: "{T}: Add {W}",
  Island: "{T}: Add {U}",
  Swamp: "{T}: Add {B}",
  Mountain: "{T}: Add {R}",
  Forest: "{T}: Add {G}",
};

/**
 * Mana-ability oracle text keyed by single-character color identity code.
 * Useful when only the color (not the land name) is known at a call site.
 */
export const BASIC_LAND_MANA_ABILITY_BY_COLOR: Readonly<
  Record<string, string>
> = {
  W: "{T}: Add {W}",
  U: "{T}: Add {U}",
  B: "{T}: Add {B}",
  R: "{T}: Add {R}",
  G: "{T}: Add {G}",
};

/**
 * Get the single-character color identity code for a basic land by name.
 * Returns an empty string for an unknown land name.
 */
export function getBasicLandColor(name: string): string {
  return BASIC_LAND_COLORS[name as BasicLandName] ?? "";
}

/**
 * Get the canonical mana-ability oracle text for a basic land by name.
 * Returns an empty string for an unknown land name.
 */
export function getBasicLandManaAbility(name: string): string {
  return BASIC_LAND_MANA_ABILITIES[name as BasicLandName] ?? "";
}

/**
 * Get the canonical mana-ability oracle text for a color identity code.
 * Returns an empty string for an unknown color code.
 */
export function getBasicLandManaAbilityByColor(color: string): string {
  return BASIC_LAND_MANA_ABILITY_BY_COLOR[color] ?? "";
}
