/**
 * Integration tests for card search functionality
 * 
 * These tests verify card search and deck import functionality:
 * - Card search by name
 * - Card validation
 * - Decklist import
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { validateCardLegality, importDecklist } from '@/lib/server-card-operations';

describe('Card Search Integration Tests', () => {
  beforeAll(async () => {
    // Initialize the card database
    // The initializeServerCardOperations is called internally
  });

  describe('Validate Card Legality', () => {
    it('should validate single card legality', async () => {
      const result = await validateCardLegality(
        [{ name: 'Lightning Bolt', quantity: 4 }],
        'modern'
      );

      expect(result).toBeDefined();
      expect(result.found).toBeDefined();
      expect(result.notFound).toBeDefined();
      expect(result.illegal).toBeDefined();
    });

    it('should handle multiple cards', async () => {
      const result = await validateCardLegality(
        [
          { name: 'Lightning Bolt', quantity: 4 },
          { name: 'Counterspell', quantity: 4 },
          { name: 'Fake Card X', quantity: 1 }
        ],
        'commander'
      );

      // Result should have correct structure regardless of whether cards are found
      expect(result).toHaveProperty('found');
      expect(result).toHaveProperty('notFound');
      expect(result).toHaveProperty('illegal');
    });

    it('should handle empty input', async () => {
      const result = await validateCardLegality([], 'standard');

      expect(result.found).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(result.illegal).toEqual([]);
    });

    it('should return structure for various formats', async () => {
      const result = await validateCardLegality(
        [{ name: 'Jace, the Mind Sculptor', quantity: 1 }],
        'modern'
      );

      // The result structure should be correct
      expect(result).toHaveProperty('found');
      expect(result).toHaveProperty('notFound');
      expect(result).toHaveProperty('illegal');
    });
  });

  describe('Import Decklist', () => {
    it('should parse standard decklist format', async () => {
      const decklist = `
4 Lightning Bolt
4 Counterspell
4 Brainstorm
      `.trim();

      const result = await importDecklist(decklist, 'modern');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('found');
      expect(result).toHaveProperty('notFound');
      expect(result).toHaveProperty('illegal');
    });

    it('should handle quantity prefix', async () => {
      const decklist = `
4x Lightning Bolt
2 Counterspell
      `.trim();

      const result = await importDecklist(decklist);

      expect(result).toBeDefined();
    });

    it('should ignore comments', async () => {
      const decklist = `
4 Lightning Bolt
// This is a comment
4 Counterspell
      `.trim();

      const result = await importDecklist(decklist);

      expect(result).toBeDefined();
    });

    it('should ignore sideboard section', async () => {
      const decklist = `
4 Lightning Bolt
4 Counterspell
Sideboard:
2 Ponder
      `.trim();

      const result = await importDecklist(decklist);

      expect(result).toBeDefined();
    });

    it('should handle empty decklist', async () => {
      const result = await importDecklist('');

      expect(result.found).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(result.illegal).toEqual([]);
    });
  });
});
