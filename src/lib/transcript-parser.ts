/**
 * Match Coverage Transcript Parser
 *
 * Parses Pro Tour, SCG Tour, and tournament coverage transcripts
 * to extract sideboard swap records with reasoning.
 */

import { MatchCoverageData, SideboardSwap } from './sideboard-recommendation';
import { MagicFormat } from './meta';

/**
 * Parsed sideboard action from transcript
 */
export interface ParsedSideboardAction {
  action: 'in' | 'out';
  cardName: string;
  count: number;
  reason?: string;
}

/**
 * Parsed game with sideboard actions
 */
export interface ParsedGame {
  gameNumber: number;
  commentary: string;
  sideboardActions: ParsedSideboardAction[];
}

/**
 * Match coverage analysis result
 */
export interface MatchCoverageAnalysis {
  format: MagicFormat;
  yourArchetype: string;
  opponentArchetype: string;
  games: ParsedGame[];
  source: string;
  date: string;
}

/**
 * Regular expressions for sideboard pattern detection
 */
const SIDEBOARD_PATTERNS = {
  // "Bring in", "Sideboard in", "Board in"
  bringIn: /(?:bring|sideboard|board|add|put)\s+(?:in\s+)?(?:the\s+)?(\d+)?\s*([a-z][a-z\s\-']+?)(?:s?\s+(?:from|to)?\s*(?:the\s+)?(?:board|sideboard))?(?:\.|,|$)/gi,

  // "Take out", "Sideboard out", "Board out"
  takeOut: /(?:take|sideboard|board|remove|cut)\s+(?:out\s+)?(?:the\s+)?(\d+)?\s*([a-z][a-z\s\-']+?)(?:s?\s+(?:from|to)?\s*(?:the\s+)?(?:board|sideboard))?(?:\.|,|$)/gi,

  // "X for Y" swap pattern
  swap: /(\d+)\s*([a-z][a-z\s\-']+?)\s+(?:for|in exchange for)\s+(\d+)\s*([a-z][a-z\s\-']+?)(?:\.|,|$)/gi,

  // Reason patterns
  reason: /(?:because|since|as|to|for|against|to fight|to deal with|to handle|to combat)\s+([^.!?]+)/gi,

  // Game markers
  gameStart: /game\s+(\d+)/gi,
  betweenGame: /between\s+games?\s+(\d+)\s*and\s*(\d+)/gi,
};

/**
 * Format detection from transcript
 */
const FORMAT_KEYWORDS: Record<MagicFormat, string[]> = {
  standard: ['standard', 'std', 'standard rotation', 'new set'],
  modern: ['modern', 'modern format', 'modern deck'],
  commander: ['commander', 'edh', 'elder dragon highlander', 'commander deck'],
  legacy: ['legacy', 'legacy format', 'legacy deck'],
  pioneer: ['pioneer', 'pioneer format', 'explorer'],
};

/**
 * Archetype keywords for detection
 */
const ARCHETYPE_KEYWORDS = {
  'Red Aggro': ['red aggro', 'mono red', 'burn', 'goblins', 'red sligh'],
  'Blue Control': ['blue control', 'uw control', 'azorius control', 'control deck'],
  'Green Midrange': ['green midrange', 'stompy', 'mono green'],
  'Black Midrange': ['black midrange', 'monoblack', 'black devotion'],
  'Jund': ['jund', 'midrange jund', 'bg midrange'],
  'UW Control': ['uw control', 'white blue control', 'azorius'],
  'Tron': ['tron', 'urza lands', 'eldrazi tron'],
  'Burn': ['burn', 'modern burn', 'red burn'],
  'Commander Aggro': ['aggro commander', 'fast commander', 'voltron'],
  'Commander Control': ['control commander', 'stax commander', 'control deck'],
};

/**
 * Parse a match coverage transcript
 */
export function parseMatchTranscript(
  transcript: string,
  source: string = 'Unknown',
  date: string = new Date().toISOString()
): MatchCoverageAnalysis | null {
  // Detect format
  const format = detectFormat(transcript);
  if (!format) {
    console.warn('Could not detect format from transcript');
    return null;
  }

  // Detect archetypes
  const archetypes = detectArchetypes(transcript);
  if (archetypes.length < 2) {
    console.warn('Could not detect both player archetypes');
    return null;
  }

  // Parse games
  const games = parseGames(transcript);

  return {
    format,
    yourArchetype: archetypes[0],
    opponentArchetype: archetypes[1],
    games,
    source,
    date,
  };
}

/**
 * Detect format from transcript text
 */
function detectFormat(transcript: string): MagicFormat | null {
  const lowerTranscript = transcript.toLowerCase();

  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
      return format as MagicFormat;
    }
  }

  return null;
}

/**
 * Detect player archetypes from transcript
 */
function detectArchetypes(transcript: string): string[] {
  const lowerTranscript = transcript.toLowerCase();
  const detected: string[] = [];

  for (const [archetype, keywords] of Object.entries(ARCHETYPE_KEYWORDS)) {
    if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
      detected.push(archetype);
    }
  }

  return detected;
}

/**
 * Parse individual games and their sideboard actions
 */
function parseGames(transcript: string): ParsedGame[] {
  const games: ParsedGame[] = [];
  const lines = transcript.split('\n');
  let currentGame: ParsedGame | null = null;
  let gameNumber = 1;

  for (const line of lines) {
    // Check for game start
    const gameMatch = line.match(SIDEBOARD_PATTERNS.gameStart);
    if (gameMatch) {
      if (currentGame) {
        games.push(currentGame);
      }
      gameNumber = parseInt(gameMatch[1], 10);
      currentGame = {
        gameNumber,
        commentary: '',
        sideboardActions: [],
      };
      continue;
    }

    // Check for between-game commentary (usually where sideboarding happens)
    const betweenMatch = line.match(SIDEBOARD_PATTERNS.betweenGame);
    if (betweenMatch) {
      if (currentGame) {
        games.push(currentGame);
      }
      currentGame = {
        gameNumber: parseInt(betweenMatch[2], 10),
        commentary: '',
        sideboardActions: [],
      };
      continue;
    }

    // Parse sideboard actions
    if (currentGame) {
      // Check for "bring in" patterns
      const bringInMatches = line.matchAll(SIDEBOARD_PATTERNS.bringIn);
      for (const match of bringInMatches) {
        const count = match[1] ? parseInt(match[1], 10) : 1;
        const cardName = match[2]?.trim();
        const reason = extractReason(line);

        if (cardName) {
          currentGame.sideboardActions.push({
            action: 'in',
            cardName,
            count,
            reason,
          });
        }
      }

      // Check for "take out" patterns
      const takeOutMatches = line.matchAll(SIDEBOARD_PATTERNS.takeOut);
      for (const match of takeOutMatches) {
        const count = match[1] ? parseInt(match[1], 10) : 1;
        const cardName = match[2]?.trim();
        const reason = extractReason(line);

        if (cardName) {
          currentGame.sideboardActions.push({
            action: 'out',
            cardName,
            count,
            reason,
          });
        }
      }

      // Check for swap patterns
      const swapMatches = line.matchAll(SIDEBOARD_PATTERNS.swap);
      for (const match of swapMatches) {
        const outCount = parseInt(match[1], 10);
        const outCard = match[2]?.trim();
        const inCount = parseInt(match[3], 10);
        const inCard = match[4]?.trim();
        const reason = extractReason(line);

        if (outCard && inCard) {
          currentGame.sideboardActions.push({
            action: 'out',
            cardName: outCard,
            count: outCount,
            reason,
          });
          currentGame.sideboardActions.push({
            action: 'in',
            cardName: inCard,
            count: inCount,
            reason,
          });
        }
      }

      // Add to commentary if it's a descriptive line
      if (line.length > 20 && !line.match(SIDEBOARD_PATTERNS.gameStart)) {
        currentGame.commentary += line + ' ';
      }
    }
  }

  // Add the last game
  if (currentGame) {
    games.push(currentGame);
  }

  return games;
}

/**
 * Extract reasoning from a line of commentary
 */
function extractReason(line: string): string | undefined {
  const reasonMatch = line.match(SIDEBOARD_PATTERNS.reason);
  if (reasonMatch) {
    return reasonMatch[1]?.trim();
  }

  // Check for common sideboarding reasons
  const commonReasons = [
    { pattern: /remov[a-z]+/gi, text: 'Removal' },
    { pattern: /disrupt[a-z]+/gi, text: 'Disruption' },
    { pattern: /aggresive|aggr[ae]s[ei]ve/gi, text: 'Aggro matchup' },
    { pattern: /control/gi, text: 'Control matchup' },
    { pattern: /counterspell|counter/gi, text: 'Counter their spells' },
    { pattern: /graveyard|gy/gi, text: 'Graveyard interaction' },
    { pattern: /artifact|enchant/gi, text: 'Permanent interaction' },
    { pattern: /burn|damage/gi, text: 'Deal with burn' },
    { pattern: /life|gain/gi, text: 'Life gain' },
  ];

  for (const { pattern, text } of commonReasons) {
    if (pattern.test(line)) {
      return text;
    }
  }

  return undefined;
}

/**
 * Convert parsed analysis to MatchCoverageData format
 */
export function convertToMatchCoverageData(
  analysis: MatchCoverageAnalysis
): MatchCoverageData {
  return {
    format: analysis.format,
    yourArchetype: analysis.yourArchetype,
    opponentArchetype: analysis.opponentArchetype,
    transcript: '',
    sideboardSwaps: analysis.games.map(game => ({
      gameNumber: game.gameNumber,
      cardsIn: game.sideboardActions
        .filter(action => action.action === 'in')
        .map(action => ({
          cardName: action.cardName,
          count: action.count,
          reason: action.reason || 'Strategic adjustment',
        })),
      cardsOut: game.sideboardActions
        .filter(action => action.action === 'out')
        .map(action => ({
          cardName: action.cardName,
          count: action.count,
          reason: action.reason || 'Strategic adjustment',
        })),
      commentary: game.commentary.trim(),
    })),
    source: analysis.source,
    date: analysis.date,
  };
}

/**
 * Parse a transcript from a tournament coverage file
 */
export function parseTournamentCoverage(
  transcript: string,
  source: string = 'Tournament Coverage',
  date: string = new Date().toISOString()
): MatchCoverageData | null {
  const analysis = parseMatchTranscript(transcript, source, date);
  if (!analysis) {
    return null;
  }

  return convertToMatchCoverageData(analysis);
}
