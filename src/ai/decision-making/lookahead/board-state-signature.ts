/**
 * @fileoverview Board state signature creation and matching.
 *
 * Issue #667: Defines how to create hashable board state signatures
 * from AIGameState objects, and how to measure similarity between signatures.
 */

import type { AIGameState, AIPermanent } from "@/lib/game-state/types";
import type { BoardStateSignature, CreatureSignature } from "./types";

function createCreatureSignature(creature: AIPermanent): CreatureSignature {
  return {
    power: creature.power ?? 0,
    toughness: creature.toughness ?? 0,
    keywords: [...(creature.keywords ?? [])].sort(),
    manaValue: creature.manaValue ?? 0,
  };
}

function bucketLife(life: number): "critical" | "low" | "mid" | "high" {
  if (life <= 5) return "critical";
  if (life <= 10) return "low";
  if (life <= 15) return "mid";
  return "high";
}

function sortCreatures(creatures: CreatureSignature[]): CreatureSignature[] {
  return [...creatures].sort((a, b) => {
    if (a.power !== b.power) return b.power - a.power;
    if (a.toughness !== b.toughness) return b.toughness - a.toughness;
    return b.manaValue - a.manaValue;
  });
}

function creaturesKey(creatures: CreatureSignature[]): string {
  return creatures
    .map((c) => `${c.power}/${c.toughness}/${c.manaValue}`)
    .join(",");
}

/**
 * Create a board state signature from the current game state.
 *
 * @param gameState - Current AI game state
 * @param aiPlayerId - The AI player's ID
 * @returns A hashable board state signature
 */
export function createBoardStateSignature(
  gameState: AIGameState,
  aiPlayerId: string,
): BoardStateSignature {
  const aiPlayer = gameState.players[aiPlayerId];
  const opponent = Object.values(gameState.players).find(
    (p) => p.id !== aiPlayerId,
  );

  const aiCreatures = sortCreatures(
    (aiPlayer?.battlefield ?? [])
      .filter((p) => p.type === "creature")
      .map(createCreatureSignature),
  );

  const opponentCreatures = sortCreatures(
    (opponent?.battlefield ?? [])
      .filter((p) => p.type === "creature")
      .map(createCreatureSignature),
  );

  return {
    aiCreatures,
    opponentCreatures,
    aiLifeBucket: bucketLife(aiPlayer?.life ?? 20),
    opponentLifeBucket: bucketLife(opponent?.life ?? 20),
    aiHandSize: aiPlayer?.hand.length ?? 0,
    opponentHandEstimate: opponent ? opponent.library + opponent.hand.length : 0,
  };
}

/**
 * Compute a similarity score between two board state signatures.
 *
 * @returns A value between 0 (completely different) and 1 (identical)
 */
export function computeSignatureSimilarity(
  a: BoardStateSignature,
  b: BoardStateSignature,
): number {
  let score = 0;
  let maxScore = 0;

  maxScore += 2;
  score += a.aiLifeBucket === b.aiLifeBucket ? 1 : 0;
  score += a.opponentLifeBucket === b.opponentLifeBucket ? 1 : 0;

  maxScore += 1;
  score += a.aiCreatures.length === b.aiCreatures.length ? 1 : 0;

  maxScore += 1;
  score += a.opponentCreatures.length === b.opponentCreatures.length ? 1 : 0;

  const aiKeyA = creaturesKey(a.aiCreatures);
  const aiKeyB = creaturesKey(b.aiCreatures);
  const oppKeyA = creaturesKey(a.opponentCreatures);
  const oppKeyB = creaturesKey(b.opponentCreatures);

  maxScore += 2;
  score += aiKeyA === aiKeyB ? 1 : 0;
  score += oppKeyA === oppKeyB ? 1 : 0;

  maxScore += 1;
  score +=
    a.aiHandSize === b.aiHandSize ? 1 : Math.max(0, 1 - Math.abs(a.aiHandSize - b.aiHandSize) / 3);

  return maxScore > 0 ? score / maxScore : 0;
}
