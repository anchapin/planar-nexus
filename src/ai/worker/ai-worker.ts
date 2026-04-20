import * as Comlink from "comlink";
import { evaluateGameState, quickScore } from "../game-state-evaluator";
import { detectArchetype } from "../archetype-detector";
import type {
  AIWorkerAPI,
  AnalyzeStatePayload,
  CoachContextPayload,
  DigestedCoachContext,
} from "./worker-types";
import type { DeckCard } from "@/app/actions";

/**
 * AI Web Worker Implementation
 *
 * This worker offloads heuristic calculations from the main thread
 * to maintain UI responsiveness (60fps).
 */
const aiWorker: AIWorkerAPI = {
  async analyzeGameState(payload: AnalyzeStatePayload) {
    const { gameState, playerId } = payload;
    return evaluateGameState(gameState, playerId);
  },

  async evaluateBoard(payload: AnalyzeStatePayload) {
    const { gameState, playerId } = payload;
    return evaluateGameState(gameState, playerId);
  },

  async quickScore(payload: AnalyzeStatePayload) {
    const { gameState, playerId } = payload;
    return quickScore(gameState, playerId);
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
      timestamp: Date.now(),
    };
  },
};

// Expose the worker API via Comlink
Comlink.expose(aiWorker);
