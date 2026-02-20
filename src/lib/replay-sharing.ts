/**
 * @fileOverview Replay sharing system for generating shareable links
 * 
 * Issue #92: Phase 5.3: Implement replay system with shareable links
 * 
 * Provides:
 * - Encode replay data into URL-safe format
 * - Generate short shareable links
 * - Decode replay from URL
 * - Import/export replay files
 */

import type { Replay } from './game-state/replay';
import type { ActionType, GameState, Zone } from './game-state/types';
import { Phase } from './game-state/types';

const REPLAY_PARAM = 'replay';

/**
 * Minified replay structure for URL encoding
 */
interface MinifiedReplay {
  i: string;
  m: {
    f: string;
    p: string[];
    s: number;
    c: boolean;
    w?: string[];
    sd?: number;
    ed?: number;
    er?: string;
  };
  a: MinifiedAction[];
  cp: number;
  ta: number;
  ca: number;
  lma: number;
}

interface MinifiedAction {
  s: number;
  t: ActionType;
  pid: string;
  d?: Record<string, unknown>;
  rs: MinifiedGameState;
  desc: string;
  ra: number;
}

interface MinifiedGameState {
  t: {
    tn?: number;
    cp?: string;
    ap?: string;
    pp?: string;
  };
  p: Array<{
    id: string;
    n: string;
    l: number;
    h: number;
  }>;
  z: {
    bf: number;
    g: number;
    l: number;
  };
  s?: string;
  w?: string[];
  er?: string;
}

const MAX_URL_LENGTH = 8000; // Safe limit for most browsers

/**
 * Encode replay data to a compressed base64 string for URL sharing
 */
export function encodeReplayToURL(replay: Replay): string {
  try {
    // Minify the replay data to reduce size
    const minified = minifyReplay(replay);
    const json = JSON.stringify(minified);
    const base64 = btoa(encodeURIComponent(json));
    return base64;
  } catch (error) {
    console.error('Failed to encode replay:', error);
    throw new Error('Failed to encode replay for sharing');
  }
}

/**
 * Decode replay data from a base64 URL parameter
 */
export function decodeReplayFromURL(encoded: string): Replay | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const minified = JSON.parse(json);
    return expandReplay(minified);
  } catch (error) {
    console.error('Failed to decode replay:', error);
    return null;
  }
}

/**
 * Generate a shareable URL for a replay
 */
export function generateShareableURL(replay: Replay): string | null {
  try {
    const encoded = encodeReplayToURL(replay);
    
    // Check if URL would be too long
    if (encoded.length > MAX_URL_LENGTH) {
      console.warn('Replay data too large for URL sharing');
      return null;
    }
    
    const baseURL = typeof window !== 'undefined' ? window.location.origin : '';
    return `${baseURL}/replay?${REPLAY_PARAM}=${encoded}`;
  } catch (error) {
    console.error('Failed to generate shareable URL:', error);
    return null;
  }
}

/**
 * Generate a shareable link using a unique ID (for server-based sharing)
 * This would be used when we have a backend to store the replay
 */
export async function generateServerShareableLink(replay: Replay, serverURL: string): Promise<string | null> {
  try {
    const response = await fetch(`${serverURL}/api/replays`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(replay),
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload replay');
    }
    
    const data = await response.json();
    return `${serverURL}/replay/${data.id}`;
  } catch (error) {
    console.error('Failed to generate server shareable link:', error);
    return null;
  }
}

/**
 * Extract replay parameter from current URL
 */
export function getReplayFromCurrentURL(): Replay | null {
  if (typeof window === 'undefined') return null;
  
  const urlParams = new URLSearchParams(window.location.search);
  const encoded = urlParams.get(REPLAY_PARAM);
  
  if (!encoded) return null;
  return decodeReplayFromURL(encoded);
}

/**
 * Copy shareable link to clipboard
 */
export async function copyShareableLink(replay: Replay): Promise<boolean> {
  const url = generateShareableURL(replay);
  if (!url) return false;
  
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Export replay to a downloadable file
 */
export function exportReplayToFile(replay: Replay, filename?: string): void {
  const json = JSON.stringify(replay, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `replay-${replay.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import replay from a File object
 */
export async function importReplayFromFile(file: File): Promise<Replay | null> {
  try {
    const text = await file.text();
    const replay = JSON.parse(text) as Replay;
    return replay;
  } catch (error) {
    console.error('Failed to import replay:', error);
    return null;
  }
}

/**
 * Import replay from a URL (server-based)
 */
export async function importReplayFromURL(replayId: string, serverURL: string): Promise<Replay | null> {
  try {
    const response = await fetch(`${serverURL}/api/replays/${replayId}`);
    if (!response.ok) {
      throw new Error('Replay not found');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to import replay from URL:', error);
    return null;
  }
}

/**
 * Minify replay data to reduce size for URL encoding
 */
function minifyReplay(replay: Replay): MinifiedReplay {
  return {
    i: replay.id,
    m: {
      f: replay.metadata.format,
      p: replay.metadata.playerNames,
      s: replay.metadata.startingLife,
      c: replay.metadata.isCommander,
      w: replay.metadata.winners,
      sd: replay.metadata.gameStartDate,
      ed: replay.metadata.gameEndDate,
      er: replay.metadata.endReason ?? undefined,
    },
    a: replay.actions.map(action => ({
      s: action.sequenceNumber,
      t: action.action.type,
      pid: action.action.playerId,
      d: action.action.data,
      rs: minifyGameState(action.resultingState),
      desc: action.description,
      ra: action.recordedAt,
    })),
    cp: replay.currentPosition,
    ta: replay.totalActions,
    ca: replay.createdAt,
    lma: replay.lastModifiedAt,
  };
}

/**
 * Minimize game state to reduce size
 */
function minifyGameState(state: GameState): MinifiedGameState {
  // Extract player hand sizes from zones
  const playerHandSizes = new Map<string, number>();
  
  // Count cards in each player's hand zone
  state.zones.forEach((zone) => {
    if (zone.type === 'hand' && zone.playerId) {
      playerHandSizes.set(zone.playerId, zone.cardIds.length);
    }
  });

  // Get battlefield, graveyard, and library counts
  let battlefieldCount = 0;
  let graveyardCount = 0;
  let libraryCount = 0;
  
  state.zones.forEach((zone) => {
    switch (zone.type) {
      case 'battlefield':
        battlefieldCount += zone.cardIds.length;
        break;
      case 'graveyard':
        graveyardCount += zone.cardIds.length;
        break;
      case 'library':
        libraryCount += zone.cardIds.length;
        break;
    }
  });

  return {
    t: {
      tn: state.turn?.turnNumber,
      cp: state.turn?.currentPhase,
      ap: state.turn?.activePlayerId,
      pp: state.priorityPlayerId ?? undefined,
    },
    p: Array.from(state.players?.values() || []).map((player) => ({
      id: player.id,
      n: player.name,
      l: player.life,
      h: playerHandSizes.get(player.id) || 0,
    })),
    z: {
      bf: battlefieldCount,
      g: graveyardCount,
      l: libraryCount,
    },
    s: state.status,
    w: state.winners,
    er: state.endReason ?? undefined,
  };
}

/**
 * Expand minified replay back to full format
 */
function expandReplay(minified: MinifiedReplay): Replay {
  const actions = minified.a.map((action: MinifiedAction) => ({
    sequenceNumber: action.s,
    action: {
      type: action.t,
      playerId: action.pid,
      data: action.d || {},
      timestamp: action.ra,
    },
    resultingState: expandGameState(action.rs),
    description: action.desc,
    recordedAt: action.ra,
  }));
  
  return {
    id: minified.i,
    metadata: {
      format: minified.m.f,
      playerNames: minified.m.p,
      startingLife: minified.m.s,
      isCommander: minified.m.c,
      winners: minified.m.w,
      gameStartDate: minified.m.sd ?? 0,
      gameEndDate: minified.m.ed,
      endReason: minified.m.er ?? undefined,
    },
    actions,
    currentPosition: minified.cp,
    totalActions: minified.ta,
    createdAt: minified.ca,
    lastModifiedAt: minified.lma,
  };
}

/**
 * Expand minimized game state back to full format
 * Note: This creates a simplified GameState suitable for replay display
 */
function expandGameState(minified: MinifiedGameState): GameState {
  const now = Date.now();
  
  // Create players map
  const players = new Map(minified.p?.map((p) => [p.id, {
    id: p.id,
    name: p.n,
    life: p.l,
    poisonCounters: 0,
    commanderDamage: new Map(),
    maxHandSize: 7,
    currentHandSizeModifier: 0,
    hasLost: false,
    lossReason: null,
    landsPlayedThisTurn: 0,
    maxLandsPerTurn: 1,
    manaPool: {
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: 0,
    },
    isInCommandZone: false,
    experienceCounters: 0,
    commanderCastCount: 0,
    hasPassedPriority: false,
    hasActivatedManaAbility: false,
    additionalCombatPhase: false,
    additionalMainPhase: false,
    hasOfferedDraw: false,
    hasAcceptedDraw: false,
  }]));

  // Create zones map
  const zones = new Map<string, Zone>();
  let zoneId = 0;
  
  minified.p?.forEach((p) => {
    // Hand zone for each player
    zones.set(`hand-${p.id}`, {
      type: 'hand' as const,
      playerId: p.id,
      cardIds: Array(p.h).fill('').map(() => `placeholder-${++zoneId}`),
      isRevealed: false,
      visibleTo: [p.id],
    });
  });

  // Battlefield zone (shared)
  zones.set('battlefield', {
    type: 'battlefield' as const,
    playerId: null,
    cardIds: Array(minified.z?.bf || 0).fill('').map(() => `placeholder-${++zoneId}`),
    isRevealed: true,
    visibleTo: [],
  });

  // Graveyard zones
  minified.p?.forEach((p) => {
    zones.set(`graveyard-${p.id}`, {
      type: 'graveyard' as const,
      playerId: p.id,
      cardIds: [],
      isRevealed: true,
      visibleTo: [],
    });
  });

  // Library zones
  minified.p?.forEach((p) => {
    zones.set(`library-${p.id}`, {
      type: 'library' as const,
      playerId: p.id,
      cardIds: Array(minified.z?.l || 0).fill('').map(() => `placeholder-${++zoneId}`),
      isRevealed: false,
      visibleTo: [p.id],
    });
  });

  // Get first player as active player
  const firstPlayerId = minified.p?.[0]?.id || '';

  return {
    gameId: `replay-game-${now}`,
    players,
    cards: new Map(),
    zones,
    stack: [],
    turn: {
      activePlayerId: firstPlayerId,
      currentPhase: (minified.t?.cp || Phase.UNTAP) as Phase,
      turnNumber: minified.t?.tn || 1,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: now,
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: minified.t?.pp || firstPlayerId,
    consecutivePasses: 0,
    status: (minified.s || 'in_progress') as 'not_started' | 'in_progress' | 'paused' | 'completed',
    winners: minified.w || [],
    endReason: minified.er || null,
    format: 'unknown',
    createdAt: now,
    lastModifiedAt: now,
  };
}

/**
 * Check if replay can be shared via URL (not too large)
 */
export function canShareViaURL(replay: Replay): boolean {
  try {
    const encoded = encodeReplayToURL(replay);
    return encoded.length <= MAX_URL_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Get estimated URL length for a replay
 */
export function getEstimatedURLLength(replay: Replay): number {
  try {
    const encoded = encodeReplayToURL(replay);
    const baseLength = typeof window !== 'undefined' ? window.location.origin.length : 30;
    return baseLength + `/replay?${REPLAY_PARAM}=`.length + encoded.length;
  } catch {
    return -1;
  }
}
