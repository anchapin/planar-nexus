/**
 * @fileOverview Shared utilities for decklist parsing and card operations
 *
 * These functions are shared between client and server card operations
 * to eliminate code duplication and ensure consistent behavior.
 */

import type { DeckCard } from '@/app/actions';
import { type Format } from '@/lib/game-rules';

/**
 * Parse a single line from a decklist
 * Handles formats like "4 Lightning Bolt" or just "Lightning Bolt"
 */
export function parseDecklistLine(line: string): { name: string; quantity: number } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) return null;

  const match = trimmedLine.match(/^(?:(\d+)\s*x?\s*)?(.+)/);
  if (!match) return null;

  const name = match[2]?.trim();
  if (!name || /^\/\//.test(name) || name.toLowerCase() === 'sideboard') {
    return null;
  }

  const count = parseInt(match[1] || '1', 10);
  return { name, quantity: count };
}

/**
 * Split decklist into non-empty lines
 * @returns Array of non-empty lines
 */
export function splitDecklist(decklist: string): string[] {
  return decklist.split('\n').filter(line => line.trim() !== '');
}

/**
 * Sanitize and aggregate card input for validation
 * @returns Map of normalized card names to aggregated quantities, plus any malformed inputs
 */
export function sanitizeCardInput(
  cards: Array<{ name: string; quantity: number }>
): {
  cardMap: Map<string, { originalName: string; quantity: number }>;
  malformedInputs: string[];
} {
  const cardRequestMap = new Map<string, { originalName: string; quantity: number }>();
  const malformedInputs: string[] = [];

  for (const card of cards) {
    if (!card || typeof card.name !== 'string' || card.name.trim() === '' ||
      typeof card.quantity !== 'number' || card.quantity <= 0) {
      malformedInputs.push(card?.name || 'Malformed Input');
      continue;
    }
    const lowerCaseName = card.name.toLowerCase();
    const existing = cardRequestMap.get(lowerCaseName);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      cardRequestMap.set(lowerCaseName, { originalName: card.name, quantity: card.quantity });
    }
  }

  return { cardMap: cardRequestMap, malformedInputs };
}

/**
 * Aggregate cards by their ID to combine different prints of same card
 */
export function aggregateCardsById<T extends { id: string; count: number }>(cards: T[]): T[] {
  return Array.from(
    cards.reduce((acc, card) => {
      const existing = acc.get(card.id);
      if (existing) {
        existing.count += card.count;
      } else {
        acc.set(card.id, { ...card });
      }
      return acc;
    }, new Map<string, T>()).values()
  );
}

/**
 * Parse decklist string into card details
 * @returns Array of parsed card details
 */
export function parseDecklist(decklist: string): { name: string; quantity: number }[] {
  const lines = splitDecklist(decklist);
  if (lines.length === 0) {
    return [];
  }

  const cardDetails: { name: string; quantity: number }[] = [];

  for (const line of lines) {
    const parsed = parseDecklistLine(line);
    if (parsed) {
      cardDetails.push(parsed);
    }
  }

  return cardDetails;
}