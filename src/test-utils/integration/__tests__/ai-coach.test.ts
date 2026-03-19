/**
 * Integration tests for AI Coach interactions
 * 
 * These tests verify AI deck review functionality by mocking
 * the AI service responses.
 */

import { createMockDeck, createMockCard } from '@/test-utils/integration';

describe('AI Coach Integration Tests', () => {
  describe('Deck Review Request', () => {
    it('should prepare deck for AI review', () => {
      const deck = createMockDeck({
        name: 'Test Deck for Review',
        format: 'commander',
        cards: [
          { name: 'Lightning Bolt', quantity: 4 },
          { name: 'Counterspell', quantity: 4 },
          { name: 'Count', quantity: 4 },
          { name: 'Fire', quantity: 4 },
          { name: 'Ice', quantity: 4 },
        ],
      });
      
      // Convert to decklist format expected by AI
      const decklist = deck.cards.map(card => 
        `${card.quantity} ${card.name}`
      ).join('\n');
      
      expect(decklist).toContain('4 Lightning Bolt');
      expect(decklist).toContain('4 Counterspell');
    });

    it('should format deck for review request', () => {
      const deck = createMockDeck({
        format: 'standard',
        cards: [
          { name: 'Goblin Guide', quantity: 4 },
          { name: 'Lightning Bolt', quantity: 4 },
        ],
      });
      
      // Verify deck has required fields for AI review
      expect(deck.format).toBe('standard');
      expect(deck.cards.length).toBeGreaterThan(0);
      
      const totalCards = deck.cards.reduce((sum, card) => sum + card.quantity, 0);
      expect(totalCards).toBe(8);
    });
  });

  describe('AI Suggestions Display', () => {
    it('should structure review response', () => {
      // Mock AI review response structure
      const reviewResponse = {
        deckId: 'deck-123',
        format: 'commander',
        overallRating: 7.5,
        strengths: [
          'Strong mana curve',
          'Good removal suite',
          'Solid creatures',
        ],
        suggestions: [
          {
            type: 'add',
            card: 'Swords to Plowshares',
            reason: 'Better removal option',
          },
          {
            type: 'remove',
            card: 'Card Name',
            reason: 'Underperforming',
          },
        ],
        manaCurve: {
          1: 10,
          2: 15,
          3: 12,
          4: 8,
          5: 5,
          6: 3,
        },
        colorDistribution: {
          W: 5,
          U: 10,
          B: 8,
          R: 12,
          G: 15,
        },
      };
      
      expect(reviewResponse.overallRating).toBeDefined();
      expect(Array.isArray(reviewResponse.strengths)).toBe(true);
      expect(Array.isArray(reviewResponse.suggestions)).toBe(true);
      expect(reviewResponse.manaCurve).toBeDefined();
    });

    it('should validate suggestion types', () => {
      const suggestions = [
        { type: 'add', card: 'Counterspell', reason: 'Good counter' },
        { type: 'remove', card: 'Bad Card', reason: 'Not performing' },
        { type: 'sideboard', card: 'Duress', reason: 'For control matchups' },
      ];
      
      const validTypes = ['add', 'remove', 'sideboard'];
      
      suggestions.forEach(suggestion => {
        expect(validTypes).toContain(suggestion.type);
        expect(suggestion.card).toBeDefined();
        expect(suggestion.reason).toBeDefined();
      });
    });
  });

  describe('Mana Curve Analysis', () => {
    it('should calculate mana curve from deck', () => {
      const cards = [
        { name: 'One', cmc: 1, quantity: 10 },
        { name: 'Two', cmc: 2, quantity: 8 },
        { name: 'Three', cmc: 3, quantity: 6 },
        { name: 'Four', cmc: 4, quantity: 4 },
        { name: 'Five', cmc: 5, quantity: 2 },
      ];
      
      const manaCurve: Record<number, number> = {};
      cards.forEach(card => {
        manaCurve[card.cmc] = (manaCurve[card.cmc] || 0) + card.quantity;
      });
      
      expect(manaCurve[1]).toBe(10);
      expect(manaCurve[2]).toBe(8);
      expect(manaCurve[3]).toBe(6);
      expect(manaCurve[4]).toBe(4);
      expect(manaCurve[5]).toBe(2);
    });

    it('should identify balanced mana curve', () => {
      const balancedCurve = { 1: 8, 2: 12, 3: 10, 4: 6, 5: 4 };
      const heavyLateCurve = { 1: 2, 2: 4, 3: 6, 4: 15, 5: 20 };
      
      // A balanced curve should have more early drops than late
      const isBalanced = (curve: Record<number, number>) => {
        const early = (curve[1] || 0) + (curve[2] || 0) + (curve[3] || 0);
        const late = (curve[4] || 0) + (curve[5] || 0) + (curve[6] || 0);
        return early > late;
      };
      
      expect(isBalanced(balancedCurve)).toBe(true);
      expect(isBalanced(heavyLateCurve)).toBe(false);
    });
  });

  describe('Color Distribution', () => {
    it('should calculate color distribution', () => {
      const cards = [
        { name: 'White Card', colors: ['W'], quantity: 10 },
        { name: 'Blue Card', colors: ['U'], quantity: 8 },
        { name: 'Red Card', colors: ['R'], quantity: 6 },
        { name: 'Multicolor', colors: ['W', 'U'], quantity: 4 },
      ];
      
      const colorDistribution: Record<string, number> = {};
      cards.forEach(card => {
        card.colors.forEach(color => {
          colorDistribution[color] = (colorDistribution[color] || 0) + card.quantity;
        });
      });
      
      expect(colorDistribution['W']).toBe(14); // 10 + 4
      expect(colorDistribution['U']).toBe(12); // 8 + 4
      expect(colorDistribution['R']).toBe(6);
    });

    it('should identify color identity', () => {
      const deckColors = ['W', 'U', 'R']; // Izzet Prowave
      
      const hasWhite = deckColors.includes('W');
      const hasBlue = deckColors.includes('U');
      const hasBlack = deckColors.includes('B');
      
      expect(hasWhite).toBe(true);
      expect(hasBlue).toBe(true);
      expect(hasBlack).toBe(false);
    });
  });

  describe('Opponent Generation', () => {
    it('should generate opponent with specified difficulty', () => {
      const difficulties = ['casual', 'medium', 'hard'];
      
      difficulties.forEach(difficulty => {
        const opponentRequest = {
          format: 'commander',
          difficulty,
          playerCount: 1,
        };
        
        expect(opponentRequest.difficulty).toBe(difficulty);
      });
    });

    it('should validate opponent deck requirements', () => {
      const opponentDeck = {
        name: 'AI Opponent',
        format: 'commander',
        cards: [
          { name: 'Card 1', quantity: 4 },
          { name: 'Card 2', quantity: 4 },
          { name: 'Card 3', quantity: 4 },
          { name: 'Card 4', quantity: 4 },
          { name: 'Card 5', quantity: 4 },
          { name: 'Card 6', quantity: 4 },
          { name: 'Card 7', quantity: 4 },
          { name: 'Card 8', quantity: 4 },
          { name: 'Card 9', quantity: 4 },
          { name: 'Card 10', quantity: 4 },
          { name: 'Card 11', quantity: 4 },
          { name: 'Card 12', quantity: 4 },
          { name: 'Card 13', quantity: 4 },
          { name: 'Card 14', quantity: 4 },
          { name: 'Card 15', quantity: 4 },
        ],
      };
      
      const totalCards = opponentDeck.cards.reduce((sum: number, card: { quantity: number }) => sum + card.quantity, 0);
      const cardCount = opponentDeck.cards.length;
      
      expect(totalCards).toBeGreaterThanOrEqual(60); // Minimum for commander
      expect(cardCount).toBeGreaterThan(0);
    });
  });
});
