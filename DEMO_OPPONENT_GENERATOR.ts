/**
 * @fileOverview Demonstration of Enhanced Opponent Deck Generator
 *
 * Run this script to see the enhanced generator in action:
 * npx tsx DEMO_OPPONENT_GENERATOR.ts
 */

import {
  generateOpponentDeck,
  generateRandomDeck,
  generateThemedDeck,
  generateColorDeck,
  getAvailableArchetypes,
  getAvailableThemes,
  getDifficultyConfig,
} from './src/lib/opponent-deck-generator';

function printSeparator() {
  console.log('\n' + '='.repeat(80) + '\n');
}

function printDeck(deck: any, title: string) {
  console.log(`\n${title}`);
  console.log(`Name: ${deck.name}`);
  console.log(`Archetype: ${deck.archetype}`);
  console.log(`Theme: ${deck.theme}`);
  console.log(`Difficulty: ${deck.difficulty}`);
  console.log(`Format: ${deck.format}`);
  console.log(`Colors: ${deck.colorIdentity.join(', ')}`);
  console.log(`Description: ${deck.description}`);
  console.log(`\nStrategic Approach:\n${deck.strategicApproach}`);
  console.log(`\nDeck List (${deck.cards.length} unique cards):`);

  const totalCards = deck.cards.reduce((sum: number, c: any) => sum + c.quantity, 0);
  console.log(`Total cards: ${totalCards}`);

  // Group cards by quantity
  const byQuantity: Record<number, string[]> = {};
  deck.cards.forEach((c: any) => {
    if (!byQuantity[c.quantity]) {
      byQuantity[c.quantity] = [];
    }
    byQuantity[c.quantity].push(c.name);
  });

  Object.keys(byQuantity)
    .sort((a, b) => parseInt(b) - parseInt(a))
    .forEach((qty: any) => {
      console.log(`\n${qty}x:`);
      byQuantity[qty].forEach((name: string) => {
        console.log(`  - ${name}`);
      });
    });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     Enhanced Opponent Deck Generator - Demonstration                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  printSeparator();

  // 1. Show available options
  console.log('Available Archetypes:');
  const archetypes = getAvailableArchetypes();
  archetypes.forEach((archetype) => {
    const themes = getAvailableThemes(archetype);
    console.log(`  - ${archetype}: ${themes.join(', ')}`);
  });

  printSeparator();

  // 2. Generate themed decks
  console.log('Example 1: Goblin Aggro Deck');
  const goblinDeck = generateThemedDeck('goblins', 'commander', 'hard');
  printDeck(goblinDeck, 'Goblin Aggro Deck');

  printSeparator();

  console.log('Example 2: Burn Deck');
  const burnDeck = generateThemedDeck('burn', 'modern', 'expert');
  printDeck(burnDeck, 'Burn Deck');

  printSeparator();

  console.log('Example 3: Control Deck');
  const controlDeck = generateThemedDeck('control', 'commander', 'medium');
  printDeck(controlDeck, 'Control Deck');

  printSeparator();

  console.log('Example 4: Reanimator Combo Deck');
  const reanimatorDeck = generateThemedDeck('reanimator', 'legacy', 'hard');
  printDeck(reanimatorDeck, 'Reanimator Combo Deck');

  printSeparator();

  // 3. Generate color-based decks
  console.log('Example 5: Red/White Aggro Deck');
  const rwAggroDeck = generateColorDeck(['R', 'W'], 'commander', 'medium');
  printDeck(rwAggroDeck, 'Red/White Aggro Deck');

  printSeparator();

  console.log('Example 6: Blue/Black Control Deck');
  const ubControlDeck = generateColorDeck(['U', 'B'], 'modern', 'hard');
  printDeck(ubControlDeck, 'Blue/Black Control Deck');

  printSeparator();

  console.log('Example 7: Green/White Midrange Deck');
  const gwMidrangeDeck = generateColorDeck(['G', 'W'], 'standard', 'medium');
  printDeck(gwMidrangeDeck, 'Green/White Midrange Deck');

  printSeparator();

  // 4. Generate random decks
  console.log('Example 8-10: Random Generated Decks');
  for (let i = 0; i < 3; i++) {
    const randomDeck = generateRandomDeck('commander');
    printDeck(randomDeck, `Random Deck #${i + 1}`);
    printSeparator();
  }

  // 5. Show difficulty progression
  console.log('Difficulty Progression: Same Archetype, Different Difficulties');
  const difficulties = ['easy', 'medium', 'hard', 'expert'] as const;
  difficulties.forEach((difficulty) => {
    const deck = generateOpponentDeck({
      format: 'commander',
      archetype: 'midrange',
      difficulty,
    });

    const totalCards = deck.cards.reduce((sum: number, c: any) => sum + c.quantity, 0);
    const uniqueCards = deck.cards.length;
    const config = getDifficultyConfig(difficulty);

    console.log(`\n${difficulty.toUpperCase()}:`);
    console.log(`  Total Cards: ${totalCards}`);
    console.log(`  Unique Cards: ${uniqueCards}`);
    console.log(`  Synergy Weight: ${config.synergyWeight}`);
    console.log(`  Removal Count: ${config.removalCount}`);
    console.log(`  Creature Count: ${config.creatureCount}`);
    console.log(`  Consistency: ${config.consistency}`);
  });

  printSeparator();

  console.log('Demonstration complete!');
  console.log('\nKey Features Demonstrated:');
  console.log('✓ Archetype-based generation with 10 unique archetypes');
  console.log('✓ Strategic themes for variety within archetypes');
  console.log('✓ Four difficulty levels affecting deck quality');
  console.log('✓ Format support (Commander, Modern, Standard, Legacy)');
  console.log('✓ Color identity enforcement');
  console.log('✓ Strategic approach generation');
  console.log('✓ Mana curve optimization');
  console.log('✓ Theme-specific card inclusion');
  console.log('✓ Random generation for variety');
  console.log('\nThe enhanced generator is fully client-side and requires no AI providers!');
}

// Run the demonstration
main().catch((error) => {
  console.error('Error running demonstration:', error);
  process.exit(1);
});
