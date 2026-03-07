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
 */
export function getArtworkWithFallback(
  card: MinimalCard,
  size: 'small' | 'normal' | 'large' = 'normal',
  preferProcedural: boolean = false
): string {
  // If we prefer procedural or have no image, use procedural
  if (preferProcedural || !card.image_uris) {
    return getProceduralArtworkUrl(card, size);
  }

  // Otherwise use the original image if available
  const sizeMap = {
    small: 'small',
    normal: 'normal',
    large: 'large',
  };

  return card.image_uris[sizeMap[size] as keyof typeof card.image_uris] || getProceduralArtworkUrl(card, size);
}

/**
 * Check if a card should use procedural artwork
 */
export function shouldUseProceduralArtwork(card: MinimalCard): boolean {
  // Use procedural if no image URIs available
  return !card.image_uris;
}
