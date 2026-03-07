/**
 * @fileOverview Heuristic deck coach for Magic: The Gathering
 *
 * This module provides offline deck coaching using rule-based heuristics
 * and predefined archetype templates instead of AI API calls.
 * Works entirely client-side for offline support.
 */

import type { DeckCard } from '@/app/actions';

// Extended interface for heuristic analysis with optional properties
interface HeuristicCard {
  name: string;
  count: number;
  id?: string;
  cmc?: number;
  colors?: string[];
  legalities?: Record<string, string>;
  type_line?: string;
  mana_cost?: string;
  color_identity?: string[];
}

// Output types matching the original AI coach
export interface DeckReviewOutput {
  reviewSummary: string;
  deckOptions: Array<{
    title: string;
    description: string;
    cardsToAdd?: Array<{ name: string; quantity: number }>;
    cardsToRemove?: Array<{ name: string; quantity: number }>;
  }>;
}

// Archetype definitions
interface ArchetypeTemplate {
  name: string;
  keywords: string[];
  strategy: string;
  priorityCards: Array<{ name: string; quantity: number }>;
  weakCards: string[];
  suggestions: string[];
}

const ARCHETYPE_TEMPLATES: ArchetypeTemplate[] = [
  {
    name: "Control",
    keywords: ["counter", "draw", "wrath", "sweep", "control", "instant", "sorcery"],
    strategy: "Control decks aim to delay the game until they can establish dominance through card advantage and powerful finishers.",
    priorityCards: [
      { name: "Counterspell", quantity: 2 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
    ],
    weakCards: ["vanilla", "aggressive", "early game"],
    suggestions: [
      "Add more counterspells for protection",
      "Include card draw engines",
      "Add board wipes for creature-heavy matchups",
      "Include a powerful finisher or two",
    ],
  },
  {
    name: "Aggro",
    keywords: ["attack", "haste", "battlefield", "damage", "fast", "aggressive", "creature"],
    strategy: "Aggro decks aim to win quickly by playing cheap threats and applying pressure before the opponent can stabilize.",
    priorityCards: [
      { name: "Lightning Bolt", quantity: 2 },
      { name: "Goblin Guide", quantity: 2 },
      { name: "Swiftspear", quantity: 2 },
    ],
    weakCards: ["expensive", "slow", "control"],
    suggestions: [
      "Lower your mana curve for faster plays",
      "Add more cheap threats",
      "Include burn spells for reach",
      "Consider adding haste creatures",
    ],
  },
  {
    name: "Midrange",
    keywords: ["value", "efficient", "threat", "mid", "versatile", "removal"],
    strategy: "Midrange decks aim to play efficient threats backed by removal and card advantage to out-value opponents.",
    priorityCards: [
      { name: "Abrade", quantity: 2 },
      { name: "Thoughtseize", quantity: 2 },
      { name: "Bloodbraid Elf", quantity: 2 },
    ],
    weakCards: ["expensive", "fast", "combo"],
    suggestions: [
      "Balance your curve between early and late game",
      "Include versatile removal spells",
      "Add cards that generate value over time",
      "Consider planeswalkers for sustained pressure",
    ],
  },
  {
    name: "Combo",
    keywords: ["combo", "infinite", "loop", "assemble", "win condition", "pieces"],
    strategy: "Combo decks aim to assemble a specific card combination that creates an overwhelming advantage or instant win.",
    priorityCards: [
      { name: "Pact of Negation", quantity: 1 },
      { name: "Dark Ritual", quantity: 2 },
      { name: "Gitaxian Probe", quantity: 2 },
    ],
    weakCards: ["slow", "interactive", "midrange"],
    suggestions: [
      "Add more card draw to find combo pieces",
      "Include protection for your combo",
      "Add tutors to find key pieces",
      "Consider adding backup win conditions",
    ],
  },
  {
    name: "Ramp",
    keywords: ["mana", "ramp", "land", "forest", "island", "swamp", "mountain", "plains", "creatures", "mana value", "x"],
    strategy: "Ramp decks accelerate mana production to play expensive threats ahead of curve.",
    priorityCards: [
      { name: "Sol Ring", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Cultivate", quantity: 2 },
      { name: "Kodama's Reach", quantity: 2 },
    ],
    weakCards: ["fast", "aggro", "pressure"],
    suggestions: [
      "Add more mana acceleration spells",
      "Include more card draw to find threats",
      "Add more big finishers for late game",
      "Consider land tutors for consistency",
    ],
  },
  {
    name: "Tribal",
    keywords: ["tribe", "lord", "goblin", "elf", "vampire", "warrior", "human", "knight"],
    strategy: "Tribal decks focus on a creature type that synergizes through tribal support.",
    priorityCards: [
      { name: "Cryptic Command", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Sol Ring", quantity: 1 },
    ],
    weakCards: ["diverse", "non-tribal", "control"],
    suggestions: [
      "Add more tribal lords and buffs",
      "Include removal that tribal creatures can't answer",
      "Consider card draw specific to your tribe",
      "Add tribal finishers that scale with board",
    ],
  },
];

// Format-specific recommendations
const FORMAT_RECOMMENDATIONS: Record<string, string[]> = {
  commander: [
    "Include reliable ramp (Sol Ring, Arcane Signet, etc.)",
    "Add card draw engines to refuel after sweepers",
    "Consider Commander protection (Heroic Intervention, Teferi's Protection)",
    "Include board wipes for creature-heavy matchups",
    "Add interaction for combo decks (Stifle, Rule of Law)",
  ],
  standard: [
    "Focus on synergy with current set mechanics",
    "Include removal for aggressive archetypes",
    "Add card advantage engines",
    "Consider sideboard options for major matchups",
  ],
  modern: [
    "Include disruption for combo decks (Thoughtseize, Inquisition)",
    "Add efficient removal spells",
    "Consider powerful finishers",
    "Include graveyard hate if relevant",
  ],
  pioneer: [
    "Focus on two-color consistency",
    "Include efficient removal",
    "Add value engines and card draw",
    "Consider meta-relevant finishers",
  ],
  legacy: [
    "Include efficient interaction (Force of Will, Brainstorm)",
    "Add powerful finishers",
    "Consider combo disruption",
    "Include graveyard hate and artifact hate",
  ],
  vintage: [
    "Include free counters (Force of Will, Mental Misstep)",
    "Add powerful mana acceleration",
    "Consider powerful finishers",
    "Include artifact hate",
  ],
  pauper: [
    "Focus on common-only synergy",
    "Include efficient removal and card advantage",
    "Consider tribal strategies",
    "Add bounce effects",
  ],
};


// Analyze deck components
function analyzeDeckComposition(deck: HeuristicCard[]): {
  totalCards: number;
  avgManaValue: number;
  colorDistribution: Record<string, number>;
  cardTypes: Record<string, number>;
  archetypeScores: Record<string, number>;
} {
  const totalCards = deck.reduce((sum, card) => sum + card.count, 0);
  let totalManaValue = 0;
  let totalManaValueCards = 0;
  const colorDistribution: Record<string, number> = {};
  const cardTypes: Record<string, number> = {};

  deck.forEach(card => {
    const count = card.count;
    const manaValue = parseInt(card.mana_cost?.match(/\d+/)?.[0] || '0') || 0;

    if (manaValue > 0) {
      totalManaValue += manaValue * count;
      totalManaValueCards += count;
    }

    // Count colors
    const colors = card.color_identity || [];
    colors.forEach(color => {
      colorDistribution[color] = (colorDistribution[color] || 0) + count;
    });

    // Count card types
    const typeLine = card.type_line || '';
    if (typeLine.includes('Creature')) cardTypes.creature = (cardTypes.creature || 0) + count;
    if (typeLine.includes('Instant')) cardTypes.instant = (cardTypes.instant || 0) + count;
    if (typeLine.includes('Sorcery')) cardTypes.sorcery = (cardTypes.sorcery || 0) + count;
    if (typeLine.includes('Artifact')) cardTypes.artifact = (cardTypes.artifact || 0) + count;
    if (typeLine.includes('Enchantment')) cardTypes.enchantment = (cardTypes.enchantment || 0) + count;
    if (typeLine.includes('Planeswalker')) cardTypes.planeswalker = (cardTypes.planeswalker || 0) + count;
  });

  const avgManaValue = totalManaValueCards > 0 ? totalManaValue / totalManaValueCards : 0;

  // Detect archetype
  const deckText = deck.map(card => card.name.toLowerCase()).join(' ');
  const archetypeScores: Record<string, number> = {};

  ARCHETYPE_TEMPLATES.forEach(template => {
    archetypeScores[template.name] = template.keywords.reduce((score, keyword) => {
      const matches = (deckText.match(new RegExp(keyword, 'g')) || []).length;
      return score + matches;
    }, 0);
  });

  // Bonus for creature-heavy vs instant-heavy
  const creatureRatio = (cardTypes.creature || 0) / totalCards;
  const instantRatio = (cardTypes.instant || 0) / totalCards;

  if (creatureRatio > 0.4) {
    archetypeScores.Aggro += 5;
    archetypeScores.Tribal += 3;
  }
  if (instantRatio > 0.15) {
    archetypeScores.Control += 5;
  }

  return {
    totalCards,
    avgManaValue,
    colorDistribution,
    cardTypes,
    archetypeScores,
  };
}

// Generate review summary
function generateReviewSummary(
  composition: ReturnType<typeof analyzeDeckComposition>,
  _format: string,
  deck: HeuristicCard[]
): string {
  const { totalCards, avgManaValue, archetypeScores } = composition;

  // Find dominant archetype
  const sortedArchetypes = Object.entries(archetypeScores)
    .sort(([, a], [, b]) => b - a);
  const dominantArchetype = sortedArchetypes[0];
  const archetypeName: string = dominantArchetype && dominantArchetype[1] > 0 ? dominantArchetype[0] : 'Unknown';
  const archetypeTemplate = ARCHETYPE_TEMPLATES.find(t => t.name === archetypeName);

  let summary = "";

  // Archetype analysis
  summary += `This appears to be a ${archetypeName || 'mixed'} deck`;
  if (archetypeTemplate) {
    summary += `. ${archetypeTemplate.strategy}\n\n`;
  }

  // Deck size
  if (_format === 'commander') {
    if (totalCards < 99) {
      summary += `⚠️ Deck size (${totalCards}) is below the 100-card minimum for Commander. You'll need ${100 - totalCards} more cards.\n\n`;
    } else if (totalCards > 100) {
      summary += `⚠️ Deck size (${totalCards}) exceeds the 100-card limit for Commander. Consider removing ${totalCards - 100} cards.\n\n`;
    }
  } else {
    if (totalCards < 60) {
      summary += `⚠️ Deck size (${totalCards}) is below the typical 60-card minimum. You'll need ${60 - totalCards} more cards.\n\n`;
    } else if (totalCards > 60) {
      summary += `⚠️ Deck size (${totalCards}) exceeds the typical 60-card limit. Consider removing ${totalCards - 60} cards for efficiency.\n\n`;
    }
  }

  // Mana curve analysis
  if (avgManaValue < 2.5) {
    summary += `✅ Low mana curve (${avgManaValue.toFixed(2)}) - excellent for early game pressure.\n\n`;
  } else if (avgManaValue < 3.5) {
    summary += `✅ Balanced mana curve (${avgManaValue.toFixed(2)}) - good mix of early and late game.\n\n`;
  } else {
    summary += `⚠️ High mana curve (${avgManaValue.toFixed(2)}) - may struggle against aggressive decks. Consider adding more low-cost spells.\n\n`;
  }

  // Card type distribution
  const creatureCount = composition.cardTypes.creature || 0;
  const nonCreatureCount = totalCards - creatureCount;

  if (creatureCount > nonCreatureCount * 1.5) {
    summary += `✅ Creature-heavy build (${creatureCount} creatures). Good for aggressive or tribal strategies.\n\n`;
  } else if (creatureCount < nonCreatureCount * 0.5) {
    summary += `✅ Non-creature heavy build (${nonCreatureCount} non-creature spells). Good for control or combo strategies.\n\n`;
  }

  // Color distribution
  const colors = Object.keys(composition.colorDistribution);
  if (colors.length === 1) {
    summary += `✅ Monocolor ${colors[0]} deck - excellent consistency and mana base efficiency.\n\n`;
  } else if (colors.length === 2) {
    summary += `✅ Two-color deck (${colors.join('/')}) - good balance of consistency and power.\n\n`;
  } else if (colors.length >= 3) {
    summary += `⚠️ ${colors.length}-color deck - consider the mana base carefully to ensure consistency.\n\n`;
  }

  // Format-specific recommendations
  if (FORMAT_RECOMMENDATIONS[_format]) {
    summary += "Format-specific suggestions:\n";
    FORMAT_RECOMMENDATIONS[_format].forEach(rec => {
      summary += `• ${rec}\n`;
    });
    summary += "\n";
  }

  // Archetype-specific suggestions
  if (archetypeTemplate) {
    summary += `${archetypeTemplate.name}-specific suggestions:\n`;
    archetypeTemplate.suggestions.slice(0, 3).forEach((rec: string) => {
      summary += `• ${rec}\n`;
    });
  }

  return summary;
}

// Generate deck options
function generateDeckOptions(
  composition: ReturnType<typeof analyzeDeckComposition>,
  _deck: HeuristicCard[],
  format: string
): DeckReviewOutput['deckOptions'] {
  const options: DeckReviewOutput['deckOptions'] = [];
  const { avgManaValue, cardTypes, archetypeScores } = composition;

  // Find dominant archetype
  const sortedArchetypes = Object.entries(archetypeScores)
    .sort(([, a], [, b]) => b - a);
  const dominantArchetype = sortedArchetypes[0];
  const archetypeName: string = dominantArchetype && dominantArchetype[1] > 0 ? dominantArchetype[0] : 'Unknown';
  const archetypeTemplate = ARCHETYPE_TEMPLATES.find(t => t.name === archetypeName);

  // Generate archetype-specific option
  if (archetypeTemplate) {
    const cardsToAdd = archetypeTemplate.priorityCards
      .filter(pc => !_deck.some(c => c.name.toLowerCase() === pc.name.toLowerCase()))
      .slice(0, 4);

    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    // Suggest removing high-cost cards for aggro, or low-cost for control
    if (archetypeName === 'Aggro' && avgManaValue > 3.5) {
      const expensiveCards = _deck
        .filter((c: HeuristicCard) => {
          const mv = parseInt(c.mana_cost?.match(/\d+/)?.[0] || '0') || 0;
          return mv >= 4 && c.count > 0;
        })
        .slice(0, 3)
        .map(c => ({ name: c.name, quantity: Math.min(c.count, 1) }));

      cardsToRemove.push(...expensiveCards);
    } else if (archetypeName === 'Control' && avgManaValue < 2.5) {
      const cheapCards = _deck
        .filter((c: HeuristicCard) => {
          const mv = parseInt(c.mana_cost?.match(/\d+/)?.[0] || '0') || 0;
          return mv <= 2 && c.count > 0 && c.type_line?.includes('Creature');
        })
        .slice(0, 3)
        .map(c => ({ name: c.name, quantity: Math.min(c.count, 1) }));

      cardsToRemove.push(...cheapCards);
    }

    if (cardsToAdd.length > 0 || cardsToRemove.length > 0) {
      options.push({
        title: `Optimize for ${archetypeName}`,
        description: archetypeTemplate.strategy,
        cardsToAdd: cardsToAdd.length > 0 ? cardsToAdd : undefined,
        cardsToRemove: cardsToRemove.length > 0 ? cardsToRemove : undefined,
      });
    }
  }

  // Generate balance option
  if (avgManaValue > 4 || avgManaValue < 2) {
    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    if (avgManaValue > 4) {
      // Add low-cost spells
      cardsToAdd.push(
        { name: "Lightning Bolt", quantity: 2 },
        { name: "Thoughtseize", quantity: 2 },
        { name: "Cantrips", quantity: 3 }
      );

      // Remove high-cost cards
      const expensiveCards = _deck
        .filter((c: HeuristicCard) => {
          const mv = parseInt(c.mana_cost?.match(/\d+/)?.[0] || '0') || 0;
          return mv >= 5 && c.count > 0;
        })
        .slice(0, 2)
        .map(c => ({ name: c.name, quantity: Math.min(c.count, 1) }));

      cardsToRemove.push(...expensiveCards);
    } else {
      // Add mid-range threats
      cardsToAdd.push(
        { name: "Midrange Threat", quantity: 3 },
        { name: "Value Engine", quantity: 2 },
        { name: "Finisher", quantity: 1 }
      );

      // Remove very low-cost cards
      const cheapCards = _deck
        .filter((c: HeuristicCard) => {
          const mv = parseInt(c.mana_cost?.match(/\d+/)?.[0] || '0') || 0;
          return mv <= 1 && c.count > 0;
        })
        .slice(0, 2)
        .map((c: HeuristicCard) => ({ name: c.name, quantity: Math.min(c.count, 1) }));

      cardsToRemove.push(...cheapCards);
    }

    if (cardsToAdd.length > 0 || cardsToRemove.length > 0) {
      options.push({
        title: "Balance Mana Curve",
        description: avgManaValue > 4
          ? "Your curve is too high. Add more low-cost interaction to survive early game."
          : "Your curve is too low. Add more mid-range threats for late game relevance.",
        cardsToAdd: cardsToAdd.length > 0 ? cardsToAdd : undefined,
        cardsToRemove: cardsToRemove.length > 0 ? cardsToRemove : undefined,
      });
    }
  }

  // Generate consistency option
  const colors = Object.keys(composition.colorDistribution);
  if (colors.length >= 3) {
    options.push({
      title: "Improve Consistency",
      description: `${colors.length}-color decks can be inconsistent. Consider removing one color or adding more fixing.`,
      cardsToAdd: [
        { name: "Arcane Signet", quantity: 1 },
        { name: "Sol Ring", quantity: 1 },
        { name: colorFixingForColors(colors), quantity: 2 },
      ],
      cardsToRemove: _deck
        .filter((c: HeuristicCard) => {
          const cardColors = c.color_identity || [];
          return cardColors.length === 1 && c.count > 0 && c.type_line?.includes('Land');
        })
        .slice(0, 2)
        .map((c: HeuristicCard) => ({ name: c.name, quantity: Math.min(c.count, 1) })),
    });
  }

  return options;
}

function colorFixingForColors(colors: string[]): string {
  if (colors.includes('W') && colors.includes('U')) return "Azorius Signet";
  if (colors.includes('U') && colors.includes('B')) return "Dimir Signet";
  if (colors.includes('B') && colors.includes('R')) return "Rakdos Signet";
  if (colors.includes('R') && colors.includes('G')) return "Gruul Signet";
  if (colors.includes('G') && colors.includes('W')) return "Selesnya Signet";
  if (colors.includes('W') && colors.includes('B')) return "Orzhov Signet";
  if (colors.includes('U') && colors.includes('R')) return "Izzet Signet";
  if (colors.includes('B') && colors.includes('G')) return "Golgari Signet";
  if (colors.includes('R') && colors.includes('W')) return "Boros Signet";
  if (colors.includes('G') && colors.includes('U')) return "Simic Signet";
  return "Command Tower";
}

/**
 * Main function to analyze a deck and generate coaching feedback
 *
 * @param decklist - The deck list as text (e.g., "1 Sol Ring\n2 Lightning Bolt...")
 * @param format - The format (e.g., "commander", "modern", "standard")
 * @param cards - Parsed card data for the deck
 * @returns Deck review with summary and options for improvement
 */
export function reviewDeckHeuristic(
  decklist: string,
  format: string,
  cards: HeuristicCard[]
): DeckReviewOutput {
  const composition = analyzeDeckComposition(cards);
  const reviewSummary = generateReviewSummary(composition, format, cards);
  const deckOptions = generateDeckOptions(composition, cards, format);

  return {
    reviewSummary,
    deckOptions,
  };
}
