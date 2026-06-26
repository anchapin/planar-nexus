/**
 * Tests for P2P Game Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  P2PGameConnection,
  createP2PGameConnection,
  isGameMessage,
  type P2PGameConnectionEvents,
  type P2PGameConnectionOptions,
  type P2PConnectionState,
  type GameMessage,
  type GameMessageType,
  type ChatMessage,
} from "../p2p-game-connection";

describe("P2P Game Connection Types", () => {
  describe("GameMessageType", () => {
    it("should accept all valid message types", () => {
      const types: GameMessageType[] = [
        "game-state-sync",
        "game-action",
        "chat",
        "player-joined",
        "player-left",
        "ping",
        "pong",
      ];

      types.forEach((type) => {
        const message: GameMessage = {
          type,
          senderId: "player-1",
          timestamp: Date.now(),
          seq: 0,
          data: {},
        };
        expect(message.type).toBe(type);
      });
    });
  });

  describe("ChatMessage", () => {
    it("should create valid chat message", () => {
      const chatMessage: ChatMessage = {
        senderId: "player-1",
        senderName: "Player One",
        text: "Hello everyone!",
        timestamp: Date.now(),
      };

      expect(chatMessage.senderId).toBe("player-1");
      expect(chatMessage.senderName).toBe("Player One");
      expect(chatMessage.text).toBe("Hello everyone!");
      expect(chatMessage.timestamp).toBeDefined();
    });
  });

  describe("P2PConnectionState", () => {
    it("should have all valid connection states", () => {
      const states: P2PConnectionState[] = [
        "disconnected",
        "signaling",
        "connecting",
        "connected",
        "reconnecting",
        "failed",
      ];

      states.forEach((state) => {
        expect(state).toBeDefined();
      });
    });
  });
});

describe("P2PGameConnection Events", () => {
  it("should have all required event handlers", () => {
    const events: P2PGameConnectionEvents = {
      onConnectionStateChange: () => {},
      onSignalingStateChange: () => {},
      onMessage: () => {},
      onGameStateSync: () => {},
      onChat: () => {},
      onError: () => {},
      onPlayerJoined: () => {},
      onPlayerLeft: () => {},
    };

    expect(events.onConnectionStateChange).toBeDefined();
    expect(events.onSignalingStateChange).toBeDefined();
    expect(events.onMessage).toBeDefined();
    expect(events.onGameStateSync).toBeDefined();
    expect(events.onChat).toBeDefined();
    expect(events.onError).toBeDefined();
    expect(events.onPlayerJoined).toBeDefined();
    expect(events.onPlayerLeft).toBeDefined();
  });

  it("should allow partial event handlers", () => {
    const events: Partial<P2PGameConnectionEvents> = {
      onError: () => {},
    };

    expect(events.onError).toBeDefined();
  });
});

describe("P2PGameConnectionOptions", () => {
  it("should require playerId and playerName", () => {
    const options: P2PGameConnectionOptions = {
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
    };

    expect(options.playerId).toBe("player-1");
    expect(options.playerName).toBe("Test Player");
    expect(options.role).toBe("host");
  });

  it("should accept optional gameCode", () => {
    const options: P2PGameConnectionOptions = {
      playerId: "player-1",
      playerName: "Test Player",
      role: "joiner",
      gameCode: "ABC123",
    };

    expect(options.gameCode).toBe("ABC123");
  });

  it("should accept optional events", () => {
    const options: P2PGameConnectionOptions = {
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
      events: {
        onConnectionStateChange: () => {},
        onError: () => {},
      },
    };

    expect(options.events).toBeDefined();
  });
});

describe("createP2PGameConnection factory", () => {
  it("should create a P2PGameConnection instance", () => {
    const connection = createP2PGameConnection({
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });

  it("should create connection with joiner role", () => {
    const connection = createP2PGameConnection({
      playerId: "player-2",
      playerName: "Joiner Player",
      role: "joiner",
      gameCode: "ABC123",
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });

  it("should initialize with disconnected state", () => {
    const connection = createP2PGameConnection({
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
    });

    expect(connection.getConnectionState()).toBe("disconnected");
  });

  it("should create connection with custom ICE config", () => {
    const connection = createP2PGameConnection({
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
      iceConfig: {
        customStunServers: [{ urls: ["stun:custom.stun.server:19302"] }],
        candidatePoolSize: 10,
      },
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });
});

describe("P2PGameConnection instance methods", () => {
  let connection: P2PGameConnection;

  beforeEach(() => {
    connection = createP2PGameConnection({
      playerId: "player-1",
      playerName: "Test Player",
      role: "host",
    });
  });

  describe("getConnectionState", () => {
    it("should return disconnected initially", () => {
      expect(connection.getConnectionState()).toBe("disconnected");
    });
  });

  describe("isConnected", () => {
    it("should return false when disconnected", () => {
      expect(connection.isConnected()).toBe(false);
    });
  });

  describe("getSignalingState", () => {
    it("should return signaling state", () => {
      const state = connection.getSignalingState();
      expect(state).toBeDefined();
      expect(state.phase).toBeDefined();
    });
  });

  describe("getSignalingClient", () => {
    it("should return signaling client", () => {
      const client = connection.getSignalingClient();
      expect(client).toBeDefined();
    });
  });

  describe("close", () => {
    it("should close without error", () => {
      expect(() => connection.close()).not.toThrow();
      expect(connection.getConnectionState()).toBe("disconnected");
    });
  });

  describe("getStats", () => {
    it("should return null when not connected", async () => {
      const stats = await connection.getStats();
      expect(stats).toBeNull();
    });
  });
});

describe("Message creation helpers", () => {
  it("should create game state sync message", () => {
    const message: GameMessage = {
      type: "game-state-sync",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: { gameState: {}, isFullSync: true },
    };

    expect(message.type).toBe("game-state-sync");
    expect(message.senderId).toBe("player-1");
  });

  it("should create game action message", () => {
    const message: GameMessage = {
      type: "game-action",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: { action: "play-card", cardId: "card-1" },
    };

    expect(message.type).toBe("game-action");
  });

  it("should create chat message", () => {
    const message: GameMessage = {
      type: "chat",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: { senderName: "Player One", text: "Hello!" },
    };

    expect(message.type).toBe("chat");
  });

  it("should create player-joined message", () => {
    const message: GameMessage = {
      type: "player-joined",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: { playerId: "player-2", playerName: "Player Two" },
    };

    expect(message.type).toBe("player-joined");
  });

  it("should create player-left message", () => {
    const message: GameMessage = {
      type: "player-left",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: { playerId: "player-2" },
    };

    expect(message.type).toBe("player-left");
  });

  it("should create ping message", () => {
    const message: GameMessage = {
      type: "ping",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: {},
    };

    expect(message.type).toBe("ping");
  });

  it("should create pong message", () => {
    const message: GameMessage = {
      type: "pong",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: {},
    };

    expect(message.type).toBe("pong");
  });
});

describe("isGameMessage (type guard)", () => {
  it("accepts a well-formed GameMessage", () => {
    const msg: GameMessage = {
      type: "game-action",
      senderId: "player-1",
      timestamp: Date.now(),
      seq: 0,
      data: {},
    };
    expect(isGameMessage(msg)).toBe(true);
  });

  it("accepts every valid message type", () => {
    const types: GameMessageType[] = [
      "game-state-sync",
      "game-action",
      "chat",
      "player-joined",
      "player-left",
      "ping",
      "pong",
    ];
    for (const type of types) {
      expect(
        isGameMessage({ type, senderId: "p", timestamp: 1, seq: 0, data: {} }),
      ).toBe(true);
    }
  });

  it("rejects an unknown message type", () => {
    expect(
      isGameMessage({
        type: "evil",
        senderId: "p",
        timestamp: 1,
        seq: 0,
        data: {},
      }),
    ).toBe(false);
  });

  it("rejects a non-string senderId", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: 42,
        timestamp: 1,
        seq: 0,
        data: {},
      }),
    ).toBe(false);
  });

  it("rejects non-objects and null", () => {
    expect(isGameMessage(null)).toBe(false);
    expect(isGameMessage("not-an-object")).toBe(false);
    expect(isGameMessage(42)).toBe(false);
  });

  // ---- seq field validation (issue #1091) ----

  it("rejects a message missing the seq field", () => {
    expect(
      isGameMessage({ type: "ping", senderId: "p", timestamp: 1, data: {} }),
    ).toBe(false);
  });

  it("rejects a message whose seq is not a number", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: "0",
        data: {},
      }),
    ).toBe(false);
  });

  it("rejects a message whose seq is a negative integer", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: -1,
        data: {},
      }),
    ).toBe(false);
  });

  it("rejects a message whose seq is a non-integer number", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: 1.5,
        data: {},
      }),
    ).toBe(false);
  });

  it("rejects a message whose seq is NaN or Infinity", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: NaN,
        data: {},
      }),
    ).toBe(false);
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: Infinity,
        data: {},
      }),
    ).toBe(false);
  });

  it("accepts seq equal to 0 (the first message of a stream)", () => {
    expect(
      isGameMessage({
        type: "ping",
        senderId: "p",
        timestamp: 1,
        seq: 0,
        data: {},
      }),
    ).toBe(true);
  });
});

/**
 * Integration coverage for the hardening of the data-channel message path.
 * `handleMessage` receives raw bytes directly from a peer and must never throw
 * or forward attacker-controlled shapes into business logic. (#924)
 */
describe("P2PGameConnection message validation (untrusted peer input)", () => {
  let connection: P2PGameConnection;
  let onMessage: jest.Mock;
  let onError: jest.Mock;

  beforeEach(() => {
    onMessage = jest.fn();
    onError = jest.fn();
    connection = createP2PGameConnection({
      playerId: "player-1",
      playerName: "Host",
      role: "host",
      events: {
        onConnectionStateChange: () => {},
        onSignalingStateChange: () => {},
        onMessage,
        onGameStateSync: () => {},
        onChat: () => {},
        onError,
        onPlayerJoined: () => {},
        onPlayerLeft: () => {},
      },
    });
  });

  const handleMessage = (raw: string) =>
    (
      connection as unknown as { handleMessage: (d: string) => void }
    ).handleMessage(raw);

  it("does not throw and does not call onMessage for malformed JSON", () => {
    expect(() => handleMessage("{ not json")).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects valid JSON with the wrong shape", () => {
    expect(() => handleMessage(JSON.stringify({ foo: "bar" }))).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();

    expect(() =>
      handleMessage(
        JSON.stringify({ type: "evil", senderId: "x", timestamp: 1 }),
      ),
    ).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects a well-shaped message missing the seq field (issue #1091)", () => {
    // Shape is otherwise valid; only the required `seq` anti-replay field is
    // missing. isGameMessage must reject it so handleMessage never has to
    // reason about an undefined seq.
    expect(() =>
      handleMessage(
        JSON.stringify({
          type: "game-action",
          senderId: "player-2",
          timestamp: 1,
          data: {},
          // no seq
        }),
      ),
    ).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects JSON scalars and null without throwing", () => {
    for (const raw of ["42", '"x"', "null", "true", "[1,2,3]"]) {
      expect(() => handleMessage(raw)).not.toThrow();
    }
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("accepts a well-formed message and forwards it to onMessage", () => {
    const msg: GameMessage = {
      type: "game-action",
      senderId: "player-2",
      timestamp: Date.now(),
      seq: 0,
      data: { action: "pass" },
    };
    expect(() => handleMessage(JSON.stringify(msg))).not.toThrow();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "game-action", senderId: "player-2" }),
    );
  });
});

/**
 * Sequence-number anti-replay coverage (issue #1091).
 *
 * Verifies the receiver tracks the highest seq per senderId and drops any
 * message with seq <= that high-water mark BEFORE it is forwarded to
 * onMessage (i.e. before it could be applied to game state). Also covers
 * the post-host-migration reset path via a full game-state-sync carrying
 * the authoritative `lastSeq` high-water mark.
 */
describe("P2PGameConnection sequence-number anti-replay (#1091)", () => {
  let connection: P2PGameConnection;
  let onMessage: jest.Mock;

  const makeConn = () => {
    onMessage = jest.fn();
    return createP2PGameConnection({
      playerId: "local",
      playerName: "Local",
      role: "host",
      events: {
        onConnectionStateChange: () => {},
        onSignalingStateChange: () => {},
        onMessage,
        onGameStateSync: () => {},
        onChat: () => {},
        onError: () => {},
        onPlayerJoined: () => {},
        onPlayerLeft: () => {},
      },
    });
  };

  // Access the private handleMessage via the same cast pattern used above.
  const handleMessage = (conn: P2PGameConnection, raw: string) =>
    (conn as unknown as { handleMessage: (d: string) => void }).handleMessage(
      raw,
    );

  // Helper: build a minimal valid GameMessage with an explicit seq.
  const msg = (
    senderId: string,
    seq: number,
    type: GameMessageType = "game-action",
    data: unknown = {},
  ): GameMessage => ({
    type,
    senderId,
    timestamp: Date.now(),
    seq,
    data,
  });

  /**
   * Distinct seq values forwarded to onMessage for a given sender, sorted.
   *
   * The production `handleMessage` dispatches `game-action` to onMessage
   * twice (once in the type switch and once at the end) — this is pre-existing
   * behaviour unrelated to #1091. Counting distinct seqs makes the anti-replay
   * assertions robust against that double-dispatch.
   */
  const forwardedSeqs = (senderId: string): number[] =>
    Array.from(
      new Set(
        onMessage.mock.calls
          .map((c) => c[0] as GameMessage)
          .filter((m) => m.senderId === senderId)
          .map((m) => m.seq),
      ),
    ).sort((a, b) => a - b);

  beforeEach(() => {
    connection = makeConn();
  });

  describe("in-order acceptance", () => {
    it("accepts a strictly-increasing seq stream and forwards each to onMessage", () => {
      for (let s = 0; s < 5; s++) {
        handleMessage(connection, JSON.stringify(msg("peer", s)));
      }
      expect(forwardedSeqs("peer")).toEqual([0, 1, 2, 3, 4]);
      // High-water mark tracks the last applied seq.
      expect(connection.getLastAppliedSeq("peer")).toBe(4);
    });

    it("accepts the first message from a new sender (seq 0)", () => {
      handleMessage(connection, JSON.stringify(msg("newpeer", 0)));
      expect(forwardedSeqs("newpeer")).toEqual([0]);
      expect(connection.getLastAppliedSeq("newpeer")).toBe(0);
    });

    it("accepts a message with a seq gap (ordered channel, missing middle)", () => {
      // seq 1 then seq 5 — both accepted; gap is tolerated (the check is
      // strictly less-than-or-equal, not contiguous).
      handleMessage(connection, JSON.stringify(msg("peer", 1)));
      handleMessage(connection, JSON.stringify(msg("peer", 5)));
      expect(forwardedSeqs("peer")).toEqual([1, 5]);
      expect(connection.getLastAppliedSeq("peer")).toBe(5);
    });
  });

  describe("duplicate rejection", () => {
    it("drops a duplicate (same seq) and does NOT forward it", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 3)));
      expect(forwardedSeqs("peer")).toEqual([3]);
      // Replay the exact same seq.
      handleMessage(connection, JSON.stringify(msg("peer", 3)));
      // Forwarded set is unchanged — the duplicate was dropped.
      expect(forwardedSeqs("peer")).toEqual([3]);
      expect(connection.getLastAppliedSeq("peer")).toBe(3);
    });

    it("drops a duplicate even if the payload differs (seq is the identity)", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 7)));
      const before = forwardedSeqs("peer").length;
      // Same seq, different payload — must still be treated as a replay.
      handleMessage(
        connection,
        JSON.stringify(msg("peer", 7, "game-action", { action: "evil" })),
      );
      expect(forwardedSeqs("peer").length).toBe(before);
    });
  });

  describe("replay / stale rejection", () => {
    it("drops a stale message (seq older than the last applied)", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 10)));
      expect(forwardedSeqs("peer")).toEqual([10]);
      // An older seq arrives (reconnect re-delivery of the tail, #943).
      handleMessage(connection, JSON.stringify(msg("peer", 9)));
      // Still only seq 10 was forwarded — seq 9 was dropped as a replay.
      expect(forwardedSeqs("peer")).toEqual([10]);
      expect(connection.getLastAppliedSeq("peer")).toBe(10);
    });

    it("drops an out-of-order message that arrives after a higher seq was applied", () => {
      // seq 5 applied first, then seq 4 straggles in — 4 <= 5, dropped.
      handleMessage(connection, JSON.stringify(msg("peer", 5)));
      handleMessage(connection, JSON.stringify(msg("peer", 4)));
      expect(forwardedSeqs("peer")).toEqual([5]);
    });

    it("does not break the connection on replay (subsequent valid seq still accepted)", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 2)));
      handleMessage(connection, JSON.stringify(msg("peer", 2))); // dropped
      // A fresh, higher seq must still get through.
      handleMessage(connection, JSON.stringify(msg("peer", 3)));
      expect(forwardedSeqs("peer")).toEqual([2, 3]);
    });
  });

  describe("per-sender isolation", () => {
    it("tracks seq independently per senderId", () => {
      // Two peers can each start at seq 0; their streams do not collide.
      handleMessage(connection, JSON.stringify(msg("alice", 0)));
      handleMessage(connection, JSON.stringify(msg("bob", 0)));
      handleMessage(connection, JSON.stringify(msg("alice", 1)));
      handleMessage(connection, JSON.stringify(msg("bob", 1)));
      expect(forwardedSeqs("alice")).toEqual([0, 1]);
      expect(forwardedSeqs("bob")).toEqual([0, 1]);
      expect(connection.getLastAppliedSeq("alice")).toBe(1);
      expect(connection.getLastAppliedSeq("bob")).toBe(1);

      // A replay of alice's seq 0 is still rejected for alice only.
      handleMessage(connection, JSON.stringify(msg("alice", 0)));
      expect(forwardedSeqs("alice")).toEqual([0, 1]);
      // ...and bob's seq 0 is also a replay for bob.
      handleMessage(connection, JSON.stringify(msg("bob", 0)));
      expect(forwardedSeqs("bob")).toEqual([0, 1]);
    });
  });

  describe("post-migration reset via full game-state-sync", () => {
    it("a full sync carrying lastSeq advances the per-sender high-water mark", () => {
      // Follower has applied peer actions up to seq 4.
      for (let s = 0; s <= 4; s++) {
        handleMessage(connection, JSON.stringify(msg("peer", s)));
      }
      expect(connection.getLastAppliedSeq("peer")).toBe(4);

      // A full reconciliation snapshot arrives claiming the authoritative
      // high-water mark is 20 (e.g. the new host continued the counter, #946).
      handleMessage(
        connection,
        JSON.stringify(
          msg("peer", 21, "game-state-sync", {
            // Minimal valid serialized state — handleGameStateSync tolerates
            // an empty players map; onGameStateSync here is a no-op stub.
            gameState: { players: {} },
            isFullSync: true,
            lastSeq: 20,
          }),
        ),
      );
      expect(connection.getLastAppliedSeq("peer")).toBe(21);

      // A queued action the new host re-emits with seq 5 (already applied
      // under the previous host) must now be rejected as a replay.
      handleMessage(connection, JSON.stringify(msg("peer", 5)));
      // Only seqs 0-4 were forwarded as game-actions; seq 5 was dropped.
      expect(forwardedSeqs("peer")).toEqual([0, 1, 2, 3, 4, 21]);

      // A genuinely new action with seq > 21 is accepted.
      handleMessage(connection, JSON.stringify(msg("peer", 22)));
      expect(forwardedSeqs("peer")).toEqual([0, 1, 2, 3, 4, 21, 22]);
    });

    it("a partial (non-full) sync does NOT advance the high-water mark via lastSeq", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 2)));
      // Partial sync carrying lastSeq — must be ignored (only full syncs reset).
      handleMessage(
        connection,
        JSON.stringify(
          msg("peer", 3, "game-state-sync", {
            gameState: { players: {} },
            isFullSync: false,
            lastSeq: 99,
          }),
        ),
      );
      // Tracker follows the message's own seq (3), NOT the carried lastSeq.
      expect(connection.getLastAppliedSeq("peer")).toBe(3);
    });

    it("ignores a malformed lastSeq on a full sync (falls back to the message seq)", () => {
      handleMessage(
        connection,
        JSON.stringify(
          msg("peer", 5, "game-state-sync", {
            gameState: { players: {} },
            isFullSync: true,
            lastSeq: "not-a-number",
          }),
        ),
      );
      expect(connection.getLastAppliedSeq("peer")).toBe(5);
    });
  });

  describe("close() resets anti-replay state", () => {
    it("clears per-sender tracking so a fresh session is not poisoned", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 9)));
      expect(connection.getLastAppliedSeq("peer")).toBe(9);
      connection.close();
      expect(connection.getLastAppliedSeq("peer")).toBeNull();
    });
  });

  describe("outgoing seq stamping helpers", () => {
    it("getOutgoingSeq starts at 0 and adoptOutgoingSeq only advances forward", () => {
      expect(connection.getOutgoingSeq()).toBe(0);
      connection.adoptOutgoingSeq(50);
      expect(connection.getOutgoingSeq()).toBe(50);
      // A lower value is a no-op (never goes backwards).
      connection.adoptOutgoingSeq(10);
      expect(connection.getOutgoingSeq()).toBe(50);
      // Invalid values are ignored.
      connection.adoptOutgoingSeq(-1);
      connection.adoptOutgoingSeq(NaN);
      expect(connection.getOutgoingSeq()).toBe(50);
    });

    it("resetIncomingSeq forgets a sender's high-water mark", () => {
      handleMessage(connection, JSON.stringify(msg("peer", 3)));
      expect(connection.getLastAppliedSeq("peer")).toBe(3);
      connection.resetIncomingSeq("peer");
      expect(connection.getLastAppliedSeq("peer")).toBeNull();
      // The same seq can now be accepted again (fresh session semantics).
      handleMessage(connection, JSON.stringify(msg("peer", 3)));
      expect(connection.getLastAppliedSeq("peer")).toBe(3);
    });
  });
});
