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
    sd?: string;
    ed?: string;
    er?: string;
  };
  a: MinifiedAction[];
  cp: number;
  ta: number;
  ca: string;
  lma: string;
}

interface MinifiedAction {
  s: number;
  t: string;
  pid: string;
  d?: Record<string, unknown>;
  rs: MinifiedGameState;
  desc: string;
  ra: string;
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

interface GameStateForMinify {
  turn?: {
    turnNumber?: number;
    currentPhase?: string;
    activePlayerId?: string;
    priorityPlayerId?: string;
  };
  players?: Map<string, {
    id: string;
    name: string;
    life: number;
    hand?: unknown[];
  }>;
  zones?: {
    battlefield?: unknown[];
    graveyard?: unknown[];
    library?: unknown[];
  };
  status?: string;
  winners?: string[];
  endReason?: string;
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
      er: replay.metadata.endReason,
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
function minifyGameState(state: GameStateForMinify): MinifiedGameState {
  return {
    t: {
      tn: state.turn?.turnNumber,
      cp: state.turn?.currentPhase,
      ap: state.turn?.activePlayerId,
      pp: state.turn?.priorityPlayerId,
    },
    p: Array.from(state.players?.values() || []).map((player) => ({
      id: player.id,
      n: player.name,
      l: player.life,
      h: player.hand?.length || 0,
    })),
    z: {
      bf: state.zones?.battlefield?.length || 0,
      g: state.zones?.graveyard?.length || 0,
      l: state.zones?.library?.length || 0,
    },
    s: state.status,
    w: state.winners,
    er: state.endReason,
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
      gameStartDate: minified.m.sd,
      gameEndDate: minified.m.ed,
      endReason: minified.m.er,
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
 */
function expandGameState(minified: MinifiedGameState): GameStateForMinify {
  return {
    turn: {
      turnNumber: minified.t?.tn || 1,
      currentPhase: minified.t?.cp || 'begin',
      activePlayerId: minified.t?.ap,
      priorityPlayerId: minified.t?.pp,
    },
    players: new Map(minified.p?.map((p) => [p.id, {
      id: p.id,
      name: p.n,
      life: p.l,
      hand: Array(p.h).fill({}),
    }])),
    zones: {
      battlefield: Array(minified.z?.bf || 0).fill({}),
      graveyard: Array(minified.z?.g || 0).fill({}),
      library: Array(minified.z?.l || 0).fill({}),
      hand: [],
      stack: [],
      exile: [],
    },
    status: minified.s || 'in_progress',
    winners: minified.w,
    endReason: minified.er,
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
