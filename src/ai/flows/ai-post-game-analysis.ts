/**
 * @fileOverview Heuristic-powered post-game analysis system.
 *
 * Issue #446: Remove AI provider dependencies
 * Replaced Genkit-based AI flows with heuristic algorithms.
 *
 * Provides:
 * - analyzeGame - Analyzes a completed game and provides improvement suggestions
 * - identifyKeyMoments - Identifies key turning points in the game
 * - generateImprovementTips - Provides actionable improvement advice
 */

// Types for game replay data (used for type documentation)
// These interfaces describe the expected structure of replay data

import type { TurnData, GameReplay, CardSuggestion, GameAnalysisTurn } from '@/ai/types';

// Input schema for game analysis
interface GameAnalysisInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for game analysis
interface GameAnalysisOutput {
  gameSummary: string;
  keyMoments: Array<{
    turn: number;
    description: string;
    impact: 'positive' | 'negative' | 'neutral';
    alternativeAction?: string;
  }>;
  mistakes: Array<{
    turn: number;
    description: string;
    severity: 'major' | 'minor';
    suggestion: string;
  }>;
  strengths: string[];
  improvementAreas: string[];
  deckSuggestions: Array<{
    card: string;
    reason: string;
  }>;
  overallRating: number;
  tips: string[];
}

// Input schema for key moments identification
interface KeyMomentsInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for key moments
interface KeyMomentsOutput {
  moments: Array<{
    turn: number;
    description: string;
    type: 'game_change' | 'mistake' | 'great_play' | 'missed_opportunity';
    whatHappened: string;
    couldHaveHappened?: string;
  }>;
  summary: string;
}

// Input schema for quick tips
interface QuickTipsInput {
  replay: GameReplay;
  playerName: string;
}

// Output schema for quick tips
interface QuickTipsOutput {
  tips: string[];
  focusAreas: string[];
}

/**
 * Analyzes a completed game and provides comprehensive feedback.
 */
export async function analyzeGame(
  input: GameAnalysisInput
): Promise<GameAnalysisOutput> {
  const result = analyzeGameHeuristic(input);
  return result;
}

/**
 * Identifies key moments in a game that determined the outcome.
 */
export async function identifyKeyMoments(
  input: KeyMomentsInput
): Promise<KeyMomentsOutput> {
  const result = identifyKeyMomentsHeuristic(input);
  return result;
}

/**
 * Generates quick actionable tips from a game.
 */
export async function generateQuickTips(
  input: QuickTipsInput
): Promise<QuickTipsOutput> {
  const result = generateQuickTipsHeuristic(input);
  return result;
}

// Helper functions

function analyzeGameHeuristic(input: GameAnalysisInput): GameAnalysisOutput {
  const { replay, playerName } = input;

  // Analyze replay data (simplified heuristic analysis)
  const gameSummary = generateGameSummary(replay, playerName);
  const keyMoments = identifyKeyMomentsInReplay(replay, playerName);
  const mistakes = identifyMistakes(replay, playerName);
  const strengths = identifyStrengths(replay, playerName);
  const improvementAreas = identifyImprovementAreas(replay, playerName);
  const deckSuggestions = generateDeckSuggestions(replay, playerName);
  const overallRating = calculateOverallRating(replay, playerName);
  const tips = generateTips(replay, playerName);

  return {
    gameSummary,
    keyMoments,
    mistakes,
    strengths,
    improvementAreas,
    deckSuggestions,
    overallRating,
    tips,
  };
}

function identifyKeyMomentsHeuristic(input: KeyMomentsInput): KeyMomentsOutput {
  const { replay, playerName } = input;

  const moments: KeyMomentsOutput['moments'] = identifyKeyMomentsInReplay(replay, playerName).map(moment => ({
    turn: moment.turn,
    description: moment.description,
    type: moment.impact === 'positive' ? 'great_play' :
           moment.impact === 'negative' ? 'mistake' : 'missed_opportunity',
    whatHappened: moment.description,
    couldHaveHappened: moment.alternativeAction,
  }));

  const summary = `Identified ${moments.length} key moments in the game.`;

  return {
    moments,
    summary,
  };
}

function generateQuickTipsHeuristic(input: QuickTipsInput): QuickTipsOutput {
  const { replay, playerName } = input;

  const tips = generateTips(replay, playerName);
  const focusAreas = identifyImprovementAreas(replay, playerName);

  return {
    tips,
    focusAreas,
  };
}

function generateGameSummary(replay: GameReplay, playerName: string): string {
  // Simplified game summary generation
  const turns = replay.turns as GameAnalysisTurn[] || [];
  const totalTurns = turns.length;

  const playerLife = replay.playerLife as number || 20;
  const opponentLife = replay.opponentLife as number || 20;

  let summary = `Game lasted ${totalTurns} turns. `;

  if (playerLife > opponentLife) {
    summary += `${playerName} won with ${playerLife} life vs opponent's ${opponentLife} life. `;
    summary += "Strong board presence and card advantage contributed to victory.";
  } else if (playerLife < opponentLife) {
    summary += `${playerName} lost with ${playerLife} life vs opponent's ${opponentLife} life. `;
    summary += "Opponent gained advantage through tempo and pressure.";
  } else {
    summary += "Game ended in a draw.";
  }

  return summary;
}

function identifyKeyMomentsInReplay(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['keyMoments'] {
  const moments: GameAnalysisOutput['keyMoments'] = [];
  const turns = replay.turns as GameAnalysisTurn[] || [];

  turns.forEach((turn, index) => {
    // Look for significant life changes
    if (turn.lifeChanges) {
      const playerLifeChange = (turn.lifeChanges[playerName] as number) || 0;
      if (Math.abs(playerLifeChange) >= 5) {
        moments.push({
          turn: index + 1,
          description: `Significant life change: ${playerLifeChange > 0 ? '+' : ''}${playerLifeChange}`,
          impact: playerLifeChange > 0 ? 'positive' : 'negative',
          alternativeAction: "Consider preventative measures in similar situations",
        });
      }
    }

    // Look for card advantage shifts
    if (turn.cardAdvantage) {
      const playerCardAdvantage = turn.cardAdvantage[playerName] as number || 0;
      if (Math.abs(playerCardAdvantage) >= 2) {
        moments.push({
          turn: index + 1,
          description: `Card advantage shift: ${playerCardAdvantage > 0 ? '+' : ''}${playerCardAdvantage}`,
          impact: playerCardAdvantage > 0 ? 'positive' : 'negative',
          alternativeAction: "Focus on card draw and selection",
        });
      }
    }
  });

  // Limit to top 5 moments
  return moments.slice(0, 5);
}

function identifyMistakes(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['mistakes'] {
  const mistakes: GameAnalysisOutput['mistakes'] = [];
  const turns = replay.turns as GameAnalysisTurn[] || [];

  turns.forEach((turn, index) => {
    // Identify missed opportunities
    if (turn.missedOpportunities && turn.missedOpportunities[playerName]) {
      const missed = turn.missedOpportunities[playerName] as string[];
      missed.forEach((opportunity, i) => {
        mistakes.push({
          turn: index + 1,
          description: opportunity,
          severity: 'minor',
          suggestion: "Consider all available options before making decisions",
        });
      });
    }

    // Identify suboptimal plays
    if (turn.suboptimalPlays && turn.suboptimalPlays[playerName]) {
      const suboptimal = turn.suboptimalPlays[playerName] as string[];
      suboptimal.forEach((play, i) => {
        mistakes.push({
          turn: index + 1,
          description: play,
          severity: 'major',
          suggestion: "Evaluate all cards in hand and board state before acting",
        });
      });
    }
  });

  return mistakes.slice(0, 5);
}

function identifyStrengths(
  replay: GameReplay,
  playerName: string
): string[] {
  const strengths: string[] = [];

  const playerLife = replay.playerLife as number || 20;
  const opponentLife = replay.opponentLife as number || 20;

  if (playerLife > opponentLife) {
    strengths.push("Maintained healthy life total throughout the game");
  }

  const turns = (replay.turns as GameAnalysisTurn[]) || [];
  const playerCardAdvantage = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    return sum + (turn.cardAdvantage?.[playerName] || 0);
  }, 0);

  if (playerCardAdvantage > 0) {
    strengths.push("Generated card advantage through effective play");
  }

  strengths.push("Good mana management and development");

  return strengths;
}

function identifyImprovementAreas(
  replay: GameReplay,
  playerName: string
): string[] {
  const areas: string[] = [];

  const playerLife = replay.playerLife as number || 20;
  const opponentLife = replay.opponentLife as number || 20;

  if (playerLife < 15) {
    areas.push("Improve defensive strategies to preserve life total");
  }

  const turns = (replay.turns as GameAnalysisTurn[]) || [];
  const missedOpportunities = turns.reduce((count: number, turn: GameAnalysisTurn) => {
    return count + (turn.missedOpportunities?.[playerName]?.length || 0);
  }, 0);

  if (missedOpportunities > 3) {
    areas.push("Consider all available options more carefully before making decisions");
  }

  areas.push("Work on timing of spells and abilities");
  areas.push("Develop better understanding of opponent's deck");

  return areas;
}

function generateDeckSuggestions(
  replay: GameReplay,
  playerName: string
): GameAnalysisOutput['deckSuggestions'] {
  const suggestions: GameAnalysisOutput['deckSuggestions'] = [];

  const playerLife = replay.playerLife as number || 20;
  const opponentLife = replay.opponentLife as number || 20;

  if (playerLife < 15) {
    suggestions.push({
      card: "Life gain cards (e.g., lifelink creatures, healing spells)",
      reason: "To improve sustainability and survive longer games",
    });
  }

  const turns = (replay.turns as GameAnalysisTurn[]) || [];
  const averageManaCost = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    return sum + (turn.manaCost || 0);
  }, 0) / (turns.length || 1);

  if (averageManaCost > 3.5) {
    suggestions.push({
      card: "Lower-cost cards (2-3 CMC)",
      reason: "To improve curve and early-game consistency",
    });
  }

  suggestions.push({
    card: "Card draw options",
    reason: "To maintain card advantage throughout the game",
  });

  return suggestions.slice(0, 3);
}

function calculateOverallRating(
  replay: GameReplay,
  playerName: string
): number {
  const playerLife = replay.playerLife as number || 20;
  const opponentLife = replay.opponentLife as number || 20;

  let rating = 5; // Base rating

  // Adjust based on life difference
  const lifeDiff = playerLife - opponentLife;
  rating += lifeDiff * 0.2;

  // Adjust based on card advantage
  const turns = (replay.turns as GameAnalysisTurn[]) || [];
  const playerCardAdvantage = turns.reduce((sum: number, turn: GameAnalysisTurn) => {
    return sum + (turn.cardAdvantage?.[playerName] || 0);
  }, 0);
  rating += playerCardAdvantage * 0.5;

  // Ensure rating is between 1 and 10
  return Math.min(Math.max(rating, 1), 10);
}

function generateTips(
  replay: Record<string, unknown>,
  playerName: string
): string[] {
  const tips: string[] = [];

  tips.push("Always consider all cards in your hand before making a decision");
  tips.push("Pay attention to opponent's mana and possible responses");
  tips.push("Plan your turns ahead - think about what you want to accomplish");
  tips.push("Don't be afraid to take risks when the payoff is high");
  tips.push("Learn from your mistakes and analyze why a play didn't work out");

  const playerLife = replay.playerLife as number || 20;
  if (playerLife < 15) {
    tips.push("Prioritize survival over aggression when life is low");
  }

  return tips;
}
