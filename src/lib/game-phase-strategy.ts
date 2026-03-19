/**
 * Game Phase Strategy Guides
 * 
 * Provides in-game strategic guidance based on deck archetype and game phase.
 * Includes opening hand evaluation, mid-game priorities, late-game advice, 
 * and combat phase guidance.
 */

import { MagicFormat, ArchetypeCategory } from './meta';

export interface PhaseStrategy {
  priorities: string[];
  commonMistakes: string[];
  idealScenario: string;
  redFlags: string[];
}

export interface CombatGuidance {
  whenTo: string[];
  whenNotTo: string[];
  calculations: string[];
}

export interface CombatTips {
  attacking: CombatGuidance;
  defending: CombatGuidance;
  general: string[];
}

export interface GamePhaseStrategy {
  archetype: ArchetypeCategory;
  archetypeName: string;
  format: MagicFormat;
  opening: PhaseStrategy;
  midGame: PhaseStrategy;
  lateGame: PhaseStrategy;
  combat: CombatTips;
}

export interface HandEvaluation {
  rating: 'excellent' | 'good' | 'fair' | 'poor';
  factors: string[];
  suggestions: string[];
  manaCurve: number[];
  colorCount: Record<string, number>;
}

// Mock game phase strategy data
const gamePhaseStrategies: GamePhaseStrategy[] = [
  {
    archetype: 'aggro',
    archetypeName: 'Aggro',
    format: 'standard',
    opening: {
      priorities: [
        'Play cheapest threats on curve',
        'Establish early board presence',
        'Apply maximum pressure'
      ],
      commonMistakes: [
        'Holding cards for perfect moment',
        'Playing too many cards and overextending',
        'Not attacking when opponent is tapped out'
      ],
      idealScenario: 'T1 one-drop, T2 two-drop, T3 three-drop - continuous pressure',
      redFlags: [
        'Hand full of 4+ mana cards',
        'No one or two drops',
        'All cards require specific board state'
      ]
    },
    midGame: {
      priorities: [
        'Maintain creature count on board',
        'Attack when opponent taps lands',
        'Force opponent to block'
      ],
      commonMistakes: [
        'Trading when you should be racing',
        'Running out of gas',
        'Not using burn to finish'
      ],
      idealScenario: 'Opponent at 6 life, you have 2 creatures and 2 burn spells',
      redFlags: [
        'Opponent has multiple blockers',
        'You have no reach',
        'Opponent life too high to race'
      ]
    },
    lateGame: {
      priorities: [
        'Win before topdeck wars',
        'Use reach/burn as finishers',
        'Know when to race vs control'
      ],
      commonMistakes: [
        'Playing too slow',
        'Running out of cards',
        'Not attacking when you can win'
      ],
      idealScenario: 'Finish with burn before opponent stabilizes',
      redFlags: [
        'Opponent has life gain',
        'You have no cards in hand',
        'Opponent has board control'
      ]
    },
    combat: {
      attacking: {
        whenTo: [
          'Opponent has tapped lands',
          'Opponent has no blockers',
          'You can force a favorable trade',
          'You can win this turn'
        ],
        whenNotTo: [
          'Into obvious blocks',
          'When opponent has combat tricks',
          'When racing is not favorable'
        ],
        calculations: [
          'Calculate exact damage output',
          'Consider opponent hand size',
          'Account for potential blocks'
        ]
      },
      defending: {
        whenTo: [
          'Your creature lives',
          'You can trade up',
          'Life total is low'
        ],
        whenNotTo: [
          'Trade when racing is better',
          'Block with expensive creatures',
          'When opponent has reach'
        ],
        calculations: [
          'Calculate damage taken vs dealt',
          'Consider trample',
          'Know your life total'
        ]
      },
      general: [
        'Never attack blindly',
        'Know your win condition',
        'Life is a resource'
      ]
    }
  },
  {
    archetype: 'control',
    archetypeName: 'Control',
    format: 'standard',
    opening: {
      priorities: [
        'Survive early game',
        'Use removal efficiently',
        'Hit land drops'
      ],
      commonMistakes: [
        'Using premium removal on small threats',
        'Missing land drops',
        'Overextending into sweepers'
      ],
      idealScenario: 'Turn 2 removal, Turn 3 sweeper, Turn 4 planeswalker',
      redFlags: [
        'No early interaction',
        'All cards cost 4+ mana',
        'No card draw'
      ]
    },
    midGame: {
      priorities: [
        'Establish card advantage',
        'Lock the board',
        'Hit all land drops'
      ],
      commonMistakes: [
        'Tapping out at wrong time',
        'Not having counterspell backup',
        'Letting small threats accumulate'
      ],
      idealScenario: 'Card draw engine online, opponent stuck on lands',
      redFlags: [
        'Opponent has 2+ threats you cannot answer',
        'You are flooding',
        'Opponent has card advantage'
      ]
    },
    lateGame: {
      priorities: [
        'Win through card advantage',
        'Use win conditions as threats',
        'Lock opponent out'
      ],
      commonMistakes: [
        'Playing too conservatively',
        'Not closing the game',
        'Giving opponent turns to topdeck'
      ],
      idealScenario: 'Extra cards, planeswalker advantage, opponent topdecking',
      redFlags: [
        'Opponent has fast win condition',
        'You are decking',
        'Opponent has removal for your win con'
      ]
    },
    combat: {
      attacking: {
        whenTo: [
          'Opponent has no blockers',
          'You can force favorable blocks',
          'Win condition requires attacking'
        ],
        whenNotTo: [
          'Into open mana',
          'When holding counterspell',
          'When racing is not needed'
        ],
        calculations: [
          'Calculate if opponent can answer',
          'Consider card advantage',
          'Know your late game'
        ]
      },
      defending: {
        whenTo: [
          'Creature would die anyway',
          'Trade up in cards',
          'Life is low'
        ],
        whenNotTo: [
          'Block when racing is better',
          'Block with win condition',
          'Block when you can counter'
        ],
        calculations: [
          'Calculate card advantage',
          'Know your removal',
          'Consider sweeper timing'
        ]
      },
      general: [
        'Life > cards early',
        'Cards > life late',
        'Never give free attacks'
      ]
    }
  },
  {
    archetype: 'midrange',
    archetypeName: 'Midrange',
    format: 'standard',
    opening: {
      priorities: [
        'Play on curve',
        'Establish flexible threats',
        'Disrupt opponent if possible'
      ],
      commonMistakes: [
        'Playing reactive instead of proactive',
        'Not having enough threats',
        'Missing curve'
      ],
      idealScenario: 'T1 discard/T1 drop, T2/T3/T4 threat each turn',
      redFlags: [
        'Hand of all high mana cards',
        'No early plays',
        'No way to deal with resolved threats'
      ]
    },
    midGame: {
      priorities: [
        'Play threats and answers',
        'Use hand disruption',
        'Control the board'
      ],
      commonMistakes: [
        'Running out of cards',
        'Not adapting to opponent',
        'Trading too much'
      ],
      idealScenario: 'Threat on board, removal in hand, card draw available',
      redFlags: [
        'Opponent has card advantage',
        'You have no threats',
        'Opponent has answered everything'
      ]
    },
    lateGame: {
      priorities: [
        'Win through value',
        'Use planeswalkers',
        'Outdraw opponent'
      ],
      commonMistakes: [
        'Not having late game',
        'Running out of gas',
        'Playing into sweeper'
      ],
      idealScenario: 'Topdeck war with planeswalker advantage',
      redFlags: [
        'Opponent has superior late game',
        'No win conditions left',
        'Opponent has locked board'
      ]
    },
    combat: {
      attacking: {
        whenTo: [
          'Opponent has tapped out',
          'You can force favorable trades',
          'Opponent life is low'
        ],
        whenNotTo: [
          'Into obvious removal',
          'When opponent has sweepers',
          'When racing is not favorable'
        ],
        calculations: [
          'Calculate if you die to sweepers',
          'Know opponent removal',
          'Consider card advantage'
        ]
      },
      defending: {
        whenTo: [
          'Trade up in cards',
          'Kill opposing threat',
          'Life is concern'
        ],
        whenNotTo: [
          'When you need pressure',
          'Block with win con',
          'When racing is better'
        ],
        calculations: [
          'Know your removal',
          'Calculate card advantage',
          'Consider opponent hand'
        ]
      },
      general: [
        'Balance pressure and defense',
        'Know your role',
        'Adapt to game state'
      ]
    }
  }
];

/**
 * Get game phase strategy for an archetype
 */
export function getGamePhaseStrategy(
  archetype: ArchetypeCategory,
  format: MagicFormat
): GamePhaseStrategy | null {
  return gamePhaseStrategies.find(
    s => s.archetype === archetype && s.format === format
  ) || null;
}

/**
 * Get all game phase strategies for a format
 */
export function getAllGamePhaseStrategies(format: MagicFormat): GamePhaseStrategy[] {
  return gamePhaseStrategies.filter(s => s.format === format);
}

/**
 * Evaluate a hand (simplified evaluation)
 */
export function evaluateHand(
  hand: string[],
  deckArchetype: ArchetypeCategory
): HandEvaluation {
  // Simplified evaluation logic
  let score = 0;
  const factors: string[] = [];
  const suggestions: string[] = [];
  
  // Estimate mana curve from card names (very simplified)
  const manaCurve = [0, 0, 0, 0, 0, 0, 0];
  const colorCount: Record<string, number> = {};
  
  hand.forEach(card => {
    // Very rough estimation based on card name patterns
    if (card.includes('1') || card.includes('Elf') || card.includes('Goblin')) {
      manaCurve[1]++;
      if (card.includes('Green')) colorCount['G'] = (colorCount['G'] || 0) + 1;
    } else if (card.includes('2') || card.includes('Knight') || card.includes('Wizard')) {
      manaCurve[2]++;
    } else if (card.includes('3') || card.includes('Beast') || card.includes('Dragon')) {
      manaCurve[3]++;
    } else if (card.includes('4') || card.includes('Angel') || card.includes('Demon')) {
      manaCurve[4]++;
    } else if (card.includes('5') || card.includes('Elder') || card.includes('Hydra')) {
      manaCurve[5]++;
    } else if (card.includes('6') || card.includes('Eldrazi') || card.includes('Titan')) {
      manaCurve[6]++;
    }
  });
  
  // Evaluate hand based on archetype
  if (deckArchetype === 'aggro') {
    if (manaCurve[1] >= 2) {
      score += 2;
      factors.push('Good early drops');
    }
    if (manaCurve[2] + manaCurve[3] >= 2) {
      score += 1;
      factors.push('Good curve');
    }
    if (manaCurve[4] + manaCurve[5] >= 3) {
      score -= 2;
      suggestions.push('Too expensive - consider mulligan');
    }
  } else if (deckArchetype === 'control') {
    if (manaCurve[4] + manaCurve[5] >= 2) {
      score += 2;
      factors.push('Good late game');
    }
    if (manaCurve[1] + manaCurve[2] >= 3) {
      score -= 1;
      suggestions.push('Too aggressive for control');
    }
  } else {
    // Midrange
    if (manaCurve[2] + manaCurve[3] + manaCurve[4] >= 3) {
      score += 2;
      factors.push('Balanced curve');
    }
  }
  
  // Determine rating
  let rating: 'excellent' | 'good' | 'fair' | 'poor';
  if (score >= 3) {
    rating = 'excellent';
  } else if (score >= 1) {
    rating = 'good';
  } else if (score >= -1) {
    rating = 'fair';
  } else {
    rating = 'poor';
  }
  
  return {
    rating,
    factors: factors.length > 0 ? factors : ['Average hand'],
    suggestions,
    manaCurve,
    colorCount
  };
}
