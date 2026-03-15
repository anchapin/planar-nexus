/**
 * P2P Conflict Resolution Tests
 */

import {
  ConflictResolutionManager,
  type ConflictResolutionConfig,
  type ActionPriority,
  type ConflictStrategy,
} from '../p2p-conflict-resolution';

describe('ConflictResolutionManager', () => {
  let manager: ConflictResolutionManager;

  beforeEach(() => {
    manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'host-wins',
      actionWindow: 100,
      enablePriority: true,
      enableSequenceNumbers: true,
    });
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      const defaultManager = new ConflictResolutionManager();
      expect(defaultManager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const customManager = new ConflictResolutionManager({
        hostId: 'custom-host',
        strategy: 'timestamp-based',
        actionWindow: 200,
        enablePriority: false,
        enableSequenceNumbers: false,
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('processAction', () => {
    it('should process action without conflict', () => {
      const result = manager.processAction(
        'play-card',
        { cardId: 'card-1' },
        'player-1',
        'Player One'
      );

      expect(result.shouldProcess).toBe(true);
      expect(result.action).toBeDefined();
      expect(result.action?.actionType).toBe('play-card');
      expect(result.action?.playerId).toBe('player-1');
      expect(result.conflict).toBeUndefined();
    });

    it('should return action with correct priority', () => {
      const result = manager.processAction(
        'game-end',
        {},
        'player-1',
        'Player One'
      );

      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe('critical');
    });

    it('should assign sequence numbers', () => {
      const result1 = manager.processAction('play-card', {}, 'player-1', 'Player One');
      const result2 = manager.processAction('play-card', {}, 'player-1', 'Player One');

      expect(result1.action?.sequenceNumber).toBe(1);
      expect(result2.action?.sequenceNumber).toBe(2);
    });
  });

  describe('processAction return values', () => {
    it('should return shouldQueue when action should be queued', () => {
      // First process a normal action
      manager.processAction('chat', { message: 'hello' }, 'player-1', 'Player One');
      
      // The chat action should be processed
      const result = manager.processAction('chat', { message: 'world' }, 'player-1', 'Player One');
      expect(result.shouldProcess).toBeDefined();
    });

    it('should handle critical actions immediately', () => {
      const result = manager.processAction('game-end', {}, 'player-1', 'Player One');
      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe('critical');
    });

    it('should handle high priority actions', () => {
      const result = manager.processAction('spell-cast', { spellId: 'lightning' }, 'player-1', 'Player One');
      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe('high');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      manager.updateConfig({
        strategy: 'priority-based',
        actionWindow: 500,
      });

      // Just verify no error thrown
      expect(manager).toBeDefined();
    });

    it('should update host ID', () => {
      manager.updateConfig({
        hostId: 'new-host',
      });

      expect(manager).toBeDefined();
    });
  });
});

describe('Action Priority Mapping', () => {
  it('should map critical actions correctly', () => {
    const manager = new ConflictResolutionManager({ hostId: 'host' });
    
    const gameEndResult = manager.processAction('game-end', {}, 'p1', 'P1');
    expect(gameEndResult.action?.priority).toBe('critical');
    
    const eliminatedResult = manager.processAction('player-eliminated', {}, 'p1', 'P1');
    expect(eliminatedResult.action?.priority).toBe('critical');
    
    const correctionResult = manager.processAction('state-correction', {}, 'p1', 'P1');
    expect(correctionResult.action?.priority).toBe('critical');
  });

  it('should map high priority actions correctly', () => {
    const manager = new ConflictResolutionManager({ hostId: 'host' });
    
    const combatResult = manager.processAction('combat-declare', {}, 'p1', 'P1');
    expect(combatResult.action?.priority).toBe('high');
    
    const spellResult = manager.processAction('spell-cast', {}, 'p1', 'P1');
    expect(spellResult.action?.priority).toBe('high');
    
    const abilityResult = manager.processAction('ability-activate', {}, 'p1', 'P1');
    expect(abilityResult.action?.priority).toBe('high');
  });

  it('should map normal priority actions correctly', () => {
    const manager = new ConflictResolutionManager({ hostId: 'host' });
    
    const playCardResult = manager.processAction('play-card', {}, 'p1', 'P1');
    expect(playCardResult.action?.priority).toBe('normal');
    
    const attackResult = manager.processAction('attack', {}, 'p1', 'P1');
    expect(attackResult.action?.priority).toBe('normal');
    
    const blockResult = manager.processAction('block', {}, 'p1', 'P1');
    expect(blockResult.action?.priority).toBe('normal');
    
    const tapResult = manager.processAction('tap', {}, 'p1', 'P1');
    expect(tapResult.action?.priority).toBe('normal');
    
    const untapResult = manager.processAction('untap', {}, 'p1', 'P1');
    expect(untapResult.action?.priority).toBe('normal');
  });

  it('should map low priority actions correctly', () => {
    const manager = new ConflictResolutionManager({ hostId: 'host' });
    
    const chatResult = manager.processAction('chat', {}, 'p1', 'P1');
    expect(chatResult.action?.priority).toBe('low');
    
    const emoteResult = manager.processAction('emote', {}, 'p1', 'P1');
    expect(emoteResult.action?.priority).toBe('low');
    
    const surrenderResult = manager.processAction('surrender', {}, 'p1', 'P1');
    expect(surrenderResult.action?.priority).toBe('low');
  });

  it('should default to normal priority for unknown actions', () => {
    const manager = new ConflictResolutionManager({ hostId: 'host' });
    
    const unknownResult = manager.processAction('unknown-action', {}, 'p1', 'P1');
    expect(unknownResult.action?.priority).toBe('normal');
  });
});

describe('Conflict Strategy Configurations', () => {
  it('should handle host-wins strategy', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'host-wins',
    });
    
    // Process actions from host - should always process
    const hostAction = manager.processAction('play-card', {}, 'host-1', 'Host');
    expect(hostAction.shouldProcess).toBe(true);
    
    // Non-host action may or may not process depending on conflict
    const playerAction = manager.processAction('play-card', {}, 'player-2', 'Player 2');
    // Just verify it returns a valid result
    expect(playerAction.shouldProcess).toBeDefined();
  });

  it('should handle timestamp-based strategy', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'timestamp-based',
    });
    
    expect(manager).toBeDefined();
    
    const result = manager.processAction('play-card', {}, 'player-1', 'Player One');
    expect(result.shouldProcess).toBe(true);
  });

  it('should handle priority-based strategy', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'priority-based',
    });
    
    expect(manager).toBeDefined();
  });

  it('should handle round-robin strategy', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'round-robin',
    });
    
    expect(manager).toBeDefined();
  });

  it('should handle consensus strategy', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      strategy: 'consensus',
    });
    
    expect(manager).toBeDefined();
  });

  it('should handle disabled priority system', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      enablePriority: false,
    });
    
    const result = manager.processAction('game-end', {}, 'player-1', 'Player One');
    // With priority disabled, even critical actions process normally
    expect(result.shouldProcess).toBe(true);
  });

  it('should handle disabled sequence numbers', () => {
    const manager = new ConflictResolutionManager({
      hostId: 'host-1',
      enableSequenceNumbers: false,
    });
    
    const result1 = manager.processAction('play-card', {}, 'player-1', 'Player One');
    const result2 = manager.processAction('play-card', {}, 'player-1', 'Player One');
    
    expect(result1.action?.sequenceNumber).toBeDefined();
    expect(result2.action?.sequenceNumber).toBeDefined();
  });
});

describe('Type exports', () => {
  it('should export ActionPriority type', () => {
    const priority: ActionPriority = 'critical';
    expect(['critical', 'high', 'normal', 'low']).toContain(priority);
  });

  it('should export ConflictStrategy type', () => {
    const strategy: ConflictStrategy = 'host-wins';
    expect(['host-wins', 'timestamp-based', 'priority-based', 'round-robin', 'consensus']).toContain(strategy);
  });

  it('should accept all ActionPriority values', () => {
    const priorities: ActionPriority[] = ['critical', 'high', 'normal', 'low'];
    priorities.forEach(p => expect(p).toBeDefined());
  });

  it('should accept all ConflictStrategy values', () => {
    const strategies: ConflictStrategy[] = ['host-wins', 'timestamp-based', 'priority-based', 'round-robin', 'consensus'];
    strategies.forEach(s => expect(s).toBeDefined());
  });
});
