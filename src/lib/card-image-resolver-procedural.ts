/**
 * @fileOverview Procedural artwork resolver for card images
 *
 * This module provides a drop-in replacement for Scryfall image URIs
 * using the procedural artwork generation system.
 */

import { getCachedArtwork } from '@/lib/procedural-art-generator';
import type { MinimalCard } from './card-database';

/**
 * Get procedural artwork URL for a card
 */
export function getProceduralArtworkUrl(
  card: MinimalCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string {
  const sizeMap = {
    small: { width: 204, height: 285 },
    normal: { width: 244, height: 340 },
    large: { width: 488, height: 680 },
  };

  const dimensions = sizeMap[size];

  return getCachedArtwork({
    cardName: card.name,
    cardId: card.id,
    colors: card.colors,
    typeLine: card.type_line,
    cmc: card.cmc,
    width: dimensions.width,
    height: dimensions.height,
  });
}

/**
 * Get artwork URL with fallback to procedural generation
 *
 * Note: This function only returns procedural artwork URLs.
 * Scryfall image_uris are never returned to avoid CDN image display.
 */
export function getArtworkWithFallback(
  card: MinimalCard,
  size: 'small' | 'normal' | 'large' = 'normal',
  _preferProcedural: boolean = false
): string {
  // Always use procedural artwork
  // Scryfall image_uris are never returned to avoid CDN image display
  return getProceduralArtworkUrl(card, size);
}

/**
 * Check if a card should use procedural artwork
 */
export function shouldUseProceduralArtwork(card: MinimalCard): boolean {
  // Use procedural if no image URIs available
  return !card.image_uris;
}
