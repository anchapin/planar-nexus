/**
 * @fileoverview Shared TypeScript types for AI flows
 * 
 * This file defines common types used across AI flow helper functions
 * to eliminate `any` types and improve type safety.
 */

/** Basic card representation */
export interface Card {
  name: string;
  type_line?: string;
  cmc?: number;
  colors?: string[];
  power?: number;
  toughness?: number;
  [key: string]: unknown;
}

/** Game state representation */
export interface GameState {
  hand?: Card[];
  board?: Card[];
  opponentBoard?: Card[];
  life?: number;
  opponentLife?: number;
  availableMana?: {
    total: number;
    colored: Record<string, number>;
    colorless: number;
  };
  usedMana?: number;
  [key: string]: unknown;
}

/** Evaluation result from game state evaluator */
export interface GameEvaluation {
  totalScore: number;
  factors: {
    lifeScore: number;
    poisonScore: number;
    cardAdvantage: number;
    handQuality: number;
    libraryDepth: number;
    creaturePower: number;
    creatureToughness: number;
    creatureCount: number;
    permanentAdvantage: number;
    manaAvailable: number;
    tempoAdvantage: number;
    commanderDamage: number;
    commanderPresence: number;
    cardSelection: number;
    graveyardValue: number;
    synergy: number;
    winConditionProgress: number;
    inevitability: number;
  };
  threats?: unknown[];
  opportunities?: unknown[];
  recommendedActions?: string[];
}

/** Draft card pool entry */
export interface DraftCard {
  name: string;
  colors?: string[];
  cmc?: number;
  type?: string;
  [key: string]: unknown;
}

/** Turn data for post-game analysis */
export interface TurnData {
  turnNumber: number;
  player?: string;
  cardsDrawn?: number;
  cardsPlayed?: number;
  manaUsed?: number;
  lifeChange?: number;
  actions?: Array<{
    type: string;
    description: string;
  }>;
  [key: string]: unknown;
}

/** Extended turn data for game analysis with additional metrics */
export interface GameAnalysisTurn extends TurnData {
  lifeChanges?: Record<string, number>;
  missedOpportunities?: Record<string, unknown[]>;
  suboptimalPlays?: Record<string, string[]>;
  cardAdvantage?: Record<string, number>;
  manaCost?: number;
  [key: string]: unknown;
}

/** Game replay data */
export interface GameReplay {
  turns?: TurnData[];
  players?: string[];
  winner?: string;
  format?: string;
  playerLife?: number;
  opponentLife?: number;
  [key: string]: unknown;
}

/** Creature type for board analysis */
export interface Creature extends Card {
  power: number;
  toughness: number;
}

/** Land card type */
export interface Land extends Card {
  type_line: string;
}

/** Spell card type */
export interface Spell extends Card {
  type_line: string;
}

/** Threat assessment */
export interface Threat {
  card: string;
  threat: string;
  priority: 'immediate' | 'high' | 'medium' | 'low';
}

/** Play suggestion */
export interface PlaySuggestion {
  cardName: string;
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
  manaCost?: number;
  expectedImpact: string;
}

/** Warning message */
export interface Warning {
  type: 'danger' | 'caution' | 'info';
  message: string;
  relatedCards?: string[];
}

/** Mana suggestion */
export interface ManaSuggestion {
  cardName?: string;
  action: string;
  manaCost: number;
  priority: string;
  reasoning: string;
}

/** Alternative play option */
export interface AlternativePlay {
  cardName: string;
  rating: string;
  reason: string;
}

/** Synergy information */
export interface SynergyInfo {
  name: string;
  score: number;
  cards: string[];
}

/** Color alignment */
export interface ColorAlignment {
  primary?: string;
  secondary?: string;
}

/** Mana breakdown */
export interface ManaBreakdown {
  total: number;
  colored: Record<string, number>;
  colorless: number;
}

/** Curve analysis */
export interface CurveAnalysis {
  creatures: Array<{ cmc: number; count: number }>;
  spells: Array<{ cmc: number; curve: string }>;
  assessment: string;
}

/** Deck building suggestion */
export interface DeckSuggestion {
  name: string;
  quantity: number;
  reason: string;
}

/** Sideboard card */
export interface SideboardCard {
  name: string;
  reason: string;
}

/** Deck suggestion for card */
export interface CardSuggestion {
  card: string;
  reason: string;
}

/** Key moment in game */
export interface KeyMoment {
  turn: number;
  description: string;
  type: 'game_change' | 'mistake' | 'great_play' | 'missed_opportunity';
  whatHappened: string;
  couldHaveHappened?: string;
}

/** Game mistake */
export interface GameMistake {
  turn: number;
  description: string;
  severity: 'major' | 'minor';
  suggestion: string;
}

/** Stack interaction context */
export interface StackContext {
  stack: Card[];
  players: string[];
  activePlayer: string;
  priority?: string;
}

/** Stack action */
export interface StackAction {
  type: 'cast' | 'activate' | 'respond' | 'pass';
  card?: string;
  target?: string;
  playerId: string;
}

/** AI difficulty level */
export type AIDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/** AI provider configuration */
export interface AIProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

/** AI response structure */
export interface AIResponse {
  content?: string;
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  [key: string]: unknown;
}

/** Stream chunk structure */
export interface StreamChunk {
  content?: string;
  done?: boolean;
  [key: string]: unknown;
}
