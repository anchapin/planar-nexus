#!/usr/bin/env ts-node

/**
 * Generate Test Fixture Script
 *
 * Converts game state JSON into Jest test case TypeScript files.
 * Part of GH#684: Auto-generate Jest test fixtures from real game states.
 */

import type { GameState } from './types';
import type { SerializedGameState } from './game-state-serialization';
import { serializeGameState, generateFixtureDescription } from './game-state-serialization';

/**
 * Test fixture configuration
 */
export interface FixtureConfig {
  gameStates: GameState[];
  outputDir: string;
  testNamePrefix: string;
  testDescription: string;
  includeSetup?: boolean;
  includeTeardown?: boolean;
}

/**
 * Generated test case
 */
export interface GeneratedTest {
  testName: string;
  testDescription: string;
  gameState: SerializedGameState;
  setupCode?: string;
  assertionCode?: string;
  tags: string[];
}

/**
 * Generate Jest test file content
 */
export function generateJestTestFile(config: FixtureConfig): string {
  const tests: GeneratedTest[] = [];

  for (const state of config.gameStates) {
    try {
      const serialized = serializeGameState(state);
      const test = generateTestCase(state, serialized, config);
      tests.push(test);
    } catch (error) {
      console.warn(`Skipping game state ${state.gameId}:`, error);
    }
  }

  return generateTestFileContent(config, tests);
}

/**
 * Generate a single test case
 */
function generateTestCase(
  state: GameState,
  serialized: SerializedGameState,
  config: FixtureConfig
): GeneratedTest {
  const description = generateFixtureDescription(state);
  const testName = `${config.testNamePrefix}-${state.gameId.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const tags = generateTestTags(state, serialized);

  return {
    testName,
    testDescription: description,
    gameState: serialized,
    setupCode: generateSetupCode(state),
    assertionCode: generateAssertionCode(state),
    tags,
  };
}

/**
 * Generate tags for test classification
 */
function generateTestTags(state: GameState, serialized: SerializedGameState): string[] {
  const tags: string[] = [];

  // Complexity tag
  const complexity = serialized.metadata.complexityScore;
  if (complexity > 0.7) tags.push('complex');
  else if (complexity > 0.4) tags.push('medium');
  else tags.push('simple');

  // Stack interaction tag
  if (state.stack.length > 0) tags.push('stack-interaction');

  // Combat tag
  if (state.combat.inCombatPhase) tags.push('combat');

  // Counters tag
  const hasCounters = Array.from(state.cards.values()).some(
    card => card.counters.length > 0
  );
  if (hasCounters) tags.push('counters');

  // Mana tag
  const hasMana = Array.from(state.players.values()).some(
    player => Object.values(player.manaPool).some(m => m > 0)
  );
  if (hasMana) tags.push('mana');

  // Choice tag
  if (state.waitingChoice) tags.push('player-choice');

  return tags;
}

/**
 * Generate setup code for a test
 */
function generateSetupCode(state: GameState): string {
  const parts: string[] = [];

  // Create players
  parts.push('// Setup players');
  for (const [playerId, player] of state.players.entries()) {
    parts.push(`const ${sanitizeVariableName(player.name)} = createPlayer({`);
    parts.push(`  id: '${playerId}',`);
    parts.push(`  name: '${player.name}',`);
    parts.push(`  life: ${player.life},`);
    parts.push(`  manaPool: ${JSON.stringify(player.manaPool)},`);
    parts.push(`});`);
  }

  // Create zones
  parts.push('// Setup zones');

  return parts.join('\n');
}

/**
 * Generate assertion code for a test
 */
function generateAssertionCode(state: GameState): string {
  const parts: string[] = [];

  // Basic state assertions
  parts.push('// Verify game state structure');
  parts.push('expect(gameState).toBeDefined();');
  parts.push('expect(gameState.players).toHaveLength(' + state.players.size + ');');
  parts.push('expect(gameState.cards).toBeDefined();');

  // Stack assertions
  if (state.stack.length > 0) {
    parts.push('');
    parts.push('// Verify stack state');
    parts.push(`expect(gameState.stack).toHaveLength(${state.stack.length});`);
  }

  // Combat assertions
  if (state.combat.inCombatPhase) {
    parts.push('');
    parts.push('// Verify combat state');
    parts.push(`expect(gameState.combat.inCombatPhase).toBe(true);`);
    parts.push(`expect(gameState.combat.attackers).toHaveLength(${state.combat.attackers.length});`);
  }

  // Choice assertions
  if (state.waitingChoice) {
    parts.push('');
    parts.push('// Verify waiting choice');
    parts.push('expect(gameState.waitingChoice).toBeDefined();');
    parts.push(`expect(gameState.waitingChoice.type).toBe('${state.waitingChoice.type}');`);
  }

  return parts.join('\n');
}

/**
 * Generate complete test file content
 */
function generateTestFileContent(
  config: FixtureConfig,
  tests: GeneratedTest[]
): string {
  const lines: string[] = [];

  // File header
  lines.push('/**');
  lines.push(` * Auto-generated test fixtures: ${config.testDescription}`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` * Total tests: ${tests.length}`);
  lines.push(` * Source: GH#684 Video Analysis Pipeline`);
  lines.push(' */');
  lines.push('');
  lines.push("import {");
  lines.push("  createGameState,");
  lines.push("  createCard,");
  lines.push("  createPlayer,");
  lines.push("  createZone,");
  lines.push("} from '../test-helpers';");
  lines.push("import type { GameState } from '../types';");
  lines.push('');
  lines.push(`describe('${config.testDescription}', () => {`);

  // Test summary
  const tagCounts = new Map<string, number>();
  tests.forEach(test => {
    test.tags.forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  lines.push('');
  lines.push('  // Test Summary');
  lines.push(`  // Total tests: ${tests.length}`);
  for (const [tag, count] of tagCounts.entries()) {
    lines.push(`  // ${tag}: ${count}`);
  }
  lines.push('');

  // Generate individual tests
  for (const test of tests) {
    lines.push(generateIndividualTest(test, config));
  }

  lines.push('});');

  return lines.join('\n');
}

/**
 * Generate an individual test case
 */
function generateIndividualTest(test: GeneratedTest, config: FixtureConfig): string {
  const lines: string[] = [];

  // Test header with tags
  const tagComment = test.tags.length > 0
    ? ` // tags: ${test.tags.join(', ')}`
    : '';
  lines.push('');
  lines.push(`  test('${test.testName}: ${test.testDescription}${tagComment}', () => {`);

  // Setup
  if (config.includeSetup && test.setupCode) {
    lines.push('    // Setup');
    lines.push(indentCode(test.setupCode, 4));
    lines.push('');
  }

  // Create game state
  lines.push('    // Create game state from fixture data');
  lines.push('    const fixture = ' + JSON.stringify(test.gameState, null, 2) + ';');
  lines.push('    const gameState = deserializeGameState(fixture);');
  lines.push('');

  // Assertions
  if (config.includeSetup && test.assertionCode) {
    lines.push('    // Assertions');
    lines.push(indentCode(test.assertionCode, 4));
    lines.push('');
  }

  // Basic verification
  lines.push('    // Verify fixture integrity');
  lines.push('    expect(gameState).toBeDefined();');
  lines.push('    expect(gameState.gameId).toBe(\'' + test.gameState.metadata.gameId + '\');');
  lines.push('    expect(gameState.format).toBe(\'' + test.gameState.metadata.format + '\');');

  lines.push('  });');

  return lines.join('\n');
}

/**
 * Indent code by specified number of spaces
 */
function indentCode(code: string, spaces: number): string {
  const indent = ' '.repeat(spaces);
  return code.split('\n').map(line => indent + line).join('\n');
}

/**
 * Sanitize variable name
 */
function sanitizeVariableName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^(\d)/, '_$1');
}

/**
 * CLI entry point for generating fixtures
 */
export async function generateFixturesFromCLI(args: string[]): Promise<void> {
  console.log('Generating test fixtures from game states...');
  console.log('This is a stub implementation for GH#684');
  console.log('');
  console.log('Usage:');
  console.log('  npm run generate:fixtures <input-file.json> <output-dir>');
  console.log('');
  console.log('Input file should contain an array of GameState objects');
  console.log('Output directory will contain generated test files');
}

// Export for testing
export { generateJestTestFile, generateTestCase, generateTestTags, generateSetupCode, generateAssertionCode, generateFixturesFromCLI };
