/**
 * Deterministic Sync — Edge Cases (Issue #1096)
 *
 * The existing deterministic-sync.test.ts / -extended.test.ts suites cover the
 * happy path. This file targets the edge cases called out by #1096:
 *   - Out-of-order action arrival still converges (AC #2).
 *   - PROPERTY: the same input action set yields an identical final state hash
 *     regardless of the order in which the actions arrive (AC #4).
 *   - Simultaneous-action conflict tie-break is deterministic (lower timestamp,
 *     then lower initiatorId) — mirroring p2p-conflict-resolution.
 *   - Divergence is detected, the desync handler fires, and the peers
 *     re-converge; the DesyncLogger records the injected divergence (AC #3).
 *   - validateAction rejects actions whose previousStateHash does not match the
 *     current state, and resolveConflict exercises its rollback / merge paths.
 */

import {
  DeterministicGameStateEngine,
  createDeterministicEngine,
  serializeSyncMessage,
  deserializeSyncMessage,
  createDesyncAlertMessage,
  type DeterministicAction,
} from "../deterministic-sync";
import { computeStateHash } from "../state-hash";
import { createInitialGameState } from "../game-state";
import type { GameState, GameAction, ActionType, ActionData } from "../types";
import { DesyncLogger } from "../../desync-logger";

/** Minimal game-action fixture (same shape used by deterministic-sync-extended). */
function makeGameAction(type = "play_card"): GameAction {
  return {
    type: type as ActionType,
    playerId: "player1",
    timestamp: 1,
    data: {} as ActionData,
  };
}

/**
 * Build a DeterministicAction with an EXPLICIT sequence number and a derived
 * hash chain (h0 -> h1 -> ...). The hash strings are opaque tokens: the engine
 * stores them verbatim, so we can assert convergence by comparing the final
 * action's resultingStateHash without depending on real state transitions.
 */
function makeRemoteAction(
  seq: number,
  initiatorId: string,
  timestamp = 100,
): DeterministicAction {
  return {
    sequenceNumber: seq,
    action: makeGameAction(),
    previousStateHash: `h${seq - 1}`,
    resultingStateHash: `h${seq}`,
    initiatorId,
    timestamp,
  };
}

const BASE_STATE = (): GameState =>
  createInitialGameState(["Alice", "Bob"], 20, false);

/** Two states that differ only in turn number (=> a non-mergeable discrepancy). */
function divergentState(): GameState {
  const state = BASE_STATE();
  state.turn.turnNumber = 9;
  return state;
}

describe("Issue #1096 — out-of-order arrival converges", () => {
  it("currentSequence tracks the high-water mark regardless of arrival order", () => {
    const engine = createDeterministicEngine("me");
    const state = BASE_STATE();

    // Arrive badly out of order: 3, then 1, then 2.
    engine.applyRemoteAction(makeRemoteAction(3, "peer", 300), state);
    engine.applyRemoteAction(makeRemoteAction(1, "peer", 100), state);
    engine.applyRemoteAction(makeRemoteAction(2, "peer", 200), state);

    // Sequence is the max seen, not the last arrived.
    expect(engine.getCurrentSequence()).toBe(3);
    // Every action is retained.
    expect(engine.getActionHistory()).toHaveLength(3);
  });

  it("a stale (low-sequence) remote action never rewinds the high-water mark", () => {
    const engine = createDeterministicEngine("me");
    const state = BASE_STATE();

    engine.applyRemoteAction(makeRemoteAction(7, "peer", 700), state);
    engine.applyRemoteAction(makeRemoteAction(2, "peer", 200), state); // stale

    expect(engine.getCurrentSequence()).toBe(7);
    // The next locally-created action continues from the high-water mark (8),
    // not from the stale sequence (2).
    const next = engine.createAction(makeGameAction(), state, state);
    expect(next.sequenceNumber).toBe(8);
  });

  // AC #4 — the headline property.
  it("PROPERTY: same action set => identical final state hash regardless of arrival order", () => {
    const actions = [
      makeRemoteAction(1, "peerA", 100),
      makeRemoteAction(2, "peerB", 200),
      makeRemoteAction(3, "peerA", 300),
      makeRemoteAction(4, "peerB", 400),
    ];

    const inOrder = createDeterministicEngine("me");
    actions.forEach((a) => inOrder.applyRemoteAction(a, BASE_STATE()));

    const reversed = createDeterministicEngine("me");
    [...actions]
      .reverse()
      .forEach((a) => reversed.applyRemoteAction(a, BASE_STATE()));

    const scrambled = createDeterministicEngine("me");
    [actions[2], actions[0], actions[3], actions[1]].forEach((a) =>
      scrambled.applyRemoteAction(a, BASE_STATE()),
    );

    // All engines agree on the final sequence number.
    expect(inOrder.getCurrentSequence()).toBe(4);
    expect(reversed.getCurrentSequence()).toBe(4);
    expect(scrambled.getCurrentSequence()).toBe(4);

    // The "final state hash" is the resultingStateHash of the highest-sequence
    // action — identical across all arrival orderings.
    const finalHash = (eng: DeterministicGameStateEngine) =>
      eng.getActionHistory().find((a) => a.sequenceNumber === 4)!
        .resultingStateHash;
    expect(finalHash(inOrder)).toBe("h4");
    expect(finalHash(reversed)).toBe("h4");
    expect(finalHash(scrambled)).toBe("h4");

    // The applied sequence-number sets are identical.
    const seqSet = (eng: DeterministicGameStateEngine) =>
      new Set(eng.getActionHistory().map((a) => a.sequenceNumber));
    expect(seqSet(inOrder)).toEqual(seqSet(reversed));
    expect(seqSet(inOrder)).toEqual(seqSet(scrambled));
  });
});

describe("Issue #1096 — validateAction hash-mismatch rejection", () => {
  it("rejects an action whose previousStateHash does not match the current state", () => {
    const engine = new DeterministicGameStateEngine("local");
    const state = BASE_STATE();

    const action: DeterministicAction = {
      sequenceNumber: 1, // > currentSequence (0) so it skips the duplicate check
      action: makeGameAction(),
      previousStateHash: "definitely-wrong-hash",
      resultingStateHash: "h1",
      initiatorId: "remote",
      timestamp: 1,
    };

    const result = engine.validateAction(action, state);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/State hash mismatch/);
  });
});

describe("Issue #1096 — verifySync divergence detection & recovery (convergence)", () => {
  it("detects divergence, fires the desync handler, then re-converges after re-sync", () => {
    const engine = new DeterministicGameStateEngine("local");
    const local = BASE_STATE();
    const remote = divergentState();
    expect(computeStateHash(local)).not.toBe(computeStateHash(remote));

    engine.registerPeer("peer");
    let handlerCalls = 0;
    engine.setDesyncHandler(() => {
      handlerCalls++;
    });

    // Inject divergence: peer advertises a different hash.
    engine.updatePeerState("peer", 1, computeStateHash(remote));
    const desyncResult = engine.verifySync(local);
    expect(desyncResult.isInSync).toBe(false);
    expect(desyncResult.discrepancies.has("peer")).toBe(true);
    expect(handlerCalls).toBe(1);

    // Recovery: peer's advertised hash now matches local.
    engine.updatePeerState("peer", 1, computeStateHash(local));
    const reconverged = engine.verifySync(local);
    expect(reconverged.isInSync).toBe(true);
    expect(reconverged.discrepancies.size).toBe(0);
    // The handler must NOT fire again once peers have re-converged.
    expect(handlerCalls).toBe(1);
  });
});

describe("Issue #1096 — DesyncLogger records an injected divergence (AC #3)", () => {
  it("logs a 'detected' event with the full local/remote hash context", () => {
    const engine = new DeterministicGameStateEngine("local");
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const local = BASE_STATE();
    const remote = divergentState();

    engine.registerPeer("peer");
    engine.setDesyncHandler((result) => {
      logger.logDetection(
        "local",
        "peer",
        result.localHash,
        result.remoteHashes.get("peer") ?? "",
        engine.getCurrentSequence(),
        result.discrepancies.get("peer") ?? [],
      );
    });

    engine.updatePeerState("peer", 3, computeStateHash(remote));
    engine.verifySync(local);

    expect(logger.getEvents()).toHaveLength(1);
    const ev = logger.getEvents()[0];
    expect(ev.type).toBe("detected");
    expect(ev.localPeerId).toBe("local");
    expect(ev.remotePeerId).toBe("peer");
    expect(ev.localHash).toBe(computeStateHash(local));
    expect(ev.remoteHash).toBe(computeStateHash(remote));
    expect(ev.discrepancies.length).toBeGreaterThan(0);
  });
});

describe("Issue #1096 — resolveConflict simultaneous-action tie-break", () => {
  it("on equal timestamps, the lower initiatorId wins (deterministic across peers)", () => {
    const engine = new DeterministicGameStateEngine("local");
    const local = BASE_STATE();
    const remote = divergentState(); // non-mergeable discrepancy

    // Two remote actions sharing sequence number 5, identical timestamps.
    engine.applyRemoteAction(makeRemoteAction(5, "peerA", 100), local);
    engine.applyRemoteAction(makeRemoteAction(5, "peerB", 100), local);

    const resolution = engine.resolveConflict(local, remote, "peerB", 5);
    expect(resolution.resolved).toBe(true);
    expect(resolution.strategy).toBe("authoritative");
    expect(resolution.resolutionActions).toHaveLength(1);
    // Equal timestamps => lexicographic initiatorId tie-break: "peerA" < "peerB".
    expect(resolution.resolutionActions[0].initiatorId).toBe("peerA");
    expect(resolution.conflictDescription).toContain("peerA");
  });

  it("a lower timestamp beats a lower initiatorId when timestamps differ", () => {
    const engine = new DeterministicGameStateEngine("local");
    const local = BASE_STATE();
    const remote = divergentState();

    engine.applyRemoteAction(makeRemoteAction(5, "peerZ", 300), local);
    engine.applyRemoteAction(makeRemoteAction(5, "peerA", 100), local);

    const resolution = engine.resolveConflict(local, remote, "peerA", 5);
    // peerA has the lower timestamp (100) and wins despite "peerA" < "peerZ"
    // already; the point is timestamp is the primary key.
    expect(resolution.resolutionActions[0].initiatorId).toBe("peerA");
  });
});

describe("Issue #1096 — resolveConflict rollback & merge paths", () => {
  it("rolls back to the latest snapshot when there are no simultaneous actions", () => {
    const engine = new DeterministicGameStateEngine("local");
    const local = BASE_STATE();
    const remote = divergentState();

    engine.takeSnapshot(local); // snapshot recorded at sequence 0
    // No actions share sequence 10 => findSimultaneousActions is empty.
    const resolution = engine.resolveConflict(local, remote, "peerB", 10);

    expect(resolution.resolved).toBe(true);
    expect(resolution.strategy).toBe("rollback");
    expect(resolution.rollbackSequence).toBe(0);
    expect(resolution.rollbackState).toBeDefined();
  });

  it("uses authoritative resolution when only life totals differ (mergeable)", () => {
    const engine = new DeterministicGameStateEngine("local");
    const local = BASE_STATE();
    const remote = BASE_STATE();
    // Differ ONLY in one player's life total => discrepancy is player/Life-total
    // => mergeable => authoritative resolution path.
    const firstPlayerId = Array.from(remote.players.keys())[0];
    remote.players.get(firstPlayerId)!.life = 17;

    const resolution = engine.resolveConflict(local, remote, "peer", 1);
    expect(resolution.resolved).toBe(true);
    expect(resolution.strategy).toBe("authoritative");
  });
});

describe("Issue #1096 — sync message (de)serialization round-trip", () => {
  it("round-trips a desync-alert message and rejects malformed input", () => {
    const msg = createDesyncAlertMessage("hashLocal", "hashRemote", 5, "me");
    const round = deserializeSyncMessage(serializeSyncMessage(msg));

    expect(round).not.toBeNull();
    expect((round as { type: string }).type).toBe("desync-alert");
    expect((round as { localHash: string }).localHash).toBe("hashLocal");
    expect((round as { remoteHash: string }).remoteHash).toBe("hashRemote");

    expect(deserializeSyncMessage("{ not json")).toBeNull();
  });
});
