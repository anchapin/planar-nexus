/**
 * Set Service - Scryfall API integration for MTG set data
 * 
 * Phase 14: Foundation
 * Requirements: SET-01, SET-02, SET-03
 * 
 * Provides:
 * - fetchAllSets(): Fetch all sets from Scryfall
 * - sortSets(): Sort sets by date, name, or card count
 * - getSetDetails(): Get single set by code
 * 
 * Features:
 * - 24-hour in-memory cache to avoid rate limiting
 * - Fallback to cached data on network errors
 * - Error handling with descriptive messages
 */

import type { ScryfallSet, SetSortOption } from './types';

// ============================================================================
// Constants
// ============================================================================

const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const setCache: CacheEntry<ScryfallSet[]> = {
  data: [],
  timestamp: 0,
};

const setCodeIndex = new Map<string, ScryfallSet>();

// ============================================================================
// API Functions
// ============================================================================

/**
 * Check if cache is still valid
 */
function isCacheValid(): boolean {
  return Date.now() - setCache.timestamp < CACHE_DURATION_MS;
}

/**
 * Fetch all sets from Scryfall API
 * Results are cached for 24 hours
 * 
 * @returns Promise resolving to array of ScryfallSet
 * @throws Error if fetch fails and no cache available
 */
export async function fetchAllSets(): Promise<ScryfallSet[]> {
  // Return cached data if valid
  if (isCacheValid() && setCache.data.length > 0) {
    return setCache.data;
  }

  try {
    const response = await fetch(SCRYFALL_SETS_URL);

    if (!response.ok) {
      throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const sets: ScryfallSet[] = data.data;

    // Update cache
    setCache.data = sets;
    setCache.timestamp = Date.now();

    // Build code index
    setCodeIndex.clear();
    for (const set of sets) {
      setCodeIndex.set(set.code.toLowerCase(), set);
    }

    return sets;
  } catch (error) {
    // If fetch fails, try to return cached data
    if (setCache.data.length > 0) {
      console.warn('Failed to fetch sets from API, using cached data:', error);
      return setCache.data;
    }

    // No cache available, re-throw error
    if (error instanceof Error) {
      throw new Error(`Failed to fetch sets: ${error.message}`);
    }
    throw new Error('Failed to fetch sets from Scryfall');
  }
}

/**
 * Sort sets by the specified option
 * 
 * @param sets - Array of sets to sort
 * @param option - Sort option (release_date, name, card_count)
 * @param ascending - Sort direction (default: true for name, false for date/count)
 * @returns Sorted array of sets
 */
export function sortSets(
  sets: ScryfallSet[],
  option: SetSortOption = 'release_date',
  ascending = false
): ScryfallSet[] {
  if (!sets || sets.length === 0) {
    return [];
  }

  const sortedSets = [...sets];

  switch (option) {
    case 'release_date':
      // Newest first by default (descending)
      sortedSets.sort((a, b) => {
        const dateA = a.released_at ? new Date(a.released_at).getTime() : 0;
        const dateB = b.released_at ? new Date(b.released_at).getTime() : 0;
        return ascending ? dateA - dateB : dateB - dateA;
      });
      break;

    case 'name':
      // A-Z by default (ascending)
      sortedSets.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        return ascending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      });
      break;

    case 'card_count':
      // Most cards first by default (descending)
      sortedSets.sort((a, b) => {
        return ascending ? a.card_count - b.card_count : b.card_count - a.card_count;
      });
      break;

    default:
      // Keep original order
      break;
  }

  return sortedSets;
}

/**
 * Get details for a specific set by code
 * 
 * @param code - Set code (e.g., 'znr', 'mid')
 * @returns Promise resolving to ScryfallSet or null if not found
 */
export async function getSetDetails(code: string): Promise<ScryfallSet | null> {
  if (!code) {
    return null;
  }

  const normalizedCode = code.toLowerCase().trim();

  // Check if we have sets loaded
  if (setCache.data.length === 0) {
    // Fetch all sets first
    await fetchAllSets();
  }

  // Check code index
  const set = setCodeIndex.get(normalizedCode);
  return set || null;
}

/**
 * Clear the set cache (for testing or forced refresh)
 */
export function clearSetCache(): void {
  setCache.data = [];
  setCache.timestamp = 0;
  setCodeIndex.clear();
}

/**
 * Get set types that are valid for limited play
 * Filters out tokens, memorabilia, etc.
 */
export function getLimitedPlayableSetTypes(): string[] {
  return [
    'expansion',
    'core',
    'masters',
    'draft_innovation',
    'commander',
    'planechase',
    'conspiracy',
    'reprint',
  ];
}

/**
 * Filter sets to only playable set types
 * 
 * @param sets - Array of sets to filter
 * @returns Filtered array of sets suitable for limited play
 */
export function filterPlayableSets(sets: ScryfallSet[]): ScryfallSet[] {
  const playableTypes = getLimitedPlayableSetTypes();
  return sets.filter(set => playableTypes.includes(set.set_type));
}

/**
 * Get a friendly name for a set type
 * 
 * @param setType - Raw set type from Scryfall
 * @returns Human-readable name
 */
export function getSetTypeDisplayName(setType: string): string {
  const displayNames: Record<string, string> = {
    expansion: 'Expansion',
    core: 'Core Set',
    masters: 'Masters Set',
    draft_innovation: 'Draft Innovation',
    commander: 'Commander Set',
    planechase: 'Planechase',
    conspiracy: 'Conspiracy',
    reprint: 'Reprint Set',
    starter: 'Starter Set',
    token: 'Token Set',
    memorabilia: 'Memorabilia',
    minigame: 'Minigame',
  };

  return displayNames[setType] || setType;
}
