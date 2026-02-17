/**
 * @fileoverview AI System Index
 *
 * Central exports for the Planar Nexus AI system, including:
 * - Game state evaluation
 * - Combat decision-making
 * - Main phase decision-making (future)
 */

// Game State Evaluator
export {
  GameStateEvaluator,
  evaluateGameState,
  compareGameStates,
  quickScore,
  DefaultWeights,
  type GameState,
  type PlayerState,
  type Permanent,
  type HandCard,
  type TurnInfo,
  type ThreatAssessment,
  type OpportunityAssessment,
  type EvaluationWeights,
  type DetailedEvaluation,
} from './game-state-evaluator';

// Examples
export {
  runAllExamples,
  examples,
  sampleStates,
} from './game-state-evaluator-example';

// Combat Decision Making
export {
  CombatDecisionTree,
  generateAttackDecisions,
  generateBlockingDecisions,
  DefaultCombatConfigs,
  type CombatAIConfig,
  type AttackDecision,
  type BlockDecision,
  type CombatPlan,
  type CombatTrick,
} from './decision-making/combat-decision-tree';

// Combat Examples
export {
  runAllCombatExamples,
  combatExamples,
} from './decision-making/combat-examples';

// Combat Validation Tests
export {
  runAllCombatValidationTests,
  combatValidationTests,
} from './decision-making/__tests__/combat-ai.validation';

// AI Difficulty Tuning
export {
  AIDifficultyManager,
  aiDifficultyManager,
  DIFFICULTY_CONFIGS,
  getDifficultyConfig,
  isValidDifficulty,
  type AIDifficultyConfig,
  type DifficultyLevel,
} from './ai-difficulty';
