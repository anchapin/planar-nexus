import type { AIGameState as GameState } from "@/lib/game-state/types";
import type { DetailedEvaluation } from "@/ai/game-state-evaluator";
import type {
  CascadeContext,
  BoardPermanent,
  TriggerChain,
} from "@/ai/trigger-chain-evaluator";
import type { SynergyResult } from "@/ai/synergy-detector";
import type { DeckCard } from "@/app/actions";

/**
 * Actions that the AI Worker can perform.
 * Useful for logging, tracking, or alternative message-based implementations.
 */
export enum AIWorkerAction {
  ANALYZE_STATE = "ANALYZE_STATE",
  EVALUATE_BOARD = "EVALUATE_BOARD",
  QUICK_SCORE = "QUICK_SCORE",
  DETECT_ARCHETYPE = "DETECT_ARCHETYPE",
  PREPARE_COACH_CONTEXT = "PREPARE_COACH_CONTEXT",
  EVALUATE_TRIGGER_CHAIN = "EVALUATE_TRIGGER_CHAIN",
  DETECT_SYNERGIES = "DETECT_SYNERGIES",
}

/**
 * Payload for preparing coach context.
 */
export interface CoachContextPayload {
  deck?: unknown[];
  gameState?: GameState;
  playerId?: string;
}

/**
 * Digested context optimized for LLM consumption.
 */
export interface DigestedCoachContext {
  deckSummary?: {
    totalCards: number;
    typeCounts: Record<string, number>;
    averageCmc: number;
    keyCards: string[];
    manaCurve: number[];
    colors: string[];
  };
  gameSummary?: {
    turn: number;
    phase: string;
    activePlayerId: string;
    players: Array<{
      id: string;
      life: number;
      handSize: number;
      manaAvailable: number;
      keyPermanents: string[];
    }>;
  };
  timestamp: number;
}

/**
 * Payload for analyzing game state.
 * All fields must be transferable (no circular references).
 */
export interface AnalyzeStatePayload {
  gameState: GameState;
  playerId: string;
  difficulty?: "easy" | "medium" | "hard" | "expert";
}

/**
 * Payload for offloading cascade / trigger-chain evaluation to the worker.
 *
 * Trigger-chain evaluation is CPU-heavy (recursive chain expansion across the
 * full board) and previously ran synchronously on the main thread, causing jank
 * during AI turns. Offloading it to the AI Web Worker keeps the UI responsive
 * (issue #1080).
 *
 * All fields are structured-cloneable plain data (no class instances, no Maps
 * with non-serializable keys) so they can be posted to the worker via Comlink.
 */
export interface EvaluateTriggerChainPayload {
  stackItem: CascadeContext["stackItem"];
  battlefield: BoardPermanent[];
  maxDepth?: number;
}

/**
 * Payload for offloading deck synergy detection to the worker.
 *
 * Synergy detection (`synergy-detector.ts`) scores card-to-card synergy across
 * an entire deck and is CPU-heavy. It previously ran synchronously on the main
 * thread during deck-coach analysis, causing jank on 60+ card decks. Offloading
 * it to the AI Web Worker keeps the UI responsive (issue #1079).
 *
 * All fields are structured-cloneable plain data (a plain deck card list +
 * scoring options) so they can be posted to the worker via Comlink. The
 * detector itself has no DOM/main-thread dependencies.
 */
export interface DetectSynergiesPayload {
  deck: DeckCard[];
  minScore?: number;
  maxResults?: number;
}

/**
 * Response from the AI Worker.
 */
export interface AIWorkerResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Interface for the AI Worker API exposed via Comlink.
 * All methods are asynchronous because they cross the worker boundary.
 */
export interface AIWorkerAPI {
  /**
   * Performs a detailed evaluation of the game state.
   */
  analyzeGameState(payload: AnalyzeStatePayload): Promise<DetailedEvaluation>;

  /**
   * Evaluates the board state and returns detailed factors.
   * Alias for analyzeGameState in the current implementation.
   */
  evaluateBoard(payload: AnalyzeStatePayload): Promise<DetailedEvaluation>;

  /**
   * Returns a quick heuristic score for the game state.
   */
  quickScore(payload: AnalyzeStatePayload): Promise<number>;

  /**
   * Detects the archetype of a deck.
   * @param deck Array of card definitions or names.
   */
  detectArchetype(deck: unknown[]): Promise<string>;

  /**
   * Prepares a compact context for the AI coach.
   */
  prepareCoachContext(
    payload: CoachContextPayload,
  ): Promise<DigestedCoachContext>;

  /**
   * Evaluates cascade / triggered-ability chains that would result from a stack
   * item resolving. Offloaded from the main thread to keep AI turns responsive
   * (#1080). Returns the exact `TriggerChain[]` the in-thread evaluator would
   * produce (no behavior change), so callers can treat the result identically.
   */
  evaluateTriggerChain(
    payload: EvaluateTriggerChainPayload,
  ): Promise<TriggerChain[]>;

  /**
   * Detects card-to-card synergies across an entire deck. Offloaded from the
   * main thread to keep deck-coach analysis responsive (#1079). Returns the
   * exact `SynergyResult[]` the in-thread detector would produce (no behavior
   * change), so callers can treat the result identically.
   */
  detectSynergies(payload: DetectSynergiesPayload): Promise<SynergyResult[]>;
}
