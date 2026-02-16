/**
 * @fileOverview Mana Payment System
 *
 * Issue #29: Phase 2.2: Implement mana payment interface
 *
 * Provides:
 * - Show mana cost breakdown
 * - Select mana from pool
 * - Auto-tap lands for mana
 * - Manual mana selection override
 * - Show remaining mana in pool
 * - Handle mana restrictions (snow, specific colors)
 */

import type { CardInstance, ManaPool, Player, Zone } from './types';

/**
 * Represents a land that can produce mana
 */
interface ManaSource {
  /** Card instance ID */
  cardId: string;
  /** Card name */
  cardName: string;
  /** Whether this land is tapped */
  isTapped: boolean;
  /** Whether this land can produce colored mana */
  canProduceColor: boolean;
  /** Colors this land can produce */
  produces: ManaColor[];
  /** Whether this is a snow land */
  isSnow: boolean;
  /** Whether this can produce colorless mana */
  producesColorless: boolean;
}

/**
 * Color of mana
 */
type ManaColor = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

/**
 * A mana payment request
 */
export interface ManaPaymentRequest {
  /** Total generic mana needed */
  genericCost: number;
  /** Required colored mana (e.g., { white: 1, blue: 1 }) */
  requiredColors: Partial<Record<ManaColor, number>>;
  /** Total mana needed (sum of generic + colored) */
  totalCost: number;
  /** Whether X spells/abilities are being used */
  hasXCost: boolean;
  /** X value if hasXCost is true */
  xValue?: number;
  /** Whether this is a snow cost */
  isSnowCost: boolean;
}

/**
 * A mana payment result
 */
export interface ManaPayment {
  /** Whether payment was successful */
  success: boolean;
  /** Selected mana sources to tap */
  selectedSources: ManaSourceSelection[];
  /** Remaining mana pool after payment */
  remainingPool: ManaPool;
  /** Error message if failed */
  error?: string;
}

/**
 * Selected mana source
 */
export interface ManaSourceSelection {
  cardId: string;
  cardName: string;
  color: ManaColor;
  amount: number;
}

/**
 * Auto-tap suggestion
 */
export interface AutoTapSuggestion {
  /** Sources to tap */
  sources: ManaSourceSelection[];
  /** Whether all requirements are met */
  canPay: boolean;
  /** Explanation of the suggestion */
  explanation: string;
}

/**
 * Parse a mana cost string into a payment request
 */
export function parseManaCost(manaCost: string | null): ManaPaymentRequest {
  if (!manaCost) {
    return {
      genericCost: 0,
      requiredColors: {},
      totalCost: 0,
      hasXCost: false,
      isSnowCost: false,
    };
  }

  // Remove { and }
  const cost = manaCost.replace(/[{}]/g, '');
  
  let genericCost = 0;
  const requiredColors: Partial<Record<ManaColor, number>> = {};
  let hasXCost = false;
  let isSnowCost = false;

  // Check for snow mana
  if (cost.includes('S')) {
    isSnowCost = true;
  }

  // Parse each part of the cost
  const parts = cost.split(/([WUBRGS])/g).filter(p => p.length > 0);
  
  for (const part of parts) {
    if (part === 'W') {
      requiredColors.white = (requiredColors.white || 0) + 1;
    } else if (part === 'U') {
      requiredColors.blue = (requiredColors.blue || 0) + 1;
    } else if (part === 'B') {
      requiredColors.black = (requiredColors.black || 0) + 1;
    } else if (part === 'R') {
      requiredColors.red = (requiredColors.red || 0) + 1;
    } else if (part === 'G') {
      requiredColors.green = (requiredColors.green || 0) + 1;
    } else if (part === 'S') {
      // Snow mana - handled separately
    } else if (part === 'X' || part === 'Y') {
      hasXCost = true;
    } else if (!isNaN(parseInt(part))) {
      genericCost += parseInt(part);
    }
  }

  const coloredCost = Object.values(requiredColors).reduce((sum, count) => sum + count, 0);

  return {
    genericCost,
    requiredColors,
    totalCost: genericCost + coloredCost,
    hasXCost,
    isSnowCost,
  };
}

/**
 * Get available mana sources from a player's battlefield
 */
export function getManaSources(
  battlefield: Zone,
  cards: Map<string, CardInstance>
): ManaSource[] {
  const sources: ManaSource[] = [];

  for (const cardId of battlefield.cardIds) {
    const card = cards.get(cardId);
    if (!card) continue;

    const typeLine = card.cardData.type_line?.toLowerCase() || '';
    
    // Check if it's a land
    if (!typeLine.includes('land')) continue;
    if (card.isTapped) continue;

    const produces = getLandManaProductions(card.cardData.type_line || '', card.cardData.name || '');

    sources.push({
      cardId,
      cardName: card.cardData.name || 'Unknown',
      isTapped: card.isTapped,
      canProduceColor: produces.length > 0 && !produces.includes('colorless'),
      produces,
      isSnow: typeLine.includes('snow'),
      producesColorless: produces.includes('colorless'),
    });
  }

  return sources;
}

/**
 * Determine what colors a land can produce
 */
function getLandManaProductions(typeLine: string, cardName: string): ManaColor[] {
  const produces: ManaColor[] = [];
  const lowerType = typeLine.toLowerCase();
  const lowerName = cardName.toLowerCase();

  // Basic lands
  if (lowerType.includes('plains')) {
    produces.push('white');
    produces.push('colorless');
  } else if (lowerType.includes('island')) {
    produces.push('blue');
    produces.push('colorless');
  } else if (lowerType.includes('swamp')) {
    produces.push('black');
    produces.push('colorless');
  } else if (lowerType.includes('mountain')) {
    produces.push('red');
    produces.push('colorless');
  } else if (lowerType.includes('forest')) {
    produces.push('green');
    produces.push('colorless');
  }
  // Snow lands
  else if (lowerType.includes('snow-covered')) {
    if (lowerType.includes('plains')) {
      produces.push('white');
      produces.push('colorless');
    } else if (lowerType.includes('island')) {
      produces.push('blue');
      produces.push('colorless');
    } else if (lowerType.includes('swamp')) {
      produces.push('black');
      produces.push('colorless');
    } else if (lowerType.includes('mountain')) {
      produces.push('red');
      produces.push('colorless');
    } else if (lowerType.includes('forest')) {
      produces.push('green');
      produces.push('colorless');
    }
  }
  // Dual lands - check name for common dual lands
  else if (lowerName.includes('tolarian') || lowerName.includes('tropical') || 
           lowerName.includes('taiga') || lowerName.includes('badlands') ||
           lowerName.includes('underground') || lowerName.includes('scrubland') ||
           lowerName.includes('volcanic') || lowerName.includes('bayou') ||
           lowerName.includes('plateau') || lowerName.includes('savannah')) {
    // These produce two colors
    if (lowerName.includes('white') || lowerName.includes('plains')) produces.push('white');
    if (lowerName.includes('blue') || lowerName.includes('island')) produces.push('blue');
    if (lowerName.includes('black') || lowerName.includes('swamp')) produces.push('black');
    if (lowerName.includes('red') || lowerName.includes('mountain')) produces.push('red');
    if (lowerName.includes('green') || lowerName.includes('forest')) produces.push('green');
    produces.push('colorless');
  }
  // Other lands that can produce colored mana
  else if (lowerType.includes('tap: add')) {
    // Check what it can produce
    const tapText = lowerType.toLowerCase();
    if (tapText.includes('white') || tapText.includes('{w}')) produces.push('white');
    if (tapText.includes('blue') || tapText.includes('{u}')) produces.push('blue');
    if (tapText.includes('black') || tapText.includes('{b}')) produces.push('black');
    if (tapText.includes('red') || tapText.includes('{r}')) produces.push('red');
    if (tapText.includes('green') || tapText.includes('{g}')) produces.push('green');
    if (produces.length === 0) produces.push('colorless');
  }

  return produces;
}

/**
 * Auto-tap lands to pay mana cost
 */
export function autoTapLands(
  manaPool: ManaPool,
  manaSources: ManaSource[],
  request: ManaPaymentRequest
): AutoTapSuggestion {
  // Clone mana pool to track what's available
  const availablePool = { ...manaPool };
  
  // Add colorless from available sources
  for (const source of manaSources) {
    if (source.producesColorless) {
      availablePool.colorless += 1;
    }
  }

  const selected: ManaSourceSelection[] = [];
  const explanation: string[] = [];

  // First, pay required colored mana
  const requiredColors = request.requiredColors;
  const remainingNeeded = { ...requiredColors };

  for (const source of manaSources) {
    if (!source.canProduceColor) continue;

    for (const color of source.produces) {
      if (color === 'colorless') continue;
      
      const needed = remainingNeeded[color] || 0;
      if (needed > 0) {
        selected.push({
          cardId: source.cardId,
          cardName: source.cardName,
          color,
          amount: 1,
        });
        remainingNeeded[color] = needed - 1;
        explanation.push(`Tapped ${source.cardName} for {${color.charAt(0).toUpperCase()}}`);
        
        // Remove this source from available
        const idx = manaSources.indexOf(source);
        if (idx > -1) manaSources.splice(idx, 1);
        break;
      }
    }
  }

  // Check if all colored requirements are met
  const unmetColors = Object.entries(remainingNeeded)
    .filter(([, count]) => count > 0)
    .map(([color]) => color);

  if (unmetColors.length > 0) {
    return {
      sources: [],
      canPay: false,
      explanation: `Cannot produce required colors: ${unmetColors.join(', ')}`,
    };
  }

  // Now pay generic mana with remaining sources
  let genericNeeded = request.genericCost;

  for (const source of manaSources) {
    if (genericNeeded <= 0) break;

    const color = source.producesColorless ? 'colorless' : 
                  source.produces[0] || 'colorless';
    
    selected.push({
      cardId: source.cardId,
      cardName: source.cardName,
      color,
      amount: 1,
    });
    genericNeeded--;
    explanation.push(`Tapped ${source.cardName} for colorless`);
  }

  const canPay = genericNeeded <= 0;

  return {
    sources: selected,
    canPay,
    explanation: canPay 
      ? explanation.join('; ') 
      : `Need ${genericNeeded} more mana`,
  };
}

/**
 * Calculate remaining mana pool after a payment
 */
export function calculateRemainingPool(
  originalPool: ManaPool,
  payment: ManaSourceSelection[]
): ManaPool {
  const remaining = { ...originalPool };

  for (const selection of payment) {
    if (selection.color === 'colorless') {
      remaining.colorless = Math.max(0, remaining.colorless - selection.amount);
    } else {
      remaining[selection.color] = Math.max(0, (remaining[selection.color] || 0) - selection.amount);
    }
  }

  return remaining;
}

/**
 * Check if a player can afford a mana cost
 */
export function canAffordMana(
  manaPool: ManaPool,
  manaSources: ManaSource[],
  request: ManaPaymentRequest
): boolean {
  // Check colored mana requirements
  for (const [color, needed] of Object.entries(request.requiredColors)) {
    const poolAmount = color === 'colorless' 
      ? manaPool.colorless 
      : (manaPool[color as keyof ManaPool] as number || 0);
    
    if (poolAmount < needed) {
      // Check if we can produce this color from sources
      const canProduce = manaSources.some(s => s.produces.includes(color as ManaColor));
      if (!canProduce) return false;
    }
  }

  // Calculate total available mana
  const totalAvailable = manaPool.colorless + 
    manaPool.white + manaPool.blue + manaPool.black + 
    manaPool.red + manaPool.green + manaPool.generic;
  
  const coloredRequired = Object.values(request.requiredColors).reduce((sum, c) => sum + c, 0);
  const totalRequired = request.genericCost + coloredRequired;

  return totalAvailable >= totalRequired;
}

/**
 * Get detailed breakdown of mana pool for UI display
 */
export function getManaPoolBreakdown(manaPool: ManaPool): {
  total: number;
  colored: number;
  colorless: number;
  byColor: { color: ManaColor; amount: number; symbol: string }[];
} {
  const colored = manaPool.white + manaPool.blue + manaPool.black + 
                   manaPool.red + manaPool.green;
  const colorless = manaPool.colorless + manaPool.generic;
  const total = colored + colorless;

  return {
    total,
    colored,
    colorless,
    byColor: [
      { color: 'white' as ManaColor, amount: manaPool.white, symbol: 'W' },
      { color: 'blue' as ManaColor, amount: manaPool.blue, symbol: 'U' },
      { color: 'black' as ManaColor, amount: manaPool.black, symbol: 'B' },
      { color: 'red' as ManaColor, amount: manaPool.red, symbol: 'R' },
      { color: 'green' as ManaColor, amount: manaPool.green, symbol: 'G' },
      { color: 'colorless' as ManaColor, amount: colorless, symbol: 'C' },
    ],
  };
}

/**
 * Validate manual mana selection
 */
export function validateManaSelection(
  selection: ManaSourceSelection[],
  manaPool: ManaPool,
  request: ManaPaymentRequest
): { valid: boolean; error?: string } {
  // Count selected mana by color
  const selected: Partial<Record<ManaColor, number>> = {};
  
  for (const sel of selection) {
    selected[sel.color] = (selected[sel.color] || 0) + sel.amount;
  }

  // Check colored requirements
  for (const [color, needed] of Object.entries(request.requiredColors)) {
    const selectedAmount = selected[color as ManaColor] || 0;
    if (selectedAmount < needed) {
      return { valid: false, error: `Need ${needed} ${color} mana, selected ${selectedAmount}` };
    }
  }

  // Check generic requirements (using colored mana as generic)
  let totalSelected = 0;
  for (const amount of Object.values(selected)) {
    totalSelected += amount;
  }
  
  const coloredRequired = Object.values(request.requiredColors).reduce((sum, c) => sum + c, 0);
  const genericSelected = totalSelected - coloredRequired;
  
  if (genericSelected < request.genericCost) {
    return { 
      valid: false, 
      error: `Need ${request.genericCost} generic mana, selected ${genericSelected}` 
    };
  }

  return { valid: true };
}

/**
 * Get suggested auto-tap with preference for certain lands
 */
export function smartAutoTap(
  manaPool: ManaPool,
  manaSources: ManaSource[],
  request: ManaPaymentRequest,
  prioritizeSources: string[] = [] // Card IDs to prioritize
): AutoTapSuggestion {
  // Sort sources: prioritized first, then by flexibility (colorless producers first)
  const sortedSources = [...manaSources].sort((a, b) => {
    const aPriority = prioritizeSources.includes(a.cardId) ? 1 : 0;
    const bPriority = prioritizeSources.includes(b.cardId) ? 1 : 0;
    
    if (aPriority !== bPriority) return bPriority - aPriority;
    
    // Prefer sources that produce colorless (more flexible)
    const aFlex = a.producesColorless ? 1 : 0;
    const bFlex = b.producesColorless ? 1 : 0;
    return bFlex - aFlex;
  });

  return autoTapLands(manaPool, sortedSources, request);
}
