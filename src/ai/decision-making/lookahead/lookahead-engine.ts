/**
 * @fileoverview Multi-turn lookahead engine for forward board-state planning.
 *
 * Issue #667: Simulates future board states to evaluate combat decisions
 * beyond the current turn. Combines heuristic table matching with projected
 * board evaluation to adjust aggression weights in ai-difficulty.ts.
 */

import type { AIGameState, AIPermanent } from "@/lib/game-state/types";
import type {
  BoardStateSignature,
  HeuristicMatch,
  LookaheadConfig,
  LookaheadResult,
  ProjectedBoardState,
} from "./types";
import { createBoardStateSignature } from "./board-state-signature";
import { HeuristicTable } from "./heuristic-table";

const DEFAULT_CONFIG: LookaheadConfig = {
  maxDepth: 2,
  branchingFactor: 3,
  heuristicWeight: 0.4,
  minMatchQuality: 0.3,
  enabled: true,
};

/**
 * Multi-turn lookahead engine.
 *
 * Evaluates combat decisions by projecting future board states and
 * combining heuristic table matches with forward-looking damage/advantage
 * calculations.
 */
export class LookaheadEngine {
  private config: LookaheadConfig;
  private heuristicTable: HeuristicTable;

  constructor(
    heuristicTable: HeuristicTable,
    config?: Partial<LookaheadConfig>,
  ) {
    this.heuristicTable = heuristicTable;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update the lookahead configuration.
   */
  setConfig(config: Partial<LookaheadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): LookaheadConfig {
    return { ...this.config };
  }

  /**
   * Evaluate the current board state with multi-turn lookahead.
   *
   * Returns adjustments to be applied to combat decisions:
   * - aggressionModifier: shift the aggression weight
   * - priorityAttackers: creatures to prefer attacking with
   * - holdBack: creatures to prefer holding back
   * - lethalFound: whether a lethal line exists within the window
   *
   * @param gameState - Current game state
   * @param aiPlayerId - The AI player's ID
   * @returns Lookahead evaluation result
   */
  evaluate(
    gameState: AIGameState,
    aiPlayerId: string,
  ): LookaheadResult {
    if (!this.config.enabled) {
      return this.noLookaheadResult();
    }

    const signature = createBoardStateSignature(gameState, aiPlayerId);
    const match = this.matchHeuristics(signature);

    const projections = this.projectBoardStates(
      gameState,
      aiPlayerId,
      this.config.maxDepth,
      this.config.branchingFactor,
    );

    const boardScore = this.evaluateProjections(projections, aiPlayerId);

    const heuristicModifier = match.aggressionModifier * this.config.heuristicWeight;
    const boardModifier = this.computeBoardScoreModifier(boardScore);
    const combinedModifier = heuristicModifier + boardModifier * (1 - this.config.heuristicWeight);

    const lethal = projections.find((p) => p.hasLethal);
    const opponentLethal = projections.find((p) => p.opponentHasLethal);

    const turnsToLethal = lethal
      ? lethal.turnsAhead
      : opponentLethal
        ? -opponentLethal.turnsAhead
        : 0;

    return {
      evaluated: true,
      bestScore: boardScore.bestScore,
      worstScore: boardScore.worstScore,
      aggressionModifier: combinedModifier,
      priorityAttackers: match.priorityAttackers,
      holdBack: match.holdBack,
      lethalFound: lethal !== undefined,
      opponentLethalRisk: opponentLethal !== undefined,
      turnsToLethal: turnsToLethal > 0 ? turnsToLethal : Infinity,
    };
  }

  /**
   * Match the current board state against the heuristic table.
   */
  private matchHeuristics(signature: BoardStateSignature): HeuristicMatch {
    const matches = this.heuristicTable.lookup(
      signature,
      this.config.minMatchQuality,
    );

    if (matches.length === 0) {
      return {
        heuristic: null,
        matchQuality: 0,
        aggressionModifier: 0,
        priorityAttackers: [],
        holdBack: [],
      };
    }

    const bestMatch = matches.reduce((best, h) => {
      const relevance = this.computeHeuristicRelevance(h, signature);
      return relevance > best.relevance
        ? { heuristic: h, relevance }
        : best;
    }, { heuristic: matches[0], relevance: 0 });

    return {
      heuristic: bestMatch.heuristic,
      matchQuality: bestMatch.relevance,
      aggressionModifier: bestMatch.heuristic.aggressionModifier,
      priorityAttackers: bestMatch.heuristic.priorityAttackers,
      holdBack: bestMatch.heuristic.holdBack,
    };
  }

  /**
   * Compute relevance score for a specific heuristic against the current signature.
   * Uses keyword overlap and power proximity.
   */
  private computeHeuristicRelevance(
    heuristic: { signature: BoardStateSignature; confidence: number },
    current: BoardStateSignature,
  ): number {
    const hs = heuristic.signature;
    let score = 0;
    let maxScore = 0;

    maxScore += 1;
    if (hs.aiLifeBucket === current.aiLifeBucket) score += 1;
    maxScore += 1;
    if (hs.opponentLifeBucket === current.opponentLifeBucket) score += 1;

    maxScore += 0.5;
    if (hs.aiCreatures.length === 0 && current.aiCreatures.length === 0) {
      score += 0.5;
    } else {
      const diff = Math.abs(hs.aiCreatures.length - current.aiCreatures.length);
      score += Math.max(0, 0.5 - diff * 0.15);
    }

    maxScore += 0.5;
    if (hs.opponentCreatures.length === 0 && current.opponentCreatures.length === 0) {
      score += 0.5;
    } else {
      const diff = Math.abs(hs.opponentCreatures.length - current.opponentCreatures.length);
      score += Math.max(0, 0.5 - diff * 0.15);
    }

    const aiPower = current.aiCreatures.reduce((s, c) => s + c.power, 0);
    const oppPower = current.opponentCreatures.reduce((s, c) => s + c.power, 0);
    const aiLife = current.aiLifeBucket === "critical" ? 3 : current.aiLifeBucket === "low" ? 8 : current.aiLifeBucket === "mid" ? 13 : 20;
    const oppLife = current.opponentLifeBucket === "critical" ? 3 : current.opponentLifeBucket === "low" ? 8 : current.opponentLifeBucket === "mid" ? 13 : 20;

    const turnsToKillOpponent = oppLife > 0 ? Math.ceil(oppLife / Math.max(aiPower, 1)) : 99;
    const turnsForOpponentToKill = aiLife > 0 ? Math.ceil(aiLife / Math.max(oppPower, 1)) : 99;

    maxScore += 0.5;
    if (turnsToKillOpponent <= 2 && turnsForOpponentToKill > 2) {
      score += 0.5;
    } else if (turnsForOpponentToKill <= 2 && turnsToKillOpponent > 2) {
      score += 0.1;
    } else {
      score += 0.25;
    }

    const rawScore = maxScore > 0 ? score / maxScore : 0;
    return rawScore * heuristic.confidence;
  }

  /**
   * Project future board states by simulating combat outcomes.
   */
  private projectBoardStates(
    gameState: AIGameState,
    aiPlayerId: string,
    maxDepth: number,
    branchingFactor: number,
  ): ProjectedBoardState[] {
    const projections: ProjectedBoardState[] = [];
    const aiPlayer = gameState.players[aiPlayerId];
    const opponent = Object.values(gameState.players).find(
      (p) => p.id !== aiPlayerId,
    );

    if (!aiPlayer || !opponent) return projections;

    const aiCreatures = aiPlayer.battlefield.filter(
      (p) => p.type === "creature" && !p.tapped,
    );
    const oppCreatures = opponent.battlefield.filter(
      (p) => p.type === "creature",
    );
    const aiPower = aiCreatures.reduce((s, c) => s + (c.power ?? 0), 0);
    const oppPower = oppCreatures.reduce((s, c) => s + (c.power ?? 0), 0);

    for (let turn = 1; turn <= maxDepth; turn++) {
      for (let branch = 0; branch < branchingFactor; branch++) {
        const probability = 1 / (turn * branchingFactor);
        const damageToOpponent = this.estimateDamageToOpponent(
          aiPower,
          oppCreatures,
          turn,
          branch,
        );
        const damageToAI = this.estimateDamageToAI(
          oppPower,
          aiCreatures,
          turn,
          branch,
        );

        const futureOppLife = opponent.life - damageToOpponent;
        const futureAILife = aiPlayer.life - damageToAI;
        const boardDelta = this.estimateBoardAdvantageDelta(
          aiCreatures,
          oppCreatures,
          turn,
          branch,
        );

        projections.push({
          gameState: this.createProjectedGameState(
            gameState,
            aiPlayerId,
            Math.max(0, futureAILife),
            Math.max(0, futureOppLife),
            boardDelta,
          ),
          turnsAhead: turn,
          probability,
          projectedDamageToOpponent: damageToOpponent,
          projectedDamageToAI: damageToAI,
          boardAdvantageDelta: boardDelta,
          hasLethal: futureOppLife <= 0,
          opponentHasLethal: futureAILife <= 0,
        });
      }
    }

    return projections;
  }

  /**
   * Estimate damage dealt to opponent across projected turns.
   */
  private estimateDamageToOpponent(
    aiPower: number,
    oppBlockers: AIPermanent[],
    turn: number,
    branch: number,
  ): number {
    const blockedRatio = 0.3 + (branch * 0.2);
    const blocked = oppBlockers.length > 0 ? blockedRatio : 0;
    const unblockedDamage = aiPower * (1 - blocked);
    return Math.round(unblockedDamage * turn);
  }

  /**
   * Estimate damage received from opponent across projected turns.
   */
  private estimateDamageToAI(
    oppPower: number,
    aiBlockers: AIPermanent[],
    turn: number,
    branch: number,
  ): number {
    const blockRatio = 0.2 + (branch * 0.15);
    const blocked = aiBlockers.length > 0 ? blockRatio : 0;
    const unblockedDamage = oppPower * (1 - blocked);
    return Math.round(unblockedDamage * turn);
  }

  /**
   * Estimate net board advantage change across projected turns.
   */
  private estimateBoardAdvantageDelta(
    aiCreatures: AIPermanent[],
    oppCreatures: AIPermanent[],
    turn: number,
    branch: number,
  ): number {
    const tradeChance = 0.1 + branch * 0.1;
    const trades = Math.min(aiCreatures.length, oppCreatures.length);
    const expectedTrades = trades * tradeChance * turn;
    return Math.round((aiCreatures.length - oppCreatures.length - expectedTrades) * turn * 0.5);
  }

  /**
   * Create a projected game state for future evaluation.
   */
  private createProjectedGameState(
    current: AIGameState,
    aiPlayerId: string,
    futureAILife: number,
    futureOppLife: number,
    boardDelta: number,
  ): AIGameState {
    const projected = JSON.parse(JSON.stringify(current)) as AIGameState;

    projected.players[aiPlayerId].life = futureAILife;
    const opponentId = Object.keys(projected.players).find(
      (id) => id !== aiPlayerId,
    );
    if (opponentId) {
      projected.players[opponentId].life = futureOppLife;
    }

    projected.turnInfo.currentTurn += 1;

    if (boardDelta < 0) {
      const aiBattlefield = projected.players[aiPlayerId].battlefield;
      const creaturesToRemove = Math.min(
        Math.abs(boardDelta),
        aiBattlefield.filter((p) => p.type === "creature").length,
      );
      let removed = 0;
      projected.players[aiPlayerId].battlefield = aiBattlefield.filter((p) => {
        if (p.type === "creature" && removed < creaturesToRemove) {
          removed++;
          return false;
        }
        return true;
      });
    }

    return projected;
  }

  /**
   * Evaluate all projections and return best/worst scores.
   */
  private evaluateProjections(
    projections: ProjectedBoardState[],
    aiPlayerId: string,
  ): { bestScore: number; worstScore: number } {
    if (projections.length === 0) {
      return { bestScore: 0, worstScore: 0 };
    }

    let bestScore = -Infinity;
    let worstScore = Infinity;

    for (const proj of projections) {
      const score = this.scoreProjection(proj, aiPlayerId);
      if (score > bestScore) bestScore = score;
      if (score < worstScore) worstScore = score;
    }

    return {
      bestScore: Math.max(0, bestScore),
      worstScore: Math.max(0, worstScore),
    };
  }

  /**
   * Score a single projected board state.
   */
  private scoreProjection(
    proj: ProjectedBoardState,
    aiPlayerId: string,
  ): number {
    const aiPlayer = proj.gameState.players[aiPlayerId];
    const opponent = Object.values(proj.gameState.players).find(
      (p) => p.id !== aiPlayerId,
    );

    if (!aiPlayer || !opponent) return 0;

    let score = 0;

    score += (opponent.life - aiPlayer.life) * 0.05;

    if (proj.hasLethal) score += 10;
    if (proj.opponentHasLethal) score -= 10;

    score += proj.boardAdvantageDelta * 0.3;

    const aiCreatures = aiPlayer.battlefield.filter(
      (p) => p.type === "creature",
    ).length;
    const oppCreatures = opponent.battlefield.filter(
      (p) => p.type === "creature",
    ).length;
    score += (aiCreatures - oppCreatures) * 0.2;

    return score * proj.probability;
  }

  /**
   * Compute a modifier from board score evaluation.
   */
  private computeBoardScoreModifier(boardScore: {
    bestScore: number;
    worstScore: number;
  }): number {
    const spread = boardScore.bestScore - boardScore.worstScore;
    if (spread > 5) return 0.3;
    if (spread > 2) return 0.15;
    if (boardScore.bestScore > 3) return 0.2;
    if (boardScore.worstScore < -3) return -0.3;
    return 0;
  }

  /**
   * Return a default no-lookahead result.
   */
  private noLookaheadResult(): LookaheadResult {
    return {
      evaluated: false,
      bestScore: 0,
      worstScore: 0,
      aggressionModifier: 0,
      priorityAttackers: [],
      holdBack: [],
      lethalFound: false,
      opponentLethalRisk: false,
      turnsToLethal: Infinity,
    };
  }
}
