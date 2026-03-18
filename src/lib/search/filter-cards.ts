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
 * Apply all filters to a card array
 *
 * Applies non-undefined filters in sequence using short-circuit evaluation
 * for efficiency. Filters are applied in this order:
 * 1. searchQuery (handled externally via Fuse.js)
 * 2. cmc
 * 3. type
 * 4. rarity
 * 5. set
 * 6. color
 */
export function applyFilters(cards: MinimalCard[], filters: CardFilters): MinimalCard[] {
  let result = cards;

  // Apply CMC filter
  if (filters.cmc) {
    result = filterByCMC(result, filters.cmc);
  }

  // Apply type filter
  if (filters.type) {
    result = filterByType(result, filters.type);
  }

  // Apply rarity filter
  if (filters.rarity) {
    result = filterByRarity(result, filters.rarity);
  }

  // Apply set filter
  if (filters.set) {
    result = filterBySet(result, filters.set);
  }

  // Apply color filter
  if (filters.color) {
    result = filterByColor(result, filters.color);
  }

  return result;
}
