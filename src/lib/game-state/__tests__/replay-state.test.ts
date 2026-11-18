/**
 * @fileoverview Unit tests for the replay state-reconstruction leaf module.
 *
 * Issue #2978 (follow-up to #2975 / #2979): `getStateAtPosition` and
 * `applyStateDeltaInPlace` moved from `src/lib/game-state/replay.ts` into
 * the leaf module `src/lib/game-state/replay-state.ts`, so light routes can
 * rebuild a `GameState` from a replay without pulling in the rules engine.
 * The behaviour matrix documented on the function is pinned here:
 *
 *   - null / out-of-range positions,
 *   - the fast path (legacy v1 and v2 snapshot actions),
 *   - the slow path (v2 delta actions forward-applied from the nearest
 *     preceding snapshot anchor),
 *   - malformed containers (no snapshots at all),
 *   - and every field of `ReplayStateDelta` that `applyStateDeltaInPlace`
 *     understands — including the `undefined`-means-delete semantics of the
 *     players / zones / cards maps.
 */

import { describe, it, expect } from "@jest/globals";
import type { GameState, Player, Zone } from "../types";
import { Phase, ZoneType } from "../types";
import type { Replay, ReplayAction, ReplayStateDelta } from "../replay";
import {
  getStateAtPosition,
  applyStateDeltaInPlace,
} from "../replay-state";

const FIXED_NOW = 1_700_000_000_000;

/** A structurally valid GameState (cloneGameState validates this shape). */
function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const state = {
    gameId: "g1",
    players: new Map<string, Player>([
      ["p1", { id: "p1", name: "Alex", life: 20 } as Player],
    ]),
    cards: new Map(),
    zones: new Map<string, Zone>([
      [
        "hand-p1",
        {
          type: ZoneType.HAND,
          playerId: "p1",
          cardIds: ["c1"],
          isRevealed: false,
          visibleTo: ["p1"],
        } as Zone,
      ],
    ]),
    stack: [],
    turn: {
      activePlayerId: "p1",
      currentPhase: Phase.UNTAP,
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
    ...overrides,
  } as unknown as GameState;
  return state;
}

function makeAction(
  sequenceNumber: number,
  extra: Partial<ReplayAction> = {},
): ReplayAction {
  return {
    sequenceNumber,
    action: {
      type: "cast_spell",
      playerId: "p1",
      timestamp: FIXED_NOW + sequenceNumber,
      data: {},
    },
    description: `action ${sequenceNumber}`,
    recordedAt: FIXED_NOW + sequenceNumber,
    ...extra,
  };
}

describe("getStateAtPosition", () => {
  it("returns null for a missing replay", () => {
    expect(getStateAtPosition(null, 0)).toBeNull();
    expect(getStateAtPosition(undefined, 0)).toBeNull();
  });

  it("returns null for a negative position", () => {
    const replay = {
      actions: [makeAction(0, { resultingState: makeGameState() })],
    } as unknown as Replay;
    expect(getStateAtPosition(replay, -1)).toBeNull();
  });

  it("returns null for a position past the end of the action list", () => {
    const replay = {
      actions: [makeAction(0, { resultingState: makeGameState() })],
    } as unknown as Replay;
    expect(getStateAtPosition(replay, 1)).toBeNull();
  });

  it("returns null for an empty action list", () => {
    expect(getStateAtPosition({ actions: [] } as unknown as Replay, 0)).toBeNull();
  });

  it("fast path: returns the embedded resultingState of a snapshot action", () => {
    const state = makeGameState();
    const replay = {
      actions: [makeAction(0, { resultingState: state })],
    } as unknown as Replay;

    expect(getStateAtPosition(replay, 0)).toBe(state);
  });

  it("slow path: rebuilds a delta action from the snapshot anchor", () => {
    const anchor = makeGameState();
    const replay = {
      schemaVersion: 2,
      snapshots: [{ sequenceNumber: 0, state: anchor, stateHash: "h0" }],
      actions: [
        makeAction(0, { resultingState: anchor }),
        makeAction(1, {
          delta: {
            fields: { status: "completed", winners: ["p1"], consecutivePasses: 1 },
          },
        }),
      ],
    } as unknown as Replay;

    const state = getStateAtPosition(replay, 1)!;

    expect(state).not.toBeNull();
    expect(state.status).toBe("completed");
    expect(state.winners).toEqual(["p1"]);
    expect(state.consecutivePasses).toBe(1);
    // The shared snapshot anchor must NOT be mutated by the reconstruction.
    expect(anchor.status).toBe("in_progress");
    expect(anchor.consecutivePasses).toBe(0);
  });

  it("slow path: uses the first snapshot when every snapshot is newer than the target", () => {
    const newer = makeGameState({ consecutivePasses: 11 });
    const replay = {
      schemaVersion: 2,
      snapshots: [{ sequenceNumber: 5, state: newer, stateHash: "h5" }],
      actions: [makeAction(0, { delta: { fields: { status: "paused" } } })],
    } as unknown as Replay;

    const state = getStateAtPosition(replay, 0)!;

    expect(state).not.toBeNull();
    expect(state.consecutivePasses).toBe(11);
    expect(state.status).toBe("in_progress");
  });

  it("returns null for an action slot that holds no action", () => {
    const actions: ReplayAction[] = [];
    actions[0] = undefined as unknown as ReplayAction;
    const replay = {
      actions,
    } as unknown as Replay;

    expect(getStateAtPosition(replay, 0)).toBeNull();
  });

  it("slow path: picks the nearest snapshot at or before the target", () => {
    const first = makeGameState();
    const second = makeGameState({ consecutivePasses: 5 });
    const replay = {
      schemaVersion: 2,
      snapshots: [
        { sequenceNumber: 0, state: first, stateHash: "h0" },
        { sequenceNumber: 2, state: second, stateHash: "h2" },
      ],
      actions: [
        makeAction(0, { resultingState: first }),
        makeAction(1, { delta: { fields: { consecutivePasses: 3 } } }),
        makeAction(2, { resultingState: second }),
        makeAction(3, { delta: { fields: { status: "paused" } } }),
      ],
    } as unknown as Replay;

    const state = getStateAtPosition(replay, 3)!;

    expect(state.consecutivePasses).toBe(5);
    expect(state.status).toBe("paused");
  });

  it("slow path: returns null when the container carries no snapshots", () => {
    const replay = {
      schemaVersion: 2,
      actions: [makeAction(0, { delta: { fields: { status: "paused" } } })],
    } as unknown as Replay;

    expect(getStateAtPosition(replay, 0)).toBeNull();
  });

  it("slow path: tolerates a delta action without any delta", () => {
    const anchor = makeGameState();
    const replay = {
      schemaVersion: 2,
      snapshots: [{ sequenceNumber: 0, state: anchor, stateHash: "h0" }],
      actions: [
        makeAction(0, { resultingState: anchor }),
        makeAction(1),
      ],
    } as unknown as Replay;

    const state = getStateAtPosition(replay, 1)!;

    // Reconstruction is lossy but must not throw.
    expect(state).not.toBeNull();
    expect(state.status).toBe("in_progress");
  });

  it("slow path: a mid-stream snapshot action replaces the reconstructed state", () => {
    const anchor = makeGameState();
    const midState = makeGameState({ consecutivePasses: 7 });
    const replay = {
      schemaVersion: 2,
      snapshots: [{ sequenceNumber: 0, state: anchor, stateHash: "h0" }],
      actions: [
        makeAction(0, { resultingState: anchor }),
        makeAction(1, { resultingState: midState }),
        makeAction(2, { delta: { fields: { status: "paused" } } }),
      ],
    } as unknown as Replay;

    const state = getStateAtPosition(replay, 2)!;

    expect(state.consecutivePasses).toBe(7);
    expect(state.status).toBe("paused");
    // The mid-stream snapshot itself must not be handed out by reference.
    expect(state).not.toBe(midState);
  });
});

describe("applyStateDeltaInPlace", () => {
  it("returns the same state object it was given", () => {
    const state = makeGameState();
    const result = applyStateDeltaInPlace(state, {});
    expect(result).toBe(state);
  });

  it("applies every supported top-level field", () => {
    const state = makeGameState();
    const turn = { ...state.turn, turnNumber: 9 };
    const combat = { ...state.combat, inCombatPhase: true };

    const delta: ReplayStateDelta = {
      fields: {
        turn,
        combat,
        status: "completed",
        winners: ["p2"],
        endReason: "concession",
        waitingChoice: { type: "card" } as never,
        priorityPlayerId: "p2",
        consecutivePasses: 4,
        pendingCorpseOffers: ["c9"],
        pendingTributeOffers: ["c8"],
        priorityPlayerIndex: 1,
      },
    };

    applyStateDeltaInPlace(state, delta);

    expect(state.turn).toBe(turn);
    expect(state.combat).toBe(combat);
    expect(state.status).toBe("completed");
    expect(state.winners).toEqual(["p2"]);
    expect(state.endReason).toBe("concession");
    expect(state.waitingChoice).toEqual({ type: "card" });
    expect(state.priorityPlayerId).toBe("p2");
    expect(state.consecutivePasses).toBe(4);
    expect(state.pendingCorpseOffers).toEqual(["c9"]);
    expect(state.pendingTributeOffers).toEqual(["c8"]);
    expect(
      (state as unknown as { priorityPlayerIndex?: number }).priorityPlayerIndex,
    ).toBe(1);
  });

  it("leaves untouched fields alone when the delta omits them", () => {
    const state = makeGameState();
    const before = state.turn;

    applyStateDeltaInPlace(state, { fields: { consecutivePasses: 2 } });

    expect(state.turn).toBe(before);
    expect(state.status).toBe("in_progress");
    expect(state.winners).toEqual([]);
    expect(state.endReason).toBeNull();
  });

  it("sets and deletes players", () => {
    const state = makeGameState();

    applyStateDeltaInPlace(state, {
      players: [["p2", { id: "p2", name: "Sam", life: 20 }]],
    });
    expect(state.players.get("p2")).toEqual({
      id: "p2",
      name: "Sam",
      life: 20,
    });

    applyStateDeltaInPlace(state, { players: [["p2", undefined]] });
    expect(state.players.has("p2")).toBe(false);
    expect(state.players.has("p1")).toBe(true);
  });

  it("sets and deletes zones", () => {
    const state = makeGameState();

    applyStateDeltaInPlace(state, {
      zones: [["battlefield", { type: ZoneType.BATTLEFIELD, cardIds: ["c7"] }]],
    });
    expect(state.zones.get("battlefield")).toEqual({
      type: ZoneType.BATTLEFIELD,
      cardIds: ["c7"],
    });

    applyStateDeltaInPlace(state, { zones: [["battlefield", undefined]] });
    expect(state.zones.has("battlefield")).toBe(false);
    expect(state.zones.has("hand-p1")).toBe(true);
  });

  it("sets and deletes cards", () => {
    const state = makeGameState();

    applyStateDeltaInPlace(state, {
      cards: [["c1", { id: "c1", name: "Forest" }]],
    });
    expect(state.cards.get("c1")).toEqual({ id: "c1", name: "Forest" });

    applyStateDeltaInPlace(state, { cards: [["c1", undefined]] });
    expect(state.cards.has("c1")).toBe(false);
  });

  it("replaces the stack wholesale", () => {
    const state = makeGameState();

    applyStateDeltaInPlace(state, { stack: [{ id: "s1" } as never] });

    expect(state.stack).toHaveLength(1);
    expect((state.stack[0] as unknown as { id: string }).id).toBe("s1");
  });

  it("ignores an empty delta", () => {
    const state = makeGameState();
    const before = state.status;

    applyStateDeltaInPlace(state, {});

    expect(state.status).toBe(before);
  });
});
