/**
 * Sort functions for card arrays
 *
 * Provides comprehensive sorting by CMC, color, type, rarity, set, name, power, and toughness.
 * Supports both ascending and descending sort directions.
 */
import type { MinimalCard } from '@/lib/card-database';

/**
 * Sort option types
 */
export type SortOption =
  | 'cmc'
  | 'color'
  | 'type'
  | 'rarity'
  | 'set'
  | 'name'
  | 'power'
  | 'toughness';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort configuration
 */
export interface SortConfig {
  option: SortOption;
  direction: SortDirection;
}

/**
 * Default sort configuration
 */
export const DEFAULT_SORT: SortConfig = {
  option: 'name',
  direction: 'asc',
};

/**
 * Rarity sort order map
 * Order: mythic > rare > uncommon > common
 */
const RARITY_ORDER: Record<string, number> = {
  'mythic': 4,
  'rare': 3,
  'uncommon': 2,
  'common': 1,
};

/**
 * Color sort order
 * Order: W > U > B > R > G > (colorless last)
 */
const COLOR_ORDER: Record<string, number> = {
  'W': 1,
  'U': 2,
  'B': 3,
  'R': 4,
  'G': 5,
};

/**
 * Primary type sort order
 */
const TYPE_ORDER: Record<string, number> = {
  'creature': 1,
  'planeswalker': 2,
  'sorcery': 3,
  'instant': 4,
  'enchantment': 5,
  'artifact': 6,
  'land': 7,
};

/**
 * Get primary type from type line
 */
function getPrimaryType(typeLine: string | undefined): string {
  if (!typeLine) return '';

  const lower = typeLine.toLowerCase();

  for (const [type, order] of Object.entries(TYPE_ORDER)) {
    if (lower.includes(type)) {
      return type;
    }
  }

  return '';
}

/**
 * Get color order value for sorting
 * Returns 0 for colorless/multi-color (after monocolor), higher for more colors
 */
function getColorSortValue(colors: string[]): number {
  if (colors.length === 0) return 100; // Colorless at end

  // Get highest color order (earliest in WUBRG)
  let minOrder = 100;
  for (const color of colors) {
    const order = COLOR_ORDER[color];
    if (order !== undefined && order < minOrder) {
      minOrder = order;
    }
  }

  // For multicolored, add bonus to sort after monocolor of each color
  if (colors.length > 1) {
    return minOrder + 50;
  }

  return minOrder;
}

/**
 * Sort cards by Converted Mana Cost (CMC)
 */
function byCMC(a: MinimalCard, b: MinimalCard): number {
  return (a.cmc || 0) - (b.cmc || 0);
}

/**
 * Sort cards by color
 * Sorts by first color alphabetically (W > U > B > R > G), colorless last
 */
function byColor(a: MinimalCard, b: MinimalCard): number {
  const colorA = getColorSortValue(a.colors || []);
  const colorB = getColorSortValue(b.colors || []);
  return colorA - colorB;
}

/**
 * Sort cards by primary type
 * Order: creature > planeswalker > sorcery > instant > enchantment > artifact > land
 */
function byType(a: MinimalCard, b: MinimalCard): number {
  const typeA = getPrimaryType(a.type_line);
  const typeB = getPrimaryType(b.type_line);

  const orderA = TYPE_ORDER[typeA] || 99;
  const orderB = TYPE_ORDER[typeB] || 99;

  return orderA - orderB;
}

/**
 * Sort cards by rarity
 * Order: mythic > rare > uncommon > common
 */
function byRarity(a: MinimalCard, b: MinimalCard): number {
  const rarityA = a.rarity?.toLowerCase() || '';
  const rarityB = b.rarity?.toLowerCase() || '';

  const orderA = RARITY_ORDER[rarityA] || 0;
  const orderB = RARITY_ORDER[rarityB] || 0;

  return orderB - orderA; // Descending (mythic first)
}

/**
 * Sort cards by set (alphabetical by set code)
 */
function bySet(a: MinimalCard, b: MinimalCard): number {
  const setA = a.set?.toLowerCase() || '';
  const setB = b.set?.toLowerCase() || '';

  return setA.localeCompare(setB);
}

/**
 * Sort cards by name (alphabetical)
 */
function byName(a: MinimalCard, b: MinimalCard): number {
  return (a.name || '').localeCompare(b.name || '');
}

/**
 * Parse power value to number for sorting
 * Handles special cases: "*" -> 0, non-numeric -> null
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
 * Sort cards by power (creatures only)
 * Non-creatures or non-numeric power go to end
 */
function byPower(a: MinimalCard, b: MinimalCard): number {
  const powerA = parsePowerToughness(a.power);
  const powerB = parsePowerToughness(b.power);

  // Handle nulls (push to end)
  if (powerA === null && powerB === null) return 0;
  if (powerA === null) return 1;
  if (powerB === null) return -1;

  return powerA - powerB;
}

/**
 * Sort cards by toughness (creatures only)
 * Non-creatures or non-numeric toughness go to end
 */
function byToughness(a: MinimalCard, b: MinimalCard): number {
  const toughA = parsePowerToughness(a.toughness);
  const toughB = parsePowerToughness(b.toughness);

  // Handle nulls (push to end)
  if (toughA === null && toughB === null) return 0;
  if (toughA === null) return 1;
  if (toughB === null) return -1;

  return toughA - toughB;
}

/**
 * Main sort function
 *
 * @param cards - Array of cards to sort
 * @param config - Sort configuration (option + direction)
 * @returns Sorted array
 */
export function sortCards(cards: MinimalCard[], config: SortConfig): MinimalCard[] {
  if (!cards || cards.length === 0) {
    return [];
  }

  const { option, direction } = config;

  // Create a copy to avoid mutating original
  const sorted = [...cards];

  // Select sort function
  let sortFn: (a: MinimalCard, b: MinimalCard) => number;

  switch (option) {
    case 'cmc':
      sortFn = byCMC;
      break;
    case 'color':
      sortFn = byColor;
      break;
    case 'type':
      sortFn = byType;
      break;
    case 'rarity':
      sortFn = byRarity;
      break;
    case 'set':
      sortFn = bySet;
      break;
    case 'name':
      sortFn = byName;
      break;
    case 'power':
      sortFn = byPower;
      break;
    case 'toughness':
      sortFn = byToughness;
      break;
    default:
      sortFn = byName;
  }

  // Apply sort
  sorted.sort(sortFn);

  // Reverse if descending
  if (direction === 'desc') {
    sorted.reverse();
  }

  return sorted;
}

/**
 * Sort by multiple criteria
 *
 * @param cards - Array of cards to sort
 * @param configs - Array of sort configurations (applied in order)
 * @returns Sorted array
 */
export function sortCardsMulti(cards: MinimalCard[], configs: SortConfig[]): MinimalCard[] {
  if (!cards || cards.length === 0) {
    return [];
  }

  if (configs.length === 0) {
    return [...cards];
  }

  const sorted = [...cards];

  sorted.sort((a, b) => {
    for (const config of configs) {
      const result = sortPair(a, b, config);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  });

  return sorted;
}

/**
 * Sort a single pair by a config
 */
function sortPair(a: MinimalCard, b: MinimalCard, config: SortConfig): number {
  let result: number;

  const { option, direction } = config;

  switch (option) {
    case 'cmc':
      result = byCMC(a, b);
      break;
    case 'color':
      result = byColor(a, b);
      break;
    case 'type':
      result = byType(a, b);
      break;
    case 'rarity':
      result = byRarity(a, b);
      break;
    case 'set':
      result = bySet(a, b);
      break;
    case 'name':
      result = byName(a, b);
      break;
    case 'power':
      result = byPower(a, b);
      break;
    case 'toughness':
      result = byToughness(a, b);
      break;
    default:
      result = byName(a, b);
  }

  // Reverse for descending
  if (direction === 'desc') {
    result = -result;
  }

  return result;
}
