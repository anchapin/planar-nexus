/**
 * Tests for the reusable per-sender anti-replay tracker.
 * Issue #1087: extracted as a shared primitive so the mesh and the 1:1
 * connection share one identical replay-protection policy.
 */

import { AntiReplayTracker } from "../anti-replay-tracker";

describe("AntiReplayTracker", () => {
  let tracker: AntiReplayTracker;

  beforeEach(() => {
    tracker = new AntiReplayTracker();
  });

  describe("first message from a sender", () => {
    it("accepts seq 0 from a brand-new sender (not a replay)", () => {
      expect(tracker.isReplay("peer-a", 0)).toBe(false);
    });

    it("reports null for an unseen sender before any message", () => {
      expect(tracker.getLastApplied("peer-a")).toBeNull();
    });
  });

  describe("in-order acceptance + monotonic high-water mark", () => {
    it("advances the high-water mark as seqs increase", () => {
      for (let s = 0; s < 5; s++) {
        expect(tracker.isReplay("peer-a", s)).toBe(false);
        tracker.markApplied("peer-a", s);
      }
      expect(tracker.getLastApplied("peer-a")).toBe(4);
    });

    it("accepts a seq gap (the check is <=, not contiguous)", () => {
      tracker.markApplied("peer-a", 1);
      expect(tracker.isReplay("peer-a", 5)).toBe(false);
      tracker.markApplied("peer-a", 5);
      expect(tracker.getLastApplied("peer-a")).toBe(5);
    });
  });

  describe("duplicate rejection", () => {
    it("flags an identical seq as a replay after it was applied", () => {
      tracker.markApplied("peer-a", 3);
      expect(tracker.isReplay("peer-a", 3)).toBe(true);
    });

    it("does not regress the high-water mark when re-marking an old seq", () => {
      tracker.markApplied("peer-a", 7);
      tracker.markApplied("peer-a", 2); // stale — ignored
      expect(tracker.getLastApplied("peer-a")).toBe(7);
    });
  });

  describe("stale / out-of-order rejection", () => {
    it("flags an older seq as a replay", () => {
      tracker.markApplied("peer-a", 10);
      expect(tracker.isReplay("peer-a", 9)).toBe(true);
      expect(tracker.isReplay("peer-a", 10)).toBe(true);
    });

    it("flags a straggler that arrives after a higher seq was applied", () => {
      tracker.markApplied("peer-a", 5);
      expect(tracker.isReplay("peer-a", 4)).toBe(true);
    });
  });

  describe("per-sender isolation (scales to N senders)", () => {
    it("tracks each sender independently — both can start at seq 0", () => {
      expect(tracker.isReplay("alice", 0)).toBe(false);
      tracker.markApplied("alice", 0);
      // Bob is unaffected by Alice's stream.
      expect(tracker.isReplay("bob", 0)).toBe(false);
      tracker.markApplied("bob", 0);

      expect(tracker.getLastApplied("alice")).toBe(0);
      expect(tracker.getLastApplied("bob")).toBe(0);
      expect(tracker.trackedSenderCount).toBe(2);

      // Alice replaying her own seq 0 is still caught.
      expect(tracker.isReplay("alice", 0)).toBe(true);
    });

    it("tracks many senders without cross-contamination", () => {
      for (let i = 0; i < 6; i++) {
        const id = `peer-${i}`;
        expect(tracker.isReplay(id, 0)).toBe(false);
        tracker.markApplied(id, 0);
        tracker.markApplied(id, 1);
      }
      expect(tracker.trackedSenderCount).toBe(6);
      // A replay from any one sender is caught.
      expect(tracker.isReplay("peer-3", 1)).toBe(true);
      // While a new sender is still accepted.
      expect(tracker.isReplay("peer-new", 0)).toBe(false);
    });
  });

  describe("advanceTo (full-sync reconciliation, #946/#1091)", () => {
    it("jumps the high-water mark forward without a message", () => {
      tracker.markApplied("host", 4);
      tracker.advanceTo("host", 50);
      expect(tracker.getLastApplied("host")).toBe(50);
      // Everything up to 50 is now a replay.
      expect(tracker.isReplay("host", 50)).toBe(true);
      expect(tracker.isReplay("host", 49)).toBe(true);
      expect(tracker.isReplay("host", 51)).toBe(false);
    });

    it("uses max so a duplicate snapshot delivery is still a replay", () => {
      tracker.advanceTo("host", 20);
      tracker.advanceTo("host", 20); // idempotent
      expect(tracker.getLastApplied("host")).toBe(20);
      expect(tracker.isReplay("host", 20)).toBe(true);
    });

    it("ignores invalid (negative / NaN) seqs", () => {
      tracker.advanceTo("host", 5);
      tracker.advanceTo("host", -1);
      tracker.advanceTo("host", Number.NaN);
      expect(tracker.getLastApplied("host")).toBe(5);
    });
  });

  describe("resetSender / clear", () => {
    it("resetSender makes the sender look brand-new again", () => {
      tracker.markApplied("peer-a", 9);
      tracker.resetSender("peer-a");
      expect(tracker.getLastApplied("peer-a")).toBeNull();
      expect(tracker.isReplay("peer-a", 0)).toBe(false);
    });

    it("clear wipes every sender", () => {
      tracker.markApplied("a", 1);
      tracker.markApplied("b", 2);
      tracker.clear();
      expect(tracker.trackedSenderCount).toBe(0);
      expect(tracker.getLastApplied("a")).toBeNull();
    });
  });

  describe("realistic interleaved stream (3 senders)", () => {
    it("drops replays and accepts fresh seqs across interleaved senders", () => {
      type Msg = { sender: string; seq: number };
      // Interleaved arrivals from three peers.
      const stream: Msg[] = [
        { sender: "a", seq: 0 },
        { sender: "b", seq: 0 },
        { sender: "c", seq: 0 },
        { sender: "a", seq: 1 },
        { sender: "b", seq: 1 },
        { sender: "a", seq: 1 }, // replay of a:1
        { sender: "c", seq: 0 }, // replay of c:0
        { sender: "c", seq: 1 },
        { sender: "b", seq: 0 }, // stale replay of b:0
      ];
      const accepted: Msg[] = [];
      for (const m of stream) {
        if (!tracker.isReplay(m.sender, m.seq)) {
          tracker.markApplied(m.sender, m.seq);
          accepted.push(m);
        }
      }
      expect(accepted).toEqual([
        { sender: "a", seq: 0 },
        { sender: "b", seq: 0 },
        { sender: "c", seq: 0 },
        { sender: "a", seq: 1 },
        { sender: "b", seq: 1 },
        { sender: "c", seq: 1 },
      ]);
    });
  });
});
