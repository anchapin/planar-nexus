import {
  isGameMessage,
  GAME_MESSAGE_TYPES,
  MockDataChannel,
  MockRTCPeerConnection,
} from "./p2p-mock-bridge";

declare global {
  // Injected by the E2E harness; mocked here for unit test purposes.
  function __p2pOutgoing(_peerId: string, _chLabel: string, data: string): void;
}

const NOOP_OUTGOING = () => {};

describe("p2p-mock-bridge", () => {
  beforeEach(() => {
    global.__p2pOutgoing = NOOP_OUTGOING;
  });

  // -------------------------------------------------------------------------
  // isGameMessage
  // -------------------------------------------------------------------------
  describe("isGameMessage", () => {
    const makeMsg = (
      overrides: Partial<import("./p2p-mock-bridge").GameMessage> = {},
    ) => ({
      type: "ping",
      senderId: "alice",
      timestamp: 1_700_000_000_000,
      ...overrides,
    });

    test.each(GAME_MESSAGE_TYPES)("accepts GameMessage type '%s'", (type) => {
      expect(isGameMessage(makeMsg({ type }))).toBe(true);
    });

    test("accepts a minimal valid GameMessage", () => {
      expect(isGameMessage(makeMsg())).toBe(true);
    });

    test("rejects null", () => expect(isGameMessage(null)).toBe(false));
    test("rejects undefined", () =>
      expect(isGameMessage(undefined)).toBe(false));
    test("rejects a string", () => expect(isGameMessage("ping")).toBe(false));
    test("rejects a number", () => expect(isGameMessage(42)).toBe(false));
    test("rejects an array", () => expect(isGameMessage([])).toBe(false));
    test("rejects an object missing type", () =>
      expect(isGameMessage({ senderId: "alice", timestamp: 1 })).toBe(false));
    test("rejects an object with invalid type", () =>
      expect(
        isGameMessage({ type: "evil", senderId: "alice", timestamp: 1 }),
      ).toBe(false));
    test("rejects an object missing senderId", () =>
      expect(isGameMessage({ type: "ping", timestamp: 1 })).toBe(false));
    test("rejects an object with non-string senderId", () =>
      expect(isGameMessage({ type: "ping", senderId: 5, timestamp: 1 })).toBe(
        false,
      ));
    test("rejects an object missing timestamp", () =>
      expect(isGameMessage({ type: "ping", senderId: "alice" })).toBe(false));
    test("rejects an object with non-number timestamp", () =>
      expect(
        isGameMessage({ type: "ping", senderId: "alice", timestamp: "now" }),
      ).toBe(false));
  });

  // -------------------------------------------------------------------------
  // MockDataChannel.send — serialization
  // -------------------------------------------------------------------------
  describe("MockDataChannel.send", () => {
    let ch: MockDataChannel;
    let delivered: { peerId: string; chLabel: string; data: string } | null;

    beforeEach(() => {
      delivered = null;
      global.__p2pOutgoing = (peerId, chLabel, data) => {
        delivered = { peerId, chLabel, data };
      };
      const pc = new MockRTCPeerConnection();
      ch = pc.createDataChannel("game");
    });

    test("calls __p2pOutgoing with serialized string data", () => {
      ch.send("hello world");
      expect(delivered).not.toBeNull();
      expect(delivered!.data).toBe("hello world");
    });

    test("JSON-serializes an object payload", () => {
      const payload = {
        type: "ping",
        senderId: "alice",
        timestamp: 1_700_000_000_000,
      };
      ch.send(payload);
      expect(delivered!.data).toBe(JSON.stringify(payload));
    });

    test("serializes a number", () => {
      ch.send(42);
      expect(delivered!.data).toBe("42");
    });

    test("serializes an array", () => {
      ch.send([1, "two", null]);
      expect(delivered!.data).toBe(JSON.stringify([1, "two", null]));
    });

    test("no-ops when readyState is not 'open'", () => {
      (["connecting", "closing", "closed"] as const).forEach((state) => {
        delivered = null;
        ch.readyState = state;
        ch.send("test");
        expect(delivered).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // MockDataChannel.send — enqueue when no onmessage handler
  // -------------------------------------------------------------------------
  describe("MockDataChannel enqueue (no onmessage handler)", () => {
    let ch: MockDataChannel;

    beforeEach(() => {
      ch = new MockDataChannel("game");
      ch.readyState = "open";
    });

    test("queues messages when onmessage is null", () => {
      expect(ch.onmessage).toBeNull();
      ch.send("first");
      ch.send("second");
      // No onmessage, so messages are queued
      expect((ch as unknown as { _queue: string[] })._queue).toEqual([
        "first",
        "second",
      ]);
    });

    test("delivers queued messages when onmessage is later set", () => {
      const received: string[] = [];
      ch.send("queued-1");
      ch.send("queued-2");
      ch.onmessage = (e) => received.push(e.data);
      (ch as unknown as { _flushQueue: () => void })._flushQueue();
      expect(received).toEqual(["queued-1", "queued-2"]);
    });

    test("delivers directly to onmessage when handler exists", () => {
      const received: string[] = [];
      ch.onmessage = (e) => received.push(e.data);
      ch.send("direct");
      expect(received).toEqual(["direct"]);
      expect((ch as unknown as { _queue: string[] })._queue).toEqual([]);
    });

    test("does not queue when readyState is not open", () => {
      ch.readyState = "closed";
      ch.send("lost");
      expect((ch as unknown as { _queue: string[] })._queue).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // MockRTCPeerConnection.createOffer / createAnswer — SDP validity
  // -------------------------------------------------------------------------
  describe("MockRTCPeerConnection SDP structure", () => {
    let pc: MockRTCPeerConnection;

    beforeEach(() => {
      pc = new MockRTCPeerConnection();
    });

    test("createOffer resolves with type 'offer' and non-empty sdp string", async () => {
      const offer = await pc.createOffer();
      expect(offer.type).toBe("offer");
      expect(typeof offer.sdp).toBe("string");
      expect(offer.sdp.length).toBeGreaterThan(0);
    });

    test("createAnswer resolves with type 'answer' and non-empty sdp string", async () => {
      const answer = await pc.createAnswer();
      expect(answer.type).toBe("answer");
      expect(typeof answer.sdp).toBe("string");
      expect(answer.sdp.length).toBeGreaterThan(0);
    });

    test("SDP contains expected session-level markers", async () => {
      const offer = await pc.createOffer();
      expect(offer.sdp).toContain("v=0");
      expect(offer.sdp).toContain("IN IP4");
    });
  });

  // -------------------------------------------------------------------------
  // MockRTCPeerConnection state machine
  // -------------------------------------------------------------------------
  describe("MockRTCPeerConnection state machine", () => {
    test("starts in 'new' state", () => {
      const pc = new MockRTCPeerConnection();
      expect(pc.connectionState).toBe("new");
      expect(pc.isConnected()).toBe(false);
    });

    test("transitions to 'connecting' after createDataChannel", () => {
      const pc = new MockRTCPeerConnection();
      pc.createDataChannel("game");
      expect(pc.connectionState).toBe("connecting");
    });

    test("transitions to 'connected' after data channel opens", async () => {
      const pc = new MockRTCPeerConnection();
      pc.createDataChannel("game");
      await Promise.resolve(); // flush queueMicrotask
      expect(pc.connectionState).toBe("connected");
      expect(pc.isConnected()).toBe(true);
    });

    test("transitions to 'closed' after close()", () => {
      const pc = new MockRTCPeerConnection();
      pc.createDataChannel("game");
      pc.close();
      expect(pc.connectionState).toBe("closed");
      expect(pc.isConnected()).toBe(false);
    });

    test("createDataChannel returns an open MockDataChannel", () => {
      const pc = new MockRTCPeerConnection();
      const ch = pc.createDataChannel("game");
      expect(ch).toBeInstanceOf(MockDataChannel);
      expect(ch.readyState).toBe("open");
      expect(ch.label).toBe("game");
    });

    test("closing the connection closes all data channels", () => {
      const pc = new MockRTCPeerConnection();
      const ch = pc.createDataChannel("game");
      pc.close();
      expect(ch.readyState).toBe("closed");
    });
  });
});
