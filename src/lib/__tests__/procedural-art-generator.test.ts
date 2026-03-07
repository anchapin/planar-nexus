/**
 * @fileOverview Tests for procedural artwork generator
 *
 * Run tests with: npm test
 */

import { describe, it, expect } from '@jest/globals';
import {
  generateArtwork,
  svgToDataUrl,
  getCachedArtwork,
  clearArtworkCache,
  pregenerateArtwork,
  determineStyleFromTypeLine,
  determineMoodFromCard,
  determineComplexityFromCMC,
} from '../procedural-art-generator';

describe('Procedural Artwork Generator', () => {
  describe('generateArtwork', () => {
    it('should generate artwork with valid SVG', () => {
      const result = generateArtwork({
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      });

      expect(result.svg).toContain('<svg');
      expect(result.svg).toContain('</svg>');
      expect(result.cacheKey).toBeTruthy();
    });

    it('should generate consistent artwork for same card', () => {
      const config = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const result1 = generateArtwork(config);
      const result2 = generateArtwork(config);

      expect(result1.svg).toBe(result2.svg);
      expect(result1.cacheKey).toBe(result2.cacheKey);
    });

    it('should generate different artwork for different cards', () => {
      const config1 = {
        cardName: 'Test Card 1',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const config2 = {
        cardName: 'Test Card 2',
        cardId: 'test-002',
        colors: ['U'],
        typeLine: 'Creature — Wizard',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const result1 = generateArtwork(config1);
      const result2 = generateArtwork(config2);

      expect(result1.svg).not.toBe(result2.svg);
      expect(result1.cacheKey).not.toBe(result2.cacheKey);
    });

    it('should respect style parameter', () => {
      const baseConfig = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const fantasy = generateArtwork({ ...baseConfig, style: 'fantasy' });
      const scifi = generateArtwork({ ...baseConfig, style: 'sci-fi' });

      expect(fantasy.svg).not.toBe(scifi.svg);
      expect(fantasy.cacheKey).not.toBe(scifi.cacheKey);
    });

    it('should respect complexity parameter', () => {
      const baseConfig = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const simple = generateArtwork({ ...baseConfig, complexity: 'simple' });
      const complex = generateArtwork({ ...baseConfig, complexity: 'complex' });

      expect(simple.svg).not.toBe(complex.svg);
      expect(simple.cacheKey).not.toBe(complex.cacheKey);
    });

    it('should respect mood parameter', () => {
      const baseConfig = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const peaceful = generateArtwork({ ...baseConfig, mood: 'peaceful' });
      const aggressive = generateArtwork({ ...baseConfig, mood: 'aggressive' });

      expect(peaceful.svg).not.toBe(aggressive.svg);
      expect(peaceful.cacheKey).not.toBe(aggressive.cacheKey);
    });
  });

  describe('svgToDataUrl', () => {
    it('should convert SVG to data URL', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';
      const dataUrl = svgToDataUrl(svg);

      expect(dataUrl).toContain('data:image/svg+xml');
    });
  });

  describe('getCachedArtwork', () => {
    it('should cache generated artwork', () => {
      clearArtworkCache();

      const config = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const url1 = getCachedArtwork(config);
      const url2 = getCachedArtwork(config);

      expect(url1).toBe(url2);
      expect(url1).toContain('data:image/svg+xml');
    });

    it('should return same URL for same config', () => {
      clearArtworkCache();

      const config = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      const url1 = getCachedArtwork(config);
      const url2 = getCachedArtwork(config);
      const url3 = getCachedArtwork(config);

      expect(url1).toBe(url2);
      expect(url2).toBe(url3);
    });
  });

  describe('clearArtworkCache', () => {
    it('should clear artwork cache', () => {
      const config = {
        cardName: 'Test Card',
        cardId: 'test-001',
        colors: ['R'],
        typeLine: 'Creature — Dragon',
        cmc: 3,
        width: 244,
        height: 340,
      };

      getCachedArtwork(config);
      clearArtworkCache();

      const url = getCachedArtwork(config);
      expect(url).toBeTruthy();
    });
  });

  describe('pregenerateArtwork', () => {
    it('should pre-generate artwork for multiple cards', () => {
      clearArtworkCache();

      const configs = [
        {
          cardName: 'Test Card 1',
          cardId: 'test-001',
          colors: ['R'],
          typeLine: 'Creature — Dragon',
          cmc: 3,
          width: 244,
          height: 340,
        },
        {
          cardName: 'Test Card 2',
          cardId: 'test-002',
          colors: ['U'],
          typeLine: 'Creature — Wizard',
          cmc: 3,
          width: 244,
          height: 340,
        },
      ];

      let callbackCount = 0;
      pregenerateArtwork(configs, (progress, total) => {
        callbackCount++;
        expect(progress).toBeGreaterThan(0);
        expect(total).toBe(2);
      });

      expect(callbackCount).toBe(2);
    });
  });

  describe('determineStyleFromTypeLine', () => {
    it('should return sci-fi for artifacts', () => {
      expect(determineStyleFromTypeLine('Artifact')).toBe('sci-fi');
      expect(determineStyleFromTypeLine('Artifact — Equipment')).toBe('sci-fi');
    });

    it('should return fantasy for enchantments', () => {
      expect(determineStyleFromTypeLine('Enchantment')).toBe('fantasy');
      expect(determineStyleFromTypeLine('Enchantment — Aura')).toBe('fantasy');
    });

    it('should return abstract for instants and sorceries', () => {
      expect(determineStyleFromTypeLine('Instant')).toBe('abstract');
      expect(determineStyleFromTypeLine('Sorcery')).toBe('abstract');
    });

    it('should return fantasy as default', () => {
      expect(determineStyleFromTypeLine('Creature — Dragon')).toBe('fantasy');
      expect(determineStyleFromTypeLine('Land')).toBe('fantasy');
    });
  });

  describe('determineMoodFromCard', () => {
    it('should return aggressive for high CMC red/black', () => {
      expect(determineMoodFromCard(['R'], 5)).toBe('aggressive');
      expect(determineMoodFromCard(['B'], 5)).toBe('aggressive');
    });

    it('should return mysterious for blue/black', () => {
      expect(determineMoodFromCard(['U'], 2)).toBe('mysterious');
      expect(determineMoodFromCard(['B'], 2)).toBe('mysterious');
    });

    it('should return energetic for red/green', () => {
      expect(determineMoodFromCard(['R'], 2)).toBe('energetic');
      expect(determineMoodFromCard(['G'], 2)).toBe('energetic');
    });

    it('should return peaceful as default', () => {
      expect(determineMoodFromCard(['W'], 2)).toBe('peaceful');
      expect(determineMoodFromCard([], 2)).toBe('peaceful');
    });
  });

  describe('determineComplexityFromCMC', () => {
    it('should return simple for low CMC', () => {
      expect(determineComplexityFromCMC(0)).toBe('simple');
      expect(determineComplexityFromCMC(1)).toBe('simple');
      expect(determineComplexityFromCMC(2)).toBe('simple');
    });

    it('should return medium for mid CMC', () => {
      expect(determineComplexityFromCMC(3)).toBe('medium');
      expect(determineComplexityFromCMC(4)).toBe('medium');
    });

    it('should return complex for high CMC', () => {
      expect(determineComplexityFromCMC(5)).toBe('complex');
      expect(determineComplexityFromCMC(10)).toBe('complex');
    });
  });
});
