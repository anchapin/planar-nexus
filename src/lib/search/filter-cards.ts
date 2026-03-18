/**
 * Pure filter functions for card arrays
 *
 * Provides filtering functions for CMC, type, rarity, and set attributes.
 * These functions operate on MinimalCard arrays and are composable.
 */
import type { MinimalCard } from '@/lib/card-database';
import type {
  CMCFilter,
  TypeFilter,
  RarityFilter,
  SetFilter,
  ColorFilter,
  PowerToughnessFilter,
  FormatLegalityFilter,
  CardFilters,
} from './filter-types';

/**
 * Filter cards by Converted Mana Cost (CMC)
 *
 * - Exact mode: returns cards where cmc equals the filter value
 * - Range mode: returns cards where cmc is between min and max (inclusive)
 */
export function filterByCMC(cards: MinimalCard[], filter: CMCFilter): MinimalCard[] {
  if (!filter) return cards;

  return cards.filter((card) => {
    const cmc = Number(card.cmc);

    if (filter.mode === 'exact') {
      return cmc === filter.value;
    }

    // Range mode
    const min = filter.min ?? 0;
    const max = filter.max ?? Infinity;
    return cmc >= min && cmc <= max;
  });
}

/**
 * Filter cards by type (supertype, type, or subtype)
 *
 * Matches case-insensitively on the type_line field.
 * Uses OR logic: card matches if it has ANY of the specified types.
 */
export function filterByType(cards: MinimalCard[], filter: TypeFilter): MinimalCard[] {
  if (!filter) return cards;

  // If no filter criteria, return all cards
  if (
    (!filter.supertypes || filter.supertypes.length === 0) &&
    (!filter.types || filter.types.length === 0) &&
    (!filter.subtypes || filter.subtypes.length === 0)
  ) {
    return cards;
  }

  return cards.filter((card) => {
    const typeLine = card.type_line?.toLowerCase() || '';

    // Check supertypes (legendary, basic, snow, world)
    if (filter.supertypes && filter.supertypes.length > 0) {
      const hasSupertype = filter.supertypes.some((supertype) =>
        typeLine.includes(supertype.toLowerCase())
      );
      if (!hasSupertype) return false;
    }

    // Check types (creature, instant, sorcery, etc.)
    if (filter.types && filter.types.length > 0) {
      const hasType = filter.types.some((type) =>
        typeLine.includes(type.toLowerCase())
      );
      if (!hasType) return false;
    }

    // Check subtypes (elf, goblin, zombie, etc.)
    if (filter.subtypes && filter.subtypes.length > 0) {
      const hasSubtype = filter.subtypes.some((subtype) =>
        typeLine.includes(subtype.toLowerCase())
      );
      if (!hasSubtype) return false;
    }

    return true;
  });
}

/**
 * Filter cards by rarity
 *
 * Returns cards whose rarity is in the provided rarities array.
 * Handles undefined rarity gracefully.
 */
export function filterByRarity(cards: MinimalCard[], filter: RarityFilter): MinimalCard[] {
  if (!filter || filter.rarities.length === 0) return cards;

  return cards.filter((card) => {
    const rarity = card.rarity?.toLowerCase();
    if (!rarity) return false;
    return filter.rarities.includes(rarity as RarityFilter['rarities'][number]);
  });
}

/**
 * Filter cards by set code
 *
 * Returns cards whose set is in the provided sets array.
 * Uses case-insensitive comparison.
 */
export function filterBySet(cards: MinimalCard[], filter: SetFilter): MinimalCard[] {
  if (!filter || filter.sets.length === 0) return cards;

  const lowerSets = filter.sets.map((s) => s.toLowerCase());

  return cards.filter((card) => {
    const cardSet = card.set?.toLowerCase();
    if (!cardSet) return false;
    return lowerSets.includes(cardSet);
  });
}

/**
 * Filter cards by color
 *
 * Modes:
 * - exact: card must have exactly the specified colors
 * - include: card must contain all specified colors
 * - exclude: card must not contain any of the specified colors
 *
 * Optionally matches against color_identity instead of colors.
 */
export function filterByColor(cards: MinimalCard[], filter: ColorFilter): MinimalCard[] {
  if (!filter || filter.colors.length === 0) return cards;

  const colorField = filter.matchColorIdentity ? 'color_identity' : 'colors';

  return cards.filter((card) => {
    const cardColors = card[colorField] || [];

    switch (filter.mode) {
      case 'exact':
        // Must have exactly the same colors (same length and all match)
        if (cardColors.length !== filter.colors.length) return false;
        return filter.colors.every((c) => cardColors.includes(c));

      case 'include':
        // Must contain all specified colors
        return filter.colors.every((c) => cardColors.includes(c));

      case 'exclude':
        // Must not contain any of the specified colors
        return !filter.colors.some((c) => cardColors.includes(c));

      default:
        return true;
    }
  });
}

/**
 * Filter cards by color identity (colors the card can produce)
 * Same logic as filterByColor but uses color_identity field explicitly
 * This respects cards that produce colors through abilities
 */
export function filterByColorIdentity(cards: MinimalCard[], filter: ColorFilter): MinimalCard[] {
  if (!filter || filter.colors.length === 0) return cards;

  return cards.filter((card) => {
    const cardColorIdentity = card.color_identity || [];

    switch (filter.mode) {
      case 'exact':
        // Must have exactly the same color identity
        if (cardColorIdentity.length !== filter.colors.length) return false;
        return filter.colors.every((c) => cardColorIdentity.includes(c));

      case 'include':
        // Must contain all specified colors in identity
        return filter.colors.every((c) => cardColorIdentity.includes(c));

      case 'exclude':
        // Must not contain any of the specified colors in identity
        return !filter.colors.some((c) => cardColorIdentity.includes(c));

      default:
        return true;
    }
  });
}

/**
 * Check if card colors are a subset of allowed colors
 * Empty cardColors (colorless) returns true
 */
function isColorSubset(cardColors: string[], allowedColors: string[]): boolean {
  if (cardColors.length === 0) return true;
  return cardColors.every((color) => allowedColors.includes(color));
}

/**
 * Filter cards by Commander color identity rules
 * A card is legal if its color_identity is a SUBSET of allowedColors
 * For 5-color commander (WUBRG), all cards are allowed
 * 
 * NOTE: Commander logic is implemented here rather than importing from game-rules.ts
 * because game-rules.ts focuses on deck-level validation (validateDeckFormat), not
 * card-level filtering. This is acceptable architectural separation - game-rules.ts
 * handles game state and deck validation while filter-cards.ts handles card filtering.
 */
export function filterByCommanderRules(cards: MinimalCard[], allowedColors: string[]): MinimalCard[] {
  if (!allowedColors || allowedColors.length === 0) return cards;

  // 5-color commander's color identity allows all cards
  const allColors = ['W', 'U', 'B', 'R', 'G'];
  const isFiveColor = allColors.every((c) => allowedColors.includes(c));

  if (isFiveColor) {
    return cards;
  }

  return cards.filter((card) => {
    const cardColorIdentity = card.color_identity || [];
    return isColorSubset(cardColorIdentity, allowedColors);
  });
}

// ============================================================================
// Power/Toughness Filters
// ============================================================================

/**
 * Parse power/toughness value to number
 * Handles special cases: "*" -> 0, "1+2" -> excluded (return null)
 */
function parsePowerToughness(value: string | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  // Handle special cases
  if (value === '*') {
    return 0;
  }

  // Exclude complex values like "1+1", "2*", etc.
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Check if a number is within a range
 */
function isInRange(value: number, range: { min?: number; max?: number }): boolean {
  if (range.min !== undefined && value < range.min) {
    return false;
  }
  if (range.max !== undefined && value > range.max) {
    return false;
  }
  return true;
}

/**
 * Filter cards by creature power
 * Only applies to cards with power field (creatures)
 */
export function filterByPower(cards: MinimalCard[], range: { min?: number; max?: number }): MinimalCard[] {
  if (range.min === undefined && range.max === undefined) {
    return cards;
  }

  return cards.filter((card) => {
    const power = parsePowerToughness(card.power);

    // Only include cards with valid numeric power (creatures)
    if (power === null) {
      return false;
    }

    return isInRange(power, range);
  });
}

/**
 * Filter cards by creature toughness
 * Only applies to cards with toughness field (creatures)
 */
export function filterByToughness(cards: MinimalCard[], range: { min?: number; max?: number }): MinimalCard[] {
  if (range.min === undefined && range.max === undefined) {
    return cards;
  }

  return cards.filter((card) => {
    const toughness = parsePowerToughness(card.toughness);

    // Only include cards with valid numeric toughness (creatures)
    if (toughness === null) {
      return false;
    }

    return isInRange(toughness, range);
  });
}

// ============================================================================
// Format Legality Filter
// ============================================================================

/**
 * Supported formats for legality checks
 */
export const FORMAT_LEGALITIES = [
  'standard', 'modern', 'commander', 'legacy', 'vintage',
  'pauper', 'pioneer', 'brawl', 'gladiator', 'historic'
] as const;

/**
 * Filter cards by format legality
 */
export function filterByFormatLegality(cards: MinimalCard[], filter: FormatLegalityFilter): MinimalCard[] {
  if (!filter || !filter.format) {
    return cards;
  }

  const { format, legality } = filter;

  return cards.filter((card) => {
    const cardLegalities = card.legalities || {};
    const cardLegality = cardLegalities[format.toLowerCase()];

    if (cardLegality === undefined) {
      // If format not specified, assume not legal
      return false;
    }

    return cardLegality === legality;
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get creature cards from a card list
 * Used to enable power/toughness filtering
 */
export function getCreatures(cards: MinimalCard[]): MinimalCard[] {
  return cards.filter((c) => c.type_line?.toLowerCase().includes('creature'));
}

/**
 * Apply all filters to a card array
 *
 * Applies non-undefined filters in sequence using short-circuit evaluation
 * for efficiency. Filters are applied in optimized order:
 * 1. formatLegality (most restrictive)
 * 2. color (Commander rules)
 * 3. type (needed before P/T to identify creatures)
 * 4. cmc
 * 5. rarity
 * 6. set
 * 7. powerToughness (only on creatures)
 */
export function applyFilters(cards: MinimalCard[], filters: CardFilters): MinimalCard[] {
  let result = cards;

  // 1. Format legality (most restrictive)
  if (filters.formatLegality) {
    result = filterByFormatLegality(result, filters.formatLegality);
  }

  // 2. Color identity (Commander rules)
  if (filters.color) {
    if (filters.color.matchColorIdentity) {
      result = filterByColorIdentity(result, filters.color);
    } else {
      result = filterByColor(result, filters.color);
    }
  }

  // 3. Type filter (needed before P/T to identify creatures)
  if (filters.type) {
    result = filterByType(result, filters.type);
  }

  // 4. CMC filter
  if (filters.cmc) {
    result = filterByCMC(result, filters.cmc);
  }

  // 5. Rarity filter
  if (filters.rarity) {
    result = filterByRarity(result, filters.rarity);
  }

  // 6. Set filter
  if (filters.set) {
    result = filterBySet(result, filters.set);
  }

  // 7. Power/Toughness (only on creatures)
  if (filters.powerToughness) {
    let filtered = result;

    if (filters.powerToughness.power) {
      filtered = filterByPower(filtered, filters.powerToughness.power);
    }

    if (filters.powerToughness.toughness) {
      filtered = filterByToughness(filtered, filters.powerToughness.toughness);
    }

    result = filtered;
  }

  return result;
}

/**
 * Filter application order constant for debugging
 */
export const FILTER_ORDER: (keyof CardFilters)[] = [
  'formatLegality', 'color', 'type', 'cmc', 'rarity', 'set', 'powerToughness'
];
