/**
 * @fileoverview ReplayBuffer tests (issue #1432).
 *
 * `src/lib/replay-buffer.ts` is an in-memory action buffer (no persistence),
 * so the issue's three axes map onto its real public contract:
 *   1. Round-trip / integrity — `addAction` → `getBufferedActions` preserves
 *      the action payload and metadata (receivedAt, applied) faithfully;
 *      `addActions` de-duplicates by action id; trimming evicts oldest-first
 *      while keeping currentIndex in range.
 *   2. Version / boundary handling — `validateJoin` enforces the game-age
 *      boundary and warns on advanced games; `seekTo` bounds-checks its
 *      index; the singleton factory caches its instance.
 *   3. Adversarial input — `addAction` performs NO validation; we pin that
 *      empty/oddly-shaped actions are accepted verbatim (so a future
 *      schema guard is a deliberate diff).
 *
 * Playback uses `jest.useFakeTimers()` because the playback loop is driven
 * by `setInterval` (delay = 100ms / speed).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  ReplayBuffer,
  BufferedAction,
  ReplayState,
  getReplayBuffer,
  resetReplayBuffer,
} from "../replay-buffer";
import type { GameAction } from "../action-broadcast";

function makeAction(overrides: Partial<GameAction> = {}): GameAction {
  return {
    id: `act-${Math.random().toString(36).slice(2)}`,
    type: "cast-spell",
    playerId: "p1",
    timestamp: 1_700_000_000_000,
    payload: { cardId: "c1" },
    ...overrides,
  };
}

describe("replay-buffer", () => {
  let buffer: ReplayBuffer;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(1_700_000_000_000));
    resetReplayBuffer();
    buffer = new ReplayBuffer();
  });

  afterEach(() => {
    buffer.clear();
    resetReplayBuffer();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Constructor / defaults
  // -------------------------------------------------------------------
  describe("constructor", () => {
    it("applies default size and age limits", () => {
      const b = new ReplayBuffer();
      // Defaults are exercised via trim + validateJoin below.
      expect(b.getActionCount()).toBe(0);
      expect(b.getState()).toBe("idle" as ReplayState);
    });

    it("honours custom options", () => {
      const b = new ReplayBuffer({
        maxBufferSize: 3,
        maxGameAge: 1000,
        gameStartTime: 100,
      });
      // Indirectly observable: validateJoin uses maxGameAge=1000ms.
      // now=1_700_000_000_000 (set above), gameStartTime=100 → very old.
      const result = b.validateJoin();
      expect(result.canJoin).toBe(false);
      expect(result.reason).toBe("Game is too old to join");
    });
  });

  // -------------------------------------------------------------------
  // 1. Round-trip / integrity
  // -------------------------------------------------------------------
  describe("add → read round-trip", () => {
    it("preserves the action payload and stamps receivedAt/applied=false", () => {
      const action = makeAction({ id: "a1" });
      buffer.addAction(action);

      const buffered = buffer.getBufferedActions();
      expect(buffered).toHaveLength(1);
      expect(buffered[0].action).toEqual(action);
      expect(buffered[0].receivedAt).toBe(1_700_000_000_000);
      expect(buffered[0].applied).toBe(false);
      expect(buffered[0].appliedAt).toBeUndefined();
    });

    it("increments getActionCount and emits progress", () => {
      const progress: number[] = [];
      buffer.setProgressHandler((p) => progress.push(p.percentage));

      buffer.addAction(makeAction());
      buffer.addAction(makeAction());

      expect(buffer.getActionCount()).toBe(2);
      expect(progress).toEqual([0, 0]); // nothing applied yet → 0%
    });

    it("addActions de-duplicates by action.id", () => {
      const shared = makeAction({ id: "dup" });
      buffer.addActions([shared, makeAction({ id: "b" }), shared]);

      expect(buffer.getActionCount()).toBe(2);
      expect(buffer.getBufferedActions().map((b) => b.action.id)).toEqual([
        "dup",
        "b",
      ]);
    });

    it("addActions with an empty array is a no-op", () => {
      buffer.addActions([]);
      expect(buffer.getActionCount()).toBe(0);
    });

    it("trims to maxBufferSize evicting oldest-first and keeps currentIndex in range", () => {
      const small = new ReplayBuffer({ maxBufferSize: 3 });
      small.addAction(makeAction({ id: "1" }));
      small.addAction(makeAction({ id: "2" }));
      small.addAction(makeAction({ id: "3" }));

      // Move currentIndex forward so the trim's clamp is exercised.
      small.seekTo(1);
      expect(small.getCurrentIndex()).toBe(1);

      small.addAction(makeAction({ id: "4" })); // exceeds 3 → shift "1", clamp index

      expect(small.getActionCount()).toBe(3);
      expect(small.getBufferedActions().map((b) => b.action.id)).toEqual([
        "2",
        "3",
        "4",
      ]);
      // currentIndex was 1; after shift it is clamped to max(0, 1-1)=0.
      expect(small.getCurrentIndex()).toBe(0);
    });

    it("getUnappliedActions slices from currentIndex", () => {
      buffer.addActions([
        makeAction({ id: "1" }),
        makeAction({ id: "2" }),
        makeAction({ id: "3" }),
      ]);
      buffer.seekTo(1); // applies [0], currentIndex = 1
      // slice(1) → actions at indices 1 and 2.
      expect(buffer.getUnappliedActions().map((b) => b.action.id)).toEqual([
        "2",
        "3",
      ]);
    });
  });

  // -------------------------------------------------------------------
  // 2. Boundary / validation behavior
  // -------------------------------------------------------------------
  describe("validateJoin", () => {
    it("allows joining a fresh, small game", () => {
      const fresh = new ReplayBuffer({ gameStartTime: Date.now() });
      fresh.addAction(makeAction());
      const result = fresh.validateJoin();
      expect(result.canJoin).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.actionCount).toBe(1);
    });

    it("rejects a game older than maxGameAge", () => {
      const old = new ReplayBuffer({
        gameStartTime: Date.now() - 3 * 60 * 60 * 1000, // 3h > 2h default
      });
      const result = old.validateJoin();
      expect(result.canJoin).toBe(false);
      expect(result.reason).toBe("Game is too old to join");
      expect(result.gameAge).toBeGreaterThan(2 * 60 * 60 * 1000);
    });

    it("warns (but still allows) when the game has > 500 actions", () => {
      const b = new ReplayBuffer({ gameStartTime: Date.now() });
      for (let i = 0; i < 501; i++) b.addAction(makeAction({ id: `${i}` }));
      const result = b.validateJoin();
      expect(result.canJoin).toBe(true);
      expect(result.reason).toBe("Warning: Late join to advanced game");
      expect(result.actionCount).toBe(501);
    });

    it("reports oldestActionTimestamp from the first buffered action", () => {
      const b = new ReplayBuffer({ gameStartTime: 5 });
      b.addAction(makeAction());
      const first = b.getBufferedActions()[0];
      const result = b.validateJoin();
      expect(result.oldestActionTimestamp).toBe(first.receivedAt);
    });
  });

  describe("seekTo bounds checking", () => {
    beforeEach(() => {
      buffer.addActions([
        makeAction({ id: "1" }),
        makeAction({ id: "2" }),
        makeAction({ id: "3" }),
      ]);
    });

    it("ignores a negative index (with a console warning)", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      buffer.seekTo(-1);
      expect(buffer.getCurrentIndex()).toBe(0);
      expect(warn).toHaveBeenCalledWith("Invalid seek index");
    });

    it("ignores an out-of-range high index", () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      buffer.seekTo(99);
      expect(buffer.getCurrentIndex()).toBe(0);
    });

    it("marks every action up to the index as applied and fires the handler", () => {
      const applied: number[] = [];
      buffer.setActionHandler((_a, i) => applied.push(i));
      buffer.seekTo(2);
      expect(applied).toEqual([0, 1, 2]);
      expect(
        buffer.getBufferedActions().every((b) => b.applied && b.appliedAt),
      ).toBe(true);
      expect(buffer.getCurrentIndex()).toBe(2);
    });

    it("does not re-apply already-applied actions on a subsequent seek", () => {
      buffer.setActionHandler((_a, i) => {});
      buffer.seekTo(2);
      const appliedSpy = jest.fn();
      buffer.setActionHandler(appliedSpy);
      buffer.seekTo(2); // all already applied
      expect(appliedSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // 3. Playback (fake timers)
  // -------------------------------------------------------------------
  describe("playback loop", () => {
    function seed(n: number): void {
      for (let i = 0; i < n; i++) buffer.addAction(makeAction({ id: `a${i}` }));
    }

    it("startReplay on an empty buffer is a no-op (warns)", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const states: ReplayState[] = [];
      buffer.setStateChangeHandler((s) => states.push(s));
      buffer.startReplay();
      expect(warn).toHaveBeenCalledWith("No actions to replay");
      expect(buffer.getState()).toBe("idle");
      expect(states).toEqual([]); // no transition emitted
    });

    it("plays through all actions and reaches 'completed'", () => {
      seed(2);
      const applied: string[] = [];
      buffer.setActionHandler((a) => applied.push(a.id));
      const states: ReplayState[] = [];
      buffer.setStateChangeHandler((s) => states.push(s));

      buffer.startReplay(); // delay = 100ms (speed 1)
      expect(buffer.getState()).toBe("playing");

      // 2 actions → apply on tick 1 (100ms) and tick 2 (200ms);
      // tick 3 (300ms) sees currentIndex>target → completes.
      jest.advanceTimersByTime(100);
      expect(applied).toEqual(["a0"]);
      jest.advanceTimersByTime(100);
      expect(applied).toEqual(["a0", "a1"]);
      jest.advanceTimersByTime(100);
      expect(buffer.getState()).toBe("completed");
      expect(states[states.length - 1]).toBe("completed");
    });

    it("emits a replay-completed event and records it", () => {
      seed(1);
      buffer.startReplay();
      jest.advanceTimersByTime(300); // apply + completion tick
      const types = buffer.getEvents().map((e) => e.type);
      expect(types).toContain("replay-started");
      expect(types).toContain("replay-completed");
    });

    it("pauseReplay only acts when playing/fast-forwarding", () => {
      seed(2);
      // idle → no-op
      buffer.pauseReplay();
      expect(buffer.getState()).toBe("idle");

      buffer.startReplay();
      buffer.pauseReplay();
      expect(buffer.getState()).toBe("paused");
      // paused → pauseReplay is a no-op
      buffer.pauseReplay();
      expect(buffer.getState()).toBe("paused");
    });

    it("resumeReplay only acts when paused", () => {
      seed(2);
      buffer.startReplay();
      // playing → resume is a no-op
      buffer.resumeReplay();
      expect(buffer.getState()).toBe("playing");

      buffer.pauseReplay();
      buffer.resumeReplay();
      expect(buffer.getState()).toBe("playing");
    });

    it("setSpeed restarts the playback interval at the new rate", () => {
      seed(4);
      buffer.startReplay(); // 100ms/tick
      jest.advanceTimersByTime(100); // a0 applied
      buffer.setSpeed(4); // now 25ms/tick → 3 remaining actions
      // 3 actions left → 4 ticks (25ms each) to finish.
      jest.advanceTimersByTime(100);
      expect(buffer.getState()).toBe("completed");
    });

    it("stopReplay returns to idle and halts playback", () => {
      seed(3);
      buffer.startReplay();
      jest.advanceTimersByTime(100);
      buffer.stopReplay();
      expect(buffer.getState()).toBe("idle");
      const appliedBefore = buffer
        .getBufferedActions()
        .filter((b) => b.applied).length;
      jest.advanceTimersByTime(1000);
      expect(buffer.getBufferedActions().filter((b) => b.applied).length).toBe(
        appliedBefore,
      ); // no further progress
    });
  });

  describe("fast-forward", () => {
    function seed(n: number): void {
      for (let i = 0; i < n; i++) buffer.addAction(makeAction({ id: `a${i}` }));
    }

    it("is a no-op when already at or past the target", () => {
      seed(3);
      buffer.seekTo(2);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      buffer.startFastForward(); // target = length-1 = 2, currentIndex = 2 → warn
      expect(warn).toHaveBeenCalledWith("Already at or before target index");
      expect(buffer.getState()).toBe("idle");
    });

    it("fast-forwards to a target index at maximum speed", () => {
      seed(4);
      const applied: string[] = [];
      buffer.setActionHandler((a) => applied.push(a.id));
      buffer.startFastForward(3); // currentIndex is 0 → proceeds; speed 16
      expect(buffer.getState()).toBe("fast-forwarding");
      // speed 16 → delay ≈ 6.25ms; advance enough to cover apply + completion.
      // The playback loop applies every index unconditionally (including 0),
      // so all four actions are emitted before the completion tick.
      jest.advanceTimersByTime(200);
      expect(buffer.getState()).toBe("completed");
      expect(applied).toEqual(["a0", "a1", "a2", "a3"]);
    });
  });

  describe("jumpToEnd / progress", () => {
    it("jumpToEnd marks everything applied and moves to completed", () => {
      buffer.addActions([makeAction({ id: "1" }), makeAction({ id: "2" })]);
      buffer.jumpToEnd();
      expect(buffer.getState()).toBe("completed");
      expect(buffer.getProgress().percentage).toBe(100);
    });

    it("getProgress reports 0% on an empty buffer", () => {
      expect(buffer.getProgress()).toEqual({
        totalActions: 0,
        appliedActions: 0,
        percentage: 0,
        estimatedTimeRemaining: 0,
      });
    });

    it("getProgress estimates remaining time from applied-action spacing", () => {
      buffer.addActions([
        makeAction({ id: "1" }),
        makeAction({ id: "2" }),
        makeAction({ id: "3" }),
      ]);
      // Apply two actions with a known time gap.
      buffer.seekTo(0);
      jest.advanceTimersByTime(50);
      buffer.getBufferedActions()[1].applied = true;
      buffer.getBufferedActions()[1].appliedAt = Date.now();
      const progress = buffer.getProgress();
      expect(progress.totalActions).toBe(3);
      expect(progress.appliedActions).toBe(2);
      expect(progress.estimatedTimeRemaining).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------
  // 4. Adversarial input (no validation — pins the gap)
  // -------------------------------------------------------------------
  describe("adversarial input (addAction accepts anything)", () => {
    it("accepts an action missing optional fields verbatim", () => {
      const minimal = {
        id: "x",
        type: "take-action",
        playerId: "p",
        timestamp: 1,
        payload: {},
      } as GameAction;
      buffer.addAction(minimal);
      expect(buffer.getBufferedActions()[0].action).toEqual(minimal);
    });

    it("accepts duplicate ids via addAction (only addActions dedupes)", () => {
      // addAction itself has no dedupe — only addActions checks ids.
      const a = makeAction({ id: "same" });
      buffer.addAction(a);
      buffer.addAction(a);
      expect(buffer.getActionCount()).toBe(2);
    });

    it("handles a very large batch without throwing", () => {
      const actions: GameAction[] = Array.from({ length: 1000 }, (_, i) =>
        makeAction({ id: `m${i}` }),
      );
      expect(() => buffer.addActions(actions)).not.toThrow();
      expect(buffer.getActionCount()).toBe(1000);
    });
  });

  // -------------------------------------------------------------------
  // 5. clear + events cap + singleton factory
  // -------------------------------------------------------------------
  describe("clear / events / singleton", () => {
    it("clear resets state, actions, index and events", () => {
      buffer.addActions([makeAction(), makeAction()]);
      buffer.startReplay();
      jest.advanceTimersByTime(50);

      buffer.clear();
      expect(buffer.getActionCount()).toBe(0);
      expect(buffer.getCurrentIndex()).toBe(0);
      expect(buffer.getState()).toBe("idle");
      expect(buffer.getEvents()).toEqual([]);
    });

    it("keeps only the last 100 events", () => {
      buffer.addActions(
        Array.from({ length: 60 }, (_, i) => makeAction({ id: `a${i}` })),
      );
      buffer.startReplay();
      // Each startReplay emits one event; cap is exercised by many seeks.
      buffer.stopReplay();
      for (let i = 0; i < 120; i++) {
        // jumpToEnd emits a replay-completed event each call.
        buffer.jumpToEnd();
      }
      expect(buffer.getEvents().length).toBeLessThanOrEqual(100);
    });

    it("getReplayBuffer returns a cached singleton until reset", () => {
      const a = getReplayBuffer();
      const b = getReplayBuffer();
      expect(b).toBe(a);
      resetReplayBuffer();
      const c = getReplayBuffer();
      expect(c).not.toBe(a);
    });
  });
});
