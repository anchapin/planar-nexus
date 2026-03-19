/**
 * Screen query helpers
 * 
 * Provides custom query helpers for common components in the application.
 * These wrap Testing Library queries with custom prefixes for consistency.
 */

import { screen, ByRoleOptions, MatcherOptions } from '@testing-library/react';

/**
 * Common query prefixes for card game components
 */
const QUERY_PREFIXES = {
  card: 'card',
  deck: 'deck',
  hand: 'hand',
  battlefield: 'battlefield',
  library: 'library',
  graveyard: 'graveyard',
  player: 'player',
  opponent: 'opponent',
};

/**
 * Helper to create a prefixed test ID matcher
 */
function createMatcher(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

/**
 * Card query helpers
 */
export const cardQueries = {
  /**
   * Get a card by its name
   */
  getByCardName: (name: string): HTMLElement => {
    return screen.getByTestId(createMatcher(QUERY_PREFIXES.card, name.toLowerCase().replace(/\s+/g, '-')));
  },
  
  /**
   * Get all cards
   */
  getAllCards: (): HTMLElement[] => {
    return screen.getAllByTestId(/^card-/);
  },
  
  /**
   * Query for a card by name (returns null if not found)
   */
  queryByCardName: (name: string): HTMLElement | null => {
    return screen.queryByTestId(createMatcher(QUERY_PREFIXES.card, name.toLowerCase().replace(/\s+/g, '-')));
  },
  
  /**
   * Find a card by name (async)
   */
  findByCardName: (name: string): Promise<HTMLElement> => {
    return screen.findByTestId(createMatcher(QUERY_PREFIXES.card, name.toLowerCase().replace(/\s+/g, '-')));
  },
};

/**
 * Deck query helpers
 */
export const deckQueries = {
  /**
   * Get a deck by its title
   */
  getByDeckTitle: (title: string): HTMLElement => {
    return screen.getByTestId(createMatcher(QUERY_PREFIXES.deck, title.toLowerCase().replace(/\s+/g, '-')));
  },
  
  /**
   * Get all decks
   */
  getAllDecks: (): HTMLElement[] => {
    return screen.getAllByTestId(/^deck-/);
  },
  
  /**
   * Query for a deck by title
   */
  queryByDeckTitle: (title: string): HTMLElement | null => {
    return screen.queryByTestId(createMatcher(QUERY_PREFIXES.deck, title.toLowerCase().replace(/\s+/g, '-')));
  },
  
  /**
   * Get deck cards
   */
  getDeckCards: (): HTMLElement[] => {
    return screen.getAllByTestId(/^deck-card-/);
  },
};

/**
 * Game zone query helpers
 */
export const zoneQueries = {
  /**
   * Get player's hand
   */
  getPlayerHand: (): HTMLElement => {
    return screen.getByTestId('player-hand');
  },
  
  /**
   * Get opponent's hand
   */
  getOpponentHand: (): HTMLElement => {
    return screen.getByTestId('opponent-hand');
  },
  
  /**
   * Get battlefield
   */
  getBattlefield: (): HTMLElement => {
    return screen.getByTestId(QUERY_PREFIXES.battlefield);
  },
  
  /**
   * Get player's library
   */
  getPlayerLibrary: (): HTMLElement => {
    return screen.getByTestId('player-library');
  },
  
  /**
   * Get player's graveyard
   */
  getPlayerGraveyard: (): HTMLElement => {
    return screen.getByTestId('player-graveyard');
  },
};

/**
 * Player query helpers
 */
export const playerQueries = {
  /**
   * Get player by name
   */
  getByPlayerName: (name: string): HTMLElement => {
    return screen.getByTestId(createMatcher(QUERY_PREFIXES.player, name.toLowerCase().replace(/\s+/g, '-')));
  },
  
  /**
   * Get opponent
   */
  getOpponent: (): HTMLElement => {
    return screen.getByTestId(QUERY_PREFIXES.opponent);
  },
  
  /**
   * Get player life total
   */
  getPlayerLife: (name: string = 'player'): HTMLElement => {
    return screen.getByTestId(`${name}-life`);
  },
  
  /**
   * Get player mana pool
   */
  getPlayerMana: (name: string = 'player'): HTMLElement => {
    return screen.getByTestId(`${name}-mana`);
  },
};

/**
 * Generic async query helpers for loading states
 */
export const asyncQueries = {
  /**
   * Wait for an element to appear (loading complete)
   */
  waitForElement: async <T extends HTMLElement>(
    testId: string,
    timeout: number = 1000
  ): Promise<T> => {
    return screen.findByTestId(testId) as Promise<T>;
  },
  
  /**
   * Wait for loading to finish
   */
  waitForLoading: async (): Promise<void> => {
    // Wait for any loading spinner to disappear
    const loading = screen.queryByTestId('loading');
    if (loading) {
      await screen.findByTestId('loading');
    }
  },
  
  /**
   * Wait for an element to disappear
   */
  waitForHidden: async (
    testId: string,
    timeout: number = 1000
  ): Promise<void> => {
    await screen.findByTestId(testId);
  },
};

/**
 * Common role-based queries
 */
export const roleQueries = {
  /**
   * Get button by its text
   */
  getButton: (name: string | RegExp, options?: ByRoleOptions): HTMLElement => {
    return screen.getByRole('button', { name, ...options });
  },
  
  /**
   * Get all buttons
   */
  getAllButtons: (): HTMLElement[] => {
    return screen.getAllByRole('button');
  },
  
  /**
   * Get link by its text
   */
  getLink: (name: string | RegExp, options?: ByRoleOptions): HTMLElement => {
    return screen.getByRole('link', { name, ...options });
  },
  
  /**
   * Get heading by its level and text
   */
  getHeading: (level: 1 | 2 | 3 | 4 | 5 | 6, name: string | RegExp): HTMLElement => {
    return screen.getByRole('heading', { level, name });
  },
  
  /**
   * Get input by its label
   */
  getByLabel: (label: string | RegExp, options?: ByRoleOptions): HTMLElement => {
    return screen.getByLabelText(label, options);
  },
  
  /**
   * Get text content
   */
  getByText: (text: string | RegExp, options?: MatcherOptions): HTMLElement => {
    return screen.getByText(text, options);
  },
};

/**
 * Combined exports for convenience
 */
export const queries = {
  ...cardQueries,
  ...deckQueries,
  ...zoneQueries,
  ...playerQueries,
  ...asyncQueries,
  ...roleQueries,
};

export default queries;
