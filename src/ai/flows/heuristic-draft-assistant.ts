'use server';
/**
 * @fileOverview Heuristic Draft Assistant
 *
 * This module provides draft assistance using rule-based heuristics
 * instead of AI generation. It offers card picks based on established
 * drafting principles.
 */

export interface DraftAssistantInput {
  packNumber: number;
  pickNumber: number;
  cardsInPack: string[];
  yourDeck?: string[];
  format?: string;
}

export interface DraftAssistantOutput {
  recommendedPick: string;
  reasoning: string;
  alternativePicks: string[];
}

/**
 * Analyze card value based on simple heuristics
 */
function analyzeCardValue(cardName: string): number {
  const lowerName = cardName.toLowerCase();
  let score = 0;

  // Bounce keywords (generally good)
  if (lowerName.includes('flying')) score += 2;
  if (lowerName.includes('trample')) score += 2;
  if (lowerName.includes('lifelink')) score += 1.5;
  if (lowerName.includes('deathtouch')) score += 2;
  if (lowerName.includes('haste')) score += 2;

  // Removal is valuable
  if (lowerName.includes('destroy') || lowerName.includes('exile')) {
    score += 3;
  }

  // Card draw is strong
  if (lowerName.includes('draw') || lowerName.includes('draw')) {
    score += 2.5;
  }

  // Efficient creatures
  if (lowerName.match(/\b(\d)\/(\d)\b/)) {
    const match = lowerName.match(/\b(\d)\/(\d)\b/);
    if (match) {
      const power = parseInt(match[1]);
      const toughness = parseInt(match[2]);
      if (power + toughness >= 4 && power + toughness <= 5) {
        score += 2; // Efficient stats
      }
    }
  }

  return score;
}

/**
 * Get draft advice based on heuristics
 */
export async function provideDraftAssistance(
  input: DraftAssistantInput
): Promise<DraftAssistantOutput> {
  const { cardsInPack, yourDeck, format } = input;

  // Score each card
  const scoredCards = cardsInPack.map(cardName => ({
    name: cardName,
    score: analyzeCardValue(cardName),
  }));

  // Sort by score
  scoredCards.sort((a, b) => b.score - a.score);

  // Get top picks
  const recommendedPick = scoredCards[0].name;
  const alternativePicks = scoredCards.slice(1, 4).map(c => c.name);

  // Generate reasoning
  let reasoning = `Based on ${format || 'limited'} drafting principles, this pick is recommended because it offers the best combination of immediate impact and long-term value.`;

  if (yourDeck && yourDeck.length > 0) {
    const deckColors = new Set<string>();
    yourDeck.forEach(card => {
      const lowerName = card.toLowerCase();
      if (lowerName.includes('red') || lowerName.includes('mountain')) deckColors.add('red');
      if (lowerName.includes('blue') || lowerName.includes('island')) deckColors.add('blue');
      if (lowerName.includes('green') || lowerName.includes('forest')) deckColors.add('green');
      if (lowerName.includes('white') || lowerName.includes('plains')) deckColors.add('white');
      if (lowerName.includes('black') || lowerName.includes('swamp')) deckColors.add('black');
    });

    if (deckColors.size < 3) {
      reasoning += ` Your deck is currently focused on ${Array.from(deckColors).join(' and ')}, so this card fits well.`;
    }
  }

  if (scoredCards[0].score >= 3) {
    reasoning += ' This card is particularly strong due to powerful keywords or efficient stats.';
  }

  return {
    recommendedPick,
    reasoning,
    alternativePicks,
  };
}
