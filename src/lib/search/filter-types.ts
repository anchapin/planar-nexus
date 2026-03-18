/**
 * Filter type definitions for card search
 *
 * Provides TypeScript types for all filter options: CMC, type, rarity, set,
 * color, power/toughness, and format legality. These types integrate with the
 * MinimalCard type from card-database.ts.
 */

// CMC Filter - exact value or range
export interface CMCFilter {
  mode: 'exact' | 'range';
  value?: number;
  min?: number;
  max?: number;
}

// Type filter - supports supertype, type, and subtype
export interface TypeFilter {
  supertypes?: string[]; // legendary, basic, snow, world
  types?: string[]; // creature, instant, sorcery, enchantment, artifact, planeswalker, land
  subtypes?: string[];
}

// Rarity filter
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';
export interface RarityFilter {
  rarities: Rarity[];
}

// Set filter
export interface SetFilter {
  sets: string[];
}

// Color filter (basic - extended in Plan 11-02)
export interface ColorFilter {
  mode: 'exact' | 'include' | 'exclude';
  colors: string[];
  matchColorIdentity?: boolean;
}

// Power/Toughness filter (creatures only)
export interface PowerToughnessFilter {
  power?: { min?: number; max?: number };
  toughness?: { min?: number; max?: number };
}

// Format legality filter
export interface FormatLegalityFilter {
  format: string;
  legality: 'legal' | 'not_legal' | 'restricted';
}

// Combined filter state
export interface CardFilters {
  cmc?: CMCFilter;
  type?: TypeFilter;
  rarity?: RarityFilter;
  set?: SetFilter;
  color?: ColorFilter;
  powerToughness?: PowerToughnessFilter;
  formatLegality?: FormatLegalityFilter;
  searchQuery?: string;
}

export type FilterState = CardFilters;
