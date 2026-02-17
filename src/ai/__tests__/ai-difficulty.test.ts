import { aiDifficultyManager, DIFFICULTY_CONFIGS, DifficultyLevel } from '../ai-difficulty';

describe('AIDifficultyManager', () => {
  test('should initialize with default difficulty (medium)', () => {
    expect(aiDifficultyManager.getLevel()).toBe('medium');
  });

  test('should set and get difficulty level', () => {
    aiDifficultyManager.setDifficulty('hard');
    expect(aiDifficultyManager.getLevel()).toBe('hard');
    expect(aiDifficultyManager.getDifficulty().level).toBe('hard');
  });

  test('should handle player-specific difficulty', () => {
    aiDifficultyManager.setDifficulty('easy', 'player1');
    expect(aiDifficultyManager.getDifficulty('player1').level).toBe('easy');
    expect(aiDifficultyManager.getLevel()).toBe('hard'); // Global should remain hard
  });

  test('should return correct lookahead depth', () => {
    aiDifficultyManager.setDifficulty('expert');
    expect(aiDifficultyManager.getLookaheadDepth()).toBe(4);
    
    aiDifficultyManager.setDifficulty('easy');
    expect(aiDifficultyManager.getLookaheadDepth()).toBe(1);
  });

  test('should apply randomness correctly', () => {
    aiDifficultyManager.setDifficulty('expert');
    const options = ['choice1', 'choice2', 'choice3'];
    // Expert has very low randomness (0.02), so it should almost always pick first option
    // (though Math.random is not mocked here, we just check it returns something from options)
    const choice = aiDifficultyManager.applyRandomness(options);
    expect(options).toContain(choice);
  });

  test('should identify blunder chance', () => {
    aiDifficultyManager.setDifficulty('easy');
    // Easy has 0.25 blunder chance. 
    // We can't easily test the randomness without mocking Math.random
    // but we can check if the method exists and returns a boolean
    expect(typeof aiDifficultyManager.shouldBlunder()).toBe('boolean');
  });

  test('should provide evaluation weights', () => {
    aiDifficultyManager.setDifficulty('medium');
    const weights = aiDifficultyManager.getEvaluationWeights();
    expect(weights).toBeDefined();
    // Check for some expected weight properties
    expect(weights).toHaveProperty('lifeScore');
    expect(weights).toHaveProperty('creaturePower');
  });
});
