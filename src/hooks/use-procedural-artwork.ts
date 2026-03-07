/**
 * @fileOverview Hook for using procedural artwork in components
 */

import { useMemo } from 'react';
import { getCachedArtwork, generateArtwork } from '@/lib/procedural-art-generator';
import type { ArtworkConfig } from '@/lib/procedural-art-generator';

export interface UseProceduralArtworkOptions {
  cardName: string;
  cardId: string;
  colors: string[];
  typeLine: string;
  cmc: number;
  style?: ArtworkConfig['style'];
  complexity?: ArtworkConfig['complexity'];
  mood?: ArtworkConfig['mood'];
  width?: number;
  height?: number;
}

/**
 * Hook to get procedural artwork data URL for a card
 */
export function useProceduralArtwork(options: UseProceduralArtworkOptions) {
  const {
    cardName,
    cardId,
    colors,
    typeLine,
    cmc,
    style,
    complexity,
    mood,
    width,
    height,
  } = options;

  const artworkUrl = useMemo(() => {
    const config: ArtworkConfig = {
      cardName,
      cardId,
      colors,
      typeLine,
      cmc,
      style,
      complexity,
      mood,
      width,
      height,
    };

    return getCachedArtwork(config);
  }, [cardId, colors, typeLine, cmc, style, complexity, mood, width, height, cardName]);

  return {
    artworkUrl,
  };
}

/**
 * Hook to get artwork with automatic style determination
 */
export function useAutoStyledArtwork(options: Omit<UseProceduralArtworkOptions, 'style' | 'complexity' | 'mood'>) {
  const {
    cardName,
    cardId,
    colors,
    typeLine,
    cmc,
    width,
    height,
  } = options;

  const artworkUrl = useMemo(() => {
    const config: ArtworkConfig = {
      cardName,
      cardId,
      colors,
      typeLine,
      cmc,
      width,
      height,
    };

    return getCachedArtwork(config);
  }, [cardId, colors, typeLine, cmc, width, height, cardName]);

  return {
    artworkUrl,
  };
}
