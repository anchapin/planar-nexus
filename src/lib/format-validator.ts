/**
 * Format validation utilities for multiplayer deck selection
 *
 * This module provides utilities for validating decks against format rules
 * in the multiplayer lobby context.
 */

import {
  validateDeckFormat,
  getFormatRulesDescription,
  getFormatDisplayName,
  type Format,
  type FormatValidationResult,
  type ValidationResult,
} from './game-rules';
import type { SavedDeck } from '@/app/actions';

/**
 * Deck validation result for lobby
 */
export interface LobbyDeckValidationResult {
  isValid: boolean;
  deck: SavedDeck;
  format: Format;
  errors: string[];
  warnings: string[];
  canPlay: boolean;
}

/**
 * Validate a saved deck against a lobby format
 */
export function validateDeckForLobby(deck: SavedDeck, lobbyFormat: Format): LobbyDeckValidationResult {
  // Convert DeckCard[] to the format expected by validateDeckFormat
  const deckCards = deck.cards.map(card => ({
    name: card.name,
    count: card.count,
    color_identity: card.color_identity,
    type_line: card.type_line,
  }));

  // Check if deck's declared format matches lobby format
  const formatMatches = deck.format.toLowerCase() === lobbyFormat.toLowerCase();

  const validation = validateDeckFormat(deckCards, lobbyFormat);

  const errors: string[] = [...validation.errors];
  const warnings: string[] = [...validation.warnings];

  // Add warning if deck format doesn't match lobby format
  if (!formatMatches) {
    warnings.push(
      `Deck was built for ${deck.format}, but lobby is ${getFormatDisplayName(lobbyFormat)}`
    );
  }

  return {
    isValid: validation.isValid,
    deck,
    format: lobbyFormat,
    errors,
    warnings,
    canPlay: validation.isValid && formatMatches,
  };
}

/**
 * Check if a player can join with their selected deck
 */
export function canPlayerJoinWithDeck(
  deck: SavedDeck,
  lobbyFormat: Format
): { canJoin: boolean; reason?: string } {
  const validation = validateDeckForLobby(deck, lobbyFormat);

  if (!validation.isValid) {
    return {
      canJoin: false,
      reason: validation.errors[0] || 'Deck is not valid for this format',
    };
  }

  if (!validation.canPlay) {
    return {
      canJoin: false,
      reason: validation.warnings[0] || 'Deck format does not match lobby format',
    };
  }

  return { canJoin: true };
}

/**
 * Get all deck validation errors for display
 */
export function getDeckValidationErrors(
  deck: SavedDeck,
  lobbyFormat: Format
): string[] {
  const validation = validateDeckForLobby(deck, lobbyFormat);
  return [...validation.errors, ...validation.warnings];
}

/**
 * Check if all players in a lobby have valid decks
 */
export function validateAllPlayerDecks(
  players: Array<{ deckId?: string; deckName?: string }>,
  getDeckById: (deckId: string) => SavedDeck | undefined,
  lobbyFormat: Format
): {
  allValid: boolean;
  invalidPlayers: Array<{ playerId: string; playerName: string; errors: string[] }>;
} {
  const invalidPlayers: Array<{ playerId: string; playerName: string; errors: string[] }> = [];

  players.forEach((player) => {
    if (!player.deckId) return;

    const deck = getDeckById(player.deckId);
    if (!deck) return;

    const validation = validateDeckForLobby(deck, lobbyFormat);

    if (!validation.isValid || !validation.canPlay) {
      invalidPlayers.push({
        playerId: player.deckId,
        playerName: player.deckName || 'Unknown',
        errors: [...validation.errors, ...validation.warnings],
      });
    }
  });

  return {
    allValid: invalidPlayers.length === 0,
    invalidPlayers,
  };
}

/**
 * Get format rules summary for display
 */
export function getFormatRulesSummary(format: Format): {
  formatName: string;
  rules: string[];
} {
  return {
    formatName: getFormatDisplayName(format),
    rules: getFormatRulesDescription(format),
  };
}

/**
 * Validate a deck before it can be marked as ready
 */
export function validateDeckForReadyStatus(
  deck: SavedDeck | null,
  lobbyFormat: Format
): { isReady: boolean; errors: string[] } {
  if (!deck) {
    return {
      isReady: false,
      errors: ['No deck selected'],
    };
  }

  const validation = validateDeckForLobby(deck, lobbyFormat);

  return {
    isReady: validation.isValid && validation.canPlay,
    errors: [...validation.errors, ...validation.warnings],
  };
}

/**
 * Format validation error message for display
 */
export function formatValidationMessage(result: ValidationResult): string {
  if (result.isValid) {
    return 'Deck is valid for this format';
  }

  if (result.errors.length > 0) {
    return result.errors[0];
  }

  if (result.warnings.length > 0) {
    return result.warnings[0];
  }

  return 'Deck validation failed';
}
