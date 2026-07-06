import * as Comlink from "comlink";
import { evaluateGameState, quickScore } from "../game-state-evaluator";
import { detectArchetype } from "../archetype-detector";
import { calculateDeckStats } from "../archetype-signatures";
import {
  detectMissingSynergies,
  detectSynergies as runSynergyDetection,
} from "../synergy-detector";
import { evaluateTriggerChain as runTriggerChainEvaluation } from "../trigger-chain-evaluator";
import { reviewDeckHeuristic as runHeuristicDeckReview } from "@/lib/heuristic-deck-coach";
import {
  assembleStructuredAnalysis,
  formatStructuredAnalysisForLLM,
} from "../flows/coach-deck-analysis";
import type {
  AIWorkerAPI,
  AnalyzeStatePayload,
  CoachContextPayload,
  DigestedCoachContext,
  EvaluateTriggerChainPayload,
  DetectSynergiesPayload,
  ReviewDeckPayload,
} from "./worker-types";
import type { TriggerChain } from "../trigger-chain-evaluator";
import type { SynergyResult } from "../synergy-detector";
import type { DeckCard } from "@/app/actions";

/**
 * AI Web Worker Implementation
 *
 * This worker offloads heuristic calculations from the main thread
 * to maintain UI responsiveness (60fps).
 *
 * NOTE: this object is exported so unit tests can assert handler correctness
 * (incl. trigger-chain parity, #1080) without going through Comlink.
 * `Comlink.expose(aiWorker)` at the bottom is the actual worker entrypoint.
 */
export const aiWorker: AIWorkerAPI = {
  async analyzeGameState(payload: AnalyzeStatePayload) {
    // `difficulty` and `archetype` flow through so the worker result is
    // value-identical to a direct main-thread `evaluateGameState` call
    // (issue #1244). Omitted fields use the evaluator's documented defaults.
    const { gameState, playerId, difficulty, archetype } = payload;
    return evaluateGameState(gameState, playerId, difficulty, archetype);
  },

  async evaluateBoard(payload: AnalyzeStatePayload) {
    const { gameState, playerId, difficulty, archetype } = payload;
    return evaluateGameState(gameState, playerId, difficulty, archetype);
  },

  async quickScore(payload: AnalyzeStatePayload) {
    const { gameState, playerId, difficulty, archetype } = payload;
    return quickScore(gameState, playerId, difficulty, archetype);
  },

  async detectArchetype(deck: unknown[]) {
    const result = detectArchetype(deck as DeckCard[]);
    return result.primary;
  },

  async prepareCoachContext(
    payload: CoachContextPayload,
  ): Promise<DigestedCoachContext> {
    const { deck, gameState } = payload;
    const cards = (deck as DeckCard[]) || [];

    const deckSummary =
      cards.length > 0
        ? {
            totalCards: cards.reduce((sum, c) => sum + (c.count || 1), 0),
            typeCounts: cards.reduce(
              (acc, card) => {
                const type = card.type_line.split("—")[0].trim().split(" ")[0];
                acc[type] = (acc[type] || 0) + (card.count || 1);
                return acc;
              },
              {} as Record<string, number>,
            ),
            averageCmc:
              cards.length > 0
                ? cards.reduce(
                    (sum, c) => sum + (c.cmc || 0) * (c.count || 1),
                    0,
                  ) / cards.reduce((sum, c) => sum + (c.count || 1), 0)
                : 0,
            keyCards: cards
              .filter(
                (c) =>
                  (c.cmc || 0) >= 5 || c.type_line.includes("Planeswalker"),
              )
              .sort((a, b) => (b.cmc || 0) - (a.cmc || 0))
              .slice(0, 5)
              .map((c) => c.name),
            manaCurve: Array.from({ length: 8 }, (_, i) =>
              cards
                .filter(
                  (c) =>
                    (c.cmc === i || (i === 7 && (c.cmc || 0) >= 7)) &&
                    !c.type_line.includes("Land"),
                )
                .reduce((sum, c) => sum + (c.count || 1), 0),
            ),
            colors: Array.from(new Set(cards.flatMap((c) => c.colors || []))),
          }
        : undefined;

    // Issue #1236: the digest used to ship only deck stats + key cards. For
    // large/Commander decks (the default format in the hook) the route then
    // had no archetype / synergy / role / curve data to feed the model, so
    // the 100-card path received strictly weaker grounding than a 20-card
    // sketch — defeating #923. We now pre-compute the same structured
    // analysis the route would otherwise rebuild from raw cards, and ship the
    // rendered markdown block alongside the digest so the client never has to
    // re-send a 100-card payload to recover that grounding.
    //
    // We bypass the synergy worker bridge (`detectSynergiesAsync`) because
    // we ARE the worker — using the bridge would postMessage back to
    // ourselves for no reason. Direct `detectSynergies` is the same function
    // the bridge falls back to (#1079), so the result is identical.
    let structuredAnalysisText: string | undefined;
    if (cards.length > 0) {
      try {
        const archetype = detectArchetype(cards);
        const stats = calculateDeckStats(cards);
        const synergies = runSynergyDetection(cards);
        const missing = detectMissingSynergies(cards, archetype.primary);
        const analysis = assembleStructuredAnalysis(cards, {
          archetype,
          stats,
          synergies,
          missing,
        });
        structuredAnalysisText = formatStructuredAnalysisForLLM(analysis);
      } catch (error) {
        // Never fail the digest because of an analysis error — fall back to
        // the stats-only digest and let the route re-run its own pre-fetch
        // if it ever sees raw cards. Logged for observability.
        console.warn(
          "[ai-worker] structured analysis failed during digest; omitting:",
          error,
        );
        structuredAnalysisText = undefined;
      }
    }

    const gameSummary = gameState
      ? {
          turn: gameState.turnInfo?.currentTurn || 1,
          phase: gameState.turnInfo?.phase || "beginning",
          activePlayerId: gameState.turnInfo?.currentPlayer || "",
          players: Object.entries(gameState.players).map(([id, player]) => ({
            id,
            life: player.life,
            handSize: player.hand.length,
            manaAvailable: player.manaPool
              ? Object.values(player.manaPool).reduce((a, b) => a + b, 0)
              : 0,
            keyPermanents: player.battlefield
              .filter(
                (c) =>
                  (c.manaValue || 0) >= 4 ||
                  c.type === "planeswalker" ||
                  (c.keywords && c.keywords.includes("Legendary")),
              )
              .map((c) => c.name)
              .slice(0, 3),
          })),
        }
      : undefined;

    return {
      deckSummary,
      gameSummary,
      structuredAnalysisText,
      timestamp: Date.now(),
    };
  },

  /**
   * Evaluates cascade / trigger chains for a resolving stack item.
   * The pure evaluator lives in `trigger-chain-evaluator.ts` and has no
   * DOM/main-thread dependencies, so it is safe to run inside the worker.
   * Returns the exact same `TriggerChain[]` the in-thread evaluator produces.
   */
  async evaluateTriggerChain(
    payload: EvaluateTriggerChainPayload,
  ): Promise<TriggerChain[]> {
    const { stackItem, battlefield, maxDepth } = payload;
    return runTriggerChainEvaluation(stackItem, battlefield, maxDepth);
  },

  /**
   * Detects card-to-card synergies across an entire deck.
   * The pure detector lives in `synergy-detector.ts` (which only imports a
   * type and a plain-data synergy database) and has no DOM/main-thread
   * dependencies, so it is safe to run inside the worker. Returns the exact
   * same `SynergyResult[]` the in-thread detector produces.
   */
  async detectSynergies(
    payload: DetectSynergiesPayload,
  ): Promise<SynergyResult[]> {
    const { deck, minScore, maxResults } = payload;
    return runSynergyDetection(deck, minScore, maxResults);
  },

  /**
   * Runs the full heuristic deck-coach review off the main thread (#1243).
   *
   * `reviewDeckHeuristic` (in `src/lib/heuristic-deck-coach.ts`) iterates 6
   * archetype templates, runs archetype + synergy + missing-synergy detection,
   * and composes a `DeckReviewOutput`. On a 100-card deck it is comfortably
   * >50ms on the main thread, blocking the deck-coach UI. Offloading it to
   * the AI Web Worker keeps the UI responsive (roadmap Phase 32 —
   * Off-Main-Thread Intelligence).
   *
   * The heuristic engine has no DOM / main-thread dependencies (it only
   * imports the same pure archetype + synergy detectors the worker already
   * loads), so it is safe to run inside the worker. Returns the exact
   * `DeckReviewOutput` the in-thread `reviewDeckHeuristic` produces (no
   * behavior change), so callers can treat the result identically.
   */
  async reviewDeck(payload: ReviewDeckPayload): Promise<unknown> {
    const { decklist, format, cards } = payload;
    return runHeuristicDeckReview(decklist, format, cards);
  },
};

// Expose the worker API via Comlink
Comlink.expose(aiWorker);
