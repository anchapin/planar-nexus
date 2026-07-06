/**
 * Tests for the backpressure-aware per-peer send queue.
 *
 * Issue #1251. Covers lane ordering, watermarks, lane promotion/demotion,
 * hard caps, observability counters, and the drain contract.
 */

import {
  PeerSendQueue,
  SendPriority,
  DropReason,
  byteLengthUtf8,
  classifyMessagePriority,
  DEFAULT_HIGH_WATERMARK_BYTES,
  DEFAULT_LOW_WATERMARK_BYTES,
  DEFAULT_MAX_QUEUE_BYTES,
  type DrainSender,
  type PeerQueueListeners,
  type QueuedMessage,
} from "../peer-send-queue";

function makePayload(label: string, byteSize: number): string {
  const tail = "x".repeat(Math.max(0, byteSize - label.length));
  return `${label}${tail}`;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PeerSendQueue", () => {
  describe("constructor validation", () => {
    it("rejects low watermark >= high watermark", () => {
      expect(() => new PeerSendQueue({ lowWatermarkBytes: 1024, highWatermarkBytes: 512 })).toThrow(
        /lowWatermarkBytes/,
      );
    });

    it("rejects maxQueueBytes < high watermark", () => {
      expect(() =>
        new PeerSendQueue({
          maxQueueBytes: 100,
          highWatermarkBytes: 1024,
          lowWatermarkBytes: 128,
        }),
      ).toThrow(/maxQueueBytes/);
    });

    it("rejects maxQueueMessages <= 0", () => {
      expect(() => new PeerSendQueue({ maxQueueMessages: 0 })).toThrow(/maxQueueMessages/);
    });

    it("accepts the documented defaults", () => {
      const q = new PeerSendQueue();
      const s = q.getStats();
      expect(s.highWatermarkBytes).toBe(DEFAULT_HIGH_WATERMARK_BYTES);
      expect(s.lowWatermarkBytes).toBe(DEFAULT_LOW_WATERMARK_BYTES);
      expect(s.maxQueueBytes).toBe(DEFAULT_MAX_QUEUE_BYTES);
    });
  });

  describe("basic enqueue / drain", () => {
    it("admits messages and reports depth", () => {
      const q = new PeerSendQueue();
      expect(q.enqueue("a", "chat", SendPriority.DROPPABLE, 0)).toBe(true);
      expect(q.enqueue("b", "chat", SendPriority.DROPPABLE, 0)).toBe(true);
      expect(q.depth).toBe(2);
      expect(q.queuedBytes).toBe(byteLengthUtf8("a") + byteLengthUtf8("b"));
    });

    it("drains in FIFO order within a lane", () => {
      const q = new PeerSendQueue();
      q.enqueue("first", "chat", SendPriority.NORMAL, 0);
      q.enqueue("second", "chat", SendPriority.NORMAL, 0);
      q.enqueue("third", "chat", SendPriority.NORMAL, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return true;
      });
      expect(sent).toEqual(["first", "second", "third"]);
      expect(q.depth).toBe(0);
    });

    it("drain stops when sender returns false (backpressure)", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "chat", SendPriority.NORMAL, 0);
      q.enqueue("b", "chat", SendPriority.NORMAL, 0);
      q.enqueue("c", "chat", SendPriority.NORMAL, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return sent.length < 2;
      });
      expect(sent).toEqual(["a", "b"]);
      // b was rejected and re-queued at the head; c is untouched.
      expect(q.depth).toBe(2);
    });

    it("drain no-ops when queue is empty", () => {
      const q = new PeerSendQueue();
      const sender = jest.fn(() => true);
      q.drain(sender);
      expect(sender).not.toHaveBeenCalled();
    });

    it("drain stops when the channel is at the high watermark", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "chat", SendPriority.NORMAL, 0);
      q.enqueue("b", "chat", SendPriority.NORMAL, 0);
      const sender = jest.fn(() => true);
      // Force in-flight above the high watermark — drain must no-op until the
      // channel reports it's drained (notifyBufferLow).
      q.notifyBackpressured(q.getStats().highWatermarkBytes + 1);
      q.drain(sender);
      expect(sender).not.toHaveBeenCalled();
      q.notifyBufferLow(0);
      q.drain(sender);
      expect(sender).toHaveBeenCalledTimes(2);
    });
  });

  describe("lane ordering (CRITICAL > NORMAL > DROPPABLE)", () => {
    it("drains CRITICAL before NORMAL before DROPPABLE", () => {
      const q = new PeerSendQueue();
      q.enqueue("chat1", "chat", SendPriority.DROPPABLE, 0);
      q.enqueue("normal1", "ping", SendPriority.NORMAL, 0);
      q.enqueue("crit1", "game-state-sync", SendPriority.CRITICAL, 0);
      q.enqueue("chat2", "chat", SendPriority.DROPPABLE, 0);
      q.enqueue("normal2", "ping", SendPriority.NORMAL, 0);
      q.enqueue("crit2", "game-state-sync", SendPriority.CRITICAL, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return true;
      });
      expect(sent).toEqual(["crit1", "crit2", "normal1", "normal2", "chat1", "chat2"]);
    });

    it("FIFO is preserved within each lane across mixed enqueues", () => {
      const q = new PeerSendQueue();
      q.enqueue("c1", "game-state-sync", SendPriority.CRITICAL, 0);
      q.enqueue("d1", "chat", SendPriority.DROPPABLE, 0);
      q.enqueue("c2", "game-state-sync", SendPriority.CRITICAL, 0);
      q.enqueue("d2", "chat", SendPriority.DROPPABLE, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return true;
      });
      expect(sent).toEqual(["c1", "c2", "d1", "d2"]);
    });
  });

  describe("watermarks & stall detection", () => {
    it("fires onStalled when in-flight crosses the high watermark", () => {
      const listeners: PeerQueueListeners = {
        onStalled: jest.fn(),
        onResumed: jest.fn(),
      };
      const q = new PeerSendQueue({}, listeners);
      q.notifyBackpressured(q.getStats().highWatermarkBytes + 1);
      expect(q.isStalled).toBe(true);
      expect(listeners.onStalled).toHaveBeenCalledTimes(1);

      // Crossing again does not re-fire.
      q.notifyBackpressured(q.getStats().highWatermarkBytes + 2);
      expect(listeners.onStalled).toHaveBeenCalledTimes(1);
    });

    it("fires onResumed when in-flight drops below the low watermark", () => {
      const listeners: PeerQueueListeners = {
        onStalled: jest.fn(),
        onResumed: jest.fn(),
      };
      const q = new PeerSendQueue({}, listeners);
      q.notifyBackpressured(q.getStats().highWatermarkBytes + 1);
      q.notifyBufferLow(q.getStats().lowWatermarkBytes);
      expect(q.isStalled).toBe(false);
      expect(listeners.onResumed).toHaveBeenCalledTimes(1);

      // Stays un-stalled across further low notifications.
      q.notifyBufferLow(0);
      expect(listeners.onResumed).toHaveBeenCalledTimes(1);
    });

    it("does not transition when in-flight is between watermarks", () => {
      const listeners: PeerQueueListeners = {
        onStalled: jest.fn(),
        onResumed: jest.fn(),
      };
      const q = new PeerSendQueue({}, listeners);
      q.notifyBackpressured(q.getStats().lowWatermarkBytes + 100);
      expect(q.isStalled).toBe(false);
      expect(listeners.onStalled).not.toHaveBeenCalled();
      expect(listeners.onResumed).not.toHaveBeenCalled();
    });

    it("marks stalled automatically when drain pushes in-flight over the watermark", () => {
      const listeners: PeerQueueListeners = {
        onStalled: jest.fn(),
      };
      // low=16, high=80. Two 40-byte sends: first fits (40 <= 80), second
      // pushes to 80 == high, which trips the stalled flag.
      const q = new PeerSendQueue(
        { highWatermarkBytes: 80, lowWatermarkBytes: 16 },
        listeners,
      );
      q.enqueue(makePayload("a", 40), "ping", SendPriority.NORMAL, 0);
      q.enqueue(makePayload("b", 40), "ping", SendPriority.NORMAL, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return true;
      });
      expect(sent.length).toBe(2);
      expect(q.isStalled).toBe(true);
      expect(listeners.onStalled).toHaveBeenCalledTimes(1);
    });
  });

  describe("lane promotion (critical/normal evict droppable)", () => {
    it("evicts oldest droppable first when a CRITICAL message needs room", () => {
      const q = new PeerSendQueue({
        highWatermarkBytes: 128,
        lowWatermarkBytes: 64,
        maxQueueBytes: 250,
        maxQueueMessages: 100,
      });
      q.enqueue(makePayload("chat1", 100), "chat", SendPriority.DROPPABLE, 0);
      q.enqueue(makePayload("chat2", 100), "chat", SendPriority.DROPPABLE, 0);
      expect(q.depth).toBe(2);
      expect(q.queuedBytes).toBe(200);

      const ok = q.enqueue(
        makePayload("critical", 100),
        "game-state-sync",
        SendPriority.CRITICAL,
        0,
      );
      expect(ok).toBe(true);
      // Eviction target = maxQueueBytes - byteSize = 150. We evict the oldest
      // droppable (chat1, 100 bytes freed) until depthBytes <= 150. After
      // eviction: depthBytes=100 (chat2). Admit critical: depthBytes=200.
      expect(q.depth).toBe(2);
      expect(q.queuedBytes).toBe(200);
      expect(q.getStats().totalDropped).toBe(1);
      expect(q.getStats().droppedByType.chat).toBe(1);
    });

    it("evicts droppable until the new message fits", () => {
      const q = new PeerSendQueue({
        maxQueueBytes: 1000,
        highWatermarkBytes: 512,
        lowWatermarkBytes: 100,
        maxQueueMessages: 1000,
      });
      for (let i = 0; i < 10; i++) {
        q.enqueue(makePayload(`chat${i}`, 100), "chat", SendPriority.DROPPABLE, 0);
      }
      expect(q.depth).toBe(10);
      expect(q.queuedBytes).toBe(1000);

      const ok = q.enqueue(
        makePayload("sync", 600),
        "game-state-sync",
        SendPriority.CRITICAL,
        0,
      );
      expect(ok).toBe(true);
      // Pre-eviction: 1000 bytes queued, depth=10. Critical needs 600 bytes.
      // Eviction target = maxQueueBytes - byteSize = 400. We evict the oldest
      // droppable messages until depthBytes <= 400: that means evicting 6 of
      // them (1000 → 400). Then admit critical (depthBytes=400+600=1000,
      // depth=5).
      expect(q.depth).toBe(5);
      expect(q.queuedBytes).toBe(1000);
      expect(q.getStats().totalDropped).toBe(6);
      expect(q.getStats().droppedByType.chat).toBe(6);
    });

    it("rejects a CRITICAL message when even after dropping every droppable it does not fit", () => {
      const q = new PeerSendQueue({
        maxQueueBytes: 200,
        highWatermarkBytes: 128,
        lowWatermarkBytes: 50,
        maxQueueMessages: 2,
      });
      // Fill with critical only — cannot evict.
      q.enqueue(makePayload("c1", 100), "game-state-sync", SendPriority.CRITICAL, 0);
      q.enqueue(makePayload("c2", 100), "game-state-sync", SendPriority.CRITICAL, 0);
      expect(q.depth).toBe(2);

      const ok = q.enqueue(
        makePayload("c3", 100),
        "game-state-sync",
        SendPriority.CRITICAL,
        0,
      );
      expect(ok).toBe(false);
      expect(q.depth).toBe(2);
      // c3 was rejected; c3 records its own drop (capacity).
      expect(q.getStats().totalDropped).toBe(1);
      expect(q.getStats().droppedByType["game-state-sync"]).toBe(1);
    });
  });

  describe("lane demotion (droppable under pressure)", () => {
    it("drops a DROPPABLE message immediately when over the low watermark", () => {
      const q = new PeerSendQueue();
      q.notifyBackpressured(q.getStats().highWatermarkBytes);
      const ok = q.enqueue(
        "chat under pressure",
        "chat",
        SendPriority.DROPPABLE,
        q.getStats().inFlightBytes,
      );
      expect(ok).toBe(false);
      expect(q.depth).toBe(0);
      expect(q.getStats().totalDropped).toBe(1);
      expect(q.getStats().droppedByType.chat).toBe(1);
    });

    it("admits a DROPPABLE message when the channel has room", () => {
      const q = new PeerSendQueue();
      const ok = q.enqueue("hi", "chat", SendPriority.DROPPABLE, 0);
      expect(ok).toBe(true);
      expect(q.depth).toBe(1);
    });

    it("drops DROPPABLE before NORMAL before CRITICAL when over the message cap", () => {
      const q = new PeerSendQueue({
        maxQueueBytes: 100_000,
        maxQueueMessages: 5,
        highWatermarkBytes: 80_000,
        lowWatermarkBytes: 1000,
      });
      q.enqueue("c1", "game-state-sync", SendPriority.CRITICAL, 0);
      q.enqueue("n1", "ping", SendPriority.NORMAL, 0);
      q.enqueue("d1", "chat", SendPriority.DROPPABLE, 0);
      q.enqueue("d2", "chat", SendPriority.DROPPABLE, 0);
      q.enqueue("d3", "chat", SendPriority.DROPPABLE, 0);
      // Queue is now full (5 messages). Adding another CRITICAL needs to evict
      // exactly enough droppable to make room for one more — eviction stops as
      // soon as the new message would fit.
      const ok = q.enqueue("c2", "game-state-sync", SendPriority.CRITICAL, 0);
      expect(ok).toBe(true);
      // Evicted: d1 (the oldest droppable). Kept: c1, n1, d2, d3, c2.
      expect(q.depth).toBe(5);
      expect(q.getStats().totalDropped).toBe(1);
      expect(q.getStats().droppedByType.chat).toBe(1);
    });
  });

  describe("hard caps", () => {
    it("enforces maxQueueBytes", () => {
      const q = new PeerSendQueue({
        maxQueueBytes: 100,
        highWatermarkBytes: 64,
        lowWatermarkBytes: 16,
      });
      q.enqueue(makePayload("a", 60), "ping", SendPriority.NORMAL, 0);
      const ok = q.enqueue(makePayload("b", 60), "ping", SendPriority.NORMAL, 0);
      expect(ok).toBe(false);
      expect(q.depth).toBe(1);
      expect(q.queuedBytes).toBe(60);
    });

    it("enforces maxQueueMessages", () => {
      const q = new PeerSendQueue({
        maxQueueBytes: 100_000,
        maxQueueMessages: 2,
        highWatermarkBytes: 80_000,
        lowWatermarkBytes: 1000,
      });
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      const ok = q.enqueue("c", "ping", SendPriority.NORMAL, 0);
      expect(ok).toBe(false);
      expect(q.depth).toBe(2);
    });
  });

  describe("observability", () => {
    it("tracks per-type drop counts", () => {
      const q = new PeerSendQueue();
      q.notifyBackpressured(q.getStats().highWatermarkBytes);
      q.enqueue("c1", "chat", SendPriority.DROPPABLE, q.getStats().inFlightBytes);
      q.enqueue("c2", "chat", SendPriority.DROPPABLE, q.getStats().inFlightBytes);
      q.enqueue("e1", "emote", SendPriority.DROPPABLE, q.getStats().inFlightBytes);
      const stats = q.getStats();
      expect(stats.totalDropped).toBe(3);
      expect(stats.droppedByType.chat).toBe(2);
      expect(stats.droppedByType.emote).toBe(1);
    });

    it("fires onDropped with reason and stats", () => {
      const onDropped = jest.fn();
      const q = new PeerSendQueue({ maxQueueMessages: 1 }, { onDropped });
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      expect(onDropped).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ping", byteSize: 1 }),
        DropReason.CAPACITY_BYTES,
        expect.any(Object),
      );
    });

    it("getStats returns a defensive copy of droppedByType", () => {
      const q = new PeerSendQueue();
      q.notifyBackpressured(q.getStats().highWatermarkBytes);
      q.enqueue("x", "chat", SendPriority.DROPPABLE, q.getStats().inFlightBytes);
      const s1 = q.getStats();
      (s1.droppedByType as Record<string, number>).hacked = 999;
      const s2 = q.getStats();
      expect(s2.droppedByType.hacked).toBeUndefined();
    });

    it("tracks totalEnqueued and totalSent independently", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      q.notifyBackpressured(q.getStats().highWatermarkBytes);
      q.enqueue("c", "chat", SendPriority.DROPPABLE, q.getStats().inFlightBytes);
      const stats = q.getStats();
      expect(stats.totalEnqueued).toBe(3);
      expect(stats.totalSent).toBe(0);
      expect(stats.totalDropped).toBe(1);
      q.notifyBufferLow(0);
      q.drain(() => true);
      expect(q.getStats().totalSent).toBe(2);
    });
  });

  describe("drain idempotence and re-entrance", () => {
    it("does not double-send when drain is invoked recursively", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      const sent: string[] = [];
      let triggeredRecursion = false;
      q.drain((p) => {
        sent.push(p);
        if (sent.length === 1 && !triggeredRecursion) {
          triggeredRecursion = true;
          q.drain((p2) => {
            sent.push(`inner:${p2}`);
            return true;
          });
        }
        return true;
      });
      // The inner drain consumes everything that was queued when it ran.
      // The outer drain's next iteration finds an empty queue and exits.
      // No message is lost (both a and b are recorded exactly once).
      expect(sent).toEqual(["a", "inner:b"]);
    });

    it("un-shifts a message back when sender returns false", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      const sent: string[] = [];
      q.drain((p) => {
        sent.push(p);
        return false;
      });
      expect(sent).toEqual(["a"]);
      expect(q.depth).toBe(2);
      // After notifying the channel is free, drain again sends both.
      q.notifyBufferLow(0);
      q.drain((p) => {
        sent.push(p);
        return true;
      });
      expect(sent).toEqual(["a", "a", "b"]);
    });
  });

  describe("close()", () => {
    it("refuses enqueue after close", () => {
      const q = new PeerSendQueue();
      q.close();
      expect(q.enqueue("a", "ping", SendPriority.NORMAL, 0)).toBe(false);
      expect(q.isClosed).toBe(true);
    });

    it("drain no-ops after close", () => {
      const q = new PeerSendQueue();
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.close();
      const sender = jest.fn(() => true);
      q.drain(sender);
      expect(sender).not.toHaveBeenCalled();
    });

    it("clear() drops queued messages without firing onDropped", () => {
      const onDropped = jest.fn();
      const q = new PeerSendQueue({}, { onDropped });
      q.enqueue("a", "ping", SendPriority.NORMAL, 0);
      q.enqueue("b", "ping", SendPriority.NORMAL, 0);
      const cleared = q.clear();
      expect(cleared).toBe(2);
      expect(q.depth).toBe(0);
      expect(onDropped).not.toHaveBeenCalled();
    });
  });

  describe("classifyMessagePriority()", () => {
    it("classifies game-state-sync and game-action as CRITICAL", () => {
      expect(classifyMessagePriority("game-state-sync")).toBe(SendPriority.CRITICAL);
      expect(classifyMessagePriority("game-action")).toBe(SendPriority.CRITICAL);
      expect(classifyMessagePriority("player-action")).toBe(SendPriority.CRITICAL);
    });

    it("classifies chat and emote as DROPPABLE", () => {
      expect(classifyMessagePriority("chat")).toBe(SendPriority.DROPPABLE);
      expect(classifyMessagePriority("emote")).toBe(SendPriority.DROPPABLE);
    });

    it("classifies connection-lifecycle and ping/pong as NORMAL", () => {
      expect(classifyMessagePriority("ping")).toBe(SendPriority.NORMAL);
      expect(classifyMessagePriority("pong")).toBe(SendPriority.NORMAL);
      expect(classifyMessagePriority("connection-request")).toBe(SendPriority.NORMAL);
      expect(classifyMessagePriority("connection-accept")).toBe(SendPriority.NORMAL);
      expect(classifyMessagePriority("error")).toBe(SendPriority.NORMAL);
    });

    it("defaults unknown types to NORMAL (never dropped silently)", () => {
      expect(classifyMessagePriority("something-new")).toBe(SendPriority.NORMAL);
    });
  });

  describe("byteLengthUtf8()", () => {
    it("matches TextEncoder for ASCII", () => {
      expect(byteLengthUtf8("hello")).toBe(5);
      expect(byteLengthUtf8("")).toBe(0);
    });

    it("matches TextEncoder for multi-byte UTF-8", () => {
      const cases = ["café", "日本語", "🎮", "Ω≈ç√∫˜µ"];
      for (const s of cases) {
        expect(byteLengthUtf8(s)).toBe(new TextEncoder().encode(s).length);
      }
    });
  });

  describe("end-to-end: throttled peer drains others without blocking", () => {
    it("queues critical messages while the channel is stalled, then drains them after resume", async () => {
      const q = new PeerSendQueue();
      const sent: string[] = [];
      const sender: DrainSender = (p) => {
        sent.push(p);
        return true;
      };

      // Simulate a slow peer: high watermark tripped by a big delta-sync.
      q.notifyBackpressured(q.getStats().highWatermarkBytes);

      // Critical messages still get enqueued.
      expect(
        q.enqueue("sync-1", "game-state-sync", SendPriority.CRITICAL, q.getStats().inFlightBytes),
      ).toBe(true);
      expect(
        q.enqueue("sync-2", "game-state-sync", SendPriority.CRITICAL, q.getStats().inFlightBytes),
      ).toBe(true);
      // Droppable gets dropped under pressure.
      expect(
        q.enqueue("hi", "chat", SendPriority.DROPPABLE, q.getStats().inFlightBytes),
      ).toBe(false);

      // Nothing was sent yet — drain sees in-flight above the watermark.
      q.drain(sender);
      expect(sent).toEqual([]);

      // Peer drains: notify, then drain.
      q.notifyBufferLow(0);
      q.drain(sender);
      expect(sent).toEqual(["sync-1", "sync-2"]);
      expect(q.depth).toBe(0);

      const stats = q.getStats();
      expect(stats.totalEnqueued).toBe(3);
      expect(stats.totalSent).toBe(2);
      expect(stats.totalDropped).toBe(1);
      expect(stats.droppedByType.chat).toBe(1);

      // Sanity: avoid dangling microtasks.
      await flushMicrotasks();
    });
  });
});