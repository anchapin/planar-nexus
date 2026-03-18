/**
 * Fuzzy search module with Levenshtein distance, partial matching, and synonyms
 *
 * Provides enhanced fuzzy search capabilities for Magic: The Gathering card search:
 * - Levenshtein distance <= 2 for typo tolerance (FUZZY-01)
 * - Partial word matching (FUZZY-02)
 * - Synonym matching (FUZZY-03)
 */
import Fuse, { IFuseOptions } from 'fuse.js';
import type { MinimalCard } from '@/lib/card-database';
import { FUSE_SEARCH_OPTIONS } from '@/lib/card-database';

/**
 * Fuzzy search options
 */
export interface FuzzySearchOptions {
  /** Maximum Levenshtein distance for typo tolerance (default: 2) */
  threshold?: number;
  /** Enable partial word matching (default: true) */
  enablePartial?: boolean;
  /** Enable synonym matching (default: true) */
  enableSynonyms?: boolean;
}

/**
 * Default fuzzy search options
 */
const DEFAULT_FUZZY_OPTIONS: FuzzySearchOptions = {
  threshold: 2,
  enablePartial: true,
  enableSynonyms: true,
};

/**
 * Synonym map for common Magic: The Gathering terms
 * Maps canonical terms to their synonyms for expanded search
 */
export const SYNONYM_MAP: Record<string, string[]> = {
  'damage': ['damage', 'deals damage', 'deals'],
  'draw': ['draw', 'draw a card', 'card draw'],
  'destroy': ['destroy', 'destroy target', 'destroyed'],
  'counter': ['counter', 'counter target', 'countered'],
  'search': ['search', 'search library', 'search your library'],
  'mill': ['mill', 'mill target', 'put into graveyard'],
  'ramp': ['ramp', 'mana', 'add mana', 'produce mana'],
  'removal': ['destroy', 'exile', 'remove from game'],
  'flying': ['flying', 'fly'],
  'trample': ['trample', 'trample'],
  'lifelink': ['lifelink', 'life link', 'gain life'],
  'deathtouch': ['deathtouch', 'death touch'],
  'haste': ['haste'],
  'flash': ['flash'],
  'vigilance': ['vigilance'],
};

/**
 * Calculate Levenshtein edit distance between two strings
 *
 * This is used for typo tolerance - FUZZY-01 requires distance <= 2
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance between the two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Quick check: if strings are equal, distance is 0
  if (aLower === bLower) return 0;

  // Quick check: length difference > threshold means can't be within distance
  const maxThreshold = 2;
  if (Math.abs(aLower.length - bLower.length) > maxThreshold) {
    return maxThreshold + 1;
  }

  // Create matrix for dynamic programming
  const matrix: number[][] = [];

  // Initialize first row
  for (let i = 0; i <= aLower.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first column
  for (let j = 0; j <= bLower.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= aLower.length; i++) {
    for (let j = 1; j <= bLower.length; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[aLower.length][bLower.length];
}

/**
 * Check if a query partially matches text
 *
 * Handles FUZZY-02: "bolt" matches "Lightning Bolt", "draw" matches "draw a card"
 *
 * @param text - Text to search in
 * @param query - Query to match
 * @returns true if any token in query matches part of text
 */
export function partialMatch(text: string, query: string): boolean {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Split query into words/tokens
  const tokens = queryLower.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length === 0) return false;

  // Check if ANY token matches part of the text
  return tokens.some(token => {
    // Check if token is a substring of text
    if (textLower.includes(token)) return true;

    // Also check word boundaries - token matches if it starts a word
    const wordPattern = new RegExp(`\\b${escapeRegex(token)}`, 'i');
    return wordPattern.test(textLower);
  });
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expand a query with synonyms
 *
 * Given a query, returns original plus synonym variations for expanded search
 *
 * @param query - Original search query
 * @returns Array of query variations including synonyms
 */
export function expandWithSynonyms(query: string): string[] {
  const queryLower = query.toLowerCase();
  const variations: Set<string> = new Set([queryLower]);

  // Check each word against synonym map
  const words = queryLower.split(/\s+/);

  for (const word of words) {
    // Find canonical form (check if word is a value in SYNONYM_MAP)
    for (const [canonical, synonyms] of Object.entries(SYNONYM_MAP)) {
      if (synonyms.some(s => s === word) || canonical === word) {
        // Add all synonyms including canonical form
        synonyms.forEach(s => variations.add(s));
        variations.add(canonical);
      }
    }
  }

  return Array.from(variations);
}

/**
 * Check if a card matches a query using fuzzy criteria
 *
 * @param card - Card to check
 * @param query - Search query
 * @param options - Search options
 * @returns true if card matches
 */
function cardMatchesFuzzy(
  card: MinimalCard,
  query: string,
  options: FuzzySearchOptions
): boolean {
  const queryLower = query.toLowerCase();
  const threshold = options.threshold ?? DEFAULT_FUZZY_OPTIONS.threshold!;

  // Search fields: name, type_line, oracle_text
  const searchableText = [
    card.name,
    card.type_line || '',
    card.oracle_text || '',
  ].join(' ').toLowerCase();

  // 1. Direct substring match (case-insensitive)
  if (searchableText.includes(queryLower)) {
    return true;
  }

  // 2. Levenshtein distance check on individual words
  const queryWords = queryLower.split(/\s+/);
  const textWords = searchableText.split(/\s+/);

  for (const qWord of queryWords) {
    if (qWord.length < 2) continue; // Skip single characters

    for (const tWord of textWords) {
      if (tWord.length < 2) continue;

      const distance = levenshteinDistance(qWord, tWord);
      if (distance <= threshold) {
        return true;
      }
    }
  }

  // 3. Partial matching if enabled
  if (options.enablePartial !== false && partialMatch(searchableText, query)) {
    return true;
  }

  // 4. Synonym matching if enabled
  if (options.enableSynonyms !== false) {
    const expandedQueries = expandWithSynonyms(query);

    for (const expandedQuery of expandedQueries) {
      if (searchableText.includes(expandedQuery)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Perform fuzzy search on card array
 *
 * Combines Fuse.js with additional Levenshtein filtering, partial matching,
 * and synonym expansion to meet all fuzzy search requirements.
 *
 * @param cards - Array of cards to search
 * @param query - Search query string
 * @param options - Optional fuzzy search options
 * @returns Filtered array of matching cards
 */
export function fuzzySearch(
  cards: MinimalCard[],
  query: string,
  options?: FuzzySearchOptions
): MinimalCard[] {
  if (!query || query.length < 2) {
    return cards;
  }

  const opts = { ...DEFAULT_FUZZY_OPTIONS, ...options };
  const queryLower = query.toLowerCase();

  // First, use Fuse.js for initial matching with relaxed threshold
  const fuseOptions: IFuseOptions<MinimalCard> = {
    ...FUSE_SEARCH_OPTIONS,
    threshold: 0.4, // More relaxed for initial pass
  };

  const fuse = new Fuse(cards, fuseOptions);
  const fuseResults = fuse.search(queryLower);

  // Get Fuse.js matches
  const fuseMatches = new Set(fuseResults.map(r => r.item.id));

  // Apply additional fuzzy filtering for FUZZY-01 (Levenshtein <= 2)
  const threshold = opts.threshold ?? DEFAULT_FUZZY_OPTIONS.threshold!;

  const fuzzyMatches = cards.filter(card => {
    // Include if already in Fuse results
    if (fuseMatches.has(card.id)) {
      return true;
    }

    // Apply strict fuzzy matching
    return cardMatchesFuzzy(card, query, opts);
  });

  return fuzzyMatches;
}

/**
 * Check if a query matches a card name with typo tolerance
 *
 * Utility function for direct name matching with Levenshtein distance
 *
 * @param cardName - Card name to check
 * @param query - Search query
 * @param maxDistance - Maximum Levenshtein distance (default: 2)
 * @returns true if name matches within tolerance
 */
export function fuzzyMatchName(cardName: string, query: string, maxDistance: number = 2): boolean {
  const nameLower = cardName.toLowerCase();
  const queryLower = query.toLowerCase();

  // Direct match
  if (nameLower.includes(queryLower)) {
    return true;
  }

  // Levenshtein distance check
  return levenshteinDistance(queryLower, nameLower) <= maxDistance;
}
