'use server';
/**
 * @fileOverview Heuristic AI Opponent Deck Generator
 *
 * This module generates AI opponent decks using rule-based templates and heuristics
 * instead of AI generation. It provides themed decks with appropriate difficulty
 * scaling.
 *
 * - generateAIOpponentDeck - A function that generates an AI opponent's deck.
 * - AIOpponentDeckGenerationInput - The input type for the generateAIOpponentDeck function.
 * - AIOpponentDeckGenerationOutput - The return type for the generateAIOpponentDeck function.
 */

export interface AIOpponentDeckGenerationInput {
  theme: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface AIOpponentDeckGenerationOutput {
  deckList: string[];
  strategicApproach: string;
}

/**
 * Deck templates for different themes
 */
const deckTemplates: Record<string, {
  cards: string[];
  strategy: string;
}> = {
  'aggressive red': {
    cards: [
      'Lightning Bolt x4',
      'Goblin Guide x4',
      'Monastery Swiftspear x4',
      'Eidolon of the Great Revel x3',
      'Boros Charm x2',
      'Skullcrack x2',
      'Searing Blaze x3',
      'Rift Bolt x4',
      'Lava Spike x4',
      'Grim Lavamancer x2',
      'Bloodstained Mire x4',
      'Wooded Foothills x4',
      'Stomping Ground x2',
      'Sacred Foundry x2',
      'Mountain x12',
    ],
    strategy: 'This deck aims to win quickly by dealing direct damage to the opponent with cheap, efficient creatures and burn spells. Prioritize attacking with creatures in the early turns and use burn spells to remove blockers or finish off the opponent\'s life total. Be mindful of opponent\'s life total and switch from creature-based damage to direct burn when lethal is possible. Mulligan aggressively for hands with multiple one-drop creatures.',
  },
  'control blue': {
    cards: [
      'Counterspell x4',
      'Opt x4',
      'Think Twice x4',
      'Snapcaster Mage x2',
      'Cryptic Command x2',
      'Mana Leak x4',
      'Remand x3',
      'Supreme Verdict x3',
      'Detention Sphere x2',
      'Jace, the Mind Sculptor x2',
      'Archangel of Thune x1',
      'Sphinx\'s Revelation x2',
      'Island x14',
      'Glacial Fortress x4',
      'Hallowed Fountain x4',
      'Watery Grave x4',
    ],
    strategy: 'This control deck seeks to disrupt the opponent\'s plans with counterspells and removal, then pull ahead with card advantage engines and powerful finishers. Use counterspells selectively on the opponent\'s most threatening plays, and prioritize card draw to find your win conditions. Develop your mana base carefully and be patient - control decks win by inevitability rather than speed. Save your removal for the most threatening creatures and look for opportunities to resolve planeswalkers or finishers when the opponent is tapped out.',
    },
  'token generation': {
    cards: [
      'Raise the Alarm x4',
      'Secure the Wastes x4',
      'Intangible Virtue x4',
      'Anthem of the Proud x3',
      'Midnight Haunting x4',
      'Spectral Procession x4',
      'Honor of the Pure x4',
      'Zealous Persecution x3',
      'Timely Reinforcements x3',
      'Elspeth, Knight-Errant x2',
      'Plains x16',
      'Flagstones of Trokair x4',
    ],
    strategy: 'This token-based strategy aims to overwhelm the opponent with multiple small creatures and anthem effects that make each token stronger. Prioritize making tokens on every turn and cast anthem effects to maximize their power. Attack aggressively with your swarm of tokens, using pump spells and combat tricks to trade favorably. Be careful about board wipes - consider leaving some tokens back for defense when the opponent has access to mass removal. Use planeswalkers to generate card advantage and additional threats.',
  },
  'mill': {
    cards: [
      'Mind Funeral x4',
      'Traumatize x3',
      'Glimpse the Unthinkable x4',
      'Mind Sculpt x4',
      'Breaking // Entering x2',
      'Hedron Crab x4',
      'Mesmeric Orb x3',
      'Fractured Sanity x3',
      'Jace\'s Phantasm x4',
      'Snapcaster Mage x2',
      'Psychic Strike x4',
      'Island x16',
      'Drowned Catacomb x4',
      'Sunken Ruins x4',
      'Watery Grave x4',
    ],
    strategy: 'This mill deck seeks to win by depleting the opponent\'s library rather than reducing their life total. Prioritize playing cheap mill spells early to start reducing their library size, and use Hedron Crab to generate mill value whenever you play lands. Focus on casting mill spells rather than developing a board, as your win condition is independent of life totals. Be aware of opponents with graveyard-based strategies, as milling can accidentally fuel their game plan. Use counterspells to protect your mill spells from disruption.',
  },
  'ramp': {
    cards: [
      'Sol Ring x4',
      'Arcane Signet x4',
 'Cultivate x4',
      'Kodama\'s Reach x4',
      'Explosive Vegetation x4',
      'Nissa\'s Pilgrimage x4',
      'Avenger of Zendikar x2',
      'Primeval Titan x2',
      'Craterhoof Behemoth x2',
      'Hydra Broodmaster x2',
      'World Breaker x2',
      'Ulamog, the Ceaseless Hunger x1',
      'Forest x12',
      'Mountain x6',
      'Plains x6',
    ],
    strategy: 'This ramp deck accelerates its mana development to play powerful creatures ahead of curve. Prioritize casting ramp spells and mana rocks in the early turns to build up a large mana base. Once you have 5+ mana, start deploying your large threats that will quickly dominate the game. Be mindful of opponent\'s removal - having your big creatures countered or destroyed can be devastating. Consider holding up some mana for protection or interaction in the mid-game. Your threats are powerful enough to win even if you draw removal, so keep applying pressure.',
  },
  'midrange': {
    cards: [
      'Tarmogoyf x4',
      'Scavenging Ooze x3',
      'Siege Rhino x3',
      'Kitchen Finks x3',
      'Voice of Resurgence x3',
      'Maelstrom Pulse x3',
      'Abrupt Decay x4',
      'Thoughtseize x4',
      'Inquisition of Kozilek x4',
      'Liliana of the Veil x2',
      'Gideon, Ally of Zendikar x2',
      'Verdant Catacombs x4',
      'Marsh Flats x4',
      'Overgrown Tomb x4',
      'Godless Shrine x4',
      'Temple Garden x4',
      'Forest x4',
      'Swamp x4',
    ],
    strategy: 'This midrange deck combines efficient threats with disruption to win through attrition. Use your discard spells proactively to remove key cards from the opponent\'s hand before they can cast them. Develop your board with efficient creatures that provide immediate value, and use your flexible removal to handle whatever the opponent plays. Midrange decks excel in the mid-game, so be patient in the early turns and look to extend the game into a favorable position. Your cards are generally more powerful individually than the opponent\'s, so focus on 1-for-1 trades and let card advantage accumulate over time.',
  },
};

/**
 * Get difficulty modifiers for deck cards
 */
function getDifficultyModifiers(difficulty: 'easy' | 'medium' | 'hard'): {
  removeCards: number;
  addPowerfulCards: boolean;
  adjustStrategy: string;
} {
  switch (difficulty) {
    case 'easy':
      return {
        removeCards: 6,
        addPowerfulCards: false,
        adjustStrategy: 'Play your best cards and don\'t worry too much about timing. Focus on making good attacks and blocking when advantageous.',
      };
    case 'medium':
      return {
        removeCards: 0,
        addPowerfulCards: false,
        adjustStrategy: 'Look for opportunities to apply pressure while holding up interaction. Be mindful of your life total and prioritize board presence in the early game.',
      };
    case 'hard':
      return {
        removeCards: 0,
        addPowerfulCards: true,
        adjustStrategy: 'Play optimally by maximizing card advantage and tempo advantage. Look for opportunities to gain incremental edges and exploit opponent\'s mistakes.',
      };
  }
}

/**
 * Generate deck based on theme and difficulty
 */
export async function generateAIOpponentDeck(
  input: AIOpponentDeckGenerationInput
): Promise<AIOpponentDeckGenerationOutput> {
  // Normalize theme to match template keys
  const normalizedTheme = Object.keys(deckTemplates).find(key =>
    key.toLowerCase().includes(input.theme.toLowerCase()) ||
    input.theme.toLowerCase().includes(key)
  ) || 'aggressive red';

  const template = deckTemplates[normalizedTheme] || deckTemplates['aggressive red'];
  const difficultyModifiers = getDifficultyModifiers(input.difficulty);

  let deckList = [...template.cards];

  // Apply difficulty modifiers
  if (difficultyModifiers.removeCards > 0) {
    // Remove some basic lands for easier mode
    const landEntries = deckList.filter(entry =>
      entry.toLowerCase().includes('mountain') ||
      entry.toLowerCase().includes('island') ||
      entry.toLowerCase().includes('forest') ||
      entry.toLowerCase().includes('plains') ||
      entry.toLowerCase().includes('swamp')
    );

    const landsToRemove = Math.min(difficultyModifiers.removeCards, landEntries.length);
    for (let i = 0; i < landsToRemove; i++) {
      const index = deckList.indexOf(landEntries[i]);
      if (index !== -1) {
        deckList.splice(index, 1);
      }
    }
  }

  // Generate strategic approach
  let strategicApproach = template.strategy;
  if (difficultyModifiers.adjustStrategy) {
    strategicApproach += '\n\n' + difficultyModifiers.adjustStrategy;
  }

  // Add difficulty-specific notes
  switch (input.difficulty) {
    case 'easy':
      strategicApproach += '\n\nAs an easy opponent, I will make some suboptimal plays and not always respond optimally to your threats.';
      break;
    case 'medium':
      strategicApproach += '\n\nAs a medium opponent, I will play solid Magic but may miss some lines of play.';
      break;
    case 'hard':
      strategicApproach += '\n\nAs a hard opponent, I will play optimally and look for any opportunity to gain an advantage.';
      break;
  }

  return {
    deckList,
    strategicApproach,
  };
}
