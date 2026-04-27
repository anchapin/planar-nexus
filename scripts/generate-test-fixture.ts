#!/usr/bin/env node

/**
 * Generate Test Fixture CLI Script
 *
 * Converts game state JSON files into Jest test cases.
 * Usage: node scripts/generate-test-fixture.ts <input.json> <output-dir>
 *
 * Part of GH#684: Auto-generate Jest test fixtures from real game states.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateJestTestFile } from '../src/lib/generate-test-fixture';
import type { GameState } from '../src/lib/game-state/types';
import type { FixtureConfig } from '../src/lib/generate-test-fixture';

/**
 * Main CLI execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node generate-test-fixture.ts <input.json> <output-dir>');
    console.error('');
    console.error('Arguments:');
    console.error('  input.json   - JSON file containing array of GameState objects');
    console.error('  output-dir   - Directory to write generated test files');
    console.error('');
    console.error('Options:');
    console.error('  --prefix <name>  - Test name prefix (default: "auto-generated")');
    console.error('  --description   - Test suite description');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputDir = args[1];
  let testNamePrefix = 'auto-generated';
  let testDescription = 'Auto-generated test fixtures';

  // Parse optional flags
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--prefix' && args[i + 1]) {
      testNamePrefix = args[++i];
    } else if (args[i] === '--description' && args[i + 1]) {
      testDescription = args[++i];
    }
  }

  try {
    // Read input file
    console.log(`Reading game states from: ${inputPath}`);
    const inputContent = fs.readFileSync(inputPath, 'utf-8');
    const gameStates: GameState[] = JSON.parse(inputContent);

    console.log(`Found ${gameStates.length} game states`);

    if (!Array.isArray(gameStates)) {
      throw new Error('Input must be an array of GameState objects');
    }

    // Validate game states
    const validStates: GameState[] = [];
    for (let i = 0; i < gameStates.length; i++) {
      const state = gameStates[i];
      if (!state.gameId || !state.format) {
        console.warn(`Skipping invalid game state at index ${i}: missing gameId or format`);
        continue;
      }
      validStates.push(state);
    }

    console.log(`Valid game states: ${validStates.length}`);

    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created output directory: ${outputDir}`);
    }

    // Generate test file
    const config: FixtureConfig = {
      gameStates: validStates,
      outputDir,
      testNamePrefix,
      testDescription,
      includeSetup: true,
      includeTeardown: true,
    };

    console.log('Generating test file...');
    const testContent = generateJestTestFile(config);

    // Write output file
    const outputFile = path.join(outputDir, `${testNamePrefix}.test.ts`);
    fs.writeFileSync(outputFile, testContent, 'utf-8');

    console.log(`Generated test file: ${outputFile}`);
    console.log(`Test count: ${validStates.length}`);

    // Summary statistics
    console.log('');
    console.log('Generation complete!');
    console.log(`  Input file: ${inputPath}`);
    console.log(`  Output file: ${outputFile}`);
    console.log(`  Game states processed: ${validStates.length}/${gameStates.length}`);

  } catch (error) {
    console.error('Error generating test fixtures:', error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
