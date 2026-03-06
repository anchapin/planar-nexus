/**
 * @fileOverview Heuristic deck coach for Magic: The Gathering
 *
 * This module provides offline deck coaching using rule-based heuristics
 * and predefined archetype templates instead of AI API calls.
 * Works entirely client-side for offline support.
 */

import type { DeckCard } from '@/app/actions';
import { analyzeDeck } from '@/lib/deck-analyzer';

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
    keywords: ["mana", "land", "ramp", "big", "elvish", "growth", "search"],
    strategy: "Ramp decks accelerate mana production to play powerful threats earlier than usual.",
    priorityCards: [
      { name: "Cultivate", quantity: 2 },
      { name: "Kodama's Reach", quantity: 2 },
      { name: "Sol Ring", quantity: 1 },
    ],
    weakCards: ["small", "aggro", "control"],
    suggestions: [
      "Add more mana acceleration",
      "Include big finishers to ramp into",
      "Add card draw to keep pressure on",
      "Consider land-based ramp for consistency",
    ],
  },
  {
    name: "Tribal",
    keywords: ["tribal", "zombie", "elf", "goblin", "vampire", "human", "wizard", "tribe"],
    strategy: "Tribal decks focus on synergies between cards of a specific creature type.",
    priorityCards: [
      { name: "Lords", quantity: 2 },
      { name: "Tribe", quantity: 2 },
    ],
    weakCards: ["non-tribal", "removal"],
    suggestions: [
      "Focus on your tribe's synergies",
      "Include tribal lords for buffs",
      "Add cards that protect your tribe",
      "Consider cards that generate token copies of your tribe",
    ],
  },
];

// Card suggestion database by color and archetype
const CARD_SUGGESTIONS: Record<string, Record<string, Array<{ name: string; quantity: number; reason: string }>>> = {
  "red": {
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Efficient removal and reach" },
      { name: "Chain Lightning", quantity: 2, reason: "Additional burn spell" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat with card advantage" },
    ],
    control: [
      { name: "Abrade", quantity: 2, reason: "Versatile artifact/creature removal" },
      { name: "Chandra, Torch of Defiance", quantity: 1, reason: "Planeswalker with card advantage and damage" },
    ],
  },
  "blue": {
    control: [
      { name: "Counterspell", quantity: 2, reason: "Universal counter spell" },
      { name: "Arcane Signet", quantity: 1, reason: "Mana fixing and ramp" },
      { name: "Brainstorm", quantity: 2, reason: "Card selection and filtering" },
    ],
    combo: [
      { name: "Pact of Negation", quantity: 1, reason: "Protection for combo turn" },
      { name: "High Tide", quantity: 2, reason: "Mana generation for combo" },
    ],
  },
  "black": {
    control: [
      { name: "Thoughtseize", quantity: 2, reason: "Disruption and information" },
      { name: "Doom Blade", quantity: 2, reason: "Efficient creature removal" },
    ],
    aggro: [
      { name: "Thoughtseize", quantity: 2, reason: "Remove opponent's answers" },
      { name: "Fatal Push", quantity: 2, reason: "Cheap creature removal" },
    ],
  },
  "green": {
    ramp: [
      { name: "Cultivate", quantity: 2, reason: "Land ramp and fixing" },
      { name: "Kodama's Reach", quantity: 2, reason: "Additional land ramp" },
      { name: "Birds of Paradise", quantity: 2, reason: "Mana dork for early acceleration" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Versatile removal" },
      { name: "Collected Company", quantity: 2, reason: "Card advantage and creature tutoring" },
    ],
  },
  "white": {
    control: [
      { name: "Swords to Plowshares", quantity: 2, reason: "Best creature removal in the game" },
      { name: "Path to Exile", quantity: 2, reason: "Exile removal for problematic creatures" },
      { name: "Wrath of God", quantity: 1, reason: "Board wipe for creature-heavy matchups" },
    ],
    aggro: [
      { name: "Thalia, Guardian of Thraben", quantity: 2, reason: "Disrupts opponents' strategies" },
      { name: "Kytheon, Hero of Akros", quantity: 2, reason: "Efficient early threat" },
    ],
  },
};

/**
 * Analyze deck and return coach review using heuristics
 */
export async function heuristicDeckReview(
  decklist: string,
  format: string
): Promise<DeckReviewOutput> {
  // Parse decklist to get cards
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  const cards: DeckCard[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^(?:(\d+)\s*x?\s*)?(.+)/);
    if (match) {
      const name = match[2]?.trim();
      const count = parseInt(match[1] || '1', 10);
      if (name && !/^\/\//.test(name) && name.toLowerCase() !== 'sideboard') {
        cards.push({
          id: `temp-${name}-${count}`,
          name,
          count,
          type_line: 'Unknown',
          cmc: 0,
          colors: [],
        } as DeckCard);
      }
    }
  }

  // Get heuristic analysis
  const analysis = analyzeDeck(cards, format);

  // Detect archetype
  const archetype = detectArchetype(cards);

  // Generate review summary
  const reviewSummary = generateReviewSummary(analysis, archetype, format);

  // Generate deck options
  const deckOptions = generateDeckOptions(cards, analysis, archetype, format);

  return {
    reviewSummary,
    deckOptions,
  };
}

/**
 * Detect the primary archetype of a deck
 */
function detectArchetype(cards: DeckCard[]): ArchetypeTemplate {
  const cardText = cards.map(c => c.name.toLowerCase()).join(' ');

  let bestMatch: ArchetypeTemplate = ARCHETYPE_TEMPLATES[0];
  let bestScore = 0;

  for (const template of ARCHETYPE_TEMPLATES) {
    let score = 0;
    for (const keyword of template.keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = cardText.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  return bestMatch;
}

/**
 * Generate a comprehensive review summary
 */
function generateReviewSummary(
  analysis: ReturnType<typeof analyzeDeck>,
  archetype: ArchetypeTemplate,
  format: string
): string {
  const parts: string[] = [];

  // Overall assessment
  parts.push(`Overall Deck Rating: ${analysis.overallRating}/10`);
  parts.push('');

  // Archetype identification
  parts.push(`Primary Archetype: ${archetype.name}`);
  parts.push(archetype.strategy);
  parts.push('');

  // Mana curve analysis
  parts.push(`Mana Curve: ${analysis.manaCurve.rating}/10 (Average CMC: ${analysis.manaCurve.averageCMC.toFixed(1)})`);
  if (analysis.manaCurve.issues.length > 0) {
    parts.push(`Issues: ${analysis.manaCurve.issues.join(' ')}`);
  }
  parts.push('');

  // Color distribution
  const colorLabels = Object.entries(analysis.colorDistribution.colors)
    .filter(([_, count]) => count > 0)
    .map(([color, count]) => `${color}: ${count}`)
    .join(', ');
  parts.push(`Color Distribution: ${colorLabels} (${analysis.colorDistribution.colorCount} colors, ${analysis.colorDistribution.rating}/10)`);
  if (analysis.colorDistribution.issues.length > 0) {
    parts.push(`Issues: ${analysis.colorDistribution.issues.join(' ')}`);
  }
  parts.push('');

  // Card type distribution
  parts.push(`Card Types: ${analysis.cardTypeDistribution.creatures} creatures, ${analysis.cardTypeDistribution.spells} spells, ${analysis.cardTypeDistribution.lands} lands (${analysis.cardTypeDistribution.rating}/10)`);
  if (analysis.cardTypeDistribution.issues.length > 0) {
    parts.push(`Issues: ${analysis.cardTypeDistribution.issues.join(' ')}`);
  }
  parts.push('');

  // Removal analysis
  parts.push(`Removal: ${analysis.removalAnalysis.count} cards (${analysis.removalAnalysis.rating}/10)`);
  if (analysis.removalAnalysis.issues.length > 0) {
    parts.push(`Issues: ${analysis.removalAnalysis.issues.join(' ')}`);
  }
  parts.push('');

  // Ramp analysis
  parts.push(`Ramp: ${analysis.rampAnalysis.count} cards (${analysis.rampAnalysis.rating}/10)`);
  if (analysis.rampAnalysis.issues.length > 0) {
    parts.push(`Issues: ${analysis.rampAnalysis.issues.join(' ')}`);
  }
  parts.push('');

  // Synergy analysis
  if (analysis.synergyAnalysis.pairs.length > 0) {
    parts.push(`Synergies: ${analysis.synergyAnalysis.pairs.length} detected (${analysis.synergyAnalysis.rating}/10)`);
    for (const pair of analysis.synergyAnalysis.pairs) {
      parts.push(`- ${pair.description}: ${pair.cards.join(' + ')}`);
    }
  } else {
    parts.push(`Synergies: No obvious synergies detected (${analysis.synergyAnalysis.rating}/10)`);
  }
  parts.push('');

  // Strengths
  const strengths: string[] = [];
  if (analysis.manaCurve.rating >= 7) strengths.push('Good mana curve');
  if (analysis.removalAnalysis.rating >= 7) strengths.push('Strong removal suite');
  if (analysis.rampAnalysis.rating >= 7) strengths.push('Excellent ramp');
  if (analysis.synergyAnalysis.rating >= 7) strengths.push('Good synergy');

  if (strengths.length > 0) {
    parts.push('Strengths:');
    strengths.forEach(s => parts.push(`- ${s}`));
    parts.push('');
  }

  // Weaknesses
  const weaknesses: string[] = [];
  if (analysis.manaCurve.rating <= 4) weaknesses.push('Poor mana curve');
  if (analysis.removalAnalysis.rating <= 4) weaknesses.push('Insufficient removal');
  if (analysis.rampAnalysis.rating <= 4) weaknesses.push('Needs more ramp');
  if (analysis.synergyAnalysis.rating <= 4) weaknesses.push('Lacks synergies');

  if (weaknesses.length > 0) {
    parts.push('Weaknesses:');
    weaknesses.forEach(w => parts.push(`- ${w}`));
    parts.push('');
  }

  // Format-specific advice
  parts.push('Format Analysis:');
  parts.push(`This deck is built for ${format} format. `);
  if (format === 'commander') {
    parts.push('Consider ensuring you have 100 cards and a defined commander. ');
    parts.push('Commander decks typically need 35-40 lands for consistent mana. ');
  } else if (['standard', 'modern', 'pioneer'].includes(format)) {
    parts.push('Ensure you have at least 60 cards for competitive play. ');
    parts.push('Consider building a 15-card sideboard for tournament play. ');
  }
  parts.push('');

  // Strategic advice
  parts.push('Strategic Recommendations:');
  for (const suggestion of archetype.suggestions) {
    parts.push(`- ${suggestion}`);
  }

  return parts.join('\n');
}

/**
 * Generate deck improvement options
 */
function generateDeckOptions(
  cards: DeckCard[],
  analysis: ReturnType<typeof analyzeDeck>,
  archetype: ArchetypeTemplate,
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

  // Option 1: Improve ramp
  if (analysis.rampAnalysis.rating < 7) {
    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    // Add ramp cards
    const colors = getDeckColors(cards);
    for (const color of colors) {
      const colorSuggestions = CARD_SUGGESTIONS[color];
      if (colorSuggestions && colorSuggestions.ramp) {
        for (const suggestion of colorSuggestions.ramp.slice(0, 2)) {
          cardsToAdd.push({ name: suggestion.name, quantity: suggestion.quantity });
        }
      }
    }
    // Add universal ramp
    cardsToAdd.push({ name: "Sol Ring", quantity: 1 });
    cardsToAdd.push({ name: "Arcane Signet", quantity: 1 });

    // Remove high CMC cards
    const highCmcCards = cards.filter(c => (c.cmc || 0) >= 6).slice(0, cardsToAdd.length);
    for (const card of highCmcCards) {
      cardsToRemove.push({ name: card.name, quantity: 1 });
    }

    options.push({
      title: "Improve Ramp Package",
      description: `Your deck needs more mana acceleration. This option adds ${cardsToAdd.length} ramp cards and removes high-cost cards to improve your early game consistency. Better ramp means you can play your powerful threats earlier and more reliably.`,
      cardsToAdd,
      cardsToRemove,
    });
  }

  // Option 2: Improve removal
  if (analysis.removalAnalysis.rating < 7) {
    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    // Add removal based on colors
    const colors = getDeckColors(cards);
    for (const color of colors) {
      const colorSuggestions = CARD_SUGGESTIONS[color];
      if (colorSuggestions) {
        const archetypeSuggestions = colorSuggestions[archetype.name.toLowerCase() as keyof typeof colorSuggestions];
        if (Array.isArray(archetypeSuggestions)) {
          for (const suggestion of archetypeSuggestions.slice(0, 2)) {
            if (suggestion.reason.toLowerCase().includes('removal')) {
              cardsToAdd.push({ name: suggestion.name, quantity: suggestion.quantity });
            }
          }
        }
      }
    }

    // Add universal removal
    if (cardsToAdd.length < 4) {
      cardsToAdd.push({ name: "Swords to Plowshares", quantity: 2 });
      cardsToAdd.push({ name: "Path to Exile", quantity: 2 });
    }

    // Remove weak creatures
    const weakCreatures = cards.filter(c => c.type_line?.toLowerCase().includes('creature')).slice(0, cardsToAdd.length);
    for (const card of weakCreatures) {
      cardsToRemove.push({ name: card.name, quantity: 1 });
    }

    options.push({
      title: "Improve Removal Suite",
      description: `Your deck lacks sufficient answers to opponent threats. This option adds ${cardsToAdd.length} removal spells and removes underperforming creatures. Better removal gives you more control over the game and helps you deal with problematic cards.`,
      cardsToAdd,
      cardsToRemove,
    });
  }

  // Option 3: Optimize for archetype
  const cardsToAdd: Array<{ name: string; quantity: number }> = [];
  const cardsToRemove: Array<{ name: string; quantity: number }> = [];

  // Add archetype-specific cards
  for (const card of archetype.priorityCards.slice(0, 4)) {
    cardsToAdd.push({ name: card.name, quantity: card.quantity });
  }

  // Remove cards that don't fit archetype
  const colors = getDeckColors(cards);
  const colorSuggestions = CARD_SUGGESTIONS[colors[0]] || CARD_SUGGESTIONS['white'];
  if (colorSuggestions) {
    const archetypeSuggestions = colorSuggestions[archetype.name.toLowerCase() as keyof typeof colorSuggestions];
    if (Array.isArray(archetypeSuggestions)) {
      for (const suggestion of archetypeSuggestions.slice(0, 3)) {
        cardsToAdd.push({ name: suggestion.name, quantity: suggestion.quantity });
      }
    }
  }

  // Remove weak/inefficient cards
  const weakCards = cards.filter(c => {
    const name = c.name.toLowerCase();
    return archetype.weakCards.some(w => name.includes(w));
  }).slice(0, cardsToAdd.length);

  for (const card of weakCards) {
    cardsToRemove.push({ name: card.name, quantity: 1 });
  }

  options.push({
    title: `Optimize for ${archetype.name} Strategy`,
    description: `This option focuses your deck on ${archetype.name} strategy by adding ${cardsToAdd.length} on-theme cards and removing ${cardsToRemove.length} cards that don't fit the strategy. ${archetype.strategy}`,
    cardsToAdd,
    cardsToRemove,
  });

  // Option 4: Balance mana curve
  if (analysis.manaCurve.rating < 7) {
    const cardsToAdd: Array<{ name: string; quantity: number }> = [];
    const cardsToRemove: Array<{ name: string; quantity: number }> = [];

    // Add low CMC cards
    const lowCmcSuggestions = [
      { name: "Ponder", quantity: 2 },
      { name: "Preordain", quantity: 2 },
      { name: "Thoughtseize", quantity: 2 },
    ];

    for (const suggestion of lowCmcSuggestions.slice(0, 3)) {
      cardsToAdd.push(suggestion);
    }

    // Remove high CMC cards
    const highCmcCards = cards.filter(c => (c.cmc || 0) >= 5).slice(0, cardsToAdd.length);
    for (const card of highCmcCards) {
      cardsToRemove.push({ name: card.name, quantity: 1 });
    }

    options.push({
      title: "Balance Mana Curve",
      description: `Your mana curve is too high. This option adds ${cardsToAdd.length} low-cost spells and removes ${cardsToRemove.length} expensive cards to smooth out your curve. A better curve ensures you have plays in the early game and can compete effectively.`,
      cardsToAdd,
      cardsToRemove,
    });
  }

  // Ensure we have at least 2 options
  while (options.length < 2) {
    options.push({
      title: "General Optimization",
      description: "This option provides general deck improvements based on standard building principles. Focus on card quality, consistency, and synergy to create a more competitive deck.",
    });
  }

  return options;
}

/**
 * Get the colors present in a deck
 */
function getDeckColors(cards: DeckCard[]): string[] {
  const colorSet = new Set<string>();

  for (const card of cards) {
    if (card.colors && card.colors.length > 0) {
      for (const color of card.colors) {
        colorSet.add(color);
      }
    }
  }

  return Array.from(colorSet);
}
