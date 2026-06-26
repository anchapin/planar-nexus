/**
 * P2P Conflict Resolution Tests
 *
 * Includes the issue #1096 edge-case suite (concurrent conflicting actions,
 * deterministic tie-breaking, priority ordering, out-of-order/queue
 * application, last-writer-wins, and merge policies). Those tests mock
 * `Date.now` so timestamps (and therefore every tie-break) are fully
 * deterministic rather than wall-clock dependent.
 */

import {
  ConflictResolutionManager,
  createConflictResolutionManager,
  mergeActions,
  type ConflictResolutionConfig,
  type ActionPriority,
  type ConflictStrategy,
  type TimestampedAction,
  type ActionConflict,
} from "../p2p-conflict-resolution";

describe("ConflictResolutionManager", () => {
  let manager: ConflictResolutionManager;

  beforeEach(() => {
    manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "host-wins",
      actionWindow: 100,
      enablePriority: true,
      enableSequenceNumbers: true,
    });
  });

  describe("constructor", () => {
    it("should create manager with default config", () => {
      const defaultManager = new ConflictResolutionManager();
      expect(defaultManager).toBeDefined();
    });

    it("should create manager with custom config", () => {
      const customManager = new ConflictResolutionManager({
        hostId: "custom-host",
        strategy: "timestamp-based",
        actionWindow: 200,
        enablePriority: false,
        enableSequenceNumbers: false,
      });
      expect(customManager).toBeDefined();
    });
  });

  describe("processAction", () => {
    it("should process action without conflict", () => {
      const result = manager.processAction(
        "play-card",
        { cardId: "card-1" },
        "player-1",
        "Player One",
      );

      expect(result.shouldProcess).toBe(true);
      expect(result.action).toBeDefined();
      expect(result.action?.actionType).toBe("play-card");
      expect(result.action?.playerId).toBe("player-1");
      expect(result.conflict).toBeUndefined();
    });

    it("should return action with correct priority", () => {
      const result = manager.processAction(
        "game-end",
        {},
        "player-1",
        "Player One",
      );

      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe("critical");
    });

    it("should assign sequence numbers", () => {
      const result1 = manager.processAction(
        "play-card",
        {},
        "player-1",
        "Player One",
      );
      const result2 = manager.processAction(
        "play-card",
        {},
        "player-1",
        "Player One",
      );

      expect(result1.action?.sequenceNumber).toBe(1);
      expect(result2.action?.sequenceNumber).toBe(2);
    });
  });

  describe("processAction return values", () => {
    it("should return shouldQueue when action should be queued", () => {
      // First process a normal action
      manager.processAction(
        "chat",
        { message: "hello" },
        "player-1",
        "Player One",
      );

      // The chat action should be processed
      const result = manager.processAction(
        "chat",
        { message: "world" },
        "player-1",
        "Player One",
      );
      expect(result.shouldProcess).toBeDefined();
    });

    it("should handle critical actions immediately", () => {
      const result = manager.processAction(
        "game-end",
        {},
        "player-1",
        "Player One",
      );
      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe("critical");
    });

    it("should handle high priority actions", () => {
      const result = manager.processAction(
        "spell-cast",
        { spellId: "lightning" },
        "player-1",
        "Player One",
      );
      expect(result.shouldProcess).toBe(true);
      expect(result.action?.priority).toBe("high");
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      manager.updateConfig({
        strategy: "priority-based",
        actionWindow: 500,
      });

      // Just verify no error thrown
      expect(manager).toBeDefined();
    });

    it("should update host ID", () => {
      manager.updateConfig({
        hostId: "new-host",
      });

      expect(manager).toBeDefined();
    });
  });
});

describe("Action Priority Mapping", () => {
  it("should map critical actions correctly", () => {
    const manager = new ConflictResolutionManager({ hostId: "host" });

    const gameEndResult = manager.processAction("game-end", {}, "p1", "P1");
    expect(gameEndResult.action?.priority).toBe("critical");

    const eliminatedResult = manager.processAction(
      "player-eliminated",
      {},
      "p1",
      "P1",
    );
    expect(eliminatedResult.action?.priority).toBe("critical");

    const correctionResult = manager.processAction(
      "state-correction",
      {},
      "p1",
      "P1",
    );
    expect(correctionResult.action?.priority).toBe("critical");
  });

  it("should map high priority actions correctly", () => {
    const manager = new ConflictResolutionManager({ hostId: "host" });

    const combatResult = manager.processAction(
      "combat-declare",
      {},
      "p1",
      "P1",
    );
    expect(combatResult.action?.priority).toBe("high");

    const spellResult = manager.processAction("spell-cast", {}, "p1", "P1");
    expect(spellResult.action?.priority).toBe("high");

    const abilityResult = manager.processAction(
      "ability-activate",
      {},
      "p1",
      "P1",
    );
    expect(abilityResult.action?.priority).toBe("high");
  });

  it("should map normal priority actions correctly", () => {
    const manager = new ConflictResolutionManager({ hostId: "host" });

    const playCardResult = manager.processAction("play-card", {}, "p1", "P1");
    expect(playCardResult.action?.priority).toBe("normal");

    const attackResult = manager.processAction("attack", {}, "p1", "P1");
    expect(attackResult.action?.priority).toBe("normal");

    const blockResult = manager.processAction("block", {}, "p1", "P1");
    expect(blockResult.action?.priority).toBe("normal");

    const tapResult = manager.processAction("tap", {}, "p1", "P1");
    expect(tapResult.action?.priority).toBe("normal");

    const untapResult = manager.processAction("untap", {}, "p1", "P1");
    expect(untapResult.action?.priority).toBe("normal");
  });

  it("should map low priority actions correctly", () => {
    const manager = new ConflictResolutionManager({ hostId: "host" });

    const chatResult = manager.processAction("chat", {}, "p1", "P1");
    expect(chatResult.action?.priority).toBe("low");

    const emoteResult = manager.processAction("emote", {}, "p1", "P1");
    expect(emoteResult.action?.priority).toBe("low");

    const surrenderResult = manager.processAction("surrender", {}, "p1", "P1");
    expect(surrenderResult.action?.priority).toBe("low");
  });

  it("should default to normal priority for unknown actions", () => {
    const manager = new ConflictResolutionManager({ hostId: "host" });

    const unknownResult = manager.processAction(
      "unknown-action",
      {},
      "p1",
      "P1",
    );
    expect(unknownResult.action?.priority).toBe("normal");
  });
});

describe("Conflict Strategy Configurations", () => {
  it("should handle host-wins strategy", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "host-wins",
    });

    // Process actions from host - should always process
    const hostAction = manager.processAction("play-card", {}, "host-1", "Host");
    expect(hostAction.shouldProcess).toBe(true);

    // Non-host action may or may not process depending on conflict
    const playerAction = manager.processAction(
      "play-card",
      {},
      "player-2",
      "Player 2",
    );
    // Just verify it returns a valid result
    expect(playerAction.shouldProcess).toBeDefined();
  });

  it("should handle timestamp-based strategy", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "timestamp-based",
    });

    expect(manager).toBeDefined();

    const result = manager.processAction(
      "play-card",
      {},
      "player-1",
      "Player One",
    );
    expect(result.shouldProcess).toBe(true);
  });

  it("should handle priority-based strategy", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "priority-based",
    });

    expect(manager).toBeDefined();
  });

  it("should handle round-robin strategy", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "round-robin",
    });

    expect(manager).toBeDefined();
  });

  it("should handle consensus strategy", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      strategy: "consensus",
    });

    expect(manager).toBeDefined();
  });

  it("should handle disabled priority system", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      enablePriority: false,
    });

    const result = manager.processAction(
      "game-end",
      {},
      "player-1",
      "Player One",
    );
    // With priority disabled, even critical actions process normally
    expect(result.shouldProcess).toBe(true);
  });

  it("should handle disabled sequence numbers", () => {
    const manager = new ConflictResolutionManager({
      hostId: "host-1",
      enableSequenceNumbers: false,
    });

    const result1 = manager.processAction(
      "play-card",
      {},
      "player-1",
      "Player One",
    );
    const result2 = manager.processAction(
      "play-card",
      {},
      "player-1",
      "Player One",
    );

    expect(result1.action?.sequenceNumber).toBeDefined();
    expect(result2.action?.sequenceNumber).toBeDefined();
  });
});

describe("Type exports", () => {
  it("should export ActionPriority type", () => {
    const priority: ActionPriority = "critical";
    expect(["critical", "high", "normal", "low"]).toContain(priority);
  });

  it("should export ConflictStrategy type", () => {
    const strategy: ConflictStrategy = "host-wins";
    expect([
      "host-wins",
      "timestamp-based",
      "priority-based",
      "round-robin",
      "consensus",
    ]).toContain(strategy);
  });

  it("should accept all ActionPriority values", () => {
    const priorities: ActionPriority[] = ["critical", "high", "normal", "low"];
    priorities.forEach((p) => expect(p).toBeDefined());
  });

  it("should accept all ConflictStrategy values", () => {
    const strategies: ConflictStrategy[] = [
      "host-wins",
      "timestamp-based",
      "priority-based",
      "round-robin",
      "consensus",
    ];
    strategies.forEach((s) => expect(s).toBeDefined());
  });
});

// =============================================================================
// Issue #1096 — conflict-resolution edge cases
//
// These tests drive REAL conflicts (two players acting within the action
// window) and assert WHICH action wins under each strategy. `Date.now` is
// mocked so every timestamp — and therefore every tie-break — is fully
// deterministic instead of wall-clock dependent.
// =============================================================================

/**
 * Return the action that won a conflict, independent of which side (action1
 * vs action2) it was. Used to prove the winner is the same regardless of the
 * order in which two simultaneous actions arrive.
 */
function winnerOf(conflict: ActionConflict): TimestampedAction {
  return conflict.resolution === "action2-wins"
    ? conflict.action2
    : conflict.action1;
}

/**
 * Read the most-recently recorded conflict from a manager's pending list.
 *
 * IMPORTANT real behaviour: `processAction()` only surfaces `conflict` on its
 * RETURN value for the 'queue' and 'action2-wins' branches. An 'action1-wins'
 * or 'merge' outcome falls through and returns `shouldProcess: true` WITHOUT a
 * `conflict` field — even though the conflict was detected and recorded. So
 * tests read conflicts from `getPendingConflicts()` (populated for every
 * resolution branch at p2p-conflict-resolution.ts:170) to assert uniformly.
 */
function lastConflict(m: ConflictResolutionManager): ActionConflict {
  const all = m.getPendingConflicts();
  return all[all.length - 1];
}

describe("Issue #1096 — conflict detection within the action window", () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  const tick = (ms = 1) => {
    now += ms;
  };
  const manager = (extra: Partial<ConflictResolutionConfig> = {}) =>
    new ConflictResolutionManager({
      hostId: "host",
      strategy: "timestamp-based",
      actionWindow: 100,
      enablePriority: true,
      enableSequenceNumbers: true,
      ...extra,
    });

  it("flags a conflict when two different players act within the window", () => {
    const m = manager();
    m.processAction("play-card", {}, "p1", "One");
    tick(10);
    m.processAction("play-card", {}, "p2", "Two");

    expect(m.getPendingConflicts()).toHaveLength(1);
    const conflict = lastConflict(m);
    expect(conflict.action1.playerId).toBe("p2"); // action1 is the newly-arriving action
    expect(conflict.action2.playerId).toBe("p1");
  });

  it("does NOT conflict when the two actions fall outside the action window", () => {
    const m = manager();
    m.processAction("play-card", {}, "p1", "One");
    tick(200); // > actionWindow (100)
    const result = m.processAction("play-card", {}, "p2", "Two");

    expect(result.conflict).toBeUndefined();
    expect(result.shouldProcess).toBe(true);
  });

  it("does NOT conflict when both actions come from the same player", () => {
    const m = manager();
    m.processAction("play-card", {}, "p1", "One");
    tick(5);
    const result = m.processAction("attack", {}, "p1", "One");

    expect(result.conflict).toBeUndefined();
    expect(result.shouldProcess).toBe(true);
  });
});

describe("Issue #1096 — host-wins strategy", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());
  const tick = (ms = 1) => {
    now += ms;
  };

  it("the host action wins regardless of arrival order", () => {
    // Order A: non-host first, host second.
    const a = new ConflictResolutionManager({
      hostId: "host",
      strategy: "host-wins",
      actionWindow: 100,
    });
    a.processAction("play-card", {}, "guest", "Guest");
    tick(5);
    const aResult = a.processAction("play-card", {}, "host", "Host");
    expect(aResult.shouldProcess).toBe(true); // host wins, processed immediately
    expect(lastConflict(a).resolution).toBe("action1-wins");

    // Order B: host first, non-host second.
    const b = new ConflictResolutionManager({
      hostId: "host",
      strategy: "host-wins",
      actionWindow: 100,
    });
    b.processAction("play-card", {}, "host", "Host");
    tick(5);
    const bResult = b.processAction("play-card", {}, "guest", "Guest");
    expect(bResult.shouldProcess).toBe(false); // guest loses, queued
    expect(bResult.shouldQueue).toBe(true);
    expect(lastConflict(b).resolution).toBe("action2-wins");
    expect(winnerOf(lastConflict(b)).playerId).toBe("host");
  });

  it("when neither player is the host, falls back to the earlier timestamp", () => {
    const m = new ConflictResolutionManager({
      hostId: "host",
      strategy: "host-wins",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "aaa", "A"); // earlier
    tick(7);
    m.processAction("play-card", {}, "bbb", "B"); // later

    expect(m.getPendingConflicts()).toHaveLength(1);
    expect(winnerOf(lastConflict(m)).playerId).toBe("aaa"); // earlier timestamp wins
  });
});

describe("Issue #1096 — timestamp-based strategy (last-writer-loses)", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());
  const tick = (ms = 1) => {
    now += ms;
  };

  it("the earlier-timestamp action wins even if it arrives later", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One"); // ts = T0
    // Move the clock BACK so the second action has an earlier timestamp.
    now -= 5;
    const result = m.processAction("play-card", {}, "p2", "Two"); // ts = T0-5

    expect(m.getPendingConflicts()).toHaveLength(1);
    expect(result.shouldProcess).toBe(true); // earlier timestamp (p2) wins
    expect(winnerOf(lastConflict(m)).playerId).toBe("p2");
  });

  it("the later-timestamp action loses and is enqueued for replay", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One"); // ts = T0
    tick(8);
    const result = m.processAction("play-card", {}, "p2", "Two"); // ts = T0+8

    expect(result.shouldProcess).toBe(false);
    expect(result.shouldQueue).toBe(true);
    expect(result.queueReason).toBe("Lower priority in conflict resolution");
    expect(m.getQueueSize()).toBe(1);

    const next = m.getNextQueuedAction();
    expect(next).not.toBeNull();
    expect(next?.playerId).toBe("p2");
    expect(m.getQueueSize()).toBe(0);
  });
});

describe("Issue #1096 — REGRESSION: deterministic tie-break on equal timestamps", () => {
  // BUG (fixed): previously `action1.timestamp < action2.timestamp ? action1 : action2`
  // resolved equal-timestamp ties to "action2-wins" — i.e. whichever action was
  // processed FIRST. That depends on message arrival order, so two peers
  // receiving the same simultaneous pair in opposite orders picked different
  // winners and silently diverged. The fix breaks ties by lexicographic
  // playerId (mirroring resolveSimultaneousConflict in deterministic-sync),
  // so every peer computes the identical winner. These two tests process the
  // SAME pair in opposite orders and require the SAME winner.

  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it("picks the lexicographically-smaller playerId when timestamps tie (order A)", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 100,
    });
    // 'aaa' processed first (becomes action2 in the conflict), 'bbb' second (action1).
    m.processAction("play-card", {}, "aaa", "A"); // ts = T0 (now constant)
    m.processAction("play-card", {}, "bbb", "B"); // ts = T0  -> tie

    const conflict = lastConflict(m);
    expect(conflict.action1.timestamp).toBe(conflict.action2.timestamp);
    expect(winnerOf(conflict).playerId).toBe("aaa");
  });

  it("picks the same winner when the arrival order is reversed (order B)", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "bbb", "B"); // first
    m.processAction("play-card", {}, "aaa", "A"); // second -> tie

    const conflict = lastConflict(m);
    expect(conflict.action1.timestamp).toBe(conflict.action2.timestamp);
    // Same winner as order A despite reversed arrival — the fix guarantees convergence.
    expect(winnerOf(conflict).playerId).toBe("aaa");
  });
});

describe("Issue #1096 — priority-based ordering", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());
  const tick = (ms = 1) => {
    now += ms;
  };

  it("a higher-priority action beats a lower-priority action regardless of order", () => {
    // 'game-end' is critical, 'play-card' is normal.
    const m1 = new ConflictResolutionManager({
      hostId: "h",
      strategy: "priority-based",
      actionWindow: 100,
    });
    m1.processAction("play-card", {}, "p1", "One"); // normal
    tick(3);
    m1.processAction("game-end", {}, "p2", "Two"); // critical, arrives second
    expect(winnerOf(lastConflict(m1)).priority).toBe("critical");

    const m2 = new ConflictResolutionManager({
      hostId: "h",
      strategy: "priority-based",
      actionWindow: 100,
    });
    m2.processAction("game-end", {}, "p2", "Two"); // critical first
    tick(3);
    m2.processAction("play-card", {}, "p1", "One"); // normal second
    expect(winnerOf(lastConflict(m2)).priority).toBe("critical");
  });

  it("equal priority + equal timestamp tie-breaks deterministically by playerId", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "priority-based",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "zzz", "Z"); // normal, ts T0
    m.processAction("play-card", {}, "aaa", "A"); // normal, ts T0 -> tie

    const conflict = lastConflict(m);
    expect(conflict.action1.priority).toBe(conflict.action2.priority);
    expect(winnerOf(conflict).playerId).toBe("aaa"); // smaller playerId wins
  });
});

describe("Issue #1096 — round-robin & consensus strategies", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());
  const tick = (ms = 1) => {
    now += ms;
  };

  it("round-robin resolves via turn order (stateful, not timestamp-based)", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "round-robin",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One");
    tick(2);
    m.processAction("play-card", {}, "p2", "Two");

    expect(m.getPendingConflicts()).toHaveLength(1);
    const conflict = lastConflict(m);
    expect(conflict.reason).toBe("Round-robin order");
    // The newly-arriving action is appended to the turn order first, so on the
    // very first conflict it wins. This is the documented behaviour: round-
    // robin is turn-based and intentionally arrival-order-sensitive, unlike the
    // timestamp strategies whose determinism is guaranteed separately above.
    expect(conflict.resolution).toBe("action1-wins");
  });

  it("consensus defers both actions for peer agreement without enqueuing", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "consensus",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One");
    tick(2);
    const result = m.processAction("play-card", {}, "p2", "Two");

    expect(result.conflict?.resolution).toBe("queue");
    expect(result.shouldProcess).toBe(false);
    expect(result.shouldQueue).toBe(true);
    expect(result.queueReason).toBe("Conflicting action being processed");
    // The consensus branch returns early and does NOT place the action on the
    // replay queue (it waits for explicit peer agreement).
    expect(m.getQueueSize()).toBe(0);
    expect(m.getPendingConflicts()).toHaveLength(1);
  });
});

describe("Issue #1096 — out-of-order replay queue", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());
  const tick = (ms = 1) => {
    now += ms;
  };

  it("replays queued actions oldest-first (FIFO by queuedAt)", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One"); // ts T0, stays processed (earliest => wins ties)

    tick(10);
    const r2 = m.processAction("play-card", {}, "p2", "Two"); // ts T0+10 => loses, queued
    expect(r2.shouldQueue).toBe(true);
    tick(20);
    const r3 = m.processAction("play-card", {}, "p3", "Three"); // conflicts with p1, loses, queued
    expect(r3.shouldQueue).toBe(true);
    expect(m.getQueueSize()).toBe(2);

    // Oldest queuedAt (p2) must come out before p3.
    const first = m.getNextQueuedAction();
    const second = m.getNextQueuedAction();
    expect(first?.playerId).toBe("p2");
    expect(second?.playerId).toBe("p3");
    expect(m.getNextQueuedAction()).toBeNull();
  });

  it("returns null when the queue is empty", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
    });
    expect(m.getNextQueuedAction()).toBeNull();
  });

  it("clearConflict removes a recorded conflict and reset clears sequence numbers", () => {
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "consensus",
      actionWindow: 100,
    });
    m.processAction("play-card", {}, "p1", "One");
    tick(2);
    const result = m.processAction("play-card", {}, "p2", "Two");
    expect(m.getPendingConflicts()).toHaveLength(1);

    m.clearConflict(result.conflict!.action1.actionId);
    expect(m.getPendingConflicts()).toHaveLength(0);

    // Sequence numbers are per-player and reset() clears them.
    expect(
      m.processAction("play-card", {}, "p1", "One").action?.sequenceNumber,
    ).toBe(2);
    m.reset();
    expect(
      m.processAction("play-card", {}, "p1", "One").action?.sequenceNumber,
    ).toBe(1);
  });
});

describe("Issue #1096 — cleanup evicts stale processed actions", () => {
  it("removes actions older than maxAge so they no longer trigger conflicts", () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    // Use a wide window so p1 WOULD conflict without cleanup.
    const m = new ConflictResolutionManager({
      hostId: "h",
      strategy: "timestamp-based",
      actionWindow: 10_000,
    });
    m.processAction("play-card", {}, "p1", "One"); // ts T0

    now += 5_000; // 5s later, still within the 10s window
    m.cleanup(1_000); // evict actions older than 1s (p1 is 5s old)

    const result = m.processAction("play-card", {}, "p2", "Two");
    // p1 was evicted, so there is no recent other-player action to conflict with.
    expect(result.conflict).toBeUndefined();
    expect(result.shouldProcess).toBe(true);

    jest.restoreAllMocks();
  });
});

describe("Issue #1096 — mergeActions (CRDT-style merge policy)", () => {
  function act(
    actionType: string,
    playerId: string,
    ts: number,
    data: unknown,
  ): TimestampedAction {
    return {
      actionId: `${playerId}-1`,
      playerId,
      playerName: playerId,
      actionType,
      actionData: data,
      timestamp: ts,
      priority: "low",
      sequenceNumber: 1,
      receivedAt: ts,
    };
  }

  it("merges two mergeable chat actions, keeping both payloads and the later timestamp", () => {
    const a = act("chat", "p1", 100, { msg: "hi" });
    const b = act("chat", "p2", 200, { msg: "yo" });
    const merged = mergeActions(a, b);

    expect(merged).not.toBeNull();
    expect(merged?.timestamp).toBe(200); // Math.max
    expect(merged?.actionData).toEqual({
      merged: true,
      actions: [{ msg: "hi" }, { msg: "yo" }],
    });
  });

  it("returns null when either action is non-mergeable (e.g. play-card)", () => {
    const chat = act("chat", "p1", 100, {});
    const card = act("play-card", "p2", 100, { cardId: "c1" });
    expect(mergeActions(chat, card)).toBeNull();
    expect(mergeActions(card, chat)).toBeNull();
  });

  it("merges emote and surrender actions (all mergeable types)", () => {
    const emote = act("emote", "p1", 5, { kind: "wave" });
    const surrender = act("surrender", "p2", 9, {});
    expect(mergeActions(emote, emote)).not.toBeNull();
    expect(mergeActions(surrender, surrender)).not.toBeNull();
  });
});

describe("Issue #1096 — factory", () => {
  it("createConflictResolutionManager returns a configured manager instance", () => {
    const m = createConflictResolutionManager({
      hostId: "factory-host",
      strategy: "priority-based",
    });
    expect(m).toBeInstanceOf(ConflictResolutionManager);
    expect(m.getQueueSize()).toBe(0);
  });
});
