'use server';
/**
 * @fileOverview Heuristic Post-Game Analysis
 *
 * This module provides post-game analysis using rule-based heuristics
 * instead of AI generation. It offers insights based on game statistics
 * and established Magic principles.
 */

export interface PostGameAnalysisInput {
  gameData: {
    winner: string;
    turns: number;
    yourDeck: string[];
    opponentDeck: string;
    keyPlays?: string[];
  };
}

export interface PostGameAnalysisOutput {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  keyInsights: string[];
}

/**
 * Analyze game outcome and provide insights
 */
export async function providePostGameAnalysis(
  input: PostGameAnalysisInput
): Promise<PostGameAnalysisOutput> {
  const { gameData } = input;
  const { winner, turns } = gameData;

  const won = winner === 'you';
  const summary = won
    ? `Victory in ${turns} turns! Well-played game.`
    : `Defeat after ${turns} turns. Let's analyze what happened and improve for next time.`;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];
  const keyInsights: string[] = [];

  // Analyze game length
  if (turns <= 5) {
    if (won) {
      strengths.push('Very fast victory - excellent aggressive play');
      keyInsights.push('Your aggressive strategy was very effective');
    } else {
      weaknesses.push('Lost too quickly - need better early game');
      recommendations.push('Add more cheap interaction to stabilize early game');
      keyInsights.push('Fast defeat suggests lack of early game answers');
    }
  } else if (turns >= 15) {
    if (won) {
      strengths.push('Strong late-game performance');
      keyInsights.push('Your deck showed good inevitability in long games');
    } else {
      weaknesses.push('Struggled in long game - need better late game');
      recommendations.push('Consider adding card draw or powerful finishers');
      keyInsights.push('Long games require better card advantage and win conditions');
    }
  }

  // General recommendations based on outcome
  if (won) {
    strengths.push('Good overall gameplay and decision-making');
    recommendations.push('Continue to play to your strengths while fixing any minor issues');
  } else {
    weaknesses.push('Opponent outplayed or outmatched');
    recommendations.push('Review key decision points and consider alternative lines of play');
    recommendations.push('Analyze opponent\'s strategy and prepare for similar matchups');
  }

  // Add general Magic principles
  recommendations.push('Review your mulligan decisions - keeping good hands is crucial');
  recommendations.push('Practice combat mathematics to optimize attack/block decisions');
  recommendations.push('Study your deck\'s matchups to understand favorable and unfavorable scenarios');

  keyInsights.push('Game length provides insight into deck speed and strategy effectiveness');
  keyInsights.push('Key decision points in the game shaped the outcome - consider these for future games');

  return {
    summary,
    strengths,
    weaknesses,
    recommendations,
    keyInsights,
  };
}
