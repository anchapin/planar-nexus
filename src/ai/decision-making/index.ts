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

// Issue #1233: multiplayer threat assessment for 2-4 player pods.
export {
  assessThreats,
  chooseAttackTarget,
  chooseResponseTarget,
  _buildFixtureState,
  type MultiplayerThreatAssessment,
  type ChooseAttackTargetOptions,
  type AttackTargetDecision,
  type ChooseResponseTargetOptions,
  type ResponseTargetDecision,
} from "./multiplayer-threat";

// Issue #1232: opponent combo-assembly detection across turns.
// Drives the lookahead engine's "spot the Thassa's Oracle / Kiki combo
// and pressure it before it resolves" behaviour. Re-export the
// detector, threat shapes, and per-tier depth table so the live turn
// loop can wire the replay sink without dipping into the module path.
export {
  detectComboAssembly,
  detectComboFromNames,
  isImminentComboThreat,
  comboThreatUrgency,
  detectionDepthForTier,
  comboDetectionDepthForArchetype,
  COMBO_PATTERNS,
  COMBO_IMMINENT_MANA,
  type ComboThreatAssessment,
  type DetectComboOptions,
} from "./combo-threat-detector";

// Issue #1231: tutor / library-search target selection scaled by difficulty.
export {
  selectTutorTarget,
  scoreTutorCandidate,
  isTutorOracle,
  ARCHETYPE_TUTOR_WEIGHTS,
  UNKNOWN_ARCHETYPE_WEIGHTS,
  DIFFICULTY_NOISE,
  type TutorCandidate,
  type TutorTargetContext,
  type TutorTargetDecision,
  type ScoredTutorCandidate,
  type TutorRng,
} from "./tutor-decision";
