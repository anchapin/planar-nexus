/**
 * Type definitions for Limited Mode (Draft/Sealed)
 *
 * Phase 14: Foundation
 * Requirements: SET-01, SET-02, SET-03
 *
 * These types define the data structures for sealed pool generation,
 * session management, and limited deck building.
 */

import type { MinimalCard } from '@/lib/card-database';
import type { ScryfallCard } from '@/app/actions';

// ============================================================================
// Scryfall Types (for Set Browser)
// ============================================================================

/**
 * Scryfall set type (from API)
 * Source: https://scryfall.com/docs/api/sets
 */
export interface ScryfallSet {
  /** Unique identifier */
  id: string;
  /** Set code (e.g., 'znr', 'mid') */
  code: string;
  /** Set name (e.g., 'Zendikar Rising') */
  name: string;
  /** Type of set (expansion, core, draft_innovation, etc.) */
  set_type: string;
  /** Total number of cards in the set */
  card_count: number;
  /** ISO 8601 date string */
  released_at: string;
  /** URL to set icon SVG */
  icon_svg_uri?: string;
}

/**
 * Sort options for set browser
 */
export type SetSortOption = 'release_date' | 'name' | 'card_count';

// ============================================================================
// Core Types
// ============================================================================

/**
 * A card in a sealed pool or draft
 * Extends ScryfallCard with pool-specific metadata
 */
export interface PoolCard extends ScryfallCard {
  /** ID of the pack this card came from (0-5 for sealed) */
  packId: number;
  /** Slot in the pack (0-13 for standard 14-card packs) */
  packSlot: number;
  /** When card was added to pool */
  addedAt: string;
  /** Whether this card is a foil variant */
  isFoil?: boolean;
}

/**
 * A card in a limited deck (built from pool)
 * Similar to DeckCard but scoped to limited session
 */
export interface LimitedDeckCard {
  /** Card data */
  card: MinimalCard;
  /** Quantity in deck */
  count: number;
  /** When added to deck */
  addedAt: string;
}

/**
 * Limited session mode
 */
export type LimitedMode = 'sealed' | 'draft';

/**
 * Limited session status
 */
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

/**
 * A sealed/draft session
 */
export interface LimitedSession {
  /** Unique session ID (UUID) - ISOL-03 */
  id: string;
  /** Set code (e.g., 'M21', 'KHM') */
  setCode: string;
  /** Human-readable set name */
  setName: string;
  /** Session mode */
  mode: LimitedMode;
  /** Session status */
  status: SessionStatus;
  /** All cards in the pool */
  pool: PoolCard[];
  /** Cards in the deck (40-card minimum for limited) */
  deck: LimitedDeckCard[];
  /** Session creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Optional session name (user-defined) */
  name?: string;
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
  /** Set code for the session */
  setCode: string;
  /** Human-readable set name */
  setName: string;
  /** Session mode */
  mode: LimitedMode;
  /** Optional session name */
  name?: string;
}

/**
 * Pool filtering options
 * Extends the base CardFilters with pool-specific options
 */
export interface PoolFilters {
  /** Color filter */
  color?: {
    mode: 'exact' | 'include' | 'exclude';
    colors: string[];
    matchColorIdentity?: boolean;
  };
  /** Type filter */
  type?: {
    supertypes?: string[];
    types?: string[];
    subtypes?: string[];
  };
  /** CMC filter */
  cmc?: {
    mode: 'exact' | 'range';
    value?: number;
    min?: number;
    max?: number;
  };
  /** Search query */
  searchQuery?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Deck validation result
 */
export interface DeckValidationResult {
  /** Is the deck valid */
  isValid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Total card count */
  totalCards: number;
  /** Unique card count */
  uniqueCards: number;
  /** Cards by type breakdown */
  typeBreakdown: {
    creatures: number;
    instants: number;
    sorceries: number;
    enchantments: number;
    artifacts: number;
    planeswalkers: number;
    lands: number;
  };
}

// ============================================================================
// Export Types
// ============================================================================

export type { MinimalCard } from '@/lib/card-database';
