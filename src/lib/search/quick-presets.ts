/**
 * Quick presets for card search filters
 *
 * Built-in filter presets that users can quickly apply without saving custom presets.
 * Organized by category: CMC, Type, Rarity, Color.
 */

import type { FilterState } from './filter-types';

/**
 * Quick preset definition
 */
export interface QuickPreset {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: 'cmc' | 'type' | 'rarity' | 'color';
  filters: FilterState;
}

/**
 * Built-in quick presets organized by category
 */
export const QUICK_PRESETS: QuickPreset[] = [
  // CMC presets
  {
    id: 'creatures-under-3',
    name: 'Creatures under 3 mana',
    description: 'Low-cost creatures for early game',
    category: 'cmc',
    filters: {
      cmc: { mode: 'range', max: 2 },
      type: { types: ['creature'] },
    },
  },
  {
    id: 'powerful-spells',
    name: 'Powerful spells (CMC 5+)',
    description: 'High-impact cards for late game',
    category: 'cmc',
    filters: {
      cmc: { mode: 'range', min: 5 },
    },
  },

  // Type presets
  {
    id: 'legendary-creatures',
    name: 'Legendary creatures',
    description: 'Legendary creatures - great commanders',
    category: 'type',
    filters: {
      type: { types: ['creature'], supertypes: ['legendary'] },
    },
  },
  {
    id: 'artifacts',
    name: 'Artifacts',
    description: 'All artifact cards',
    category: 'type',
    filters: {
      type: { types: ['artifact'] },
    },
  },
  {
    id: 'instants-sorceries',
    name: 'Instants & Sorceries',
    description: 'Spells for instant speed tricks',
    category: 'type',
    filters: {
      type: { types: ['instant', 'sorcery'] },
    },
  },
  {
    id: 'lands',
    name: 'Lands',
    description: 'Land cards for mana fixing',
    category: 'type',
    filters: {
      type: { types: ['land'] },
    },
  },

  // Rarity presets
  {
    id: 'rares-mythics',
    name: 'Rares & Mythics',
    description: 'Powerful rare and mythic rare cards',
    category: 'rarity',
    filters: {
      rarity: { rarities: ['rare', 'mythic'] },
    },
  },
  {
    id: 'commons-only',
    name: 'Commons only',
    description: 'Budget-friendly common cards',
    category: 'rarity',
    filters: {
      rarity: { rarities: ['common'] },
    },
  },

  // Color presets - Mono color
  {
    id: 'white-cards',
    name: 'White cards',
    description: 'White-aligned cards',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: ['W'] },
    },
  },
  {
    id: 'blue-cards',
    name: 'Blue cards',
    description: 'Blue-aligned cards',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: ['U'] },
    },
  },
  {
    id: 'black-cards',
    name: 'Black cards',
    description: 'Black-aligned cards',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: ['B'] },
    },
  },
  {
    id: 'red-cards',
    name: 'Red cards',
    description: 'Red-aligned cards',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: ['R'] },
    },
  },
  {
    id: 'green-cards',
    name: 'Green cards',
    description: 'Green-aligned cards',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: ['G'] },
    },
  },
  {
    id: 'colorless-cards',
    name: 'Colorless cards',
    description: 'Colorless cards (no color identity)',
    category: 'color',
    filters: {
      color: { mode: 'exact', colors: [] },
    },
  },

  // Color presets - Multi color
  // Note: Multicolor filtering (2+ colors) requires extended ColorFilter - disabled for now
  // {
  //   id: 'multicolor-cards',
  //   name: 'Multicolor cards',
  //   description: 'Cards with two or more colors',
  //   category: 'color',
  //   filters: {
  //     color: { mode: 'include', colors: ['W', 'U', 'B', 'R', 'G'], min: 2 },
  //   },
  // },
];

/**
 * Get a quick preset by its ID
 * @param id - The preset ID to look up
 * @returns The preset if found, undefined otherwise
 */
export function getPresetById(id: string): QuickPreset | undefined {
  return QUICK_PRESETS.find((preset) => preset.id === id);
}

/**
 * Get presets grouped by category
 */
export function getPresetsByCategory(): Record<QuickPreset['category'], QuickPreset[]> {
  return QUICK_PRESETS.reduce(
    (acc, preset) => {
      acc[preset.category].push(preset);
      return acc;
    },
    { cmc: [], type: [], rarity: [], color: [] } as Record<QuickPreset['category'], QuickPreset[]>
  );
}
