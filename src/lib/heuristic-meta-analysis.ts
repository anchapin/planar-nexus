/**
 * @fileOverview Heuristic meta analysis for deck optimization
 *
 * This module provides offline metagame analysis using rule-based heuristics
 * and predefined format information instead of AI API calls.
 * Works entirely client-side for offline support.
 */

import type { DeckCard } from '@/app/actions';

// Output types matching the original AI meta analysis
export interface MetaAnalysisOutput {
  metaOverview: string;
  deckStrengths: string[];
  deckWeaknesses: string[];
  matchupAnalysis: Array<{
    archetype: string;
    recommendation: string;
    sideboardNotes?: string;
  }>;
  cardSuggestions: {
    cardsToAdd: Array<{ name: string; quantity: number; reason: string }>;
    cardsToRemove: Array<{ name: string; quantity: number; reason: string }>;
  };
  sideboardSuggestions?: Array<{ name: string; quantity: number; reason: string }>;
  strategicAdvice: string;
}

// Format metagame data
interface FormatMeta {
  tierDecks: string[];
  dominantStrategies: string[];
  trends: string[];
  matchups: Array<{
    archetype: string;
    description: string;
    weaknesses: string[];
  }>;
}

const FORMAT_META_DATA: Record<string, FormatMeta> = {
  commander: {
    tierDecks: [
      "Tier 1: Commander staples and optimized builds",
      "Tier 2: Focused tribal and strategy decks",
      "Tier 3: Casual and preconstructed-style decks",
    ],
    dominantStrategies: [
      "Token generation and board swarming",
      "Control through counterspells and board wipes",
      "Combo wins with infinite loops or massive damage",
      "Midrange value through planeswalkers and recursive threats",
    ],
    trends: [
      "Increased focus on card advantage engines",
      "More efficient removal spells becoming standard",
      "Mana acceleration as a priority for all decks",
      "Flexibility in sideboard options becoming valued",
    ],
    matchups: [
      {
        archetype: "Control",
        description: "Decks focused on counterspells, removal, and card advantage",
        weaknesses: ["Aggressive decks that apply early pressure", "Threats that generate multiple cards per spell"],
      },
      {
        archetype: "Aggro",
        description: "Fast creature-based decks that aim to win quickly",
        weaknesses: ["Board wipes and mass removal", "Lifegain and defensive creatures"],
      },
      {
        archetype: "Midrange",
        description: "Decks with efficient threats backed by removal and value",
        weaknesses: ["Faster aggro decks", "Control decks that out-value them"],
      },
      {
        archetype: "Combo",
        description: "Decks that assemble specific card combinations for wins",
        weaknesses: ["Disruption and counterspells", "Graveyard hate for graveyard-based combos"],
      },
      {
        archetype: "Ramp",
        description: "Decks that accelerate mana for powerful threats",
        weaknesses: ["Early aggression", "Land destruction and mana denial"],
      },
      {
        archetype: "Tribal",
        description: "Decks focused on synergies within a creature type",
        weaknesses: ["Board wipes", "Spot removal for key tribal pieces"],
      },
    ],
  },
  standard: {
    tierDecks: [
      "Tier 1: Top competitive decks with consistent win rates",
      "Tier 2: Viable tournament contenders",
      "Tier 3: Budget and casual-friendly options",
    ],
    dominantStrategies: [
      "Midrange value with efficient threats",
      "Control with counterspells and removal",
      "Aggro with fast creature pressure",
      "Combo builds with win conditions",
    ],
    trends: [
      "Increasing focus on card advantage",
      "More versatile removal spells",
      "Mana consistency through fixers",
      "Sideboard flexibility for varied matchups",
    ],
    matchups: [
      {
        archetype: "Control",
        description: "Decks with counterspells, removal, and card advantage",
        weaknesses: ["Aggro with early pressure", "Threats that generate multiple cards"],
      },
      {
        archetype: "Aggro",
        description: "Fast creature decks aiming for quick wins",
        weaknesses: ["Board wipes", "Lifegain effects"],
      },
      {
        archetype: "Midrange",
        description: "Efficient threats with removal and value",
        weaknesses: ["Faster aggro", "Control that out-values"],
      },
    ],
  },
  modern: {
    tierDecks: [
      "Tier 1: Established meta decks with proven performance",
      "Tier 2: Competitive but less popular options",
      "Tier 3: Niche and budget strategies",
    ],
    dominantStrategies: [
      "Linear combo decks",
      "Aggro with fast threats",
      "Midrange with value",
      "Control with answers",
    ],
    trends: [
      "Powerful combo decks",
      "Efficient removal suites",
      "Mana acceleration",
      "Graveyard strategies",
    ],
    matchups: [
      {
        archetype: "Linear Combo",
        description: "Decks that win through specific card combinations",
        weaknesses: ["Graveyard hate", "Counterspells and disruption"],
      },
      {
        archetype: "Aggro",
        description: "Fast creature-based strategies",
        weaknesses: ["Board wipes", "Life gain"],
      },
      {
        archetype: "Midrange",
        description: "Value-based decks with removal",
        weaknesses: ["Faster aggro", "Control decks"],
      },
    ],
  },
  pioneer: {
    tierDecks: [
      "Tier 1: Top competitive strategies",
      "Tier 2: Viable tournament contenders",
      "Tier 3: Emerging and budget options",
    ],
    dominantStrategies: [
      "Midrange value",
      "Aggro pressure",
      "Control with answers",
      "Combo builds",
    ],
    trends: [
      "Card advantage focus",
      "Removal efficiency",
      "Mana fixing",
      "Sideboard strategy",
    ],
    matchups: [
      {
        archetype: "Midrange",
        description: "Value-based creature decks",
        weaknesses: ["Faster aggro", "Control"],
      },
      {
        archetype: "Aggro",
        description: "Fast creature decks",
        weaknesses: ["Board wipes", "Life gain"],
      },
      {
        archetype: "Control",
        description: "Answer-focused decks",
        weaknesses: ["Early pressure", "Multiple threats"],
      },
    ],
  },
  legacy: {
    tierDecks: [
      "Tier 1: Top-tier competitive decks",
      "Tier 2: Viable tournament options",
      "Tier 3: Budget and niche strategies",
    ],
    dominantStrategies: [
      "Efficient combos",
      "Powerful aggro",
      "Control with answers",
      "Midrange value",
    ],
    trends: [
      "Fast combo decks",
      "Powerful removal",
      "Mana acceleration",
      "Free spells",
    ],
    matchups: [
      {
        archetype: "Combo",
        description: "Fast win condition decks",
        weaknesses: ["Graveyard hate", "Counterspells"],
      },
      {
        archetype: "Aggro",
        description: "Fast creature pressure",
        weaknesses: ["Board wipes", "Life gain"],
      },
      {
        archetype: "Control",
        description: "Answer-focused decks",
        weaknesses: ["Early pressure", "Multiple threats"],
      },
    ],
  },
  vintage: {
    tierDecks: [
      "Tier 1: Top-tier competitive strategies",
      "Tier 2: Viable tournament options",
      "Tier 3: Budget and niche builds",
    ],
    dominantStrategies: [
      "Powerful combos",
      "Aggro with power",
      "Control with power",
      "Midrange with value",
    ],
    trends: [
      "Power card interactions",
      "Fast combos",
      "Efficient answers",
      "Mana acceleration",
    ],
    matchups: [
      {
        archetype: "Combo",
        description: "Fast combo with power",
        weaknesses: ["Disruption", "Counterspells"],
      },
      {
        archetype: "Aggro",
        description: "Fast aggro with power",
        weaknesses: ["Board wipes", "Life gain"],
      },
      {
        archetype: "Control",
        description: "Answer-based with power",
        weaknesses: ["Early pressure", "Multiple threats"],
      },
    ],
  },
  pauper: {
    tierDecks: [
      "Tier 1: Top-tier pauper strategies",
      "Tier 2: Viable tournament options",
      "Tier 3: Budget builds",
    ],
    dominantStrategies: [
      "Pauper-specific combos",
      "Aggro with commons",
      "Control with commons",
      "Midrange value",
    ],
    trends: [
      "Common-only synergies",
      "Efficient commons",
      "Mana fixing",
      "Sideboard options",
    ],
    matchups: [
      {
        archetype: "Combo",
        description: "Common-based combos",
        weaknesses: ["Graveyard hate", "Disruption"],
      },
      {
        archetype: "Aggro",
        description: "Fast common creatures",
        weaknesses: ["Board wipes", "Life gain"],
      },
      {
        archetype: "Control",
        description: "Common-based control",
        weaknesses: ["Early pressure", "Multiple threats"],
      },
    ],
  },
};

// Card suggestions by format and archetype
const CARD_SUGGESTIONS_BY_FORMAT: Record<string, Record<string, Array<{ name: string; quantity: number; reason: string }>>> = {
  commander: {
    control: [
      { name: "Swords to Plowshares", quantity: 2, reason: "Best removal in Commander" },
      { name: "Cyclonic Rift", quantity: 1, reason: "Versatile board wipe" },
      { name: "Mystical Tutor", quantity: 1, reason: "Find key answers" },
      { name: "Counterbalance", quantity: 1, reason: "Control the top of library" },
    ],
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Removal and reach" },
      { name: "Swiftspear", quantity: 2, reason: "Fast threat with prowess" },
      { name: "Goblin Guide", quantity: 2, reason: "Aggressive early threat" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Versatile removal" },
      { name: "Thoughtseize", quantity: 2, reason: "Disruption and information" },
      { name: "Kroxa, Titan of Death's Hunger", quantity: 1, reason: "Value creature" },
    ],
  },
  standard: {
    control: [
      { name: "Abrade", quantity: 2, reason: "Versatile removal" },
      { name: "Cunning Dismissal", quantity: 2, reason: "Counter spell" },
      { name: "Memory Deluge", quantity: 2, reason: "Card advantage" },
    ],
    aggro: [
      { name: "Play with Fire", quantity: 2, reason: "Removal and reach" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Removal" },
      { name: "Thoughtseize", quantity: 2, reason: "Disruption" },
    ],
  },
  modern: {
    control: [
      { name: "Path to Exile", quantity: 2, reason: "Best removal in Modern" },
      { name: "Mana Leak", quantity: 2, reason: "Counterspell" },
      { name: "Cryptic Command", quantity: 1, reason: "Versatile answer" },
    ],
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Efficient removal" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Removal" },
      { name: "Thoughtseize", quantity: 2, reason: "Disruption" },
    ],
  },
  pioneer: {
    control: [
      { name: "Thought Erasure", quantity: 2, reason: "Disruption" },
      { name: "Absorb", quantity: 2, reason: "Counterspell with life gain" },
    ],
    aggro: [
      { name: "Lightning Strike", quantity: 2, reason: "Removal" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Removal" },
      { name: "Thoughtseize", quantity: 2, reason: "Disruption" },
    ],
  },
  legacy: {
    control: [
      { name: "Force of Will", quantity: 1, reason: "Free counter spell" },
      { name: " Swords to Plowshares", quantity: 2, reason: "Best removal" },
    ],
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Efficient removal" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Thoughtseize", quantity: 2, reason: "Disruption" },
      { name: "Abrade", quantity: 2, reason: "Removal" },
    ],
  },
  vintage: {
    control: [
      { name: "Force of Will", quantity: 1, reason: "Free counter" },
      { name: "Mental Misstep", quantity: 2, reason: "Counter low-cost spells" },
    ],
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Efficient removal" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Thoughtseize", quantity: 2, reason: "Disruption" },
      { name: "Abrade", quantity: 2, reason: "Removal" },
    ],
  },
  pauper: {
    control: [
      { name: "Counterspell", quantity: 2, reason: "Best counter in Pauper" },
      { name: "Galvanic Blast", quantity: 2, reason: "Removal" },
    ],
    aggro: [
      { name: "Lightning Bolt", quantity: 2, reason: "Efficient removal" },
      { name: "Goblin Guide", quantity: 2, reason: "Fast threat" },
    ],
    midrange: [
      { name: "Abrade", quantity: 2, reason: "Removal" },
      { name: "Duress", quantity: 2, reason: "Disruption" },
    ],
  },
};

/**
 * Analyze metagame and provide deck suggestions using heuristics
 */
export async function heuristicMetaAnalysis(
  decklist: string,
  format: string,
  focusArchetype?: string
): Promise<MetaAnalysisOutput> {
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

  // Detect deck archetype
  const archetype = focusArchetype || detectArchetype(cards);

  // Get format meta data
  const meta = FORMAT_META_DATA[format] || FORMAT_META_DATA['commander'];

  // Generate analysis
  const metaOverview = generateMetaOverview(format, meta);
  const deckStrengths = generateDeckStrengths(cards, archetype, meta);
  const deckWeaknesses = generateDeckWeaknesses(cards, archetype, meta);
  const matchupAnalysis = generateMatchupAnalysis(archetype, meta);
  const cardSuggestions = generateCardSuggestions(cards, format, archetype);
  const sideboardSuggestions = generateSideboardSuggestions(format, archetype);
  const strategicAdvice = generateStrategicAdvice(archetype, format, meta);

  return {
    metaOverview,
    deckStrengths,
    deckWeaknesses,
    matchupAnalysis,
    cardSuggestions,
    sideboardSuggestions,
    strategicAdvice,
  };
}

/**
 * Detect deck archetype
 */
function detectArchetype(cards: DeckCard[]): string {
  const cardText = cards.map(c => c.name.toLowerCase()).join(' ');

  const archetypeScores: Record<string, number> = {
    control: (cardText.match(/control|counter|draw|wrath|instant|sorcery/gi) || []).length,
    aggro: (cardText.match(/aggro|attack|haste|damage|fast|creature/gi) || []).length,
    midrange: (cardText.match(/value|efficient|threat|mid|versatile/gi) || []).length,
    combo: (cardText.match(/combo|infinite|loop|assemble|win condition/gi) || []).length,
    ramp: (cardText.match(/ramp|mana|land|big|growth|search/gi) || []).length,
    tribal: (cardText.match(/tribal|zombie|elf|goblin|vampire|human|wizard/gi) || []).length,
  };

  return Object.entries(archetypeScores).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Generate metagame overview
 */
function generateMetaOverview(format: string, meta: FormatMeta): string {
  return `Current ${format} Metagame Overview:

Top Tier Decks:
${meta.tierDecks.map(d => `- ${d}`).join('\n')}

Dominant Strategies:
${meta.dominantStrategies.map(s => `- ${s}`).join('\n')}

Current Trends:
${meta.trends.map(t => `- ${t}`).join('\n')}

The metagame is diverse, with players adapting to counter popular strategies. Flexibility and sideboard preparation are key to success.`;
}

/**
 * Generate deck strengths
 */
function generateDeckStrengths(cards: DeckCard[], archetype: string, meta: FormatMeta): string[] {
  const strengths: string[] = [];

  const cardCount = cards.reduce((sum, c) => sum + c.count, 0);
  const avgCMC = cards.reduce((sum, c) => sum + ((c.cmc || 0) * c.count), 0) / cardCount;

  if (avgCMC < 3) {
    strengths.push(`Strong early game with average CMC of ${avgCMC.toFixed(1)}`);
  } else if (avgCMC > 4) {
    strengths.push(`Powerful late game with average CMC of ${avgCMC.toFixed(1)}`);
  }

  const creatureCount = cards.filter(c => c.type_line?.toLowerCase().includes('creature')).reduce((sum, c) => sum + c.count, 0);
  if (creatureCount > cardCount * 0.3) {
    strengths.push(`Strong board presence with ${creatureCount} creatures`);
  }

  const removalCount = cards.filter(c => {
    const text = c.oracle_text?.toLowerCase() || '';
    return text.includes('destroy') || text.includes('exile') || text.includes('counter');
  }).reduce((sum, c) => sum + c.count, 0);

  if (removalCount > 5) {
    strengths.push(`Good removal suite with ${removalCount} answers`);
  }

  // Archetype-specific strengths
  const archetypeStrengths: Record<string, string[]> = {
    control: ["Strong card advantage potential", "Excellent answer suite"],
    aggro: ["Fast starts", "High pressure potential"],
    midrange: ["Good value generation", "Flexible game plan"],
    combo: ["Fast win condition", "Clear path to victory"],
    ramp: ["Powerful late game", "Consistent mana acceleration"],
    tribal: ["Strong synergy potential", "Built-in tribal bonuses"],
  };

  strengths.push(...(archetypeStrengths[archetype] || []));

  return strengths;
}

/**
 * Generate deck weaknesses
 */
function generateDeckWeaknesses(cards: DeckCard[], archetype: string, meta: FormatMeta): string[] {
  const weaknesses: string[] = [];

  const cardCount = cards.reduce((sum, c) => sum + c.count, 0);
  const avgCMC = cards.reduce((sum, c) => sum + ((c.cmc || 0) * c.count), 0) / cardCount;

  if (avgCMC > 4) {
    weaknesses.push(`Slow mana curve with average CMC of ${avgCMC.toFixed(1)}`);
  } else if (avgCMC < 2 && cardCount < 100) {
    weaknesses.push(`May lack late game power`);
  }

  const creatureCount = cards.filter(c => c.type_line?.toLowerCase().includes('creature')).reduce((sum, c) => sum + c.count, 0);
  if (creatureCount < cardCount * 0.2) {
    weaknesses.push(`Limited board presence with ${creatureCount} creatures`);
  }

  const removalCount = cards.filter(c => {
    const text = c.oracle_text?.toLowerCase() || '';
    return text.includes('destroy') || text.includes('exile') || text.includes('counter');
  }).reduce((sum, c) => sum + c.count, 0);

  if (removalCount < 5) {
    weaknesses.push(`Limited answers to threats with ${removalCount} removal spells`);
  }

  // Archetype-specific weaknesses based on meta
  const archetypeWeaknesses = meta.matchups.filter(m => {
    return m.archetype.toLowerCase() === archetype.toLowerCase();
  });

  if (archetypeWeaknesses.length > 0) {
    for (const matchup of archetypeWeaknesses) {
      for (const weakness of matchup.weaknesses) {
        weaknesses.push(`Weak to ${weakness}`);
      }
    }
  }

  return weaknesses;
}

/**
 * Generate matchup analysis
 */
function generateMatchupAnalysis(archetype: string, meta: FormatMeta): Array<{
  archetype: string;
  recommendation: string;
  sideboardNotes?: string;
}> {
  return meta.matchups.map(matchup => ({
    archetype: matchup.archetype,
    recommendation: `Against ${matchup.archetype} decks, focus on ${matchup.weaknesses.join(' and ')}. Your ${archetype} strategy can be strong if you play to your strengths and address their weaknesses.`,
    sideboardNotes: archetype !== matchup.archetype
      ? `Consider adding cards that ${matchup.weaknesses.join(', ')} for this matchup.`
      : undefined,
  }));
}

/**
 * Generate card suggestions
 */
function generateCardSuggestions(
  cards: DeckCard[],
  format: string,
  archetype: string
): {
  cardsToAdd: Array<{ name: string; quantity: number; reason: string }>;
  cardsToRemove: Array<{ name: string; quantity: number; reason: string }>;
} {
  const formatSuggestions = CARD_SUGGESTIONS_BY_FORMAT[format] || CARD_SUGGESTIONS_BY_FORMAT['commander'];
  const archetypeSuggestions = formatSuggestions[archetype] || formatSuggestions['midrange'];

  let cardsToAdd: Array<{ name: string; quantity: number; reason: string }> = [];
  let cardsToRemove: Array<{ name: string; quantity: number; reason: string }> = [];

  // Add archetype-specific cards
  for (const suggestion of archetypeSuggestions.slice(0, 4)) {
    cardsToAdd.push(suggestion);
  }

  // Remove weak cards
  const weakCardPatterns = ['vanilla', 'weak', 'inefficient'];
  const weakCards = cards.filter(c =>
    weakCardPatterns.some(pattern => c.name.toLowerCase().includes(pattern))
  ).slice(0, cardsToAdd.length);

  for (const card of weakCards) {
    cardsToRemove.push({
      name: card.name,
      quantity: 1,
      reason: 'Underperforming in current meta',
    });
  }

  // Balance add/remove counts using a one-to-one swap approach
  const addCount = cardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
  const removeCount = cardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

  // Use a simpler balanced approach: ensure we have equal total quantities
  const balanceCount = Math.min(addCount, removeCount);

  // Trim if we have too many adds or removes
  if (addCount > balanceCount) {
    let currentAddCount = 0;
    const balancedCardsToAdd: typeof cardsToAdd = [];
    for (const card of cardsToAdd) {
      if (currentAddCount + card.quantity <= balanceCount) {
        balancedCardsToAdd.push(card);
        currentAddCount += card.quantity;
      } else {
        const remaining = balanceCount - currentAddCount;
        if (remaining > 0) {
          balancedCardsToAdd.push({
            ...card,
            quantity: remaining,
          });
          currentAddCount = balanceCount;
        }
        break;
      }
    }
    cardsToAdd = balancedCardsToAdd;
  }

  if (removeCount > balanceCount) {
    let currentRemoveCount = 0;
    const balancedCardsToRemove: typeof cardsToRemove = [];
    for (const card of cardsToRemove) {
      if (currentRemoveCount + card.quantity <= balanceCount) {
        balancedCardsToRemove.push(card);
        currentRemoveCount += card.quantity;
      } else {
        const remaining = balanceCount - currentRemoveCount;
        if (remaining > 0) {
          balancedCardsToRemove.push({
            ...card,
            quantity: remaining,
          });
          currentRemoveCount = balanceCount;
        }
        break;
      }
    }
    cardsToRemove = balancedCardsToRemove;
  }

  return { cardsToAdd, cardsToRemove };
}

/**
 * Generate sideboard suggestions
 */
function generateSideboardSuggestions(
  format: string,
  archetype: string
): Array<{ name: string; quantity: number; reason: string }> | undefined {
  if (format === 'commander') {
    return undefined; // Commander doesn't use sideboards
  }

  const sideboardCards: Array<{ name: string; quantity: number; reason: string }> = [
    { name: "Disenchant", quantity: 2, reason: "Answer to artifacts and enchantments" },
    { name: "Negate", quantity: 2, reason: "Counter non-creature spells" },
    { name: "Grafdigger's Cage", quantity: 1, reason: "Graveyard hate" },
  ];

  // Add archetype-specific sideboard cards
  const archetypeSideboard: Record<string, Array<{ name: string; quantity: number; reason: string }>> = {
    control: [
      { name: "Surgical Extraction", quantity: 2, reason: "Graveyard hate" },
    ],
    aggro: [
      { name: "Tormod's Crypt", quantity: 1, reason: "Graveyard hate" },
    ],
    midrange: [
      { name: "Rest in Peace", quantity: 1, reason: "Graveyard hate" },
    ],
  };

  if (archetypeSideboard[archetype]) {
    sideboardCards.push(...archetypeSideboard[archetype]);
  }

  return sideboardCards;
}

/**
 * Generate strategic advice
 */
function generateStrategicAdvice(archetype: string, format: string, meta: FormatMeta): string {
  const adviceParts: string[] = [];

  adviceParts.push(`As a ${archetype} deck in ${format}, focus on leveraging your archetype's strengths while addressing its weaknesses. `);

  adviceParts.push(`Based on the current metagame, here are key strategic considerations:\n`);

  // General advice
  adviceParts.push('1. Play to Your Strengths:');
  const archetypeAdvice: Record<string, string> = {
    control: 'Use your counterspells and removal to control the game. Establish card advantage before deploying your win conditions.',
    aggro: "Apply early pressure and don't overcommit to board wipes. Use burn spells for reach.",
    midrange: 'Trade efficiently and generate value over time. Use your removal to control the board while developing threats.',
    combo: 'Protect your combo pieces and have backup plans. Use disruption to prevent opponent interaction.',
    ramp: 'Accelerate your mana and deploy powerful threats early. Use removal to survive until your game plan takes over.',
    tribal: 'Focus on tribal synergies and protect your key creatures. Use tribal lords to maximize value.',
  };
  adviceParts.push(archetypeAdvice[archetype]);
  adviceParts.push('');

  // Meta advice
  adviceParts.push('2. Meta Adaptation:');
  adviceParts.push(`The current meta features ${meta.dominantStrategies.length} dominant strategies. `);
  adviceParts.push(`Prepare for tier decks: ${meta.tierDecks[0]} and ${meta.tierDecks[1]}. `);
  adviceParts.push('Sideboard appropriately for difficult matchups.');
  adviceParts.push('');

  // Format advice
  adviceParts.push('3. Format-Specific Considerations:');
  if (format === 'commander') {
    adviceParts.push('Commander games are multiplayer, so politics and resource management are key. ');
    adviceParts.push('Consider when to use removal and when to hold it for more threatening targets. ');
    adviceParts.push('Build your deck to be consistent and powerful over long games.');
  } else {
    adviceParts.push(`Competitive ${format} requires a well-constructed sideboard. `);
    adviceParts.push('Identify your worst matchups and dedicate sideboard slots to them. ');
    adviceParts.push("Test extensively to understand your deck's role in the meta.");
  }

  return adviceParts.join('\n');
}
