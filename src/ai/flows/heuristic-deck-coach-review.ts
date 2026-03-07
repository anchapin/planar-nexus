'use server';
/**
 * @fileOverview Heuristic Deck Coach for Magic: The Gathering
 *
 * This module provides rule-based deck analysis using heuristics instead of AI.
 * It analyzes decklists based on game rules, mana curves, format requirements,
 * and strategic principles.
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist for a given format.
 * - DeckReviewInput - The input type for the reviewDeck function.
 * - DeckReviewOutput - The return type for the reviewDeck function.
 */

import { validateCardLegality } from '@/app/actions';

export interface DeckReviewInput {
  decklist: string;
  format: string;
}

export interface DeckReviewOutput {
  reviewSummary: string;
  deckOptions: Array<{
    title: string;
    description: string;
    cardsToAdd?: Array<{ name: string; quantity: number }>;
    cardsToRemove?: Array<{ name: string; quantity: number }>;
  }>;
}

/**
 * Parse decklist string into cards
 */
function parseDecklist(decklist: string): Array<{ name: string; quantity: number }> {
  const lines = decklist.split('\n').filter(line => line.trim());
  const cards: Array<{ name: string; quantity: number }> = [];

  for (const line of lines) {
    // Match pattern: "4 Lightning Bolt" or "Lightning Bolt 4"
    const match = line.match(/^(\d+)\s+(.+)$/) || line.match(/^(.+)\s+(\d+)$/);
    if (match) {
      const quantity = parseInt(match[1] || match[2]);
      const name = (match[2] || match[1]).trim();
      cards.push({ name, quantity });
    }
  }

  return cards;
}

/**
 * Analyze deck composition
 */
function analyzeDeck(cards: Array<{ name: string; quantity: number }>): {
  creatureCount: number;
  spellCount: number;
  landCount: number;
  totalCards: number;
  avgManaValue: number;
  manaCurve: Record<string, number>;
} {
  let creatureCount = 0;
  let spellCount = 0;
  let landCount = 0;
  let totalManaValue = 0;
  const manaCurve: Record<string, number> = {};

  // This would need actual card data for accurate analysis
  // For now, we use heuristics based on card names
  for (const card of cards) {
    const nameLower = card.name.toLowerCase();

    // Simple heuristic: cards with "land" in name are lands
    if (nameLower.includes('land') || nameLower.includes('forest') ||
        nameLower.includes('island') || nameLower.includes('mountain') ||
        nameLower.includes('plains') || nameLower.includes('swamp')) {
      landCount += card.quantity;
    } else if (nameLower.includes('creature') || nameLower.includes('beast') ||
               nameLower.includes('soldier') || nameLower.includes('wizard')) {
      creatureCount += card.quantity;
    } else {
      spellCount += card.quantity;
    }

    // Count total cards
    totalManaValue += card.quantity;
  }

  const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
  const avgManaValue = totalCards > 0 ? totalManaValue / cards.length : 0;

  return {
    creatureCount,
    spellCount,
    landCount,
    totalCards,
    avgManaValue,
    manaCurve,
  };
}

/**
 * Generate review summary
 */
function generateReviewSummary(
  analysis: ReturnType<typeof analyzeDeck>,
  format: string
): string {
  const { creatureCount, spellCount, landCount, totalCards } = analysis;

  const summary = [];

  summary.push(`**Deck Overview:** ${totalCards} card deck in ${format} format.`);
  summary.push(`- Creatures: ${creatureCount}`);
  summary.push(`- Spells: ${spellCount}`);
  summary.push(`- Lands: ${landCount}`);

  // Analyze balance
  const total = creatureCount + spellCount + landCount;
  const creatureRatio = creatureCount / total;
  const spellRatio = spellCount / total;
  const landRatio = landCount / total;

  if (landRatio < 0.33) {
    summary.push(`\n**Concern:** Low land count (${landCount}). Consider adding more lands to ensure consistent mana.`);
  } else if (landRatio > 0.45) {
    summary.push(`\n**Note:** High land count (${landCount}). Ensure you have enough spells to utilize your mana.`);
  }

  if (creatureRatio > 0.5) {
    summary.push(`\n**Strategy:** Creature-heavy deck. Consider adding combat tricks and removal spells.`);
  } else if (creatureRatio < 0.2) {
    summary.push(`\n**Strategy:** Control-oriented deck. Ensure you have enough win conditions.`);
  }

  // Format-specific advice
  if (format.toLowerCase() === 'commander') {
    summary.push(`\n**Commander Format:** Ensure your deck has a clear synergy with your commander and includes sufficient ramp.`);
  } else if (format.toLowerCase() === 'standard') {
    summary.push(`\n**Standard Format:** Focus on efficient creatures and removal. Avoid cards that rotate out soon.`);
  } else if (format.toLowerCase() === 'modern') {
    summary.push(`\n**Modern Format:** Consider faster, more efficient options. Ensure your deck can handle a wide range of strategies.`);
  }

  return summary.join('\n');
}

/**
 * Generate heuristic deck improvement options
 */
function generateDeckOptions(
  cards: Array<{ name: string; quantity: number }>,
  format: string
): Array<{
  title: string;
  description: string;
  cardsToAdd?: Array<{ name: string; quantity: number }>;
  cardsToRemove?: Array<{ name: string; quantity: number }>;
}> {
  const options: Array<{
    title: string;
    description: string;
    cardsToAdd?: Array<{ name: string; quantity: number }>;
    cardsToRemove?: Array<{ name: string; quantity: number }>;
  }> = [];

  const analysis = analyzeDeck(cards);
  const { creatureCount, spellCount, landCount, totalCards } = analysis;
  const total = creatureCount + spellCount + landCount;
  const landRatio = landCount / total;

  // Option 1: Fix mana base
  if (landRatio < 0.33 || landRatio > 0.45) {
    const targetLands = Math.round(totalCards * 0.4);
    const landsToAdd = Math.max(0, targetLands - landCount);
    const landsToRemove = Math.max(0, landCount - targetLands);

    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    // Add basic lands based on format
    if (landsToAdd > 0) {
      cardsToAdd.push({ name: 'Forest', quantity: Math.floor(landsToAdd / 5) });
      cardsToAdd.push({ name: 'Island', quantity: Math.floor(landsToAdd / 5) });
      cardsToAdd.push({ name: 'Mountain', quantity: Math.floor(landsToAdd / 5) });
      cardsToAdd.push({ name: 'Plains', quantity: Math.floor(landsToAdd / 5) });
      cardsToAdd.push({ name: 'Swamp', quantity: landsToAdd - Math.floor(landsToAdd / 5) * 4 });
    }

    // Remove some lands if too many
    if (landsToRemove > 0) {
      const landCards = cards.filter(c => c.name.toLowerCase().includes('land'));
      for (let i = 0; i < Math.min(landsToRemove, landCards.length); i++) {
        cardsToRemove.push(landCards[i]);
      }
    }

    options.push({
      title: 'Mana Base Optimization',
      description: landsToAdd > 0
        ? `Add ${landsToAdd} lands to reach the optimal 40% land ratio for consistent mana. This will help you cast your spells on time and avoid mana screw.`
        : `Remove ${landsToRemove} lands to reach the optimal 40% land ratio. Too many lands can leave you with unused mana and fewer action cards.`,
      cardsToAdd: cardsToAdd.length > 0 ? cardsToAdd : undefined,
      cardsToRemove: cardsToRemove.length > 0 ? cardsToRemove : undefined,
    });
  }

  // Option 2: Balance creatures and spells
  const creatureRatio = creatureCount / total;
  const spellRatio = spellCount / total;

  if (creatureRatio < 0.3 || spellRatio < 0.3) {
    options.push({
      title: 'Creature/Spell Balance',
      description: creatureRatio < 0.3
        ? 'Your deck is creature-light. Consider adding more creatures to apply pressure and maintain board presence. Aim for 30-40% creatures in your deck.'
        : 'Your deck is spell-heavy. Consider adding more creatures to provide a board presence and apply consistent pressure. Aim for 30-40% creatures in your deck.',
    });
  }

  // Option 3: Format-specific improvements
  if (format.toLowerCase() === 'commander') {
    options.push({
      title: 'Commander Ramp Package',
      description: 'Add ramp spells and mana rocks to accelerate your mana development in Commander format. This will help you cast your powerful spells earlier and maintain tempo.',
      cardsToAdd: [
        { name: 'Sol Ring', quantity: 1 },
        { name: 'Arcane Signet', quantity: 1 },
      ],
    });
  } else if (format.toLowerCase() === 'standard') {
    options.push({
      title: 'Standard Efficiency Package',
      description: 'Add efficient removal and interaction spells to handle threats in Standard format. Focus on cards that can deal with a wide range of opponents.',
      cardsToAdd: [
        { name: 'Murder', quantity: 2 },
      ],
    });
  }

  // If no specific issues found, provide general improvement suggestions
  if (options.length === 0) {
    options.push({
      title: 'Deck Refinement',
      description: 'Your deck looks well-balanced! Consider testing it against different opponents and adjusting based on performance. Common improvements include adding more card draw, interaction, or win conditions.',
    });
  }

  return options;
}

/**
 * Main review function using heuristics
 */
export async function reviewDeck(input: DeckReviewInput): Promise<DeckReviewOutput> {
  const cards = parseDecklist(input.decklist);
  const analysis = analyzeDeck(cards);

  const reviewSummary = generateReviewSummary(analysis, input.format);
  const deckOptions = generateDeckOptions(cards, input.format);

  return {
    reviewSummary,
    deckOptions,
  };
}
