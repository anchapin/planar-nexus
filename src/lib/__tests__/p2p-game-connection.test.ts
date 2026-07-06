/**
 * Tests for P2P Game Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  P2PGameConnection,
  createP2PGameConnection,
  createRulesEngineValidator,
  isGameMessage,
  type P2PGameConnectionEvents,
  type P2PGameConnectionOptions,
  type P2PConnectionState,
  type GameMessage,
  type GameMessageType,
  type ChatMessage,
  type PeerActionValidator,
  type LobbyControlPayload,
} from "../p2p-game-connection";
import { ValidationService } from "../game-state/validation-service";

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

/**
 * Authoritative-host game-action validation coverage (issue #1089).
 *
 * On the host, an incoming peer `game-action` must be validated against the
 * rules engine BEFORE it is applied. Legal actions pass through to onMessage;
 * illegal actions are rejected (not applied) and the originating peer is
 * notified via a typed `error` message. This stage composes with — and runs
 * strictly after — the rate-limit, structural, and anti-replay checks.
 */
describe("P2PGameConnection host action validation (#1089)", () => {
  let onMessage: jest.Mock;
  let onError: jest.Mock;
  let sendSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Build a connection whose `send` is spied on so we can assert on the
   * rejection feedback message without a live data channel.
   */
  const makeConn = (
    opts: {
      validator?: PeerActionValidator;
      enabled?: boolean;
    } = {},
  ): P2PGameConnection => {
    onMessage = jest.fn();
    onError = jest.fn();
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      validatePeerActions: opts.enabled ?? true,
      validatePeerAction: opts.validator ?? jest.fn(() => ({ isValid: true })),
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
    sendSpy = jest.spyOn(conn, "send");
    return conn;
  };

  const handleMessage = (conn: P2PGameConnection, raw: string) =>
    (conn as unknown as { handleMessage: (d: string) => void }).handleMessage(
      raw,
    );

  /** Build a `game-action` message with a strict-increasing seq stream. */
  const actionMsg = (
    senderId: string,
    seq: number,
    action = "pass_priority",
    data: unknown = {},
  ): GameMessage => ({
    type: "game-action",
    senderId,
    timestamp: Date.now(),
    seq,
    data: { action, data },
  });

  /** Distinct forwarded seqs for a sender (robust to single-dispatch). */
  const forwardedSeqs = (senderId: string): number[] =>
    Array.from(
      new Set(
        onMessage.mock.calls
          .map((c) => c[0] as GameMessage)
          .filter((m) => m.senderId === senderId && m.type === "game-action")
          .map((m) => m.seq),
      ),
    ).sort((a, b) => a - b);

  describe("legal actions", () => {
    it("applies a legal action (forwards to onMessage)", () => {
      const conn = makeConn({
        validator: () => ({ isValid: true }),
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      expect(forwardedSeqs("peer")).toEqual([0]);
    });

    it("does not send a rejection for a legal action", () => {
      const conn = makeConn({
        validator: () => ({ isValid: true }),
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 1)));
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("illegal actions", () => {
    it("rejects an illegal action and does NOT apply it (not forwarded)", () => {
      const conn = makeConn({
        validator: () => ({ isValid: false, reason: "Not your turn" }),
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      expect(forwardedSeqs("peer")).toEqual([]);
      expect(onMessage).not.toHaveBeenCalled();
    });

    it("notifies the peer of the rejection with a typed error message", () => {
      const conn = makeConn({
        validator: () => ({ isValid: false, reason: "Not your turn" }),
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 7, "cast_spell")));
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect(sent.type).toBe("error");
      expect(sent.senderId).toBe("host");
      expect(sent.data).toEqual(
        expect.objectContaining({
          code: "action_rejected",
          action: "cast_spell",
          reason: "Not your turn",
          rejectedSeq: 7,
        }),
      );
      // The rejection itself carries a monotonic seq (anti-replay compatible).
      expect(typeof sent.seq).toBe("number");
    });

    it("uses a default reason when the validator omits one", () => {
      const conn = makeConn({
        validator: () => ({ isValid: false }),
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect((sent.data as { reason: string }).reason).toBe(
        "Action rejected by host",
      );
    });

    it("does not corrupt host state: a later legal action still applies", () => {
      const conn = makeConn({
        validator: (action) =>
          action.action === "evil"
            ? { isValid: false, reason: "Illegal" }
            : { isValid: true },
      });
      // Illegal first — rejected, not applied.
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0, "evil")));
      // Then a legal action with a higher seq — accepted and applied.
      handleMessage(
        conn,
        JSON.stringify(actionMsg("peer", 1, "pass_priority")),
      );
      expect(forwardedSeqs("peer")).toEqual([1]);
    });
  });

  describe("fail-closed on bad input / validator misbehaviour", () => {
    it("rejects a malformed action payload (no action string) without calling the validator", () => {
      const validator = jest.fn(() => ({ isValid: true }));
      const conn = makeConn({ validator });
      // Valid GameMessage shape, but its data lacks an `action` string.
      handleMessage(
        conn,
        JSON.stringify({
          type: "game-action",
          senderId: "peer",
          timestamp: 1,
          seq: 0,
          data: { notAnAction: true },
        }),
      );
      expect(forwardedSeqs("peer")).toEqual([]);
      expect(validator).not.toHaveBeenCalled();
      // Peer is still notified of the rejection.
      const sent = sendSpy.mock.calls[sendSpy.mock.calls.length - 1]?.[0] as
        | GameMessage
        | undefined;
      expect(sent?.type).toBe("error");
    });

    it("rejects when the validator throws (never applies)", () => {
      const conn = makeConn({
        validator: () => {
          throw new Error("boom");
        },
      });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      expect(forwardedSeqs("peer")).toEqual([]);
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect((sent.data as { reason: string }).reason).toBe("boom");
    });

    it("fail-closes when the gate is enabled but no validator is wired", () => {
      // Build directly so the option is genuinely absent.
      onMessage = jest.fn();
      onError = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "host",
        playerName: "Host",
        role: "host",
        validatePeerActions: true,
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
      sendSpy = jest.spyOn(conn, "send");
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      expect(forwardedSeqs("peer")).toEqual([]);
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect((sent.data as { reason: string }).reason).toBe(
        "No action validator configured",
      );
    });
  });

  describe("opt-in gate (single-player / AI unaffected)", () => {
    it("does not validate when validatePeerActions is disabled (default)", () => {
      const validator = jest.fn();
      const conn = makeConn({ enabled: false, validator });
      // Even though the validator would reject, the gate is off so the action
      // passes straight through to onMessage.
      handleMessage(conn, JSON.stringify(actionMsg("peer", 0)));
      expect(validator).not.toHaveBeenCalled();
      expect(forwardedSeqs("peer")).toEqual([0]);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("composition with earlier pipeline stages", () => {
    it("anti-replay drops a duplicate BEFORE validation runs (no regression #1091)", () => {
      const validator = jest.fn(() => ({ isValid: true }));
      const conn = makeConn({ validator });
      handleMessage(conn, JSON.stringify(actionMsg("peer", 5)));
      // Replay the same seq — dropped by anti-replay; validator must NOT be
      // consulted again for it and no extra forwarding occurs.
      handleMessage(conn, JSON.stringify(actionMsg("peer", 5)));
      expect(forwardedSeqs("peer")).toEqual([5]);
      // Validator called exactly once (for the first, accepted message only).
      expect(validator).toHaveBeenCalledTimes(1);
      // A genuinely new action is still validated and forwarded.
      handleMessage(conn, JSON.stringify(actionMsg("peer", 6)));
      expect(validator).toHaveBeenCalledTimes(2);
      expect(forwardedSeqs("peer")).toEqual([5, 6]);
    });

    it("rejects a well-shaped message missing the seq field (no regression #1091)", () => {
      const validator = jest.fn();
      const conn = makeConn({ validator });
      expect(() =>
        handleMessage(
          conn,
          JSON.stringify({
            type: "game-action",
            senderId: "peer",
            timestamp: 1,
            data: { action: "pass_priority", data: {} },
          }),
        ),
      ).not.toThrow();
      expect(validator).not.toHaveBeenCalled();
      expect(onMessage).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON before validation (no regression #924/#951)", () => {
      const validator = jest.fn();
      const conn = makeConn({ validator });
      expect(() => handleMessage(conn, "{ not json")).not.toThrow();
      expect(validator).not.toHaveBeenCalled();
      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  describe("incoming error message (rejection feedback to the peer)", () => {
    it("surfaces a received error message via onError and onMessage without failing", () => {
      const conn = makeConn();
      handleMessage(
        conn,
        JSON.stringify({
          type: "error",
          senderId: "host",
          timestamp: 1,
          seq: 0,
          data: { code: "action_rejected", reason: "Not your turn" },
        }),
      );
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((onError.mock.calls[0][0] as Error).message).toBe("Not your turn");
      // Also forwarded for app-level handling.
      expect(onMessage).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * The rules-engine validator factory (issue #1089). It must delegate to
 * `ValidationService.validateAction`, mapping the wire payload + senderId to
 * the engine's `GameAction` and validating against the host's OWN state.
 */
describe("createRulesEngineValidator (#1089)", () => {
  it("delegates to ValidationService.validateAction with the mapped action", () => {
    const fakeState = { status: "in_progress" } as never;
    const spy = jest
      .spyOn(ValidationService, "validateAction")
      .mockReturnValue({ isValid: true });

    const validator = createRulesEngineValidator(() => fakeState, "commander");
    const result = validator(
      { action: "cast_spell", data: { cardId: "c1" } },
      "peer-1",
    );

    expect(result).toEqual({ isValid: true, reason: undefined });
    expect(spy).toHaveBeenCalledTimes(1);
    const [stateArg, actionArg, modeArg] = spy.mock.calls[0];
    expect(stateArg).toBe(fakeState);
    expect(actionArg).toMatchObject({
      type: "cast_spell",
      playerId: "peer-1",
      data: { cardId: "c1" },
    });
    expect(modeArg).toBe("commander");
    spy.mockRestore();
  });

  it("propagates the engine's rejection reason", () => {
    const fakeState = {} as never;
    const spy = jest
      .spyOn(ValidationService, "validateAction")
      .mockReturnValue({ isValid: false, reason: "Not enough mana" });

    const validator = createRulesEngineValidator(() => fakeState);
    const result = validator({ action: "cast_spell", data: {} }, "peer-2");

    expect(result).toEqual({ isValid: false, reason: "Not enough mana" });
    spy.mockRestore();
  });
});

/**
 * Authoritative-state reconciliation after an ICE-restart reconnect
 * (issue #1086).
 *
 * Covers the connection-layer pieces:
 *   - `onReconnect` fires exactly once on a reconnect (recovery after a
 *     drop), never on the initial connect, and never twice for one recovery.
 *   - `request-state-sync` message: a peer pulls a fresh authoritative full
 *     snapshot and the host responds via `onStateSyncRequest`; non-host /
 *     unwired / null / throwing callbacks are handled gracefully.
 *   - the request message is a valid `GameMessage`.
 *
 * The pure reconcile POLICY (host pushes / peer adopts / pending drop) is
 * covered in `p2p-reconciliation.test.ts`; the lastSeq re-base of the
 * anti-replay counter on a full sync is covered in the #1091 block above.
 */
describe("P2PGameConnection reconnect reconciliation (issue #1086)", () => {
  const setState = (conn: P2PGameConnection, state: string): void => {
    (
      conn as unknown as {
        updateConnectionState: (s: string) => void;
      }
    ).updateConnectionState(state);
  };

  const handleMessage = (conn: P2PGameConnection, raw: string): void => {
    (
      conn as unknown as { handleMessage: (d: string) => void }
    ).handleMessage(raw);
  };

  const msg = (
    senderId: string,
    seq: number,
    type: GameMessageType,
    data: unknown,
  ): GameMessage => ({
    type,
    senderId,
    timestamp: Date.now(),
    seq,
    data,
  });

  describe("onReconnect event", () => {
    it("does NOT fire on the initial connect", () => {
      const onReconnect = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "host",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          onReconnect,
        },
      });

      setState(conn, "connected");
      expect(onReconnect).not.toHaveBeenCalled();
    });

    it("fires exactly once when recovering after a disconnect", () => {
      const onReconnect = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "host",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          onReconnect,
        },
      });

      // Initial connect.
      setState(conn, "connected");
      expect(onReconnect).not.toHaveBeenCalled();

      // Transport drops (ICE-restart disconnect).
      setState(conn, "disconnected");
      setState(conn, "reconnecting");

      // Recovery → onReconnect fires exactly once.
      setState(conn, "connected");
      expect(onReconnect).toHaveBeenCalledTimes(1);

      // A duplicate "connected" transition does not re-fire.
      setState(conn, "connected");
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it("does not fire when the initial connect follows a disconnect from a fresh (never-connected) session", () => {
      const onReconnect = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "host",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          onReconnect,
        },
      });

      // A fresh session that bounces disconnected→connected before ever
      // having connected must NOT be treated as a reconnect.
      setState(conn, "disconnected");
      setState(conn, "connected");
      expect(onReconnect).not.toHaveBeenCalled();
    });

    it("close() resets the reconnect-edge detector (fresh session does not fire)", () => {
      const onReconnect = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "host",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          onReconnect,
        },
      });

      setState(conn, "connected");
      setState(conn, "disconnected");
      setState(conn, "connected");
      expect(onReconnect).toHaveBeenCalledTimes(1);

      conn.close();
      onReconnect.mockClear();

      // After close, a new connect cycle must not fire onReconnect.
      setState(conn, "connected");
      expect(onReconnect).not.toHaveBeenCalled();
    });
  });

  describe("request-state-sync message", () => {
    it("is a valid GameMessage type", () => {
      expect(
        isGameMessage({
          type: "request-state-sync",
          senderId: "peer",
          timestamp: Date.now(),
          seq: 0,
          data: null,
        }),
      ).toBe(true);
    });

    it("host responds to a request by pushing its authoritative full state", () => {
      const authoritative = { gameId: "g1", players: {} } as never;
      const onStateSyncRequest = jest.fn(() => authoritative);
      const conn = createP2PGameConnection({
        playerId: "host",
        playerName: "Host",
        role: "host",
        onStateSyncRequest,
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
        },
      });
      // Spy on the public push path (avoids depending on serialization
      // internals; the lastSeq re-base on the wire is covered in the #1091
      // block above).
      const pushSpy = jest.spyOn(conn, "sendGameState").mockReturnValue(true);

      handleMessage(
        conn,
        JSON.stringify(msg("peer", 0, "request-state-sync", null)),
      );

      // The host asked its callback for authoritative state...
      expect(onStateSyncRequest).toHaveBeenCalledTimes(1);
      // ...and pushed it as a FULL sync (isFullSync: true).
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenCalledWith(authoritative, true);
      pushSpy.mockRestore();
    });

    it("a host with no onStateSyncRequest wired does not respond (fail-open)", () => {
      const conn = createP2PGameConnection({
        playerId: "host",
        playerName: "Host",
        role: "host",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
        },
      });
      const sendSpy = jest.spyOn(conn, "send").mockReturnValue(true);

      // Must not throw and must not send anything.
      expect(() =>
        handleMessage(
          conn,
          JSON.stringify(msg("peer", 0, "request-state-sync", null)),
        ),
      ).not.toThrow();
      expect(sendSpy).not.toHaveBeenCalled();
      sendSpy.mockRestore();
    });

    it("a host whose callback returns null sends nothing", () => {
      const conn = createP2PGameConnection({
        playerId: "host",
        playerName: "Host",
        role: "host",
        onStateSyncRequest: () => null,
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
        },
      });
      const sendSpy = jest.spyOn(conn, "send").mockReturnValue(true);

      handleMessage(
        conn,
        JSON.stringify(msg("peer", 0, "request-state-sync", null)),
      );
      expect(sendSpy).not.toHaveBeenCalled();
      sendSpy.mockRestore();
    });

    it("a throwing host callback is swallowed (no crash, no send)", () => {
      const conn = createP2PGameConnection({
        playerId: "host",
        playerName: "Host",
        role: "host",
        onStateSyncRequest: () => {
          throw new Error("state unavailable");
        },
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
        },
      });
      const sendSpy = jest.spyOn(conn, "send").mockReturnValue(true);

      expect(() =>
        handleMessage(
          conn,
          JSON.stringify(msg("peer", 0, "request-state-sync", null)),
        ),
      ).not.toThrow();
      expect(sendSpy).not.toHaveBeenCalled();
      sendSpy.mockRestore();
    });

    it("requestStateSync() sends a request-state-sync message", () => {
      const conn = createP2PGameConnection({
        playerId: "peer",
        playerName: "Peer",
        role: "joiner",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
        },
      });
      const sendSpy = jest.spyOn(conn, "send").mockReturnValue(true);

      const ok = conn.requestStateSync();
      expect(ok).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect(sent.type).toBe("request-state-sync");
      expect(sent.senderId).toBe("peer");
      expect(typeof sent.seq).toBe("number");
      sendSpy.mockRestore();
    });
  });
});

/**
 * Issue #1257 — host moderation wire-format tests.
 *
 * The lobby manager owns the policy + ban list. The transport only ships a
 * typed `lobby-control` envelope (kick / ban / pause / resume) and validates
 * the wire shape defensively — the receiving peer trusts the senderId as
 * the authoritative host, but the payload itself can still be malformed and
 * must be rejected without crashing the connection.
 */
describe("P2PGameConnection lobby-control message (issue #1257)", () => {
  const handleMessage = (conn: P2PGameConnection, raw: string): void => {
    (
      conn as unknown as { handleMessage: (d: string) => void }
    ).handleMessage(raw);
  };

  const msg = (
    senderId: string,
    seq: number,
    data: unknown,
  ): GameMessage => ({
    type: "lobby-control",
    senderId,
    timestamp: Date.now(),
    seq,
    data,
  });

  const makeConn = (
    events: Partial<P2PGameConnectionEvents> = {},
  ): P2PGameConnection =>
    createP2PGameConnection({
      playerId: "local",
      playerName: "Local",
      role: "joiner",
      events: {
        onConnectionStateChange: () => {},
        onSignalingStateChange: () => {},
        onMessage: () => {},
        onGameStateSync: () => {},
        onChat: () => {},
        onError: () => {},
        onPlayerJoined: () => {},
        onPlayerLeft: () => {},
        onLobbyControl: () => {},
        ...events,
      },
    });

  describe("wire format", () => {
    it("lobby-control is a valid GameMessage type accepted by isGameMessage", () => {
      expect(
        isGameMessage({
          type: "lobby-control",
          senderId: "host",
          timestamp: Date.now(),
          seq: 0,
          data: { kind: "kick", target: "peer-1", reason: "abuse" },
        }),
      ).toBe(true);
    });

    it("sendLobbyControl() sends a typed lobby-control message with a stamped seq", () => {
      const conn = makeConn();
      const sendSpy = jest.spyOn(conn, "send").mockReturnValue(true);
      const ok = conn.sendLobbyControl({ kind: "pause", pausedAt: 12345 });
      expect(ok).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const sent = sendSpy.mock.calls[0][0] as GameMessage;
      expect(sent.type).toBe("lobby-control");
      expect(sent.senderId).toBe("local");
      expect(sent.seq).toBe(0);
      expect(sent.data).toEqual({ kind: "pause", pausedAt: 12345 });
      sendSpy.mockRestore();
    });

    it("sendLobbyControl returns false (and does not throw) when the data channel is not open", () => {
      const conn = makeConn();
      // No setupDataChannelEvents() — dataChannel stays null → send() warns and returns false.
      const ok = conn.sendLobbyControl({ kind: "kick", target: "peer-x" });
      expect(ok).toBe(false);
    });
  });

  describe("dispatch and payload validation", () => {
    it("dispatches a well-formed kick payload to onLobbyControl", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(
          msg("host", 0, {
            kind: "kick",
            target: "peer-1",
            reason: "abusive chat",
          }),
        ),
      );
      expect(onLobbyControl).toHaveBeenCalledTimes(1);
      expect(onLobbyControl).toHaveBeenCalledWith({
        kind: "kick",
        target: "peer-1",
        reason: "abusive chat",
      });
    });

    it("dispatches a pause payload with pausedAt", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(
          msg("host", 0, { kind: "pause", pausedAt: 1_700_000_000_000 }),
        ),
      );
      expect(onLobbyControl).toHaveBeenCalledWith({
        kind: "pause",
        pausedAt: 1_700_000_000_000,
      });
    });

    it("dispatches a resume payload with pausedDurationMs", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(
          msg("host", 0, { kind: "resume", pausedDurationMs: 12_500 }),
        ),
      );
      expect(onLobbyControl).toHaveBeenCalledWith({
        kind: "resume",
        pausedDurationMs: 12_500,
      });
    });

    it("dispatches a ban payload with scope and reason", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(
          msg("host", 0, {
            kind: "ban",
            target: "peer-2",
            scope: "session",
            reason: "stalling",
          }),
        ),
      );
      expect(onLobbyControl).toHaveBeenCalledWith({
        kind: "ban",
        target: "peer-2",
        scope: "session",
        reason: "stalling",
      });
    });

    it("rejects a payload with an unknown kind (no onLobbyControl call)", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(msg("host", 0, { kind: "shuffle-decks" })),
      );
      expect(onLobbyControl).not.toHaveBeenCalled();
    });

    it("rejects a null payload", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(conn, JSON.stringify(msg("host", 0, null)));
      expect(onLobbyControl).not.toHaveBeenCalled();
    });

    it("rejects a string payload", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(conn, JSON.stringify(msg("host", 0, "kick")));
      expect(onLobbyControl).not.toHaveBeenCalled();
    });

    it("strips fields with the wrong type (does not pass them through)", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(
          msg("host", 0, {
            kind: "kick",
            // target should be a string — number is dropped.
            target: 123,
            // pausedDurationMs should be a non-negative number — negative is dropped.
            pausedDurationMs: -5,
            // scope must be 'session' or 'persistent' — unknown is dropped.
            scope: "lifetime",
          }),
        ),
      );
      expect(onLobbyControl).toHaveBeenCalledTimes(1);
      expect(onLobbyControl).toHaveBeenCalledWith({ kind: "kick" });
    });

    it("does not throw on a malformed JSON payload", () => {
      const conn = makeConn();
      expect(() => handleMessage(conn, "{ not json")).not.toThrow();
    });

    it("is not invoked when the receiver has no onLobbyControl wired", () => {
      // Constructor leaves the default no-op onLobbyControl when the caller
      // does not provide one — we verify the no-op default does not throw.
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "joiner",
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          // No onLobbyControl provided → default no-op.
        },
      });
      expect(() =>
        handleMessage(
          conn,
          JSON.stringify(msg("host", 0, { kind: "kick", target: "p1" })),
        ),
      ).not.toThrow();
    });

    it("emits the lobby-control message to onMessage as well (audit trail)", () => {
      const onMessage = jest.fn();
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onMessage, onLobbyControl });
      handleMessage(
        conn,
        JSON.stringify(msg("host", 0, { kind: "pause", pausedAt: 42 })),
      );
      // Both fires: onLobbyControl for the typed handler, onMessage for
      // the generic envelope (consistent with every other message type).
      expect(onLobbyControl).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledTimes(1);
      const envelope = onMessage.mock.calls[0][0] as GameMessage;
      expect(envelope.type).toBe("lobby-control");
      expect(envelope.senderId).toBe("host");
    });
  });

  describe("interaction with the message pipeline", () => {
    it("the lobby-control message participates in anti-replay (issue #1091)", () => {
      const onLobbyControl = jest.fn();
      const conn = makeConn({ onLobbyControl });
      // First delivery — accepted.
      handleMessage(
        conn,
        JSON.stringify(msg("host", 0, { kind: "pause", pausedAt: 1 })),
      );
      expect(onLobbyControl).toHaveBeenCalledTimes(1);
      // Duplicate (same seq) — dropped as replay.
      handleMessage(
        conn,
        JSON.stringify(msg("host", 0, { kind: "pause", pausedAt: 2 })),
      );
      expect(onLobbyControl).toHaveBeenCalledTimes(1);
      // New seq — accepted.
      handleMessage(
        conn,
        JSON.stringify(msg("host", 1, { kind: "resume", pausedDurationMs: 0 })),
      );
      expect(onLobbyControl).toHaveBeenCalledTimes(2);
    });

    it("rate-limiter applies to lobby-control messages (issue #1111)", () => {
      // A flooding peer cannot drive the parse/validate path via
      // lobby-control any more than via other message types.
      const onLobbyControl = jest.fn();
      const conn = createP2PGameConnection({
        playerId: "local",
        playerName: "Local",
        role: "joiner",
        rateLimit: { maxMessages: 2, windowMs: 1000 },
        events: {
          onConnectionStateChange: () => {},
          onSignalingStateChange: () => {},
          onMessage: () => {},
          onGameStateSync: () => {},
          onChat: () => {},
          onError: () => {},
          onPlayerJoined: () => {},
          onPlayerLeft: () => {},
          onLobbyControl,
        },
      });
      handleMessage(
        conn,
        JSON.stringify(msg("host", 0, { kind: "pause", pausedAt: 1 })),
      );
      handleMessage(
        conn,
        JSON.stringify(msg("host", 1, { kind: "resume", pausedDurationMs: 0 })),
      );
      handleMessage(
        conn,
        JSON.stringify(msg("host", 2, { kind: "pause", pausedAt: 3 })),
      );
      // 3rd message exceeds the configured budget of 2 events/sec.
      expect(onLobbyControl).toHaveBeenCalledTimes(2);
    });
  });

  describe("LobbyControlPayload typing", () => {
    it("accepts all four kinds", () => {
      const kinds: LobbyControlPayload["kind"][] = [
        "kick",
        "ban",
        "pause",
        "resume",
      ];
      kinds.forEach((kind) => {
        const payload: LobbyControlPayload = { kind };
        expect(payload.kind).toBe(kind);
      });
    });
  });
});
