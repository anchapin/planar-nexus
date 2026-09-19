/**
 * WebRTC P2P Connection Tests
 *
 * Tests for the WebRTC P2P module which provides peer-to-peer connections
 * for multiplayer games.
 * Issue #604: Add tests for P2P networking
 * Issue #915: attemptReconnection() ICE restart + bounded retries
 */

import {
  DEFAULT_RTC_CONFIG,
  generateGameCode,
  WebRTCConnection,
  type P2PEvents,
} from "../webrtc-p2p";
import {
  installWebrtcGlobals,
  uninstallWebrtcGlobals,
  latestPC,
  MockRTCDataChannel,
} from "@/test-utils/__mocks__/rtc";

describe("WebRTC P2P", () => {
  describe("generateGameCode", () => {
    it("should generate a game code with default length of 6", () => {
      const code = generateGameCode();

      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    it("should generate a game code with custom length", () => {
      const code = generateGameCode(4);

      expect(code).toHaveLength(4);
    });

    it("should generate unique codes", () => {
      const codes = new Set();

      for (let i = 0; i < 100; i++) {
        codes.add(generateGameCode());
      }

      // Should have mostly unique codes (allowing for tiny collision possibility)
      expect(codes.size).toBeGreaterThan(90);
    });
  });

  describe("DEFAULT_RTC_CONFIG", () => {
    it("should have STUN servers configured", () => {
      expect(DEFAULT_RTC_CONFIG).toBeDefined();
      expect(DEFAULT_RTC_CONFIG.iceServers).toBeDefined();
      expect(Array.isArray(DEFAULT_RTC_CONFIG.iceServers)).toBe(true);
      expect(DEFAULT_RTC_CONFIG.iceServers?.length ?? 0).toBeGreaterThan(0);
    });

    it("should have valid STUN server URLs", () => {
      const servers = DEFAULT_RTC_CONFIG.iceServers ?? [];
      for (const server of servers) {
        expect(server.urls).toMatch(/^stun:/);
      }
    });
  });
});

// =============================================================================
// Issue #915: attemptReconnection() — ICE restart with bounded retries
// =============================================================================

/**
 * Minimal data channel mock.
 */
class MockDataChannel {
  readyState = "open";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = "closed";
  }
}

/**
 * Minimal RTCPeerConnection mock that records the operations needed to verify
 * the ICE restart reconnection logic.
 */
let lastCreatedPC: MockRTCPeerConnection | null = null;

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";

  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicecandidate:
    ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ondatachannel: ((event: { channel: MockDataChannel }) => void) | null = null;

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  createOfferCalls: RTCOfferOptions[] = [];
  setConfigurationCalls = 0;
  closed = false;

  constructor(_config?: RTCConfiguration) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastCreatedPC = this;
  }

  setConfiguration(config: RTCConfiguration): void {
    this.setConfigurationCalls++;
    void config;
  }

  async createOffer(
    options?: RTCOfferOptions,
  ): Promise<RTCSessionDescriptionInit> {
    this.createOfferCalls.push(options ?? {});
    return {
      type: "offer",
      sdp: `mock-restart-sdp-${this.createOfferCalls.length}`,
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "mock-answer" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  createDataChannel(label: string): MockDataChannel {
    void label;
    return new MockDataChannel();
  }

  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }
}

describe("WebRTCConnection reconnection (issue #915)", () => {
  const ORIGINAL_RTCP = global.RTCPeerConnection;

  beforeEach(() => {
    // jsdom has no RTCPeerConnection; provide a controllable mock.
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      MockRTCPeerConnection as unknown as typeof RTCPeerConnection;
  });

  afterEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      ORIGINAL_RTCP;
  });

  /** Poll-based wait that works with real timers and async reconnect loops. */
  async function waitFor<T>(
    fn: () => T | undefined | null,
    { timeout = 3000, interval = 5 } = {},
  ): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = fn();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }

  type ConnOptions = {
    isHost?: boolean;
    maxReconnectAttempts?: number;
    reconnectBaseDelayMs?: number;
    reconnectAttemptTimeoutMs?: number;
    onReconnectOffer?: P2PEvents["onReconnectOffer"];
    onReconnect?: P2PEvents["onReconnect"];
    onError?: P2PEvents["onError"];
    onConnectionStateChange?: P2PEvents["onConnectionStateChange"];
  };

  async function makeConnection(opts: ConnOptions = {}): Promise<{
    conn: WebRTCConnection;
    pc: MockRTCPeerConnection;
    offerSpy: jest.Mock;
    reconnectSpy: jest.Mock;
    errorSpy: jest.Mock;
    stateSpy: jest.Mock;
  }> {
    const offerSpy = jest.fn();
    const reconnectSpy = jest.fn();
    const errorSpy = jest.fn();
    const stateSpy = jest.fn();

    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "Player 1",
      isHost: opts.isHost ?? true,
      enableICEMonitoring: false,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 3,
      reconnectBaseDelayMs: opts.reconnectBaseDelayMs ?? 2,
      reconnectAttemptTimeoutMs: opts.reconnectAttemptTimeoutMs ?? 30,
      events: {
        onReconnectOffer: opts.onReconnectOffer ?? offerSpy,
        onReconnect: opts.onReconnect ?? reconnectSpy,
        onError: opts.onError ?? errorSpy,
        onConnectionStateChange: opts.onConnectionStateChange ?? stateSpy,
      },
    });

    await conn.initialize();

    const pc = lastCreatedPC as MockRTCPeerConnection;
    lastCreatedPC = null;
    return { conn, pc, offerSpy, reconnectSpy, errorSpy, stateSpy };
  }

  function fireICEState(
    pc: MockRTCPeerConnection,
    state: RTCIceConnectionState,
  ): void {
    pc.iceConnectionState = state;
    pc.oniceconnectionstatechange?.();
  }

  function fireConnectionState(
    pc: MockRTCPeerConnection,
    state: RTCPeerConnectionState,
  ): void {
    pc.connectionState = state;
    pc.onconnectionstatechange?.();
  }

  it("performs an ICE restart on ICE disconnect and recovers to connected", async () => {
    const { conn, pc, offerSpy } = await makeConnection();

    // Establish the connection first.
    fireConnectionState(pc, "connected");
    expect(conn.getConnectionState()).toBe("connected");

    // Simulate a transient ICE disconnect.
    fireICEState(pc, "disconnected");

    // The host should initiate an ICE restart (createOffer with iceRestart).
    await waitFor(() => (pc.createOfferCalls.length > 0 ? true : false));
    expect(pc.createOfferCalls[0]).toEqual({ iceRestart: true });
    expect(pc.setConfigurationCalls).toBeGreaterThan(0);
    // A restart offer must be emitted for the signaling layer to forward.
    await waitFor(() => (offerSpy.mock.calls.length > 0 ? true : false));
    expect(offerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "offer" }),
      "",
    );
    expect(conn.getConnectionState()).toBe("reconnecting");

    // Simulate the peer completing renegotiation → connection recovers.
    fireConnectionState(pc, "connected");

    await waitFor(() =>
      conn.getConnectionState() === "connected" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("connected");
    // Exactly one restart offer for a single successful recovery.
    expect(offerSpy).toHaveBeenCalledTimes(1);
  });

  it("fires onReconnect exactly once after an ICE-restart recovery (and not on initial connect) (issue #1086)", async () => {
    const { conn, pc, reconnectSpy } = await makeConnection();

    // Initial connect must NOT fire onReconnect.
    fireConnectionState(pc, "connected");
    expect(conn.getConnectionState()).toBe("connected");
    expect(reconnectSpy).not.toHaveBeenCalled();

    // Transient ICE disconnect → recovery.
    fireICEState(pc, "disconnected");
    await waitFor(() =>
      conn.getConnectionState() === "reconnecting" ? true : false,
    );
    expect(reconnectSpy).not.toHaveBeenCalled();

    // Peer completes renegotiation → connection recovers.
    fireConnectionState(pc, "connected");
    await waitFor(() =>
      conn.getConnectionState() === "connected" ? true : false,
    );
    // onReconnect fires exactly once on recovery — the canonical signal for
    // the game layer to reconcile authoritative state.
    expect(reconnectSpy).toHaveBeenCalledTimes(1);

    // A duplicate "connected" transition must NOT re-fire onReconnect.
    fireConnectionState(pc, "connected");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff up to max attempts then transitions to terminal failed (not stuck reconnecting)", async () => {
    const { conn, pc, errorSpy } = await makeConnection({
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 2,
      reconnectAttemptTimeoutMs: 15,
    });

    fireConnectionState(pc, "connected");
    expect(conn.getConnectionState()).toBe("connected");

    // ICE disconnect that never recovers.
    fireICEState(pc, "disconnected");

    // Must NOT strand in "reconnecting": it reaches the terminal "failed" state.
    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("failed");
    expect(conn.getConnectionState()).not.toBe("reconnecting");

    // Two attempts ⇒ two ICE restart offers.
    expect(pc.createOfferCalls).toHaveLength(2);
    expect(pc.createOfferCalls.every((o) => o.iceRestart === true)).toBe(true);

    // An actionable error must be surfaced when retries are exhausted.
    await waitFor(() => (errorSpy.mock.calls.length > 0 ? true : false));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const reported = errorSpy.mock.calls[0][0] as Error;
    expect(reported.message).toMatch(/exhausted|unreachable/i);
  });

  it("does not retry beyond maxReconnectAttempts", async () => {
    const { conn, pc } = await makeConnection({
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 1,
      reconnectAttemptTimeoutMs: 8,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    // Exactly maxReconnectAttempts restart offers — no unbounded retrying.
    expect(pc.createOfferCalls).toHaveLength(3);
  });

  it("answerer (non-host) does not generate a restart offer (avoids glare) and still terminates", async () => {
    const { conn, pc, offerSpy } = await makeConnection({
      isHost: false,
      maxReconnectAttempts: 2,
      reconnectAttemptTimeoutMs: 15,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("failed");
    // The answerer must not create offers (the host drives the restart).
    expect(pc.createOfferCalls).toHaveLength(0);
    expect(offerSpy).not.toHaveBeenCalled();
  });

  it("close() during reconnection settles the cycle without stranding", async () => {
    const { conn, pc } = await makeConnection({
      maxReconnectAttempts: 5,
      reconnectAttemptTimeoutMs: 50,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    // While a reconnection attempt is in flight, close the connection.
    await waitFor(() =>
      conn.getConnectionState() === "reconnecting" ? true : false,
    );
    conn.close();

    // Give the in-flight async cycle a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(conn.getConnectionState()).toBe("disconnected");
    // It must not have transitioned into a perpetual reconnecting loop.
    expect(conn.isConnected()).toBe(false);
  });
});

// =============================================================================
// Issue #1088: getDiagnostics() — ICE candidate / NAT-traversal observability
// =============================================================================

/**
 * RTCPeerConnection mock that supports addEventListener (so the diagnostics
 * collector actually subscribes) and emits candidate/state events on demand.
 */
let lastDiagPC: DiagnosticsPC | null = null;

class DiagnosticsPC {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastDiagPC = this;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (l) => l !== listener,
    );
  }
  emit(type: string, event: unknown): void {
    for (const l of this.listeners[type] ?? []) l(event);
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "sdp" };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
  }
  createDataChannel(): unknown {
    return { close: () => {} };
  }
  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }
  close(): void {
    this.connectionState = "closed";
  }
}

describe("WebRTCConnection.getDiagnostics() (issue #1088)", () => {
  const ORIGINAL_RTCP = global.RTCPeerConnection;

  beforeEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      DiagnosticsPC as unknown as typeof RTCPeerConnection;
    lastDiagPC = null;
  });

  afterEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      ORIGINAL_RTCP;
  });

  it("returns null before a peer connection exists", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
    });
    expect(await conn.getDiagnostics()).toBeNull();
  });

  it("reports candidate types, ICE state and NAT type via the collector", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
    });
    await conn.initialize();
    const pc = lastDiagPC as DiagnosticsPC;

    // Simulate ICE gathering producing a host + srflx candidate.
    pc.emit("icegatheringstatechange", {});
    // First set the gathering state on the mock, then re-emit so the collector
    // reads the updated value.
    pc.iceGatheringState = "gathering";
    pc.emit("icegatheringstatechange", {});
    pc.emit("icecandidate", {
      candidate: {
        candidate: "candidate:1 1 udp 1 192.168.1.5 5000 typ host generation 0",
      },
    });
    pc.emit("icecandidate", {
      candidate: {
        candidate:
          "candidate:2 1 udp 2 203.0.113.7 5001 typ srflx generation 0",
      },
    });
    pc.iceGatheringState = "complete";
    pc.emit("icegatheringstatechange", {});
    pc.iceConnectionState = "connected";
    pc.emit("iceconnectionstatechange", {});

    const diag = await conn.getDiagnostics();
    expect(diag).not.toBeNull();
    expect(diag?.candidateCounts.host).toBe(1);
    expect(diag?.candidateCounts.srflx).toBe(1);
    expect(diag?.natType).toBe("cone");
    expect(diag?.iceConnectionState).toBe("connected");
    expect(diag?.phase).toBe("connected");
    expect(diag?.totalGathered).toBe(2);

    conn.close();
    // Detaching must not throw and the connection is gone.
    expect(await conn.getDiagnostics()).toBeNull();
  });
});

// =============================================================================
// Issue #1788 — negotiation + data-channel message dispatch against the
// shared WebRTC mock (real module code, controllable fake transport).
// =============================================================================

describe("WebRTCConnection transport surface (#1788)", () => {
  let originals: ReturnType<typeof installWebrtcGlobals>;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    originals = installWebrtcGlobals();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    uninstallWebrtcGlobals(originals);
    errorSpy.mockRestore();
  });

  type SpyBundle = Partial<Record<keyof P2PEvents, jest.Mock>>;

  function makeConn(
    opts: {
      isHost?: boolean;
      spies?: SpyBundle;
    } = {},
  ): WebRTCConnection {
    return new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: opts.isHost ?? false,
      enableICEMonitoring: false,
      // Keep pings driven by the test — no real interval handles.
      externalPing: true,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 1,
      reconnectAttemptTimeoutMs: 10,
      events: (opts.spies ?? {}) as Partial<P2PEvents>,
    });
  }

  it("propagates construction failure from initialize()", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: false,
      enableICEMonitoring: false,
      externalPing: true,
      rtcConfig: { failConstruction: true } as unknown as RTCConfiguration,
      events: { onError: jest.fn() },
    });
    await expect(conn.initialize()).rejects.toThrow(
      "MockRTCPeerConnection: construction failed (test)",
    );
    expect(conn.getConnectionState()).toBe("failed");
  });

  it("rejects negotiation calls made before initialize()", async () => {
    const conn = makeConn();
    await expect(conn.createOffer()).rejects.toThrow(
      "Peer connection not initialized",
    );
    await expect(conn.handleOffer({ type: "offer", sdp: "x" })).rejects.toThrow(
      "Peer connection not initialized",
    );
    await expect(
      conn.handleAnswer({ type: "answer", sdp: "x" }),
    ).rejects.toThrow("Peer connection not initialized");
    await expect(conn.connectToPeer()).rejects.toThrow(
      "Peer connection not initialized",
    );
    // addIceCandidate is deliberately forgiving: a late/lost candidate must
    // never break the connection.
    await expect(
      conn.addIceCandidate({ candidate: "c" }),
    ).resolves.toBeUndefined();
    await expect(conn.addIceCandidate(null)).resolves.toBeUndefined();
  });

  it("runs the full offer/answer/ICE negotiation against the mock transport", async () => {
    const conn = makeConn();
    await conn.initialize();
    const pc = latestPC();

    const offer = await conn.createOffer();
    expect(offer.type).toBe("offer");
    expect(pc.localDescriptions).toHaveLength(1);

    await conn.handleAnswer({ type: "answer", sdp: "mock-answer" });
    expect(pc.remoteDescriptions).toHaveLength(1);

    await conn.connectToPeer();
    expect(pc.createdChannels).toHaveLength(1);

    const candidate: RTCIceCandidateInit = { candidate: "candidate:negot 1" };
    await conn.addIceCandidate(candidate);
    expect(pc.addedCandidates).toEqual([candidate]);

    conn.close();
    expect(pc.closed).toBe(true);
  });

  it("dispatches inbound data-channel messages to typed handlers", async () => {
    const spies: SpyBundle = {
      onChat: jest.fn(),
      onEmote: jest.fn(),
      onPlayerAction: jest.fn(),
      onError: jest.fn(),
      onConnectionStateChange: jest.fn(),
    };
    const conn = makeConn({ isHost: true, spies });
    await conn.initialize();
    const pc = latestPC();

    // Remote side opens its channel: deliver it via ondatachannel, then open.
    const channel = new MockRTCDataChannel();
    pc.ondatachannel?.({ channel });
    channel.onopen?.();
    expect(conn.getConnectionState()).toBe("connected");
    expect(spies.onConnectionStateChange).toHaveBeenCalledWith("connected", "");

    const deliver = (payload: unknown) =>
      channel.onmessage?.({ data: payload });

    // Chat / emote / action / error round-trip through handleMessage.
    deliver(
      JSON.stringify({
        type: "chat",
        senderId: "p2",
        timestamp: 1,
        payload: { text: "gl hf" },
      }),
    );
    expect(spies.onChat).toHaveBeenCalledWith("gl hf", "p2");

    deliver(
      JSON.stringify({
        type: "emote",
        senderId: "p2",
        timestamp: 2,
        payload: { emote: "thumbsup" },
      }),
    );
    expect(spies.onEmote).toHaveBeenCalledWith("thumbsup", "p2");

    deliver(
      JSON.stringify({
        type: "player-action",
        senderId: "p2",
        timestamp: 3,
        payload: { action: "draw", data: { n: 1 } },
      }),
    );
    expect(spies.onPlayerAction).toHaveBeenCalledWith("draw", { n: 1 }, "p2");

    deliver(
      JSON.stringify({
        type: "error",
        senderId: "p2",
        timestamp: 4,
        payload: { message: "boom" },
      }),
    );
    expect(spies.onError).toHaveBeenCalledWith(new Error("boom"), "p2");

    // Ping gets a pong back on the same channel.
    deliver(JSON.stringify({ type: "ping", senderId: "p2", timestamp: 5 }));
    const pongs = channel.sent
      .map((raw) => JSON.parse(raw) as { type: string })
      .filter((m) => m.type === "pong");
    expect(pongs).toHaveLength(1);

    // Garbage must never throw out of the handler.
    expect(() => deliver("{not json")).not.toThrow();
    expect(() => deliver(123 as unknown as string)).not.toThrow();
    expect(() =>
      deliver(JSON.stringify({ type: "unknown-kind" })),
    ).not.toThrow();
    // The malformed messages were dropped, not forwarded to game handlers.
    expect(spies.onChat).toHaveBeenCalledTimes(1);
  });

  it("sendChat / sendEmote serialize onto an open channel and are safe without one", () => {
    const conn = makeConn();
    // No channel yet: sends are silently dropped, never thrown.
    expect(() => conn.sendChat("too early")).not.toThrow();
    expect(() => conn.sendEmote("wave")).not.toThrow();

    const channel = new MockRTCDataChannel();
    // Simulate the host receiving our channel, then us opening it.
    conn["dataChannel"] = channel as unknown as RTCDataChannel;
    conn.sendChat("hello");
    conn.sendEmote("thumbs up");
    const kinds = channel.sent.map((raw) => JSON.parse(raw).type);
    expect(kinds).toEqual(["chat", "emote"]);
  });
});

// =============================================================================
// Issue #1927 — read-only reconnect/failure accessors. These form the typed
// surface that replaces the `as any` bracket-access casts previously used by
// src/hooks/use-p2p-connection.ts.
// =============================================================================

describe("WebRTCConnection reconnect/failure accessors (issue #1927)", () => {
  let originals: ReturnType<typeof installWebrtcGlobals>;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    originals = installWebrtcGlobals();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    uninstallWebrtcGlobals(originals);
    errorSpy.mockRestore();
  });

  function makeAccessorConn(
    opts: { maxReconnectAttempts?: number } = {},
  ): WebRTCConnection {
    return new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
      // Keep pings driven by the test — no real interval handles.
      externalPing: true,
      maxReconnectAttempts: opts.maxReconnectAttempts,
    });
  }

  it("exposes the configured maxReconnectAttempts and a zero initial attempt count", () => {
    const conn = makeAccessorConn({ maxReconnectAttempts: 5 });
    expect(conn.getMaxReconnectAttempts()).toBe(5);
    expect(conn.getReconnectAttempts()).toBe(0);
    conn.close();
  });

  it("defaults maxReconnectAttempts to 3 when unset", () => {
    const conn = makeAccessorConn();
    expect(conn.getMaxReconnectAttempts()).toBe(3);
    conn.close();
  });

  it("getLastFailureDiagnostic returns null unless the transport is failed", async () => {
    const conn = makeAccessorConn();
    expect(conn.getLastFailureDiagnostic()).toBeNull();

    await conn.initialize();
    // Initialized but healthy (connecting/signaling) — no diagnostic yet.
    expect(conn.getLastFailureDiagnostic()).toBeNull();
    conn.close();
  });

  it("getLastFailureDiagnostic classifies an actionable diagnostic once failed", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
      externalPing: true,
      rtcConfig: { failConstruction: true } as unknown as RTCConfiguration,
      events: { onError: jest.fn() },
    });
    await expect(conn.initialize()).rejects.toThrow(
      "MockRTCPeerConnection: construction failed (test)",
    );
    expect(conn.getConnectionState()).toBe("failed");

    const diag = conn.getLastFailureDiagnostic();
    expect(diag).not.toBeNull();
    expect(typeof diag?.reason).toBe("string");
    expect(typeof diag?.remediation).toBe("string");
    expect([
      "TURN_UNCONFIGURED",
      "ICE_FAILED",
      "SIGNALING_UNREACHABLE",
      "PEER_UNREACHABLE",
      "UNKNOWN",
    ]).toContain(diag?.category);
  });
});
