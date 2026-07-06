import type { AIGameState as GameState } from "@/lib/game-state/types";
import type {
  DetailedEvaluation,
  DeckArchetype,
} from "@/ai/game-state-evaluator";
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
  REVIEW_DECK = "REVIEW_DECK",
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
 *
 * Issue #1236: when the deck is too large to send over the wire (Commander
 * defaults to 100 cards), the worker digest previously carried only deck stats
 * + key cards — no archetype, synergy clusters, role distribution, or gaps.
 * Because the route only computed the structured analysis from RAW cards, the
 * digest path silently received weaker grounding than a 20-card sketch,
 * defeating #923 for exactly the decks that need it most.
 *
 * The worker now pre-computes the full structured analysis alongside the
 * digest and surfaces it as {@link DigestedCoachContext.structuredAnalysisText}
 * (the same markdown block the route would otherwise rebuild from raw cards).
 * The route prefers this field over re-running its own pre-fetch when present.
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
  /**
   * Pre-rendered structured deck analysis (archetype, mana curve, role mix,
   * synergy clusters, key cards, strengths/gaps). Optional so older digests
   * remain backward-compatible — but the worker populates it whenever cards
   * are supplied (#1236).
   */
  structuredAnalysisText?: string;
  timestamp: number;
}

/**
 * Payload for analyzing game state.
 * All fields must be transferable (no circular references).
 *
 * `difficulty` and `archetype` flow through to the worker's evaluator so the
 * worker-computed result is value-identical to a direct `evaluateGameState`
 * call on the main thread (issue #1244). Omitting them keeps the historical
 * "medium / unknown" defaults — see `evaluateGameState()` in
 * `game-state-evaluator.ts`.
 */
export interface AnalyzeStatePayload {
  gameState: GameState;
  playerId: string;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  archetype?: DeckArchetype;
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
 * Per-card input accepted by the heuristic deck-coach worker payload.
 *
 * Mirrors the file-local `HeuristicCard` interface in
 * `src/lib/heuristic-deck-coach.ts`. All fields are optional except `name`
 * and `count`; the rest are best-effort metadata the heuristic engine reads
 * opportunistically. They are all structured-cloneable plain data so the
 * payload can cross the worker boundary via Comlink without surprises.
 *
 * Issue #1243: this is the wire format used when offloading the heuristic
 * deck review to the AI Web Worker.
 */
export interface HeuristicDeckCard {
  name: string;
  count: number;
  id?: string;
  cmc?: number;
  colors?: string[];
  legalities?: Record<string, string>;
  type_line?: string;
  mana_cost?: string;
  color_identity?: string[];
  oracle_text?: string;
}

/**
 * Payload for offloading the heuristic deck coach review to the worker.
 *
 * `reviewDeckHeuristic` (in `src/lib/heuristic-deck-coach.ts`) iterates 6
 * archetype templates, runs archetype + synergy + missing-synergy detection,
 * and composes a `DeckReviewOutput`. On a 100-card deck it is comfortably
 * >50ms on the main thread, blocking the deck-coach UI. Offloading it to the
 * AI Web Worker keeps the UI responsive (issue #1243, roadmap Phase 32 —
 * Off-Main-Thread Intelligence).
 *
 * All fields are structured-cloneable plain data so the payload can be posted
 * to the worker via Comlink. The heuristic engine has no DOM / main-thread
 * dependencies (it only imports the same pure archetype + synergy detectors
 * the worker already loads), so it is safe to run inside the worker.
 */
export interface ReviewDeckPayload {
  decklist: string;
  format: string;
  cards: HeuristicDeckCard[];
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
   * exact `SynergyResult[]` the in-thread detector produces (no behavior
   * change), so callers can treat the result identically.
   */
  detectSynergies(payload: DetectSynergiesPayload): Promise<SynergyResult[]>;

  /**
   * Runs the full heuristic deck-coach review off the main thread. Offloaded
   * from the deck-coach UI to eliminate >50ms long tasks on 100-card decks
   * (issue #1243, roadmap Phase 32 — Off-Main-Thread Intelligence). Returns
   * the exact `DeckReviewOutput` the in-thread `reviewDeckHeuristic` produces
   * (no behavior change), so callers can treat the result identically.
   */
  reviewDeck(payload: ReviewDeckPayload): Promise<unknown>;
}
