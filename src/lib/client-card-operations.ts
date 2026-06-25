/**
 * @fileOverview Client-side card operations
 *
 * These functions work in the browser without server actions.
 * Use these when running in static export mode (Tauri/PWA).
 * All operations use the local IndexedDB card database for offline functionality.
 */

import type { ScryfallCard, DeckCard } from '@/app/actions';
import { initializeCardDatabase, searchCardsOffline, getCardByName } from '@/lib/card-database';
import { type Format } from '@/lib/game-rules';
import {
  sanitizeCardInput,
  aggregateCardsById,
  parseDecklistWithErrors,
  buildSuggestion,
  type DecklistFormat,
  type ImportError,
  type ParsedCardWithLine,
} from './decklist-utils';

/**
 * Detailed result of importing a decklist.
 *
 * Extends the legacy `{ found, notFound, illegal }` shape with line-level
 * errors and suggestions so the UI can show exactly what failed and why.
 */
export interface ImportDeckResult {
  /** Cards successfully resolved and legal in the target format. */
  found: DeckCard[];
  /** Legacy flat list of unresolved card names (back-compat). */
  notFound: string[];
  /** Legacy flat list of illegal card names (back-compat). */
  illegal: string[];
  /** Line-level errors with codes and suggestions. */
  errors: ImportError[];
  /** UNKNOWN_CARD errors, each carrying a "Did you mean?" suggestion when possible. */
  unknownCards: ImportError[];
  /** ILLEGAL_CARD errors tied to their source lines. */
  illegalCardErrors: ImportError[];
  /** Total number of non-blank lines that were parsed. */
  parsedLineCount: number;
  /** Aggregate count of cards successfully imported. */
  successCount: number;
  /** Whether any cards were imported at all. */
  success: boolean;
}

/**
 * Search for cards using local IndexedDB database with fuzzy search
 * This provides instant results and works offline
 */
export async function searchCardsClient(query: string, format?: Format): Promise<ScryfallCard[]> {
  if (!query || query.length < 3) {
    return [];
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    // Perform fuzzy search
    const results = await searchCardsOffline(query, {
      maxCards: 50,
      format: format || 'commander',
      includeImages: true,
    });

    return results as ScryfallCard[];
  } catch (error) {
    console.error("Failed to search local card database", error);
    return [];
  }
}

/**
 * Fetch a card by name from local database
 */
export async function fetchCardByNameClient(name: string): Promise<ScryfallCard | null> {
  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    const card = await getCardByName(name);
    return card as ScryfallCard || null;
  } catch (error) {
    console.error("Failed to fetch card from local database:", error);
    return null;
  }
}

/**
 * Validate card legality using local IndexedDB database
 * This works offline and provides instant results
 */
export async function validateCardLegalityClient(
  cards: { name: string; quantity: number }[],
  format: Format
): Promise<{ found: DeckCard[]; notFound: string[]; illegal: string[] }> {
  if (!cards || cards.length === 0) {
    return { found: [], notFound: [], illegal: [] };
  }

  try {
    // Ensure database is initialized
    await initializeCardDatabase();

    const { cardMap, malformedInputs } = sanitizeCardInput(cards);

    if (cardMap.size === 0) {
      return { found: [], notFound: malformedInputs, illegal: [] };
    }

    // Fetch from local database - use Promise.all for parallel processing
    const cardLookupPromises = Array.from(cardMap.entries()).map(async ([lowerCaseName, requestDetails]) => {
      try {
        const dbCard = await getCardByName(requestDetails.originalName);

        if (dbCard) {
          const isLegal = dbCard.legalities?.[format] === 'legal';
          return {
            card: dbCard,
            quantity: requestDetails.quantity,
            originalName: requestDetails.originalName,
            isLegal,
            lowerCaseName,
          };
        }

        return null;
      } catch (error) {
        console.error(`Failed to fetch card: ${requestDetails.originalName}`, error);
        return null;
      }
    });

    const lookupResults = await Promise.all(cardLookupPromises);

    const found: DeckCard[] = [];
    const illegal: string[] = [];
    const notFoundNames = new Set<string>(cardMap.keys());

    for (const result of lookupResults) {
      if (!result) continue;

      const { card, quantity, originalName, isLegal, lowerCaseName } = result;

      notFoundNames.delete(lowerCaseName);

      if (isLegal) {
        found.push({ ...card, count: quantity } as DeckCard);
      } else {
        illegal.push(originalName);
      }
    }

    const notFound = Array.from(notFoundNames).map(name => cardMap.get(name)!.originalName);

    return { found, notFound: [...notFound, ...malformedInputs], illegal };
  } catch (error) {
    console.error('Failed to validate card legality from local database', error);
    return { found: [], notFound: cards.map(c => c.name), illegal: [] };
  }
}

/**
 * Suggest a closest matching card name for an unknown card.
 *
 * Uses the offline fuzzy search first (which understands card data), falling
 * back to `undefined` when nothing reasonable is found. Results are not
 * filtered by format so that misspellings of any printed card can be suggested.
 */
async function suggestCardName(name: string): Promise<string | undefined> {
  if (!name || name.trim().length < 2) return undefined;

  try {
    await initializeCardDatabase();
    const matches = await searchCardsOffline(name, { maxCards: 1 });
    if (matches.length > 0 && matches[0]?.name) {
      return matches[0].name;
    }
  } catch (error) {
    console.error('Failed to build suggestion for card:', name, error);
  }

  return undefined;
}

/**
 * Import a decklist (client-side).
 *
 * Returns a detailed result including line-level errors and "Did you mean?"
 * suggestions for cards that could not be matched to the local database.
 * The legacy `{ found, notFound, illegal }` fields are preserved so existing
 * callers keep working.
 */
export async function importDecklistClient(
  decklist: string,
  decklistFormat?: DecklistFormat,
  format?: Format
): Promise<ImportDeckResult> {
  const empty: ImportDeckResult = {
    found: [],
    notFound: [],
    illegal: [],
    errors: [],
    unknownCards: [],
    illegalCardErrors: [],
    parsedLineCount: 0,
    successCount: 0,
    success: false,
  };

  const formatToUse = format || 'commander';

  if (!decklist || !decklist.trim()) {
    return empty;
  }

  // Parse with line tracking so errors can reference source line numbers.
  const { cards: parsedCards, errors: structuralErrors } = parseDecklistWithErrors(
    decklist,
    decklistFormat,
  );

  if (parsedCards.length === 0 && structuralErrors.length === 0) {
    return empty;
  }

  // Keep the legacy validation path (DB lookup + legality) for the found set.
  const { found, notFound, illegal } = await validateCardLegalityClient(
    parsedCards.map((c) => ({ name: c.name, quantity: c.quantity })),
    formatToUse,
  );

  const aggregatedFound = aggregateCardsById(found);

  // Build a quick lookup from parsed name (lowercased) -> source line info so we
  // can attach line numbers and original content to UNKNOWN_CARD / ILLEGAL_CARD errors.
  const parsedByLowerName = new Map<string, ParsedCardWithLine>();
  for (const card of parsedCards) {
    parsedByLowerName.set(card.name.toLowerCase(), card);
  }

  const unknownCardErrors: ImportError[] = [];
  const illegalCardErrors: ImportError[] = [];

  // UNKNOWN_CARD errors with suggestions (resolve suggestions in parallel).
  const unknownSuggestions = await Promise.all(
    notFound.map(async (name) => {
      const suggestion = await suggestCardName(name);
      return { name, suggestion };
    }),
  );

  for (const { name, suggestion } of unknownSuggestions) {
    const source = parsedByLowerName.get(name.toLowerCase());
    unknownCardErrors.push({
      line: source?.line ?? 0,
      content: source?.content ?? name,
      error: 'UNKNOWN_CARD',
      cardName: name,
      suggestion: buildSuggestion(suggestion),
    });
  }

  // ILLEGAL_CARD errors tied to their source lines.
  for (const name of illegal) {
    const source = parsedByLowerName.get(name.toLowerCase());
    illegalCardErrors.push({
      line: source?.line ?? 0,
      content: source?.content ?? name,
      error: 'ILLEGAL_CARD',
      cardName: name,
      suggestion: `Not legal in ${formatToUse}`,
    });
  }

  const errors: ImportError[] = [
    ...structuralErrors,
    ...unknownCardErrors,
    ...illegalCardErrors,
  ].sort((a, b) => a.line - b.line);

  const successCount = aggregatedFound.reduce((acc, card) => acc + card.count, 0);

  return {
    found: aggregatedFound,
    notFound,
    illegal,
    errors,
    unknownCards: unknownCardErrors,
    illegalCardErrors,
    parsedLineCount: parsedCards.length + structuralErrors.length,
    successCount,
    success: aggregatedFound.length > 0,
  };
}