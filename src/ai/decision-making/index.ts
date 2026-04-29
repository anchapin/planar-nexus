/**
 * @fileoverview Combat AI Decision-Making System
 *
 * Exports the combat decision tree and related types for AI combat logic.
 */

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
} from "./combat-decision-tree";

export {
  predictOpponentBlocks,
  integrateBlockPredictionIntoEV,
  getArchetypeWeights,
  type OpponentArchetype,
  type BlockPrediction,
  type BlockPredictionResult,
  type ArchetypeBlockWeights,
} from "./block-prediction";

export { runAllCombatExamples, combatExamples } from "./combat-examples";
