/**
 * @fileoverview Public API for multi-turn lookahead / forward board-state planning.
 *
 * Issue #667: Wires the lookahead engine into the combat decision tree and
 * AI difficulty system. Provides a single entry point for integrating
 * multi-turn planning into existing combat decisions.
 */

export { LookaheadEngine } from "./lookahead-engine";
export { HeuristicTable } from "./heuristic-table";
export {
  createBoardStateSignature,
  computeSignatureSimilarity,
} from "./board-state-signature";
export type {
  BoardStateSignature,
  CreatureSignature,
  AttackLineHeuristic,
  HeuristicMatch,
  ProjectedBoardState,
  LookaheadConfig,
  LookaheadResult,
} from "./types";
