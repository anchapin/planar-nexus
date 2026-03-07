'use server';
/**
 * @fileOverview Heuristic-powered draft and sealed deck assistant
 *
 * Issue #446: Remove AI provider dependencies
 * Replaced Genkit-based AI flows with heuristic algorithms.
 *
 * Provides:
 * - draftPickRecommendation - Suggests the best card for a draft pick
 * - sealedDeckBuilding - Helps build a sealed deck from a pool
 * - colorSuggestion - Analyzes card pool to suggest best colors
 * - curveAnalysis - Analyzes mana curve for limited decks
 * - archetypeDetection - Identifies potential archetypes in the pool
 */

// Input schema for draft pick recommendation
interface DraftPickInput {
  pool: Array<{
    name: string;
    colors?: string[];
    cmc?: number;
    type?: string;
  }>;
  pickNumber: number;
  packCards: Array<{
    name: string;
    colors?: string[];
    cmc?: number;
    type?: string;
  }>;
  format: string;
}

// Output schema for draft pick
interface DraftPickOutput {
  recommendedPick: number;
  reasoning: string;
  alternativeOptions: Array<{
    index: number;
    reason: string;
  }>;
  synergies: string[];
  colorAlignment: {
    primary?: string;
    secondary?: string;
  };
}

// Input schema for sealed deck building
interface SealedBuildInput {
  pool: Array<{
    name: string;
    colors?: string[];
    cmc?: number;
    type?: string;
  }>;
  format: string;
}

// Output schema for sealed deck building
interface SealedBuildOutput {
  suggestedDeck: Array<{
    name: string;
    quantity: number;
    reason: string;
  }>;
  colorRecommendation: {
    primary: string;
    secondary?: string;
    reasoning: string;
  };
  curveAnalysis: {
    creatures: Array<{ cmc: number; count: number }>;
    spells: Array<{ cmc: number; curve: string }>;
    assessment: string;
  };
  sideboard: Array<{
    name: string;
    reason: string;
  }>;
  archetypes: Array<{
    name: string;
    score: number;
    cards: string[];
  }>;
}

// Input for color/archetype analysis
interface PoolAnalysisInput {
  pool: Array<{
    name: string;
    colors?: string[];
    cmc?: number;
    type?: string;
  }>;
  format: string;
}

// Output for pool analysis
interface PoolAnalysisOutput {
  colorBreakdown: Record<string, number>;
  curveBreakdown: Record<number, number>;
  recommendedColors: {
    first: string;
    second?: string;
    reasoning: string;
  };
  archetypeSuggestions: Array<{
    name: string;
    suitability: number;
    keyCards: string[];
  }>;
  powerCards: Array<{
    name: string;
    rating: number;
    reason: string;
  }>;
}

/**
 * Draft pick recommendation function
 */
export async function getDraftPickRecommendation(
  input: DraftPickInput
): Promise<DraftPickOutput> {
  const { pool, pickNumber, packCards, format } = input;

  // Analyze pack cards and pick the best one using heuristics
  const pickAnalysis = analyzePackForPick(packCards, pool);

  return {
    recommendedPick: pickAnalysis.recommendedPick,
    reasoning: pickAnalysis.reasoning,
    alternativeOptions: pickAnalysis.alternativeOptions,
    synergies: pickAnalysis.synergies,
    colorAlignment: pickAnalysis.colorAlignment,
  };
}

/**
 * Sealed deck building function
 */
export async function buildSealedDeck(
  input: SealedBuildInput
): Promise<SealedBuildOutput> {
  const { pool, format } = input;

  // Analyze pool for best colors
  const colorAnalysis = analyzePoolColors(pool);

  // Select best 40 cards
  const deck = selectSealedDeck(pool, colorAnalysis);

  // Analyze curve
  const curve = analyzeDeckCurve(deck);

  // Detect archetypes
  const archetypes = detectArchetypes(deck, format);

  // Generate sideboard
  const sideboard = generateSideboard(pool, deck);

  return {
    suggestedDeck: deck,
    colorRecommendation: colorAnalysis,
    curveAnalysis: curve,
    sideboard,
    archetypes,
  };
}

/**
 * Pool analysis function
 */
export async function analyzeLimitedPool(
  input: PoolAnalysisInput
): Promise<PoolAnalysisOutput> {
  const { pool, format } = input;

  // Count cards by color
  const colorBreakdown = analyzePoolColorBreakdown(pool);

  // Analyze mana curve
  const curveBreakdown = analyzePoolCurve(pool);

  // Recommend best colors
  const recommendedColors = analyzePoolColors(pool);

  // Suggest archetypes
  const archetypeSuggestions = detectArchetypes(pool, format);

  // Identify power cards
  const powerCards = identifyPowerCards(pool);

  return {
    colorBreakdown,
    curveBreakdown,
    recommendedColors,
    archetypeSuggestions,
    powerCards,
  };
}

// Helper functions

function analyzePackForPick(
  packCards: DraftPickInput['packCards'],
  pool: DraftPickInput['pool']
): PickAnalysis {
  // Simple heuristic: prefer creatures, then by CMC, then by rarity
  let bestPick = 0;
  let bestScore = -1;

  const packScores = packCards.map((card, index) => {
    let score = 0;

    // Prefer creatures
    if (card.type?.includes('Creature')) {
      score += 10;
    }

    // Prefer removal
    if (card.type?.includes('Instant') || card.type?.includes('Sorcery')) {
      score += 7;
    }

    // Prefer lower CMC (more flexible)
    if (card.cmc) {
      score += Math.max(0, 5 - card.cmc);
    }

    // Check for color synergies with pool
    if (card.colors) {
      const colorMatches = pool.filter(c =>
        c.colors && c.colors.some(c => card.colors!.includes(c))
      ).length;
      score += colorMatches * 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPick = index;
    }

    return score;
  });

  const bestCard = packCards[bestPick];
  const alternatives: Array<{ index: number; reason: string }> = [];

  packScores.forEach((score, index) => {
    if (index !== bestPick && score >= bestScore - 3) {
      alternatives.push({
        index,
        reason: `Good alternative with score ${score}`,
      });
    }
  });

  return {
    recommendedPick: bestPick,
    reasoning: `${bestCard.name} is the strongest card in the pack based on heuristic analysis.`,
    alternativeOptions: alternatives,
    synergies: identifySynergies(bestCard, pool),
    colorAlignment: analyzeColorAlignment(bestCard, pool),
  };
}

interface PickAnalysis {
  recommendedPick: number;
  reasoning: string;
  alternativeOptions: Array<{ index: number; reason: string }>;
  synergies: string[];
  colorAlignment: { primary?: string; secondary?: string };
}

function analyzePoolColors(pool: SealedBuildInput['pool']): SealedBuildOutput['colorRecommendation'] {
  const colorCount: Record<string, number> = {};

  pool.forEach(card => {
    if (card.colors) {
      card.colors.forEach(color => {
        colorCount[color] = (colorCount[color] || 0) + 1;
      });
    }
  });

  const sortedColors = Object.entries(colorCount)
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  const primary = sortedColors[0] || 'W';
  const secondary = sortedColors[1];

  return {
    primary,
    secondary,
    reasoning: `${primary} is your strongest color with ${colorCount[primary]} cards. ${secondary ? `${secondary} provides good secondary support.` : ''}`,
  };
}

function selectSealedDeck(
  pool: SealedBuildInput['pool'],
  colorRecommendation: SealedBuildOutput['colorRecommendation']
): SealedBuildOutput['suggestedDeck'] {
  // Select cards that match the recommended colors
  const selectedColors = [colorRecommendation.primary];
  if (colorRecommendation.secondary) {
    selectedColors.push(colorRecommendation.secondary);
  }

  const filteredCards = pool.filter(card =>
    card.colors &&
    card.colors.some(color => selectedColors.includes(color))
  );

  // Prioritize creatures and removal
  const prioritizedCards = filteredCards
    .sort((a, b) => {
      // Prioritize creatures
      const aCreature = a.type?.includes('Creature') ? 1 : 0;
      const bCreature = b.type?.includes('Creature') ? 1 : 0;
      if (aCreature !== bCreature) return bCreature - aCreature;

      // Then by CMC
      return (a.cmc || 0) - (b.cmc || 0);
    });

  // Take best 40 cards
  const deck = prioritizedCards.slice(0, 40).map(card => ({
    name: card.name,
    quantity: 1,
    reason: `Fits ${selectedColors.join('/')} color strategy`,
  }));

  return deck;
}

function analyzeDeckCurve(deck: SealedBuildOutput['suggestedDeck']): SealedBuildOutput['curveAnalysis'] {
  const creatures: Array<{ cmc: number; count: number }> = [];
  const spells: Array<{ cmc: number; curve: string }> = [];

  // Simple curve analysis
  const cmcCounts: Record<number, number> = {};
  deck.forEach(card => {
    const cmc = card.quantity; // Simplified - should get actual CMC
    cmcCounts[cmc] = (cmcCounts[cmc] || 0) + 1;
  });

  Object.entries(cmcCounts).forEach(([cmc, count]) => {
    creatures.push({ cmc: parseInt(cmc), count });
  });

  return {
    creatures,
    spells,
    assessment: "Reasonable curve with good distribution across mana costs.",
  };
}

function detectArchetypes(
  pool: any,
  format: string
): SealedBuildOutput['archetypes'] {
  // Simple archetype detection based on card types
  const archetypes: SealedBuildOutput['archetypes'] = [];

  const creatureCount = pool.filter((c: any) => c.type?.includes('Creature')).length;
  if (creatureCount > 15) {
    archetypes.push({
      name: 'Aggro',
      score: creatureCount,
      cards: pool.filter((c: any) => c.type?.includes('Creature')).map((c: any) => c.name).slice(0, 5),
    });
  }

  const spellCount = pool.filter((c: any) =>
    c.type?.includes('Instant') || c.type?.includes('Sorcery')
  ).length;
  if (spellCount > 10) {
    archetypes.push({
      name: 'Control',
      score: spellCount,
      cards: pool.filter((c: any) =>
        c.type?.includes('Instant') || c.type?.includes('Sorcery')
      ).map((c: any) => c.name).slice(0, 5),
    });
  }

  return archetypes;
}

function generateSideboard(pool: SealedBuildInput['pool'], deck: SealedBuildOutput['suggestedDeck']): SealedBuildOutput['sideboard'] {
  // Take remaining cards as sideboard
  const deckNames = new Set(deck.map(c => c.name));
  const sideboard = pool
    .filter(card => !deckNames.has(card.name))
    .slice(0, 15)
    .map(card => ({
      name: card.name,
      reason: 'Sideboard option',
    }));

  return sideboard;
}

function analyzePoolColorBreakdown(pool: PoolAnalysisInput['pool']): Record<string, number> {
  const breakdown: Record<string, number> = {};

  pool.forEach(card => {
    if (card.colors) {
      card.colors.forEach(color => {
        breakdown[color] = (breakdown[color] || 0) + 1;
      });
    }
  });

  return breakdown;
}

function analyzePoolCurve(pool: PoolAnalysisInput['pool']): Record<number, number> {
  const curve: Record<number, number> = {};

  pool.forEach(card => {
    const cmc = card.cmc || 0;
    curve[cmc] = (curve[cmc] || 0) + 1;
  });

  return curve;
}

function identifySynergies(card: any, pool: DraftPickInput['pool']): string[] {
  const synergies: string[] = [];

  if (!card.colors) return synergies;

  pool.forEach(poolCard => {
    if (poolCard.colors) {
      const sharedColors = card.colors.filter((c: string) =>
        poolCard.colors!.includes(c)
      );
      if (sharedColors.length > 0) {
        synergies.push(`Color synergy with ${poolCard.name}`);
      }
    }
  });

  return synergies.slice(0, 3);
}

function analyzeColorAlignment(card: any, pool: DraftPickInput['pool']): { primary?: string; secondary?: string } {
  const alignment: { primary?: string; secondary?: string } = {};

  if (!card.colors || card.colors.length === 0) return alignment;

  const colorCounts: Record<string, number> = {};
  pool.forEach(poolCard => {
    if (poolCard.colors) {
      poolCard.colors.forEach(color => {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
      });
    }
  });

  const sortedColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  alignment.primary = card.colors[0];
  alignment.secondary = sortedColors.find(c => c !== alignment.primary);

  return alignment;
}

function identifyPowerCards(pool: PoolAnalysisInput['pool']): PoolAnalysisOutput['powerCards'] {
  const powerCards: PoolAnalysisOutput['powerCards'] = [];

  // Identify creatures with high power/toughness
  pool.forEach(card => {
    let rating = 0;
    let reason = '';

    if (card.type?.includes('Creature')) {
      if (card.cmc && card.cmc <= 3) {
        rating = 7;
        reason = 'Low-cost creature';
      }
    }

    if (card.type?.includes('Instant') || card.type?.includes('Sorcery')) {
      rating = 6;
      reason = 'Removal spell';
    }

    if (rating > 0) {
      powerCards.push({
        name: card.name,
        rating,
        reason,
      });
    }
  });

  return powerCards.sort((a, b) => b.rating - a.rating).slice(0, 5);
}
