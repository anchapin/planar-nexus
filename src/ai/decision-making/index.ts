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
  ARCHETYPE_COMBAT_MODIFIERS,
  deckArchetypeToOpponentArchetype,
  inferOpponentArchetype,
  type CombatAIConfig,
  type AttackDecision,
  type BlockDecision,
  type CombatPlan,
  type CombatTrick,
  type DeckArchetype,
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

// Issue #1234: commander tax + opposing-commander threat tracking.
export {
  KNOWN_VOLTRON_COMMANDERS,
  computeCommanderTax,
  shouldCastCommander,
  opposingCommanderThreat,
  commanderStateFromPlayer,
  type CommanderState,
  type CastCommanderDecision,
  type OpposingCommanderThreatInput,
} from "./commander-math";
