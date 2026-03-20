import { formatDigestedContextForLLM } from '../context-builder';

describe('formatDigestedContextForLLM', () => {
  it('formats a complete context correctly', () => {
    const mockContext = {
      deckSummary: {
        totalCards: 60,
        typeCounts: { Creature: 20, Land: 24, Instant: 10, Artifact: 6 },
        averageCmc: 2.5,
        keyCards: ['Sol Ring', 'Arcane Signet'],
        manaCurve: [0, 10, 20, 15, 5, 0, 0, 0],
        colors: ['W', 'U']
      },
      gameSummary: {
        turn: 5,
        phase: 'main',
        activePlayerId: 'player1',
        players: [
          { id: 'player1', life: 20, handSize: 4, manaAvailable: 3, keyPermanents: ['Sol Ring'] },
          { id: 'player2', life: 18, handSize: 2, manaAvailable: 0, keyPermanents: [] }
        ]
      },
      timestamp: Date.now()
    };

    const result = formatDigestedContextForLLM(mockContext);
    
    expect(result).toContain('### Digested Game Context');
    expect(result).toContain('60 cards');
    expect(result).toContain('Avg CMC: 2.50');
    expect(result).toContain('Sol Ring, Arcane Signet');
    expect(result).toContain('Turn 5');
    expect(result).toContain('player1**: Life: 20');
  });

  it('handles partial context', () => {
    const mockContext = {
      deckSummary: {
        totalCards: 40,
        typeCounts: { Land: 17 },
        averageCmc: 1.2,
        keyCards: [],
        manaCurve: [0, 40],
        colors: ['G']
      },
      timestamp: Date.now()
    };

    const result = formatDigestedContextForLLM(mockContext);
    expect(result).toContain('40 cards');
    expect(result).not.toContain('Current Game');
  });

  it('returns empty string for null context', () => {
    expect(formatDigestedContextForLLM(null)).toBe('');
  });
});
