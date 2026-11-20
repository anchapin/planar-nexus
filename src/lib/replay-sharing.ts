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
 *
 * Issue #2947: this module now owns only the *decode* side of the replay
 * share format, because expanding a minified replay back into a full
 * `GameState` needs real engine values (`Phase`, `ZoneType`,
 * `ReplacementEffectManager`, `LayerSystem`). Those are only reachable
 * through the "@/lib/game-state" barrel, and a value import from the
 * barrel drags the whole rules engine into every route that imports this
 * module — which is what pushed the /saved-games route over its bundle
 * budget.
 *
 * The encode side (URL building, clipboard copy, file export, "can this
 * be shared via URL?") moved to `./replay-share-link`, which reaches the
 * engine only through type-only imports and the "@/lib/game-state/lite"
 * leaf. Everything that module exports is re-exported here, so existing
 * consumers (`replay-viewer.tsx`, the /replay route, the unit tests) keep
 * working with the same names.
 */

import type {
  Replay,
  GameState,
  Zone,
  LinkedEffectRegistry,
} from "@/lib/game-state";
import {
  Phase,
  ZoneType,
  ReplacementEffectManager,
  LayerSystem,
} from "@/lib/game-state";
import type {
  MinifiedAction,
  MinifiedGameState,
  MinifiedReplay,
} from "./replay-share-link";

// The encode side (and everything it exports) lives in the engine-free
// module; re-exported here so the public surface of this module is
// unchanged for existing consumers.
export * from "./replay-share-link";

// Mirrors REPLAY_PARAM in ./replay-share-link (the query-parameter name
// the shared URL carries).
const REPLAY_PARAM = "replay";

/**
 * Decode replay data from a base64 URL parameter
 */
export function decodeReplayFromURL(encoded: string): Replay | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const minified = JSON.parse(json);
    return expandReplay(minified);
  } catch (error) {
    console.error("Failed to decode replay:", error);
    return null;
  }
}

/**
 * Extract replay parameter from current URL
 */
export function getReplayFromCurrentURL(): Replay | null {
  if (typeof window === "undefined") return null;

  const urlParams = new URLSearchParams(window.location.search);
  const encoded = urlParams.get(REPLAY_PARAM);

  if (!encoded) return null;
  return decodeReplayFromURL(encoded);
}

/**
 * Expand minified replay back to full format
 */
function expandReplay(minified: MinifiedReplay): Replay {
  const actions = minified.a.map((action: MinifiedAction) => {
    const resultingState = expandGameState(action.rs);
    if (resultingState === null) {
      throw new Error("Invalid phase or status in replay action");
    }
    return {
      sequenceNumber: action.s,
      action: {
        type: action.t,
        playerId: action.pid,
        data: action.d || {},
        timestamp: action.ra,
      },
      resultingState,
      description: action.desc,
      recordedAt: action.ra,
    };
  });

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

const VALID_PHASES = new Set(Object.values(Phase));
const VALID_STATUSES = new Set<string>([
  "not_started",
  "in_progress",
  "paused",
  "completed",
]);

/**
 * Expand minimized game state back to full format
 * Note: This creates a simplified GameState suitable for replay display.
 * Returns null if phase or status values are invalid (security: prevents
 * attacker-controlled strings from being threaded into the rules engine as
 * enum members — cf. issue #1904).
 */
function expandGameState(minified: MinifiedGameState): GameState | null {
  const cp = minified.t?.cp;
  if (cp !== undefined && !VALID_PHASES.has(cp as Phase)) {
    return null;
  }
  const s = minified.s;
  if (s !== undefined && !VALID_STATUSES.has(s)) {
    return null;
  }
  const now = Date.now();

  // Create players map
  const players = new Map(
    minified.p?.map((p) => [
      p.id,
      {
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
        isMonarch: false,
      },
    ]),
  );

  // Create zones map
  const zones = new Map<string, Zone>();
  let zoneId = 0;

  minified.p?.forEach((p) => {
    // Hand zone for each player
    zones.set(`hand-${p.id}`, {
      type: ZoneType.HAND,
      playerId: p.id,
      cardIds: Array(p.h)
        .fill("")
        .map(() => `placeholder-${++zoneId}`),
      isRevealed: false,
      visibleTo: [p.id],
    });
  });

  // Battlefield zone (shared)
  zones.set("battlefield", {
    type: ZoneType.BATTLEFIELD,
    playerId: null,
    cardIds: Array(minified.z?.bf || 0)
      .fill("")
      .map(() => `placeholder-${++zoneId}`),
    isRevealed: true,
    visibleTo: [],
  });

  // Graveyard zones
  minified.p?.forEach((p) => {
    zones.set(`graveyard-${p.id}`, {
      type: ZoneType.GRAVEYARD,
      playerId: p.id,
      cardIds: [],
      isRevealed: true,
      visibleTo: [],
    });
  });

  // Library zones
  minified.p?.forEach((p) => {
    zones.set(`library-${p.id}`, {
      type: ZoneType.LIBRARY,
      playerId: p.id,
      cardIds: Array(minified.z?.l || 0)
        .fill("")
        .map(() => `placeholder-${++zoneId}`),
      isRevealed: false,
      visibleTo: [p.id],
    });
  });

  // Get first player as active player
  const firstPlayerId = minified.p?.[0]?.id || "";

  return {
    gameId: `replay-game-${now}`,
    players,
    cards: new Map(),
    zones,
    stack: [],
    turn: {
      activePlayerId: firstPlayerId,
      currentPhase: (cp || Phase.UNTAP) as Phase,
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
    status: (s || "in_progress") as
      "not_started" | "in_progress" | "paused" | "completed",
    winners: minified.w || [],
    endReason: minified.er || null,
    format: "unknown",
    createdAt: now,
    lastModifiedAt: now,
    replacementEffectManager: new ReplacementEffectManager(),
    layerSystem: new LayerSystem(),
    linkedEffectRegistry: {
      effects: [],
      bySourceCard: new Map(),
    } as LinkedEffectRegistry,
  };
}
