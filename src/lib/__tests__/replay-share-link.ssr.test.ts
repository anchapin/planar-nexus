/**
 * @fileoverview SSR-side tests for the engine-free replay share-link module.
 *
 * Issue #2978: `generateShareableURL` and `getEstimatedURLLength` branch on
 * `typeof window !== "undefined"` — the server-rendering path (no `window`)
 * must produce a *relative* share URL and a length estimate based on the
 * assumed 30-character origin. jsdom always defines `window`, so these
 * branches can only be exercised in the plain node environment; that is why
 * this lives in its own file with a `@jest-environment node` docblock.
 *
 * The engine-free module is imported here on purpose: it must stay
 * importable from a server bundle (that is the whole point of #2947).
 *
 * @jest-environment node
 */

import { describe, it, expect } from "@jest/globals";
import type { GameState, Player, Zone } from "../game-state/types";
import { Phase, ZoneType } from "../game-state/types";
import type { Replay } from "../game-state/replay";
import {
  generateShareableURL,
  getEstimatedURLLength,
  canShareViaURL,
  encodeReplayToURL,
} from "../replay-share-link";

const FIXED_NOW = 1_700_000_000_000;

function makeGameState(): GameState {
  const p1 = { id: "p1", name: "Alex", life: 20 } as Player;
  return {
    gameId: "g1",
    players: new Map<string, Player>([["p1", p1]]),
    cards: new Map(),
    zones: new Map<string, Zone>([
      [
        "hand-p1",
        {
          type: ZoneType.HAND,
          playerId: "p1",
          cardIds: ["c1", "c2"],
          isRevealed: false,
          visibleTo: ["p1"],
        } as Zone,
      ],
    ]),
    stack: [],
    turn: {
      activePlayerId: "p1",
      currentPhase: Phase.PRECOMBAT_MAIN,
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: FIXED_NOW,
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: "p1",
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "modern",
    createdAt: FIXED_NOW,
    lastModifiedAt: FIXED_NOW,
  } as unknown as GameState;
}

function makeReplay(): Replay {
  return {
    id: "replay-ssr",
    metadata: {
      format: "modern",
      playerNames: ["Alex"],
      startingLife: 20,
      isCommander: false,
      gameStartDate: FIXED_NOW,
    },
    actions: [
      {
        sequenceNumber: 0,
        action: {
          type: "cast_spell",
          playerId: "p1",
          timestamp: FIXED_NOW,
          data: {},
        },
        resultingState: makeGameState(),
        description: "cast",
        recordedAt: FIXED_NOW,
      },
    ],
    currentPosition: 0,
    totalActions: 1,
    createdAt: FIXED_NOW,
    lastModifiedAt: FIXED_NOW,
  } as Replay;
}

describe("replay-share-link (server rendering)", () => {
  it("has no window in this environment", () => {
    expect(typeof window).toBe("undefined");
  });

  it("builds a relative share URL", () => {
    const url = generateShareableURL(makeReplay());
    expect(url).not.toBeNull();
    expect(url!.startsWith("/replay?replay=")).toBe(true);
  });

  it("estimates the URL length from the assumed 30-character origin", () => {
    const encoded = encodeReplayToURL(makeReplay());
    const expected = 30 + "/replay?replay=".length + encoded.length;
    expect(getEstimatedURLLength(makeReplay())).toBe(expected);
  });

  it("still answers the shareability question", () => {
    expect(canShareViaURL(makeReplay())).toBe(true);
  });
});
