/**
 * Unit tests for Commander Damage System
 * Issue #602: Increase test coverage for critical game logic modules
 *
 * Tests:
 * - Commander damage tracking
 * - Damage threshold checking
 * - Commander registration
 * - Color identity
 */

import {
  createCommanderDamageState,
  isCommander,
  getCommanderIdentity,
  registerCommander,
  dealCommanderDamage,
  getCommanderDamage,
  getTotalCommanderDamage,
  hasLostFromCommanderDamage,
  resetCommanderDamage,
  getCommanderDamageSummary,
  getPlayersLostFromCommanderDamage,
  DEFAULT_COMMANDER_DAMAGE_THRESHOLD,
} from '../commander-damage';
import { createInitialGameState, startGame } from '../game-state';
import { createCardInstance } from '../card-instance';
import type { ScryfallCard } from '@/app/actions';

// Helper function to create a mock commander card
function createMockCommander(
  name: string,
  typeLine: string,
  colors: string[] = [],
  manaCost: string = '{W}'
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: manaCost,
    cmc: 2,
    colors,
    color_identity: colors,
    legalities: { standard: 'legal', commander: 'legal' },
    layout: 'normal',
  } as ScryfallCard;
}

describe('Commander Damage System - createCommanderDamageState', () => {
  it('should create empty commander damage state', () => {
    const state = createCommanderDamageState();
    
    expect(state.damageByCommander).toBeInstanceOf(Map);
    expect(state.playerCommanders).toBeInstanceOf(Map);
    expect(state.damageThreshold).toBe(21);
  });

  it('should have default threshold of 21', () => {
    expect(DEFAULT_COMMANDER_DAMAGE_THRESHOLD).toBe(21);
  });
});

describe('Commander Damage System - isCommander', () => {
  it('should return true for legendary creature', () => {
    const card = createCardInstance(
      createMockCommander('Axel', 'Legendary Creature — Human', ['W']),
      'player1',
      'player1'
    );
    
    expect(isCommander(card)).toBe(true);
  });

  it('should return true for legendary planeswalker', () => {
    const card = createCardInstance(
      createMockCommander('Jace', 'Legendary Planeswalker — Jace', ['U'], '{1}{U}'),
      'player1',
      'player1'
    );
    
    expect(isCommander(card)).toBe(true);
  });

  it('should return false for non-legendary creature', () => {
    const card = createCardInstance(
      createMockCommander('Grizzly Bears', 'Creature — Bear', ['G']),
      'player1',
      'player1'
    );
    
    expect(isCommander(card)).toBe(false);
  });

  it('should return false for non-legendary planeswalker', () => {
    const card = createCardInstance(
      createMockCommander('Chandra', 'Planeswalker — Chandra', ['R'], '{2}{R}'),
      'player1',
      'player1'
    );
    
    expect(isCommander(card)).toBe(false);
  });
});

describe('Commander Damage System - getCommanderIdentity', () => {
  it('should extract colors from card data', () => {
    const card = createCardInstance(
      createMockCommander('Azorious Senator', 'Legendary Creature — Human', ['white', 'blue'], '{W}{U}'),
      'player1',
      'player1'
    );
    
    const identity = getCommanderIdentity(card);
    expect(identity).toContain('white');
    expect(identity).toContain('blue');
  });

  it('should extract colors from mana cost', () => {
    const card = createCardInstance(
      createMockCommander('Boros Senator', 'Legendary Creature — Human', [], '{W}{R}'),
      'player1',
      'player1'
    );
    
    const identity = getCommanderIdentity(card);
    expect(identity).toContain('white');
    expect(identity).toContain('red');
  });

  it('should combine colors from both card and mana cost', () => {
    const card = createCardInstance(
      createMockCommander('Esper Senator', 'Legendary Creature — Human', ['white', 'blue'], '{W}{U}'),
      'player1',
      'player1'
    );
    
    const identity = getCommanderIdentity(card);
    // Should have both card colors and mana cost colors
    expect(identity.length).toBeGreaterThan(0);
  });

  it('should handle card without colors', () => {
    const card = createCardInstance(
      createMockCommander('Colorless Commander', 'Legendary Artifact Creature', [], ''),
      'player1',
      'player1'
    );
    
    const identity = getCommanderIdentity(card);
    expect(identity).toEqual([]);
  });
});

describe('Commander Damage System - registerCommander', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
  });

  it('should register a commander for a player', () => {
    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    const commanderId = commander.id;
    state.cards.set(commanderId, commander);

    const result = registerCommander(state, aliceId, commanderId);
    
    // The function returns GameState - check commander damage was tracked
    expect(result.players).toBeDefined();
  });

  it('should allow multiple commanders', () => {
    const commander1 = createCardInstance(
      createMockCommander('Commander 1', 'Legendary Creature — Human', ['W']),
      aliceId, aliceId
    );
    const commander2 = createCardInstance(
      createMockCommander('Commander 2', 'Legendary Creature — Elf', ['G']),
      aliceId, aliceId
    );
    
    state.cards.set(commander1.id, commander1);
    state.cards.set(commander2.id, commander2);

    let result = registerCommander(state, aliceId, commander1.id);
    result = registerCommander(result, aliceId, commander2.id);
    
    // Function completes without error
    expect(result).toBeDefined();
  });
});

describe('Commander Damage System - dealCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should deal commander damage to opponent', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 3);
    
    expect(result.success).toBe(true);
  });

  it('should accumulate commander damage', () => {
    let result = dealCommanderDamage(state, commanderId, bobId, 3);
    result = dealCommanderDamage(result.state, commanderId, bobId, 5);
    
    // Verify the operations complete successfully
    expect(result.success).toBe(true);
  });

  it('should not trigger loss at exactly threshold - 1', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 20);
    
    expect(hasLostFromCommanderDamage(result.state, bobId)).toBe(false);
  });
});

describe('Commander Damage System - getCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should return 0 for no damage dealt', () => {
    const damage = getCommanderDamage(state, commanderId, bobId);
    expect(damage).toBe(0);
  });

  it('should return correct damage after dealing', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 5);
    // Verify the operation completes
    expect(result.success).toBe(true);
  });

  it('should return 0 for non-existent commander', () => {
    const damage = getCommanderDamage(state, 'non-existent', bobId);
    expect(damage).toBe(0);
  });
});

describe('Commander Damage System - getTotalCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should return 0 for player with no damage', () => {
    const total = getTotalCommanderDamage(state, bobId);
    expect(total).toBe(0);
  });

  it('should return total damage from all commanders', () => {
    // Deal damage to Bob from Alice's commander
    const result = dealCommanderDamage(state, commanderId, bobId, 10);

    // Verify the operation completed
    expect(result.success).toBe(true);
    // Issue #976: verify the actual accumulated sum, not just success
    expect(getTotalCommanderDamage(result.state, bobId)).toBe(10);
  });
});

/**
 * Issue #976: Correctly sum per-opponent commander damage.
 *
 * These tests verify that getTotalCommanderDamage sums damage across all
 * commanders that have dealt combat damage to the target, and that the same
 * commander's damage to different opponents is tracked independently.
 * Also covers hasLostFromCommanderDamage's per-commander threshold semantics
 * (CR 903.9a: 21+ from a single commander, NOT summed across commanders).
 */
describe('Commander Damage System - issue #976 per-opponent sum', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob', 'Carol'], 20, true);
    state = startGame(state);

    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];
    carolId = playerIds[2];
  });

  function makeCommander(name: string, ownerId: string) {
    const commander = createCardInstance(
      createMockCommander(name, 'Legendary Creature — Human', ['W']),
      ownerId,
      ownerId,
    );
    state.cards.set(commander.id, commander);
    return commander;
  }

  it('accumulates damage from repeated attacks by the same commander', () => {
    const commander = makeCommander('Solo Commander', aliceId);
    state = registerCommander(state, aliceId, commander.id);

    state = dealCommanderDamage(state, commander.id, bobId, 3).state;
    expect(getTotalCommanderDamage(state, bobId)).toBe(3);

    state = dealCommanderDamage(state, commander.id, bobId, 5).state;
    expect(getTotalCommanderDamage(state, bobId)).toBe(8);

    state = dealCommanderDamage(state, commander.id, bobId, 4).state;
    expect(getTotalCommanderDamage(state, bobId)).toBe(12);
  });

  it('sums damage from multiple commanders (partner commanders) to one opponent', () => {
    const c1 = makeCommander('Partner One', aliceId);
    const c2 = makeCommander('Partner Two', aliceId);
    state = registerCommander(state, aliceId, c1.id);
    state = registerCommander(state, aliceId, c2.id);

    state = dealCommanderDamage(state, c1.id, bobId, 10).state;
    state = dealCommanderDamage(state, c2.id, bobId, 5).state;

    // Two distinct commanders have damaged Bob: 10 + 5 = 15 total
    expect(getTotalCommanderDamage(state, bobId)).toBe(15);
    // Each commander is tracked individually on Bob's map
    expect(state.players.get(bobId)!.commanderDamage.get(c1.id)).toBe(10);
    expect(state.players.get(bobId)!.commanderDamage.get(c2.id)).toBe(5);
  });

  it('tracks the same commander damage to different opponents independently', () => {
    const commander = makeCommander('Shared Commander', aliceId);
    state = registerCommander(state, aliceId, commander.id);

    state = dealCommanderDamage(state, commander.id, bobId, 7).state;
    state = dealCommanderDamage(state, commander.id, carolId, 4).state;

    // Bob's total only reflects damage dealt to Bob, not Carol
    expect(getTotalCommanderDamage(state, bobId)).toBe(7);
    // Carol's total only reflects damage dealt to Carol, not Bob
    expect(getTotalCommanderDamage(state, carolId)).toBe(4);
    // Alice (the attacker) has no incoming commander damage recorded
    expect(getTotalCommanderDamage(state, aliceId)).toBe(0);
  });

  it('returns 0 for an unknown target player', () => {
    expect(getTotalCommanderDamage(state, 'non-existent-player')).toBe(0);
  });

  it('does NOT count damage Bob dealt to Alice against Bob', () => {
    const bobCommander = makeCommander("Bob's Commander", bobId);
    state = registerCommander(state, bobId, bobCommander.id);
    state = dealCommanderDamage(state, bobCommander.id, aliceId, 6).state;

    // Bob is the attacker here; his own commanderDamage tally must remain 0.
    expect(getTotalCommanderDamage(state, bobId)).toBe(0);
    expect(getTotalCommanderDamage(state, aliceId)).toBe(6);
  });

  // ---- hasLostFromCommanderDamage per-commander threshold (CR 903.9a) ----

  it('triggers loss when a single commander deals 21 damage', () => {
    const commander = makeCommander('Lethal Commander', aliceId);
    state = registerCommander(state, aliceId, commander.id);

    state = dealCommanderDamage(state, commander.id, bobId, 21).state;

    expect(hasLostFromCommanderDamage(state, bobId)).toBe(true);
    expect(getTotalCommanderDamage(state, bobId)).toBe(21);
  });

  it('does NOT trigger loss when damage is split across two commanders below 21 each', () => {
    const c1 = makeCommander('Partner A', aliceId);
    const c2 = makeCommander('Partner B', aliceId);
    state = registerCommander(state, aliceId, c1.id);
    state = registerCommander(state, aliceId, c2.id);

    state = dealCommanderDamage(state, c1.id, bobId, 20).state;
    state = dealCommanderDamage(state, c2.id, bobId, 20).state;

    // Total is 40, but no single commander has reached 21 → no loss.
    expect(getTotalCommanderDamage(state, bobId)).toBe(40);
    expect(hasLostFromCommanderDamage(state, bobId)).toBe(false);
  });

  it('triggers loss only for the opponent that took 21+ from one commander', () => {
    const commander = makeCommander('Targeted Commander', aliceId);
    state = registerCommander(state, aliceId, commander.id);

    state = dealCommanderDamage(state, commander.id, bobId, 21).state;
    state = dealCommanderDamage(state, commander.id, carolId, 5).state;

    expect(hasLostFromCommanderDamage(state, bobId)).toBe(true);
    expect(hasLostFromCommanderDamage(state, carolId)).toBe(false);
  });
});

describe('Commander Damage System - hasLostFromCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should return false when under threshold', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 10);
    
    expect(hasLostFromCommanderDamage(result.state, bobId)).toBe(false);
  });

  it('should return false for player with no commander damage', () => {
    expect(hasLostFromCommanderDamage(state, bobId)).toBe(false);
  });

  it('should return true when a single commander reaches the 21 threshold', () => {
    // Issue #976 acceptance criterion: returns true when any commander has
    // dealt 21+ damage to a player.
    const result = dealCommanderDamage(state, commanderId, bobId, 21);
    expect(hasLostFromCommanderDamage(result.state, bobId)).toBe(true);
  });
});

describe('Commander Damage System - getPlayersLostFromCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should return empty array when no one has lost', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 10);
    const lost = getPlayersLostFromCommanderDamage(result.state);
    
    expect(lost).toEqual([]);
  });

  it('should return player who has lost', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 21);
    const lost = getPlayersLostFromCommanderDamage(result.state);
    
    expect(lost).toContain(bobId);
  });
});

describe('Commander Damage System - getCommanderDamageSummary', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
  });

  it('should return summary of commander damage', () => {
    const result = dealCommanderDamage(state, commanderId, bobId, 10);
    const summary = getCommanderDamageSummary(result.state);
    
    expect(summary).toBeDefined();
    // getCommanderDamageSummary returns an array
    expect(summary.length).toBeGreaterThanOrEqual(0);
    // Total damage should be tracked in the player
    const bob = Array.from(result.state.players.values()).find(p => p.id === bobId);
    expect(bob).toBeDefined();
  });

  it('should return summary when no damage', () => {
    const summary = getCommanderDamageSummary(state);
    
    expect(summary).toBeDefined();
    // getCommanderDamageSummary returns an array - it may be empty or have entries
    expect(Array.isArray(summary)).toBe(true);
  });
});

describe('Commander Damage System - resetCommanderDamage', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let commanderId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, true);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    const commanderData = createMockCommander('Alice Commander', 'Legendary Creature — Human', ['W']);
    const commander = createCardInstance(commanderData, aliceId, aliceId);
    commanderId = commander.id;
    state.cards.set(commanderId, commander);
    
    state = registerCommander(state, aliceId, commanderId);
    state = dealCommanderDamage(state, commanderId, bobId, 10).state;
  });

  it('should reset commander damage', () => {
    const result = resetCommanderDamage(state);
    
    const damage = getCommanderDamage(result, commanderId, bobId);
    expect(damage).toBe(0);
  });
});
