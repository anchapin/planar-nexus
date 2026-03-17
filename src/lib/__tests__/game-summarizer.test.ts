import { describe, it, expect } from '@jest/globals';
import { summarizeGame } from '../game-summarizer';
import { GameAction } from '../game-state/types';

describe('game-summarizer', () => {
  it('summarizes an empty game', () => {
    const summary = summarizeGame([], 'win', 'Mono-Red Burn');
    expect(summary).toBe('A game played with Mono-Red Burn ending in a win.');
  });

  it('summarizes a game with actions', () => {
    const actions: GameAction[] = [
      { type: 'play_land', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'land-1' } },
      { type: 'cast_spell', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'spell-1' } },
      { type: 'deal_damage', playerId: 'player-1', timestamp: Date.now(), data: { amount: 3, targetId: 'opponent' } },
    ];
    
    const summary = summarizeGame(actions, 'win', 'Mono-Red Burn');
    expect(summary).toContain('Victory with Mono-Red Burn!');
    expect(summary).toContain('cast 1 spell');
    expect(summary).toContain('played 1 land');
    expect(summary).toContain('dealt 3 damage');
  });

  it('summarizes a loss with multiple actions', () => {
    const actions: GameAction[] = [
      { type: 'play_land', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'land-1' } },
      { type: 'play_land', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'land-2' } },
      { type: 'cast_spell', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'spell-1' } },
      { type: 'cast_spell', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'spell-2' } },
      { type: 'activate_ability', playerId: 'player-1', timestamp: Date.now(), data: { cardId: 'spell-1' } },
      { type: 'gain_life', playerId: 'player-1', timestamp: Date.now(), data: { amount: 5, targetId: 'player-1' } },
    ];
    
    const summary = summarizeGame(actions, 'loss', 'Lifegain');
    expect(summary).toContain('Defeat with Lifegain.');
    expect(summary).toContain('cast 2 spells');
    expect(summary).toContain('played 2 lands');
    expect(summary).toContain('activated 1 ability');
    expect(summary).toContain('gained 5 life');
  });
});
