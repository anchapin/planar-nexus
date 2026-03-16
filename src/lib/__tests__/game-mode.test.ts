/**
 * Game mode tests
 */

import { GAME_MODES, getGameModeForPlayerCount, getGameModeConfig, type GameMode } from '../game-mode';

describe('GAME_MODES', () => {
  it('should have 1v1 mode', () => {
    expect(GAME_MODES['1v1']).toBeDefined();
  });

  it('should have commander-1v1 mode', () => {
    expect(GAME_MODES['commander-1v1']).toBeDefined();
  });
});

describe('getGameModeForPlayerCount', () => {
  it('should return a game mode for 2 players', () => {
    const mode = getGameModeForPlayerCount(2, 'standard');
    expect(mode).toBeDefined();
  });

  it('should return a game mode for 4 players', () => {
    const mode = getGameModeForPlayerCount(4, 'commander');
    expect(mode).toBeDefined();
  });
});

describe('getGameModeConfig', () => {
  it('should return config for 1v1', () => {
    const config = getGameModeConfig('1v1');
    expect(config).toBeDefined();
  });
});
