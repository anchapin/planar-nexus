/**
 * Tests for heuristic meta analysis
 */

import { describe, it, expect } from 'vitest';
import { heuristicMetaAnalysis } from '@/lib/heuristic-meta-analysis';

describe('heuristicMetaAnalysis', () => {
  it('should generate meta analysis for a simple deck', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell
1 Lightning Bolt
1 Swords to Plowshares`;

    const analysis = await heuristicMetaAnalysis(decklist, 'commander');

    expect(analysis).toBeDefined();
    expect(analysis.metaOverview).toBeDefined();
    expect(analysis.deckStrengths).toBeDefined();
    expect(analysis.deckWeaknesses).toBeDefined();
    expect(analysis.matchupAnalysis).toBeDefined();
    expect(analysis.cardSuggestions).toBeDefined();
    expect(analysis.strategicAdvice).toBeDefined();
  });

  it('should generate meta overview with tier decks', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell`;

    const analysis = await heuristicMetaAnalysis(decklist, 'commander');

    expect(analysis.metaOverview).toContain('Tier 1');
    expect(analysis.metaOverview).toContain('commander');
  });

  it('should generate matchup analysis', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet`;

    const analysis = await heuristicMetaAnalysis(decklist, 'commander');

    expect(analysis.matchupAnalysis.length).toBeGreaterThan(0);
    const firstMatchup = analysis.matchupAnalysis[0];
    expect(firstMatchup.archetype).toBeDefined();
    expect(firstMatchup.recommendation).toBeDefined();
  });

  it('should generate card suggestions with balanced counts', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell`;

    const analysis = await heuristicMetaAnalysis(decklist, 'commander');

    const addCount = analysis.cardSuggestions.cardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
    const removeCount = analysis.cardSuggestions.cardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

    expect(addCount).toBe(removeCount);
  });

  it('should not include sideboard suggestions for commander', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet`;

    const analysis = await heuristicMetaAnalysis(decklist, 'commander');

    expect(analysis.sideboardSuggestions).toBeUndefined();
  });

  it('should include sideboard suggestions for non-commander formats', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell`;

    const analysis = await heuristicMetaAnalysis(decklist, 'modern');

    expect(analysis.sideboardSuggestions).toBeDefined();
    expect(analysis.sideboardSuggestions?.length).toBeGreaterThan(0);
  });
});
