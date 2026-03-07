/**
 * Tests for heuristic deck coach
 */

// Jest provides describe, it, expect globally
import { heuristicDeckReview } from '@/lib/heuristic-deck-coach';

describe('heuristicDeckReview', () => {
  it('should generate a review for a simple deck', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell
1 Lightning Bolt
1 Swords to Plowshares`;

    const review = await heuristicDeckReview(decklist, 'commander');

    expect(review).toBeDefined();
    expect(review.reviewSummary).toBeDefined();
    expect(review.reviewSummary.length).toBeGreaterThan(0);
    expect(review.deckOptions).toBeDefined();
    expect(review.deckOptions.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate different deck options', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell
1 Lightning Bolt
1 Swords to Plowshares`;

    const review = await heuristicDeckReview(decklist, 'commander');

    const titles = review.deckOptions.map(o => o.title);
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(titles.length);
  });

  it('should include cards to add and remove in options', async () => {
    const decklist = `1 Sol Ring
1 Arcane Signet
1 Counterspell
1 Lightning Bolt
1 Swords to Plowshares`;

    const review = await heuristicDeckReview(decklist, 'commander');

    const hasAdditions = review.deckOptions.some(o => o.cardsToAdd && o.cardsToAdd.length > 0);
    const hasRemovals = review.deckOptions.some(o => o.cardsToRemove && o.cardsToRemove.length > 0);

    expect(hasAdditions || hasRemovals).toBe(true);
  });
});
