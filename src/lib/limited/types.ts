/**
 * Type definitions for Limited Mode (Draft/Sealed)
 *
 * Phase 14: Foundation
 * Requirements: SET-01, SET-02, SET-03
 *
 * These types define the data structures for sealed pool generation,
 * session management, and limited deck building.
 */

import type { MinimalCard } from "@/lib/card-database";
import type { ScryfallCard } from "@/app/actions";

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
export type SetSortOption = "release_date" | "name" | "card_count";

// ============================================================================
// Draft Types (Phase 15)
// ============================================================================

/**
 * Draft state machine states
 * DRFT-04: Visual states for draft flow
 */
export type DraftState =
  "intro" | "picking" | "pack_complete" | "draft_complete";

/**
 * AI neighbor difficulty levels (NEIB-03)
 */
export type AiDifficulty = "easy" | "medium";

/**
 * Archetype axis the AI is telegraphing during a draft pick.
 *
 * - 'aggro'    — low-curve, aggressive creatures / burn
 * - 'control'  — high-curve, removal / counters
 * - 'midrange' — flexible curve, value creatures
 * - 'combo'    — synergy / engine pieces
 * - 'undecided'— pool too sparse or colors too mixed to classify
 *
 * Mapped from the existing `archetype-detector` pipeline (`detectArchetype`).
 * Issue #1404.
 */
export type ArchetypeAxis =
  "aggro" | "control" | "midrange" | "combo" | "undecided";

/**
 * Curve shift direction for a single pick.
 * 'faster' = pick dropped average CMC vs the prior pool; 'slower' = raised it; 'flat' = no change.
 */
export type CurveShift = "faster" | "slower" | "flat";

/**
 * Reason tag for why the AI made a particular pick.
 */
export type PickReason =
  "color-fix" | "curve" | "premium" | "removal" | "random";

/**
 * Real-time archetype signal emitted by the AI neighbor after each pick.
 *
 * Consumed by the draft UI to surface "what is the AI signaling?" chips and
 * by the post-deck `archetype-detector` for the final deck-classification
 * round. Issue #1404.
 */
export interface ArchetypeSignal {
  /** Which archetype axis the running pool is telegraphing. */
  archetypeAxis: ArchetypeAxis;
  /** Single most-dominant color in the pool after this pick (lowercase), null if none. */
  dominantColor: string | null;
  /** Confidence from `detectArchetype`, 0-1. Sparse pools report ~0. */
  confidence: number;
  /** How this pick shifted the pool's average CMC. */
  curveShift: CurveShift;
  /** Tag for the heuristic that drove this pick. */
  reason: PickReason;
  /** Wall-clock time of the pick (ms since epoch). */
  pickedAt: number;
  /** 1-based pick number within the AI's run (1 = first AI pick). */
  pickNumber: number;
}

/**
 * AI neighbor state during drafting (NEIB-01, NEIB-03)
 *
 * Extended by issue #1404 with `lastPickReason` (the most recent signal) and a
 * rolling `archetypeSignals` buffer (capped at {@link ARCHETYPE_SIGNAL_BUFFER_SIZE})
 * that downstream UI / analytics can replay.
 */
export interface AiNeighborState {
  /** Current pool of cards the AI has picked */
  pool: PoolCard[];
  /** Is AI currently picking (for visual indicator - NEIB-04) */
  isPicking: boolean;
  /** Time when AI started current pick */
  pickStartTime: number | null;
  /** Most recent archetype signal (null until the first AI pick completes). Issue #1404. */
  lastPickReason: ArchetypeSignal | null;
  /**
   * Rolling buffer of the last few archetype signals, oldest first. Capped at
   * {@link ARCHETYPE_SIGNAL_BUFFER_SIZE}. Issue #1404.
   */
  archetypeSignals: ArchetypeSignal[];
}

/**
 * Maximum number of recent archetype signals retained in `AiNeighborState.archetypeSignals`.
 * Five picks gives enough context to spot a pivot without unbounded growth.
 * Issue #1404.
 */
export const ARCHETYPE_SIGNAL_BUFFER_SIZE = 5;

/**
 * AI neighbor configuration and state (NEIB-01, NEIB-03)
 */
export interface AiNeighbor {
  /** Is AI neighbor enabled for this draft */
  enabled: boolean;
  /** Difficulty level */
  difficulty: AiDifficulty;
  /** Delay before AI picks (ms) */
  pickDelay: number;
  /** Current AI state during drafting */
  state: AiNeighborState;
}

/**
 * Who currently has the active pack (NEIB-05)
 */
export type PackHolder = "user" | "ai";

/**
 * A card in draft (with draft-specific metadata)
 * Extends PoolCard with draft-specific fields
 */
export interface DraftCard extends PoolCard {
  // Inherits: packId, packSlot, addedAt, isFoil from PoolCard
  // Adds draft-specific:
  pickedAt?: string; // When card was picked
}

/**
 * Draft pack - cards hidden until opened
 * DRFT-03: Cards face-down until user opens pack
 */
export interface DraftPack {
  /** Unique pack ID */
  id: string;
  /** All 14 cards in pack */
  cards: DraftCard[];
  /** DRFT-03: Are cards revealed? */
  isOpened: boolean;
  /** Cards already picked from this pack */
  pickedCardIds: string[];
}

/**
 * Draft card for display (shows card or face-down)
 * DRFT-03: Visual representation of cards in pack
 */
export interface DraftDisplayCard {
  id: string;
  /** null = face-down */
  card: DraftCard | null;
  isFaceDown: boolean;
  isPicked: boolean;
  packIndex: number;
  slot: number;
}

/**
 * Draft session - extends LimitedSession with draft state
 * DRFT-01: Session creation with UUID
 * DRFT-02: 3 packs of 14 cards
 * DRFT-05: Pack-by-pack drafting
 * NEIB-01: AI neighbor support
 * NEIB-05: Pack holder tracking
 */
export interface DraftSession extends LimitedSession {
  mode: "draft"; // Override to 'draft'
  /** Current state in draft flow */
  draftState: DraftState;
  /** 0-2 for 3 packs */
  currentPackIndex: number;
  /** 0-13 for 14 picks per pack */
  currentPickIndex: number;
  /** All 3 packs */
  packs: DraftPack[];
  /** DRFT-06: Current timer value */
  timerSeconds: number;
  /** DRFT-08: For auto-pick functionality */
  lastHoveredCardId: string | null;
  /** NEIB-01: AI neighbor configuration and state */
  aiNeighbor?: AiNeighbor;
  /** NEIB-05: Track who has the active pack */
  currentPackHolder: PackHolder;
}

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
export type LimitedMode = "sealed" | "draft";

/**
 * Limited session status
 */
export type SessionStatus = "in_progress" | "completed" | "abandoned";

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
    mode: "exact" | "include" | "exclude";
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
    mode: "exact" | "range";
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

export type { MinimalCard } from "@/lib/card-database";
// Note: AiDifficulty, AiNeighborState, AiNeighbor, PackHolder are exported inline above

/**
 * Create draft session options
 * NEIB-01: AI neighbor configuration
 */
export interface CreateDraftSessionOptions {
  /** AI neighbor configuration */
  aiNeighbor?: {
    enabled: boolean;
    difficulty: AiDifficulty;
    pickDelay?: number;
  };
}
