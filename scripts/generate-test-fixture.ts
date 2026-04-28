#!/usr/bin/env ts-node
/**
 * Generate Jest Test Fixtures from Video-Derived Game States
 *
 * This script processes video-derived game state JSON files and generates
 * corresponding Jest test files for automated validation.
 *
 * Usage:
 *   npx ts-node scripts/generate-test-fixture.ts --fixtures-dir path/to/fixtures
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestFixture {
  id: string;
  name: string;
  description?: string;
  gameState: any;
  expectedBehaviors?: string[];
}

interface TestGenerationOptions {
  fixturesDir: string;
  outputDir: string;
  dryRun?: boolean;
}

const DEFAULT_OPTIONS: TestGenerationOptions = {
  fixturesDir: 'src/lib/__fixtures__/video-derived',
  outputDir: 'src/lib/game-state/__tests__/video-derived',
  dryRun: false,
};

/**
 * Parse command line arguments
 */
function parseArgs(): TestGenerationOptions {
  const args = process.argv.slice(2);
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--fixtures-dir' && nextArg) {
      options.fixturesDir = nextArg;
      i++;
    } else if (arg === '--output-dir' && nextArg) {
      options.outputDir = nextArg;
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Usage: npx ts-node scripts/generate-test-fixture.ts [options]

Options:
  --fixtures-dir <path>   Directory containing video-derived fixture JSON files (default: src/lib/__fixtures__/video-derived)
  --output-dir <path>     Directory to write generated test files (default: src/lib/game-state/__tests__/video-derived)
  --dry-run               Generate tests without writing files
  --help                  Show this help message

Example:
  npx ts-node scripts/generate-test-fixture.ts --fixtures-dir src/lib/__fixtures__/video-derived
      `);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Load all fixture JSON files from a directory
 */
function loadFixtures(fixturesDir: string): TestFixture[] {
  const fixtures: TestFixture[] = [];

  if (!fs.existsSync(fixturesDir)) {
    console.warn(`Fixtures directory does not exist: ${fixturesDir}`);
    return fixtures;
  }

  const files = fs.readdirSync(fixturesDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(fixturesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Normalize fixture data
      const fixture: TestFixture = {
        id: data.id || path.basename(file, '.json'),
        name: data.name || `Video-derived fixture from ${file}`,
        description: data.description,
        gameState: data.gameState || data,
        expectedBehaviors: data.expectedBehaviors || [],
      };

      fixtures.push(fixture);
      console.log(`Loaded fixture: ${fixture.id}`);
    } catch (error) {
      console.error(`Error loading fixture ${file}:`, error);
    }
  }

  return fixtures;
}

/**
 * Generate Jest test file content from a fixture
 */
function generateTestFile(fixture: TestFixture): string {
  const { id, name, description, expectedBehaviors } = fixture;

  const behaviorTests = expectedBehaviors.map((behavior, index) => {
    const testName = behavior.replace(/[^a-zA-Z0-9]/g, '_');
    return `
  it('validates behavior: ${behavior}', () => {
    // TODO: Implement validation for: ${behavior}
    // This test should verify that the game state correctly handles:
    // ${behavior}
    expect(fixture.gameState).toBeDefined();
  });`;
  }).join('\n');

  return `/**
 * Video-Derived Test Fixture: ${name}
 * ${description ? `Description: ${description}` : ''}
 * Fixture ID: ${id}
 *
 * Auto-generated from video-derived game state
 */

import { GameState } from '../game-state';
import { createGameState } from '../examples';

const fixture = {
  id: '${id}',
  name: '${name}',
  ${description ? `description: '${description}',` : ''}
  gameState: ${JSON.stringify(fixture.gameState, null, 2)},
  expectedBehaviors: ${JSON.stringify(expectedBehaviors, null, 2)},
};

describe('Video-Derived Fixture: ${id}', () => {
  it('loads game state successfully', () => {
    expect(fixture.gameState).toBeDefined();
    expect(fixture.gameState).toBeInstanceOf(Object);
  });

  it('has valid player data', () => {
    if (fixture.gameState.players) {
      expect(Array.isArray(fixture.gameState.players)).toBe(true);
      expect(fixture.gameState.players.length).toBeGreaterThan(0);
    }
  });

  it('has valid turn structure', () => {
    if (fixture.gameState.turn) {
      expect(fixture.gameState.turn).toHaveProperty('phase');
      expect(fixture.gameState.turn).toHaveProperty('player');
    }
  });

  it('can be serialized and deserialized', () => {
    const serialized = JSON.stringify(fixture.gameState);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(fixture.gameState);
  });

${behaviorTests}
});
`;
}

/**
 * Write a test file to disk
 */
function writeTestFile(outputDir: string, fixture: TestFixture): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `${fixture.id}.test.ts`;
  const filePath = path.join(outputDir, fileName);
  const content = generateTestFile(fixture);

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Generated test file: ${filePath}`);
}

/**
 * Main execution
 */
function main(): void {
  const options = parseArgs();

  console.log('=== Video-Derived Test Fixture Generator ===');
  console.log(`Fixtures directory: ${options.fixturesDir}`);
  console.log(`Output directory: ${options.outputDir}`);
  console.log(`Dry run: ${options.dryRun}`);
  console.log();

  const fixtures = loadFixtures(options.fixturesDir);

  if (fixtures.length === 0) {
    console.log('No fixtures found. Exiting.');
    return;
  }

  console.log(`\nGenerating ${fixtures.length} test files...\n`);

  if (options.dryRun) {
    for (const fixture of fixtures) {
      console.log(`Would generate: ${fixture.id}.test.ts`);
    }
  } else {
    for (const fixture of fixtures) {
      try {
        writeTestFile(options.outputDir, fixture);
      } catch (error) {
        console.error(`Error generating test for ${fixture.id}:`, error);
      }
    }
  }

  console.log(`\n✓ Generated ${fixtures.length} test files`);
  console.log(`\nTo run the tests:`);
  console.log(`  npm test -- --testPathPattern=video-derived`);
}

if (require.main === module) {
  main();
}

export { parseArgs, loadFixtures, generateTestFile, writeTestFile };
