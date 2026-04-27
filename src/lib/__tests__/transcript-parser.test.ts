/**
 * Tests for Transcript Parser
 * Tests parsing match coverage data for sideboard recommendations
 */

import {
  parseMatchTranscript,
  parseTournamentCoverage,
  convertToMatchCoverageData,
} from '../transcript-parser';
import { MatchCoverageData } from '../sideboard-recommendation';

describe('Transcript Parser', () => {
  describe('Format Detection', () => {
    test('should detect Standard format', () => {
      const transcript = 'This Standard deck is built around the new set';
      const result = parseMatchTranscript(transcript);
      expect(result?.format).toBe('standard');
    });

    test('should detect Modern format', () => {
      const transcript = 'The Modern format allows for powerful cards';
      const result = parseMatchTranscript(transcript);
      expect(result?.format).toBe('modern');
    });

    test('should detect Commander format', () => {
      const transcript = 'This Commander deck is built around Zurgo';
      const result = parseMatchTranscript(transcript);
      expect(result?.format).toBe('commander');
    });
  });

  describe('Archetype Detection', () => {
    test('should detect Red Aggro archetype', () => {
      const transcript = 'Red aggro deck focused on burn spells';
      const result = parseMatchTranscript(transcript);
      expect(result?.yourArchetype).toContain('Red');
    });

    test('should detect Blue Control archetype', () => {
      const transcript = 'Blue control deck with counterspells';
      const result = parseMatchTranscript(transcript);
      expect(result?.opponentArchetype).toContain('Control');
    });

    test('should detect multiple archetypes', () => {
      const transcript = 'Red aggro faces blue control in this match';
      const result = parseMatchTranscript(transcript);
      expect(result?.yourArchetype).toContain('Red');
      expect(result?.opponentArchetype).toContain('Control');
    });
  });

  describe('Sideboard Action Parsing', () => {
    test('should parse "bring in" action', () => {
      const transcript = `
Game 2
The player brings in 2 Negates for the matchup.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions).toContainEqual(
        expect.objectContaining({
          action: 'in',
          cardName: 'Negate',
          count: 2,
        })
      );
    });

    test('should parse "take out" action', () => {
      const transcript = `
Game 2
They take out 2 Thoughtseizes because they cost life.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions).toContainEqual(
        expect.objectContaining({
          action: 'out',
          cardName: 'Thoughtseize',
          count: 2,
          reason: expect.stringContaining('life'),
        })
      );
    });

    test('should parse swap action', () => {
      const transcript = `
Game 2
2 Negates for 2 Thoughtseizes
`;
      const result = parseMatchTranscript(transcript);
      const actions = result?.games[0]?.sideboardActions || [];

      expect(actions).toContainEqual(
        expect.objectContaining({
          action: 'out',
          cardName: 'Thoughtseize',
          count: 2,
        })
      );
      expect(actions).toContainEqual(
        expect.objectContaining({
          action: 'in',
          cardName: 'Negate',
          count: 2,
        })
      );
    });

    test('should extract reasoning from commentary', () => {
      const transcript = `
Game 2
Bring in Abrade because it removes their key permanents.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions[0]?.reason).toContain(
        'removes their key permanents'
      );
    });

    test('should infer reasoning from context', () => {
      const transcript = `
Game 2
Bring in Kitchen Finks for life gain and blocker.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions[0]?.reason).toBe('Life gain');
    });
  });

  describe('Game Parsing', () => {
    test('should parse multiple games', () => {
      const transcript = `
Game 1
Some gameplay.

Game 2
Bring in Negates.

Game 3
Take out removal.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games).toHaveLength(3);
      expect(result?.games[0]?.gameNumber).toBe(1);
      expect(result?.games[1]?.gameNumber).toBe(2);
      expect(result?.games[2]?.gameNumber).toBe(3);
    });

    test('should detect between-game commentary', () => {
      const transcript = `
Between games 2 and 3
They need to bring in more removal.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.gameNumber).toBe(3);
      expect(result?.games[0]?.commentary).toContain('removal');
    });
  });

  describe('Complex Tournament Coverage', () => {
    test('should parse full tournament transcript', () => {
      const transcript = `
Standard match: Red Aggro vs Blue Control

Game 1
Red aggro goes first, plays Goblin Guide.
Blue control counters and stabilizes.

Between games 1 and 2
Red aggro player is bringing in Abrade and Rogue Refinery.
They need to grind through the counterspells and removal.
Abrade is good against their key permanents like Teferi.
Rogue Refinery provides card advantage against removal-heavy decks.
They're taking out Goblin Guide since it's too slow against removal.
Lavamancer comes out because they deny graveyard access.

Game 2
Red aggro boards in more interactive cards.
Blue control has Negates for burn spells.

Between games 2 and 3
Blue control brings in Aether Gust to handle red threats efficiently.
They take out Orcish Bowmasters as it's too slow against aggro.
Need cheap interaction to survive the early game.
`;
      const result = parseTournamentCoverage(transcript, 'Pro Tour 2025', '2025-03-15');

      expect(result).not.toBeNull();
      expect(result?.format).toBe('standard');
      expect(result?.sideboardSwaps).toHaveLength(2);
      expect(result?.sideboardSwaps[0].cardsIn).toContainEqual(
        expect.objectContaining({ cardName: 'Abrade' })
      );
      expect(result?.sideboardSwaps[0].cardsOut).toContainEqual(
        expect.objectContaining({ cardName: 'Goblin Guide' })
      );
    });
  });

  describe('Conversion to MatchCoverageData', () => {
    test('should convert parsed analysis to coverage data', () => {
      const analysis = parseMatchTranscript(`
Standard match: Red Aggro vs Blue Control

Game 1
Gameplay.

Game 2
Bring in Negates to counter burn spells.
Take out slow threats.
`);

      if (!analysis) {
        throw new Error('Failed to parse transcript');
      }

      const coverage = convertToMatchCoverageData(analysis);

      expect(coverage.format).toBe('standard');
      expect(coverage.yourArchetype).toBe('Red Aggro');
      expect(coverage.opponentArchetype).toBe('Blue Control');
      expect(coverage.sideboardSwaps).toHaveLength(1);
      expect(coverage.sideboardSwaps[0].cardsIn).toHaveLength(1);
      expect(coverage.sideboardSwaps[0].cardsOut).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    test('should handle transcript with no sideboard actions', () => {
      const transcript = `
Game 1
Some gameplay here.
Game 2
More gameplay.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions).toHaveLength(0);
      expect(result?.games[1]?.sideboardActions).toHaveLength(0);
    });

    test('should handle transcript with implicit counts (default to 1)', () => {
      const transcript = `
Game 2
Bring in Negate to counter burn spells.
`;
      const result = parseMatchTranscript(transcript);
      expect(result?.games[0]?.sideboardActions[0]?.count).toBe(1);
    });

    test('should return null for unparseable transcript', () => {
      const transcript = 'This is just random text with no game information.';
      const result = parseMatchTranscript(transcript);
      expect(result).toBeNull();
    });

    test('should handle malformed sideboard patterns gracefully', () => {
      const transcript = `
Standard match: Red Aggro vs Blue Control

Game 2
Bring in to counter spells.
`;
      const result = parseMatchTranscript(transcript);
      // Should still parse, just won't have valid card names
      expect(result).not.toBeNull();
    });
  });
});
