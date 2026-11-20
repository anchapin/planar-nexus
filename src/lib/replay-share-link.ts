/**
 * @fileOverview Replay sharing — URL encoding and share helpers (light).
 *
 * Issue #2947: the /saved-games route only needs to build a shareable
 * link for a saved replay, but the module that used to own that code also
 * owned the *decode* side, which needs real engine values
 * (`ReplacementEffectManager`, `LayerSystem`, the `Phase` enum). Those
 * could only be imported from the "@/lib/game-state" barrel, whose value
 * surface drags the whole rules engine into the route's module graph
 * (#1710 / #2470) — which is what pushed /saved-games over its bundle
 * budget.
 *
 * This module is the engine-free half of the old `replay-sharing.ts`:
 * everything needed to *encode* a replay into a shareable URL / file and
 * to answer "can this replay be shared via URL?". It reaches the engine
 * only through:
 *
 *   - `import type { … } from "@/lib/game-state"` — erased at compile
 *     time, so it adds no runtime edge;
 *   - `@/lib/game-state/lite` — the sanctioned leaf entry point
 *     (serialization / compression / hashing);
 *   - `getStateAtPosition` from "@/lib/game-state/lite", the
 *     engine-free leaf home of the engine's own helper (issue #2975).
 *
 * The decode side (`decodeReplayFromURL`, `getReplayFromCurrentURL` and
 * the state expansion behind them) still needs the engine and stays in
 * `replay-sharing.ts`, which re-exports everything from here so existing
 * consumers keep working unchanged.
 */

import type {
  ActionType,
  GameState,
  Replay,
  Zone,
} from "@/lib/game-state";
import { getStateAtPosition } from "@/lib/game-state/lite";

const REPLAY_PARAM = "replay";

/**
 * Zone-type discriminators, mirrored from the engine's `ZoneType` enum
 * (`src/lib/game-state/types/zones.ts`).
 *
 * The enum's *values* cannot be imported here: a value import from the
 * "@/lib/game-state" barrel pulls the whole rules engine into every
 * route that touches it, and "@/lib/game-state/lite" only re-exports the
 * enum as a TYPE. The strings below are the enum's runtime values, so
 * the comparisons are identical to `zone.type === ZoneType.HAND` etc.
 */
const ZONE_HAND = "hand";
const ZONE_BATTLEFIELD = "battlefield";
const ZONE_GRAVEYARD = "graveyard";
const ZONE_LIBRARY = "library";

/**
 * Minified replay structure for URL encoding
 */
export interface MinifiedReplay {
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

export interface MinifiedAction {
  s: number;
  t: ActionType;
  pid: string;
  d?: Record<string, unknown>;
  rs: MinifiedGameState;
  desc: string;
  ra: number;
}

export interface MinifiedGameState {
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
    console.error("Failed to encode replay:", error);
    throw new Error("Failed to encode replay for sharing");
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
      console.warn("Replay data too large for URL sharing");
      return null;
    }

    const baseURL = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseURL}/replay?${REPLAY_PARAM}=${encoded}`;
  } catch (error) {
    console.error("Failed to generate shareable URL:", error);
    return null;
  }
}

/**
 * Generate a shareable link using a unique ID (for server-based sharing)
 * This would be used when we have a backend to store the replay
 */
export async function generateServerShareableLink(
  replay: Replay,
  serverURL: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${serverURL}/api/replays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(replay),
    });

    if (!response.ok) {
      throw new Error("Failed to upload replay");
    }

    const data = await response.json();
    return `${serverURL}/replay/${data.id}`;
  } catch (error) {
    console.error("Failed to generate server shareable link:", error);
    return null;
  }
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
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
}

/**
 * Export replay to a downloadable file
 */
export function exportReplayToFile(replay: Replay, filename?: string): void {
  const json = JSON.stringify(replay, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
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
    console.error("Failed to import replay:", error);
    return null;
  }
}

/**
 * Import replay from a URL (server-based)
 */
export async function importReplayFromURL(
  replayId: string,
  serverURL: string,
): Promise<Replay | null> {
  try {
    const response = await fetch(`${serverURL}/api/replays/${replayId}`);
    if (!response.ok) {
      throw new Error("Replay not found");
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to import replay from URL:", error);
    return null;
  }
}

/**
 * Minify replay data to reduce size for URL encoding
 *
 * Issue #1574: v2 delta-encoded replays do not carry `resultingState` on
 * every action. The URL-share format is intrinsically snapshot-per-action
 * (the round-trip test in `replay-sharing.test.ts` decodes `rs` directly),
 * so before minifying we materialise the full state at every position via
 * `getStateAtPosition`. This is a one-shot cost on share — the saved
 * replay itself stays delta-encoded.
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
    a: replay.actions.map((action, position) => ({
      s: action.sequenceNumber,
      t: action.action.type,
      pid: action.action.playerId,
      d: action.action.data,
      rs: minifyGameState(
        action.resultingState ?? getStateAtPosition(replay, position)!,
      ),
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
  state.zones.forEach((zone: Zone) => {
    if ((zone.type as string) === ZONE_HAND && zone.playerId) {
      playerHandSizes.set(zone.playerId, zone.cardIds.length);
    }
  });

  // Get battlefield, graveyard, and library counts
  let battlefieldCount = 0;
  let graveyardCount = 0;
  let libraryCount = 0;

  state.zones.forEach((zone: Zone) => {
    switch (zone.type as string) {
      case ZONE_BATTLEFIELD:
        battlefieldCount += zone.cardIds.length;
        break;
      case ZONE_GRAVEYARD:
        graveyardCount += zone.cardIds.length;
        break;
      case ZONE_LIBRARY:
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
 * Estimate the length of the URL that would be generated for a replay
 */
export function getEstimatedURLLength(replay: Replay): number {
  try {
    const encoded = encodeReplayToURL(replay);
    const baseLength =
      typeof window !== "undefined" ? window.location.origin.length : 30;
    return baseLength + `/replay?${REPLAY_PARAM}=`.length + encoded.length;
  } catch {
    return -1;
  }
}
