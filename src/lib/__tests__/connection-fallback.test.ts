/**
 * Connection Fallback Manager — error-handling coverage (#985).
 *
 * Verifies the post-#985 behaviour:
 *   - Every async method (initialize / connectWithFallback / connectWebRTC /
 *     connectWebSocket / attemptFallback / forceFallback) wraps in try/catch
 *     and surfaces failures via the `onError` event callback.
 *   - Failures carry a stable {@link ConnectionErrorCode} via
 *     {@link ConnectionError}; `instanceof ConnectionError` works.
 *   - connectWebRTC retries with exponential backoff before bubbling.
 *   - connectWithFallback falls back to WebSocket on WebRTC failure or
 *     timeout, and rejects with BOTH_FAILED when both transports fail.
 *   - The send* methods catch transport throws and route them through
 *     onError without rethrowing.
 *   - #982 log redaction is preserved: error logs never leak session IDs.
 *
 * WebRTC/WebSocket transports are mocked so we can drive each failure mode
 * without a real network or browser APIs.
 */

// --- Mock setup -----------------------------------------------------------
// Module-level mock fns so we can reconfigure them in individual tests.
// Jest hoists `jest.mock(...)` above imports; only `mock*`-prefixed
// variables are accessible inside the factory.

const mockWebRTCInitialize = jest.fn();
const mockWebRTCClose = jest.fn();
const mockWebRTCIsConnected = jest.fn();
const mockWebRTCSend = jest.fn();
const mockWebRTCSendGameState = jest.fn();
const mockWebRTCSendPlayerAction = jest.fn();
const mockWebRTCSendChat = jest.fn();
const mockWebRTCSendEmote = jest.fn();
const mockWebRTCConstructor = jest.fn();

jest.mock("../webrtc-p2p", () => ({
  WebRTCConnection: function (options: unknown) {
    // Delegate to the constructor mock so each test can configure
    // a fresh behaviour via mockWebRTCConstructor.mockImplementationOnce.
    return mockWebRTCConstructor(options);
  },
}));

jest.mock("../websocket-connection", () => ({
  WebSocketConnection: function (config: unknown, events: unknown) {
    return mockWSConstructor(config, events);
  },
  isWebSocketAvailable: () => mockIsWebSocketAvailable(),
}));

const mockWSConnect = jest.fn();
const mockWSDisconnect = jest.fn();
const mockWSIsConnected = jest.fn();
const mockWSSend = jest.fn();
const mockWSSendGameState = jest.fn();
const mockWSSendPlayerAction = jest.fn();
const mockWSSendChat = jest.fn();
const mockWSSendEmote = jest.fn();
const mockWSConstructor = jest.fn();
const mockIsWebSocketAvailable = jest.fn();

// --- Imports (resolved after mocks are in place) --------------------------

import {
  ConnectionFallbackManager,
  ConnectionError,
  ConnectionErrorCode,
  createConnectionFallbackManager,
  isConnectionAvailable,
  type ConnectionFallbackEvents,
  type ConnectionFallbackOptions,
} from "../connection-fallback";
import type { P2PMessage, P2PConnectionState } from "../webrtc-p2p";
import type { WebSocketConnectionState } from "../websocket-connection";
import type { GameState } from "../game-state/types";

// --- Helpers --------------------------------------------------------------

/** Build a working WebRTC-shaped mock object. */
function makeWebRTCMock(): Record<string, jest.Mock> {
  return {
    initialize: mockWebRTCInitialize,
    close: mockWebRTCClose,
    isConnected: mockWebRTCIsConnected,
    send: mockWebRTCSend,
    sendGameState: mockWebRTCSendGameState,
    sendPlayerAction: mockWebRTCSendPlayerAction,
    sendChat: mockWebRTCSendChat,
    sendEmote: mockWebRTCSendEmote,
  };
}

/** Build a working WebSocket-shaped mock object. */
function makeWSMock(): Record<string, jest.Mock> {
  return {
    connect: mockWSConnect,
    disconnect: mockWSDisconnect,
    isConnected: mockWSIsConnected,
    send: mockWSSend,
    sendGameState: mockWSSendGameState,
    sendPlayerAction: mockWSSendPlayerAction,
    sendChat: mockWSSendChat,
    sendEmote: mockWSSendEmote,
  };
}

/** Build an options bag with jest.fn event callbacks. */
function makeOptions(
  overrides: Partial<ConnectionFallbackOptions> = {},
): ConnectionFallbackOptions & {
  events: ConnectionFallbackEvents & {
    [K in keyof ConnectionFallbackEvents]: jest.Mock;
  };
} {
  const events = {
    onConnectionStateChange: jest.fn(),
    onConnectionTypeChange: jest.fn(),
    onMessage: jest.fn(),
    onGameStateSync: jest.fn(),
    onError: jest.fn(),
    onPeerConnected: jest.fn(),
    onPeerDisconnected: jest.fn(),
  };
  return {
    playerId: "player-1",
    playerName: "Tester",
    isHost: true,
    gameCode: "ABC234",
    websocketUrl: "wss://example.test/socket",
    events,
    fallbackTimeout: 50,
    retryBaseDelayMs: 1, // tests should never wait on real backoff
    ...overrides,
  } as ConnectionFallbackOptions & {
    events: ConnectionFallbackEvents & {
      [K in keyof ConnectionFallbackEvents]: jest.Mock;
    };
  };
}

/** Install RTCPeerConnection on the global so isWebRTCAvailable() is true. */
function enableWebRTCGlobal(): void {
  (globalThis as Record<string, unknown>).RTCPeerConnection = function () {
    return {};
  };
}

function disableWebRTCGlobal(): void {
  delete (globalThis as Record<string, unknown>).RTCPeerConnection;
}

/** Drain pending microtasks/timers so async paths finish. */
function flushTimers(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Test lifecycle -------------------------------------------------------

describe("connection-fallback — error handling (#985)", () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: WebRTC + WebSocket both "available" at the env level.
    enableWebRTCGlobal();
    mockIsWebSocketAvailable.mockReturnValue(true);

    // Default transports: WebRTC initialise succeeds, WS connect succeeds.
    mockWebRTCInitialize.mockResolvedValue(undefined);
    mockWebRTCClose.mockImplementation(() => {});
    mockWebRTCIsConnected.mockReturnValue(true);
    mockWebRTCConstructor.mockImplementation(() => makeWebRTCMock());

    mockWSConnect.mockResolvedValue(undefined);
    mockWSDisconnect.mockImplementation(() => {});
    mockWSIsConnected.mockReturnValue(true);
    mockWSConstructor.mockImplementation(() => makeWSMock());

    // Silence diagnostic logs in test output (they're tested separately).
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    disableWebRTCGlobal();
  });

  // --- Typed error primitives -------------------------------------------

  describe("ConnectionError / ConnectionErrorCode", () => {
    it("exposes the documented error codes", () => {
      // The issue spec calls out ICE_FAILED, WEBRTC_FAILED, WEBSOCKET_FAILED.
      expect(ConnectionErrorCode.ICE_FAILED).toBe("ICE_FAILED");
      expect(ConnectionErrorCode.WEBRTC_FAILED).toBe("WEBRTC_FAILED");
      expect(ConnectionErrorCode.WEBSOCKET_FAILED).toBe("WEBSOCKET_FAILED");
      // Plus the additional structural codes this PR introduces.
      expect(ConnectionErrorCode.BOTH_FAILED).toBe("BOTH_FAILED");
      expect(ConnectionErrorCode.NO_CONNECTION_METHOD).toBe(
        "NO_CONNECTION_METHOD",
      );
      expect(ConnectionErrorCode.SEND_FAILED).toBe("SEND_FAILED");
      expect(ConnectionErrorCode.RETRY_EXHAUSTED).toBe("RETRY_EXHAUSTED");
      expect(ConnectionErrorCode.TIMEOUT).toBe("TIMEOUT");
      expect(ConnectionErrorCode.WEBSOCKET_UNAVAILABLE).toBe(
        "WEBSOCKET_UNAVAILABLE",
      );
      expect(ConnectionErrorCode.WEBRTC_UNAVAILABLE).toBe("WEBRTC_UNAVAILABLE");
    });

    it("preserves code + cause + name on a ConnectionError", () => {
      const cause = new Error("underlying");
      const err = new ConnectionError(
        ConnectionErrorCode.WEBRTC_FAILED,
        "boom",
        cause,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ConnectionError);
      expect(err.code).toBe(ConnectionErrorCode.WEBRTC_FAILED);
      expect(err.message).toBe("boom");
      expect(err.cause).toBe(cause);
      expect(err.name).toBe("ConnectionError");
    });

    it("supports instanceof across try/catch boundaries", () => {
      function throwIt(): never {
        throw new ConnectionError(ConnectionErrorCode.ICE_FAILED, "x");
      }
      let caught: unknown;
      try {
        throwIt();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ConnectionError);
      expect((caught as ConnectionError).code).toBe(
        ConnectionErrorCode.ICE_FAILED,
      );
    });
  });

  // --- initialize() — no-connection & preferWebSocket ------------------

  describe("initialize() — failure modes", () => {
    it("throws NO_CONNECTION_METHOD when neither transport is available", async () => {
      disableWebRTCGlobal();
      mockIsWebSocketAvailable.mockReturnValue(false);
      const opts = makeOptions({ websocketUrl: "" });

      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toBeInstanceOf(
        ConnectionError,
      );
      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.NO_CONNECTION_METHOD,
      });

      // Host observes the error via onError too.
      expect(opts.events.onError).toHaveBeenCalled();
      const arg = opts.events.onError.mock.calls[0][0];
      expect(arg).toBeInstanceOf(ConnectionError);
      expect(arg.code).toBe(ConnectionErrorCode.NO_CONNECTION_METHOD);
    });

    it("throws NO_CONNECTION_METHOD when preferWebSocket but no URL configured", async () => {
      disableWebRTCGlobal();
      const opts = makeOptions({ preferWebSocket: true, websocketUrl: "" });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.NO_CONNECTION_METHOD,
      });
    });

    it("routes through connectWebSocket when preferWebSocket is true", async () => {
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      const type = await manager.initialize();
      expect(type).toBe("websocket");
      expect(mockWSConnect).toHaveBeenCalledTimes(1);
      expect(opts.events.onConnectionTypeChange).toHaveBeenCalledWith(
        "websocket",
      );
    });

    it("routes through connectWebSocket when WebRTC is unavailable", async () => {
      disableWebRTCGlobal();
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      const type = await manager.initialize();
      expect(type).toBe("websocket");
    });

    it("wraps unexpected throw inside initialize as ConnectionError", async () => {
      // Force the WebRTC constructor itself to throw — this is an
      // uncaught (non-Connection) error that the top-level safety net
      // must wrap.
      mockWebRTCConstructor.mockImplementation(() => {
        throw new Error("constructor boom");
      });
      // Disable fallback so we don't recover via WS.
      const opts = makeOptions({ enableFallback: false, websocketUrl: "" });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toBeInstanceOf(
        ConnectionError,
      );
      // Already-typed errors pass through.
      expect(opts.events.onError).toHaveBeenCalled();
    });
  });

  // --- connectWebRTC — retry / backoff ----------------------------------

  describe("connectWebRTC — retry with exponential backoff", () => {
    it("does not retry by default (maxRetries=0) and throws WEBRTC_FAILED", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("ice fail"));
      const opts = makeOptions({ enableFallback: false, websocketUrl: "" });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBRTC_FAILED,
      });
      // Initial attempt only — no retries by default.
      expect(mockWebRTCInitialize).toHaveBeenCalledTimes(1);
      // Each attempt surfaces to onError.
      expect(opts.events.onError).toHaveBeenCalled();
    });

    it("retries maxRetries times, then bubbles RETRY_EXHAUSTED", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("transient"));
      const opts = makeOptions({
        enableFallback: false,
        websocketUrl: "",
        maxRetries: 2,
        retryBaseDelayMs: 1,
      });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.RETRY_EXHAUSTED,
      });
      // 1 initial + 2 retries = 3 attempts.
      expect(mockWebRTCInitialize).toHaveBeenCalledTimes(3);
      // Each failed attempt surfaces to onError.
      expect(opts.events.onError.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("recovers on a later attempt without bubbling", async () => {
      // Fail twice then succeed.
      mockWebRTCInitialize
        .mockRejectedValueOnce(new Error("first"))
        .mockRejectedValueOnce(new Error("second"))
        .mockResolvedValueOnce(undefined);
      const opts = makeOptions({
        maxRetries: 3,
        retryBaseDelayMs: 1,
      });
      const manager = new ConnectionFallbackManager(opts);

      const type = await manager.initialize();
      expect(type).toBe("webrtc");
      expect(mockWebRTCInitialize).toHaveBeenCalledTimes(3);
      expect(opts.events.onConnectionTypeChange).toHaveBeenCalledWith("webrtc");
    });

    it("exponential backoff uses base * 2^attempt", async () => {
      // Spy setTimeout to capture requested delays without actually waiting.
      const delays: number[] = [];
      const origSetTimeout = setTimeout;
      jest.spyOn(global, "setTimeout").mockImplementation(((
        cb: TimerHandler,
        ms?: number,
      ) => {
        if (typeof ms === "number" && ms > 0) delays.push(ms);
        return origSetTimeout(cb, ms ?? 0);
      }) as typeof setTimeout);

      mockWebRTCInitialize.mockRejectedValue(new Error("x"));
      const opts = makeOptions({
        enableFallback: false,
        websocketUrl: "",
        maxRetries: 2,
        retryBaseDelayMs: 10,
      });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toThrow();

      // Delays should be 10 (attempt 0) and 20 (attempt 1).
      expect(delays).toContain(10);
      expect(delays).toContain(20);
      jest.restoreAllMocks();
    });

    it("surfaces the underlying cause when retries exhausted", async () => {
      const underlying = new Error("ICE_TIMEOUT");
      mockWebRTCInitialize.mockRejectedValue(underlying);
      const opts = makeOptions({
        enableFallback: false,
        websocketUrl: "",
        maxRetries: 1,
      });
      const manager = new ConnectionFallbackManager(opts);

      try {
        await manager.initialize();
        fail("expected initialize to reject");
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectionError);
        const err = e as ConnectionError;
        expect(err.code).toBe(ConnectionErrorCode.RETRY_EXHAUSTED);
        expect(err.cause).toBeInstanceOf(Error);
        expect((err.cause as Error).message).toContain("ICE_TIMEOUT");
      }
    });

    it("cleans up partially-initialised WebRTC connection before retry", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("x"));
      const opts = makeOptions({
        enableFallback: false,
        websocketUrl: "",
        maxRetries: 1,
      });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toThrow();
      // close() should have been called for each failed attempt's cleanup.
      expect(mockWebRTCClose).toHaveBeenCalled();
    });
  });

  // --- connectWebSocket — failure modes ---------------------------------

  describe("connectWebSocket — failure modes", () => {
    it("throws WEBSOCKET_UNAVAILABLE when WS reports unavailable mid-flow", async () => {
      // connectWebSocket's unavailable check is only reachable via the
      // fallback paths (initialize bails earlier with NO_CONNECTION_METHOD).
      // Establish a WebRTC connection, then make WS report unavailable and
      // call forceFallback — connectWebSocket should throw
      // WEBSOCKET_UNAVAILABLE.
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize(); // WebRTC succeeds
      mockIsWebSocketAvailable.mockReturnValue(false);
      await expect(manager.forceFallback()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBSOCKET_UNAVAILABLE,
      });
    });

    it("throws WEBSOCKET_FAILED when connect() rejects", async () => {
      mockWSConnect.mockRejectedValue(new Error("ECONNREFUSED"));
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);

      try {
        await manager.initialize();
        fail("expected initialize to reject");
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectionError);
        const err = e as ConnectionError;
        expect(err.code).toBe(ConnectionErrorCode.WEBSOCKET_FAILED);
        expect(err.cause).toBeInstanceOf(Error);
        expect((err.cause as Error).message).toContain("ECONNREFUSED");
      }
      // WS failure surfaces via onError too.
      expect(opts.events.onError).toHaveBeenCalled();
    });

    it("throws WEBSOCKET_FAILED for non-Error rejection payloads", async () => {
      mockWSConnect.mockRejectedValue("string error");
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBSOCKET_FAILED,
      });
    });

    it("tears down half-constructed socket on failure so retries are clean", async () => {
      mockWSConnect.mockRejectedValue(new Error("boom"));
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toThrow();
      expect(mockWSDisconnect).toHaveBeenCalled();
    });
  });

  // --- connectWithFallback — fallback behaviour -------------------------

  describe("connectWithFallback — fallback orchestration", () => {
    it("succeeds via WebRTC when it connects first", async () => {
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      const type = await manager.initialize();
      expect(type).toBe("webrtc");
      // Fallback timer should have been cleared.
      expect(mockWSConnect).not.toHaveBeenCalled();
    });

    it("falls back to WebSocket when WebRTC fails", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("webrtc down"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);

      const type = await manager.initialize();
      expect(type).toBe("websocket");
      expect(mockWSConnect).toHaveBeenCalledTimes(1);
    });

    it("falls back to WebSocket after fallback timeout elapses", async () => {
      // WebRTC hangs forever; the timer should fire and force a fallback.
      mockWebRTCInitialize.mockImplementation(() => new Promise(() => {}));
      const opts = makeOptions({ fallbackTimeout: 20 });
      const manager = new ConnectionFallbackManager(opts);

      const type = await manager.initialize();
      expect(type).toBe("websocket");
    });

    it("rejects with BOTH_FAILED when WebRTC and WS both fail", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("rtc down"));
      mockWSConnect.mockRejectedValue(new Error("ws down"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);

      try {
        await manager.initialize();
        fail("expected initialize to reject");
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectionError);
        const err = e as ConnectionError;
        expect(err.code).toBe(ConnectionErrorCode.BOTH_FAILED);
        // Cause chain should reference the WS failure.
        expect(err.cause).toBeInstanceOf(ConnectionError);
        expect((err.cause as ConnectionError).code).toBe(
          ConnectionErrorCode.WEBSOCKET_FAILED,
        );
      }
    });

    it("rejects cleanly with WEBRTC_FAILED when fallback is disabled", async () => {
      mockWebRTCInitialize.mockRejectedValue(new Error("rtc down"));
      const opts = makeOptions({ enableFallback: false });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBRTC_FAILED,
      });
      expect(mockWSConnect).not.toHaveBeenCalled();
    });

    it("clears the fallback timer when WebRTC wins the race", async () => {
      const opts = makeOptions({ fallbackTimeout: 5000 });
      const manager = new ConnectionFallbackManager(opts);
      const type = await manager.initialize();
      expect(type).toBe("webrtc");
      // Wait past where the timer would have fired; WS must not be invoked.
      await flushTimers(10);
      expect(mockWSConnect).not.toHaveBeenCalled();
    });

    it("does not double-settle when WebRTC fails after fallback succeeds", async () => {
      // WebRTC hangs, fallback timer fires WS which succeeds, then WebRTC
      // eventually rejects. The promise must resolve exactly once with WS.
      let rejectWebRTC: (err: Error) => void = () => {};
      mockWebRTCInitialize.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectWebRTC = reject;
          }),
      );
      const opts = makeOptions({ fallbackTimeout: 10 });
      const manager = new ConnectionFallbackManager(opts);

      const resultPromise = manager.initialize();
      await flushTimers(20); // let timer fire and WS succeed
      rejectWebRTC(new Error("late failure"));

      const type = await resultPromise;
      expect(type).toBe("websocket");
      // onConnectionTypeChange should be called for WS exactly once.
      const typeChanges = opts.events.onConnectionTypeChange.mock.calls.filter(
        (c) => c[0] === "websocket",
      );
      expect(typeChanges.length).toBe(1);
    });

    it("never produces an unhandled rejection on WebRTC path", async () => {
      // Sanity check: errors flow through onError and the rejection.
      mockWebRTCInitialize.mockRejectedValue(new Error("x"));
      mockWSConnect.mockRejectedValue(new Error("y"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      // Capture unhandled rejections during this test.
      const unhandled: unknown[] = [];
      const handler = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", handler);
      try {
        await expect(manager.initialize()).rejects.toThrow();
        await flushTimers(10);
      } finally {
        process.off("unhandledRejection", handler);
      }
      expect(unhandled).toHaveLength(0);
    });
  });

  // --- forceFallback() ----------------------------------------------------

  describe("forceFallback()", () => {
    it("is a no-op when already on WebSocket", async () => {
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      mockWSConnect.mockClear();
      await manager.forceFallback();
      expect(mockWSConnect).not.toHaveBeenCalled();
    });

    it("throws ConnectionError(WEBSOCKET_FAILED) when the WS fails", async () => {
      // First connect via WebRTC.
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();

      mockWSConnect.mockRejectedValue(new Error("no relay"));
      await expect(manager.forceFallback()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBSOCKET_FAILED,
      });
      expect(opts.events.onError).toHaveBeenCalled();
    });

    it("closes the WebRTC connection during forceFallback", async () => {
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      mockWebRTCClose.mockClear();
      await manager.forceFallback();
      expect(mockWebRTCClose).toHaveBeenCalled();
    });
  });

  // --- attemptFallback (private path, via state 'failed' event) ---------

  describe("attemptFallback — auto-fallback from WebRTC failed state", () => {
    it("catches WS failures and surfaces them via onError without throwing", async () => {
      mockWebRTCInitialize.mockImplementation(async () => {
        // Simulate the WebRTC connection reporting a 'failed' state after
        // initialisation by triggering the fallback path manually via
        // the public forceFallback() entry point.
      });
      mockWSConnect.mockRejectedValue(new Error("ws down"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize(); // WebRTC succeeds
      // Force fallback to a broken WS — should not throw out of the
      // auto-fallback code path; we use forceFallback which DOES throw,
      // so verify the host receives a typed error.
      await expect(manager.forceFallback()).rejects.toMatchObject({
        code: ConnectionErrorCode.WEBSOCKET_FAILED,
      });
      const calls = opts.events.onError.mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last).toBeInstanceOf(ConnectionError);
      expect(last.code).toBe(ConnectionErrorCode.WEBSOCKET_FAILED);
    });
  });

  // --- send* methods (graceful degradation) ------------------------------

  describe("send* methods — graceful degradation", () => {
    it("send() catches transport throw and routes via onError", () => {
      mockWebRTCSend.mockImplementation(() => {
        throw new Error("data channel closed");
      });
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      // Establish WebRTC first.
      return manager.initialize().then(() => {
        const msg: P2PMessage = {
          type: "chat",
          senderId: "p1",
          timestamp: Date.now(),
          payload: { text: "hi" },
        };
        expect(() => manager.send(msg)).not.toThrow();
        expect(opts.events.onError).toHaveBeenCalled();
        const err =
          opts.events.onError.mock.calls[
            opts.events.onError.mock.calls.length - 1
          ][0];
        expect(err).toBeInstanceOf(ConnectionError);
        expect(err.code).toBe(ConnectionErrorCode.SEND_FAILED);
      });
    });

    it("sendGameState() catches transport throw", async () => {
      mockWSSendGameState.mockImplementation(() => {
        throw new Error("socket gone");
      });
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      const gs = { players: [] } as unknown as GameState;
      expect(() => manager.sendGameState(gs, true)).not.toThrow();
      const calls = opts.events.onError.mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last.code).toBe(ConnectionErrorCode.SEND_FAILED);
    });

    it("sendPlayerAction/sendChat/sendEmote all swallow throws", async () => {
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();

      mockWSSendPlayerAction.mockImplementation(() => {
        throw new Error("x");
      });
      mockWSSendChat.mockImplementation(() => {
        throw new Error("x");
      });
      mockWSSendEmote.mockImplementation(() => {
        throw new Error("x");
      });

      expect(() => manager.sendPlayerAction("pass", null)).not.toThrow();
      expect(() => manager.sendChat("hi")).not.toThrow();
      expect(() => manager.sendEmote("wave")).not.toThrow();

      // Three SEND_FAILED errors should have surfaced.
      const sendErrors = opts.events.onError.mock.calls
        .map((c) => c[0])
        .filter(
          (e) =>
            e instanceof ConnectionError &&
            e.code === ConnectionErrorCode.SEND_FAILED,
        );
      expect(sendErrors.length).toBe(3);
    });

    it("send() with no active connection logs a warning (no throw)", () => {
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      expect(() =>
        manager.send({
          type: "chat",
          senderId: "p",
          timestamp: Date.now(),
          payload: { text: "x" },
        }),
      ).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No active connection"),
      );
    });
  });

  // --- isConnected / disconnect / cleanup --------------------------------

  describe("isConnected() / disconnect() — defensive", () => {
    it("isConnected() returns false when no active connection", () => {
      const manager = new ConnectionFallbackManager(makeOptions());
      expect(manager.isConnected()).toBe(false);
    });

    it("isConnected() swallows throw from the transport", async () => {
      mockWebRTCIsConnected.mockImplementation(() => {
        throw new Error("wut");
      });
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      expect(manager.isConnected()).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("disconnect() clears timers and closes both transports", async () => {
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      manager.disconnect();
      expect(mockWebRTCClose).toHaveBeenCalled();
      expect(opts.events.onConnectionStateChange).toHaveBeenCalled();
      const lastState =
        opts.events.onConnectionStateChange.mock.calls[
          opts.events.onConnectionStateChange.mock.calls.length - 1
        ][0];
      expect(lastState.activeConnection).toBe("none");
    });

    it("cleanup helpers swallow close() failures", async () => {
      mockWebRTCClose.mockImplementation(() => {
        throw new Error("close failed");
      });
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      expect(() => manager.disconnect()).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("cleanup"),
        expect.any(String),
      );
    });
  });

  // --- #982 redaction preservation --------------------------------------

  describe("#982 redaction preservation", () => {
    it("WebRTC failures log redacted error (no session ID leak)", async () => {
      // Build an error whose message embeds a host-style session ID.
      const sessionId = "host-1700000000000-abc12345";
      mockWebRTCInitialize.mockRejectedValue(
        new Error(`ICE fail for ${sessionId}`),
      );
      const opts = makeOptions({ enableFallback: false, websocketUrl: "" });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toThrow();
      // Locate the WebRTC failure log.
      const calls = consoleErrorSpy.mock.calls;
      const flat = JSON.stringify(calls);
      expect(flat).not.toContain(sessionId);
      expect(flat).toContain("[REDACTED_SESSION]");
    });

    it("WebSocket failures log redacted error", async () => {
      const sessionId = "host-1700000000000-abc12345";
      mockWSConnect.mockRejectedValue(
        new Error(`WS handshake failed for ${sessionId}`),
      );
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);

      await expect(manager.initialize()).rejects.toThrow();
      const flat = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(flat).not.toContain(sessionId);
      expect(flat).toContain("[REDACTED_SESSION]");
    });

    it("send() failures log redacted error", async () => {
      const sessionId = "host-1700000000000-abc12345";
      mockWebRTCSend.mockImplementation(() => {
        throw new Error(`channel closed for ${sessionId}`);
      });
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      manager.send({
        type: "chat",
        senderId: "p",
        timestamp: Date.now(),
        payload: { text: "hi" },
      });
      const flat = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(flat).not.toContain(sessionId);
      expect(flat).toContain("[REDACTED_SESSION]");
    });
  });

  // --- State machine: every error updates lastError ----------------------

  describe("state machine — lastError tracking", () => {
    it("updates lastError on every failure path", async () => {
      mockWSConnect.mockRejectedValue(new Error("boom"));
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toThrow();
      expect(manager.getState().lastError).toBeTruthy();
      expect(manager.getState().lastError).toContain("WebSocket");
    });

    it("onError always receives Error instances (never strings)", async () => {
      mockWSConnect.mockRejectedValue("string error");
      const opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toThrow();
      for (const call of opts.events.onError.mock.calls) {
        expect(call[0]).toBeInstanceOf(Error);
      }
    });
  });

  // --- Factory + availability helpers ------------------------------------

  describe("module exports", () => {
    it("createConnectionFallbackManager returns a manager instance", () => {
      const manager = createConnectionFallbackManager(makeOptions());
      expect(manager).toBeInstanceOf(ConnectionFallbackManager);
    });

    it("isConnectionAvailable returns true when WebRTC global exists", () => {
      enableWebRTCGlobal();
      expect(isConnectionAvailable()).toBe(true);
    });

    it("isConnectionAvailable returns true when only WS is available", () => {
      disableWebRTCGlobal();
      mockIsWebSocketAvailable.mockReturnValue(true);
      expect(isConnectionAvailable()).toBe(true);
    });

    it("isConnectionAvailable returns false when neither is available", () => {
      disableWebRTCGlobal();
      mockIsWebSocketAvailable.mockReturnValue(false);
      expect(isConnectionAvailable()).toBe(false);
    });
  });

  // --- Coverage of branch combinations -----------------------------------

  describe("branch coverage — degenerate inputs", () => {
    it("handles non-Error rejections from initialize() top-level net", async () => {
      // Throw a non-Error from the constructor to bypass typed paths.
      mockWebRTCConstructor.mockImplementation(() => {
        // Throw a non-Error value — must still be wrapped safely.
        throw "string thrown";
      });
      const opts = makeOptions({ enableFallback: false, websocketUrl: "" });
      const manager = new ConnectionFallbackManager(opts);
      await expect(manager.initialize()).rejects.toBeInstanceOf(
        ConnectionError,
      );
    });

    it("forceFallback resets fallbackAttempted so re-forcing works", async () => {
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
      // After first forceFallback (which would go to WS), forcing again is
      // a no-op because we're already on WS — but the reset ensures it
      // doesn't bail on the fallbackAttempted guard inside connectWebSocket.
      await manager.forceFallback();
      expect(mockWSConnect).toHaveBeenCalled();
    });

    it("attemptFallback (via state) is a no-op once fallbackAttempted", async () => {
      // Indirect: after a successful fallback via initialize, forcing
      // fallback again should not re-trigger another connectWebSocket.
      mockWebRTCInitialize.mockRejectedValue(new Error("rtc down"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      const type = await manager.initialize();
      expect(type).toBe("websocket");
      const firstCount = mockWSConnect.mock.calls.length;
      await manager.forceFallback(); // already on websocket — no-op
      expect(mockWSConnect.mock.calls.length).toBe(firstCount);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1094 — P2P connection fallback & reconnection path coverage.
  //
  // These suites exercise the previously-uncovered internal transport-event
  // wiring (the P2PEvents / WebSocketEvents lambdas the manager registers on
  // the underlying connections), the auto-fallback triggered when WebRTC
  // reports a 'failed' ICE state, sending over each active transport, the
  // defensive getters, cleanup swallowing, and destroy(). Transports stay
  // mocked; we capture the registered event objects to drive them directly.
  // -------------------------------------------------------------------------

  type CapturedWebRTCEvents = {
    onConnectionStateChange: (
      state: P2PConnectionState,
      peerId: string,
    ) => void;
    onMessage: (message: P2PMessage, peerId: string) => void;
    onGameStateSync: (gameState: GameState, peerId: string) => void;
    onPlayerAction: (action: string, data: unknown, peerId: string) => void;
    onChat: (text: string, peerId: string) => void;
    onEmote: (emote: string, peerId: string) => void;
    onError: (error: Error, peerId: string) => void;
    onPeerConnected: (peerInfo: {
      peerId: string;
      playerName?: string;
    }) => void;
    onPeerDisconnected: (peerId: string) => void;
  };

  type CapturedWSEvents = {
    onConnectionStateChange: (state: WebSocketConnectionState) => void;
    onMessage: (message: P2PMessage) => void;
    onGameStateSync: (gameState: GameState) => void;
    onError: (error: Error) => void;
    onPlayerJoined: (playerId: string, playerName?: string) => void;
    onPlayerLeft: (playerId: string) => void;
  };

  describe("WebRTC event wiring — P2PEvents forwarding (#1094)", () => {
    let captured: CapturedWebRTCEvents;
    let opts: ReturnType<typeof makeOptions>;
    let manager: ConnectionFallbackManager;

    beforeEach(async () => {
      opts = makeOptions();
      mockWebRTCConstructor.mockImplementationOnce(
        (options: { events: CapturedWebRTCEvents }) => {
          captured = options.events;
          return makeWebRTCMock();
        },
      );
      manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
    });

    it("forwards connection state changes and updates the snapshot state", () => {
      captured.onConnectionStateChange("connected", "peer-2");
      const last = opts.events.onConnectionStateChange.mock.calls.at(-1)![0];
      expect(last.webrtcState).toBe("connected");
    });

    it("forwards inbound data messages verbatim", () => {
      const msg: P2PMessage = {
        type: "chat",
        senderId: "p2",
        timestamp: 1,
        payload: { text: "hi" },
      };
      captured.onMessage(msg, "p2");
      expect(opts.events.onMessage).toHaveBeenCalledWith(msg, "p2");
    });

    it("forwards game-state sync (dropping the peer id)", () => {
      const gs = { players: [] } as unknown as GameState;
      captured.onGameStateSync(gs, "p2");
      expect(opts.events.onGameStateSync).toHaveBeenCalledWith(gs);
      expect(opts.events.onGameStateSync.mock.calls[0]).toHaveLength(1);
    });

    it("rewraps player actions / chat / emotes as messages", () => {
      captured.onPlayerAction("pass", { x: 1 }, "p2");
      captured.onChat("hello", "p2");
      captured.onEmote("wave", "p2");
      const calls = opts.events.onMessage.mock.calls;
      expect(calls.at(-3)![0]).toMatchObject({
        type: "player-action",
        senderId: "p2",
      });
      expect(calls.at(-2)![0]).toMatchObject({ type: "chat", senderId: "p2" });
      expect(calls.at(-1)![0]).toMatchObject({ type: "emote", senderId: "p2" });
    });

    it("forwards transport errors and records lastError", () => {
      captured.onError(new Error("rtc hiccup"), "p2");
      expect(opts.events.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "rtc hiccup" }),
      );
      expect(manager.getState().lastError).toBe("rtc hiccup");
    });

    it("forwards peer connected / disconnected", () => {
      captured.onPeerConnected({ peerId: "p2", playerName: "Alice" });
      captured.onPeerDisconnected("p2");
      expect(opts.events.onPeerConnected).toHaveBeenCalledWith("p2", "Alice");
      expect(opts.events.onPeerDisconnected).toHaveBeenCalledWith("p2");
    });
  });

  describe("WebRTC failed state — auto-fallback engagement (#1094)", () => {
    it("engages WebSocket fallback when WebRTC reports 'failed'", async () => {
      let captured: CapturedWebRTCEvents;
      mockWebRTCConstructor.mockImplementationOnce(
        (options: { events: CapturedWebRTCEvents }) => {
          captured = options.events;
          return makeWebRTCMock();
        },
      );
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize(); // WebRTC active
      expect(manager.getActiveConnection()).toBe("webrtc");

      // Simulate ICE failure -> auto-fallback to WebSocket.
      captured!.onConnectionStateChange("failed", "peer-2");
      await flushTimers(5);

      expect(manager.getActiveConnection()).toBe("websocket");
      expect(manager.getState().fallbackAttempted).toBe(true);
      expect(opts.events.onConnectionTypeChange).toHaveBeenCalledWith(
        "websocket",
      );
    });

    it("does not double-trigger fallback on a second failed event", async () => {
      let captured: CapturedWebRTCEvents;
      mockWebRTCConstructor.mockImplementationOnce(
        (options: { events: CapturedWebRTCEvents }) => {
          captured = options.events;
          return makeWebRTCMock();
        },
      );
      const manager = new ConnectionFallbackManager(makeOptions());
      await manager.initialize();

      captured!.onConnectionStateChange("failed", "peer-2");
      await flushTimers(5);
      const countAfterFirst = mockWSConnect.mock.calls.length;

      captured!.onConnectionStateChange("failed", "peer-2"); // already fell back
      await flushTimers(5);
      expect(mockWSConnect.mock.calls.length).toBe(countAfterFirst);
    });

    it("surfaces a typed error via onError when the auto-fallback WS also fails", async () => {
      let captured: CapturedWebRTCEvents;
      mockWebRTCConstructor.mockImplementationOnce(
        (options: { events: CapturedWebRTCEvents }) => {
          captured = options.events;
          return makeWebRTCMock();
        },
      );
      mockWSConnect.mockRejectedValue(new Error("relay down"));
      const opts = makeOptions();
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();

      // Auto-fallback is fire-and-forget from the event handler; it must not
      // throw, but it must surface a typed ConnectionError via onError.
      expect(() =>
        captured!.onConnectionStateChange("failed", "peer-2"),
      ).not.toThrow();
      await flushTimers(5);

      const last = opts.events.onError.mock.calls.at(-1)![0];
      expect(last).toBeInstanceOf(ConnectionError);
      expect((last as ConnectionError).code).toBe(
        ConnectionErrorCode.WEBSOCKET_FAILED,
      );
    });
  });

  describe("WebSocket event wiring — WebSocketEvents forwarding (#1094)", () => {
    let captured: CapturedWSEvents;
    let opts: ReturnType<typeof makeOptions>;

    beforeEach(async () => {
      mockWSConstructor.mockImplementationOnce(
        (config: unknown, events: CapturedWSEvents) => {
          captured = events;
          return makeWSMock();
        },
      );
      opts = makeOptions({ preferWebSocket: true });
      const manager = new ConnectionFallbackManager(opts);
      await manager.initialize();
    });

    it("records an error when the socket reports 'failed'", () => {
      captured.onConnectionStateChange("failed");
      const last = opts.events.onError.mock.calls.at(-1)![0];
      expect(last.message).toBe("WebSocket connection failed");
    });

    it("forwards inbound messages (using the message sender id)", () => {
      const msg: P2PMessage = {
        type: "chat",
        senderId: "p2",
        timestamp: 1,
        payload: { text: "hi" },
      };
      captured.onMessage(msg);
      expect(opts.events.onMessage).toHaveBeenCalledWith(msg, "p2");
    });

    it("forwards game-state sync", () => {
      const gs = { players: [] } as unknown as GameState;
      captured.onGameStateSync(gs);
      expect(opts.events.onGameStateSync).toHaveBeenCalledWith(gs);
    });

    it("forwards transport errors", () => {
      captured.onError(new Error("socket boom"));
      expect(opts.events.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "socket boom" }),
      );
    });

    it("forwards player joined / left as peer connected / disconnected", () => {
      captured.onPlayerJoined("p2", "Bob");
      captured.onPlayerLeft("p2");
      expect(opts.events.onPeerConnected).toHaveBeenCalledWith("p2", "Bob");
      expect(opts.events.onPeerDisconnected).toHaveBeenCalledWith("p2");
    });
  });

  describe("send* over each active transport (#1094)", () => {
    it("send() routes through the active WebSocket connection", async () => {
      const manager = new ConnectionFallbackManager(
        makeOptions({ preferWebSocket: true }),
      );
      await manager.initialize();
      const msg: P2PMessage = {
        type: "chat",
        senderId: "p1",
        timestamp: 1,
        payload: { text: "x" },
      };
      manager.send(msg);
      expect(mockWSSend).toHaveBeenCalledWith(msg);
    });

    it("sendGameState / sendPlayerAction / sendChat / sendEmote route through WebRTC", async () => {
      const manager = new ConnectionFallbackManager(makeOptions());
      await manager.initialize();
      const gs = { players: [] } as unknown as GameState;

      manager.sendGameState(gs, true);
      manager.sendPlayerAction("pass", { a: 1 });
      manager.sendChat("hi");
      manager.sendEmote("wave");

      expect(mockWebRTCSendGameState).toHaveBeenCalledWith(gs, true);
      expect(mockWebRTCSendPlayerAction).toHaveBeenCalledWith("pass", { a: 1 });
      expect(mockWebRTCSendChat).toHaveBeenCalledWith("hi");
      expect(mockWebRTCSendEmote).toHaveBeenCalledWith("wave");
    });

    it("sendGameState with no active connection warns and does not throw", () => {
      mockWSSendGameState.mockImplementation(() => {
        throw new Error("should not be called");
      });
      const manager = new ConnectionFallbackManager(makeOptions()); // never initialized
      expect(() =>
        manager.sendGameState({ players: [] } as unknown as GameState),
      ).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No active connection to send game state"),
      );
    });
  });

  describe("cleanup, getters & destroy (#1094)", () => {
    it("cleanupWebSocket swallows a disconnect() throw", async () => {
      mockWSDisconnect.mockImplementation(() => {
        throw new Error("socket already gone");
      });
      const manager = new ConnectionFallbackManager(
        makeOptions({ preferWebSocket: true }),
      );
      await manager.initialize();
      expect(() => manager.disconnect()).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("closing WebSocket"),
        expect.anything(),
      );
    });

    it("getActiveConnection / getWebRTCConnection / getWebSocketConnection", async () => {
      const rtcManager = new ConnectionFallbackManager(makeOptions());
      await rtcManager.initialize();
      expect(rtcManager.getActiveConnection()).toBe("webrtc");
      expect(rtcManager.getWebRTCConnection()).not.toBeNull();
      expect(rtcManager.getWebSocketConnection()).toBeNull();

      const wsManager = new ConnectionFallbackManager(
        makeOptions({ preferWebSocket: true }),
      );
      await wsManager.initialize();
      expect(wsManager.getActiveConnection()).toBe("websocket");
      expect(wsManager.getWebSocketConnection()).not.toBeNull();
    });

    it("isConnected() reflects the active WebSocket transport", async () => {
      mockWSIsConnected.mockReturnValue(true);
      const manager = new ConnectionFallbackManager(
        makeOptions({ preferWebSocket: true }),
      );
      await manager.initialize();
      expect(manager.isConnected()).toBe(true);
    });

    it("destroy() tears everything down to no active connection", async () => {
      const manager = new ConnectionFallbackManager(makeOptions());
      await manager.initialize();
      manager.destroy();
      expect(manager.getActiveConnection()).toBe("none");
      expect(manager.getWebRTCConnection()).toBeNull();
    });
  });
});
